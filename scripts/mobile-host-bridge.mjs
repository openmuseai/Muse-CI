// Explicit local development bridge; never publishes a listener or credentials.
// Bind to the initially selected USB device, and restore this one mapping after
// adb restarts/reconnections without touching other port forwards.
import {spawnSync} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
const once=process.argv.includes('--once');
let serial=process.env.ANDROID_SERIAL, last, restorations=0, lastRestoredAt;
const stateFile=new URL('../.data/mobile-host-bridge.json',import.meta.url);
const adb=(args)=>spawnSync('adb',args,{encoding:'utf8',timeout:5000});
await mkdir(new URL('../.data/',import.meta.url),{recursive:true});
async function tick(){
 const listing=adb(['devices']);
 if(listing.status!==0)return {status:'adb-unavailable'};
 const devices=listing.stdout.split('\n').filter(l=>/\tdevice$/.test(l.trim())).map(l=>l.split('\t')[0]);
 if(!serial){
   if(devices.length!==1)return {status:devices.length?'select-device-with-ANDROID_SERIAL':'waiting-for-authorized-device'};
   serial=devices[0];
 }
 if(!devices.includes(serial))return {status:'selected-device-disconnected'};
 const existing=adb(['-s',serial,'reverse','--list']);
 if(existing.status!==0)return {status:'reverse-list-unavailable'};
 const mappings=existing.stdout.trim().split('\n').map(l=>l.trim().split(/\s+/));
 if(!mappings.some(parts=>parts.at(-2)==='tcp:4180'&&parts.at(-1)==='tcp:4180')){
   const restored=adb(['-s',serial,'reverse','tcp:4180','tcp:4180']);
   if(restored.status!==0)return {status:'bridge-restore-failed'};
   restorations++;lastRestoredAt=new Date().toISOString();
 }
 let backend=false;
 try{backend=(await fetch('http://127.0.0.1:4180/',{signal:AbortSignal.timeout(2000)})).ok;}catch{}
 return {status:backend?'ready':'backend-unavailable',phonePort:4180,macPort:4180,restorations,lastRestoredAt};
}
for(;;){
 const state=await tick();
 await writeFile(stateFile,JSON.stringify({pid:process.pid,updatedAt:new Date().toISOString(),...state},null,2),{mode:0o600});
 const key=JSON.stringify(state);
 if(key!==last){console.log(JSON.stringify({at:new Date().toISOString(),...state}));last=key;}
 if(once){if(state.status!=='ready')process.exitCode=1;break;}
 await new Promise(resolve=>setTimeout(resolve,3000));
}
