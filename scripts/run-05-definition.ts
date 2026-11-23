import{readFile,writeFile,mkdir}from'node:fs/promises';import{Client,StreamableHTTPClientTransport}from'@modelcontextprotocol/client';import{sourceManifest}from'../packages/providers/source.ts';
const run=JSON.parse(await readFile('.data/iteration-05.json','utf8')),env=Object.fromEntries((await readFile('.data/development.env','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const client=new Client({name:'Muse-CI 0.5 definition execution',version:'0.4.0'});
async function call(name:string,args:any){const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content.filter(x=>x.type==='text').map((x:any)=>x.text).join('\n'));return r.structuredContent as any;}
const get=async(id:string)=>(await call('ci_project_get',{projectId:id})).project;
async function mutate(id:string,name:string,args:any){const p=await get(id);return call(name,{projectId:id,expectedVersion:p.version,commandId:crypto.randomUUID(),...args});}
async function configure(id:string,stages?:string[]){
 let p=await get(id);
 for(const stage of p.graph.stages.filter((s:any)=>!stages||stages.includes(s.id))){
  const made=await mutate(id,'ci_step_config_create',{stepId:stage.id});let doc=await call('ci_document_get',{projectId:id,documentId:made.documentId});p=await get(id);
  const code=doc.blocks.find((b:any)=>b.type==='code'),value=JSON.parse(code.text);let changed=false;
  for(const node of value.nodes)for(const material of node.config.materials){if(material.kind!=='smartdoc')continue;const d=p.lifecycle.documents.find((d:any)=>d.id===material.documentId);if(!d?.publishedRevision||d.publishedRevision!==d.revision)throw Error('MATERIAL_DRAFT_'+material.documentId);if(material.revision!==d.revision){material.revision=d.revision;changed=true;}}
  if(changed){await mutate(id,'ci_agent_document_edit',{documentId:doc.document.id,expectedRevision:doc.document.revision,summary:'将阶段配置材料绑定到已发布的新修订，保留其他配置',edits:[{op:'replace',blockId:code.id,text:JSON.stringify(value,null,2)}]});doc=await call('ci_document_get',{projectId:id,documentId:doc.document.id});}
  if(changed||doc.document.publishedRevision!==doc.document.revision)await mutate(id,'ci_document_publish',{documentId:doc.document.id,expectedRevision:doc.document.revision});
 }
}
async function execute(id:string,nodeIds:string[]){
 let p=await get(id);if(p.runs.some((r:any)=>!['succeeded','failed','canceled'].includes(r.status)))throw Error('EXISTING_RUN_REQUIRES_REVIEW');
 const expected=(await sourceManifest()).digest;
 const currentResultsValid=nodeIds.every(id=>p.graph.nodes.find((n:any)=>n.id===id)?.status==='succeeded');
 if(!currentResultsValid||!p.runs.some((r:any)=>r.status==='succeeded'&&r.sourceDigest===expected&&nodeIds.every(id=>r.selected.includes(id)))){
  const started=await mutate(id,'ci_run_command',{action:'start',nodeIds,auto:true});const end=Date.now()+180000;
  while(Date.now()<end){p=await get(id);const r=p.runs.find((r:any)=>r.id===started.runId);if(['failed','canceled'].includes(r.status))throw Error('ITERATION_RUN_'+r.status.toUpperCase()+':'+JSON.stringify(p.graph.nodes.filter((n:any)=>n.status==='failed').map((n:any)=>({id:n.id,errors:n.attempts.at(-1).logs.filter((l:any)=>l.level==='error').map((l:any)=>l.text)}))));if(r.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,400));}
  if(p.runs.find((r:any)=>r.id===started.runId)?.status!=='succeeded')throw Error('ITERATION_RUN_TIMEOUT');
 }
 p=await get(id);const receipt={projectId:id,title:p.title,sourceDigest:expected,run:p.runs.filter((r:any)=>r.status==='succeeded'&&r.sourceDigest===expected).at(-1),nodes:p.graph.nodes.filter((n:any)=>nodeIds.includes(n.id)).map((n:any)=>({id:n.id,status:n.status,attempt:n.attempts.at(-1)?.id,artifacts:n.attempts.at(-1)?.artifacts.map((a:any)=>({name:a.name,sha256:a.sha256,producer:a.producer})),stepConfiguration:n.attempts.at(-1)?.inputSnapshot.stepConfiguration?{documentId:n.attempts.at(-1).inputSnapshot.stepConfiguration.documentId,revision:n.attempts.at(-1).inputSnapshot.stepConfiguration.revision,sha256:n.attempts.at(-1).inputSnapshot.stepConfiguration.sha256}:undefined}))};if(receipt.nodes.length!==nodeIds.length||!receipt.nodes.every((n:any)=>n.status==='succeeded'))throw Error('CURRENT_ITERATION_RESULTS_NOT_VALID');console.log(JSON.stringify({project:id,passed:true,runId:receipt.run?.id}));return receipt;
}
try{await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));const receipts=[];
 for(const child of run.children){await configure(child.id,['prd','design','solution']);receipts.push(await execute(child.id,['feature-prd','feature-ui','feature-solution']));}
 await configure(run.versionProjectId,['definition','visual','requirements']);receipts.push(await execute(run.versionProjectId,['version-scope','version-ui','requirement-plan']));
 await mkdir('docs/releases/0.5.0/evidence',{recursive:true});await writeFile('docs/releases/0.5.0/evidence/ci-runs.json',JSON.stringify({at:new Date().toISOString(),receipts,releaseReady:false,pending:'Implementation, Mobile release installation, public authentication/deployment, physical device acceptance, MR and release remain incomplete'},null,2));
}finally{await client.close();}
