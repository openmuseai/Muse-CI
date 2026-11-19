import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/client';
import { Store, uid } from '../apps/api/store.ts';
export async function lifecycleE2E(client:Client,database:string,pass:(message:string)=>void){
 const call=async(name:string,args:any={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content.map((c:any)=>c.text||'').join('\n'));return r.structuredContent as any;};
 const get=async(id:string)=>(await call('ci_project_get',{projectId:id})).project;
 const mutate=async(p:any,name:string,args:any)=>call(name,{projectId:p.id,expectedVersion:p.version,commandId:uid(),...args});
 const create={kind:'version',title:'Lifecycle E2E',goal:'版本与子需求分离、SmartDoc协作及真实发布快照',versionName:'0.2',commandId:uid()};
 const [one,two]=await Promise.all([call('ci_lifecycle_create',create),call('ci_lifecycle_create',create)]);let parent=one.project;assert.equal(parent.id,two.project.id);assert.equal(parent.lifecycle.kind,'version');
 const split={projectId:parent.id,expectedVersion:parent.version,commandId:uid(),title:'Independent requirement',goal:'详细需求、UI、方案、用例、报告和MR'};
 const child=await call('ci_requirement_create',split);const replay=await call('ci_requirement_create',split);assert.equal(replay.childProjectId,child.childProjectId);parent=child.project;assert.equal(parent.lifecycle.children.length,1);
 let p=await get(child.childProjectId);assert.equal(p.lifecycle.parentId,parent.id);assert.ok(!parent.graph.nodes.some((n:any)=>p.graph.nodes.some((c:any)=>c.id===n.id)));
 pass('lifecycle: version and idempotent independent requirement have separate canvases and native handbooks');
 const prd=p.lifecycle.documents.find((d:any)=>d.nodeId==='feature-prd');
 const read=async(id=prd.id)=>(await call('ci_document_get',{projectId:p.id,documentId:id}));
 let d=await read();const base={projectId:p.id,expectedVersion:p.version,documentId:prd.id,expectedRevision:d.document.revision,summary:'parallel contribution'};
 const attempts=await Promise.allSettled([call('ci_agent_document_edit',{...base,commandId:uid(),edits:[{op:'append',text:'Agent covers exception and permission boundaries.'}]}),call('ci_document_edit',{...base,commandId:uid(),edits:[{op:'append',text:'Human acceptance criteria.'}]})]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.ok(attempts.some(r=>r.status==='rejected'&&String(r.reason).includes('REVISION_CONFLICT')));
 p=await get(p.id);d=await read();await mutate(p,'ci_agent_document_edit',{documentId:prd.id,expectedRevision:d.document.revision,summary:'Agent contributes after revision reconciliation',edits:[{op:'append',text:'Agent contributes measurable acceptance.'}]});p=await get(p.id);d=await read();assert.equal(d.document.versions.at(-1).role,'agent');assert.ok(d.document.versions.at(-1).onBehalfOf);
 await assert.rejects(mutate(p,'ci_document_edit',{documentId:prd.id,expectedRevision:1,summary:'stale overwrite',edits:[{op:'append',text:'cannot silently overwrite'}]}),/SMARTDOC_REVISION_CONFLICT/);
 const exported=JSON.parse(d.nativeFile.content);assert.equal(exported.profile,'muse.smart-document/phase1');assert.ok(exported.docState);assert.ok(d.blocks.some((b:any)=>b.text.includes('Agent contributes')));
 pass('lifecycle: real native SmartDoc preserves human/Agent revisions and rejects stale concurrent writers');
 p=(await mutate(p,'ci_document_publish',{documentId:prd.id,expectedRevision:d.document.revision})).project;
 const configured=await mutate(p,'ci_step_config_create',{stepId:'prd'});p=configured.project;
 const configDoc=await read(configured.documentId);
 p=(await mutate(p,'ci_document_publish',{documentId:configured.documentId,expectedRevision:configDoc.document.revision})).project;
 assert.equal(p.stepConfigurations.prd.publishedRevision,configDoc.document.revision);
 pass('lifecycle: a published native Step document compiles the execution configuration');
 const launched=await mutate(p,'ci_run_command',{action:'start',nodeIds:['feature-prd'],auto:false});
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){p=await get(p.id);if(p.graph.nodes.find((n:any)=>n.id==='feature-prd').status==='succeeded')break;await new Promise(r=>setTimeout(r,200));}
 const node=p.graph.nodes.find((n:any)=>n.id==='feature-prd');assert.equal(node.status,'succeeded');assert.ok(p.runs.some((r:any)=>r.id===launched.runId));
 const artifact=(await call('ci_artifact_get',{projectId:p.id,nodeId:node.id,attempt:1,index:0})).artifact;assert.equal(JSON.parse(artifact.content).profile,'muse.smart-document/phase1');assert.equal(artifact.producer,'smartdoc.snapshot');
 // Wait for terminal Run before allowing document or mark mutations.
 while(Date.now()<deadline){p=await get(p.id);if(p.runs.at(-1).status==='succeeded')break;await new Promise(r=>setTimeout(r,200));}
 pass('lifecycle: actual Temporal worker archives a published native SmartDoc input as an immutable artifact');
 const resource=(await client.listResources()).resources.find(r=>(r as any)._meta?.sha256===artifact.sha256);assert.ok(resource);
 const nativeResource=await client.readResource({uri:resource!.uri});assert.equal((nativeResource.contents[0] as any).text,artifact.content);
 assert.equal(node.attempts[0].inputSnapshot.stepConfiguration.documentId,configured.documentId);
 pass('lifecycle: digest-pinned MCP data reads original artifact bytes and Run pins the native Step snapshot');
 p=(await mutate(p,'ci_node_mark',{nodeId:'feature-ui',marked:true,reason:'人工复核UI仍需归档'})).project;assert.equal(p.graph.nodes.find((n:any)=>n.id==='feature-ui').status,'marked');
 await assert.rejects(mutate(p,'ci_run_command',{action:'start',nodeIds:['feature-solution'],auto:false}),/STEP_DELIVERABLES_MISSING/);
 await assert.rejects(mutate(await get(parent.id),'ci_run_command',{action:'start',nodeIds:['regression-cases'],auto:true}),/REQUIREMENTS_NOT_DELIVERED/);
 p=(await mutate(p,'ci_agent_access',{enabled:false})).project;d=await read();await assert.rejects(mutate(p,'ci_agent_document_edit',{documentId:prd.id,expectedRevision:d.document.revision,summary:'revoked contribution',edits:[{op:'append',text:'not authorized'}]}),/AGENT_COLLABORATION_REVOKED/);
 pass('lifecycle: manual marks cannot invent deliverables or child completion, and Agent collaboration can be revoked');
 p=await get(p.id);const before=await read(configured.documentId);const block=before.blocks.find((b:any)=>b.type==='code');const next=JSON.parse(block.text);next.goal='changed after the pinned Run';
 p=(await mutate(p,'ci_document_edit',{documentId:configured.documentId,expectedRevision:before.document.revision,summary:'Configuration edit must invalidate old execution',edits:[{op:'replace',blockId:block.id,text:JSON.stringify(next)}]})).project;
 await assert.rejects(mutate(p,'ci_run_command',{action:'start',nodeIds:['feature-prd'],auto:false}),/STEP_CONFIG_NOT_PUBLISHED/);
 assert.equal((await call('ci_artifact_get',{projectId:p.id,nodeId:'feature-prd',attempt:1,index:0})).artifact.content,artifact.content);
 pass('lifecycle: configuration drafts block new execution while historical document artifacts remain unchanged');
 const store=new Store(database);
 try{
  const before=(await call('ci_projects_list')).projects.length;
  await store.mutate(parent.id,undefined,undefined,undefined,{},project=>{const doc=project.documents![project.lifecycle!.handbookId];doc.versions=Array.from({length:100},()=>structuredClone(doc.versions.at(-1)!));return {};});
  parent=await get(parent.id);
  await assert.rejects(mutate(parent,'ci_requirement_create',{title:'Must roll back',goal:'Fault injection: full handbook history'}),/SMARTDOC_HISTORY_LIMIT/);
  assert.equal((await call('ci_projects_list')).projects.length,before);
 }finally{await store.close();}
 pass('lifecycle: failed parent handbook archival rolls back child creation in the same PostgreSQL transaction');
}
