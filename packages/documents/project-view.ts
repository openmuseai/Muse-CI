import type {Project} from '../contracts/index.ts';

// Execution content remains immutable in storage and is fetched by
// ci_artifact_get. Canvas responses carry history and provenance, not bytes.
export function projectWithArtifactMetadata(project:Project){
 return {...project,graph:{...project.graph,nodes:project.graph.nodes.map(node=>({...node,attempts:node.attempts.map(attempt=>({...attempt,artifacts:attempt.artifacts.map(({content,...metadata})=>({...metadata,byteLength:Buffer.byteLength(content,'utf8'),contentAvailable:true}))}))}))}};
}
