import { readFile } from 'node:fs/promises';
import {mobileTools,isMobileTool,mobileReleaseStatus} from '../../packages/providers/mobile-inputs.ts';
import {codingCapability,codingTools,isCodingTool,applyCodingCandidate} from '../../packages/providers/coding.ts';
import { skillRegistry } from '../../packages/providers/registry.ts';
import { sourceManifest } from '../../packages/providers/source.ts';
import { G } from '../../packages/contracts/graph.ts';
import { CONTRACT, definitionSchema, releaseStages, toolsSchemas, type Project, type Principal, type Definition, type Run, type Graph } from '../../packages/contracts/index.ts';
import { Store, uid, digest, event, fail } from './store.ts';
import { initializeLifecycle, lifecycleSummary, markNode, stepAdmission, invalidateDocumentConsumers, bindPublishedDocument, requirementsDelivered, requiredNodeIds } from '../../packages/lifecycle/model.ts';
import {readMergeRequest,readMergeRequestDiff,writeMergeRequest,validateRepository,trustedRepositories} from '../../packages/providers/repository.ts';
import { documentView, createDocument, getDocument, editDocument, publishDocument, archiveExecutionDocument } from '../../packages/documents/smartdoc.ts';
import {cloudConfigured,cloudResourceUri} from '../../packages/cloud/workspace.ts';
import {connectCloudDocumentTree} from '../../packages/cloud/document-tree.ts';
import {createStepConfiguration,compileStepConfiguration,stepConfigDigest} from '../../packages/lifecycle/step-config.ts';
import {artifactView} from '../../packages/documents/artifacts.ts';
import {projectWithArtifactMetadata} from '../../packages/documents/project-view.ts';
import {publicGitProfiles,gitProfiles,verifyGitProfile}from'../../packages/providers/git-profiles.ts';
import {synchronizeCloud} from '../../packages/cloud/reconcile.ts';
import {announceAgent,closeProjectAgentPresence} from '../../packages/cloud/realtime.ts';
const expose = (p:Project) => {const view=projectWithArtifactMetadata(p);return p.lifecycle ? {...view,documents:undefined,lifecycle:lifecycleSummary(p)} : view;};
const active = (p: Project) => p.runs.find(r => !['succeeded', 'failed', 'canceled'].includes(r.status));
const definition = (g: Graph) => structuredClone({ stages: g.stages, nodes: g.nodes.map(({ id, title, stage, kind, depends, config }) => ({ id, title, stage, kind, depends, config })) });
function recordMRReceipt(p:Project,receipt:NonNullable<Project['mergeRequest']>){
 p.mergeRequest=receipt;
                const nodes=p.graph.nodes.filter(n=>n.id==='mr-review'&&!receipt.draft&&['open','merged'].includes(receipt.state)||n.id==='mr-merge'&&receipt.state==='merged');
                const runId=uid(),applied:string[]=[];
                for(const n of nodes){
                    stepAdmission(p,n,true);if(n.depends.some(id=>G.get(p.graph,id).status!=='succeeded'))fail('UPSTREAM_NOT_READY');
                    const prior=n.attempts.at(-1);if(n.status==='succeeded'&&prior?.inputDigest===digest(receipt.headSha+receipt.state))continue;
                    const content=JSON.stringify(receipt),artifact={name:'mr-'+receipt.number+'-receipt.json',kind:'application/json',content,sha256:digest(content),producer:receipt.provider+'.mr.verify',inputDigest:digest(receipt.headSha+receipt.state),createdAt:receipt.verifiedAt};
                    n.attempts.push({id:n.attempts.length+1,status:'succeeded',revision:n.revision,runId,inputDigest:artifact.inputDigest,inputSnapshot:{repository:p.repository,verifiedReceipt:receipt},startedAt:receipt.verifiedAt,finishedAt:receipt.verifiedAt,logs:[{level:'info',text:'只读查询代码托管平台的实际 MR 状态；未通过文档或人工标过伪造合并。'}],artifacts:[artifact]});
                    n.status='succeeded';delete n.mark;archiveExecutionDocument(p,n.id,n.attempts.length,[artifact],'system');applied.push(n.id);
                }
                if(applied.length)p.runs.push({id:runId,projectId:p.id,revision:p.graph.revision,graphDigest:digest(definition(p.graph)),status:'succeeded',auto:false,selected:applied,budget:p.budget,spent:applied.length,startedAt:receipt.verifiedAt,finishedAt:receipt.verifiedAt,decisionScope:'development',jobs:applied.map(nodeId=>({nodeId,attempt:G.get(p.graph,nodeId).attempts.length,completed:true})),commands:[]});
                event(p,'mr.receipt_verified',{number:receipt.number,state:receipt.state,headSha:receipt.headSha,mergeSha:receipt.mergeSha,applied});return {receipt,appliedNodeIds:applied};
}
export function applyDefinition(p: Project, input: Definition) {
    if (active(p))
        fail('RUN_ACTIVE_PLAN_LOCKED');
    const d = definitionSchema.parse(input);
    if(p.lifecycle){
        if(d.stages.filter(s=>p.graph.stages.some(old=>old.id===s.id)).map(s=>s.id).join()!==p.graph.stages.map(s=>s.id).join()) fail('LIFECYCLE_STEPS_LOCKED');
        const mandatory=requiredNodeIds(p.lifecycle.kind);
        for(const doc of Object.values(p.documents||{}))if(doc.nodeId&&mandatory.has(doc.nodeId)&&!d.nodes.some(n=>n.id===doc.nodeId&&n.stage===doc.stepId))fail('REQUIRED_DELIVERABLE_NODE_LOCKED');
        if(p.graph.nodes.some(n=>n.attempts.length&&!d.nodes.some(x=>x.id===n.id)))fail('NODE_WITH_HISTORY_CANNOT_BE_REMOVED');
        if(d.nodes.some(n=>n.depends.some(id=>d.nodes.find(x=>x.id===id)?.stage!==n.stage)))fail('CROSS_STEP_NODE_DEPENDENCY_FORBIDDEN');
    }
    const ids = new Set(d.nodes.map(n => n.id)), stages = new Set(d.stages.map(s => s.id));
    if (ids.size !== d.nodes.length || stages.size !== d.stages.length)
        fail('DUPLICATE_ID');
    const previous = p.graph;
    const changed = new Set<string>();
    const nodes = d.nodes.map(n => { const old = previous.nodes.find(x => x.id === n.id); if (!old) {
        changed.add(n.id);
        return { ...n, status: 'pending', revision: 1, attempts: [], staleReason: '' };
    } const executionChanged = digest({ kind: old.kind, depends: old.depends, config: old.config }) !== digest({ kind: n.kind, depends: n.depends, config: n.config }); if (executionChanged)
        changed.add(n.id); return { ...old, ...n, revision: old.revision + (digest({ ...old, attempts: [], status: '' }) !== digest({ ...old, ...n, attempts: [], status: '' }) ? 1 : 0) }; });
    const next: Graph = { ...previous, stages: d.stages, nodes, revision: previous.revision + 1, sequence: Math.max(previous.sequence, ...d.nodes.map(n => Number(n.id.match(/^node-(\d+)$/)?.[1] || 0))) };
    if (!G.validate(next) || next.nodes.some(n => n.depends.length !== new Set(n.depends).size))
        fail('GRAPH_INVALID');
    for (const id of changed)
        for (const affected of G.affected(next, id)) {
            const n = G.get(next, affected);
            n.status = n.attempts.length ? 'stale' : 'pending';
            delete n.mark;
            n.staleReason = '产品、设计、配置或依赖已变化，需要重新验证。';
        }
    p.graph = next;
    if(p.lifecycle)for(const doc of Object.values(p.documents||{}))if(doc.nodeId){const node=next.nodes.find(n=>n.id===doc.nodeId);if(node)doc.stepId=node.stage;else{doc.archivedFromNode=doc.nodeId;delete doc.nodeId;}}
    event(p, 'plan.changed', { graphRevision: next.revision, changed: [...changed] });
}
export async function newProject(actor: Principal, title: string, goal: string, id: string = uid()): Promise<Project> {
    const graph = G.initial();
    for (const n of graph.nodes) {
        n.status = 'pending';
        n.attempts = [];
        n.config.skills = [];
        n.config.tools = [];
        n.config.outputName = 'report.json';
    }
    const docs: [
        string,
        string
    ][] = [['product-spec', '01-PRODUCT.zh-CN.md'], ['ui-spec', '02-INTERACTION.zh-CN.md'], ['architecture', '../../../../Muse-CI/docs/Architectur-Discussion.md']];
    for (const [nodeId, file] of docs) {
        let text = '';
        try {
            text = await readFile(new URL(`../../plugin/docs/${file}`, import.meta.url), 'utf8');
        }
        catch {
            text = '请补齐 ' + file;
        }
        const n = G.get(graph, nodeId);
        n.config.materials = [];
        for (let offset = 0; offset < text.length; offset += 20000)
            n.config.materials.push({ kind: 'note', name: file.split('/').at(-1)! + (text.length > 20000 ? ' · ' + (offset / 20000 + 1) : ''), text: text.slice(offset, offset + 20000) });
        n.config.tools = ['doc-compile'];
        n.config.outputName = nodeId + '.md';
    }
    const mapping: Record<string, [
        string,
        string,
        string
    ]> = { source: ['源码与合同检查', 'test', 'ci-inspect'], document: ['插件 UI 与节点回归', 'test', 'ci-plugin-test'], build: ['插件 UI artifact 构建', 'build', 'ci-build'], tests: ['调度与合同回归', 'test', 'ci-test'], privacy: ['权限与数据边界检查', 'test', 'ci-policy'], binary: ['发行物摘要验证', 'test', 'ci-artifact-verify'], product: ['产品与 UI 交付验收', 'approval', 'artifact-read'], device: ['跨端交互验收', 'approval', 'artifact-read'], materials: ['开发验收报告', 'artifact', 'artifact-read'], release: ['发布准备核验', 'test', 'ci-release-check'] };
    for (const [id, [name, kind, tool]] of Object.entries(mapping)) {
        const n = G.get(graph, id);
        n.title = name;
        n.kind = kind;
        n.config.goal = name + '，记录真实输入和产物。';
        n.config.tools = [tool];
    }
    G.get(graph, 'source').config.goal = goal;
    return { id, title, goal, type: '插件开发', budget: 50, version: 1, graph, runs: [], members: { [actor.id]: 'owner' }, events: [{ seq: 1, time: new Date().toISOString(), type: 'project.created', detail: { title } }], createdAt: new Date().toISOString() };
}
export function releaseCheck(p: Project) { const n = p.graph.nodes; return { ready: false, scope: 'development', stages: releaseStages.map((name, i) => ({ name, status: i === 0 && ['product-spec', 'ui-spec', 'architecture'].every(id => n.find(x => x.id === id)?.status === 'succeeded') ? 'evidence_available' : 'blocked' })), missing: ['正式发布身份与限定操作授权', '隔离签名与正式候选包', '实际设备验收', '渠道上传/提审/发布回执'], message: '开发检查完成不构成正式发布批准。' }; }
export class CIService {
    constructor(readonly store: Store) { }
    async present(p:Project,actor:Principal){
        const result:any=expose(p);
        if(p.lifecycle?.kind==='version')result.lifecycle.children=await Promise.all(p.lifecycle.children.map(async c=>{
            try{const child=await this.store.get(c.projectId,actor);return {...c,title:child.title,version:child.version,status:requirementsDelivered(child)?'delivered':'in_progress'};}
            catch{return {...c,status:'unavailable'};}
        }));
        return result;
    }
    async finishMROperation(projectId:string,commandId:string,actor:Principal){
        let changed={project:await this.store.get(projectId,actor)};
        if(changed.project.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');
        if(!changed.project.mrOperations?.[commandId])fail('MR_OPERATION_NOT_FOUND');
            const operation=changed.project.mrOperations[commandId];
            if(operation.status==='confirmed')return {...changed,receipt:operation.receipt,project:await this.present(changed.project,actor)};
            if(operation.status==='blocked')fail(operation.error||'MR_PLATFORM_BLOCKED');
            const lease=uid();
            const claim=await this.store.mutate(projectId,actor,undefined,undefined,{},p=>{
                const op=p.mrOperations![commandId];
                if(op.status!=='prepared')return {busy:true};
                if(op.leaseUntil&&Date.parse(op.leaseUntil)>Date.now()||op.nextAttemptAt&&Date.parse(op.nextAttemptAt)>Date.now())return {busy:true};
                op.lease=lease;op.leaseUntil=new Date(Date.now()+300000).toISOString();return {busy:false};
            });
            if(claim.busy)return {project:await this.present(claim.project,actor),operationId:commandId,waiting:true,waitingFor:operation.waitingFor||'MR_OPERATION_IN_PROGRESS'};
            try{
                changed={project:claim.project};
                if(Object.values(changed.project.documents||{}).some(d=>d.cloud))changed={project:(await synchronizeCloud(this.store,projectId,actor)).project};
                if(digest(changed.project.repository)!==digest(operation.repository))fail('MR_BINDING_CHANGED');
                if(active(changed.project))fail('RUN_ACTIVE_PLAN_LOCKED');
                stepAdmission(changed.project,G.get(changed.project.graph,'mr-review'),true);
                if(changed.project.lifecycle?.kind==='requirement'){
                    const report=G.get(changed.project.graph,'feature-report').attempts.at(-1);
                    const tested=changed.project.runs.find(r=>r.id===report?.runId)?.sourceDigest;
                    if(!tested)fail('MR_TEST_SOURCE_NOT_PINNED');
                    if((await sourceManifest(changed.project.graph)).digest!==tested)fail('MR_TEST_SOURCE_CHANGED');
                }
                const receipt=await writeMergeRequest(operation.repository,operation.action);
                const completed=await this.store.mutate(projectId,actor,undefined,undefined,{},p=>{
                    const op=p.mrOperations![commandId];if(digest(p.repository)!==digest(op.repository))fail('MR_BINDING_CHANGED');
                    if(op.lease!==lease)fail('MR_OPERATION_LEASE_CHANGED');
                    delete op.lease;delete op.leaseUntil;delete op.waitingFor;delete op.nextAttemptAt;
                    op.status='confirmed';op.receipt=receipt;event(p,'mr.operation_confirmed',{commandId:commandId,kind:op.action.kind,headSha:receipt.headSha,number:receipt.number,state:receipt.state,actor:actor.id});
                    return recordMRReceipt(p,receipt);
                });
                return {...completed,project:await this.present(completed.project,actor)};
            }catch(error){
                const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MR_DELIVERY_UNCONFIRMED';
                const retry=['MR_CHECKS_PENDING','MR_DELIVERY_UNCONFIRMED','MR_SUBMISSION_UNCONFIRMED','MR_MERGE_UNCONFIRMED'].includes(code);
                const failed=await this.store.mutate(projectId,actor,undefined,undefined,{},p=>{
                    const op=p.mrOperations![commandId];if(op.status==='prepared'&&op.lease===lease){
                        delete op.lease;delete op.leaseUntil;
                        if(retry){if(op.waitingFor!==code)event(p,'mr.operation_waiting',{commandId,code});op.waitingFor=code;op.nextAttemptAt=new Date(Date.now()+30000).toISOString();}
                        else{op.status='blocked';op.error=code;delete op.waitingFor;delete op.nextAttemptAt;event(p,'mr.operation_blocked',{commandId,code});}
                    }return {};
                });
                if(retry)return {project:await this.present(failed.project,actor),operationId:commandId,waiting:true,waitingFor:code};
                throw Error(code);
            }
    }
    async drainMROperations(){
        const rows=await this.store.pool.query("SELECT id FROM ci_projects WHERE jsonb_path_exists(document, '$.mrOperations.* ? (@.status == \"prepared\")') LIMIT 50");
        let attempted=0;
        for(const row of rows.rows){const p=await this.store.get(row.id);
            for(const [id,op]of Object.entries(p.mrOperations||{})){
                if(op.status!=='prepared'||op.nextAttemptAt&&Date.parse(op.nextAttemptAt)>Date.now()||op.leaseUntil&&Date.parse(op.leaseUntil)>Date.now())continue;
                if(p.members[op.actor]!=='owner'){
                    await this.store.mutate(p.id,undefined,undefined,undefined,{},current=>{const pending=current.mrOperations![id];if(pending.status==='prepared'){pending.status='blocked';pending.error='PROJECT_OWNER_REQUIRED';delete pending.lease;delete pending.leaseUntil;event(current,'mr.operation_blocked',{commandId:id,code:'PROJECT_OWNER_REQUIRED'});}return {};});continue;
                }
                try{await this.finishMROperation(p.id,id,{id:op.actor});}catch{/* Durable blocked state or a recoverable transport intent is retained. */}
                if(++attempted>=5)return;
            }
        }
    }
    async call(name: string, raw: unknown, actor: Principal) {
        const schema = toolsSchemas[name as keyof typeof toolsSchemas];
        if (!schema)
            fail('TOOL_NOT_ALLOWED');
        const a: any = schema.parse(raw);
        if(name==='ci_git_profiles_list')return {profiles:await publicGitProfiles()};
        if(name==='ci_git_profile_verify')return verifyGitProfile(a.profileId,a.repository);
        if (name === 'ci_open')
            return { contract: CONTRACT, uiResourceUri: 'ui://muse-ci/main' };
        if (name === 'ci_capabilities')
            return { contract: CONTRACT, lifecycle:3,gitProfiles:await publicGitProfiles(),smartDoc:{native:true,profile:'muse.smart-document/phase1',collaboration:cloudConfigured()?'native-cloud-full-sync':'versioned-block-operations',cloudRealtime:cloudConfigured(),fullEditor:'installed-native-smart-document'}, execution: 'temporal-development', identity: 'local-development', tools: [...codingTools,...mobileTools,'smartdoc-publish','doc-compile', 'ci-inspect', 'ci-plugin-test', 'ci-build', 'ci-test', 'ci-policy', 'ci-artifact-verify', 'ci-release-check', 'artifact-read'], skills: skillRegistry, ai: codingCapability().available?codingCapability():{ available: !!process.env.CI_AI_MCP_URL, recipient: process.env.CI_AI_MCP_URL || null, dataCategories: ['目标', '节点材料'] }, formalRelease: false };
        if (name === 'ci_projects_list')
            return { projects: await this.store.list(actor) };
        if (name === 'ci_projects_create') {
            const id = digest(actor.id + ':' + a.commandId).slice(0, 32);
            return { project: await this.store.create(await newProject(actor, a.title, a.goal, id), a.commandId) };
        }
        if(name==='ci_lifecycle_create'){
            const id=digest(actor.id+':lifecycle:'+a.commandId).slice(0,32);
            const candidate=initializeLifecycle(await newProject(actor,a.title,a.goal,id),a.kind,a.versionName);
            if(a.legacyProjectId){const source=await this.store.get(a.legacyProjectId,actor);candidate.lifecycle!.legacySource={projectId:source.id,version:source.version};}
            return {project:await this.present(await this.store.create(candidate,a.commandId),actor)};
        }
        let p = await this.store.get(a.projectId, actor);
        if((name==='ci_document_get'&&!a.revision||name==='ci_document_sync'||['ci_document_edit','ci_agent_document_edit','ci_document_publish'].includes(name))&&p.documents?.[a.documentId]?.cloud){
            p=(await synchronizeCloud(this.store,p.id,actor,a.documentId)).project;
        }
        if(name==='ci_document_sync')return {project:await this.present(p,actor),...documentView(p,a.documentId)};
        if((name==='ci_run_command'&&a.action==='start'||name==='ci_mr_verify')&&Object.values(p.documents||{}).some(d=>d.cloud))p=(await synchronizeCloud(this.store,p.id,actor)).project;
        if(name==='ci_mr_reconcile'){
            if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');
            if(!p.mrOperations?.[a.operationId])fail('MR_OPERATION_NOT_FOUND');
            stepAdmission(p,G.get(p.graph,'mr-review'),true);
            await this.store.mutate(p.id,actor,a.expectedVersion,a.commandId,{name,...a},p=>{const op=p.mrOperations![a.operationId];if(op.status==='blocked'){op.status='prepared';delete op.error;event(p,'mr.operation_retry_requested',{operationId:a.operationId,actor:actor.id});}delete op.nextAttemptAt;return {};});
            return this.finishMROperation(p.id,a.operationId,actor);
        }
        if(name==='ci_mr_cancel'){
            if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');
            const canceled=await this.store.mutate(p.id,actor,a.expectedVersion,a.commandId,{name,...a},current=>{
                const op=current.mrOperations?.[a.operationId];if(!op)fail('MR_OPERATION_NOT_FOUND');
                if(op.status==='confirmed')fail('MR_OPERATION_ALREADY_CONFIRMED');
                if(op.leaseUntil&&Date.parse(op.leaseUntil)>Date.now())fail('MR_OPERATION_IN_PROGRESS');
                op.status='blocked';op.error='MR_OPERATION_CANCELED';delete op.waitingFor;delete op.nextAttemptAt;delete op.lease;delete op.leaseUntil;
                event(current,'mr.operation_canceled',{operationId:a.operationId,actor:actor.id});return {canceled:true};
            });return {...canceled,project:await this.present(canceled.project,actor)};
        }
        if (name === 'ci_project_get')
            return { project: await this.present(p,actor) };
        if(name==='ci_document_get'){const result=documentView(p,a.documentId,a.revision);return {...result,projectVersion:p.version,...(!a.revision&&getDocument(p,a.documentId).cloud?{resourceUri:cloudResourceUri(getDocument(p,a.documentId))}:{})};}
        if (name === 'ci_events_list')
            return { events: p.events.filter(e => e.seq > a.after).slice(0, 200), cursor: p.events.at(-1)?.seq || 0, version: p.version };
        if (name === 'ci_release_check')
            return p.graph.nodes.some(n=>n.config.tools.some(isMobileTool))?await mobileReleaseStatus():releaseCheck(p);
        if(name==='ci_mr_diff'){if(!p.repository)fail('REPOSITORY_BINDING_REQUIRED');return readMergeRequestDiff(p.repository,a);}
        if (name === 'ci_artifact_get') {
            return artifactView(p,a.nodeId,a.attempt,a.index);
        }
        const mrWrite=['ci_mr_create','ci_mr_submit','ci_mr_merge'].includes(name);
        const changed=await this.store.mutate(a.projectId, actor, a.expectedVersion, a.commandId, { name, ...a }, async (p, c) => {
            if(name==='ci_step_config_create'){
                if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                const doc=createStepConfiguration(p,a.stepId,actor);return {documentId:doc.id,applied:true};
            }
            if(mrWrite){
                if(p.lifecycle?.kind!=='requirement'||!p.repository)fail('REPOSITORY_BINDING_REQUIRED');
                if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                stepAdmission(p,G.get(p.graph,'mr-review'),true);
                const kind=name==='ci_mr_create'?'create':name==='ci_mr_submit'?'submit':'merge';
                const action={kind:kind as 'create'|'submit'|'merge',expectedHeadSha:a.expectedHeadSha,number:a.number,title:a.title,body:a.body,method:a.method,marker:'<!-- muse-ci:'+p.id+':'+a.commandId+' -->'};
                p.mrOperations??={};if(Object.values(p.mrOperations).some(op=>op.status==='prepared'))fail('MR_OPERATION_RECONCILIATION_REQUIRED');
                p.mrOperations[a.commandId]={action,repository:structuredClone(p.repository),status:'prepared',actor:actor.id,at:new Date().toISOString()};
                event(p,'mr.operation_prepared',{commandId:a.commandId,kind,headSha:a.expectedHeadSha,actor:actor.id});return {operationId:a.commandId};
            }
            if(['ci_repository_bind','ci_graph_save','ci_document_edit','ci_agent_document_edit','ci_document_publish','ci_document_cloud_connect','ci_run_command'].includes(name)&&Object.values(p.mrOperations||{}).some(op=>op.status==='prepared'))fail('MR_OPERATION_RECONCILIATION_REQUIRED');
            if(name==='ci_document_cloud_connect'){
                if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                const linkedProjects:Project[]=[];
                for(const child of p.lifecycle?.children||[]){
                    try{linkedProjects.push(await this.store.get(child.projectId,actor));}
                    catch(error){if(!['PROJECT_ACCESS_DENIED','PROJECT_NOT_FOUND'].includes((error as Error).message))throw error;}
                }
                const result=await connectCloudDocumentTree(p,a.documentId,actor,undefined,linkedProjects);
                for(const id of result.changedDocumentIds)invalidateDocumentConsumers(p,id);
                event(p,'document.cloud_connected',{documentId:a.documentId,...result,actor:actor.id});return result;
            }
            if(name==='ci_repository_bind'){
                if(p.lifecycle?.kind!=='requirement')fail('REQUIREMENT_LIFECYCLE_REQUIRED');
                if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                validateRepository(a.provider,a.repository);
                if(a.gitProfileId&&!(await gitProfiles()).some(p=>p.id===a.gitProfileId))fail('GIT_PROFILE_NOT_FOUND');
                p.repository={provider:a.provider,path:a.repository,baseBranch:a.baseBranch,sourceBranch:a.sourceBranch,...(a.gitProfileId?{gitProfileId:a.gitProfileId}:{})};delete p.mergeRequest;
                for(const n of p.graph.nodes.filter(n=>n.stage==='merge')){n.status=n.attempts.length?'stale':'pending';delete n.mark;}
                event(p,'repository.bound',{repository:p.repository,actor:actor.id});return {applied:true};
            }
            if(name==='ci_mr_verify'){
                if(p.lifecycle?.kind!=='requirement'||!p.repository)fail('REPOSITORY_BINDING_REQUIRED');if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                const receipt=await readMergeRequest(p.repository,a.number);p.mergeRequest=receipt;
                return recordMRReceipt(p,receipt);
            }
            if(name==='ci_requirement_create'){
                if(p.lifecycle?.kind!=='version')fail('VERSION_LIFECYCLE_REQUIRED');
                if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                if(p.lifecycle.children.length>=40)fail('REQUIREMENT_LIMIT');
                const id=digest(p.id+':requirement:'+a.commandId).slice(0,32);
                const child=initializeLifecycle(await newProject(actor,a.title,a.goal,id),'requirement');
                child.members=structuredClone(p.members);child.lifecycle!.parentId=p.id;child.lifecycle!.parentStep='requirements';
                const created=await this.store.createChild(child,a.commandId,c);
                p.lifecycle.children.push({projectId:created.id,title:created.title});
                const handbook=getDocument(p,p.lifecycle.handbookId);
                editDocument(p,handbook.id,handbook.revision,[{op:'link',text:'子需求 · '+created.title,projectId:created.id,documentId:created.lifecycle!.handbookId}],actor,false,'归档需求子流程入口');
                event(p,'requirement.created',{projectId:created.id,title:created.title});
                return {childProjectId:created.id,applied:true};
            }
            if(name==='ci_node_mark'){markNode(p,a.nodeId,a.marked,a.reason,actor);return {applied:true};}
            if(name==='ci_agent_access'){
                if(p.members[actor.id]!=='owner')fail('PROJECT_OWNER_REQUIRED');
                if(!p.lifecycle)fail('LIFECYCLE_REQUIRED');p.lifecycle.agentEnabled=a.enabled;
                if(!a.enabled)closeProjectAgentPresence(p.id);
                event(p,'agent.collaboration_access',{enabled:a.enabled,actor:actor.id});return {applied:true};
            }
            if(name.startsWith('ci_document_')||name==='ci_agent_document_edit'){
                if(!p.lifecycle)fail('LIFECYCLE_REQUIRED');
                if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                if(name==='ci_document_create'){
                    getDocument(p,a.parentId);if(a.stepId&&!p.graph.stages.some(s=>s.id===a.stepId))fail('STEP_NOT_FOUND');
                    const doc=createDocument(p,a.title,'material',[],{parentId:a.parentId,stepId:a.stepId});
                    const parent=getDocument(p,a.parentId);editDocument(p,parent.id,parent.revision,[{op:'link',text:a.title,documentId:doc.id}],actor,false,'归档子文档');
                    invalidateDocumentConsumers(p,parent.id);
                    event(p,'document.created',{documentId:doc.id,actor:actor.id});return {documentId:doc.id,applied:true};
                }
                const doc=getDocument(p,a.documentId);
                if(name==='ci_document_publish'){
                    if(doc.kind==='step-config'){
                        if(a.expectedRevision!==doc.revision)fail('SMARTDOC_REVISION_CONFLICT');
                        applyDefinition(p,compileStepConfiguration(p,doc.id));
                        p.stepConfigurations![doc.stepId!]={documentId:doc.id,publishedRevision:doc.revision,configDigest:stepConfigDigest(p,doc.stepId!)};
                        event(p,'step.configuration_published',{stepId:doc.stepId,documentId:doc.id,revision:doc.revision,actor:actor.id});
                    }
                    publishDocument(p,doc.id,a.expectedRevision);bindPublishedDocument(p,doc.id);
                    event(p,'document.published',{documentId:doc.id,revision:doc.revision,actor:actor.id});return {applied:true};
                }
                for(const edit of a.edits)if(edit.op==='link'&&edit.projectId&&edit.projectId!==p.id){
                    const linked=await this.store.get(edit.projectId,actor);getDocument(linked,edit.documentId);
                }
                editDocument(p,doc.id,a.expectedRevision,a.edits,actor,name==='ci_agent_document_edit',a.summary);
                invalidateDocumentConsumers(p,doc.id);
                event(p,'document.edited',{documentId:doc.id,revision:doc.revision,actor:name==='ci_agent_document_edit'?'muse-ci-agent':actor.id,onBehalfOf:actor.id,summary:a.summary});
                return {applied:true};
            }
            if(name==='ci_coding_apply'){
                if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                const n=G.get(p.graph,a.nodeId),attempt=n.attempts.find(x=>x.id===a.attempt);
                if(n.kind!=='agent'||n.config.tools.length!==1||!isCodingTool(n.config.tools[0])||attempt?.status!=='succeeded'||attempt!==n.attempts.at(-1)||n.status!=='succeeded'||attempt.revision!==n.revision||attempt.inputDigest!==a.inputDigest)fail('CODING_CANDIDATE_NOT_VERIFIED');
                const run=p.runs.find(r=>r.id===attempt.runId);if(run?.sourceDigest!==(await sourceManifest(p.graph)).digest)fail('SOURCE_INPUT_CHANGED');
                const candidate=attempt.artifacts.find(x=>x.name==='candidate-patch.json');if(!candidate||digest(candidate.content)!==candidate.sha256)fail('ARTIFACT_INTEGRITY_FAILED');
                const result=await applyCodingCandidate(JSON.parse(candidate.content),n.config.tools[0]);
                event(p,'coding.patch_applied',{runId:run.id,nodeId:n.id,attempt:attempt.id,candidateSha256:candidate.sha256,...result});
                // Old source checks remain evidence for their old inputs, never current proof after a patch.
                for(const check of p.graph.nodes.filter(x=>x.config.tools.some(isMobileTool)&&x.attempts.length)){check.status='stale';check.staleReason='AI 补丁已应用，源码检查需要重新执行。';}
                return result;
            }
            if (name === 'ci_graph_save') {
                for(const next of a.definition.nodes){const old=p.graph.nodes.find(n=>n.id===next.id);if(old&&p.stepConfigurations?.[old.stage]&&digest(old.config)!==digest(next.config))fail('STEP_CONFIG_DOCUMENT_REQUIRED');}
                for (const n of a.definition.nodes)
                    for (const m of n.config.materials)
                        if(p.lifecycle&&['note','file'].includes(m.kind))fail('USE_SMARTDOC_FOR_DOCUMENT_MATERIALS');
                        else if(m.kind==='smartdoc'&&!getDocument(p,m.documentId).versions.some(v=>v.revision===m.revision))fail('SMARTDOC_REVISION_NOT_FOUND');
                        else if (m.kind === 'attachment' && (!p.materials?.[m.sha256] || p.materials[m.sha256].size !== m.size))
                            fail('MATERIAL_NOT_FOUND');
                applyDefinition(p, a.definition);
                if(p.lifecycle)for(const n of p.graph.nodes)if(!Object.values(p.documents||{}).some(d=>d.nodeId===n.id)){
                    const doc=createDocument(p,n.title,'material',[],{stepId:n.stage,nodeId:n.id,parentId:p.lifecycle.handbookId});
                    const handbook=getDocument(p,p.lifecycle.handbookId);
                    editDocument(p,handbook.id,handbook.revision,[{op:'link',text:n.title,documentId:doc.id}],actor,false,'归档新增节点交付文档');
                }
                return { applied: true };
            }
            if (name === 'ci_material_put') {
                const size = Buffer.byteLength(a.text);
                if (size > 65536)
                    fail('MATERIAL_TOO_LARGE');
                if(p.lifecycle){
                    if(active(p))fail('RUN_ACTIVE_PLAN_LOCKED');
                    const doc=createDocument(p,a.name,'material',a.text.match(/[\s\S]{1,20000}/g)||[],{parentId:p.lifecycle.handbookId});
                    const parent=getDocument(p,p.lifecycle.handbookId);
                    editDocument(p,parent.id,parent.revision,[{op:'link',text:doc.title,documentId:doc.id}],actor,false,'归档导入材料');
                    return {material:{kind:'smartdoc',name:doc.title,documentId:doc.id,revision:doc.revision},applied:true};
                }
                p.materials ??= {};
                const sha256 = digest(a.text);
                if (!p.materials[sha256] && Object.keys(p.materials).length >= 16)
                    fail('MATERIAL_LIMIT');
                p.materials[sha256] = { name: a.name, content: a.text, sha256, size, type: 'text/plain' };
                event(p, 'material.stored', { sha256, name: a.name, size });
                return { material: { kind: 'attachment', name: a.name, sha256, size, type: 'text/plain' }, applied: true };
            }
            if (name === 'ci_plan_save') {
                if (active(p))
                    fail('RUN_ACTIVE_PLAN_LOCKED');
                p.title = a.title;
                p.goal = a.goal;
                p.budget = a.budget;
                p.type = a.type;
                const d = definition(p.graph);
                const product = d.nodes.find(n => n.id === 'product-spec') || d.nodes.find(n => n.kind === 'product');
                if (product)
                    product.config.goal = a.goal;
                applyDefinition(p, definitionSchema.parse(d));
                return { applied: true };
            }
            if (name === 'ci_ai_consent') {
                if (a.grant && active(p))
                    fail('RUN_ACTIVE_PLAN_LOCKED');
                if (a.grant && a.recipient !== process.env.CI_AI_MCP_URL && !(codingCapability().available&&a.recipient===codingCapability().recipient))
                    fail('AI_RECIPIENT_MISMATCH');
                p.consent = a.grant ? { recipient: a.recipient, categories: a.categories, grantedAt: new Date().toISOString() } : undefined;
                event(p, 'ai.consent', { granted: a.grant, recipient: a.recipient });
                return { applied: true };
            }
            if (name === 'ci_run_command') {
                let r = active(p);
                if (a.action === 'start') {
                    if (r)
                        fail('RUN_ALREADY_ACTIVE');
                    const childRevisions:Record<string,number>={};
                    const ids = a.nodeIds || p.graph.nodes.filter(n => !['succeeded'].includes(n.status)).map(n => n.id);
                    if (!ids.length)
                        fail('NO_PENDING_NODES');
                    ids.forEach((id: string) => G.get(p.graph, id));
                    if(p.lifecycle){
                        for(const id of ids){const node=G.get(p.graph,id);if(!a.auto)stepAdmission(p,node);}
                        if(ids.some((id:string)=>p.graph.stages.findIndex(s=>s.id===G.get(p.graph,id).stage)>p.graph.stages.findIndex(s=>s.id==='requirements'))&&p.lifecycle.kind==='version'){
                            if(!p.lifecycle.children.length)fail('REQUIREMENTS_NOT_DEFINED');
                            for(const child of p.lifecycle.children){const value=await this.store.get(child.projectId,actor);if(!requirementsDelivered(value))fail('REQUIREMENTS_NOT_DELIVERED');childRevisions[value.id]=value.version;}
                            if(ids.some((id:string)=>G.get(p.graph,id).stage==='release')){const report=G.get(p.graph,'regression-report').attempts.at(-1),run=p.runs.find(r=>r.id===report?.runId);if(!run?.childRevisions||Object.entries(childRevisions).some(([id,version])=>run.childRevisions![id]!==version))fail('REGRESSION_CHILD_INPUT_CHANGED');}
                        }
                    }
                    if(ids.some((id:string)=>G.get(p.graph,id).config.tools.some(isCodingTool))&&ids.length!==1)fail('CODING_REQUIRES_SINGLE_TASK_RUN');
                    for(const id of ids)for(const dep of G.get(p.graph,id).depends){const upstream=G.get(p.graph,dep);if(upstream.config.tools.some(isCodingTool)&&upstream.status==='succeeded'&&!p.events.some(e=>e.type==='coding.patch_applied'&&e.detail.nodeId===upstream.id&&e.detail.attempt===upstream.attempts.at(-1)?.id))fail('CODING_PATCH_NOT_APPLIED');}
                    if (!a.auto && ids.some((id: string) => !G.ready(p.graph, G.get(p.graph, id))))
                        fail('UPSTREAM_NOT_READY');
                    r = { id: uid(), projectId: p.id, revision: p.graph.revision, graphDigest: digest(definition(p.graph)), sourceDigest: (await sourceManifest(p.graph)).digest,...(Object.keys(childRevisions).length?{childRevisions}:{}), status: 'queued', auto: a.auto ?? true, selected: ids, budget: p.budget, spent: 0, startedAt: new Date().toISOString(), decisionScope: 'development', jobs: [], commands: [] };
                    p.runs.push(r);
                }
                else if (!r)
                    fail('NO_ACTIVE_RUN');
                if (['approve', 'reject', 'stop-node'].includes(a.action)) {
                    const n = G.get(p.graph, a.nodeId || '');
                    const attempt = n.attempts.at(-1);
                    if (!attempt || attempt.runId !== r.id || (!['running', 'awaiting_review'].includes(n.status)))
                        fail('ATTEMPT_NOT_ACTIVE');
                    if (a.inputDigest !== attempt.inputDigest)
                        fail('APPROVAL_STALE');
                    if (a.action !== 'stop-node' && n.kind !== 'approval')
                        fail('NOT_DECISION_NODE');
                }
                r.commands.push({ id: a.commandId, action: a.action, nodeId: a.nodeId, inputDigest: a.inputDigest, applied: false });
                event(p, 'command.accepted', { commandId: a.commandId, runId: r.id, action: a.action });
                await c.query('INSERT INTO ci_outbox(id,run_id,project_id) VALUES($1,$2,$3)', [a.commandId, r.id, p.id]);
                return { accepted: true, commandId: a.commandId, runId: r.id };
            }
            fail('TOOL_NOT_ALLOWED');
        });
        if(mrWrite)return this.finishMROperation(a.projectId,a.commandId,actor);
        if(['ci_document_edit','ci_agent_document_edit','ci_document_create','ci_document_cloud_connect'].includes(name)&&Object.values(changed.project.documents||{}).some((d:any)=>d.cloud?.pending)){
            try{const synced=await synchronizeCloud(this.store,changed.project.id,actor);
                let agentPresence;
                if(name==='ci_agent_document_edit'&&synced.project.lifecycle?.agentEnabled){try{agentPresence=await announceAgent(synced.project.id,getDocument(synced.project,a.documentId),actor);}catch{agentPresence={connected:false,reason:'realtime-unavailable'};}}
                return {...changed,cloudSync:'accepted',...(agentPresence?{agentPresence}:{}),project:await this.present(synced.project,actor)};}
            catch{return {...changed,cloudSync:'pending',project:await this.present(changed.project,actor)};}
        }
        return {...changed,project:await this.present(changed.project,actor)};
    }
}
