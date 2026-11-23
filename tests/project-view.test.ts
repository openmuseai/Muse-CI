import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../apps/api/service.ts';
import {projectWithArtifactMetadata} from '../packages/documents/project-view.ts';
import {artifactView} from '../packages/documents/artifacts.ts';
import {digest} from '../apps/api/store.ts';
test('large retained execution artifacts stay out of the canvas while immutable retrieval remains complete',async()=>{
 const p=await newProject({id:'payload-test'},'Payload acceptance','Retain evidence');
 const node=p.graph.nodes[0],content='x'.repeat(1024*1024),sha256=digest(content);
 for(let id=1;id<=12;id++)node.attempts.push({id,status:'succeeded',revision:1,inputSnapshot:{pinnedRevision:id},startedAt:'test',logs:[{level:'info',text:'real retained log'}],artifacts:[{name:'report.json',kind:'application/json',content,sha256,producer:'ci-test',inputDigest:'input',createdAt:'test'}]});
 const view=projectWithArtifactMetadata(p),attempts=view.graph.nodes[0].attempts;
 assert.equal(attempts.length,12);assert.ok(Buffer.byteLength(JSON.stringify(view))<100000);
 assert.equal('content' in attempts[0].artifacts[0],false);assert.equal(attempts[0].artifacts[0].byteLength,1024*1024);
 assert.equal(attempts[0].artifacts[0].sha256,sha256);assert.deepEqual(attempts[0].inputSnapshot,{pinnedRevision:1});assert.equal(attempts[0].logs[0].text,'real retained log');
 assert.equal(node.attempts[0].artifacts[0].content,content);assert.equal(artifactView(p,node.id,1,0).artifact.content,content);assert.equal(artifactView(p,node.id,12,0).artifact.sha256,sha256);
});
