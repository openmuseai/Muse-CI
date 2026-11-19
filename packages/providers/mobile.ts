import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mobileRoot,mobileRelease,mobileInputManifest,mobileReleaseStatus} from './mobile-inputs.ts';
import {digest} from '../../apps/api/store.ts';
const exec=promisify(execFile);
export function mobileCommand(tool:string){
 const python=(...args:string[])=>({executable:'python3',args,cwd:mobileRoot});
 const flutter=(cwd:string,...tests:string[])=>({executable:process.env.CI_FLUTTER_EXECUTABLE||'flutter',args:['test','--no-pub','--reporter','expanded',...tests],cwd:mobileRoot+cwd});
 switch(tool){
 case 'mobile-closure-tests':return python('scripts/release/test_mobile_closure.py');
 case 'mobile-dependency-closure':return python('scripts/release/verify-mobile-closure.py','app/openmuse_mobile/.dart_tool/package_config.json');
 case 'mobile-regression':return flutter('app/openmuse_mobile','test/mobile_app_test.dart','test/mobile_apps_center_test.dart','test/mobile_file_viewer_test.dart','test/legacy_plugin_notice_test.dart');
 case 'mobile-source-inventory-tool-tests':return python('-m','unittest','discover','-s','scripts/release','-p','test_mobile_source_inventory.py','-v');
 case 'mobile-build-inputs-inventory':return python('scripts/release/mobile_source_inventory.py','--root',mobileRoot);
 case 'mobile-core-tests':return {executable:process.env.CI_DART_EXECUTABLE||'dart',args:['test','--reporter','expanded'],cwd:mobileRoot+'packages/muse_dsh_conversation_core'};
 case 'mobile-consent-tests':return {executable:process.env.CI_DART_EXECUTABLE||'dart',args:['test','test/send_consent_test.dart','--reporter','expanded'],cwd:mobileRoot+'packages/muse_dsh_conversation_core'};
 case 'mobile-resource-tests':return flutter('packages/openmuse_plugin_sdk','test/resource_close_barrier_test.dart','test/resource_close_tree_test.dart','test/resource_session_lifetime_test.dart');
 case 'mobile-pipeline-tests':return python('scripts/release/test_pipeline.py');
 case 'mobile-migration-tests':return flutter('packages/openmuse_mobile_plugin_runtime');
 case 'mobile-dataset-url-tests':return {executable:process.env.CI_FLUTTER_EXECUTABLE||'flutter',args:['test','--no-pub','--reporter','expanded','test/url_actions_test.dart'],cwd:mobileRoot+'../Muse-Plugin-Ecosystem/plugins/markdown/smart_document/dataset/flutter'};
 case 'mobile-uri-tests':return {executable:'cargo',args:['test','--locked','--offline','--manifest-path',mobileRoot+'../Muse-Plugin-Ecosystem/plugins/markdown/smart_document/rust/Cargo.toml'],cwd:mobileRoot};
 case 'mobile-privacy-tests':return flutter('app/openmuse_mobile','test/native_dsh_page_test.dart','test/workbuddy_controller_test.dart','test/workbuddy_shell_test.dart','test/remote_dsh_page_test.dart','test/remote_workbench_gateway_test.dart');
 case 'mobile-submit-gate':return python('scripts/release/pipeline.py','check','--run',mobileRelease,'--gate','09-submit');
 default:return null;
 }
}
export async function mobileInventory(){
 const inputs=await mobileInputManifest(),gate=await mobileReleaseStatus();
 const roots=['../Muse-Plugin-Ecosystem/plugins/markdown/smart_document/rust/src','../Muse-Plugin-Ecosystem/plugins/markdown/smart_document/dataset/flutter/lib','app/openmuse_mobile/lib'];const findings:{file:string;line:number;kind:string;excerpt:string}[]=[];
 async function visit(relative:string){for(const item of await readdir(mobileRoot+relative,{withFileTypes:true})){if(item.isSymbolicLink())continue;const path=relative+'/'+item.name;if(item.isDirectory())await visit(path);else if(/\.(rs|dart)$/.test(item.name)){const text=await readFile(mobileRoot+path,'utf8');for(const [index,line] of text.split('\n').entries()){if(/siyuan|genoffice|slides|legacy|migration/i.test(line))findings.push({file:path,line:index+1,kind:/siyuan|genoffice/i.test(line)?'excluded-identifier-reference':'upgrade-or-plugin-reference',excerpt:line.trim().slice(0,220)});}}}}
 for(const root of roots)await visit(root);
 const pkg=JSON.parse(await readFile(mobileRoot+'app/openmuse_mobile/.dart_tool/package_config.json','utf8'));const configUrl=new URL('file://'+mobileRoot+'app/openmuse_mobile/.dart_tool/package_config.json');const packages=[];for(const p of pkg.packages){const root=new URL(p.rootUri,configUrl);if(root.protocol!=='file:')continue;if(!root.pathname.endsWith('/'))root.pathname+='/';const notices=[];try{for(const name of await readdir(root)){if(/^(LICENSE|LICENCE|NOTICE|COPYING)(\.|$)/i.test(name)){try{notices.push({name,sha256:digest(await readFile(new URL(name,root),'utf8'))});}catch{}}}}catch{}packages.push({name:p.name,licenseFiles:notices});}
 return {generatedAt:new Date().toISOString(),inputDigest:inputs.digest,repositories:inputs.repositories,trackedInputCount:inputs.files.length,sourceFrozen:false,scope:'源码与解析依赖盘点，不是构建时 SBOM、迁移验收、版权结论或最终包零命中证明',findings,packages,gate};
}
