import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/project-navigation.js',import.meta.url),'utf8');
async function setup(){
 const projects=[{id:'alpha',title:'Alpha <project>',repositories:[],versions:[{id:'alpha-1',title:'Alpha 1',hierarchy:{projectId:'alpha',versionId:'alpha-1',versionName:'1.0.0'}}]},{id:'beta',title:'Beta',repositories:[],versions:[]}];
 const runtime={remote:true,capabilities:{hierarchy:1},ready:Promise.resolve(),project:null,async call(name,args={}){assert.equal(name,'ci_catalog_get');return {projects,deliveries:args.versionId?[{id:'doc-a',kind:'solution',title:'<img src=x>',scope:'Alpha requirement',workflowId:'r-a',revision:1,published:true}]:[],unassigned:[]};},setProject(p){this.project=p;context.CIProjectNav?.adopt(p);},async select(id){const v=projects.flatMap(p=>p.versions).find(v=>v.id===id);this.setProject({...v,lifecycle:{documents:[]}});}};
 const context=vm.createContext({CIRuntime:runtime,document:{addEventListener(){},querySelectorAll(){return[];}},dispatchEvent(){},CustomEvent:class{}});vm.runInContext(source,context);await context.CIProjectNav.ready;return {navigation:context.CIProjectNav,runtime};
}
test('project selection keeps version and deliverables scoped, and clears them for an empty project',async()=>{
 const {navigation,runtime}=await setup();assert.equal(runtime.project.id,'alpha-1');assert.match(navigation.sidebar(),/Alpha requirement/);assert.doesNotMatch(navigation.sidebar(),/<img/);
 await navigation.selectProject('beta');assert.equal(runtime.project,null);assert.equal(navigation.catalog.deliveries.length,0);assert.equal(navigation.version(),undefined);assert.match(navigation.empty(),/Beta/);assert.doesNotMatch(navigation.controls(),/1\.0\.0/);
});
test('a version from another project is rejected without replacing the selected context',async()=>{
 const {navigation,runtime}=await setup();await assert.rejects(navigation.selectProject('beta','alpha-1'));assert.equal(runtime.project.id,'alpha-1');assert.equal(navigation.project().id,'alpha');assert.equal(runtime.switching,false);
});
test('a failed workflow load restores project, version and delivery context',async()=>{
 const {navigation,runtime}=await setup();const before=navigation.catalog;
 runtime.select=async()=>{throw Error('NETWORK_UNAVAILABLE');};
 await assert.rejects(navigation.selectProject('alpha','alpha-1'),/NETWORK_UNAVAILABLE/);
 assert.equal(runtime.project.id,'alpha-1');assert.equal(navigation.project().id,'alpha');assert.equal(navigation.catalog,before);assert.equal(runtime.switching,false);
});
