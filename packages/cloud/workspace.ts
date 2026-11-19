// Existing AppFlowy Document0/full-sync protocol. No second collaboration store,
// cloud credentials in MCP results, synthetic user IDs or client-authored ACLs.
import {readFile} from 'node:fs/promises';
import https from 'node:https';
import dns from 'node:dns';
import {parseLocalAccount} from './account-file.ts';
import {fail} from '../../apps/api/store.ts';
import {nativeCall,nativeSession,documentTree,acceptCloudState} from '../documents/smartdoc.ts';
import type {Principal,SmartDocRecord} from '../contracts/index.ts';
import {cloudResourceUri} from '../documents/resource-uri.ts';
export {cloudResourceUri} from '../documents/resource-uri.ts';
type Config={origin:string;workspaceId:string;parentViewId:string;credentialFile:string;actors:Record<string,string>};
const uuid=(s:string)=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
let login:{access:string;refresh:string;expires:number;subject:string}|undefined;
let authing:Promise<NonNullable<typeof login>>|undefined;
let loginScope='';
export const cloudConfigured=()=>!!process.env.CI_CLOUD_CONFIG;
export async function cloudConfig():Promise<Config>{
  if(!process.env.CI_CLOUD_CONFIG)fail('CLOUD_NOT_CONFIGURED');
  const c=JSON.parse(await readFile(process.env.CI_CLOUD_CONFIG,'utf8')) as Config;
  const u=new URL(c.origin);
  if(u.protocol!=='https:'||u.origin!==c.origin||u.username||u.password||!uuid(c.workspaceId)||!uuid(c.parentViewId)||!c.credentialFile?.startsWith('/')||!c.actors||Object.values(c.actors).some(s=>!uuid(s)))fail('CLOUD_CONFIGURATION_INVALID');
  return c;
}
// DNS-only fallback scoped to this HTTPS request; retain original hostname/SNI
// and system certificate checks. No global resolver or /etc/hosts modification.
const resolved=new Map<string,{address:string;until:number}>();
export const cloudLookup:any=(hostname:string,options:any,callback:any)=>dns.lookup(hostname,options,(err:any,address:any,family:any)=>{
  if(!err)return callback(null,address,family);
  if(!['ENOTFOUND','EAI_AGAIN'].includes(err.code))return callback(err);
  void(async()=>{let entry=resolved.get(hostname);if(!entry||entry.until<Date.now()){
    const r=await fetch('https://dns.alidns.com/resolve?name='+encodeURIComponent(hostname)+'&type=A',{signal:AbortSignal.timeout(8000)});
    const d:any=await r.json(),a=d.Answer?.find((a:any)=>a.type===1&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(a.data));
    if(d.Status!==0||!a)throw err;entry={address:a.data,until:Date.now()+Math.min(a.TTL||60,300)*1000};resolved.set(hostname,entry);
  }callback(null,options?.all?[{address:entry.address,family:4}]:entry.address,4);})().catch(()=>callback(err));
});
async function request(c:Config,path:string,method='GET',body?:unknown,token?:string):Promise<{status:number;bytes:Buffer;contentType:string}>{
  if(!path.startsWith('/')||path.startsWith('//'))fail('CLOUD_ROUTE_INVALID');
  return new Promise((resolve,reject)=>{
    const binary=body instanceof Uint8Array;const bytes=body===undefined?undefined:binary?Buffer.from(body as Uint8Array):Buffer.from(JSON.stringify(body));
    const req=https.request(c.origin+path,{method,lookup:cloudLookup,headers:{'content-type':binary?'application/octet-stream':'application/json','client-version':'0.16.5','Device-Id':'muse-ci-agent',...(token?{authorization:'Bearer '+token}:{}),...(bytes?{'content-length':bytes.length}:{})}},res=>{
      const parts:Buffer[]=[];let size=0;res.on('data',part=>{size+=part.length;if(size>8*1024*1024){res.destroy();reject(Error('CLOUD_RESPONSE_TOO_LARGE'));}else parts.push(part);});
      res.on('end',()=>resolve({status:res.statusCode||0,bytes:Buffer.concat(parts),contentType:res.headers['content-type']||''}));res.on('error',()=>reject(Error('CLOUD_RESPONSE_FAILED')));
    });req.setTimeout(20000,()=>req.destroy(Error('CLOUD_TIMEOUT')));req.on('error',()=>reject(Error('CLOUD_CONNECTION_FAILED')));req.end(bytes);
  });
}
function envelope(r:{status:number;bytes:Buffer}){
  if([401,403].includes(r.status))fail('CLOUD_ACCESS_DENIED');
  let d:any;try{d=JSON.parse(r.bytes.toString());}catch{fail('CLOUD_INVALID_RESPONSE');}
  if(r.status!==200||d.code!==0)fail(d.code===-4?'CLOUD_OBJECT_DELETED':'CLOUD_OPERATION_REJECTED');return d.data;
}
async function session(c:Config){
  const scope=c.origin+'\n'+c.credentialFile+'\n'+JSON.stringify(c.actors);
  if(scope!==loginScope){login=undefined;authing=undefined;loginScope=scope;}
  if(login&&login.expires>Date.now()+60000)return login;
  if(authing)return authing;
  authing=(async()=>{
    let payload:any,path='/gotrue/token?grant_type=';
    if(login?.refresh){payload={refresh_token:login.refresh};path+='refresh_token';}
    else{
      payload=parseLocalAccount(await readFile(c.credentialFile,'utf8'));path+='password';
    }
    const r=await request(c,path,'POST',payload);if(r.status!==200)fail('CLOUD_AUTH_REQUIRED');
    const d=JSON.parse(r.bytes.toString());if(!d.access_token||!uuid(d.user?.id)||!Object.values(c.actors).includes(d.user.id))fail('CLOUD_ACCOUNT_MISMATCH');
    login={access:d.access_token,refresh:d.refresh_token,subject:d.user.id,expires:Date.now()+Number(d.expires_in)*1000};return login;
  })();try{return await authing;}finally{authing=undefined;}
}
async function authorized(actor:Principal,doc?:SmartDocRecord){
  const c=await cloudConfig(),s=await session(c);
  if(c.actors[actor.id]!==s.subject)fail('CLOUD_ACCOUNT_MISMATCH');
  if(doc?.cloud&&(doc.cloud.origin!==c.origin||doc.cloud.workspaceId!==c.workspaceId||doc.cloud.subject!==s.subject||doc.cloud.viewId!==doc.body.objectId))fail('CLOUD_BINDING_MISMATCH');
  return {c,s};
}
// Server-internal connection port. Never return this object through a tool.
export async function cloudConnection(doc:SmartDocRecord,actor:Principal){
  const {c,s}=await authorized(actor,doc);
  const profile=await request(c,'/api/user/profile','GET',undefined,s.access);
  if(profile.status!==200||profile.bytes.length>65536)fail('CLOUD_ACTOR_UNAVAILABLE');
  return {origin:c.origin,workspaceId:c.workspaceId,token:s.access,profile:profile.bytes};
}
export async function cloudDiscovery(actor:Principal){
  const {c,s}=await authorized(actor);
  const workspaces=envelope(await request(c,'/api/workspace?include_role=true','GET',undefined,s.access));
  if(!workspaces.some((w:any)=>w.workspace_id===c.workspaceId&&['Owner','Member',1,2].includes(w.role)))fail('CLOUD_WORKSPACE_DENIED');
  return {origin:c.origin,workspaceId:c.workspaceId,subject:s.subject};
}
export async function connectCloudDocument(doc:SmartDocRecord,actor:Principal,parent?:SmartDocRecord){
  const {c,s}=await authorized(actor,doc);await cloudDiscovery(actor);
  if(doc.cloud){await pullCloudDocument(doc,actor);return {resourceUri:cloudResourceUri(doc),cloud:doc.cloud};}
  if(parent){await authorized(actor,parent);if(!parent.cloud)fail('CLOUD_PARENT_NOT_CONNECTED');}
  const parentViewId=parent?.cloud?.viewId||c.parentViewId;
  const id=doc.body.objectId;
  const route=`/api/workspace/${c.workspaceId}/page-view/${id}`;
  let page=await request(c,route,'GET',undefined,s.access);
  let exists=false;try{const d=JSON.parse(page.bytes.toString());exists=page.status===200&&d.code===0;}catch{}
  if(!exists){
    // The same retained client identity is checked before a retry. Never invent
    // a new ID when POST delivery is ambiguous.
    if(page.status===401||page.status===403)fail('CLOUD_ACCESS_DENIED');
    let d:any;try{d=JSON.parse(page.bytes.toString());}catch{}
    if(page.status!==404&&!(page.status===200&&[-2,1040].includes(d?.code)))fail('CLOUD_PAGE_CHECK_FAILED');
    const folder=envelope(await request(c,`/api/workspace/${c.workspaceId}/folder?depth=10`,'GET',undefined,s.access));
    let parentFound=false,collision=false;const walk=(v:any)=>{if(v.view_id===parentViewId)parentFound=true;if(v.view_id===id)collision=true;for(const child of v.children||[])walk(child);};walk(folder);
    if(!parentFound||collision)fail('CLOUD_FOLDER_TARGET_CHANGED');
    const created=await request(c,`/api/workspace/${c.workspaceId}/page-view`,'POST',{parent_view_id:parentViewId,layout:0,name:doc.title.slice(0,200),view_id:id,collab_id:id,page_data:documentTree(doc.body)},s.access);
    const result=envelope(created);if(result.view_id!==id)fail('CLOUD_CREATION_ID_MISMATCH');
  }
  const raw=envelope(await request(c,`/api/workspace/v1/${c.workspaceId}/collab/${id}?collab_type=0`,'GET',undefined,s.access));
  if(!Array.isArray(raw.doc_state))fail('CLOUD_INVALID_RESPONSE');
  const state=nativeCall({action:'open',objectId:id,docState:Buffer.from(raw.doc_state).toString('base64')});
  try{acceptCloudState(doc,{profile:'muse.smart-document/phase1',objectId:id,docState:state.docState},'连接原始云端 Document0；保留迁移前原生修订');}finally{nativeCall({action:'close',handle:state.handle});}
  doc.cloud={origin:c.origin,workspaceId:c.workspaceId,viewId:id,subject:s.subject,parentViewId,connectedAt:new Date().toISOString()};
  return {resourceUri:cloudResourceUri(doc),cloud:doc.cloud};
}
export async function pullCloudDocument(doc:SmartDocRecord,actor:Principal){
  if(!doc.cloud)return false;const {c,s}=await authorized(actor,doc);
  const raw=envelope(await request(c,`/api/workspace/v1/${c.workspaceId}/collab/${doc.cloud.viewId}?collab_type=0`,'GET',undefined,s.access));
  if(!Array.isArray(raw.doc_state))fail('CLOUD_INVALID_RESPONSE');
  const body=await nativeSession(doc.body,async state=>{const next=nativeCall({action:'applyUpdate',handle:state.handle,update:Buffer.from(raw.doc_state).toString('base64')});return {...doc.body,docState:next.docState};});
  return acceptCloudState(doc,body,'同步云端协作者的原始 Yrs 更新；作者详情以云端成员与本 CI 操作日志为准');
}
export async function pushCloudDocument(doc:SmartDocRecord,actor:Principal){
  if(!doc.cloud)return;const {c,s}=await authorized(actor,doc);
  await nativeSession(doc.body,async state=>{
    const body=nativeCall({action:'syncRequest',handle:state.handle}).body;
    const response=await request(c,`/api/workspace/v1/${c.workspaceId}/collab/${doc.cloud!.viewId}/full-sync`,'POST',Buffer.from(body,'base64'),s.access);
    if(response.status!==200||response.contentType.includes('json')){envelope(response);fail('CLOUD_SYNC_INVALID_RESPONSE');}
    const merged=nativeCall({action:'applySync',handle:state.handle,body:response.bytes.toString('base64')});
    acceptCloudState(doc,{...doc.body,docState:merged.docState},'合并云端 full-sync 并发响应');
    if(doc.cloud!.pending||!doc.cloud!.lastAcceptedAt)doc.cloud!.lastAcceptedAt=new Date().toISOString();
    doc.cloud!.pending=false;
  });
}
