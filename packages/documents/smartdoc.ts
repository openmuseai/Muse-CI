// Reuse the shipped SmartDocument engine. Projection JSON is never authority;
// native Yrs docState is the only persisted collaborative body.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID, webcrypto } from 'node:crypto';
import { digest, fail } from '../../apps/api/store.ts';
import type { Project, Principal, SmartDocRecord } from '../contracts/index.ts';
import {cloudResourceUri} from './resource-uri.ts';
const assets = new URL('../../../Muse-Plugin-Ecosystem/plugins/markdown/smart_document/flutter/assets/wasm/', import.meta.url);
let runtime: any;
function engine() {
  if (!runtime) {
    const context = vm.createContext({ TextEncoder, TextDecoder, WebAssembly, crypto: webcrypto, console, moduleBytes: readFileSync(new URL('muse_smart_document_bg.wasm', assets)) });
    vm.runInContext(readFileSync(new URL('muse_smart_document.js', assets), 'utf8'), context, { timeout: 5000 });
    vm.runInContext('muse_smart_document_wasm.initSync({module:moduleBytes})', context, { timeout: 5000 });
    runtime = context.muse_smart_document_wasm;
  }
  return runtime;
}
export function nativeCall(input: any) {
  const reply = JSON.parse(engine().muse_smart_document_json(JSON.stringify(input)));
  if (!reply.ok) fail('SMARTDOC_OPERATION_REJECTED');
  return reply.data;
}
const call = nativeCall;
export async function nativeSession<T>(body: SmartDocRecord['body'], fn: (state:any)=>Promise<T>):Promise<T>{
  const state=call({action:'open',objectId:body.objectId,docState:body.docState});
  try{return await fn(state);}finally{call({action:'close',handle:state.handle});}
}
export function documentTree(body:SmartDocRecord['body']){
  return session(body,state=>{const data=state.data;const walk=(id:string):any=>{const b=data.blocks[id];return {type:b.ty,data:{...b.data,...(b.external_id?{delta:JSON.parse(data.meta.text_map?.[b.external_id]||'[]')}:{})},children:(data.meta.children_map[b.children]||[]).map(walk)};};return walk(data.page_id);});
}
export function acceptCloudState(doc:SmartDocRecord,body:SmartDocRecord['body'],summary:string){
  if(digest(doc.body)===digest(body))return false;
  doc.body=body;doc.revision++;stamp(doc,{id:'cloud-members'},'cloud',summary);return true;
}
function session<T>(body: SmartDocRecord['body'] | undefined, fn: (state: any) => T): T {
  const state = call({ action: 'open', objectId: body?.objectId || randomUUID(), ...(body ? { docState: body.docState } : {}) });
  try { return fn(state); } finally { call({ action: 'close', handle: state.handle }); }
}
const bodyOf = (state: any): SmartDocRecord['body'] => ({ profile: 'muse.smart-document/phase1', objectId: state.objectId, docState: state.docState });
export function blocks(state: any) {
  const data = state.data;
  const children = data.meta.children_map[data.blocks[data.page_id].children] || [];
  return children.map((id: string) => {
    const b = data.blocks[id], runs = JSON.parse(data.meta.text_map?.[b.external_id] || '[]');
    return { id, type: b.ty, text: runs.map((r: any) => r.insert || '').join(''), runs };
  });
}
export function nativeProjection(body: SmartDocRecord['body']) { return session(body, blocks); }
function node(text: string, type = 'paragraph', href?: string) {
  return { id: randomUUID(), type, data: { ...(type === 'heading' ? { level: 2 } : {}), ...(type === 'code' ? {language:'json'} : {}), delta: [{ insert: text, ...(href ? { attributes: { href } } : {}) }] } };
}
export function createDocument(p: Project, title: string, kind: string, text: string[], options: { stepId?: string; nodeId?: string; parentId?: string } = {}) {
  p.documents ??= {};
  if (Object.keys(p.documents).length >= 180) fail('SMARTDOC_LIMIT');
  const id = randomUUID();
  const body = session(undefined, state => {
    const output = call({ action: 'operations', handle: state.handle, operations: [{ op: 'insert', path: [0], nodes: text.map(t => node(t)) }] });
    return bodyOf(output);
  });
  const doc: SmartDocRecord = { id, title, kind, ...options, revision: 1, body, versions: [] };
  stamp(doc, { id: 'ci-system' }, 'system', '创建流程文档与交付约束');
  p.documents[id] = doc;
  return doc;
}
function stamp(doc: SmartDocRecord, actor: Principal, role: 'human' | 'agent' | 'system' | 'cloud', summary: string) {
  doc.versions.push({ revision: doc.revision, body: structuredClone(doc.body), sha256: digest(doc.body), actor: role === 'agent' ? 'muse-ci-agent' : actor.id, role, ...(role === 'agent' ? { onBehalfOf: actor.id } : {}), at: new Date().toISOString(), summary });
}
export function getDocument(p: Project, id: string) {
  const doc = p.documents?.[id];
  if (!doc) fail('SMARTDOC_NOT_FOUND');
  return doc;
}
export function documentView(p: Project, id: string, revision?: number) {
  const doc = getDocument(p, id);
  const version = revision ? doc.versions.find(v => v.revision === revision) : doc.versions.at(-1);
  if (!version) fail('SMARTDOC_REVISION_NOT_FOUND');
  return { document: { ...doc, body: version.body, revision: version.revision, versions: doc.versions.map(({ body, ...rest }) => rest) }, tree:documentTree(version.body), blocks: nativeProjection(version.body), nativeFile: { name: doc.title.replace(/[\\/:]/g, '-') + '.sydoc', mediaType: 'application/vnd.openmuse.smart-document+json', content: JSON.stringify(version.body) } };
}
export function editDocument(p: Project, id: string, revision: number, edits: any[], actor: Principal, asAgent: boolean, summary: string) {
  const doc = getDocument(p, id);
  if (asAgent && actor.id !== 'ci-system' && !p.lifecycle?.agentEnabled) fail('AGENT_COLLABORATION_REVOKED');
  if (doc.revision !== revision) fail('SMARTDOC_REVISION_CONFLICT');
  if (doc.versions.length >= 100) fail('SMARTDOC_HISTORY_LIMIT');
  const body = session(doc.body, state => {
    let current = state;
    for (const edit of edits) {
      const list = blocks(current);
      let op: any;
      if (edit.op === 'replace') {
        const index = list.findIndex((b: any) => b.id === edit.blockId);
        if (index < 0) fail('SMARTDOC_BLOCK_NOT_FOUND');
        const length = list[index].text.length; // native core and JS both use UTF-16.
        op = { op: 'update_text', path: [index], delta: [...(length ? [{ delete: length }] : []), ...(edit.text ? [{ insert: edit.text }] : [])] };
      } else {
        const target = edit.op === 'link' && (!edit.projectId || edit.projectId === p.id) ? getDocument(p,edit.documentId) : undefined;
        const href = edit.op === 'link' ? target?.cloud ? cloudResourceUri(target) : `muse://ci/${edit.projectId || p.id}/document/${edit.documentId}` : undefined;
        op = { op: 'insert', path: [list.length], nodes: [node(edit.text, edit.type, href)] };
      }
      current = call({ action: 'operations', handle: state.handle, operations: [op] });
    }
    return bodyOf(current);
  });
  if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 * 1024) fail('SMARTDOC_TOO_LARGE');
  doc.body = body; doc.revision++;
  if(doc.cloud)doc.cloud.pending=true;
  stamp(doc, actor, asAgent ? 'agent' : actor.id === 'ci-system' ? 'system' : 'human', summary);
  return doc;
}

