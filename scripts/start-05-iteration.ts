import{readFile,writeFile,mkdir}from'node:fs/promises';
import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const c=new Client({name:'Muse-CI self iteration delegated Agent',version:'0.5.0'});
async function call(name:string,args:any){const r=await c.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(x=>x.type==='text').map((x:any)=>x.text).join('\n'));return r.structuredContent as any;}
const requirements=[
 {key:'mobile-plugin',title:'Mobile 应用 Tab 安装与 CI 接管',goal:'正式的通用插件安装/可信实例绑定，应用 Tab 显示 Muse-CI；国内生产账号、公网 CI 会话，禁止 localhost、USB 转发或调试注入充当公网验收。支持项目/需求/节点管理、日志与原生文档产物。'},
 {key:'mr-review',title:'手机代码 Diff 与 MR 验收',goal:'读取受信仓库真实 MR 文件列表和逐文件 patch，固定 head SHA；分页、二进制、重命名、截断与过期错误可见。提供有归属的 CI 验收记录；平台正式评审/合并必须保留账号权限与真实回执，不伪造自审批。'},
 {key:'cn-public-e2e',title:'国内生产服务公网端到端验收',goal:'使用本地 .account 精确密码登录国内生产服务，手机不依赖 USB 网络转发。验证应用 Tab → 插件 → 版本/需求 → 节点 → SmartDoc 产物 → diff/MR，交付原生 PRD、UI、方案、用例和实际报告。'}
];
try{
 await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 let p=(await call('ci_lifecycle_create',{kind:'version',title:'Muse-CI 0.5.0 · Mobile 公网接管与 MR 审查',versionName:'0.5.0',goal:'手机公网接管 Muse-CI：应用 Tab 插件、节点与产物管理、真实代码 Diff/MR 审查。国内生产账号与公网 CI 会话；不能将本机服务或 USB 转发作为公网验收。研发分支 feat/0.5-mobile-ci-review；仓库 openmuseai/Muse-CI。',commandId:'muse-ci-05-version-20261122'})).project;
 const children=[];
 for(const req of requirements){
  const existing=p.lifecycle.children.find((x:any)=>x.title===req.title);let id=existing?.projectId;
  if(!id){const r=await call('ci_requirement_create',{projectId:p.id,expectedVersion:p.version,commandId:'muse-ci-05-'+req.key,title:req.title,goal:req.goal});id=r.childProjectId;p=r.project;}
  const child=(await call('ci_project_get',{projectId:id})).project;children.push({id,key:req.key,title:req.title,goal:req.goal,handbookId:child.lifecycle.handbookId});
 }
 const result={version:'0.5.0',versionProjectId:p.id,title:p.title,handbookId:p.lifecycle.handbookId,children,baseline:'41fee5b',repository:'openmuseai/Muse-CI',branch:'feat/0.5-mobile-ci-review',startedAt:new Date().toISOString()};
 await writeFile(new URL('../.data/iteration-05.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});await mkdir(new URL('../docs/releases/0.5.0/',import.meta.url),{recursive:true});await writeFile(new URL('../docs/releases/0.5.0/CI-RUN.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({version:p.id,requirements:children.map(c=>c.id)}));
}finally{await c.close();}
