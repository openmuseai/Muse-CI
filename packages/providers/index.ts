import {mobileTools,isMobileTool} from './mobile-inputs.ts';
import {mobileCommand,mobileInventory} from './mobile.ts';
import {executeCoding,isCodingTool} from './coding.ts';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { GraphNode, Attempt, Artifact, Project } from '../contracts/index.ts';
import { skillRegistry } from './registry.ts';
import { digest, fail } from '../../apps/api/store.ts';
const backend = fileURLToPath(new URL('../../', import.meta.url)), plugin = fileURLToPath(new URL('../../plugin/', import.meta.url));
const knownTools = new Set([...mobileTools,'smartdoc-publish','doc-compile', 'ci-inspect', 'ci-plugin-test', 'ci-build', 'ci-test', 'ci-policy', 'ci-artifact-verify', 'ci-release-check', 'artifact-read']);
export async function command(command: string, args: string[], cwd: string, signal: AbortSignal, maxOutput = 128000) { return new Promise<{
    stdout: string;
    exitCode: number;
    command: string[];
}>((resolve, reject) => { let output = ''; const child = spawn(command, args, { cwd, signal, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); const collect = (b: Buffer) => { output += b.toString(); if (output.length > maxOutput) {
    child.kill('SIGTERM');
    output = output.slice(-maxOutput);
} }; child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', reject); child.on('exit', (code) => resolve({ stdout: output, exitCode: code ?? -1, command: [command, ...args] })); }); }
export function artifact(name: string, content: string, producer: string, inputDigest: string): Artifact { return { name, kind: name.endsWith('.md') ? 'text/markdown' : name.endsWith('.html') ? 'text/html' : 'application/json', content, sha256: digest(content), producer, inputDigest, createdAt: new Date().toISOString() }; }
export async function execute(node: GraphNode, attempt: Attempt, consent: Project['consent'], signal: AbortSignal) {
    const logs: {
        level: string;
        text: string;
    }[] = [], artifacts: Artifact[] = [];
    let status = 'succeeded', retryable = false;
    try {
        if((attempt.inputSnapshot.lifecycle||node.config.outputName.endsWith('.sydoc'))&&!node.config.tools.length)fail('TASK_EXECUTOR_NOT_CONFIGURED');
        if (node.config.skills.some(s => !skillRegistry.some(bound => bound.id === s)))
            fail('SKILL_PROVIDER_NOT_BOUND');
        if (node.config.materials.some(m => m.kind === 'file'))
            fail('MATERIAL_CONTENT_REQUIRED');
        if (node.kind === 'agent') {
            if(node.config.tools.some(isCodingTool))return await executeCoding(node,attempt,consent,signal);
            const url = process.env.CI_AI_MCP_URL;
            if (!url)
                fail('AI_PROVIDER_NOT_CONFIGURED');
            if (!consent || consent.recipient !== url || !['目标', '节点材料'].every(c => consent.categories.includes(c)))
                fail('AI_DATA_CONSENT_REQUIRED');
            const client = new Client({ name: 'muse-ci-worker', version: '0.1.0' });
            try {
                await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: process.env.CI_AI_MCP_TOKEN ? { authorization: 'Bearer ' + process.env.CI_AI_MCP_TOKEN } : {} } }));
                const result = await client.callTool({ name: process.env.CI_AI_MCP_TOOL || 'plan_propose', arguments: { goal: node.config.goal, materials: [...node.config.materials.filter(m => m.kind === 'note'), ...(attempt.inputSnapshot.boundMaterials || [])], skills: node.config.skills, allowedTools: node.config.tools, inputDigest: attempt.inputDigest } }, { signal } as any);
                if (result.isError)
                    fail('AI_PROVIDER_FAILED');
                artifacts.push(artifact('ai-proposal.json', JSON.stringify({ proposal: result, applied: false, recipient: url }, null, 2), 'ai.mcp', attempt.inputDigest!));
                logs.push({ level: 'info', text: '模型提案已保存，未把提案当作代码执行或验收结果。' });
            }
            finally {
                await client.close();
            }
        }
        else {
            for (const tool of node.config.tools)
                if (!knownTools.has(tool))
                    fail('TOOL_PROVIDER_NOT_BOUND');
            for (const tool of node.config.tools.length ? node.config.tools : ['doc-compile']) {
                if(status==='failed')break;
                if(tool==='smartdoc-publish'){
                    const pins=(attempt.inputSnapshot.boundMaterials||[]).filter((m:any)=>m?.type==='application/vnd.openmuse.smart-document+json');
                    if(!pins.length)fail('SMARTDOC_NOT_PUBLISHED');
                    for(const pin of pins)artifacts.push({...artifact(pin.name,pin.content,'smartdoc.snapshot',attempt.inputDigest!),kind:pin.type});
                    logs.push({level:'info',text:'归档已发布 SmartDoc 原生协作快照，保留文档修订与来源。'});continue;
                }
                if(isMobileTool(tool)){const spec=mobileCommand(tool);if(spec){const result=await command(spec.executable,spec.args,spec.cwd,signal,tool==='mobile-build-inputs-inventory'?1024*1024:128000);status=result.exitCode===0?'succeeded':'failed';logs.push({level:status==='succeeded'?'info':'error',text:result.stdout.slice(-12000)||'进程无输出'});artifacts.push(artifact(tool+'-report.json',JSON.stringify({...result,cwd:spec.cwd,realExecution:true,scope:'mobile-release-pilot',finalSignedPackageVerified:false,copyrightClearance:false},null,2),tool,attempt.inputDigest!));}else{const result=await mobileInventory();artifacts.push(artifact('mobile-source-inventory.json',JSON.stringify(result,null,2),tool,attempt.inputDigest!));logs.push({level:'info',text:'源码与解析依赖盘点已完成；发现项仍需审查，未批准版权、迁移或最终包。'});}}else if (tool === 'doc-compile') {
                    const text = '# ' + node.title + '\n\n' + node.config.goal + '\n\n' + node.config.skills.map(id => skillRegistry.find(s => s.id === id)!.instructions).join('\n') + '\n\n' + node.config.materials.filter(m => m.kind === 'note').map(m => '## ' + m.name + '\n\n' + m.text).join('\n\n') + '\n\n' + (attempt.inputSnapshot.boundMaterials || []).map((m: any) => '## ' + m.name + '\n\n' + m.content).join('\n\n');
                    const name = node.config.outputName || node.id + '.md';
                    const content = name.endsWith('.json') ? JSON.stringify({ document: text, format: 'markdown', source: 'versioned-materials' }, null, 2) : text;
                    artifacts.push({ ...artifact(name, content, 'document.compile', attempt.inputDigest!), kind: name.endsWith('.json') ? 'application/json' : 'text/markdown' });
                    logs.push({ level: 'info', text: '已编译版本化设计材料；来源为用户/工程材料，不冒充 AI 生成或人员批准。' });
                    if (node.kind === 'ui') {
                        const html = await readFile(plugin + 'web/index.html', 'utf8');
                        artifacts.push(artifact('ui-source.html', html, 'ui.source', attempt.inputDigest!));
                    }
                }
                else if (['ci-plugin-test', 'ci-build', 'ci-test', 'ci-policy'].includes(tool)) {
                    let args: string[], cwd = backend;
                    if (tool === 'ci-plugin-test') {
                        cwd = plugin;
                        const files = (await readdir(plugin + 'tests')).filter(f => f.endsWith('.test.mjs'));
                        args = ['--test', ...files.map(f => 'tests/' + f)];
                    }
                    else if (tool === 'ci-build') {
                        cwd = plugin;
                        args = ['scripts/build.mjs'];
                    }
                    else
                        args = ['--import', 'tsx', '--test', ...(tool === 'ci-policy'
                            ? ['tests/security.test.ts']
                            : (await readdir(backend + 'tests')).filter(f => f.endsWith('.test.ts')).sort().map(f => 'tests/' + f))];
                    const result = await command(process.execPath, args, cwd, signal);
                    status = result.exitCode === 0 ? 'succeeded' : 'failed';
                    retryable ||= result.exitCode !== 0;
                    logs.push({ level: status === 'succeeded' ? 'info' : 'error', text: result.stdout.slice(-12000) || '进程无输出' });
                    artifacts.push(artifact('process-report.json', JSON.stringify({ ...result, cwd, realExecution: true }, null, 2), tool, attempt.inputDigest!));
                    if (tool === 'ci-build' && status === 'succeeded') {
                        const html = await readFile(plugin + 'dist/index.html', 'utf8');
                        artifacts.push(artifact('muse-ci-ui.html', html, 'ci-build', attempt.inputDigest!));
                    }
                }
                else if (tool === 'ci-inspect') {
                    const files = ['packages/contracts/index.ts', 'packages/policy/engine.ts', 'apps/api/service.ts'];
                    const inputs = await Promise.all(files.map(async (f) => ({ file: f, sha256: digest(await readFile(backend + f, 'utf8')) })));
                    artifacts.push(artifact('source-manifest.json', JSON.stringify({ files: inputs }, null, 2), tool, attempt.inputDigest!));
                }
                else if (tool === 'ci-artifact-verify') {
                    const html = await readFile(plugin + 'dist/index.html', 'utf8');
                    if (!html.includes('CIRuntime') || !html.includes('产品定义'))
                        fail('UI_ARTIFACT_INCOMPLETE');
                    artifacts.push(artifact('ui-integrity.json', JSON.stringify({ sha256: digest(html), bytes: Buffer.byteLength(html), inline: true }, null, 2), tool, attempt.inputDigest!));
                }
                else if (tool === 'ci-release-check') {
                    status = 'failed';
                    logs.push({ level: 'error', text: 'FORMAL_RELEASE_NOT_CONFIGURED：缺少真实签名、设备与渠道回执，保持发布阻塞。' });
                    artifacts.push(artifact('release-blockers.json', JSON.stringify({ ready: false, formalRelease: false, missing: ['签名与候选物', '设备验收', '渠道回执'] }, null, 2), tool, attempt.inputDigest!));
                }
                else {
                    artifacts.push(artifact('delivery-evidence.json', JSON.stringify({ inputSnapshot: attempt.inputSnapshot, scope: 'development', formalRelease: false }, null, 2), 'evidence.aggregate', attempt.inputDigest!));
                }
            }
        }
    }
    catch (error) {
        status = 'failed';
        const message = error instanceof Error ? error.message : 'PROVIDER_FAILED';
        logs.push({ level: 'error', text: signal.aborted ? '作业已停止。' : /^[A-Z0-9_]+$/.test(message) ? message : 'PROVIDER_EXECUTION_FAILED' });
    }
    return { status, logs, artifacts, retryable: !signal.aborted && retryable };
}
