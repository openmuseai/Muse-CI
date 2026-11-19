import {digest,fail} from '../../apps/api/store.ts';
import type {Artifact,Project} from '../contracts/index.ts';
import {documentTree} from './smartdoc.ts';
export const smartDocumentMediaType='application/vnd.openmuse.smart-document+json';
export function artifactUri(projectId:string,nodeId:string,attempt:number,index:number){return `ci-artifact://${projectId}/${nodeId}/${attempt}/${index}`;}
export function artifactResource(projectId:string,nodeId:string,attempt:number,index:number,a:Artifact){
 if(digest(a.content)!==a.sha256)fail('ARTIFACT_INTEGRITY_FAILED');
 const uri=artifactUri(projectId,nodeId,attempt,index);
 return {uri,name:a.name,mimeType:a.kind,_meta:{sha256:a.sha256,immutable:true}};
}
export function artifactDocument(a:Artifact){
 if(a.kind!==smartDocumentMediaType&&!a.name.endsWith('.sydoc'))return undefined;
 let body;try{body=JSON.parse(a.content);}catch{fail('SMARTDOC_INVALID_ARTIFACT');}
 if(body.profile!=='muse.smart-document/phase1'||typeof body.objectId!=='string'||typeof body.docState!=='string')fail('SMARTDOC_INVALID_ARTIFACT');
 return {profile:body.profile,tree:documentTree(body),nativeFile:{name:a.name,mediaType:smartDocumentMediaType,content:a.content},readOnly:true};
}
export function artifactView(project:Project,nodeId:string,attempt:number,index:number){
 const a=project.graph.nodes.find(n=>n.id===nodeId)?.attempts.find(a=>a.id===attempt)?.artifacts[index];if(!a)fail('ARTIFACT_NOT_FOUND');
 const resource=artifactResource(project.id,nodeId,attempt,index,a);
 return {artifact:a,smartDocument:artifactDocument(a),resourceLink:'mcp-resource://io.openmuse.muse-ci/'+Buffer.from(resource.uri).toString('base64url')+'.'+a.sha256};
}
