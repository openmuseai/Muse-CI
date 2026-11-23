import type {Project,Principal,SmartDocRecord} from '../contracts/index.ts';
import {getDocument,upgradeCloudDocumentLinks} from '../documents/smartdoc.ts';
import {cloudResourceUri} from '../documents/resource-uri.ts';
import {connectCloudDocument} from './workspace.ts';
import {fail} from '../../apps/api/store.ts';

export async function connectCloudDocumentTree(p:Project,id:string,actor:Principal,connect=connectCloudDocument,linkedProjects:Project[]=[]){
  const before=new Map(Object.values(p.documents||{}).map(d=>[d.id,{revision:d.revision,connected:!!d.cloud}]));
  const ordered:SmartDocRecord[]=[],visited=new Set<string>(),visiting=new Set<string>();
  const include=(doc:SmartDocRecord)=>{
    if(visiting.has(doc.id))fail('SMARTDOC_PARENT_CYCLE');if(visited.has(doc.id))return;
    visiting.add(doc.id);if(doc.parentId)include(getDocument(p,doc.parentId));
    visiting.delete(doc.id);visited.add(doc.id);ordered.push(doc);
  };
  const descend=(doc:SmartDocRecord,path=new Set<string>())=>{
    if(path.has(doc.id))fail('SMARTDOC_PARENT_CYCLE');include(doc);
    for(const child of Object.values(p.documents||{}).filter(d=>d.parentId===doc.id))descend(child,new Set([...path,doc.id]));
  };
  // Validate the whole requested subtree before the first external write.
  descend(getDocument(p,id));
  for(const doc of ordered)await connect(doc,actor,doc.parentId?getDocument(p,doc.parentId):undefined);
  const upgraded=Object.values(p.documents||{}).filter(d=>upgradeCloudDocumentLinks(p,d,actor,linkedProjects)).map(d=>d.id);
  const changed=Object.values(p.documents||{}).filter(d=>d.revision!==before.get(d.id)?.revision||!!d.cloud!==before.get(d.id)?.connected).map(d=>d.id);
  return {resourceUri:cloudResourceUri(getDocument(p,id)),connectedDocumentIds:ordered.map(d=>d.id),upgradedDocumentIds:upgraded,changedDocumentIds:changed};
}
