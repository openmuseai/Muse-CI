import path from 'node:path';
import {Conventions,key,type ManagedProject} from './conventions.ts';
import {Store,authorize,digest,fail} from '../../apps/api/store.ts';
import type {Principal,Project} from '../contracts/index.ts';

export class ProjectCatalog{
 constructor(readonly store:Store,readonly fs=new Conventions()){}
 async get(id:string,actor:Principal,write=false){
  const row=await this.store.pool.query('SELECT document FROM ci_managed_projects WHERE id=$1',[id]);const project=row.rows[0]?.document as ManagedProject;
  if(!project)fail('MANAGED_PROJECT_NOT_FOUND');if(!project.members[actor.id]||write&&project.members[actor.id]==='viewer')fail('PROJECT_ACCESS_DENIED');return project;
 }
 async register(actor:Principal,input:{id:string;home:string;title:string}){
  key.parse(input.id);const home=await this.fs.resolve(input.home),normalizedHome=path.relative(await this.fs.resolve('.'),home)||'.';
  const old=await this.store.pool.query('SELECT document FROM ci_managed_projects WHERE id=$1',[input.id]);
  if(old.rows[0]){const p=await this.get(input.id,actor,true);if(await this.fs.resolve(p.home)!==home)fail('PROJECT_ROOT_ALREADY_BOUND');return p;}
  const roots=(await this.store.pool.query('SELECT document FROM ci_managed_projects')).rows.map(r=>r.document as ManagedProject);
  const locations=await Promise.all(roots.map(async p=>({project:p,home:await this.fs.resolve(p.home)})));
  const parent=locations.filter(r=>home.startsWith(r.home+path.sep)).sort((a,b)=>b.home.length-a.home.length)[0]?.project;
  if(locations.some(r=>r.home===home))fail('PROJECT_HOME_ALREADY_REGISTERED');
  if(parent&&(!parent.members[actor.id]||parent.members[actor.id]==='viewer'))fail('PROJECT_ACCESS_DENIED');
  const project:ManagedProject={id:input.id,home:normalizedHome,members:{[actor.id]:'owner'},createdAt:new Date().toISOString(),...(parent?{parentId:parent.id}:{})};
  await this.fs.initialize(project,input.title);
  await this.store.pool.query('INSERT INTO ci_managed_projects VALUES($1,$2) ON CONFLICT DO NOTHING',[project.id,project]);
  return this.get(project.id,actor,true);
 }
 async catalog(actor:Principal,selectedId?:string,versionId?:string){
  const rows=await this.store.pool.query('SELECT document FROM ci_managed_projects ORDER BY id');
  const workflows=await this.store.list(actor),projects=[];
  for(const row of rows.rows){const p=row.document as ManagedProject;if(!p.members[actor.id])continue;
   try{const effective=await this.fs.config(p);projects.push({id:p.id,title:effective.config.title,parentId:p.parentId,rootNode:{id:'project:'+p.id,kind:'project',path:effective.root},configSource:effective.source,configDigest:effective.digest,repositories:effective.config.repositories,defaults:effective.config.defaults,versions:workflows.filter(w=>w.kind==='version'&&w.hierarchy?.projectId===p.id)});}
   catch{projects.push({id:p.id,title:p.id,parentId:p.parentId,error:'PROJECT_CONFIG_INVALID',versions:[]});}
  }
  const project=selectedId?projects.find(p=>p.id===selectedId):undefined;
  if(selectedId&&!project)fail('PROJECT_ACCESS_DENIED');
  const deliveries:any[]=[];
  if(versionId){const version=await this.store.get(versionId,actor);if(!project||version.hierarchy?.projectId!==project.id||version.lifecycle?.kind!=='version')fail('VERSION_PROJECT_MISMATCH');
   for(const flow of [version,...await Promise.all((version.lifecycle.children||[]).map(async c=>{try{return await this.store.get(c.projectId,actor);}catch{return undefined;}}))]){
    if(!flow||flow.hierarchy?.projectId!==project.id||flow.hierarchy.versionId!==version.id)continue;
    for(const doc of Object.values(flow.documents||{}).filter(d=>['version-prd','feature-prd','ui-design','solution','implementation','test-cases','test-report','requirement-plan','release-plan'].includes(d.kind)))deliveries.push({id:doc.id,title:doc.title,kind:doc.kind,workflowId:flow.id,scope:flow.title,revision:doc.revision,published:doc.publishedRevision===doc.revision});
    if(flow.lifecycle?.kind==='requirement')deliveries.push({id:'mr-'+flow.id,title:flow.title,kind:'mr',workflowId:flow.id,scope:flow.title,receipt:flow.mergeRequest?{number:flow.mergeRequest.number,state:flow.mergeRequest.state,draft:flow.mergeRequest.draft}:undefined});
   }
  }
  return {schema:'openmuse.project-catalog/1',projects,deliveries,unassigned:workflows.filter(w=>!w.hierarchy&&w.kind==='version'),workspace:{id:'workspace',title:path.basename(await this.fs.resolve('.'))},conventions:{project:'.muse-project-<id>/project.json',version:'versions/<version>/version.json',requirement:'<git-root>/.muse/requirements/<id>/requirement.json'}};
 }
 async binding(project:ManagedProject,flow:Project,version:Project,repositoryId?:string){
  if(flow.lifecycle?.kind!=='requirement'&&flow.id!==version.id)fail('WORKFLOW_KIND_INVALID');
  const name=key.parse(version.lifecycle?.versionName||version.id),root=await this.fs.root(project),versionRoot=path.join(root,'versions',name);
  const repository=repositoryId?await this.fs.repository(project,repositoryId):undefined;
  if(flow.lifecycle?.kind==='requirement'&&!repository)fail('REQUIREMENT_REPOSITORY_REQUIRED');
  return {projectId:project.id,versionId:version.id,versionName:name,projectRoot:root,versionRoot,...(repository?{repositoryId,repositoryRoot:repository.root}:{}),archiveRoot:repository?path.join(repository.root,'.muse','requirements',flow.id):versionRoot};
 }
 async writeProjectIndex(project:ManagedProject,actor:Principal){const c=await this.catalog(actor,project.id);await this.fs.json(path.join(await this.fs.root(project),'INDEX.json'),{schema:'openmuse.project-root/1',...c.projects.find(p=>p.id===project.id)});}
}
