import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject,applyDefinition } from '../apps/api/service.ts';
import { initializeLifecycle,stepAdmission,markNode,invalidateDocumentConsumers,bindPublishedDocument,requirementsDelivered } from '../packages/lifecycle/model.ts';
import { createDocument,editDocument,getDocument,documentView,publishDocument,documentPin,nativeProjection } from '../packages/documents/smartdoc.ts';
import { G } from '../packages/contracts/graph.ts';
import { execute } from '../packages/providers/index.ts';
import {tick,complete} from '../packages/policy/engine.ts';
import { definitionSchema } from '../packages/contracts/index.ts';
import {uid} from '../apps/api/store.ts';
const actor={id:'owner'};
const make=async(kind:'version'|'requirement'='version')=>initializeLifecycle(await newProject(actor,'Lifecycle','范围与验收'),'version'===kind?'version':'requirement','1.0.2');
test('version and requirement templates are separate ordered Steps with native SmartDoc handbooks',async()=>{
 const v=await make(),r=await make('requirement');assert.equal(v.graph.stages.length,5);assert.equal(r.graph.stages.length,5);
 assert.ok(v.graph.nodes.some(n=>n.id==='regression-cases'));assert.ok(r.graph.nodes.some(n=>n.id==='feature-prd'));
 for(const p of[v,r]){assert.equal(G.validate(p.graph),true);for(const n of p.graph.nodes)assert.ok(n.depends.every(id=>G.get(p.graph,id).stage===n.stage));
 const file=documentView(p,p.lifecycle!.handbookId).nativeFile;const native=JSON.parse(file.content);assert.deepEqual(Object.keys(native).sort(),['docState','objectId','profile']);assert.ok(nativeProjection(native).some((b:any)=>b.runs.some((run:any)=>run.attributes?.href?.startsWith('muse://ci/'))));}
});
test('human and delegated Agent edit distinct native blocks, retain history and reject stale writers',async()=>{
 const p=await make(),d=createDocument(p,'材料','material',['original']);const first=documentView(p,d.id);const block=first.blocks.find((b:any)=>b.text==='original');
 editDocument(p,d.id,1,[{op:'append',text:'Agent proposal'}],actor,true,'补充边界');
 const before=d.body.docState;assert.throws(()=>editDocument(p,d.id,1,[{op:'replace',blockId:block.id,text:'erase'}],actor,false,'过期写入'),/SMARTDOC_REVISION_CONFLICT/);assert.equal(d.body.docState,before);
 editDocument(p,d.id,2,[{op:'replace',blockId:block.id,text:'Human clarified scope'}],actor,false,'细化范围');const texts=documentView(p,d.id).blocks.map((b:any)=>b.text);assert.ok(texts.includes('Agent proposal'));assert.ok(texts.includes('Human clarified scope'));assert.equal(d.versions[1].role,'agent');assert.equal(d.versions[1].onBehalfOf,'owner');assert.equal(d.versions[2].role,'human');
 assert.ok(documentView(p,d.id,1).blocks.some((b:any)=>b.text==='original'));
});
test('Agent access revocation rejects new edits and broken links do not partially write',async()=>{
 const p=await make(),d=getDocument(p,p.lifecycle!.handbookId),before=d.body.docState;p.lifecycle!.agentEnabled=false;
 assert.throws(()=>editDocument(p,d.id,d.revision,[{op:'append',text:'agent'}],actor,true,'edit'),/AGENT_COLLABORATION_REVOKED/);
 assert.throws(()=>editDocument(p,d.id,d.revision,[{op:'append',text:'partial'},{op:'link',text:'missing',documentId:'missing'}],actor,false,'bad link'),/SMARTDOC_NOT_FOUND/);assert.equal(d.body.docState,before);
});
test('manual mark is distinct from success, attributed and cannot replace missing deliverables',async()=>{
 const p=await make();markNode(p,'version-scope',true,'已由人工核对范围',actor);const node=G.get(p.graph,'version-scope');assert.equal(node.status,'marked');assert.equal(node.attempts.length,0);assert.equal(node.mark!.actor,'owner');assert.equal(G.ready(p.graph,G.get(p.graph,'version-ui')),true);assert.throws(()=>stepAdmission(p,G.get(p.graph,'version-ui')),/STEP_DELIVERABLES_MISSING/);
 markNode(p,node.id,false,'需要补充验收约束',actor);assert.equal(node.status,'pending');assert.equal(node.mark,undefined);assert.ok(p.events.some(e=>e.type==='node.mark_revoked'));
});
test('published native inputs are immutable pins and editing invalidates old results and marks',async()=>{
 const p=await make(),d=Object.values(p.documents!).find(d=>d.nodeId==='version-scope')!;publishDocument(p,d.id,d.revision);bindPublishedDocument(p,d.id);const pin=documentPin(p,d.id,d.revision);
 const downstream=G.get(p.graph,'version-ui');downstream.status='succeeded';downstream.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'test',logs:[],artifacts:[]});
 editDocument(p,d.id,d.revision,[{op:'append',text:'changed acceptance'}],actor,true,'补充验收');invalidateDocumentConsumers(p,d.id);
 assert.equal(downstream.status,'stale');assert.equal(downstream.attempts.length,1);assert.throws(()=>documentPin(p,d.id,d.revision),/SMARTDOC_NOT_PUBLISHED/);assert.notEqual(pin.content,JSON.stringify(d.body));
});
test('Step barriers block cross-step execution and no cross-step node edge can be saved',async()=>{
 const p=await make();assert.equal(G.ready(p.graph,G.get(p.graph,'version-ui')),false);assert.throws(()=>G.connect(p.graph,'version-scope','version-ui'),/同一个 Step/);
 const def={stages:p.graph.stages,nodes:p.graph.nodes.map(({id,title,stage,kind,depends,config})=>({id,title,stage,kind,depends,config}))};def.nodes.find(n=>n.id==='version-ui')!.depends=['version-scope'];assert.throws(()=>applyDefinition(p,definitionSchema.parse(def)),/CROSS_STEP/);
});
test('native publication uses accepted SmartDoc bytes, not Markdown disguised with an extension',async()=>{
 const p=await make(),d=Object.values(p.documents!).find(d=>d.nodeId==='version-scope')!;publishDocument(p,d.id,d.revision);bindPublishedDocument(p,d.id);const node=G.get(p.graph,'version-scope');const pin=documentPin(p,d.id,d.revision);
 const output=await execute(node,{id:1,status:'running',revision:1,inputDigest:'test',startedAt:'test',inputSnapshot:{boundMaterials:[pin]},logs:[],artifacts:[]},undefined,new AbortController().signal);assert.equal(output.status,'succeeded');const native=JSON.parse(output.artifacts[0].content);assert.equal(native.profile,'muse.smart-document/phase1');assert.ok(nativeProjection(native).length);
});
test('unpublished document fails admission without a phantom running job',async()=>{
 const p=await make();const r:any={id:uid(),projectId:p.id,revision:1,graphDigest:'test',status:'queued',auto:false,selected:['version-scope'],budget:20,spent:0,startedAt:'test',decisionScope:'development',jobs:[],commands:[{id:uid(),action:'start',applied:false}]};p.runs.push(r);tick(p,r.id);assert.equal(r.status,'failed');assert.equal(G.get(p.graph,'version-scope').status,'failed');assert.ok(G.get(p.graph,'version-scope').attempts[0].logs.some(l=>l.text==='SMARTDOC_NOT_PUBLISHED'));
});
test('MR merge and channel publish cannot be manufactured with marked nodes or prose',async()=>{
 const p=await make('requirement');p.graph.nodes.forEach(n=>n.status='marked');assert.equal(requirementsDelivered(p),false);assert.throws(()=>stepAdmission(p,G.get(p.graph,'mr-merge')),/USE_MR_RECEIPT_VERIFICATION/);
});

