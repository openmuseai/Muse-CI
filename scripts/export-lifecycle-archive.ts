import{readFile,writeFile,mkdir}from'node:fs/promises';import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';import{createHash}from'node:crypto';
const out=new URL('../../Muse-Plugin-Ecosystem/plugins/muse-ci/docs/evidence/lifecycle-v2/smartdoc-archive/',import.meta.url);
const migration=JSON.parse(await readFile(new URL('../mobile-migration.json',out),'utf8'));
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const c=new Client({name:'Read-only native SmartDoc archive',version:'2'});await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error('ARCHIVE_READ_FAILED');return r.structuredContent as any;}
const projects=[];
for(const [index,id]of[migration.versionProjectId,...migration.children.map((c:any)=>c.id)].entries()){
 const p=(await call('ci_project_get',{projectId:id})).project;
 const base=index===0?'version':`requirements/${String(index).padStart(2,'0')}-${id.slice(0,8)}`;
 const entries=[];
 for(const doc of p.lifecycle.documents){
  const {nativeFile}=await call('ci_document_get',{projectId:id,documentId:doc.id});
  const stepIndex=p.graph.stages.findIndex((s:any)=>s.id===doc.stepId);
  const group=doc.kind==='handbook'?'00-index':stepIndex>=0?`${String(stepIndex+1).padStart(2,'0')}-${doc.stepId}`:'shared-materials';
  const path=`${base}/${group}/${doc.nodeId||doc.id}.sydoc`;
  await mkdir(new URL(path.slice(0,path.lastIndexOf('/')+1),out),{recursive:true});await writeFile(new URL(path,out),nativeFile.content);
  entries.push({documentId:doc.id,parentId:doc.parentId,title:doc.title,kind:doc.kind,stepId:doc.stepId,nodeId:doc.nodeId,revision:doc.revision,publishedRevision:doc.publishedRevision,path,sha256:createHash('sha256').update(nativeFile.content).digest('hex')});
 }
 projects.push({projectId:p.id,title:p.title,kind:p.lifecycle.kind,parentId:p.lifecycle.parentId,version:p.version,handbookPath:entries.find(d=>d.kind==='handbook')!.path,documents:entries});
}
await writeFile(new URL('INDEX.json',out),JSON.stringify({exportedAt:new Date().toISOString(),profile:'muse.smart-document/phase1',authority:'CI backend native document IDs; these files are read-only point-in-time exports',links:'muse://ci links resolve inside the CI document panel; use this index for offline paths',projects},null,2));console.log({projects:projects.length,nativeDocuments:projects.reduce((n,p)=>n+p.documents.length,0)});await c.close();
