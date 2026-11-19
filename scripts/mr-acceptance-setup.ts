// Creates a small, reviewable fixture on two dedicated branches. Never targets
// the default/release branch and never publishes the local dirty checkout.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {gitProfileToken,verifyGitProfile} from '../packages/providers/git-profiles.ts';
process.env.CI_GIT_PROFILES=new URL('../.data/git-profiles.json',import.meta.url).pathname;
const stateFile=new URL('../.data/mr-acceptance.json',import.meta.url),repository='openmuseai/openmuse';
const identity=await verifyGitProfile('openmuseai',repository);
if(!identity.apiAuthenticated||identity.permissions?.push!==true)throw Error('OWNER_API_WRITE_REQUIRED');
const {token}=await gitProfileToken('openmuseai');
async function api(path:string,method='GET',body?:unknown,missing=false){
 const r=await fetch('https://api.github.com/repos/'+repository+path,{method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(missing&&r.status===404)return undefined;if(!r.ok)throw Error('GITHUB_FIXTURE_HTTP_'+r.status);
 return await r.json() as any;
}
let state:any;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch{const id=randomUUID().slice(0,8);state={repository,baseBranch:'codex/ci-acceptance-'+id+'-base',sourceBranch:'codex/ci-acceptance-'+id+'-head',file:'docs/ci-acceptance/mr-'+id+'.md',id};await writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});}
if(state.repository!==repository||!state.baseBranch.startsWith('codex/ci-acceptance-')||!state.sourceBranch.startsWith('codex/ci-acceptance-'))throw Error('FIXTURE_SCOPE_MISMATCH');
if(!state.baseSha){const repo=await api('');const branch=await api('/branches/'+encodeURIComponent(repo.default_branch));state.baseSha=branch.commit.sha;await writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});}
for(const name of [state.baseBranch,state.sourceBranch]){
 const ref=await api('/git/ref/heads/'+name,'GET',undefined,true);
 if(!ref)await api('/git/refs','POST',{ref:'refs/heads/'+name,sha:state.baseSha});
}
const text='# Muse-CI merge request acceptance\n\nFixture: '+state.id+'\n\nThis document verifies draft creation, ready-for-review, exact-head checks and merge receipt reconciliation between dedicated acceptance branches. It does not declare the mobile app released or its release remediation completed.\n';
let file=await api('/contents/'+state.file+'?ref='+encodeURIComponent(state.sourceBranch),'GET',undefined,true);
if(!file){const branch=await api('/git/ref/heads/'+state.sourceBranch);if(branch.object.sha!==state.baseSha)throw Error('FIXTURE_SOURCE_CHANGED');await api('/contents/'+state.file,'PUT',{message:'test(ci): add isolated MR acceptance fixture',branch:state.sourceBranch,content:Buffer.from(text).toString('base64'),committer:{name:'openmuseai',email:'openmuseai@outlook.com'}});file=await api('/contents/'+state.file+'?ref='+encodeURIComponent(state.sourceBranch));}
if(Buffer.from(file.content,'base64').toString()!==text)throw Error('FIXTURE_CONTENT_MISMATCH');
const head=await api('/git/ref/heads/'+state.sourceBranch);state.headSha=head.object.sha;state.preparedAt=new Date().toISOString();await writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});
console.log(JSON.stringify({repository,baseBranch:state.baseBranch,sourceBranch:state.sourceBranch,headSha:state.headSha,isolated:true}));
