import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/lifecycle.js',import.meta.url),'utf8');
test('Desktop inline document opens its real SmartDoc in the workspace without automatically connecting cloud',async()=>{
 const calls=[],opened=[];
 const result={projectVersion:1,document:{id:'d1',title:'Architecture',kind:'solution',revision:1,publishedRevision:1},tree:{native:true},nativeFile:{content:'fixed native bytes'}};
 const context=vm.createContext({CIRuntime:{project:{id:'v1',version:1,lifecycle:{documents:[{id:'d1',revision:1}]}},hasNativeEditor:()=>true,call:async(name,args)=>{calls.push({name,args});assert.equal(name,'ci_document_get');return result;}},CISmartDoc:{open:async value=>opened.push(value)},document:{addEventListener(){}},addEventListener(){}});
 vm.runInContext(source,context);
 await context.CILifecycle.openDocument('d1','v1',undefined,{inline:true});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'ci_document_get');assert.equal(opened[0].title,'Architecture');assert.equal(opened[0].nativeFile,result.nativeFile);
});
