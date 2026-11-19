// Actual MCP -> PostgreSQL -> Temporal -> runner -> GitHub lifecycle acceptance.
// The only remote writes are the dedicated fixture branches from setup.
import {readFile,writeFile}from'node:fs/promises';
import {Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';
import {randomUUID}from'node:crypto';
import {sourceManifest}from'../packages/providers/source.ts';
const stateFile=new URL('../.data/mr-acceptance.json',import.meta.url),state=JSON.parse(await readFile(stateFile,'utf8'));
const vars=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
if(state.repository!=='openmuseai/openmuse'||![state.baseBranch,state.sourceBranch].every((s:string)=>s.startsWith('codex/ci-acceptance-')))throw Error('FIXTURE_SCOPE_MISMATCH');
const client=new Client({name:'Muse-CI real MR lifecycle acceptance',version:'0.3.0'});
const save=()=>writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});
async function call(name:string,args:any={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(c=>c.type==='text').map(c=>(c as any).text).join('\n'));return r.structuredContent as any;}
const get=async()=>(await call('ci_project_get',{projectId:state.projectId})).project;
const mutate=async(name:string,args:any)=>{const p=await get();return call(name,{projectId:p.id,expectedVersion:p.version,commandId:randomUUID(),...args});};
try{
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+vars.CI_MCP_TOKEN}}}));
 if(!state.projectId){const created=await call('ci_lifecycle_create',{kind:'requirement',title:'真实 MR 创建、提审与合并验收 '+state.id,goal:'仅验证 Muse-CI 到 openmuseai/openmuse 两条独立验收分支的真实 MR 操作；不代表 Mobile 整改已合并或 App 已发布。',commandId:'mr-live-'+state.id});state.projectId=created.project.id;await save();}
 let p=await get();
 if(!state.prepared){
  await mutate('ci_repository_bind',{provider:'github',repository:state.repository,baseBranch:state.baseBranch,sourceBranch:state.sourceBranch,gitProfileId:'openmuseai'});p=await get();
  const definition={stages:p.graph.stages,nodes:p.graph.nodes.map((n:any)=>({id:n.id,title:n.title,stage:n.stage,kind:n.id==='implementation'?'artifact':n.kind,depends:n.depends,config:{...n.config,...(n.id==='implementation'?{tools:['ci-inspect'],outputName:'implementation-provenance.json',goal:'归档本次已经实现的 MR Provider 来源文件与摘要；不冒充执行新的 AI 编码。'}:{}),...(n.id==='feature-report'?{tools:['ci-test'],outputName:'process-report.json',timeout:90}:{}),timeout:90}}))};
  await mutate('ci_graph_save',{definition});p=await get();
  const sections:Record<string,string>={
   'feature-prd':'范围：创建草稿、转为可评审、校验源 SHA、遵循平台检查后合并，并核对实际合并提交。只操作两条 codex/ci-acceptance 分支；不提交本机脏工作区。失败不得伪造完成。验收 AC1 草稿真实存在；AC2 提审后 draft=false；AC3 合并回执 head/merge SHA 完整；AC4 重放不重复创建；AC5 错误来源和失效凭据被拒绝。',
   'ui-design':'Desktop/Mobile 共用 CI 的仓库身份选择、草稿/提审/合并动作及确认源 SHA 交互。创建后显示实际 MR URL；错误保留可恢复操作。此次自动化从相同 MCP 业务入口执行，界面及真实设备验证另列证据，不冒充点击验收。',
   'solution':'通用 Host 只负责 MCP 转发与安全存储。CI 持久化 prepared/confirmed/blocked 操作，GitHub Provider 固定 origin、仓库准入、用户身份、源/目标仓库与精确 SHA；写入后只读回查平台。实际代码：packages/providers/repository.ts、git-profiles.ts、apps/api/service.ts。',
   'test-cases':'MR-01 禁止未准入仓库写入；MR-02 无 push 权限无 POST；MR-03 命令标记恢复不重复创建；MR-04 真实 ready-for-review；MR-05 源 SHA 变化拒绝合并；MR-06 失败检查拒绝合并；MR-07 同名 fork 拒绝；MR-08 自动删除源分支后回执可恢复。runner 实际执行 core、repository、git-profiles 测试；后续 MR 节点交付真实 GitHub 回执。',
   'implementation':'已实现真实 GitHub MR Provider；本节点归档实际源码摘要。独立验收 fixture 的源码提交为 '+state.headSha+'。后端测试固定其自身源码清单，并非声明测试了此 Git 提交中的全部 App 功能。',
   'test-report':'报告由真实 runner 命令输出归档。覆盖本地 CI 调度合同、MR Provider 与 Git 身份隔离；平台真实状态由 MR Step 后续回执证明。未覆盖正式上架、iOS、生产 OAuth 及完整产品功能回归。',
   'mr-review':'目标 '+state.repository+'；源 '+state.sourceBranch+'；目标 '+state.baseBranch+'；固定源 SHA '+state.headSha+'。提审不构成评审人批准，不使用自我审批。',
   'merge-receipt':'仅在平台合并成功并回查实际 merge SHA 后完成本节点。遵循平台保护和检查，不强制合并、不改变仓库规则。'
  };
  for(const d of p.lifecycle.documents){
   const read=await call('ci_document_get',{projectId:p.id,documentId:d.id});
   const text=sections[d.kind]||'本流程材料按 Step 归档；测试范围与真实回执分别记录。';
   if(!read.blocks.some((b:any)=>b.text?.includes('验收批次 '+state.id)))await mutate('ci_document_edit',{documentId:d.id,expectedRevision:read.document.revision,summary:'定义真实 MR 试验范围、交付和验证边界',edits:[{op:'append',text:'验收批次 '+state.id+'\n'+text}]});
   const latest=await call('ci_document_get',{projectId:p.id,documentId:d.id});await mutate('ci_document_publish',{documentId:d.id,expectedRevision:latest.document.revision});
  }
  state.prepared=true;await save();
 }
 if(state.validatedHead!==state.headSha){
  p=await get();
  for(const d of p.lifecycle.documents.filter((d:any)=>['feature-prd','implementation','test-cases'].includes(d.kind))){
   const read=await call('ci_document_get',{projectId:p.id,documentId:d.id});
   await mutate('ci_document_edit',{documentId:d.id,expectedRevision:read.document.revision,summary:'固定最新验收提交与实际 runner 迁移范围',edits:[{op:'append',text:'当前验收源提交 '+state.headSha+'。'+(state.runnerMigration?'修复实际发现的 GitHub macOS 14 镜像退役问题；两个现有门禁迁至 macos-15，保留全部原测试与构建步骤。Hosted 检查须在该提交完成后才允许合并。':'仅独立 MR 试验材料。')}]});
   const next=await call('ci_document_get',{projectId:p.id,documentId:d.id});await mutate('ci_document_publish',{documentId:d.id,expectedRevision:next.document.revision});
  }
  state.validatedHead=state.headSha;await save();
 }
 const sources=await sourceManifest();
 if(state.validatedSources!==sources.digest){
  p=await get();const d=p.lifecycle.documents.find((d:any)=>d.nodeId==='feature-report');
  const read=await call('ci_document_get',{projectId:p.id,documentId:d.id});
  await mutate('ci_document_edit',{documentId:d.id,expectedRevision:read.document.revision,summary:'固定本轮 CI 测试源码清单并重新执行',edits:[{op:'append',text:'本轮固定 CI 后端与插件源码清单 SHA-256：'+sources.digest+'。ci-test 实际执行全部后端测试，原始命令、退出码与输出由 Runner 归档。'}]});
  const next=await call('ci_document_get',{projectId:p.id,documentId:d.id});await mutate('ci_document_publish',{documentId:d.id,expectedRevision:next.document.revision});state.validatedSources=sources.digest;await save();
 }
 p=await get();
 if(!p.graph.nodes.filter((n:any)=>!n.id.startsWith('mr-')).every((n:any)=>n.status==='succeeded')){
  const active=p.runs.find((r:any)=>!['succeeded','failed','canceled'].includes(r.status));
  if(!active)await mutate('ci_run_command',{action:'start',nodeIds:p.graph.nodes.filter((n:any)=>!n.id.startsWith('mr-')).map((n:any)=>n.id),auto:true});
  const end=Date.now()+180000;
  while(Date.now()<end){p=await get();const run=p.runs.at(-1);if(run?.status==='failed')throw Error('REAL_RUN_FAILED: '+JSON.stringify(p.graph.nodes.filter((n:any)=>n.status==='failed').map((n:any)=>({id:n.id,logs:n.attempts.at(-1)?.logs}))));if(run?.status==='succeeded')break;await new Promise(r=>setTimeout(r,500));}
  if(p.runs.at(-1)?.status!=='succeeded')throw Error('REAL_RUN_NOT_FINISHED');
 }
 console.log('PASS published SmartDoc inputs and actual Temporal runner tests');
 if(state.number)await mutate('ci_mr_verify',{number:state.number});
 for(const kind of ['create','submit','merge']){
  if(state[kind]&&(kind!=='merge'||state[kind].headSha===state.headSha))continue;
  state.actions??={};let args=state.actions[kind];
  const operationId='mr-'+kind+'-'+state.id+'-'+state.headSha.slice(0,8);
  if(args?.expectedHeadSha!==state.headSha||args.commandId!==operationId)args=undefined;
  if(!args){p=await get();args={projectId:p.id,expectedVersion:p.version,commandId:operationId,expectedHeadSha:state.headSha,...(kind==='create'?{title:'test(ci): verify real MR lifecycle '+state.id,body:'Verify Muse-CI draft creation, ready-for-review and exact-head merge on two dedicated acceptance branches. This fixture does not publish an App or merge the local dirty checkout.'}:{number:state.number}),...(kind==='merge'?{method:'squash'}:{})};state.actions[kind]=args;await save();}
  p=await get();
  const old=p.mrOperations?.[args.commandId];
  const result=old?.status==='blocked'?await mutate('ci_mr_reconcile',{operationId:args.commandId}):await call('ci_mr_'+kind,args);
  if(result.waiting){state.pendingOperationId=args.commandId;await save();console.log('WAIT '+result.waitingFor+'; durable dispatcher will continue the already authorized operation.');break;}
  state.number=result.receipt.number;state[kind]=result.receipt;delete state.pendingOperationId;await save();console.log('PASS real MR '+kind+' '+result.receipt.url+' state='+result.receipt.state+' draft='+result.receipt.draft);
 }
 p=await get();
 if(p.graph.nodes.find((n:any)=>n.id==='mr-merge').status==='succeeded'&&p.mergeRequest?.state==='merged'&&p.mergeRequest.mergeSha){state.merge=p.mergeRequest;state.completedAt=new Date().toISOString();delete state.pendingOperationId;await save();console.log(JSON.stringify({passed:true,projectId:state.projectId,url:state.merge.url,headSha:state.headSha,mergeSha:state.merge.mergeSha,target:state.baseBranch}));}
 else if(state.pendingOperationId)console.log(JSON.stringify({waiting:true,projectId:state.projectId,operationId:state.pendingOperationId,target:state.baseBranch}));
 else throw Error('MERGE_RECEIPT_INCOMPLETE');
}finally{await client.close();}
