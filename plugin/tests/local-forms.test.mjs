import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/local-forms.js',import.meta.url),'utf8');
function fixture(valid=true){const handlers={},events=[];let prevented=0;const form={reportValidity:()=>valid,dispatchEvent:e=>events.push(e)},button={type:'submit',form};vm.runInNewContext(source,{document:{addEventListener:(name,fn,capture)=>{assert.equal(capture,true);handlers[name]=fn;}},Event});return{handlers,events,form,button,event:{target:{closest:()=>button},preventDefault(){prevented++;}},prevented:()=>prevented};}
test('sandbox form click invokes local submit once and prevents native navigation',()=>{const f=fixture();f.handlers.click(f.event);assert.equal(f.prevented(),1);assert.equal(f.events.length,1);assert.equal(f.events[0].type,'submit');assert.equal(f.events[0].bubbles,true);assert.equal(f.events[0].cancelable,true);});
test('invalid and disabled forms cannot trigger a command',()=>{const f=fixture(false);f.handlers.click(f.event);assert.equal(f.events.length,0);f.button.disabled=true;f.handlers.click(f.event);assert.equal(f.prevented(),1);});
test('Enter submits a valid input but preserves textarea and IME composition',()=>{const f=fixture();const e={...f.event,key:'Enter',target:{tagName:'INPUT',type:'text',form:f.form}};f.handlers.keydown(e);f.handlers.keydown({...e,isComposing:true});f.handlers.keydown({...e,target:{tagName:'TEXTAREA',form:f.form}});assert.equal(f.events.length,1);});
