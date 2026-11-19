import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {mobileTrialDefinition,trialKey,trialGoal,trialTitle} from '../packages/workflows/mobile-isolation.ts';
import {mobileRoot,mobileRelease} from '../packages/providers/mobile-inputs.ts';
import {digest} from '../apps/api/store.ts';
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const origin=process.env.CI_ORIGIN||'http://127.0.0.1:4180',client=new Client({name:'Muse-CI first real Mobile pilot',version:'0.1.0'});
const out=mobileRoot+mobileRelease+'/muse-ci/';await mkdir(out,{recursive:true});
async function call(name:string,args:any={}){const result=await client.callTool({name,arguments:args});if(result.isError)throw Error(result.content.map((x:any)=>x.text||'').join('\n'));return result.structuredContent as any;}
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
 const template=await mobileTrialDefinition();let project=(await call('ci_projects_create',{title:trialTitle,goal:trialGoal,commandId:trialKey})).project;
 if(!project.graph.nodes.some((n:any)=>n.id==='M01')){
 if(project.type!=='Mobile 审核整改')project=(await call('ci_plan_save',{projectId:project.id,commandId:trialKey+'-scope',expectedVersion:project.version,title:trialTitle,goal:trialGoal,budget:100,type:'Mobile 审核整改'})).project;
 project=(await call('ci_graph_save',{projectId:project.id,commandId:trialKey+'-import',expectedVersion:project.version,definition:template.definition})).project;
 }
 await writeFile(out+'task-map.json',JSON.stringify({trialKey,...template.taskMap,inputReferences:template.inputs},null,2));
 let run=project.runs.at(-1);if(!run){const started=await call('ci_run_command',{projectId:project.id,commandId:trialKey+'-start',expectedVersion:project.version,action:'start',auto:true});project=started.project;run=project.runs.at(-1);}
 const receipt={trialKey,projectId:project.id,runId:run.id,startedAt:run.startedAt,version:'1.0.2',versionAndLanesLocked:false,sourceFrozen:false,sourceDigest:run.sourceDigest,graphRevision:run.revision,definitionDigest:digest(template.definition),projectUrl:origin+'/?project='+project.id,taskCount:24,machineCheckCount:8,nodeCount:project.graph.nodes.length,status:run.status,aiProviderConfigured:!!process.env.CI_AI_MCP_URL,formalRelease:false};
 await writeFile(out+'launch.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt,null,2));
 if(process.argv.includes('--wait')){const started=Date.now();let previous='';while(Date.now()-started<8*60000){project=(await call('ci_project_get',{projectId:project.id})).project;run=project.runs.at(-1);const checks=project.graph.nodes.filter((n:any)=>/^C\d\d$/.test(n.id));const status=checks.map((n:any)=>n.id+':'+n.status).join(' ');if(status!==previous){console.log(status);previous=status;}
 const busy=project.graph.nodes.some((n:any)=>n.status==='running');if(checks.every((n:any)=>['succeeded','failed'].includes(n.status))&&!busy){const exported=[];for(const n of project.graph.nodes){const a=n.attempts.at(-1);if(!a)continue;for(let index=0;index<a.artifacts.length;index++){const result=await call('ci_artifact_get',{projectId:project.id,nodeId:n.id,attempt:a.id,index});const file=n.id+'-'+a.id+'-'+index+'-'+result.artifact.name.replace(/[^A-Za-z0-9._-]/g,'_');await writeFile(out+file,result.artifact.content);exported.push({nodeId:n.id,attempt:a.id,file,sha256:result.artifact.sha256});}}
 const gate=await call('ci_release_check',{projectId:project.id});const summary={...receipt,status:run.status,observedAt:new Date().toISOString(),counts:{succeeded:project.graph.nodes.filter((n:any)=>n.status==='succeeded').length,failed:project.graph.nodes.filter((n:any)=>n.status==='failed').length,waiting:project.graph.nodes.filter((n:any)=>n.status==='awaiting_review').length,pending:project.graph.nodes.filter((n:any)=>n.status==='pending').length},checks:checks.map((n:any)=>({id:n.id,title:n.title,status:n.status,attempt:n.attempts.at(-1)?.id,errors:n.attempts.at(-1)?.logs.filter((l:any)=>l.level==='error').map((l:any)=>l.text.slice(-3000))})),waitingDecisions:project.graph.nodes.filter((n:any)=>n.status==='awaiting_review').map((n:any)=>({id:n.id,title:n.title,acceptance:n.config.goal})),gate,artifacts:exported,copyrightClearance:false,finalSignedPackageVerified:false};await writeFile(out+'result.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({status:summary.status,counts:summary.counts,checks:summary.checks.map((n:any)=>({id:n.id,status:n.status})),gateReady:gate.ready,resultFile:out+'result.json'},null,2));break;}
 await new Promise(r=>setTimeout(r,1500));}
 }
}finally{await client.close();}
