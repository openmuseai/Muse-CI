// Real PostgreSQL and filesystem verification in a disposable isolated schema.
// Never reads accounts or Git credentials, and never deletes application data.
import pg from 'pg';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,mkdir,rm,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {Store} from '../apps/api/store.ts';import {CIService} from '../apps/api/service.ts';import {Conventions} from '../packages/projects/conventions.ts';import {tick,claim,acceptResult} from '../packages/policy/engine.ts';import {execute} from '../packages/providers/index.ts';import {flushArchives} from '../packages/projects/archive.ts';
if(!process.env.CI_DATABASE_URL)throw Error('CI_DATABASE_URL_REQUIRED');
const schema='ci_hierarchy_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.CI_DATABASE_URL});
const url=new URL(process.env.CI_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
const store=new Store(url.toString()),root=await realpath(await mkdtemp(path.join(os.tmpdir(),'muse-ci-project-e2e-'))),files=new Conventions(root),owner={id:'hierarchy-owner'},other={id:'different-member'};const cases:string[]=[];
try{
 await admin.query('CREATE SCHEMA '+schema);await store.init();
 for(const dir of ['repo-a','repo-b','repo-a/nested']){await mkdir(path.join(root,dir),{recursive:true});execFileSync('git',['init','--quiet',path.join(root,dir)]);}
 await writeFile(path.join(root,'repo-a','entry.ts'),'export const version=1;\n');
 const service=new CIService(store,files),call=(name:string,args:any={},actor=owner)=>service.call(name,args,actor) as Promise<any>;
 await call('ci_managed_project_register',{id:'alpha',home:'repo-a',title:'Alpha',commandId:randomUUID()});await call('ci_managed_project_register',{id:'beta',home:'repo-b',title:'Beta',commandId:randomUUID()});
 await call('ci_managed_project_register',{id:'nested',home:'repo-a/nested',title:'Nested',commandId:randomUUID()});
 const catalog=await call('ci_catalog_get');assert.equal(catalog.projects.find((p:any)=>p.id==='nested').parentId,'alpha');assert.equal((await call('ci_catalog_get',{},other)).projects.length,0);cases.push('long-lived project roots, independent nested project, catalog authorization');
 const commandId=randomUUID(),input={managedProjectId:'alpha',versionName:'1.0.0',title:'Alpha delivery',goal:'Verify conventions',commandId};
 const version=(await call('ci_version_create',input)).project;assert.equal((await call('ci_version_create',input)).project.id,version.id);
 const beta=(await call('ci_version_create',{...input,managedProjectId:'beta',commandId:randomUUID()})).project;assert.notEqual(beta.hierarchy.versionRoot,version.hierarchy.versionRoot);cases.push('version idempotence and same version names isolated across projects');
 const config=path.join(root,'repo-a','.muse-project-alpha','project.json'),raw=JSON.parse(await readFile(config,'utf8'));raw.defaults.budget=90;await writeFile(config,JSON.stringify(raw));
 const result=await call('ci_requirement_create',{projectId:version.id,expectedVersion:version.version,title:'Repo backed development',goal:'Keep real materials',repositoryId:'main',commandId:randomUUID()});let requirement=await store.get(result.childProjectId);assert.equal(requirement.budget,90);assert.equal((await store.get(version.id)).budget,50);assert.equal(requirement.hierarchy?.repositoryRoot,path.join(root,'repo-a'));cases.push('declared repository roots and explicit config overrides for new development units');
 await assert.rejects(()=>call('ci_catalog_get',{managedProjectId:'alpha',versionId:beta.id}),/VERSION_PROJECT_MISMATCH/);
 await assert.rejects(()=>call('ci_requirement_repository_bind',{projectId:requirement.id,repositoryId:'main',expectedVersion:requirement.version,commandId:randomUUID()},other),/PROJECT_ACCESS_DENIED/);cases.push('cross-project context and unauthorized repository binding rejected');
 const legacy=(await call('ci_lifecycle_create',{kind:'version',title:'Original historical workflow',goal:'Keep identity and history',versionName:'1.0.0',commandId:randomUUID()})).project;
 await assert.rejects(()=>call('ci_version_attach',{managedProjectId:'alpha',projectId:legacy.id,expectedVersion:legacy.version,commandId:randomUUID()}),/VERSION_NAME_ALREADY_ASSIGNED/);assert.equal((await store.get(legacy.id)).hierarchy,undefined);cases.push('duplicate version claims roll back without reparenting history');
 const doc=Object.values(requirement.documents!).find(d=>d.nodeId==='feature-prd')!;
 await call('ci_document_publish',{projectId:requirement.id,expectedVersion:requirement.version,documentId:doc.id,expectedRevision:doc.revision,commandId:randomUUID()});requirement=await store.get(requirement.id);
 const started=await call('ci_run_command',{projectId:requirement.id,expectedVersion:requirement.version,action:'start',nodeIds:['feature-prd'],auto:false,commandId:randomUUID()});const run=started.project.runs.at(-1);assert.ok(run.projectContext.digest);
 await store.mutate(requirement.id,owner,undefined,undefined,{},p=>tick(p,run.id));const claimed=await store.mutate(requirement.id,owner,undefined,undefined,{},p=>claim(p,run.id,'feature-prd',1));
 const executed=await execute(claimed.node,claimed.attempt,claimed.consent,new AbortController().signal);assert.equal(executed.status,'succeeded');
 await store.mutate(requirement.id,undefined,undefined,undefined,{},p=>acceptResult(p,run.id,'feature-prd',1,claimed.lease,executed));await flushArchives(store,files);
 const archiveRoot=requirement.hierarchy!.archiveRoot,index=JSON.parse(await readFile(path.join(archiveRoot,'INDEX.json'),'utf8'));assert.equal(index.documents.find((d:any)=>d.id===doc.id).id,doc.id);const output=JSON.parse(await readFile(path.join(archiveRoot,'nodes/feature-prd/attempts/1/RESULT.json'),'utf8'));assert.equal(output.status,'succeeded');assert.equal(output.artifacts[0].producer,'smartdoc.snapshot');cases.push('real node execution pins project inputs and durable outbox archives native SmartDoc plus input/output provenance');
 raw.defaults.timeout=21;await writeFile(config,JSON.stringify(raw));await assert.rejects(async()=>service.assertProjectInputs(await store.get(requirement.id),run,owner),/PROJECT_INPUT_CHANGED/);cases.push('changed project configuration cannot reuse old execution approval');
 const unassigned=(await call('ci_catalog_get')).unassigned;assert.ok(unassigned.some((v:any)=>v.id===legacy.id));
 console.log(JSON.stringify({passed:true,cases,isolatedSchema:true,temporaryFixture:true}));
}finally{await store.close();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();await rm(root,{recursive:true,force:true});}
