import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {codingWritable,applyCodingCandidate,codexEvents} from '../packages/providers/coding.ts';
import {digest} from '../apps/api/store.ts';
test('coding executor restricts patches by task and preserves licenses, secrets and other repositories',()=>{
 assert.equal(codingWritable('mobile-fix-migration','Muse-Client/packages/openmuse_mobile_plugin_runtime/lib/src/mobile_plugin_store.dart'),true);
 for(const path of ['../Muse-Client/app/openmuse_mobile/lib/main.dart','Muse-Client/.env','Muse-Client/app/openmuse_mobile/LICENSE','Muse-CI/apps/api/service.ts','Muse-Client/docs/release/runs/2026-11-mobile-isolation/release.json'])assert.equal(codingWritable('mobile-fix-migration',path),false,path);
 assert.equal(codingWritable('mobile-audit-provenance','Muse-Client/app/openmuse_mobile/lib/main.dart'),false);
});
test('patch application checks all bases before writing and refuses symlink destinations',async()=>{
 const root=await mkdtemp(tmpdir()+'/muse-ci-patch-'),p='Muse-Client/app/openmuse_mobile/lib/a.dart',q='Muse-Client/app/openmuse_mobile/lib/b.dart';
 const change=(path:string,before:string|null,content:string)=>({path,before,content,after:digest(content)});
 try{
 await mkdir(root+'/Muse-Client/app/openmuse_mobile/lib',{recursive:true});await writeFile(root+'/'+p,'original');await writeFile(root+'/'+q,'concurrent');
 await assert.rejects(applyCodingCandidate([change(p,digest('original'),'next'),change(q,digest('different'),'next')],'mobile-fix-migration',root),/BASE_CHANGED/);
 assert.equal(await readFile(root+'/'+p,'utf8'),'original');
 await applyCodingCandidate([change(p,digest('original'),'next')],'mobile-fix-migration',root);assert.equal(await readFile(root+'/'+p,'utf8'),'next');
 await symlink(root+'/'+q,root+'/Muse-Client/app/openmuse_mobile/lib/link.dart');
 await assert.rejects(applyCodingCandidate([change('Muse-Client/app/openmuse_mobile/lib/link.dart',digest('concurrent'),'oops')],'mobile-fix-migration',root),/SYMLINK/);
 assert.equal(await readFile(root+'/'+q,'utf8'),'concurrent');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('executor completion requires a completed turn and excludes model reasoning from evidence',()=>{
 const result=codexEvents([JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'private'}}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}),JSON.stringify({type:'turn.completed',usage:{input_tokens:5}})].join('\n'));
 assert.equal(result.completed,true);assert.equal(JSON.stringify(result).includes('private'),false);
 assert.equal(codexEvents('{"type":"turn.completed"}\n{"type":"turn.failed"}').completed,false);
 assert.equal(codexEvents('{"type":"error","message":"Reconnecting..."}\n{"type":"turn.completed"}').completed,true);
 assert.equal(codexEvents('{"type":"error","message":"Disconnected"}').completed,false);
});
