import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../web/desktop-navigation.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(presentation='navigation'){
 const events={},documentEvents={},classes=new Map(),pane={innerHTML:'',contains(element){return element?.tagName==='SELECT';}},selections=[],opened=[];
 const runtime={ready:Promise.resolve(),connected:true,busy:false,project:{id:'v1'},async select(id){this.project={id};},async reconnect(){}};
 const bridge={input:{_openmuse:{presentation,navigation:{}}},async select(value){selections.push(value);}};
 const project={id:'p1',title:'<img src=x>',versions:[{id:'v1',title:'Version',hierarchy:{versionName:'1.0'}}]};
 const document={documentElement:{lang:'en',classList:{toggle(k,v){classes.set(k,v);}}},getElementById(){return pane;},addEventListener(k,f){documentEvents[k]=f;},body:{append(){}}};
 const context=vm.createContext({CIRuntime:runtime,CIBridge:{desktopNavigation:bridge},CIProjectNav:{enabled:true,catalog:{projects:[project],deliveries:[{id:'doc1',workflowId:'v1',kind:'solution',title:'<script>alert(1)</script>'},{id:'mr1',workflowId:'r1',kind:'mr',title:'Review MR'}]},project:()=>project,version:()=>project.versions[0]},CILifecycle:{async openDocument(id){opened.push(id);},async openRepository(){opened.push('repository');}},document,addEventListener(k,f){events[k]=f;},setTimeout,Date});
 vm.runInContext(source,context);await settle();
 return{runtime,pane,classes,selections,opened,refresh(){project.title='Updated catalog';events['ci:catalog']();},focusSelect(active){document.activeElement=active?{tagName:'SELECT'}:null;if(!active)documentEvents.focusout();},click(data){documentEvents.click({target:{closest(selector){return selector==='[data-desktop-document]'?{dataset:data}:null;}}});},input(selection){bridge.input={_openmuse:{presentation,navigation:selection}};events['ci:desktop-input']();}};
}

test('Desktop catalog uses real deliveries, escaping backend titles',async()=>{
 const h=await setup();assert.equal(h.classes.get('ci-desktop-navigation'),true);assert.match(h.pane.innerHTML,/&lt;img src=x&gt;/);assert.match(h.pane.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.pane.innerHTML,/<script>/);assert.match(h.pane.innerHTML,/data-kind="mr"/);
});

test('sidebar selection is UI-only and retains the MR delivery kind',async()=>{
 const h=await setup();h.click({desktopDocument:'mr1',workflow:'r1',kind:'mr'});await settle();assert.deepEqual(JSON.parse(JSON.stringify(h.selections)),[{projectId:'r1',documentId:'mr1',deliveryKind:'mr'}]);assert.deepEqual(h.opened,[]);
});

test('workspace drops superseded selections while another operation is busy',async()=>{
 const h=await setup('workspace');h.runtime.busy=true;h.input({projectId:'v1',documentId:'old'});h.input({projectId:'v1',documentId:'latest'});h.runtime.busy=false;await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(h.opened,['latest']);h.input({projectId:'v1',documentId:'mr1',deliveryKind:'mr'});await settle();assert.deepEqual(h.opened,['latest','repository']);
});

 test('live catalog updates preserve an open native selector until focus leaves',async()=>{const h=await setup();const before=h.pane.innerHTML;h.focusSelect(true);h.refresh();assert.equal(h.pane.innerHTML,before);h.focusSelect(false);await settle();assert.match(h.pane.innerHTML,/Updated catalog/);});
