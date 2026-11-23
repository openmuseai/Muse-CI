import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mobileInputManifest,isMobileTool } from './mobile-inputs.ts';
import type {Graph} from '../contracts/index.ts';
import { digest } from '../../apps/api/store.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
const backend = fileURLToPath(new URL('../../', import.meta.url)), plugin = fileURLToPath(new URL('../../plugin/', import.meta.url));
export async function sourceManifest(graph?:Graph,repositoryRoot?:string) {
    const files: {
        file: string;
        sha256: string;
    }[] = [];
    async function walk(base: string, relative: string, prefix: string) { for (const entry of (await readdir(base + relative, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink())
            throw Error('SOURCE_SYMLINK_DENIED');
        const file = relative + '/' + entry.name;
        if (entry.isDirectory())
            await walk(base, file, prefix);
        else if (!['bridge.js'].includes(entry.name) && /\.(ts|js|mjs|html|css)$/.test(entry.name))
            files.push({ file: prefix + file, sha256: digest(await readFile(base + file, 'utf8')) });
    } }
    for (const directory of ['apps', 'packages', 'tests', 'scripts'])
        await walk(backend, directory, 'backend/');
    for (const directory of ['web', 'scripts', 'tests'])
        await walk(plugin, directory, 'plugin/');
    for(const file of ['package.json','package-lock.json','plugin/package.json'])files.push({file:'backend/'+file,sha256:digest(await readFile(backend+file,'utf8'))});
    if(graph?.nodes.some(n=>n.config.tools.some(isMobileTool))){const mobile=await mobileInputManifest();files.push(...mobile.files);}
    if(repositoryRoot&&path.resolve(repositoryRoot)!==path.resolve(backend)){
        const listed=(await promisify(execFile)('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repositoryRoot,maxBuffer:8*1024*1024})).stdout.split('\0').filter(Boolean).sort();
        let bytes=0,count=0;
        for(const file of [...new Set(listed)]){
            if(/(^|\/)(\.muse[^/]*|\.data|node_modules|target|build|\.dart_tool)(\/|$)/.test(file)||! /\.(ts|js|mjs|css|html|json|dart|rs|py|go|swift|kt|java|c|cpp|h)$/.test(file))continue;
            if(path.isAbsolute(file)||file.split('/').includes('..'))throw Error('SOURCE_PATH_DENIED');
            const full=path.join(repositoryRoot,file),info=await lstat(full);if(info.isSymbolicLink())throw Error('SOURCE_SYMLINK_DENIED');
            if(++count>20000||info.size>16*1024*1024||(bytes+=info.size)>100*1024*1024)throw Error('REPOSITORY_SOURCE_LIMIT');
            files.push({file:'requirement/'+file,sha256:digest(await readFile(full,'utf8'))});
        }
    }
    return { digest: digest(files), files };
}
