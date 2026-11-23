import path from 'node:path';
import {lstat,realpath,mkdir,readFile,writeFile,rename,unlink,link,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Project} from '../contracts/index.ts';
import {lifecycleTemplates} from '../lifecycle/model.ts';

export const key=z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const relative=z.string().min(1).max(300).refine(s=>!path.isAbsolute(s)&&!s.includes('\\')&&!s.split('/').includes('..')&&!s.includes('\0'),'Relative path without traversal required');
export const projectConfigSchema=z.object({
 schema:z.literal('openmuse.project/1'),id:key,title:z.string().min(1).max(100),goal:z.string().max(4000).default(''),
 repositories:z.array(z.object({id:key,title:z.string().min(1).max(100),path:relative,baseBranch:z.string().min(1).max(120).default('master')}).strict()).min(1).max(30).refine(repos=>new Set(repos.map(r=>r.id)).size===repos.length,'Repository IDs must be unique'),
 defaults:z.object({budget:z.number().int().min(1).max(1000).default(50),timeout:z.number().int().min(1).max(120).default(20),retries:z.number().int().min(0).max(5).default(0),skills:z.array(key).max(20).default([])}).strict().default({budget:50,timeout:20,retries:0,skills:[]}),
 skillsDirectory:relative.default('skills'),standardsDirectory:relative.default('standards')
}).strict();
export type ProjectConfig=z.infer<typeof projectConfigSchema>;
export interface ManagedProject {id:string;home:string;members:Project['members'];parentId?:string;createdAt:string;}
export interface HierarchyBinding {projectId:string;versionId:string;versionName:string;projectRoot:string;versionRoot:string;repositoryId?:string;repositoryRoot?:string;archiveRoot:string;}
export interface ProjectExecutionContext {actor:string;hierarchy:HierarchyBinding;digest:string;config:ProjectConfig;skills:{id:string;instructions:string;sha256:string}[];standards:{name:string;content:string;sha256:string}[];}
const templateSchema=z.array(z.object({id:key,name:z.string().min(1).max(80),nodes:z.array(z.tuple([key,z.string().min(1).max(100),z.enum(['product','ui','architecture','agent','test','build','approval','artifact']),key])).min(1).max(20)}).strict()).min(1).max(20);
export type WorkflowTemplate=z.infer<typeof templateSchema>;
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const isMissing=(e:any)=>e?.code==='ENOENT';
export class Conventions {
 constructor(readonly workspace=process.env.CI_PROJECT_WORKSPACE||process.cwd()){}
 async resolve(...segments:string[]){
  const base=await realpath(this.workspace);let current=base;
  for(const segment of segments){relative.parse(segment);for(const part of segment.split('/').filter(p=>p!=='.'&&p!=='')){
   current=path.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('PROJECT_SYMLINK_FORBIDDEN');current=await realpath(current);}catch(e){if(!isMissing(e))throw e;}
  }}
  if(current!==base&&!current.startsWith(base+path.sep))throw Error('PROJECT_PATH_OUTSIDE_WORKSPACE');return current;
 }
 async root(project:ManagedProject){return this.resolve(project.home,'.muse-project-'+key.parse(project.id));}
 async config(project:ManagedProject){
  const root=await this.root(project);let value:unknown;
  try{value=JSON.parse(await readFile(await this.resolve(project.home,'.muse-project-'+project.id,'project.json'),'utf8'));}catch(e){if(isMissing(e))throw Error('PROJECT_CONFIG_MISSING');throw e;}
  const config=projectConfigSchema.parse(value);if(config.id!==project.id)throw Error('PROJECT_CONFIG_ID_MISMATCH');
  for(const repo of config.repositories)await this.resolve(project.home,repo.path);
  for(const directory of [config.skillsDirectory,config.standardsDirectory])await this.resolve(project.home,'.muse-project-'+project.id,directory);
  const templates=lifecycleTemplates();
  for(const kind of ['version','requirement'] as const){
   const file=await this.resolve(project.home,'.muse-project-'+project.id,'workflows',kind+'.json');
   try{const custom=templateSchema.parse(JSON.parse(await readFile(file,'utf8')));validateTemplate(kind,custom);templates[kind]=custom;}catch(e){if(!isMissing(e))throw e;}
  }
  return {config,templates,root,digest:sha(JSON.stringify({config,templates})),source:path.join(root,'project.json')};
 }
 async initialize(project:ManagedProject,title:string){
  const home=await this.resolve(project.home);if(!(await lstat(home)).isDirectory())throw Error('PROJECT_HOME_NOT_DIRECTORY');
  const root=await this.root(project);await mkdir(root,{recursive:true});
  const config=projectConfigSchema.parse({schema:'openmuse.project/1',id:project.id,title,repositories:[{id:'main',title,path:'.'}]});
  try{await writeFile(path.join(root,'project.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});}catch(e:any){if(e.code!=='EEXIST')throw e;}
  for(const directory of ['skills','standards','documents','inputs','outputs','versions','workflows'])await mkdir(await this.resolve(project.home,'.muse-project-'+project.id,directory),{recursive:true});
  await this.config(project);return root;
 }
 async repository(project:ManagedProject,repositoryId:string){
  const {config}=await this.config(project),repo=config.repositories.find(r=>r.id===repositoryId);if(!repo)throw Error('PROJECT_REPOSITORY_NOT_DECLARED');
  const root=await this.resolve(project.home,repo.path);const git=await lstat(path.join(root,'.git')).catch(()=>{throw Error('REQUIREMENT_GIT_ROOT_REQUIRED');});if(git.isSymbolicLink())throw Error('PROJECT_SYMLINK_FORBIDDEN');return {root,repo};
 }
 async executionContext(project:ManagedProject,actor:string,hierarchy:HierarchyBinding):Promise<ProjectExecutionContext>{
  if(hierarchy.repositoryId&&(await this.repository(project,hierarchy.repositoryId)).root!==hierarchy.repositoryRoot)throw Error('REQUIREMENT_ROOT_CONFIGURATION_CHANGED');
  const effective=await this.config(project),skills:ProjectExecutionContext['skills']=[],standards:ProjectExecutionContext['standards']=[];let bytes=0,count=0;
  const collect=async(directory:string,kind:'skill'|'standard',prefix='',depth=0)=>{
   if(depth>4)throw Error('PROJECT_MATERIAL_DEPTH_LIMIT');
   const base=await this.resolve(project.home,'.muse-project-'+project.id,directory,prefix||'.');
   for(const entry of (await readdir(base,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink())throw Error('PROJECT_SYMLINK_FORBIDDEN');const rel=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isDirectory()){await collect(directory,kind,rel,depth+1);continue;}
    if(!entry.name.endsWith('.md'))continue;if(++count>100)throw Error('PROJECT_MATERIAL_COUNT_LIMIT');
    const info=await lstat(path.join(base,entry.name));if(info.size>128000||bytes+info.size>1000000)throw Error('PROJECT_MATERIAL_SIZE_LIMIT');
    const content=await readFile(path.join(base,entry.name),'utf8');bytes+=info.size;
    if(kind==='skill'){const id=key.parse(entry.name==='SKILL.md'?prefix:entry.name.slice(0,-3));if(skills.some(s=>s.id===id))throw Error('PROJECT_SKILL_DUPLICATE');skills.push({id,instructions:content,sha256:sha(content)});}
    else standards.push({name:rel,content,sha256:sha(content)});
   }
  };
  await collect(effective.config.skillsDirectory,'skill');await collect(effective.config.standardsDirectory,'standard');
  const digest=sha(JSON.stringify({config:effective.digest,skills,standards,hierarchy}));return {actor,hierarchy:structuredClone(hierarchy),config:effective.config,digest,skills,standards};
 }
 async write(file:string,content:string,immutable=false){
  const base=await realpath(this.workspace),rel=path.relative(base,file);await this.resolve(rel);
  await mkdir(path.dirname(file),{recursive:true});await this.resolve(rel);
  if(immutable){try{if(await readFile(file,'utf8')!==content)throw Error('ARCHIVE_HISTORY_CONFLICT');return;}catch(e){if(!isMissing(e))throw e;}}
  const temp=file+'.'+randomUUID()+'.tmp';try{
   await writeFile(temp,content,{flag:'wx',mode:0o600});
   if(immutable){try{await link(temp,file);}catch(e:any){if(e.code!=='EEXIST')throw e;if(await readFile(file,'utf8')!==content)throw Error('ARCHIVE_HISTORY_CONFLICT');}}
   else await rename(temp,file);
  }finally{await unlink(temp).catch(e=>{if(!isMissing(e))throw e;});}
 }
 async json(file:string,value:unknown,immutable=false){return this.write(file,JSON.stringify(value,null,2)+'\n',immutable);}
}
export function validateTemplate(kind:'version'|'requirement',steps:WorkflowTemplate){
 const base=lifecycleTemplates()[kind],ids=steps.map(s=>s.id),nodes=steps.flatMap(s=>s.nodes.map(n=>n[0]));
 if(new Set(ids).size!==ids.length||new Set(nodes).size!==nodes.length||nodes.length>60)throw Error('WORKFLOW_TEMPLATE_DUPLICATE_OR_LIMIT');
 if(steps.filter(s=>base.some(b=>b.id===s.id)).map(s=>s.id).join()!==base.map(s=>s.id).join())throw Error('WORKFLOW_REQUIRED_STEP_ORDER');
 for(const step of base)for(const node of step.nodes)if(!steps.find(s=>s.id===step.id)?.nodes.some(n=>n[0]===node[0]&&n[2]===node[2]&&n[3]===node[3]))throw Error('WORKFLOW_REQUIRED_DELIVERABLE');
}
