import {Store,event} from '../../apps/api/store.ts';
import {pullCloudDocument,pushCloudDocument} from './workspace.ts';
import {invalidateDocumentConsumers} from '../lifecycle/model.ts';
import type {Principal} from '../contracts/index.ts';
import {cloudConfig} from './workspace.ts';
export async function cloudActorFor(store:Store,projectId:string):Promise<Principal>{
  const p=await store.get(projectId),config=await cloudConfig();
  const id=Object.keys(config.actors).find(id=>p.members[id]&&p.members[id]!=='viewer');
  if(!id)throw Error('CLOUD_PROJECT_MEMBER_UNAVAILABLE');return {id};
}
export async function flushCloudOutbox(store:Store){
  const rows=await store.pool.query("SELECT id FROM ci_projects WHERE jsonb_path_exists(document, '$.documents.*.cloud ? (@.pending == true)') LIMIT 10");
  for(const row of rows.rows){try{await synchronizeCloud(store,row.id,await cloudActorFor(store,row.id));}catch{/* Native pending updates remain persisted for the next retry. */}}
}
// Preserve pending local native updates before retrying the idempotent CRDT
// exchange. Failure never rolls back the accepted CI edit or drops its outbox.
export async function synchronizeCloud(store:Store,projectId:string,actor:Principal,documentId?:string){
  return store.mutate(projectId,undefined,undefined,undefined,{},async p=>{
    for(const doc of Object.values(p.documents||{}).filter(d=>d.cloud&&(!documentId||d.id===documentId))){
      const changed=await pullCloudDocument(doc,actor);
      if(changed){invalidateDocumentConsumers(p,doc.id);event(p,'document.cloud_updated',{documentId:doc.id,revision:doc.revision});}
      if(doc.cloud!.pending){await pushCloudDocument(doc,actor);event(p,'document.cloud_accepted',{documentId:doc.id,revision:doc.revision,acceptedAt:doc.cloud!.lastAcceptedAt});}
    }
    return {synced:true};
  });
}
