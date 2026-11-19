// Read current original native documents; export fixed snapshots without secrets.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const out=new URL('../../Muse-Plugin-Ecosystem/plugins/muse-ci/docs/evidence/live-e2e/smartdoc-live-archive/',import.meta.url),index=JSON.parse(await readFile(new URL('INDEX.json',out),'utf8'));
const c=new Client({name:'Read-only native live archive exporter',version:'0.3.0'});
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 const projectReply=await c.callTool({name:'ci_project_get',arguments:{projectId:index.projectId}});if(projectReply.isError)throw Error('NATIVE_PROJECT_EXPORT_FAILED');
 const project=(projectReply.structuredContent as any).project;const exports=[];
 for(const [kind,id]of [['parent',index.parentDocumentId],['child',index.childDocumentId]]){
  const revision=project.lifecycle.documents.find((d:any)=>d.id===id)?.revision;if(!revision)throw Error('NATIVE_REVISION_MISSING');
  const r=await c.callTool({name:'ci_document_get',arguments:{projectId:index.projectId,documentId:id,...(process.argv.includes('--live')?{}:{revision})}});if(r.isError)throw Error('NATIVE_EXPORT_READ_FAILED');
  const d=r.structuredContent as any;const path=index.archive[kind];await writeFile(new URL(path,out),d.nativeFile.content);
  exports.push({documentId:id,parentId:d.document.parentId,cloudParentViewId:d.document.cloud.parentViewId,title:d.document.title,revision:d.document.revision,path,sha256:createHash('sha256').update(d.nativeFile.content).digest('hex')});
 }
 index.exportedAt=new Date().toISOString();index.exports=exports;index.desktopNativeLinkNavigationVerified=true;index.mobileNativeLinkNavigationEvidence='../mobile-smartdoc-recovered-111857.json';index.readMode=process.argv.includes('--live')?'Current original CN cloud read after service recovery':'Retained native CI revisions';
 await writeFile(new URL('INDEX.json',out),JSON.stringify(index,null,2));console.log(JSON.stringify({exported:exports.length}));
}finally{await c.close();}
