import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const context={};vm.runInNewContext(await readFile(new URL('../web/smartdoc-view.js',import.meta.url),'utf8'),context);
test('the SmartDoc snapshot reader renders structure and marks without treating document text as HTML',()=>{
 const html=context.CISmartDoc.render({type:'page',children:[{type:'heading',data:{level:2,delta:[{insert:'A <script>bad</script>'}]}},{type:'paragraph',data:{delta:[{insert:'bold',attributes:{bold:true}},{insert:'link',attributes:{href:'javascript:alert("bad")'}}]}},{type:'code',data:{delta:[{insert:'<iframe src="bad">'}]}},{type:'image',data:{url:'https://private.example/token'}}]});
 assert.match(html,/<h2>A &lt;script&gt;/);assert.match(html,/<strong>bold<\/strong>/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('src="https://private'));assert.ok(!html.includes(' href='));
});
