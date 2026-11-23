import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../apps/api/service.ts';
import {createDocument,editDocument,nativeProjection,nativeCall,upgradeCloudDocumentLinks} from '../packages/documents/smartdoc.ts';
import {cloudResourceUri} from '../packages/documents/resource-uri.ts';
import {connectCloudDocumentTree} from '../packages/cloud/document-tree.ts';
import type {SmartDocRecord} from '../packages/contracts/index.ts';
const actor={id:'owner'};
function bind(doc:SmartDocRecord,parent?:SmartDocRecord){doc.cloud={origin:'https://cn.example.test',workspaceId:'workspace',viewId:doc.body.objectId,subject:'member',parentViewId:parent?.cloud?.viewId||'root',connectedAt:'test'};return {resourceUri:cloudResourceUri(doc),cloud:doc.cloud};}
test('native child links retain block IDs, rich text, history and idempotence',async()=>{
 const p=await newProject(actor,'Links','Public test'),parent=createDocument(p,'Parent','handbook',['Keep me']),child=createDocument(p,'Child','material',['Child body'],{parentId:parent.id});
 editDocument(p,parent.id,parent.revision,[{op:'link',text:'子文档🔗',documentId:child.id}],actor,false,'Link before connection');
 const before=nativeProjection(parent.body),block=before.at(-1),s=nativeCall({action:'open',objectId:parent.body.objectId,docState:parent.body.docState});
 try{const r=nativeCall({action:'operations',handle:s.handle,operations:[{op:'update_text',path:[before.length-1],delta:[{retain:block.text.length,attributes:{bold:true}}]}]});parent.body.docState=r.docState;}finally{nativeCall({action:'close',handle:s.handle});}
 const old=parent.versions.at(-1)!.body.docState;bind(parent);bind(child,parent);
 assert.equal(upgradeCloudDocumentLinks(p,parent,actor),true);
 const after=nativeProjection(parent.body);assert.deepEqual(after.map((b:any)=>[b.id,b.text]),before.map((b:any)=>[b.id,b.text]));
 assert.equal(after.at(-1).runs[0].attributes.href,cloudResourceUri(child));assert.equal(after.at(-1).runs[0].attributes.bold,true);
 assert.equal(parent.versions.at(-2)!.body.docState,old);assert.equal(parent.cloud!.pending,true);
 const revision=parent.revision;assert.equal(upgradeCloudDocumentLinks(p,parent,actor),false);assert.equal(parent.revision,revision);
 editDocument(p,parent.id,parent.revision,[{op:'link',text:'New native reference',documentId:child.id}],actor,false,'After connection');assert.equal(nativeProjection(parent.body).at(-1).runs[0].attributes.href,cloudResourceUri(child));
});
test('connection plans ancestors and selected descendants before writes and archives beneath native parents',async()=>{
 const p=await newProject(actor,'Tree','Public test'),root=createDocument(p,'Root','handbook',[]),parent=createDocument(p,'Selected','material',[],{parentId:root.id}),child=createDocument(p,'Child','material',[],{parentId:parent.id}),other=createDocument(p,'Sibling','material',[],{parentId:root.id});
 editDocument(p,parent.id,parent.revision,[{op:'link',text:'Child',documentId:child.id}],actor,false,'Original link');
 const calls:string[]=[];const result=await connectCloudDocumentTree(p,parent.id,actor,async(d,_a,parent)=>{calls.push(d.id);return bind(d,parent);});
 assert.deepEqual(calls,[root.id,parent.id,child.id]);assert.equal(other.cloud,undefined);assert.equal(child.cloud!.parentViewId,parent.cloud!.viewId);assert.ok(result.upgradedDocumentIds.includes(parent.id));
 const again=await connectCloudDocumentTree(p,parent.id,actor,async(d,_a,parent)=>d.cloud?{resourceUri:cloudResourceUri(d),cloud:d.cloud}:bind(d,parent));assert.deepEqual(again.changedDocumentIds,[]);
 child.parentId=child.id;calls.length=0;
 await assert.rejects(()=>connectCloudDocumentTree(p,child.id,actor,async(d)=>{calls.push(d.id);return bind(d);}),/SMARTDOC_PARENT_CYCLE/);assert.deepEqual(calls,[]);
});
test('parent workflow links resolve only authorized children in the same cloud binding',async()=>{
 const parent=await newProject(actor,'Version','Parent'),child=await newProject(actor,'Requirement','Child');
 parent.lifecycle={kind:'version',children:[{projectId:child.id,title:child.title}],handbookId:'',agentEnabled:true};
 child.lifecycle={kind:'requirement',parentId:parent.id,children:[],handbookId:'',agentEnabled:true};
 const handbook=createDocument(parent,'Parent','handbook',['Preserve original']),target=createDocument(child,'Child','handbook',['Child body']);
 editDocument(parent,handbook.id,handbook.revision,[{op:'link',text:'子需求🔗',projectId:child.id,documentId:target.id}],actor,false,'Child process link');
 bind(handbook);bind(target);
 const original=handbook.body.docState,before=nativeProjection(handbook.body);
 delete child.members[actor.id];assert.equal(upgradeCloudDocumentLinks(parent,handbook,actor,[child]),false);
 child.members[actor.id]='owner';child.lifecycle.parentId='unrelated';assert.equal(upgradeCloudDocumentLinks(parent,handbook,actor,[child]),false);
 child.lifecycle.parentId=parent.id;
 for(const field of ['origin','subject','workspaceId'] as const){const value=target.cloud![field];target.cloud![field]='different';assert.equal(upgradeCloudDocumentLinks(parent,handbook,actor,[child]),false);target.cloud![field]=value;}
 const result=await connectCloudDocumentTree(parent,handbook.id,actor,async d=>({resourceUri:cloudResourceUri(d),cloud:d.cloud!}),[child]);
 assert.ok(result.upgradedDocumentIds.includes(handbook.id));
 const after=nativeProjection(handbook.body);assert.deepEqual(after.map((b:any)=>[b.id,b.text]),before.map((b:any)=>[b.id,b.text]));
 assert.equal(after.at(-1).runs[0].attributes.href,cloudResourceUri(target));assert.equal(handbook.versions.at(-2)!.body.docState,original);
 const revision=handbook.revision;assert.equal(upgradeCloudDocumentLinks(parent,handbook,actor,[child]),false);assert.equal(handbook.revision,revision);
});
