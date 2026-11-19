// Reuse only this same account's existing model route and its one credential
// reference. Never copy browser-session secrets or modify the daily profile.
import{readFile,writeFile,chmod,copyFile}from'node:fs/promises';
import{createHash}from'node:crypto';import{createRequire}from'node:module';
const require=createRequire(new URL('../../Muse-Client/target/dsh-closure/node_modules/@deepseek-ai/dsh/package.json',import.meta.url));
const yaml=require('yaml'),cloud=JSON.parse(await readFile(new URL('../.data/cloud.json',import.meta.url),'utf8'));
const scope=createHash('sha256').update(cloud.actors['local-developer']).digest('hex');
const home='/Users/mac/Library/Application Support/';
const source=home+'com.openmuseai.office/OpenMuse/accounts/'+scope+'/dsh/';
const target=home+'com.openmuseai.office.ciqa/OpenMuse/accounts/'+scope+'/dsh/';
const original=yaml.parse(await readFile(source+'profiles/web/cordis.patch.yml','utf8'));
const provider=original.find(e=>e.config?.providers?.['opencode-c']);
const selected=original.find(e=>e.config?.provider==='opencode-c');
if(!provider||!selected||new URL(provider.config.providers['opencode-c'].baseURL).origin!=='https://opencode.ai')throw Error('EXISTING_MODEL_ROUTE_MISMATCH');
const from=yaml.parse(await readFile(source+'.credentials.yaml','utf8'));
if(typeof from.refs?.OPENCODE_C_API_KEY!=='string'||!from.refs.OPENCODE_C_API_KEY)throw Error('EXISTING_MODEL_CREDENTIAL_REQUIRED');
const patch=target+'profiles/web/cordis.patch.yml',credentials=target+'.credentials.yaml';
const current=yaml.parse(await readFile(patch,'utf8'))||[],vault=yaml.parse(await readFile(credentials,'utf8'))||{};
if(vault.refs?.OPENCODE_C_API_KEY&&vault.refs.OPENCODE_C_API_KEY!==from.refs.OPENCODE_C_API_KEY)throw Error('QA_ALREADY_HAS_DIFFERENT_MODEL_CREDENTIAL');
const stamp=Date.now();for(const p of[patch,credentials]){await copyFile(p,p+'.before-ci-'+stamp);await chmod(p+'.before-ci-'+stamp,0o600);}
for(const entry of[provider,selected]){const old=current.find(e=>e.id===entry.id);if(old){old.config=entry===provider?{...old.config,providers:{...old.config?.providers,'opencode-c':entry.config.providers['opencode-c']}}:{...old.config,provider:entry.config.provider,model:entry.config.model};}else current.push(structuredClone(entry));}
vault.refs={...vault.refs,OPENCODE_C_API_KEY:from.refs.OPENCODE_C_API_KEY};
await writeFile(credentials,yaml.stringify(vault),{mode:0o600});await chmod(credentials,0o600);
await writeFile(patch,yaml.stringify(current),{mode:0o600});await chmod(patch,0o600);
console.log(JSON.stringify({sameAccount:true,modelGateway:'https://opencode.ai',model:selected.config.model,credential:'existing reference copied privately',browserSessionPreserved:true}));
