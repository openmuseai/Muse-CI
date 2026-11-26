/* Plugin-owned Desktop presentation. Host knows no CI project/document schema. */
(function(root){
'use strict';
const R=root.CIRuntime,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode='',sequence=0,lastInput='',selectedDocument='',navigationFailed=false;
const tr=(zh,en)=>document.documentElement.lang.startsWith('en')?en:zh;
const navigate=value=>root.CIBridge.desktopNavigation?.select(value);
const groups=[['核心交付物','Deliverables',['version-prd','product-design','ui-design','solution','implementation','test-cases','test-report','requirement-plan']],['需求与审阅','Requirements and review',['feature-prd','mr']]];
function render(force=false){
 if(mode!=='navigation')return;
 let pane=document.getElementById('desktop-plugin-navigation');if(!pane){pane=document.createElement('aside');pane.id='desktop-plugin-navigation';pane.setAttribute('aria-label','Muse-CI');document.body.append(pane);}
 // Live catalog/state events must not replace an open native select.
 if(force!==true && document.activeElement?.tagName==='SELECT' && pane.contains?.(document.activeElement))return;
 const N=root.CIProjectNav,catalog=N?.catalog,project=N?.project(),version=N?.version();
 if(!R.connected&&!R.error){pane.innerHTML=`<div class="desktop-nav-state" role="status">${tr('正在连接项目…','Connecting to projects…')}</div>`;return;}
 if(!R.connected){pane.innerHTML=`<div class="desktop-nav-state" role="status">${esc(tr('连接暂不可用，请检查当前账号与后端。','Connection unavailable. Check your account and backend.'))}<button data-desktop-retry>${tr('重试','Retry')}</button></div>`;return;}
 if(!N?.enabled){pane.innerHTML=`<div class="desktop-nav-state">${tr('正在加载项目…','Loading projects…')}</div>`;return;}
 pane.innerHTML=`${navigationFailed?'<p role="alert">导航暂不可用，请重试 / Navigation unavailable. Retry.</p>':''}<div class="desktop-nav-label">${tr('项目与版本','PROJECT AND VERSION')}</div><label class="sr-only" for="desktop-ci-project">${tr('项目','Project')}</label><select id="desktop-ci-project">${catalog.projects.filter(p=>!p.error).map(p=>`<option value="${esc(p.id)}"${p.id===project?.id?' selected':''}>${esc(p.title)}</option>`).join('')}</select><label class="sr-only" for="desktop-ci-version">${tr('版本','Version')}</label><select id="desktop-ci-version">${(project?.versions||[]).map(v=>`<option value="${esc(v.id)}"${v.id===version?.id?' selected':''}>${esc(v.hierarchy.versionName)}</option>`).join('')}</select>${version?`<div class="desktop-version-card"><strong>${esc(version.hierarchy.versionName)}</strong><span>${esc(version.title)}</span><small>${tr('版本交付','Version delivery')}</small></div>`:`<p>${tr('暂无版本','No versions')}</p>`}${groups.map(([zh,en,kinds])=>`<div class="desktop-nav-label">${tr(zh,en)}</div><div class="desktop-document-tree">${(catalog.deliveries||[]).filter(d=>kinds.includes(d.kind)).map(d=>`<button type="button" data-desktop-document="${esc(d.id)}" data-workflow="${esc(d.workflowId)}" data-kind="${esc(d.kind)}" aria-current="${d.id===selectedDocument?'page':'false'}"><span aria-hidden="true">▱</span><span>${esc(d.title)}</span></button>`).join('')||`<p>${tr('尚未归档','No deliveries yet')}</p>`}</div>`).join('')}`;
}
async function input(){
 const value=root.CIBridge.desktopNavigation?.input?._openmuse;if(!value)return;
 mode=value.presentation==='navigation'?'navigation':'workspace';
 document.documentElement.classList.toggle('ci-desktop-navigation',mode==='navigation');
 document.documentElement.classList.toggle('ci-desktop-workspace',mode==='workspace');
 render();const selection=value.navigation||{},key=JSON.stringify(selection);if(key===lastInput)return;lastInput=key;
 const token=++sequence;
 try{
  await R.ready;
  const deadline=Date.now()+95000;
  while(R.busy&&token===sequence&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(token!==sequence)return;
  if(R.busy)throw Error('NAVIGATION_WAIT_TIMEOUT');
  if(selection.projectId&&R.project?.id!==selection.projectId)await R.select(selection.projectId);
  if(token!==sequence)return;
  selectedDocument=selection.documentId||'';
  if(mode==='workspace'&&selection.documentId){if(selection.deliveryKind==='mr')await root.CILifecycle.openRepository();else await root.CILifecycle.openDocument(selection.documentId,selection.projectId);}
  navigationFailed=false;render();
 }catch{if(token===sequence){lastInput='';navigationFailed=true;render();}}
}
document.addEventListener('change',e=>{if(mode!=='navigation')return;const target=e.target;
 if(target.id==='desktop-ci-project'||target.id==='desktop-ci-version')void(async()=>{try{await root.CIProjectNav.selectProject(target.id==='desktop-ci-project'?target.value:root.CIProjectNav.project().id,target.id==='desktop-ci-version'?target.value:undefined);await navigate({projectId:R.project.id});navigationFailed=false;render(true);}catch(error){R.error=error.message;navigationFailed=true;render(true);}})();
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-desktop-document]');if(b){selectedDocument=b.dataset.desktopDocument;void navigate({projectId:b.dataset.workflow,documentId:selectedDocument,deliveryKind:b.dataset.kind}).catch(()=>{navigationFailed=true;render();});render();}else if(e.target.closest('[data-desktop-retry]'))void R.reconnect().then(render).catch(render);});
document.addEventListener('focusout',()=>void Promise.resolve().then(()=>render()));
root.addEventListener('ci:desktop-input',()=>void input());root.addEventListener('ci:desktop-context',render);root.addEventListener('ci:catalog',render);root.addEventListener('ci:state',render);void R.ready.then(()=>input());
})(globalThis);
