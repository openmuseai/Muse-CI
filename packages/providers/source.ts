import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mobileInputManifest,isMobileTool } from './mobile-inputs.ts';
import type {Graph} from '../contracts/index.ts';
import { digest } from '../../apps/api/store.ts';
const backend = fileURLToPath(new URL('../../', import.meta.url)), plugin = fileURLToPath(new URL('../../plugin/', import.meta.url));
export async function sourceManifest(graph?:Graph) {
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
    return { digest: digest(files), files };
}
