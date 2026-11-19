import{readFile,writeFile}from'node:fs/promises';
import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const client=new Client({name:'Cloud native collaboration acceptance',version:'0.3.0'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
async function call(name:string,args:any):Promise<any>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(v=>v.type==='text').map(v=>v.text).join(' '));return r.structuredContent;}
try{
 const list=await call('ci_projects_list',{});const existing=list.projects.find((p:any)=>p.title==='SmartDoc 云端协作与 MR 全链路验收');
 let {project:p}=existing?await call('ci_project_get',{projectId:existing.id}):await call('ci_lifecycle_create',{kind:'requirement',title:'SmartDoc 云端协作与 MR 全链路验收',goal:'Desktop、Mobile、CI Agent 共同编辑真实云端原生文档；MR 使用独立验收分支。',commandId:'cloud-native-acceptance-20261119'});
 const doc=p.lifecycle.documents.find((d:any)=>d.nodeId==='feature-prd');
 if(!doc.cloud){const result=await call('ci_document_cloud_connect',{projectId:p.id,documentId:doc.id,expectedVersion:p.version,commandId:'cloud-connect-prd-20261119'});p=result.project;}
 let current=await call('ci_document_get',{projectId:p.id,documentId:doc.id});
 if(!current.blocks.some((b:any)=>b.text.includes('CI Agent 已通过真实国内云端'))){
  await call('ci_agent_document_edit',{projectId:p.id,documentId:doc.id,expectedVersion:current.projectVersion,expectedRevision:current.document.revision,commandId:'cloud-first-agent-20261119',summary:'CI Agent 原生云端协作首轮贡献',edits:[{op:'append',text:'CI Agent 已通过真实国内云端 Document0/full-sync 参与协作；这段内容须由 Desktop 和 Mobile 的完整 SmartDoc 编辑器读取，并继续共同编辑。'}]});
 }
 current=await call('ci_document_get',{projectId:p.id,documentId:doc.id});
 await writeFile(new URL('../.data/cloud-acceptance.json',import.meta.url),JSON.stringify({projectId:p.id,documentId:doc.id,resourceUri:current.resourceUri,cloud:current.document.cloud},null,2),{mode:0o600});
 console.log({cloudConnected:true,projectId:p.id,documentId:doc.id,revision:current.document.revision,accepted:!!current.document.cloud.lastAcceptedAt&&!current.document.cloud.pending,nativeProfile:JSON.parse(current.nativeFile.content).profile});
}finally{await client.close();}
