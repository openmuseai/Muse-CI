import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {Conventions,projectConfigSchema} from '../packages/projects/conventions.ts';import {lifecycleTemplates} from '../packages/lifecycle/model.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),fs=new Conventions(path.resolve(root,'..'));
const env=Object.fromEntries((await readFile(path.join(root,'.data/development.env'),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const client=new Client({name:'Muse-CI project hierarchy iteration',version:'0.6.0'});
async function call(name:string,args:any={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw Error('HIERARCHY_'+name+'_FAILED');return r.structuredContent as any;}
const get=async(id:string)=>(await call('ci_project_get',{projectId:id})).project;
async function mutate(id:string,name:string,args:any={}){const p=await get(id);return call(name,{projectId:id,expectedVersion:p.version,commandId:crypto.randomUUID(),...args});}
const requirements=[
 {key:'conventions',title:'HIER-01 · 项目约定、版本与需求根',scope:'项目静态配置、受信目录、子项目隔离、显式版本与仓库绑定。默认约定可覆盖，配置无效不静默回退；迁移保留 ID 与历史。',cases:'ROOT-01 项目注册幂等；ROOT-02 嵌套项目独立配置；ROOT-03 路径/符号链接拒绝；ROOT-04 重复版本冲突回滚；ROOT-05 无权访问拒绝；ROOT-06 仓库根不静默切换。'},
 {key:'navigation',title:'HIER-02 · 项目版本切换与交付物导航',scope:'Desktop 左侧核心交付物，Mobile 项目/版本与交付物抽屉。切换清空旧上下文，需求拥有独立画布；SmartDoc 直接原生打开，MR 定位当前需求审查。',cases:'NAV-01 两个项目切换；NAV-02 同项目版本选择；NAV-03 空版本状态；NAV-04 子需求进入/返回；NAV-05 原生产品/设计/架构文档；NAV-06 MR 审查入口；NAV-07 并发旧响应不覆盖新上下文。'},
 {key:'archive',title:'HIER-03 · 输入输出归档与真机验收',scope:'原生 SmartDoc 修订、节点 INPUT/RESULT、产物摘要与 MR 回执按根节点归档。重跑追加，历史不可变；持久 outbox 重试，执行配置/技能/规范固定输入。',cases:'IO-01 原生修订保留；IO-02 同需求多次尝试；IO-03 输入覆盖拒绝；IO-04 产物完整性拒绝；IO-05 配置变化不复用旧批准；IO-06 数据库/文件系统实际验证；IO-07 Find N6 国内公网真机链路。'}
];
const plan=await readFile(path.join(root,'docs/releases/0.6.0/PLAN.zh-CN.md'),'utf8');
async function deliver(flowId:string,nodeId:string,text:string){
 const p=await get(flowId),doc=p.lifecycle.documents.find((d:any)=>d.nodeId===nodeId);if(!doc)throw Error('DELIVERY_DOCUMENT_MISSING');
 const current=await call('ci_document_get',{projectId:flowId,documentId:doc.id});const marker='PROJECT-HIERARCHY-06 / '+nodeId;
 if(!current.blocks.some((b:any)=>b.text.startsWith(marker)))await mutate(flowId,'ci_agent_document_edit',{documentId:doc.id,expectedRevision:current.document.revision,summary:'明确项目、版本、需求和根节点归档的产品交付；不是执行成功',edits:[{op:'append',text:marker+'\n'+text}]});
}
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(process.env.CI_MCP_URL||'http://127.0.0.1:4186/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 for(const p of [{id:'muse-ci',home:'Muse-CI',title:'Muse-CI'},{id:'openmuse-mobile',home:'Muse-Client',title:'OpenMuse Mobile'}])await call('ci_managed_project_register',{...p,commandId:'hierarchy-register-'+p.id});
 const configPath=path.join(root,'.muse-project-muse-ci/project.json'),config=projectConfigSchema.parse(JSON.parse(await readFile(configPath,'utf8')));config.defaults.skills=['ci-project-conventions'];await fs.json(configPath,config);
 const projectRoot=path.dirname(configPath);await mkdir(path.join(projectRoot,'skills/ci-project-conventions'),{recursive:true});
 await fs.write(path.join(projectRoot,'skills/ci-project-conventions/SKILL.md'),'# Muse-CI project conventions\n\nKeep project, version, requirement and node identities distinct. Preserve native SmartDoc, input hashes and historical attempts. Never treat a manual mark, a document or a QA build as platform approval. Validate actual results and keep unresolved gates explicit.\n');
 await fs.write(path.join(projectRoot,'standards/development.md'),'# Development standard\n\nUse strict configuration schemas and declared repositories. Preserve lifecycle gates. Archive exact execution inputs and outputs. Keep secrets out of plugin UI, Git and evidence. Verify Desktop and the physical foldable over domestic public services.\n');
 const versionTemplate=lifecycleTemplates().version;versionTemplate[0].name='版本范围与产品定义';await fs.json(path.join(projectRoot,'workflows/version.json'),versionTemplate);
 await fs.write(path.join(projectRoot,'.gitignore'),'INDEX.json\ninputs/\noutputs/\nversions/\n');
 await fs.write(path.join(root,'.muse/.gitignore'),'requirements/\n');
 const migrations=[];
 for(const file of ['docs/releases/0.4.0/CI-RUN.json','docs/releases/0.5.0/CI-RUN.json']){
  const receipt=JSON.parse(await readFile(path.join(root,file),'utf8')),id=receipt.versionProjectId;
  if(!(await get(id)).hierarchy)await mutate(id,'ci_version_attach',{managedProjectId:'muse-ci'});
  for(const child of (await get(id)).lifecycle.children)if(!(await get(child.projectId)).hierarchy)await mutate(child.projectId,'ci_requirement_repository_bind',{repositoryId:'main'});
  migrations.push({workflowId:id,source:file});
 }
 const listed=(await call('ci_projects_list')).projects;
 const launch=JSON.parse(await readFile(path.resolve(root,'../Muse-Client/docs/release/runs/2026-11-mobile-isolation/muse-ci/launch.json'),'utf8'));
 const mobile=listed.filter((p:any)=>p.kind==='version'&&p.legacyProjectId===launch.projectId);
 if(mobile.length===1){if(!(await get(mobile[0].id)).hierarchy)await mutate(mobile[0].id,'ci_version_attach',{managedProjectId:'openmuse-mobile'});migrations.push({workflowId:mobile[0].id,source:'Muse-Client mobile isolation launch legacy identity'});}
 const created=await call('ci_version_create',{managedProjectId:'muse-ci',versionName:'0.6.0',title:'Muse-CI 0.6.0 · 项目、版本、需求与根节点归档',goal:'采用约定优先、配置可覆盖的长期项目结构；明确版本交付与需求研发，归档精确输入输出，并在实际折叠屏验收。',commandId:'muse-ci-version-06-project-hierarchy'});let version=created.project;
 const children=[];
 for(const requirement of requirements){let existing=version.lifecycle.children.find((c:any)=>c.title===requirement.title);if(!existing){const result=await mutate(version.id,'ci_requirement_create',{title:requirement.title,goal:requirement.scope,repositoryId:'main'});version=result.project;existing={projectId:result.childProjectId};}children.push({...requirement,id:existing.projectId});}
 const receipt={version:'0.6.0',managedProjectId:'muse-ci',versionProjectId:version.id,children,migrations,releaseReady:false};await writeFile(path.join(root,'docs/releases/0.6.0/CI-RUN.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({phase:'roots-and-version-created',versionId:version.id,requirements:children.length}));
 for(const id of ['version-scope','version-ui','requirement-plan','regression-cases','release-materials'])await deliver(version.id,id,plan+'\n\n'+requirements.map(r=>r.title+'\n'+r.scope+'\n'+r.cases).join('\n\n'));
 for(const child of children){
  for(const nodeId of ['feature-prd','feature-ui','feature-solution','implementation','feature-cases','feature-report','mr-review'])await deliver(child.id,nodeId,child.title+'\n'+child.scope+'\n\n'+child.cases+'\n\n'+plan+'\n\n实现由本研发会话推进；CI 节点将执行真实源代码/测试/构建检查，尚未执行的真机与发布条件不标记为通过。');
  let p=await get(child.id);const definition={stages:p.graph.stages,nodes:p.graph.nodes.map((n:any)=>({id:n.id,title:n.title,stage:n.stage,kind:n.id==='implementation'?'test':n.kind,depends:n.depends,config:{...n.config,...(n.id==='implementation'?{tools:['ci-inspect'],outputName:'implementation-check.json'}:n.id==='feature-report'?{tools:['ci-test','ci-plugin-test','ci-build','ci-artifact-verify'],outputName:'test-report.json'}:{})}}))};await mutate(child.id,'ci_graph_save',{definition});
 }
 // Native cloud connection precedes publishing, because initial link migration
 // changes native revisions. Existing history is retained by the server.
 for(const id of [version.id,...children.map(c=>c.id)]){
  let p=await get(id);await mutate(id,'ci_document_cloud_connect',{documentId:p.lifecycle.handbookId});p=await get(id);
  for(const d of p.lifecycle.documents.filter((d:any)=>d.nodeId||d.kind==='handbook')){const current=await call('ci_document_get',{projectId:id,documentId:d.id});await mutate(id,'ci_document_publish',{documentId:d.id,expectedRevision:current.document.revision});}
  console.log(JSON.stringify({phase:'native-cloud-materials-ready',workflowId:id}));
 }
 // Upgrade cross-process handbook references after all children are connected.
 version=await get(version.id);await mutate(version.id,'ci_document_cloud_connect',{documentId:version.lifecycle.handbookId});
 console.log(JSON.stringify({phase:'ready-for-execution',versionId:version.id,children:children.map(c=>c.id),formalRelease:false}));
}finally{await client.close();}