test('shared material edits invalidate every consumer and their following Steps',async()=>{
 const p=await make('requirement'),doc=createDocument(p,'Shared input','material',['base']);
 const n=G.get(p.graph,'feature-solution');n.config.materials=[{kind:'smartdoc',name:doc.title,documentId:doc.id,revision:1}];n.status='marked';n.mark={actor:'owner',reason:'reviewed',at:'test',revision:1,previousStatus:'pending'};
 const downstream=G.get(p.graph,'feature-cases');downstream.status='succeeded';downstream.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'test',logs:[],artifacts:[]});
 editDocument(p,doc.id,1,[{op:'append',text:'scope changed'}],actor,false,'new scope');invalidateDocumentConsumers(p,doc.id);assert.equal(n.status,'stale');assert.equal(n.mark,undefined);assert.equal(downstream.status,'stale');
});
test('reversing a same-Step mark invalidates the dependent result without rewriting its attempt',async()=>{
 const p=await make(),n=G.get(p.graph,'regression-report');n.status='succeeded';n.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'test',logs:[],artifacts:[]});
 markNode(p,'regression-cases',true,'manual scope check',actor);assert.equal(n.status,'stale');assert.equal(n.attempts[0].status,'succeeded');
});

test('an unexecuted custom node may be removed while its native document remains archived',async()=>{
 const p=await make(),n=G.add(p.graph,'test','definition'),doc=createDocument(p,'Custom evidence','material',[],{nodeId:n.id,stepId:n.stage,parentId:p.lifecycle!.handbookId});
 const def=definitionSchema.parse({stages:p.graph.stages,nodes:p.graph.nodes.filter(x=>x.id!==n.id).map(({id,title,stage,kind,depends,config})=>({id,title,stage,kind,depends,config}))});applyDefinition(p,def);assert.equal(doc.nodeId,undefined);assert.equal(doc.archivedFromNode,n.id);assert.ok(p.documents![doc.id]);
});
test('deleting a node with execution history is rejected without erasing its evidence',async()=>{
 const p=await make(),n=G.add(p.graph,'test','definition');n.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'test',logs:[],artifacts:[]});
 const def=definitionSchema.parse({stages:p.graph.stages,nodes:p.graph.nodes.filter(x=>x.id!==n.id).map(({id,title,stage,kind,depends,config})=>({id,title,stage,kind,depends,config}))});assert.throws(()=>applyDefinition(p,def),/NODE_WITH_HISTORY/);assert.equal(G.get(p.graph,n.id).attempts.length,1);
});
test('a live cloud input change fails the active Run instead of allowing a stale success',async()=>{
 const p=await make('requirement'),n=G.get(p.graph,'feature-prd'),doc=Object.values(p.documents!).find(d=>d.nodeId===n.id)!;
 const now=new Date().toISOString(),runId=uid();n.status='running';n.attempts.push({id:1,status:'running',revision:n.revision,runId,inputSnapshot:{},startedAt:now,logs:[],artifacts:[],lease:'lease',leaseUntil:Date.now()+10000});
 p.runs.push({id:runId,projectId:p.id,revision:1,graphDigest:'test',status:'running',auto:false,selected:[n.id],budget:10,spent:1,startedAt:now,decisionScope:'development',jobs:[{nodeId:n.id,attempt:1,completed:false}],commands:[]});
 invalidateDocumentConsumers(p,doc.id);assert.equal(n.status,'stale');assert.equal(n.attempts[0].status,'failed');assert.equal(n.attempts[0].lease,undefined);assert.equal(p.runs[0].status,'failed');assert.equal(p.runs[0].jobs[0].completed,true);assert.equal(tick(p,runId).status,'failed');
});
test('rerunning previously successful ordered Steps rechecks admission after each invalidation',async()=>{
 const p=await make('requirement');
 for(const d of Object.values(p.documents!)){publishDocument(p,d.id,d.revision);bindPublishedDocument(p,d.id);}
 for(const n of p.graph.nodes){n.status='succeeded';n.attempts.push({id:1,status:'succeeded',revision:n.revision,inputSnapshot:{},startedAt:'old',logs:[],artifacts:[]});}
 const r:any={id:uid(),projectId:p.id,revision:1,graphDigest:'test',status:'queued',auto:true,selected:p.graph.nodes.filter(n=>!n.id.startsWith('mr-')).map(n=>n.id),budget:50,spent:0,startedAt:'test',decisionScope:'development',jobs:[],commands:[{id:uid(),action:'start',applied:false}]};p.runs.push(r);
 const first=tick(p,r.id);assert.deepEqual(first.jobs.map(j=>j.nodeId),['feature-prd']);assert.equal(G.get(p.graph,'feature-ui').attempts.length,1);assert.notEqual(G.get(p.graph,'feature-ui').status,'failed');
 const n=G.get(p.graph,'feature-prd');complete(p,r,n,n.attempts.at(-1)!,'succeeded',[]);
 const second=tick(p,r.id);assert.ok(second.jobs.some(j=>j.nodeId==='feature-ui'));assert.equal(G.get(p.graph,'feature-ui').status,'running');
});
