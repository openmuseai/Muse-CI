// Authorized public acceptance documents only. Uses the real CN native store.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir}from'node:fs/promises';
import {Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const meta=JSON.parse(await readFile(new URL('../.data/cloud-acceptance.json',import.meta.url),'utf8'));
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const c=new Client({name:'CI Agent native child collaboration acceptance',version:'0.3.0'});
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(x=>x.type==='text').map((x:any)=>x.text).join('\n'));return r.structuredContent as any;}
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 let p=(await call('ci_project_get',{projectId:meta.projectId})).project;
 const created=await call('ci_document_create',{projectId:p.id,parentId:meta.documentId,title:'CI Agent 子文档协作验收',expectedVersion:p.version,commandId:'native-child-acceptance-2026-11-19'});
 const childId=created.documentId;
 let d=await call('ci_document_get',{projectId:p.id,documentId:childId});
 if(!d.blocks.some((b:any)=>b.text.includes('NATIVECHILDLIVE'))){
  await call('ci_agent_document_edit',{projectId:p.id,documentId:childId,expectedVersion:d.projectVersion,expectedRevision:d.document.revision,commandId:'native-child-content-2026-11-19',summary:'创建子文档的可复核验收材料',edits:[{op:'append',text:'NATIVECHILDLIVE：这是 PRD 的原生子文档。CI Agent 受现有国内成员委托构建材料；Desktop 与 Mobile 应能沿账号绑定引用打开此文档。'}]});
 }
 p=(await call('ci_project_get',{projectId:p.id})).project;
 const connected=await call('ci_document_cloud_connect',{projectId:p.id,documentId:meta.documentId,expectedVersion:p.version,commandId:'native-child-connect-2026-11-19'});
 assert.equal(connected.cloudSync,'accepted');
 const parent=await call('ci_document_get',{projectId:p.id,documentId:meta.documentId});
 d=await call('ci_document_get',{projectId:p.id,documentId:childId});
 assert.equal(d.document.cloud.parentViewId,parent.document.cloud.viewId);
 assert.ok(parent.blocks.some((b:any)=>b.runs.some((r:any)=>r.attributes?.href===d.resourceUri)));
 assert.ok(parent.blocks.some((b:any)=>b.text.includes(meta.expectedDesktopText)));
 const reply=await call('ci_agent_document_edit',{projectId:p.id,documentId:childId,expectedVersion:d.projectVersion,expectedRevision:d.document.revision,commandId:'native-child-agent-cloud-2026-11-19',summary:'在原生子文档完成真实云协作与在线回应',edits:[{op:'append',text:'CI Agent 子文档云端回复已通过原始 Document0/full-sync 和 WS2。'}]});
 assert.equal(reply.cloudSync,'accepted');assert.equal(reply.agentPresence?.connected,true);
 d=await call('ci_document_get',{projectId:p.id,documentId:childId});
 const out=new URL('../../Muse-Plugin-Ecosystem/plugins/muse-ci/docs/evidence/live-e2e/smartdoc-live-archive/',import.meta.url);await mkdir(out,{recursive:true});
 for(const [name,doc] of [['parent-prd',parent],['agent-child',d]] as const)await writeFile(new URL(name+'.sydoc',out),doc.nativeFile.content);
 const receipt={passed:true,at:new Date().toISOString(),projectId:p.id,parentDocumentId:meta.documentId,childDocumentId:childId,parentResourceUri:parent.resourceUri,childResourceUri:d.resourceUri,childCloudParentMatchesNativeParent:true,parentLinkIsNativeAccountBound:true,desktopContributionPreserved:true,agentCloudSync:reply.cloudSync,agentRealtimeConnected:true,archive:{parent:'parent-prd.sydoc',child:'agent-child.sydoc'},identity:'existing CN member delegated to CI Agent'};
 await writeFile(new URL('INDEX.json',out),JSON.stringify(receipt,null,2));await writeFile(new URL('../.data/native-child-live.json',import.meta.url),JSON.stringify(receipt,null,2),{mode:0o600});
 console.log(JSON.stringify({passed:true,childDocumentId:childId,cloudSync:reply.cloudSync,agentRealtimeConnected:true}));
}finally{await c.close();}