// Upgrade only links to connected documents in this project. Text, block IDs,
// formatting and previous revisions survive. Arbitrary hrefs are not changed.
export function upgradeCloudDocumentLinks(p:Project,doc:SmartDocRecord,actor:Principal){
  if(!doc.cloud)return false;
  let changed=false;
  const body=session(doc.body,state=>{
    const operations:any[]=[];
    blocks(state).forEach((block:any,index:number)=>{
      let upgraded=false;
      const delta=block.runs.map((run:any)=>{
        const href=run.attributes?.href;
        const match=typeof href==='string'?/^muse:\/\/ci\/([A-Za-z0-9_-]+)\/document\/([A-Za-z0-9_-]+)$/.exec(href):null;
        const target=match?.[1]===p.id?p.documents?.[match[2]]:undefined;
        if(target?.cloud&&typeof run.insert==='string'){upgraded=true;return {retain:run.insert.length,attributes:{href:cloudResourceUri(target)}};}
        return {retain:typeof run.insert==='string'?run.insert.length:1};
      });
      if(upgraded)operations.push({op:'update_text',path:[index],delta});
    });
    if(!operations.length)return doc.body;
    changed=true;return bodyOf(call({action:'operations',handle:state.handle,operations}));
  });
  if(!changed)return false;
  doc.body=body;doc.revision++;doc.cloud.pending=true;
  stamp(doc,actor,'system','将已连接的子文档引用升级为原生账号绑定链接；保留文本与历史修订');
  return true;
}
export function publishDocument(p: Project, id: string, revision: number) {
  const doc = getDocument(p, id);
  if (revision !== doc.revision) fail('SMARTDOC_REVISION_CONFLICT');
  const text = nativeProjection(doc.body).map((b: any) => b.text).join('').trim();
  if (!text) fail('SMARTDOC_EMPTY');
  doc.publishedRevision = revision;
  return doc;
}
export function documentIndex(p: Project) {
  return Object.values(p.documents || {}).map(({ body, versions, ...metadata }) => ({ ...metadata, latestChange: versions.at(-1) ? (({ body, ...rest }) => rest)(versions.at(-1)!) : undefined }));
}
export function documentPin(p: Project, id: string, revision: number) {
  const doc = getDocument(p, id), v = doc.versions.find(v => v.revision === revision);
  if (!v || doc.publishedRevision !== revision || doc.revision !== revision) fail('SMARTDOC_NOT_PUBLISHED');
  return { name: doc.title + '.sydoc', content: JSON.stringify(v.body), sha256: digest(JSON.stringify(v.body)), type: 'application/vnd.openmuse.smart-document+json', documentId: id, revision };
}
// Worker-owned publication: artifact provenance comes from an accepted runner
// result, never from a document's prose or a client-supplied success flag.
export function archiveExecutionDocument(p: Project, nodeId: string, attempt: number, artifacts: {name:string;sha256:string;producer:string;content:string}[], actorRole: 'agent'|'system') {
  const doc=Object.values(p.documents||{}).find(d=>d.nodeId===nodeId);
  if(!doc||!artifacts.length||artifacts.every(a=>a.producer==='smartdoc.snapshot'))return;
  editDocument(p,doc.id,doc.revision,[{op:'append',text:`执行记录 · Attempt ${attempt}\n`+artifacts.map(a=>`${a.name}\n来源：${a.producer}\nSHA-256：${a.sha256}\n`+a.content.slice(0,5000)).join('\n\n')}],{id:'ci-system'},actorRole==='agent','归档实际 Runner 产物与摘要');
  publishDocument(p,doc.id,doc.revision);
}
