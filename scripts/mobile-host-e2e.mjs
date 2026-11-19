// Monotonic device test. Never delegate installation/recovery to a command
// that automatically uninstalls a lower-version package and destroys QA data.
import {spawnSync} from 'node:child_process';
import {readFile}from'node:fs/promises';
import {fileURLToPath} from 'node:url';
const client=fileURLToPath(new URL('../../Muse-Client/',import.meta.url));
const cwd=client+'app/openmuse_mobile',pkg='com.openmuseai.mobile.acceptance';
const connectedDevices=spawnSync('adb',['devices'],{encoding:'utf8'}).stdout.split('\n').filter(l=>/\tdevice$/.test(l)).map(l=>l.split('\t')[0]);
const devices=process.env.ANDROID_SERIAL?connectedDevices.filter(id=>id===process.env.ANDROID_SERIAL):connectedDevices;
if(devices.length!==1)throw Error('Select exactly one authorized Android device with ANDROID_SERIAL when multiple are connected');
const current=spawnSync('adb',['shell','dumpsys','package',pkg],{encoding:'utf8'}).stdout.match(/versionCode=(\d+)/)?.[1];
const version=Number(process.env.CI_ANDROID_TEST_BUILD||Math.max(111805,Number(current||0)));
if(!Number.isSafeInteger(version)||version<=0||version>2100000000)throw Error('Invalid QA build number');
if(current&&Number(current)>version)throw Error('REFUSE_QA_DOWNGRADE: choose CI_ANDROID_TEST_BUILD >= installed version');
const smartdoc=process.argv.includes('--smartdoc');
const normalEntry=process.argv.includes('--normal-entry')||smartdoc;
const target=smartdoc?'integration_test/ci_smartdoc_live_test.dart':normalEntry?'integration_test/ci_normal_entry_live_test.dart':'integration_test/ci_host_live_e2e_test.dart';
const env={...process.env,OPENMUSE_ANDROID_DEBUG_APPLICATION_ID_SUFFIX:'.acceptance'};
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd,env,stdio:'inherit'});if(r.status!==0)throw Error(cmd+' failed; no uninstall fallback');};
let forwardedPort, testInstalled=false;
try{
 if(!process.argv.includes('--skip-build'))run('flutter',['build','apk','--debug','--target-platform=android-arm64','--target='+target,'--dart-define=OPENMUSE_RELEASE_MARKET=china','--dart-define=OPENMUSE_DISTRIBUTION_CHANNEL=android-cn','--dart-define=OPENMUSE_ACCEPTANCE_LIVE_ACCOUNT=true','--dart-define=OPENMUSE_ACCEPTANCE_LIVE_DESKTOP=true','--dart-define=OPENMUSE_ACCEPTANCE_LIVE_AI=true','--build-name=1.0.2','--build-number='+version]);
 const apk=cwd+'/build/app/outputs/flutter-apk/app-debug.apk';
 if(!process.argv.includes('--skip-install'))run('adb',['install','-t','-r',apk]);
 testInstalled=true;
 if(smartdoc){const info=await readFile(new URL('../.data/cloud-acceptance.json',import.meta.url),'utf8');const r=spawnSync('adb',['shell','run-as',pkg,'sh','-c',"'cat > files/ci-cloud-e2e.json && chmod 600 files/ci-cloud-e2e.json'"],{input:info,encoding:'utf8',env});if(r.status!==0)throw Error('Native Cloud acceptance setup failed');}
 if(normalEntry){
   run('adb',['reverse','tcp:4180','tcp:4180']);
   run('adb',['shell','run-as',pkg,'rm','-f','files/ci-e2e-stage']);
   run('adb',['shell','run-as',pkg,process.env.CI_NATIVE_CAPTURE==='1'?'touch':'rm',...(process.env.CI_NATIVE_CAPTURE==='1'?[]:['-f']),'files/ci-e2e-capture-stages']);
 }else run('node',[fileURLToPath(new URL('./prepare-mobile-host-e2e.mjs',import.meta.url))]);
 run('adb',['shell','am','force-stop',pkg]);
 run('adb',['shell','run-as',pkg,'rm','-f','files/debug-vm-service-uri']);
 run('adb',['shell','am','start','-n',pkg+'/com.openmuseai.mobile.MainActivity']);
 let uri;
 for(let i=0;i<300;i++){
   const r=spawnSync('adb',['exec-out','run-as',pkg,'cat','files/debug-vm-service-uri'],{encoding:'utf8'});
   if(r.status===0&&r.stdout.startsWith('http:')){uri=new URL(r.stdout.trim());break;}
   await new Promise(r=>setTimeout(r,200));
 }
 if(!uri)throw Error('Debug VM service receipt missing');
 const forward=spawnSync('adb',['forward','tcp:0','tcp:'+uri.port],{encoding:'utf8'});
 if(forward.status!==0)throw Error('USB debug forwarding failed');
 forwardedPort=forward.stdout.trim();
 uri.hostname='127.0.0.1';uri.port=forwardedPort;
 // Only an authenticated loopback debugger URL is used; do not disable auth.
 run('flutter',['drive','-d',devices[0],'--target='+target,'--driver=test_driver/ci_host_driver.dart','--use-existing-app='+uri.href,'--keep-app-running']);
}finally{
 spawnSync('adb',['shell','run-as',pkg,'rm','-f','files/ci-e2e-account.json'],{stdio:'ignore'});
 if(forwardedPort)spawnSync('adb',['forward','--remove','tcp:'+forwardedPort],{stdio:'ignore'});
 if(testInstalled&&process.argv.includes('--restore-normal')){
   const installed=Number(spawnSync('adb',['shell','dumpsys','package',pkg],{encoding:'utf8'}).stdout.match(/versionCode=(\d+)/)?.[1]||0);
   const normalBuild=Math.max(version,installed)+1;
   if(normalBuild>2100000000)throw Error('QA build number exhausted; cannot safely restore');
   run('flutter',['build','apk','--debug','--target-platform=android-arm64','--target=lib/main.dart','--dart-define=OPENMUSE_RELEASE_MARKET=china','--dart-define=OPENMUSE_DISTRIBUTION_CHANNEL=android-cn','--build-name=1.0.2','--build-number='+normalBuild]);
   run('adb',['install','-t','-r',cwd+'/build/app/outputs/flutter-apk/app-debug.apk']);
   run('adb',['reverse','tcp:4180','tcp:4180']);
   run('adb',['shell','am','force-stop',pkg]);
   run('adb',['shell','am','start','-n',pkg+'/com.openmuseai.mobile.MainActivity']);
   console.log(JSON.stringify({normalQaRestored:true,build:normalBuild,usbBridge:'ready'}));
 }
}
