/* Stable project -> delivery version -> repository-backed requirement context. */
(function(root){
'use strict';
const R=root.CIRuntime,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog={projects:[],deliveries:[],unassigned:[]},projectId,versionId,loading=false,sequence=0,documentKey='',openGroup='';
const N={enabled:false},project=()=>catalog.projects.find(p=>p.id===projectId),version=()=>project()?.versions.find(v=>v.id===versionId);
const notify=()=>root.dispatchEvent(new CustomEvent('ci:catalog'));
const button=(action,title,value='',className='')=>`<button type="button" class="${className}" data-project-action="${action}" data-value="${esc(value)}">${esc(title)}</button>`;
function dialog(title,body){let d=document.getElementById('project-dialog');if(!d){d=document.createElement('dialog');d.id='project-dialog';d.className='project-dialog';document.body.append(d);}d.innerHTML=`<div class="dialog-head"><h2>${esc(title)}</h2>${button('close','关闭','','icon-button')}</div><div class="project-dialog-body">${body}</div><p class="error" data-project-error role="alert"></p>`;if(!d.open)d.showModal();}
function close(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
async function refresh(){const token=++sequence;const next=await R.call('ci_catalog_get',{...(projectId?{managedProjectId:projectId}:{}),...(versionId?{versionId}:{})});if(token!==sequence)return;catalog=next;notify();}
async function selectProject(id,selectedVersion){
 if(R.busy)throw Error('请等待当前操作完成后再切换项目。');if(loading)throw Error('项目正在切换，请稍候。');const previous={projectId,versionId,catalog,openGroup,documentKey,workflow:R.project};loading=true;R.switching=true;notify();close();
 try{
  const next=await R.call('ci_catalog_get');const target=next.projects.find(p=>p.id===id);if(!target||target.error)throw Error('项目配置不可用，请检查 project.json。');
  const versions=[...target.versions].sort((a,b)=>(b.hierarchy?.versionName||'').localeCompare(a.hierarchy?.versionName||'',undefined,{numeric:true}));
  const targetVersion=selectedVersion?versions.find(v=>v.id===selectedVersion):versions[0];if(selectedVersion&&!targetVersion)throw Error('版本不属于所选项目。');
  projectId=id;versionId=targetVersion?.id;openGroup='';catalog={...next,deliveries:[]};
  if(targetVersion)await R.select(targetVersion.id);else R.setProject(null);
  await refresh();root.dispatchEvent(new CustomEvent('ci:hierarchy-navigate'));
 }catch(error){projectId=previous.projectId;versionId=previous.versionId;openGroup=previous.openGroup;documentKey=previous.documentKey;catalog=previous.catalog;R.setProject(previous.workflow);throw error;}finally{loading=false;R.switching=false;notify();}
}
function adopt(p){
 if(!N.enabled||!p?.hierarchy)return;
 const h=p.hierarchy,nextKey=JSON.stringify([p.id,p.lifecycle?.documents?.map(d=>[d.id,d.revision,d.publishedRevision]),p.mergeRequest?.verifiedAt,p.lifecycle?.children?.map(c=>[c.projectId,c.version])]);if(projectId===h.projectId&&versionId===h.versionId&&documentKey===nextKey)return;documentKey=nextKey;
 projectId=h.projectId;versionId=h.versionId;catalog.deliveries=[];void refresh().catch(()=>{});
}
function controls(){if(!N.enabled)return '';return `<div class="project-context" aria-label="项目和版本">${button('projects',project()?'项目 · '+project().title:'选择项目','','context-project')}${button('versions',version()?'版本 · '+version().hierarchy.versionName:'选择版本','','context-version')}${button('deliveries','交付物','','context-deliveries')}${loading?'<span role="status">切换中…</span>':''}</div>`;}
const groups=[['产品定义',['version-prd','feature-prd','requirement-plan']],['视觉与 UI',['ui-design']],['架构与研发',['solution','implementation']],['测试与交付',['test-cases','test-report','release-plan']],['MR 与代码变更',['mr']]];
function deliveries(){
 const pins=catalog.deliveries.filter(d=>d.workflowId===versionId&&['version-prd','ui-design'].includes(d.kind));
 return `<div class="delivery-navigation"><h3>版本交付物</h3><p>${esc(version()?.hierarchy?.versionName||'请先选择版本')}</p><div class="delivery-pins">${pins.map(d=>button('document',d.kind==='version-prd'?'版本定义 · 产品稿':'版本视觉 · UI 稿',d.id,'delivery-link')).join('')}</div>${groups.map(([title,kinds],index)=>{const docs=catalog.deliveries.filter(d=>kinds.includes(d.kind));return `<details class="delivery-group" name="ci-delivery-groups" data-delivery-group="${index}" ${openGroup===String(index)?'open':''}><summary>${title}<span>${docs.length}</span></summary>${docs.length?docs.map(d=>button(d.kind==='mr'?'mr':'document',d.title,d.id,'delivery-link')+`<small>${esc(d.scope)}${d.kind==='mr'?d.receipt?' · #'+d.receipt.number+' '+(d.receipt.draft?'草稿':d.receipt.state):' · 待创建':' · r'+d.revision+(d.published?' 已发布':' 草稿')}</small>`).join(''):'<span class="delivery-empty">尚未归档</span>'}</details>`;}).join('')}</div>`;
}
function sidebar(){if(!N.enabled)return '';if(loading)return '<p role="status">正在切换项目…</p>';return deliveries()+`<div class="project-utilities">${button('configuration','项目配置')}${button('roots','根节点与归档')}${button('bind-requirement','关联需求仓库')}</div>`;}
function empty(){return `<section class="project-empty"><h1>${esc(project()?.title||'项目工作区')}</h1><p>项目长期维护，版本负责交付，需求在仓库中研发。</p>${project()?button('new-version','创建首个版本','','btn'):button('register','初始化或导入项目','','btn')}${button('projects','切换项目','','btn secondary')}</section>`;}
function newVersion(){if(!project())return openProjects();dialog('创建版本',`<p>所属项目：${esc(project().title)}。采用项目配置及约定模板，版本独立交付。</p><form id="project-version-create"><label>版本号<input name="versionName" required maxlength="80" pattern="[a-z0-9][a-z0-9._-]{0,79}" placeholder="0.6.0"></label><label>版本名称<input name="title" required maxlength="100"></label><label>版本目标<textarea name="goal" required maxlength="2000"></textarea></label><button class="btn" type="submit">创建版本与根节点</button></form>`);}
function openProjects(){dialog('切换项目',`<p>项目是长期配置边界，切换后重新选择版本。</p><div class="project-options">${catalog.projects.map(p=>button('select-project',p.title+(p.error?' · 配置待修复':''),p.id,'project-option')+`<small>${p.parentId?'子项目 · '+esc(p.parentId):'项目'} · ${p.versions.length} 个版本</small>`).join('')||'<p>尚未注册项目。</p>'}</div>${button('register','初始化或导入项目','','btn secondary')}`);}
async function action(b){const action=b.dataset.projectAction,value=b.dataset.value;if(loading&&action!=='close')throw Error('CONTEXT_SWITCHING');
 if(action==='close')return document.getElementById('project-dialog').close();
 if(action==='projects')return openProjects();
 if(action==='select-project')return selectProject(value);
 if(action==='versions')return dialog('选择版本',project()?`<p>${esc(project().title)} · 版本是最小交付单元</p><div class="project-options">${project().versions.map(v=>button('select-version',v.hierarchy.versionName+' · '+v.title,v.id,'project-option')).join('')||'<p>尚未创建版本。</p>'}</div>${button('new-version','创建新版本','','btn')}${button('migrate','关联历史版本','','btn secondary')}`:'<p>请先选择项目。</p>');
 if(action==='select-version')return selectProject(projectId,value);
 if(action==='new-version')return newVersion();
 if(action==='deliveries')return dialog('版本交付物',deliveries());
 if(action==='document'){const d=catalog.deliveries.find(d=>d.id===value);if(!d)throw Error('交付物不属于当前版本。');close();return root.CILifecycle.openDocument(d.id,d.workflowId);}
 if(action==='mr'){const d=catalog.deliveries.find(d=>d.id===value&&d.kind==='mr');if(!d)throw Error('MR 不属于当前版本。');close();await R.select(d.workflowId);root.dispatchEvent(new CustomEvent('ci:hierarchy-navigate'));return root.CILifecycle.openRepository();}
 if(action==='register')return dialog('初始化或导入项目',`<p>受信工作区：${esc(catalog.workspace?.title||'当前工作区')}。在所选目录创建或读取 .muse-project-&lt;ID&gt;/project.json；子目录可注册独立子项目。</p><form id="project-register"><label>项目 ID<input name="id" required pattern="[a-z0-9][a-z0-9._-]{0,79}" placeholder="muse-ci"></label><label>项目名称<input name="title" required maxlength="100"></label><label>工作区内目录<input name="home" required placeholder="Muse-CI 或 ."></label><button type="submit" class="btn">读取配置并注册</button></form>`);
 if(action==='migrate')return dialog('关联历史版本',`<p>只关联明确选择的历史版本，保留原 ID、文档和运行记录。</p><form id="project-version-migrate"><label>历史版本<select name="projectId" required>${catalog.unassigned.map(v=>`<option value="${esc(v.id)}">${esc(v.title)}</option>`).join('')}</select></label><button class="btn" type="submit">关联到 ${esc(project()?.title)}</button></form>`);
 if(action==='bind-requirement'){
  if(!versionId)throw Error('请先选择版本。');const v=(await R.call('ci_project_get',{projectId:versionId})).project;
  return dialog('关联需求仓库',`<p>需求执行根为实际 Git 仓库；每项需求的材料在仓库内单独归档。已绑定的需求不能静默切换根。</p><form id="project-requirement-bind"><label>需求<select name="projectId" required>${v.lifecycle.children.map(c=>`<option value="${esc(c.projectId)}">${esc(c.title)}</option>`).join('')}</select></label><label>项目仓库<select name="repositoryId">${project().repositories.map(r=>`<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select></label><button type="submit" class="btn">关联并保留历史</button></form>`);
 }
 if(action==='configuration')return dialog('项目配置',`<p>约定优先，显式配置覆盖缺省。无效配置不会静默回退。配置变化作用于新版本，已运行输入保持固定。</p><pre>${esc(project()?.configSource||'未选择项目')}</pre><p>项目缺省</p><pre>${esc(JSON.stringify(project()?.defaults||{},null,2))}</pre><p>技能：skills/；规范：standards/；流程覆盖：workflows/version.json、workflows/requirement.json。</p>`);
 if(action==='roots'){
  if(!R.project?.hierarchy)return dialog('根节点与归档','<p>当前流程尚未关联到项目。</p>');
  const result=await R.call('ci_archive_sync',{projectId:R.project.id});
  return dialog('根节点与归档',`<p>归档完成 · 原生文档 ${result.archive.documents} 份。节点尝试输入和输出分别保存，历史不可覆盖。</p><dl><dt>项目根</dt><dd>${esc(R.project.hierarchy.projectRoot)}</dd><dt>版本根</dt><dd>${esc(R.project.hierarchy.versionRoot)}</dd>${R.project.hierarchy.repositoryRoot?`<dt>需求执行根</dt><dd>${esc(R.project.hierarchy.repositoryRoot)}</dd>`:''}<dt>材料索引</dt><dd>${esc(result.archive.index)}</dd></dl>`);
 }
}
const messages={VERSION_NAME_ALREADY_ASSIGNED:'此项目已有相同版本号，请选择已有版本。',PROJECT_PATH_OUTSIDE_WORKSPACE:'目录超出受信工作区。',PROJECT_SYMLINK_FORBIDDEN:'项目路径包含符号链接，请使用真实目录。',REQUIREMENT_GIT_ROOT_REQUIRED:'需求根必须是实际 Git 仓库。',REQUIREMENT_ROOT_ALREADY_BOUND:'需求已有归档根，不能静默切换。',PROJECT_CONFIG_INVALID:'项目配置无效，请修正配置文件。'};
document.addEventListener('toggle',e=>{if(e.target.dataset?.deliveryGroup!==undefined){if(e.target.open)openGroup=e.target.dataset.deliveryGroup;else if(openGroup===e.target.dataset.deliveryGroup)openGroup='';}},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-project-action]');if(b)void action(b).catch(error=>{const d=document.querySelector('#project-dialog[open]');if(d)d.querySelector('[data-project-error]').textContent=messages[error.message]||error.message;else dialog('操作未完成',`<p role="alert">${esc(messages[error.message]||error.message)}</p>`);});});
document.addEventListener('submit',async e=>{
 const id=e.target.id;if(!id.startsWith('project-'))return;e.preventDefault();const data=Object.fromEntries(new FormData(e.target));
 const submit=e.target.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
 try{
  if(id==='project-register'){const result=await R.call('ci_managed_project_register',{...data,commandId:R.commandId()});await selectProject(result.projectId);}
  if(id==='project-version-create'){const result=await R.call('ci_version_create',{...data,managedProjectId:projectId,commandId:R.commandId()});await selectProject(projectId,result.project.id);}
  if(id==='project-version-migrate'){const p=(await R.call('ci_project_get',{projectId:data.projectId})).project;await R.call('ci_version_attach',{managedProjectId:projectId,projectId:p.id,expectedVersion:p.version,commandId:R.commandId()});await selectProject(projectId,p.id);}
  if(id==='project-requirement-bind'){const p=(await R.call('ci_project_get',{projectId:data.projectId})).project;await R.call('ci_requirement_repository_bind',{...data,expectedVersion:p.version,commandId:R.commandId()});close();await refresh();}
 }catch(error){document.querySelector('#project-dialog [data-project-error]').textContent=messages[error.message]||error.message;}finally{submit.disabled=false;}
});
N.ready=R.ready.then(async()=>{
 if(!R.remote||!R.capabilities?.hierarchy)return;
 N.enabled=true;catalog=await R.call('ci_catalog_get');
 const current=R.project?.hierarchy;
 if(current&&catalog.projects.some(p=>p.id===current.projectId))await selectProject(current.projectId,current.versionId);
 else if(catalog.projects.some(p=>!p.error))await selectProject(catalog.projects.find(p=>!p.error).id);
 else R.setProject(null);
}).catch(error=>{R.error=error.message;notify();});
Object.assign(N,{controls,sidebar,empty,refresh,adopt,openProjects,newVersion,selectProject,project,version,get catalog(){return catalog;}});
Object.defineProperty(N,'ready',{value:N.ready});
Object.defineProperty(N,'catalog',{get:()=>catalog});
root.CIProjectNav=N;
})(globalThis);
