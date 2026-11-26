import type {Project} from '../contracts/index.ts';

// Canvas responses retain hashes and history. Immutable payloads remain in
// storage and are read through ci_artifact_get / ci_document_get on demand.
function contentMetadata(value:any, field='content'){
 if(!value||typeof value[field]!=='string')return value;
 const {[field]:content,...metadata}=value;
 return {...metadata,byteLength:Buffer.byteLength(content,'utf8'),contentAvailable:true};
}
function contextMetadata(context:any){
 if(!context)return context;
 return {...context,
  ...(context.skills?{skills:context.skills.map((s:any)=>contentMetadata(s,'instructions'))}:{}),
  ...(context.standards?{standards:context.standards.map((s:any)=>contentMetadata(s))}:{})};
}
function snapshotMetadata(snapshot:any){
 if(!snapshot)return snapshot;
 return {...snapshot,
  ...(snapshot.boundMaterials?{boundMaterials:snapshot.boundMaterials.map((m:any)=>contentMetadata(m))}:{}),
  ...(snapshot.projectContext?{projectContext:contextMetadata(snapshot.projectContext)}:{})};
}
export function projectWithArtifactMetadata(project:Project){
 return {...project,
  runs:project.runs.map(run=>({...run,...(run.projectContext?{projectContext:contextMetadata(run.projectContext)}:{})})),
  graph:{...project.graph,nodes:project.graph.nodes.map(node=>({...node,attempts:node.attempts.map(attempt=>({...attempt,
   inputSnapshot:snapshotMetadata(attempt.inputSnapshot),
   artifacts:attempt.artifacts.map(artifact=>contentMetadata(artifact)),
  }))}))}};
}
