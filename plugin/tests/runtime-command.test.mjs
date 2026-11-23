import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=await readFile(new URL('../web/runtime.js',import.meta.url),'utf8');
async function embedded(crypto){
 const calls=[];let version=1;
 const context=vm.createContext({crypto,Uint8Array,URLSearchParams,location:{search:''},localStorage:{getItem(){return null},setItem(){}},CustomEvent:class{},dispatchEvent(){},setInterval(){},document:{documentElement:{classList:{add(){}}}},parent:{},CIBridge:{async connect(){return{platform:'mobile',async call(name,args){calls.push({name,args});if(name==='ci_capabilities')return{skills:[],tools:[]};if(name==='ci_projects_list')return{projects:[{id:'project',kind:'version'}]};if(name==='ci_node_mark')version++;return{project:{id:'project',version,events:[],graph:{nodes:[]}}};}};}}});
 vm.runInContext(source,context);await context.CIRuntime.ready;return{runtime:context.CIRuntime,calls};
}
test('embedded Mobile mutation works without secure-context randomUUID',async()=>{
 const {runtime,calls}=await embedded({getRandomValues:array=>webcrypto.getRandomValues(array)});
 await runtime.mutate('ci_node_mark',{nodeId:'node',marked:true,reason:'device acceptance'});
 await runtime.mutate('ci_node_mark',{nodeId:'node',marked:false,reason:'restore after acceptance'});
 const writes=calls.filter(x=>x.name==='ci_node_mark');assert.equal(writes.length,2);
 for(const {args}of writes)assert.match(args.commandId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.notEqual(writes[0].args.commandId,writes[1].args.commandId);assert.equal(writes[0].args.expectedVersion,1);assert.equal(writes[1].args.expectedVersion,2);
});
test('missing secure randomness prevents mutation before any write request',async()=>{
 const {runtime,calls}=await embedded({});await assert.rejects(runtime.mutate('ci_node_mark',{nodeId:'node',marked:true}),/SECURE_RANDOM_UNAVAILABLE/);assert.equal(calls.filter(x=>x.name==='ci_node_mark').length,0);
});
test('secure-context native UUID remains supported',async()=>{
 const id='c119c9e7-9075-4705-b760-e336b2f0848c';const {runtime,calls}=await embedded({randomUUID:()=>id});await runtime.mutate('ci_node_mark',{nodeId:'node',marked:true});assert.equal(calls.find(x=>x.name==='ci_node_mark').args.commandId,id);
});
test('late workflow reads cannot overwrite a newer project selection',async()=>{
 const {runtime}=await embedded(webcrypto);let finish;
 runtime.call=async(name,args)=>args.projectId==='old'?new Promise(resolve=>{finish=resolve;}):{project:{id:'new',version:1,events:[],graph:{nodes:[]}}};
 const old=runtime.select('old');await runtime.select('new');finish({project:{id:'old',version:1,events:[],graph:{nodes:[]}}});await old;assert.equal(runtime.project.id,'new');
});
test('context switching blocks writes before dispatching an old workflow command',async()=>{
 const {runtime,calls}=await embedded(webcrypto);runtime.switching=true;await assert.rejects(runtime.mutate('ci_node_mark',{nodeId:'old',marked:true}),/CONTEXT_SWITCHING/);assert.equal(calls.filter(c=>c.name==='ci_node_mark').length,0);
});
