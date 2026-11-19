import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const lines=(await readFile(new URL('../.data/development.env',import.meta.url),'utf8')).trim().split('\n').filter(line=>line.includes('='));const env={...process.env,...Object.fromEntries(lines.map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]))};
const children=['apps/api/main.ts','apps/worker/main.ts'].map(file=>spawn(process.execPath,['--import','tsx',file],{cwd:new URL('../',import.meta.url),env,stdio:'inherit'}));
const stop=()=>{for(const child of children)child.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);for(const child of children)child.once('exit',code=>{if(code)stop();});
