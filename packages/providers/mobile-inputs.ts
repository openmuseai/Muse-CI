import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {digest} from '../../apps/api/store.ts';
const exec=promisify(execFile);
export const mobileRoot=fileURLToPath(new URL('../../../Muse-Client/',import.meta.url));
export const mobileRelease='docs/release/runs/2026-11-mobile-isolation';
export const mobileTools=['mobile-closure-tests','mobile-dependency-closure','mobile-regression','mobile-consent-tests','mobile-resource-tests','mobile-pipeline-tests','mobile-source-inventory','mobile-submit-gate','mobile-migration-tests','mobile-uri-tests','mobile-privacy-tests','mobile-dataset-url-tests','mobile-core-tests','mobile-source-inventory-tool-tests','mobile-build-inputs-inventory'];
export const isMobileTool=(tool:string)=>mobileTools.includes(tool);
const textFile=/\.(dart|ya?ml|lock|py|json|plist|gradle|kts|xml|kt|m|h|swift|podspec|toml|rs|js|ts|css|html|md)$/i;
export async function mobileInputManifest(){
 const groups=[{label:'Muse-Client',root:mobileRoot,paths:['app/openmuse_mobile','packages/muse_dsh_conversation_core','packages/openmuse_plugin_sdk','packages/openmuse_mobile_plugin_runtime','scripts/release','config/release']},{label:'Muse-Plugin-Ecosystem',root:fileURLToPath(new URL('../../../Muse-Plugin-Ecosystem/',import.meta.url)),paths:['plugins/markdown/smart_document/flutter/lib','plugins/markdown/smart_document/dataset/flutter/lib','plugins/markdown/smart_document/rust/src']}];
 const files:{file:string;sha256:string}[]=[],repositories:any[]=[];
 for(const group of groups){const head=(await exec('git',['rev-parse','HEAD'],{cwd:group.root})).stdout.trim();const listed=(await exec('git',['ls-files','--cached','--others','--exclude-standard','-z','--',...group.paths],{cwd:group.root,maxBuffer:8*1024*1024})).stdout.split('\0').filter(p=>p&&textFile.test(p)&&!/(^|\/)(build|target|node_modules|\.dart_tool)(\/|$)/.test(p));for(const path of [...new Set(listed)]){try{const info=await stat(group.root+path);if(info.size>4*1024*1024)continue;files.push({file:group.label+'/'+path,sha256:digest(await readFile(group.root+path,'utf8'))});}catch{files.push({file:group.label+'/'+path,sha256:'missing'});}}repositories.push({repository:group.label,head,scope:group.paths});}
 for(const path of ['app/openmuse_mobile/.dart_tool/package_config.json',mobileRelease+'/README.zh-CN.md',mobileRelease+'/tasks.json',mobileRelease+'/release.json',mobileRelease+'/REVIEW-RECOVERY.zh-CN.md','config/release/pipeline.json']){const text=await readFile(mobileRoot+path,'utf8');files.push({file:'Muse-Client/'+path,sha256:digest(text)});}
 files.sort((a,b)=>a.file.localeCompare(b.file));return {digest:digest(files),files,repositories,sourceFrozen:false,scope:'Selected tracked inputs and resolved Dart configuration; not a frozen build SourceSet or build SBOM'};
}
export async function mobileReleaseStatus(){const release=JSON.parse(await readFile(mobileRoot+mobileRelease+'/release.json','utf8')),pipeline=JSON.parse(await readFile(mobileRoot+'config/release/pipeline.json','utf8'));const stages=await Promise.all(pipeline.stages.map(async(s:any)=>{const record=JSON.parse(await readFile(mobileRoot+mobileRelease+'/stages/'+s.id+'.json','utf8'));return {id:s.id,name:s.title,status:record.status,needs:s.needs};}));return {ready:false,scope:'mobile-release-pilot',version:release.version,sourceFrozen:release.sourceFrozen,stages,missing:[...stages.filter(s=>s.status!=='passed').map(s=>s.id+' '+s.name),...(!release.sourceFrozen?['跨仓库源码尚未冻结']:[]),...(!release.artifacts.length?['没有最终签名候选包']:[])],message:'读取真实上架记录；没有通过的阶段、源码冻结与正式包不能提审。'};}
