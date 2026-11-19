import vm from 'node:vm';
import{readFileSync}from'node:fs';
import{randomBytes,webcrypto}from'node:crypto';
import WebSocket from 'ws';
import{cloudConnection,cloudLookup}from'./workspace.ts';
import{nativeCall,blocks}from'../documents/smartdoc.ts';
import type{SmartDocRecord,Principal}from'../contracts/index.ts';
const assets=new URL('../../../Muse-Client/packages/muse_appflowy_realtime/assets/wasm/',import.meta.url);
let engine:any;
function wire(input:any){
 if(!engine){const ctx=vm.createContext({TextEncoder,TextDecoder,WebAssembly,crypto:webcrypto,console,moduleBytes:readFileSync(new URL('muse_appflowy_realtime_bg.wasm',assets))});vm.runInContext(readFileSync(new URL('muse_appflowy_realtime.js',assets),'utf8'),ctx);vm.runInContext('muse_appflowy_realtime_wasm.initSync({module:moduleBytes})',ctx);engine=ctx.muse_appflowy_realtime_wasm;}
 const r=JSON.parse(engine.muse_appflowy_realtime_call_json(JSON.stringify(input)));if(!r.ok)throw Error('CLOUD_REALTIME_CODEC_FAILED');return r.data;
}
type Active={socket:WebSocket;presence:string;clientId:string;actorUid:string;started:number;lastUsed:number;timer:ReturnType<typeof setInterval>;documentId:string;projectId:string;failure?:string};
const active=new Map<string,Active>();
function close(key:string){const s=active.get(key);if(!s)return;active.delete(key);clearInterval(s.timer);try{const left=wire({action:'presenceLeave',handle:s.presence,objectId:s.documentId,nowMs:Date.now()-s.started});if(s.socket.readyState===WebSocket.OPEN)s.socket.send(Buffer.from(wire({action:'encode',message:{kind:'awareness',objectId:s.documentId,collabType:0,awareness:left.awareness}}).frame,'base64'));}catch{}finally{try{wire({action:'presenceClose',handle:s.presence});}catch{}s.socket.close();}}
export function closeProjectAgentPresence(projectId:string){for(const[key,s]of active)if(s.projectId===projectId)close(key);}
export async function announceAgent(projectId:string,doc:SmartDocRecord,actor:Principal){
 if(!doc.cloud)return {connected:false,reason:'local-only'};
 const key=projectId+':'+doc.id;let s=active.get(key);
 if(s&&s.socket.readyState!==WebSocket.OPEN){close(key);s=undefined;}
 if(!s){
  if(active.size>=16)close(active.keys().next().value!);
  const c=await cloudConnection(doc,actor),uid=wire({action:'profileIdentity',body:c.profile.toString('base64')}).uid;
  const clientId=BigInt('0x'+randomBytes(8).toString('hex')).toString();
  const url=new URL(c.origin);url.protocol='wss:';url.pathname='/ws/v2/'+c.workspaceId;url.search=new URLSearchParams({token:c.token,deviceId:'muse-ci-agent-'+doc.id,clientId}).toString();
  // The URI contains the original browser-compatible auth. Never expose raw
  // socket errors, URI, profile bytes or token in logs, events or MCP results.
  const socket=new WebSocket(url,{lookup:cloudLookup,maxPayload:8*1024*1024,handshakeTimeout:10000,followRedirects:false});
  await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(Error('CLOUD_REALTIME_UNAVAILABLE')));});
  const started=Date.now(),presence=wire({action:'presenceOpen',objectId:doc.cloud.viewId,clientId,nowMs:0}).handle;
  const state:Active={socket,presence,clientId,actorUid:uid,started,lastUsed:started,documentId:doc.cloud.viewId,projectId,timer:setInterval(()=>{},10000)};
  clearInterval(state.timer);state.timer=setInterval(()=>{if(Date.now()-state.lastUsed>120000)return close(key);try{const p=wire({action:'presenceSet',handle:presence,objectId:state.documentId,nowMs:Date.now()-started,state:{schema:'muse.document.presence/1'}});send(state,{kind:'awareness',objectId:state.documentId,collabType:0,awareness:p.awareness});}catch{state.failure='CLOUD_REALTIME_FAILED';}},10000);state.timer.unref();
  socket.on('message',bytes=>{try{const packet=wire({action:'decode',frame:Buffer.from(bytes as Buffer).toString('base64')});if(packet.objectId&&packet.objectId!==state.documentId)return;if(packet.kind==='awareness')wire({action:'presenceApply',handle:presence,objectId:state.documentId,nowMs:Date.now()-started,awareness:packet.awareness});if(packet.kind==='access'&&(!packet.canRead||!packet.canWrite))close(key);}catch{state.failure='CLOUD_REALTIME_INVALID_FRAME';}});
  socket.on('error',()=>{state.failure='CLOUD_REALTIME_DISCONNECTED';});socket.on('close',()=>close(key));active.set(key,state);s=state;
 }
 s.lastUsed=Date.now();
 const state=nativeCall({action:'open',objectId:doc.body.objectId,docState:doc.body.docState});
 try{
  send(s,{kind:'manifest',objectId:doc.body.objectId,collabType:0,stateVector:state.stateVector,lastMessageId:'0-0'});
  send(s,{kind:'update',objectId:doc.body.objectId,collabType:0,update:doc.body.docState,lastMessageId:'0-0'});
  const block=blocks(state).at(-1);let selection:any;
  if(block){const anchor=nativeCall({action:'captureTextRange',handle:state.handle,blockId:block.id,start:0,end:0});delete anchor.text;selection={start:anchor,end:anchor};}
  const p=wire({action:'presenceSet',handle:s.presence,objectId:s.documentId,nowMs:Date.now()-s.started,state:{schema:'muse.document.presence/1',...(selection?{selection}:{})}});
  send(s,{kind:'awareness',objectId:doc.body.objectId,collabType:0,awareness:p.awareness});
 }finally{nativeCall({action:'close',handle:state.handle});}
 return {connected:s.socket.readyState===WebSocket.OPEN,clientId:s.clientId,actorUid:s.actorUid,identity:'delegated-cloud-member',idleTimeoutSeconds:120};
}
function send(s:Active,message:any){if(s.socket.readyState!==WebSocket.OPEN)throw Error('CLOUD_REALTIME_DISCONNECTED');s.socket.send(Buffer.from(wire({action:'encode',message}).frame,'base64'));}
