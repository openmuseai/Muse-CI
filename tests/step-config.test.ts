import test from 'node:test';import assert from 'node:assert/strict';
import {newProject,applyDefinition} from '../apps/api/service.ts';
import {initializeLifecycle,bindPublishedDocument,stepAdmission,invalidateDocumentConsumers} from '../packages/lifecycle/model.ts';
import {createStepConfiguration,compileStepConfiguration,stepConfigDigest,stepConfigurationSnapshot} from '../packages/lifecycle/step-config.ts';
import {documentView,editDocument,publishDocument,nativeProjection} from '../packages/documents/smartdoc.ts';
import {artifactView} from '../packages/documents/artifacts.ts';import {digest}from'../apps/api/store.ts';
const actor={id:'owner'};
async function fixture(){const p=initializeLifecycle(await newProject(actor,'Step config','public fixture'),'requirement');for(const d of Object.values(p.documents!)){publishDocument(p,d.id,d.revision);bindPublishedDocument(p,d.id);}return p;}
function publish(p:any,d:any){applyDefinition(p,compileStepConfiguration(p,d.id));publishDocument(p,d.id,d.revision);p.stepConfigurations[d.stepId]={documentId:d.id,publishedRevision:d.revision,configDigest:stepConfigDigest(p,d.stepId)};}
function change(p:any,d:any,fn:(json:any)=>void){const code=nativeProjection(d.body).find((b:any)=>b.type==='code'),value=JSON.parse(code.text);fn(value);editDocument(p,d.id,d.revision,[{op:'replace',blockId:code.id,text:JSON.stringify(value)}],actor,true,'Agent configuration change');invalidateDocumentConsumers(p,d.id);}
test('native Step configuration remains a draft until compiled and pins original bytes',async()=>{
 const p=await fixture(),d=createStepConfiguration(p,'prd',actor),n=p.graph.nodes.find(n=>n.id==='feature-prd')!;
 assert.ok(documentView(p,d.id).tree.children.some((b:any)=>b.type==='code'));assert.throws(()=>stepAdmission(p,n),/STEP_CONFIG_NOT_PUBLISHED/);
 publish(p,d);stepAdmission(p,n);const pin=stepConfigurationSnapshot(p,'prd')!;assert.equal(JSON.parse(pin.content).profile,'muse.smart-document/phase1');
 change(p,d,v=>v.nodes[0].config.goal='Revised actual goal');assert.throws(()=>stepAdmission(p,n),/STEP_CONFIG_NOT_PUBLISHED/);assert.equal(pin.sha256,digest(pin.content));
 publish(p,d);assert.equal(p.graph.nodes.find(n=>n.id==='feature-prd')!.config.goal,'Revised actual goal');
});
test('configuration rejects unknown capabilities, node omissions and foreign Step scope atomically',async()=>{
 for(const [edit,code] of [[(v:any)=>v.nodes[0].config.tools=['arbitrary-shell'],'TOOL_UNTRUSTED'],[(v:any)=>v.nodes[0].config.skills=['unreviewed'],'SKILL_UNTRUSTED'],[(v:any)=>v.nodes[0].nodeId='feature-ui','NODE_COVERAGE'],[(v:any)=>v.stepId='design','SCOPE_MISMATCH']] as const){const p=await fixture(),d=createStepConfiguration(p,'prd',actor),before=digest(p.graph);change(p,d,edit);assert.throws(()=>compileStepConfiguration(p,d.id),new RegExp(code));assert.equal(digest(p.graph),before);}
});
test('graph drift cannot silently replace a published Step document',async()=>{
 const p=await fixture(),d=createStepConfiguration(p,'prd',actor);publish(p,d);p.graph.nodes.find(n=>n.stage==='prd')!.config.goal='bypass';assert.throws(()=>stepAdmission(p,p.graph.nodes[0]),/STEP_CONFIG_DRIFT/);
});
test('editing a Step invalidates all its consumers and later evidence without erasing attempts',async()=>{
 const p=await fixture(),d=createStepConfiguration(p,'testing',actor);for(const n of p.graph.nodes){n.status='succeeded';n.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'old',logs:[],artifacts:[]});}change(p,d,v=>v.goal='new scope');assert.equal(p.graph.nodes.find(n=>n.id==='feature-prd')!.status,'succeeded');for(const n of p.graph.nodes.filter(n=>['testing','merge'].includes(n.stage))){assert.equal(n.status,'stale');assert.equal(n.attempts[0].status,'succeeded');}
});
test('native artifact views retain historical bytes, rich text and digest-pinned MCP identity',async()=>{
 const p=await fixture(),d=Object.values(p.documents!).find(d=>d.nodeId==='feature-prd')!,v=documentView(p,d.id),content=v.nativeFile.content;
 p.graph.nodes[0].attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'old',logs:[],artifacts:[{name:'prd.sydoc',kind:v.nativeFile.mediaType,content,sha256:digest(content),producer:'smartdoc.snapshot',inputDigest:'test',createdAt:'old'}]});
 const before=artifactView(p,'feature-prd',1,0);editDocument(p,d.id,d.revision,[{op:'append',text:'later live change'}],actor,true,'Later content');const after=artifactView(p,'feature-prd',1,0);assert.equal(after.smartDocument!.nativeFile.content,before.smartDocument!.nativeFile.content);assert.ok(after.resourceLink.endsWith('.'+digest(content)));assert.ok(!JSON.stringify(after.smartDocument!.tree).includes('later live change'));
 p.graph.nodes[0].attempts[0].artifacts[0].content='tampered';assert.throws(()=>artifactView(p,'feature-prd',1,0),/ARTIFACT_INTEGRITY_FAILED/);
});
