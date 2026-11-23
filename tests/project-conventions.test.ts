import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Conventions,validateTemplate,type ManagedProject} from '../packages/projects/conventions.ts';
import {archiveWorkflow} from '../packages/projects/archive.ts';
import {initializeLifecycle,lifecycleTemplates} from '../packages/lifecycle/model.ts';
import {createDocument,editDocument} from '../packages/documents/smartdoc.ts';
import {newProject} from '../apps/api/service.ts';
import {digest} from '../apps/api/store.ts';
import {assertRepositoryTools} from '../packages/providers/index.ts';
const actor={id:'owner'};
async function fixture(t:any){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'muse-hierarchy-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'repo','.git'),{recursive:true});const files=new Conventions(root),project:ManagedProject={id:'sample',home:'repo',members:{owner:'owner'},createdAt:'test'};await files.initialize(project,'Sample');return {root,files,project,config:path.join(root,'repo','.muse-project-sample','project.json')};}
test('project conventions merge defaults, reject invalid overrides and isolate nested project configuration',async t=>{
 const {root,files,project,config}=await fixture(t);const baseline=await files.config(project);assert.equal(baseline.config.defaults.budget,50);assert.equal(baseline.templates.requirement[0].id,'prd');
 const raw=JSON.parse(await readFile(config,'utf8'));raw.defaults={budget:90};await writeFile(config,JSON.stringify(raw));const custom=await files.config(project);assert.equal(custom.config.defaults.budget,90);assert.equal(custom.config.defaults.timeout,20);
 await mkdir(path.join(root,'repo','nested'),{recursive:true});const child={...project,id:'nested',home:'repo/nested'};await files.initialize(child,'Child');assert.equal((await files.config(child)).config.defaults.budget,50);
 raw.misspelled=true;await writeFile(config,JSON.stringify(raw));await assert.rejects(()=>files.config(project));
 delete raw.misspelled;raw.repositories.push({...raw.repositories[0],path:'nested'});await writeFile(config,JSON.stringify(raw));await assert.rejects(()=>files.config(project),/unique/);
});
test('configuration and archives fail closed on traversal and symlink paths',async t=>{
 const {root,files,project}=await fixture(t);await assert.rejects(()=>files.resolve('../escape'));await assert.rejects(()=>files.resolve('/tmp/escape'));
 await symlink(os.tmpdir(),path.join(root,'repo','alias'));await assert.rejects(()=>files.resolve('repo/alias/report.json'),/SYMLINK/);
 const config=await files.config(project);await symlink(os.tmpdir(),path.join(config.root,'standards','external'));await assert.rejects(()=>files.executionContext(project,'owner',{projectId:'sample',versionId:'v',versionName:'1',projectRoot:config.root,versionRoot:config.root+'/versions/1',archiveRoot:config.root+'/versions/1'}),/SYMLINK/);
});
test('workflow overrides may add work without removing required deliveries or reordering gates',()=>{
 const template=lifecycleTemplates().requirement;template[0].name='Configured product definition';validateTemplate('requirement',template);
 const removed=structuredClone(template);removed[0].nodes=[];assert.throws(()=>validateTemplate('requirement',removed),/REQUIRED_DELIVERABLE/);
 assert.throws(()=>validateTemplate('requirement',[template[1],template[0],...template.slice(2)]),/STEP_ORDER/);
 const duplicate=structuredClone(template);duplicate[0].nodes.push(duplicate[0].nodes[0]);assert.throws(()=>validateTemplate('requirement',duplicate),/DUPLICATE/);
});
test('project skill and standards snapshots change digest and never grant an executor a different repository',async t=>{
 const {files,project}=await fixture(t),{root}=await files.config(project);await mkdir(path.join(root,'skills','review'),{recursive:true});await writeFile(path.join(root,'skills','review','SKILL.md'),'Inspect real changes');await writeFile(path.join(root,'standards','tests.md'),'Keep evidence');
 const hierarchy={projectId:project.id,versionId:'v1',versionName:'1.0',projectRoot:root,versionRoot:root+'/versions/1.0',archiveRoot:root+'/versions/1.0'};
 const first=await files.executionContext(project,'owner',hierarchy);assert.equal(first.skills[0].id,'review');assert.equal(first.standards[0].content,'Keep evidence');
 await writeFile(path.join(root,'standards','tests.md'),'Changed evidence rule');assert.notEqual((await files.executionContext(project,'owner',hierarchy)).digest,first.digest);
 assert.throws(()=>assertRepositoryTools(['ci-test'],os.tmpdir()),/REPOSITORY_MISMATCH/);assert.doesNotThrow(()=>assertRepositoryTools(['smartdoc-publish'],os.tmpdir()));
});
test('requirement roots preserve native revisions, immutable attempt inputs and real output hashes',async t=>{
 const {root,files,project}=await fixture(t),config=await files.config(project);const p=initializeLifecycle(await newProject(actor,'Requirement','Archive behavior'),'requirement');
 const archiveRoot=path.join(root,'repo','.muse','requirements',p.id);p.hierarchy={projectId:project.id,versionId:'v1',versionName:'1.0',projectRoot:config.root,versionRoot:config.root+'/versions/1.0',repositoryId:'main',repositoryRoot:path.join(root,'repo'),archiveRoot};
 const doc=createDocument(p,'Evidence','material',['Original']);editDocument(p,doc.id,doc.revision,[{op:'append',text:'Follow up'}],actor,false,'Retain original');
 const node=p.graph.nodes[0],content='actual output';node.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{config:'pinned'},startedAt:'start',finishedAt:'finish',logs:[],artifacts:[{name:'report.json',kind:'application/json',content,sha256:digest(content),producer:'real-test',inputDigest:'pin',createdAt:'test'}]});
 await archiveWorkflow(p,files);const first=await readFile(path.join(archiveRoot,'nodes',node.id,'attempts/1/INPUT.json'),'utf8');assert.equal(await readFile(path.join(archiveRoot,'documents',doc.id,'r1.sydoc'),'utf8'),JSON.stringify(doc.versions[0].body));
 await archiveWorkflow(p,files);assert.equal(await readFile(path.join(archiveRoot,'nodes',node.id,'attempts/1/INPUT.json'),'utf8'),first);
 node.attempts[0].inputSnapshot.config='different';await assert.rejects(()=>archiveWorkflow(p,files),/HISTORY_CONFLICT/);node.attempts[0].inputSnapshot.config='pinned';node.attempts[0].artifacts[0].content='corrupted';await assert.rejects(()=>archiveWorkflow(p,files),/ARTIFACT_INTEGRITY/);
});
test('simultaneous immutable writers cannot overwrite a prior material',async t=>{
 const {files,root}=await fixture(t),file=path.join(root,'repo','immutable.json');const results=await Promise.allSettled([files.write(file,'one',true),files.write(file,'two',true)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(['one','two'].includes(await readFile(file,'utf8')));
});
