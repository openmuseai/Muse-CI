import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {parseLocalAccount} from '../packages/cloud/account-file.ts';
const root=new URL('../../',import.meta.url).pathname;
const pkg='com.openmuseai.mobile.acceptance';
if(process.argv.includes('--wait-install')){
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){const r=spawnSync('adb',['shell','pm','path',pkg],{encoding:'utf8'});if(r.status===0&&r.stdout.includes('package:'))break;await new Promise(r=>setTimeout(r,500));}
}
const env=Object.fromEntries((await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const client=new Client({name:'Mobile E2E setup',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4180/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.CI_MCP_TOKEN}}}));
const r=await client.callTool({name:'ci_projects_list',arguments:{}});
const project=r.structuredContent.projects.find(p=>p.title==='Desktop-Mobile CI 接入验收 2026-11-18');if(!project)throw Error('Desktop DSH E2E project missing');
const account=parseLocalAccount(await readFile(root+'Muse-Client/.account','utf8'));
const settings=JSON.parse(await readFile('/Users/mac/Library/Application Support/com.openmuseai.office/OpenMuse/settings-v1.json','utf8'));
const bootstrap={...account,desktopDeviceRef:settings.plugins['com.openmuse.device.identity'].deviceId,projectId:project.id};
const run=(argv,input)=>{const r=spawnSync(argv[0],argv.slice(1),{input,encoding:'utf8'});if(r.status!==0)throw Error('Provisioning failed: '+r.stderr);return r.stdout;};
run(['node',root+'Muse-Plugin-Ecosystem/plugins/muse-ci/scripts/install-development-hosts.mjs','--target','android','--package',pkg]);
run(['adb','shell','run-as',pkg,'sh','-c',"'cat > files/ci-e2e-account.json && chmod 600 files/ci-e2e-account.json'"],JSON.stringify(bootstrap));
run(['adb','shell','run-as',pkg,'rm','-f','files/ci-e2e-stage']);
if(process.env.CI_NATIVE_CAPTURE==='1')run(['adb','shell','run-as',pkg,'touch','files/ci-e2e-capture-stages']);
else run(['adb','shell','run-as',pkg,'rm','-f','files/ci-e2e-capture-stages']);
console.log(JSON.stringify({projectId:project.id,credentials:'app-private one-time import'}));
await client.close();
