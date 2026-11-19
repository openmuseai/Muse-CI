import{readFile,stat}from'node:fs/promises';
import{spawn}from'node:child_process';
import{fail}from'../../apps/api/store.ts';
type GitProfile={id:string;label:string;login:string;commitName:string;commitEmail:string;sshHost?:string;apiCredential:{kind:'env';name:string}|{kind:'file';path:string}|{kind:'git-helper';directory:string;username:string}};
export async function gitProfiles():Promise<GitProfile[]>{
 if(!process.env.CI_GIT_PROFILES)return [];
 const profiles=JSON.parse(await readFile(process.env.CI_GIT_PROFILES,'utf8'));
 if(!Array.isArray(profiles)||profiles.length>20||new Set(profiles.map(p=>p.id)).size!==profiles.length)fail('GIT_PROFILE_CONFIGURATION_INVALID');
 for(const p of profiles){
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(p.id)||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.login)||typeof p.label!=='string'||typeof p.commitEmail!=='string'||typeof p.commitName!=='string'||p.sshHost&&!/^[a-zA-Z0-9_.-]+$/.test(p.sshHost))fail('GIT_PROFILE_CONFIGURATION_INVALID');
  if(p.apiCredential?.kind==='env'){if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(p.apiCredential.name))fail('GIT_PROFILE_CONFIGURATION_INVALID');}
  else if(p.apiCredential?.kind==='file'){if(!p.apiCredential.path?.startsWith('/'))fail('GIT_PROFILE_CONFIGURATION_INVALID');}
  else if(p.apiCredential?.kind==='git-helper'){if(!p.apiCredential.directory?.startsWith('/')||/[\r\n]/.test(p.apiCredential.username)||p.apiCredential.username!==p.login)fail('GIT_PROFILE_CONFIGURATION_INVALID');}
  else fail('GIT_PROFILE_CONFIGURATION_INVALID');
 }
 return profiles;
}
export async function publicGitProfiles(){return (await gitProfiles()).map(({apiCredential,...p})=>({...p,apiCredentialSource:apiCredential.kind,sshCredentialSource:p.sshHost?'local-ssh-config':undefined}));}
export async function gitProfileToken(id:string){
 const p=(await gitProfiles()).find(p=>p.id===id);if(!p)fail('GIT_PROFILE_NOT_FOUND');
 if(p.apiCredential.kind==='env'){const token=process.env[p.apiCredential.name];if(!token)fail('MR_API_CREDENTIAL_REQUIRED');return {token,login:p.login};}
 if(p.apiCredential.kind==='file'){
  let metadata;try{metadata=await stat(p.apiCredential.path);}catch{fail('MR_API_CREDENTIAL_REQUIRED');}
  if(!metadata.isFile()||metadata.size>16384||metadata.mode&0o077)fail('GIT_CREDENTIAL_FILE_PERMISSIONS');
  const token=(await readFile(p.apiCredential.path,'utf8')).trim();if(!token||/[\r\n]/.test(token))fail('MR_API_CREDENTIAL_REQUIRED');return {token,login:p.login};
 }
 const config=p.apiCredential;
 const result=await new Promise<string>((resolve,reject)=>{
  const child=spawn('git',['-C',config.directory,'credential','fill'],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['pipe','pipe','ignore']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('MR_API_CREDENTIAL_REQUIRED'));},8000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>20000){child.kill();reject(Error('MR_API_CREDENTIAL_REQUIRED'));}});
  child.on('error',()=>{clearTimeout(timer);reject(Error('MR_API_CREDENTIAL_REQUIRED'));});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error('MR_API_CREDENTIAL_REQUIRED'));});
  child.stdin.end(`protocol=https\nhost=github.com\nusername=${config.username}\n\n`);
 });
 const credential=Object.fromEntries(result.split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
 if(!credential.password||credential.username!==p.login)fail('MR_API_CREDENTIAL_REQUIRED');return {token:credential.password,login:p.login};
}
export async function repositoryCredential(repo:{provider:string;gitProfileId?:string}){
 if(repo.gitProfileId)return gitProfileToken(repo.gitProfileId);
 const token=repo.provider==='github'?(process.env.CI_GITHUB_TOKEN||process.env.GITHUB_TOKEN||process.env.GH_TOKEN):process.env.CI_GITLAB_TOKEN;
 if(!token)fail('MR_PROVIDER_NOT_CONFIGURED');return {token,login:undefined};
}
export async function verifyGitProfile(id:string,repository?:string){
 const p=(await gitProfiles()).find(p=>p.id===id);if(!p)fail('GIT_PROFILE_NOT_FOUND');
 try{
  const {token}=await gitProfileToken(id);
  const response=await fetch('https://api.github.com/user',{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail('MR_API_CREDENTIAL_REQUIRED');const user:any=await response.json();if(user.login?.toLowerCase()!==p.login.toLowerCase())fail('GIT_API_ACCOUNT_MISMATCH');
  let permissions;if(repository){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))fail('REPOSITORY_INVALID');const r=await fetch('https://api.github.com/repos/'+repository,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)fail('REPOSITORY_ACCESS_DENIED');permissions=(await r.json() as any).permissions;}
  return {profileId:p.id,login:user.login,apiAuthenticated:true,permissions,sshHost:p.sshHost};
 }catch(error){const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'GIT_PROFILE_VERIFICATION_FAILED';return {profileId:p.id,login:p.login,apiAuthenticated:false,reason:code,sshHost:p.sshHost};}
}
