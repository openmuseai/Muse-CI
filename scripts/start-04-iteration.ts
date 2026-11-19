import{readFile,writeFile,mkdir}from'node:fs/promises';
import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const c=new Client({name:'Muse-CI self iteration delegated Agent',version:'0.4.0'});
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(x=>x.type==='text').map((x:any)=>x.text).join('\n'));return r.structuredContent as any;}
const requirements=[
 {key:'compact-nodes',title:'精简节点卡片与清晰操作',goal:'卡片仅保留标题、状态、运行/重跑、产物与更多操作；默认字号增大，描述、Skill、工具、材料与依赖移入详情。保留人工标过/撤回、日志、历史、列内依赖和执行门禁。Desktop/Web/Mobile 可操作。'},
 {key:'smartdoc-steps',title:'SmartDoc 驱动 Step 与文档产物直达',goal:'每个 Step 有归档到总文档的原生配置 SmartDoc；发布配置时校验受信 Skill/工具/节点覆盖并固定修订，执行使用固定快照，修改后过期并阻止旧输入运行。节点文档与 .sydoc 产物点击直接打开智能文档，历史产物保持只读固定快照。Web 直接渲染富文档，Desktop/Mobile 进入完整原生编辑器，不先展示 JSON/段落编辑弹窗。'}
];
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 let p=(await call('ci_lifecycle_create',{kind:'version',title:'Muse-CI 0.4.0 · 清晰画布与 SmartDoc 驱动',versionName:'0.4.0',goal:'在已运行的 CI 中迭代 CI 本身：简化节点信息并增大字体，以原生 SmartDoc 配置 Step，文档产物直接渲染。基线 master 9e87978；研发分支 feat/0.4-smartdoc-steps；仓库 openmuseai/Muse-CI。',commandId:'muse-ci-04-version-20261119'})).project;
 const children=[];
 for(const req of requirements){
  const existing=p.lifecycle.children.find((x:any)=>x.title===req.title);let id=existing?.projectId;
  if(!id){const r=await call('ci_requirement_create',{projectId:p.id,expectedVersion:p.version,commandId:'muse-ci-04-'+req.key,title:req.title,goal:req.goal});id=r.childProjectId;p=r.project;}
  const child=(await call('ci_project_get',{projectId:id})).project;children.push({id,key:req.key,title:req.title,goal:req.goal,handbookId:child.lifecycle.handbookId});
 }
 const result={version:'0.4.0',versionProjectId:p.id,title:p.title,handbookId:p.lifecycle.handbookId,children,baseline:'9e87978',repository:'openmuseai/Muse-CI',branch:'feat/0.4-smartdoc-steps',startedAt:new Date().toISOString()};
 await writeFile(new URL('../.data/iteration-04.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});await mkdir(new URL('../docs/releases/0.4.0/',import.meta.url),{recursive:true});await writeFile(new URL('../docs/releases/0.4.0/CI-RUN.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({version:p.id,requirements:children.map(c=>c.id)}));
}finally{await c.close();}
