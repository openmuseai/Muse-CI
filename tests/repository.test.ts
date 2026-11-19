import test from 'node:test';import assert from 'node:assert/strict';
import {readMergeRequest,writeMergeRequest,validateRepository}from'../packages/providers/repository.ts';
const repo={provider:'github' as const,path:'example/project',baseBranch:'main',sourceBranch:'feature/lifecycle'};
const payload={merged:true,state:'closed',html_url:'https://github.com/example/project/pull/7',head:{sha:'a'.repeat(40),ref:'feature/lifecycle',repo:{full_name:'example/project'}},base:{ref:'main',repo:{full_name:'example/project'}},merge_commit_sha:'b'.repeat(40),draft:false};
async function environment(fn:()=>Promise<void>){const keys=['CI_MR_REPOSITORIES','CI_MR_WRITE_REPOSITORIES','CI_GITHUB_TOKEN','CI_GITLAB_TOKEN','CI_GITLAB_ORIGIN'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));process.env.CI_MR_REPOSITORIES='github:example/project,gitlab:example/project';process.env.CI_MR_WRITE_REPOSITORIES='github:example/project,gitlab:example/project';process.env.CI_GITHUB_TOKEN='test-only';try{await fn();}finally{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
test('MR verification binds trusted repository, exact branch and actual merge SHA without mutating the provider',()=>environment(async()=>{
 let calls=0;const request:typeof fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.github.com/repos/example/project/pulls/7');assert.equal(init?.method,undefined);assert.equal(init?.redirect,'error');return new Response(JSON.stringify(payload));};
 const r=await readMergeRequest(repo,7,request);assert.equal(r.state,'merged');assert.equal(r.mergeSha,'b'.repeat(40));assert.equal(calls,1);
 await assert.rejects(readMergeRequest({...repo,sourceBranch:'other'},7,request),/MR_RECEIPT_MISMATCH/);
 assert.throws(()=>validateRepository('github','untrusted/repository'),/REPOSITORY_NOT_TRUSTED/);
}));
test('MR writes require explicit admission and actual push permission before POST',()=>environment(async()=>{
 let writes=0;const request:typeof fetch=async(url,init)=>{if(init?.method)writes++;return new Response(JSON.stringify({permissions:{push:false}}));};
 await assert.rejects(writeMergeRequest(repo,{kind:'create',expectedHeadSha:'a'.repeat(40),title:'Feature',body:'Review',marker:'<!-- ci:test -->'},request),/MR_WRITE_PERMISSION_REQUIRED/);assert.equal(writes,0);
 process.env.CI_MR_WRITE_REPOSITORIES='';await assert.rejects(writeMergeRequest(repo,{kind:'merge',number:7,expectedHeadSha:'a'.repeat(40),marker:'ci'},request),/MR_WRITE_NOT_ENABLED/);assert.equal(writes,0);
}));
test('MR creation reconciles a previously delivered marked PR without another POST',()=>environment(async()=>{
 let posts=0;const marker='<!-- muse-ci:project:operation -->';const request:typeof fetch=async(url,init)=>{if(init?.method==='POST')posts++;const path=new URL(String(url)).pathname;return new Response(JSON.stringify(path.endsWith('/branches/feature%2Flifecycle')?{commit:{sha:'a'.repeat(40)}}:path.endsWith('/pulls')?[{number:7,body:marker}]:path.endsWith('/pulls/7')?{...payload,merged:false,state:'open',draft:true}:{permissions:{push:true}}));};
 const r=await writeMergeRequest(repo,{kind:'create',expectedHeadSha:'a'.repeat(40),title:'Feature',body:'Review',marker},request);assert.equal(r.number,7);assert.equal(r.draft,true);assert.equal(posts,0);
}));
test('MR submit uses actual ready-for-review mutation and verifies the same head',()=>environment(async()=>{
 let draft=true,submitted=false;const request:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname;let value:any={permissions:{push:true}};if(path.includes('/branches/'))value={commit:{sha:'a'.repeat(40)}};else if(path.endsWith('/pulls/7'))value={...payload,node_id:'PR_node',merged:false,state:'open',draft};else if(path==='/graphql'){const body=JSON.parse(String(init?.body));assert.equal(body.variables.id,'PR_node');assert.match(body.query,/markPullRequestReadyForReview/);draft=false;submitted=true;value={data:{markPullRequestReadyForReview:{pullRequest:{isDraft:false}}}};}return new Response(JSON.stringify(value));};
 const r=await writeMergeRequest(repo,{kind:'submit',number:7,expectedHeadSha:'a'.repeat(40),marker:'ci'},request);assert.equal(submitted,true);assert.equal(r.draft,false);
}));
test('MR merge pins source SHA and never overrides failed checks or changed head',()=>environment(async()=>{
 let writes=0;const request:typeof fetch=async(url,init)=>{if(init?.method)writes++;const path=new URL(String(url)).pathname;const value=path.includes('/branches/')?{commit:{sha:'a'.repeat(40)}}:path.endsWith('/pulls/7')?{...payload,merged:false,state:'open',draft:false}:path.endsWith('/status')?{statuses:[{}],state:'failure'}:path.endsWith('/check-runs')?{check_runs:[]}:{permissions:{push:true}};return new Response(JSON.stringify(value));};
 await assert.rejects(writeMergeRequest(repo,{kind:'merge',number:7,expectedHeadSha:'a'.repeat(40),marker:'ci'},request),/MR_CHECKS_NOT_PASSED/);assert.equal(writes,0);
 await assert.rejects(writeMergeRequest(repo,{kind:'merge',number:7,expectedHeadSha:'c'.repeat(40),marker:'ci'},request),/MR_HEAD_CHANGED/);assert.equal(writes,0);
}));
test('MR merge sends exact SHA and reads the actual merge commit after success',()=>environment(async()=>{
 let merged=false;const request:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname;let value:any={permissions:{push:true}};if(path.includes('/branches/'))value={commit:{sha:'a'.repeat(40)}};else if(path.endsWith('/pulls/7'))value={...payload,merged,state:merged?'closed':'open',draft:false};else if(path.endsWith('/status'))value={statuses:[],state:'pending'};else if(path.endsWith('/check-runs'))value={check_runs:[]};else if(path.endsWith('/reviews'))value=[];else if(path.endsWith('/merge')){assert.equal(init?.method,'PUT');assert.deepEqual(JSON.parse(String(init?.body)),{sha:'a'.repeat(40),merge_method:'squash'});merged=true;value={merged:true};}return new Response(JSON.stringify(value));};
 const r=await writeMergeRequest(repo,{kind:'merge',number:7,method:'squash',expectedHeadSha:'a'.repeat(40),marker:'ci'},request);assert.equal(r.state,'merged');assert.equal(r.mergeSha,'b'.repeat(40));assert.equal(JSON.stringify(r).includes('test-only'),false);
}));
test('wrong target, missing merged SHA and credential-bearing GitLab origin fail closed',()=>environment(async()=>{
 for(const data of [{...payload,base:{ref:'release'}},{...payload,merge_commit_sha:null},{...payload,html_url:'https://other.invalid/pull/7'}])await assert.rejects(readMergeRequest(repo,7,async()=>new Response(JSON.stringify(data))),/MR_RECEIPT_MISMATCH/);
 process.env.CI_GITLAB_TOKEN='test-only';process.env.CI_GITLAB_ORIGIN='https://user:password@example.test';let called=false;await assert.rejects(readMergeRequest({...repo,provider:'gitlab'},7,async()=>{called=true;return new Response();}),/MR_ORIGIN_INVALID/);assert.equal(called,false);
}));
test('same branch names in a fork do not satisfy the bound repository',()=>environment(async()=>{
 await assert.rejects(readMergeRequest(repo,7,async()=>new Response(JSON.stringify({...payload,head:{...payload.head,repo:{full_name:'outsider/project'}}}))),/MR_RECEIPT_MISMATCH/);
}));
test('merge receipt reconciliation survives automatic source branch removal',()=>environment(async()=>{
 let writes=0;const request:typeof fetch=async(url,init)=>{if(init?.method)writes++;const path=new URL(String(url)).pathname;if(path.includes('/branches/'))return new Response('{}',{status:404});return new Response(JSON.stringify(path.endsWith('/pulls/7')?payload:{permissions:{push:true}}));};
 const r=await writeMergeRequest(repo,{kind:'merge',number:7,expectedHeadSha:'a'.repeat(40),marker:'ci'},request);assert.equal(r.state,'merged');assert.equal(writes,0);
}));
