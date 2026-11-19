import test from'node:test';import assert from'node:assert/strict';
import{CIService}from'../apps/api/service.ts';import type{Store}from'../apps/api/store.ts';
import{digest}from'../apps/api/store.ts';
const sha='a'.repeat(40),mergeSha='b'.repeat(40),repo={provider:'github',path:'example/project',sourceBranch:'source',baseBranch:'target'};
function fixture(){
 const node=(id:string)=>({id,title:id,stage:'merge',kind:'approval',revision:1,status:'pending',depends:id==='mr-merge'?['mr-review']:[],attempts:[],config:{tools:[],materials:[],skills:[],goal:id,description:'fixture',outputName:'receipt.json',timeout:1,retries:0}});
 let p:any={id:'project',title:'MR dispatch fixture',version:1,budget:10,members:{owner:'owner'},repository:repo,graph:{revision:1,stages:[{id:'merge',name:'Merge'}],nodes:[node('mr-review'),node('mr-merge')]},events:[],runs:[],mrOperations:{op:{status:'prepared',actor:'owner',at:new Date().toISOString(),repository:repo,action:{kind:'merge',number:7,expectedHeadSha:sha,marker:'fixture'}}}};
 let tail=Promise.resolve();
 const store={get:async()=>structuredClone(p),pool:{query:async()=>({rows:[{id:p.id}]})},mutate:async(_id:any,_actor:any,_version:any,_command:any,_args:any,fn:any)=>{let release!:()=>void;const before=tail;tail=new Promise<void>(r=>release=r);await before;try{const next=structuredClone(p),result=await fn(next);next.version++;p=next;return{project:structuredClone(p),...result};}finally{release();}}};
 return {service:new CIService(store as unknown as Store),state:()=>p};
}
async function environment(fn:(remote:{pending:boolean;merged:boolean;writes:number;pause?:()=>Promise<void>})=>Promise<void>){
 const keys=['CI_MR_REPOSITORIES','CI_MR_WRITE_REPOSITORIES','CI_GITHUB_TOKEN'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]])),fetch=globalThis.fetch;
 process.env.CI_MR_REPOSITORIES=process.env.CI_MR_WRITE_REPOSITORIES='github:example/project';process.env.CI_GITHUB_TOKEN='fake-unit-credential';
 const remote={pending:true,merged:false,writes:0,pause:undefined as undefined|(()=>Promise<void>)};
 globalThis.fetch=async(url,init)=>{const path=new URL(String(url)).pathname;let value:any={permissions:{push:true}};
  if(path==='/repos/example/project'&&remote.pause)await remote.pause();
  if(path.includes('/branches/'))value={commit:{sha}};
  else if(path.endsWith('/pulls/7'))value={state:remote.merged?'closed':'open',merged:remote.merged,draft:false,head:{sha,ref:'source',repo:{full_name:repo.path}},base:{ref:'target',repo:{full_name:repo.path}},merge_commit_sha:remote.merged?mergeSha:null,html_url:'https://github.com/example/project/pull/7'};
  else if(path.endsWith('/status'))value={statuses:[],state:'pending'};
  else if(path.endsWith('/check-runs'))value={total_count:1,check_runs:[{status:remote.pending?'in_progress':'completed',conclusion:remote.pending?null:'success'}]};
  else if(path.endsWith('/reviews'))value=[];
  else if(path.endsWith('/merge')){remote.writes++;assert.equal(JSON.parse(String(init?.body)).sha,sha);remote.merged=true;value={merged:true};}
  return new Response(JSON.stringify(value));
 };
 try{await fn(remote);}finally{globalThis.fetch=fetch;for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
}
test('pending checks retain a durable intent and a resumed dispatcher confirms the actual merge once',()=>environment(async remote=>{
 const f=fixture(),waiting=await f.service.finishMROperation('project','op',{id:'owner'});
 assert.equal(waiting.waiting,true);assert.equal(f.state().mrOperations.op.status,'prepared');assert.equal(f.state().mrOperations.op.waitingFor,'MR_CHECKS_PENDING');assert.equal(f.state().mrOperations.op.lease,undefined);assert.equal(remote.writes,0);
 remote.pending=false;delete f.state().mrOperations.op.nextAttemptAt;
 await f.service.drainMROperations();assert.equal(f.state().mrOperations.op.status,'confirmed');assert.equal(f.state().mergeRequest.mergeSha,mergeSha);assert.equal(remote.writes,1);
 await f.service.finishMROperation('project','op',{id:'owner'});assert.equal(remote.writes,1);
}));
test('concurrent manual reconciliation and dispatcher cannot deliver the same write in parallel',()=>environment(async remote=>{
 remote.pending=false;let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 remote.pause=async()=>{entered();await gate;};const f=fixture(),first=f.service.finishMROperation('project','op',{id:'owner'});await started;
 const second=await f.service.finishMROperation('project','op',{id:'owner'});assert.equal(second.waiting,true);assert.equal(remote.writes,0);release();await first;assert.equal(remote.writes,1);
}));
test('revoking the operation owner blocks a retained intent before any platform call',()=>environment(async remote=>{
 const f=fixture();f.state().members={};await f.service.drainMROperations();assert.equal(f.state().mrOperations.op.status,'blocked');assert.equal(f.state().mrOperations.op.error,'PROJECT_OWNER_REQUIRED');assert.equal(remote.writes,0);
}));
test('cancel stops a waiting intent and an in-flight delivery cannot be falsely canceled',()=>environment(async remote=>{
 const f=fixture();await f.service.finishMROperation('project','op',{id:'owner'});
 await f.service.call('ci_mr_cancel',{projectId:'project',operationId:'op',commandId:'cancel-1',expectedVersion:f.state().version},{id:'owner'});
 await f.service.drainMROperations();assert.equal(f.state().mrOperations.op.error,'MR_OPERATION_CANCELED');assert.equal(remote.writes,0);
 const g=fixture();g.state().mrOperations.op.lease='active';g.state().mrOperations.op.leaseUntil=new Date(Date.now()+60000).toISOString();
 await assert.rejects(g.service.call('ci_mr_cancel',{projectId:'project',operationId:'op',commandId:'cancel-2',expectedVersion:g.state().version},{id:'owner'}),/MR_OPERATION_IN_PROGRESS/);
 assert.equal(g.state().mrOperations.op.status,'prepared');
}));
test('ambiguous transport failures retain only a safe retry code and recover without another approval',()=>environment(async remote=>{
 const f=fixture();remote.pause=async()=>{throw Error('fake private transport detail');};
 const waiting=await f.service.finishMROperation('project','op',{id:'owner'});assert.equal(waiting.waitingFor,'MR_DELIVERY_UNCONFIRMED');assert.equal(JSON.stringify(f.state()).includes('private transport detail'),false);
 remote.pause=undefined;remote.pending=false;delete f.state().mrOperations.op.nextAttemptAt;await f.service.drainMROperations();assert.equal(f.state().mrOperations.op.status,'confirmed');assert.equal(remote.writes,1);
}));
test('a changed tested source blocks a retained merge before calling GitHub',()=>environment(async remote=>{
 const f=fixture(),p=f.state(),content=JSON.stringify({realExecution:true,exitCode:0});
 p.lifecycle={kind:'requirement'};p.graph.stages.unshift({id:'testing',name:'Testing'});
 p.graph.nodes.unshift({id:'feature-report',stage:'testing',status:'succeeded',revision:1,config:{tools:[],materials:[]},attempts:[{runId:'tested-run',status:'succeeded',revision:1,artifacts:[{producer:'ci-test',content,sha256:digest(content)}]}]});
 p.documents={report:{nodeId:'feature-report',revision:1,publishedRevision:1}};p.runs.push({id:'tested-run',status:'succeeded',sourceDigest:'old-source'});
 await assert.rejects(f.service.finishMROperation('project','op',{id:'owner'}),/MR_TEST_SOURCE_CHANGED/);assert.equal(f.state().mrOperations.op.status,'blocked');assert.equal(remote.writes,0);
}));
