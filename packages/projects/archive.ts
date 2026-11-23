import path from 'node:path';
import {Conventions,key,sha} from './conventions.ts';
import type {Project} from '../contracts/index.ts';

export async function archiveWorkflow(p:Project,fs=new Conventions()){
 const h=p.hierarchy;if(!h)throw Error('WORKFLOW_PROJECT_NOT_ASSIGNED');
 const base=await fs.resolve(path.relative(await fs.resolve('.'),h.archiveRoot));
 const rootNode={id:(p.lifecycle?.kind||'workflow')+':'+p.id,kind:p.lifecycle?.kind||'workflow',path:h.repositoryRoot||base,archiveRoot:base};
 const documents=[];
 for(const doc of Object.values(p.documents||{})){
  const directory=path.join(base,'documents',key.parse(doc.id));
  for(const v of doc.versions)await fs.write(path.join(directory,'r'+v.revision+'.sydoc'),JSON.stringify(v.body),true);
  documents.push({id:doc.id,title:doc.title,kind:doc.kind,stepId:doc.stepId,nodeId:doc.nodeId,revision:doc.revision,publishedRevision:doc.publishedRevision,cloud:doc.cloud?{origin:doc.cloud.origin,workspaceId:doc.cloud.workspaceId,viewId:doc.cloud.viewId}:undefined,path:path.relative(base,path.join(directory,'r'+doc.revision+'.sydoc'))});
 }
 for(const node of p.graph.nodes)for(const attempt of node.attempts){
  const directory=path.join(base,'nodes',key.parse(node.id),'attempts',String(attempt.id));
  await fs.json(path.join(directory,'INPUT.json'),{schema:'openmuse.ci-input/1',projectId:h.projectId,versionId:h.versionId,workflowId:p.id,nodeId:node.id,attempt:attempt.id,runId:attempt.runId,inputDigest:attempt.inputDigest,snapshot:attempt.inputSnapshot},true);
  const artifacts=[];
  for(const [index,a] of attempt.artifacts.entries()){
   if(sha(a.content)!==a.sha256)throw Error('ARCHIVE_ARTIFACT_INTEGRITY');
   const ext=path.extname(a.name),file=path.join(directory,'artifacts',index+'-'+a.sha256+(/^\.[a-z0-9]{1,12}$/i.test(ext)?ext:'.bin'));
   await fs.write(file,a.content,true);artifacts.push({name:a.name,sha256:a.sha256,producer:a.producer,inputDigest:a.inputDigest,path:path.relative(base,file)});
  }
  const complete=!!attempt.finishedAt;
  await fs.json(path.join(directory,complete?'RESULT.json':'STATE.json'),{schema:'openmuse.ci-result/1',nodeId:node.id,attempt:attempt.id,status:attempt.status,runId:attempt.runId,startedAt:attempt.startedAt,finishedAt:attempt.finishedAt,logs:attempt.logs,artifacts},complete);
 }
 const index={schema:'openmuse.ci-root/1',rootNode,projectId:h.projectId,versionId:h.versionId,versionName:h.versionName,workflowId:p.id,workflowVersion:p.version,title:p.title,documents,requirements:p.lifecycle?.children||[],runs:p.runs.map(({id,status,startedAt,finishedAt,selected})=>({id,status,startedAt,finishedAt,selected})),mergeRequest:p.mergeRequest};
 await fs.json(path.join(base,p.lifecycle?.kind==='version'?'version.json':'requirement.json'),{schema:'openmuse.ci-unit/1',...h,workflowId:p.id,title:p.title});
 await fs.json(path.join(base,'INDEX.json'),index);
 if(p.lifecycle?.kind==='requirement')await fs.json(path.join(h.versionRoot,'requirements',p.id+'.json'),{schema:'openmuse.requirement-reference/1',workflowId:p.id,title:p.title,rootNode,repositoryId:h.repositoryId});
 return {state:'synced' as const,workflowVersion:p.version,rootNode,index:path.join(base,'INDEX.json'),documents:documents.length};
}

export async function flushArchives(store:any,fs=new Conventions()){
 const result=await store.pool.query('SELECT project_id,version FROM ci_archive_outbox ORDER BY project_id LIMIT 20');
 for(const row of result.rows){try{const p=await store.get(row.project_id);await archiveWorkflow(p,fs);await store.pool.query('DELETE FROM ci_archive_outbox WHERE project_id=$1 AND version<=$2',[p.id,p.version]);}catch{/* Accepted execution remains authoritative; explicit sync exposes failure and retries the retained outbox. */}}
}
