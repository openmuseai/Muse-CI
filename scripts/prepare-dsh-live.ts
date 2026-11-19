import{readFile,writeFile}from'node:fs/promises';import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const c=new Client({name:'DSH live fixture setup',version:'0.3.0'});
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error('DSH_FIXTURE_'+name+'_FAILED');return r.structuredContent as any;}
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 let p=(await call('ci_lifecycle_create',{kind:'requirement',title:'DSH 会话 CI 节点与流水线验收',goal:'公开验收流程：仅验证 DSH 查询、标过/撤回、运行一个已发布 SmartDoc 快照节点及读取产物。',commandId:'dsh-native-ci-2026-11-19'})).project;
 const d=p.lifecycle.documents.find((d:any)=>d.nodeId==='feature-prd');let doc=await call('ci_document_get',{projectId:p.id,documentId:d.id});
 if(!doc.blocks.some((b:any)=>b.text.includes('DSH-CI-01'))){await call('ci_document_edit',{projectId:p.id,documentId:d.id,expectedVersion:p.version,expectedRevision:doc.document.revision,commandId:'dsh-public-cases-2026-11-19',summary:'明确仅操作本验收流程及单节点的范围',edits:[{op:'append',text:'DSH-CI-01：查询本流程；DSH-CI-02：标过 feature-prd 后撤回并保留事件；DSH-CI-03：只运行 feature-prd，读取原生 .sydoc 快照产物。固定范围：不操作其他项目、不运行后续节点、不提审或发布 App。'}]});p=(await call('ci_project_get',{projectId:p.id})).project;doc=await call('ci_document_get',{projectId:p.id,documentId:d.id});}
 if(doc.document.publishedRevision!==doc.document.revision)await call('ci_document_publish',{projectId:p.id,documentId:d.id,expectedVersion:p.version,expectedRevision:doc.document.revision,commandId:'dsh-publish-cases-2026-11-19'});
 const meta={projectId:p.id,title:p.title,nodeId:'feature-prd',documentId:d.id,at:new Date().toISOString()};await writeFile(new URL('../.data/dsh-live.json',import.meta.url),JSON.stringify(meta,null,2),{mode:0o600});console.log(JSON.stringify(meta));
}finally{await c.close();}
