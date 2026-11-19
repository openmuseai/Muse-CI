import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await mkdir(new URL('../.data/',import.meta.url),{recursive:true});const envFile=new URL('../.data/development.env',import.meta.url);let text=await readFile(envFile,'utf8').catch(()=>null);if(!text){const password=randomBytes(24).toString('hex');text=`CI_DATABASE_PASSWORD=${password}\nCI_DATABASE_URL=postgresql://muse_ci:${password}@127.0.0.1:15436/muse_ci\nCI_TEMPORAL_ADDRESS=127.0.0.1:17236\nCI_MCP_TOKEN=${randomBytes(32).toString('hex')}\n`;await writeFile(envFile,text,{mode:0o600});}
const action=process.argv[2]||'up';const result=spawnSync('docker',['compose','--env-file',envFile.pathname,'-f',new URL('../deployment/compose.yaml',import.meta.url).pathname,...(action==='up'?['up','-d','--wait']:action==='stop'?['stop']:['ps'])],{stdio:'inherit'});process.exitCode=result.status||0;
