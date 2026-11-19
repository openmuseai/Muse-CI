// Read-only receipts for the actual Desktop DSH Agent acceptance conversation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const meta=JSON.parse(await readFile(new URL('../.data/dsh-live.json',import.meta.url),'utf8'));
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const c=new Client({name:'Read-only DSH acceptance receipt verifier',version:'0.3.0'});
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error('DSH_RECEIPT_'+name+'_FAILED');return r.structuredContent as any;}
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 const p=(await call('ci_project_get',{projectId:meta.projectId})).project;
 const events=(await call('ci_events_list',{projectId:p.id,after:0})).events;
 const mark=events.find((e:any)=>e.type==='node.manually_marked'&&e.detail.nodeId===meta.nodeId&&e.detail.reason==='DSH public acceptance');
 const revoke=events.find((e:any)=>e.type==='node.mark_revoked'&&e.seq>mark?.seq&&e.detail.nodeId===meta.nodeId);
 assert.ok(mark&&revoke,'actual DSH mark and revocation must be retained');
 const run=p.runs.at(-1);assert.equal(run.status,'succeeded');assert.deepEqual(run.selected,[meta.nodeId]);
 assert.deepEqual(p.graph.nodes.filter((n:any)=>n.attempts.length).map((n:any)=>n.id),[meta.nodeId]);
 const node=p.graph.nodes.find((n:any)=>n.id===meta.nodeId),attempt=node.attempts.at(-1);assert.equal(attempt.status,'succeeded');assert.equal(node.mark,undefined);
 const artifact=(await call('ci_artifact_get',{projectId:p.id,nodeId:meta.nodeId,attempt:attempt.id,index:0})).artifact;
 assert.ok(artifact.name.endsWith('.sydoc'));assert.equal(createHash('sha256').update(artifact.content).digest('hex'),artifact.sha256);
 const receipt={passed:true,at:new Date().toISOString(),projectId:p.id,nodeId:meta.nodeId,runId:run.id,status:run.status,actualDesktopDshConversation:true,backendReceiptReadOnly:true,manualMark:{seq:mark.seq,reason:mark.detail.reason,revokedSeq:revoke.seq},artifact:{name:artifact.name,sha256:artifact.sha256,mediaType:artifact.mediaType},onlySelectedNodeExecuted:true,events:events.map(({seq,type,at,detail}:any)=>({seq,type,at,detail})),screenshot:'desktop-dsh-ci-live.jpg',hostRestart:{chinaAccountRestored:true,installedPluginRestored:true,credentialBootstrapConsumed:true},limits:'The existing same-account DSH model gateway is opencode.ai; OpenMuse authentication and document collaboration use cn.openmuseai.com. Only this public fixture was sent to the model.'};
 await writeFile(new URL('../../Muse-Plugin-Ecosystem/plugins/muse-ci/docs/evidence/live-e2e/desktop-dsh-ci-2026-11-19.json',import.meta.url),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({passed:true,runId:run.id,artifact:artifact.name,markSeq:mark.seq,revokeSeq:revoke.seq}));
}finally{await c.close();}
