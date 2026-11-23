// Origin-bound real PR/MR operations. Credentials remain server-side; callers
// cannot select arbitrary URLs or override branch protection.
import type { Project } from '../contracts/index.ts';
import {fail} from '../../apps/api/store.ts';
import {repositoryCredential}from'./git-profiles.ts';
export const trustedRepositories=()=> (process.env.CI_MR_REPOSITORIES||'').split(',').map(s=>s.trim()).filter(Boolean);
export function validateRepository(provider:string,path:string){
 if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(path)||path.split('/').some(p=>['.','..'].includes(p))||provider==='github'&&path.split('/').length!==2)fail('REPOSITORY_INVALID');
 if(!trustedRepositories().includes(provider+':'+path))fail('REPOSITORY_NOT_TRUSTED');
}
export async function readMergeRequest(repository:NonNullable<Project['repository']>,number:number,request:typeof fetch=fetch):Promise<NonNullable<Project['mergeRequest']>>{
 validateRepository(repository.provider,repository.path);
 const github=repository.provider==='github';
 const {token,login}=await repositoryCredential(repository);
 if(!token)fail('MR_PROVIDER_NOT_CONFIGURED');
 const gitlabOrigin=process.env.CI_GITLAB_ORIGIN;
 let api:string,web:string;
 if(github){api=`https://api.github.com/repos/${repository.path}/pulls/${number}`;web=`https://github.com/${repository.path}/pull/${number}`;}
 else{
  if(!gitlabOrigin)fail('MR_PROVIDER_NOT_CONFIGURED');
  const origin=new URL(gitlabOrigin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('MR_ORIGIN_INVALID');
  api=`${origin.origin}/api/v4/projects/${encodeURIComponent(repository.path)}/merge_requests/${number}`;web=`${origin.origin}/${repository.path}/-/merge_requests/${number}`;
 }
 if(login&&github){const r=await request('https://api.github.com/user',{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok||(await r.json() as any).login?.toLowerCase()!==login.toLowerCase())fail('GIT_API_ACCOUNT_MISMATCH');}
 const response=await request(api,{headers:github?{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'}:{'private-token':token},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(response.status===401||response.status===403)fail('MR_AUTH_REQUIRED');if(!response.ok)fail('MR_RECEIPT_UNAVAILABLE');
 const raw=await response.text();if(raw.length>1024*1024)fail('MR_RECEIPT_TOO_LARGE');const data=JSON.parse(raw);
 const state=(github?data.merged:data.state==='merged')?'merged':github?data.state:data.state==='opened'?'open':data.state;
 const headSha=github?data.head?.sha:data.sha,mergeSha=github?data.merge_commit_sha:data.merge_commit_sha;
 const baseBranch=github?data.base?.ref:data.target_branch,url=github?data.html_url:data.web_url,sourceBranch=github?data.head?.ref:data.source_branch;
 if(github?(data.head?.repo?.full_name!==repository.path||data.base?.repo?.full_name!==repository.path):(!Number.isSafeInteger(data.source_project_id)||data.source_project_id!==data.target_project_id))fail('MR_RECEIPT_MISMATCH');
 if(!['open','closed','merged'].includes(state)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(headSha||'')||url!==web||baseBranch!==repository.baseBranch||sourceBranch!==repository.sourceBranch||state==='merged'&&!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(mergeSha||''))fail('MR_RECEIPT_MISMATCH');
 return {provider:repository.provider,repository:repository.path,number,url: web,state,headSha,...(state==='merged'?{mergeSha}:{}),baseBranch,draft:!!(github?data.draft:data.draft||data.work_in_progress),verifiedAt:new Date().toISOString()};
}
type Repository=NonNullable<Project['repository']>;
export type MRAction={kind:'create'|'submit'|'merge';expectedHeadSha:string;number?:number;title?:string;body?:string;marker:string;method?:'merge'|'squash'|'rebase'};
async function endpoint(repo:Repository){
 validateRepository(repo.provider,repo.path);
 if(!(process.env.CI_MR_WRITE_REPOSITORIES||'').split(',').includes(repo.provider+':'+repo.path))fail('MR_WRITE_NOT_ENABLED');
 if(repo.sourceBranch===repo.baseBranch||!repo.sourceBranch||!repo.baseBranch)fail('MR_BRANCH_INVALID');
 const github=repo.provider==='github';let origin='https://api.github.com';
 if(!github){if(!process.env.CI_GITLAB_ORIGIN)fail('MR_PROVIDER_NOT_CONFIGURED');const u=new URL(process.env.CI_GITLAB_ORIGIN);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('MR_ORIGIN_INVALID');origin=u.origin;}
 const {token,login}=await repositoryCredential(repo);if(!token)fail('MR_PROVIDER_NOT_CONFIGURED');
 const headers:Record<string,string>=github?{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'}:{'private-token':token};
 return {github,origin,prefix:github?`/repos/${repo.path}`:`/api/v4/projects/${encodeURIComponent(repo.path)}`,headers,login};
}
export async function writeMergeRequest(repo:Repository,a:MRAction,request:typeof fetch=fetch){
 if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(a.expectedHeadSha))fail('MR_HEAD_SHA_REQUIRED');
 const api=await endpoint(repo);
 const call=async(path:string,method?:string,body?:unknown)=>{
  let r:Response;try{r=await request(api.origin+path,{...(method?{method}:{}),headers:{...api.headers,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{fail('MR_DELIVERY_UNCONFIRMED');}
  const raw=await r.text();if(raw.length>1024*1024)fail('MR_RECEIPT_TOO_LARGE');
  if([401,403].includes(r.status))fail('MR_WRITE_PERMISSION_REQUIRED');if([405,409,422].includes(r.status))fail('MR_PLATFORM_BLOCKED');if(!r.ok)fail(r.status>=500?'MR_DELIVERY_UNCONFIRMED':'MR_OPERATION_REJECTED');
  try{return JSON.parse(raw);}catch{fail('MR_INVALID_RESPONSE');}
 };
 if(api.login&&api.github){const user=await call('/user');if(user.login?.toLowerCase()!==api.login.toLowerCase())fail('GIT_API_ACCOUNT_MISMATCH');}
 const metadata=await call(api.prefix);
 if(api.github?metadata.permissions?.push!==true:Math.max(metadata.permissions?.project_access?.access_level||0,metadata.permissions?.group_access?.access_level||0)<30)fail('MR_WRITE_PERMISSION_REQUIRED');
 const verifyHead=async()=>{const branch=await call(api.github?api.prefix+'/branches/'+encodeURIComponent(repo.sourceBranch):api.prefix+'/repository/branches/'+encodeURIComponent(repo.sourceBranch));
 if(branch.commit?.sha!==a.expectedHeadSha&&branch.commit?.id!==a.expectedHeadSha)fail('MR_HEAD_CHANGED');};
 let number=a.number;
 if(a.kind==='create'){
  const list=await call(api.github?api.prefix+'/pulls?state=all&head='+encodeURIComponent(repo.path.split('/')[0]+':'+repo.sourceBranch)+'&base='+encodeURIComponent(repo.baseBranch):api.prefix+'/merge_requests?scope=all&state=all&source_branch='+encodeURIComponent(repo.sourceBranch)+'&target_branch='+encodeURIComponent(repo.baseBranch));
  if(!Array.isArray(list))fail('MR_INVALID_RESPONSE');
  const old=list.find((p:any)=>(p.body||p.description||'').includes(a.marker));
  if(old)number=api.github?old.number:old.iid;
  else{
   if(list.length)fail('MR_EXISTING_REQUEST_REQUIRES_REVIEW');
   await verifyHead();
   const created=await call(api.prefix+(api.github?'/pulls':'/merge_requests'),'POST',api.github?{title:a.title,body:(a.body||'')+'\n\n'+a.marker,head:repo.sourceBranch,base:repo.baseBranch,draft:true}:{title:'Draft: '+a.title,description:(a.body||'')+'\n\n'+a.marker,source_branch:repo.sourceBranch,target_branch:repo.baseBranch});
   number=api.github?created.number:created.iid;
  }
 }
 if(!Number.isSafeInteger(number)||!number)fail('MR_NUMBER_REQUIRED');
 const current=await readMergeRequest(repo,number!,request);
 if(current.headSha!==a.expectedHeadSha)fail('MR_HEAD_CHANGED');
 // Reconcile a delivered merge even when the platform removed its source ref.
 if(current.state==='merged'||a.kind==='create')return current;
 if(current.state!=='open')fail('MR_NOT_READY_FOR_MERGE');
 await verifyHead();
 if(a.kind==='submit'&&current.draft){
  if(api.github){
   const data=await call(api.prefix+'/pulls/'+number);if(!data.node_id)fail('MR_INVALID_RESPONSE');
   const result=await call('/graphql','POST',{query:'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id isDraft}}}',variables:{id:data.node_id}});
   if(result.errors?.length||result.data?.markPullRequestReadyForReview?.pullRequest?.isDraft!==false)fail('MR_SUBMISSION_UNCONFIRMED');
  }else{
   const data=await call(api.prefix+'/merge_requests/'+number);
   await call(api.prefix+'/merge_requests/'+number,'PUT',{title:String(data.title).replace(/^(?:Draft:|WIP:)\s*/i,''),draft:false});
  }
 }
 if(a.kind==='merge'){
  if(current.draft)fail('MR_NOT_READY_FOR_MERGE');
  // Platform checks and required reviews are authoritative. No force/admin
  // endpoint, branch protection modification or self-approval is available.
  if(api.github){
   const status=await call(api.prefix+'/commits/'+a.expectedHeadSha+'/status');
   const checks=await call(api.prefix+'/commits/'+a.expectedHeadSha+'/check-runs');
   if(!Array.isArray(status.statuses)||!Array.isArray(checks.check_runs)||checks.total_count!==undefined&&checks.total_count!==checks.check_runs.length)fail('MR_CHECKS_INCOMPLETE');
   if(status.statuses.length&&['failure','error'].includes(status.state)||checks.check_runs.some((v:any)=>v.status==='completed'&&!['success','neutral','skipped'].includes(v.conclusion)))fail('MR_CHECKS_NOT_PASSED');
   if(status.statuses.length&&status.state==='pending'||checks.check_runs.some((v:any)=>['queued','in_progress','waiting','pending'].includes(v.status)))fail('MR_CHECKS_PENDING');
   if(status.statuses.length&&status.state!=='success'||checks.check_runs.some((v:any)=>v.status!=='completed'))fail('MR_CHECKS_NOT_PASSED');
   const reviews=await call(api.prefix+'/pulls/'+number+'/reviews');const latest=new Map<string,string>();for(const r of reviews){if(['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))latest.set(r.user?.login,r.state);}if([...latest.values()].includes('CHANGES_REQUESTED'))fail('MR_CHANGES_REQUESTED');
   const result=await call(api.prefix+'/pulls/'+number+'/merge','PUT',{sha:a.expectedHeadSha,merge_method:a.method||'squash'});if(result.merged!==true)fail('MR_MERGE_UNCONFIRMED');
  }else{
   const data=await call(api.prefix+'/merge_requests/'+number);if(data.head_pipeline&&data.head_pipeline.status!=='success')fail('MR_CHECKS_NOT_PASSED');
   await call(api.prefix+'/merge_requests/'+number+'/merge','PUT',{sha:a.expectedHeadSha,squash:a.method==='squash',should_remove_source_branch:false});
  }
 }
 const receipt=await readMergeRequest(repo,number!,request);
 if(receipt.headSha!==a.expectedHeadSha||a.kind==='submit'&&receipt.draft||a.kind==='merge'&&receipt.state!=='merged')fail('MR_DELIVERY_UNCONFIRMED');
 return receipt;
}

/** Read-only, SHA-pinned review page. Credentials and arbitrary URLs stay server-side. */
export async function readMergeRequestDiff(repo:Repository,a:{number:number;expectedHeadSha:string;page:number},request:typeof fetch=fetch){
 const before=await readMergeRequest(repo,a.number,request);
 if(before.headSha!==a.expectedHeadSha)fail('MR_HEAD_CHANGED');
 const {token}=await repositoryCredential(repo),github=repo.provider==='github';
 const origin=github?'https://api.github.com':new URL(process.env.CI_GITLAB_ORIGIN!).origin;
 const prefix=github?`/repos/${repo.path}/pulls/${a.number}/files`:`/api/v4/projects/${encodeURIComponent(repo.path)}/merge_requests/${a.number}/diffs`;
 const r=await request(`${origin}${prefix}?per_page=30&page=${a.page}`,{headers:github?{authorization:'Bearer '+token,accept:'application/vnd.github+json'}:{'private-token':token},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)fail([401,403].includes(r.status)?'MR_AUTH_REQUIRED':'MR_DIFF_UNAVAILABLE');
 // Bound actual stream bytes; Content-Length may be absent or untrusted.
 const reader=r.body?.getReader();if(!reader)fail('MR_DIFF_INVALID');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>4*1024*1024){await reader!.cancel();fail('MR_DIFF_TOO_LARGE');}chunks.push(value);}
 let raw:any;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('MR_DIFF_INVALID');}
 if(!Array.isArray(raw)||raw.length>30)fail('MR_DIFF_INVALID');
 const files=raw.map((f:any)=>{const patch=github?f.patch:f.diff;return {path:github?f.filename:f.new_path,previousPath:github?f.previous_filename:f.old_path,status:github?f.status:f.new_file?'added':f.deleted_file?'removed':f.renamed_file?'renamed':'modified',additions:github?f.additions:undefined,deletions:github?f.deletions:undefined,patch:typeof patch==='string'?patch.slice(0,200000):null,patchUnavailable:typeof patch!=='string',truncated:typeof patch==='string'&&patch.length>200000||!!f.too_large||!!f.collapsed};});
 if(files.some(f=>typeof f.path!=='string'))fail('MR_DIFF_INVALID');
 const after=await readMergeRequest(repo,a.number,request);if(after.headSha!==before.headSha)fail('MR_HEAD_CHANGED');
 return {receipt:after,page:a.page,files,nextPage:r.headers.get('link')?.includes('rel="next"')||r.headers.get('x-next-page')?a.page+1:null,notice:'Patch may omit binary or platform-truncated content. Review is pinned to this head SHA; it is not approval.'};
}
