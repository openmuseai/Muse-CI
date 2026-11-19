import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,rm}from'node:fs/promises';import os from'node:os';import path from'node:path';
import{gitProfileToken,publicGitProfiles,verifyGitProfile}from'../packages/providers/git-profiles.ts';
test('multiple Git identities resolve explicit credentials without disclosing them or inheriting another account',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ci-git-profiles-'));const previous=process.env.CI_GIT_PROFILES,token=process.env.CI_TEST_PROFILE_A;
 try{
  process.env.CI_GIT_PROFILES=path.join(dir,'profiles.json');process.env.CI_TEST_PROFILE_A='test-only-secret';delete process.env.CI_TEST_PROFILE_B;
  await writeFile(process.env.CI_GIT_PROFILES,JSON.stringify([{id:'owner',label:'Owner',login:'openmuseai',commitName:'openmuseai',commitEmail:'openmuseai@outlook.com',sshHost:'github-openmuseai',apiCredential:{kind:'env',name:'CI_TEST_PROFILE_A'}},{id:'other',label:'Other',login:'other',commitName:'',commitEmail:'',sshHost:'github-other',apiCredential:{kind:'env',name:'CI_TEST_PROFILE_B'}}]));
  const profiles=await publicGitProfiles();assert.equal(profiles.length,2);assert.equal(JSON.stringify(profiles).includes('test-only-secret'),false);assert.equal(JSON.stringify(profiles).includes('CI_TEST_PROFILE_A'),false);
  assert.deepEqual(await gitProfileToken('owner'),{token:'test-only-secret',login:'openmuseai'});await assert.rejects(gitProfileToken('other'),/MR_API_CREDENTIAL_REQUIRED/);
  const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response(JSON.stringify({login:'wrong-account'}));const result=await verifyGitProfile('owner');assert.equal(result.apiAuthenticated,false);assert.equal(result.reason,'GIT_API_ACCOUNT_MISMATCH');}finally{globalThis.fetch=original;}
 }finally{if(previous===undefined)delete process.env.CI_GIT_PROFILES;else process.env.CI_GIT_PROFILES=previous;if(token===undefined)delete process.env.CI_TEST_PROFILE_A;else process.env.CI_TEST_PROFILE_A=token;await rm(dir,{recursive:true,force:true});}
});
