import{readFile,writeFile}from'node:fs/promises';
import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const meta=JSON.parse(await readFile(new URL('../.data/cloud-acceptance.json',import.meta.url),'utf8'));
if(!/^CIDESKTOPLIVE_[0-9]+$/.test(meta.expectedDesktopText||''))throw Error('ACTUAL_DESKTOP_MARKER_REQUIRED');
const vars=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const client=new Client({name:'CI Agent delegated Desktop cloud collaboration',version:'0.3.0'});
async function call(name:string,args:any){const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(c=>c.type==='text').map(c=>(c as any).text).join('\n'));return r.structuredContent as any;}
try{
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+vars.CI_MCP_TOKEN}}}));
 let doc:any;const end=Date.now()+30000;
 while(Date.now()<end){doc=await call('ci_document_get',{projectId:meta.projectId,documentId:meta.documentId});if(doc.blocks.some((b:any)=>b.text.includes(meta.expectedDesktopText)))break;await new Promise(r=>setTimeout(r,500));}
 if(!doc.blocks.some((b:any)=>b.text.includes(meta.expectedDesktopText)))throw Error('DESKTOP_CONTRIBUTION_NOT_IN_CLOUD');
 if(!doc.blocks.some((b:any)=>b.text.includes('Mobile 原生编辑器贡献')))throw Error('MOBILE_CONTRIBUTION_NOT_PRESERVED');
 const reply='CI Agent 已从云端回读 Desktop 原生修订 '+meta.expectedDesktopText+'；手机贡献与已有文档均保留。';
 const result=await call('ci_agent_document_edit',{projectId:meta.projectId,documentId:meta.documentId,expectedVersion:doc.projectVersion,expectedRevision:doc.document.revision,commandId:'desktop-reply-'+meta.expectedDesktopText,summary:'回应 Desktop 原生文档输入，保留 Mobile 与其他协作者修订',edits:[{op:'append',text:reply}]});
 if(result.cloudSync!=='accepted'||!result.agentPresence?.connected)throw Error('AGENT_CLOUD_REPLY_NOT_CONFIRMED');
 const receipt={passed:true,projectId:meta.projectId,documentId:meta.documentId,desktopMarker:meta.expectedDesktopText,agentReply:reply,agentIdentity:'delegated-existing-CN-member',nativeDesktopContributionReadFromCloud:true,mobileContributionPreserved:true,cloudSync:result.cloudSync,agentRealtimeConnected:true,at:new Date().toISOString()};
 await writeFile(new URL('../.data/desktop-agent-live.json',import.meta.url),JSON.stringify(receipt,null,2),{mode:0o600});
 await writeFile(new URL('../../Muse-Plugin-Ecosystem/plugins/muse-ci/docs/evidence/live-e2e/desktop-agent-cloud-2026-11-19.json',import.meta.url),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({passed:true,cloudSync:result.cloudSync,agentRealtimeConnected:true,mobileContributionPreserved:true}));
}finally{await client.close();}
