// Repair the actual retired-image blocker on the existing isolated source ref.
// Tests, protections, credentials and job steps remain intact.
import{readFile,writeFile}from'node:fs/promises';
import{gitProfileToken}from'../packages/providers/git-profiles.ts';
process.env.CI_GIT_PROFILES=new URL('../.data/git-profiles.json',import.meta.url).pathname;
const file=new URL('../.data/mr-acceptance.json',import.meta.url),s=JSON.parse(await readFile(file,'utf8'));
if(s.repository!=='openmuseai/openmuse'||!s.sourceBranch.startsWith('codex/ci-acceptance-')||!s.baseBranch.startsWith('codex/ci-acceptance-'))throw Error('ISOLATED_BRANCH_REQUIRED');
const{token}=await gitProfileToken('openmuseai');
async function api(path:string,method='GET',body?:unknown){const r=await fetch('https://api.github.com/repos/'+s.repository+path,{method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('RUNNER_MIGRATION_HTTP_'+r.status);return await r.json() as any;}
const ref=await api('/git/ref/heads/'+s.sourceBranch);if(ref.object.sha!==s.headSha)throw Error('SOURCE_HEAD_CHANGED');
const paths=['.github/workflows/clients.yml','.github/workflows/desktop-gates.yml'],changes=[];
for(const path of paths){const f=await api('/contents/'+path+'?ref='+s.headSha);const text=Buffer.from(f.content,'base64').toString();if(!/^\s+runs-on: macos-14\s*$/m.test(text))throw Error('EXPECTED_RETIRED_RUNNER_NOT_FOUND');changes.push({path,mode:'100644',type:'blob',content:text.replace(/^(\s+runs-on: )macos-14\s*$/gm,'$1macos-15')});}
const parent=await api('/git/commits/'+s.headSha);const tree=await api('/git/trees','POST',{base_tree:parent.tree.sha,tree:changes});
const commit=await api('/git/commits','POST',{message:'fix(ci): migrate retired macOS 14 gates to macOS 15',tree:tree.sha,parents:[s.headSha],committer:{name:'openmuseai',email:'openmuseai@outlook.com'}});
await api('/git/refs/heads/'+s.sourceBranch,'PATCH',{sha:commit.sha,force:false});
s.previousHeads=[...(s.previousHeads||[]),s.headSha];s.headSha=commit.sha;s.runnerMigration={paths,from:'macos-14',to:'macos-15',commit:commit.sha};await writeFile(file,JSON.stringify(s,null,2),{mode:0o600});
if(s.number){const pr=await api('/pulls/'+s.number);const marker=String(pr.body||'').match(/<!-- muse-ci:[a-zA-Z0-9:._-]+ -->/)?.[0]||'';await api('/pulls/'+s.number,'PATCH',{title:'fix(ci): migrate retired macOS 14 gates to macOS 15',body:'macOS and Mobile gates could not start because GitHub retired all macOS 14 runner images on November 2, 2026. Move these two gates to macos-15 while retaining their existing steps.\n\nValidation: hosted checks will run on this exact head. This MR also exercises Muse-CI draft creation, ready-for-review and verified merge between two dedicated acceptance branches; it does not publish an App or merge the local dirty checkout.\n\n'+marker});}
console.log(JSON.stringify({headSha:s.headSha,runnerMigration:s.runnerMigration,checksPreserved:true}));
