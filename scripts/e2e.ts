import assert from 'node:assert/strict';
import { lifecycleE2E } from './lifecycle-e2e.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { once } from 'node:events';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { digest, uid, Store } from '../apps/api/store.ts';
import { toolsSchemas } from '../packages/contracts/index.ts';
import type { Project } from '../packages/contracts/index.ts';
const cwd = new URL('../', import.meta.url), envText = await readFile(new URL('.data/development.env', cwd), 'utf8');
const env: Record<string, string> = { ...process.env, ...Object.fromEntries(envText.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; })), CI_PORT: '4181', CI_TASK_QUEUE: 'muse-ci-e2e-' + uid() } as Record<string, string>;
// Keep test outbox dispatch and worker restarts separate from the live Mobile pilot.
const schema='ci_e2e_'+uid().replaceAll('-','');
const admin=new Store(env.CI_DATABASE_URL);await admin.pool.query(`CREATE SCHEMA "${schema}"`);await admin.close();
const isolatedDatabase=new URL(env.CI_DATABASE_URL);isolatedDatabase.searchParams.set('options','-csearch_path='+schema);env.CI_DATABASE_URL=isolatedDatabase.href;
const origin = 'http://127.0.0.1:4181', checks: string[] = [];
let api!: ChildProcess, worker!: ChildProcess, client!: Client, projectId!: string;
const out = new URL('plugin/docs/evidence/live-e2e/', cwd);
await mkdir(out, { recursive: true });
await mkdir(new URL('.data/', cwd), { recursive: true });
async function launch(file: string) { const log = await open(new URL('.data/e2e-' + file.split('/').at(-2) + '.log', cwd), 'a'); const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd, env, stdio: ['ignore', log.fd, log.fd] }); await log.close(); return child; }
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') { if (!child || child.exitCode !== null)
    return; child.kill(signal); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null)
    child.kill('SIGKILL'); }
async function ready() { for (let i = 0; i < 80; i++) {
    try {
        if ((await fetch(origin + '/health')).ok)
            return;
    }
    catch { }
    await new Promise(r => setTimeout(r, 200));
} throw Error('API_START_TIMEOUT'); }
async function connect() { client = new Client({ name: 'Muse-CI actual E2E', version: '0.1.0' }); await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + env.CI_MCP_TOKEN } } })); }
async function call(name: string, args: any = {}) { const result = await client.callTool({ name, arguments: args }); if (result.isError)
    throw Error(result.content.map((x: any) => x.text || '').join('\n')); return result.structuredContent as any; }
const get = async () => (await call('ci_project_get', { projectId })).project as Project;
async function command(action: string, extra: any = {}) { for (let i = 0; i < 10; i++) {
    const p = await get();
    try {
        return await call('ci_run_command', { projectId, commandId: uid(), expectedVersion: p.version, action, ...extra });
    }
    catch (e) {
        if ((e as Error).message !== 'REVISION_CONFLICT')
            throw e;
    }
} throw Error('COMMAND_CONFLICT'); }
async function until(predicate: (p: Project) => boolean, name: string, timeout = 45000) { const start = Date.now(); while (Date.now() - start < timeout) {
    const p = await get();
    if (predicate(p))
        return p;
    await new Promise(r => setTimeout(r, 250));
} const p = await get(); throw Error(name + ': ' + JSON.stringify({ run: p.runs.at(-1)?.status, nodes: p.graph.nodes.map(n => ({ id: n.id, status: n.status, errors: n.attempts.at(-1)?.logs.filter(l => l.level === 'error').map(l => l.text.slice(0, 100)) })) })); }
function pass(text: string) { checks.push(text); console.log('PASS ' + text); }
try {
    const stores = [new Store(env.CI_DATABASE_URL), new Store(env.CI_DATABASE_URL)];
    await Promise.all(stores.map(s => s.init()));
    await Promise.all(stores.map(s => s.close()));
    pass('concurrent schema initialization');
    api = await launch('apps/api/main.ts');
    worker = await launch('apps/worker/main.ts');
    await ready();
    await connect();
    assert.equal((await fetch(origin + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(origin + '/api/session', { headers: { origin: 'https://untrusted.invalid' } })).status, 403);
    pass('MCP authentication and origin rejection');
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),Object.keys(toolsSchemas).sort());
    const ui = await client.readResource({ uri: 'ui://muse-ci/main' });
    assert.ok((ui.contents[0] as any).text.includes('CIRuntime'));
    pass('actual MCP discovery and packaged UI resource');
    await lifecycleE2E(client,env.CI_DATABASE_URL,pass);
    const create = { title: 'E2E ' + new Date().toISOString(), goal: '验证产品、UI、架构、真实构建、持久执行和证据。', commandId: uid() };
    const [created, concurrent] = await Promise.all([call('ci_projects_create', create), call('ci_projects_create', create)]);
    projectId = created.project.id;
    assert.equal(concurrent.project.id, projectId);
    assert.equal((await call('ci_projects_create', create)).project.id, projectId);
    pass('idempotent project creation');
    let p = await get();
    const stored = await call('ci_material_put', { projectId, commandId: uid(), expectedVersion: p.version, name: 'acceptance.txt', text: '功能和 UI 必须一起验收。' });
    p = stored.project;
    const materialDefinition = { stages: p.graph.stages, nodes: p.graph.nodes.map(({ id, title, stage, kind, depends, config }) => ({ id, title, stage, kind, depends, config })) };
    const productNode = materialDefinition.nodes.find(n => n.id === 'product-spec')!;
    productNode.config.materials.push(stored.material);
    productNode.config.skills = ['ci-product'];
    await call('ci_graph_save', { projectId, commandId: uid(), expectedVersion: p.version, definition: materialDefinition });
    p = await get();
    pass('text attachment stored by digest and bound with a versioned Skill');
    const start = { projectId, expectedVersion: p.version, commandId: uid(), action: 'start', nodeIds: p.graph.nodes.filter(n => n.id !== 'release').map(n => n.id), auto: true };
    const first = await call('ci_run_command', start), again = await call('ci_run_command', start);
    assert.equal(first.runId, again.runId);
    assert.equal(again.replayed, true);
    pass('start command redelivery creates one Run');
    await command('pause');
    p = await until(p => p.runs.at(-1)?.status === 'paused', 'pause');
    const pausedStarts = p.events.filter(e => e.type === 'node.started').length;
    await new Promise(r => setTimeout(r, 900));
    p = await get();
    assert.equal(p.events.filter(e => e.type === 'node.started').length, pausedStarts);
    pass('pause stops further dispatch');
    await client.close();
    await stop(api!);
    api = await launch('apps/api/main.ts');
    await ready();
    await connect();
    assert.equal((await get()).runs.at(-1)?.id, first.runId);
    pass('API restart restores the same persisted Run');
    await stop(worker!, 'SIGKILL');
    worker = await launch('apps/worker/main.ts');
    await command('resume');
    p = await until(p => p.graph.nodes.filter(n => n.status === 'awaiting_review').length === 2, 'checks to approval');
    assert.equal(p.graph.nodes.filter(n => n.status === 'succeeded').length, 9);
    pass('worker restart resumes real Temporal workflow');
    const starts = p.events.filter(e => e.type === 'node.started'), finishes = p.events.filter(e => e.type === 'node.finished');
    assert.ok(starts.find(e => e.detail.nodeId === 'ui-spec')!.seq < finishes.find(e => e.detail.nodeId === 'product-spec')!.seq);
    assert.ok(starts.find(e => e.detail.nodeId === 'architecture')!.seq > Math.max(...finishes.filter(e => ['product-spec', 'ui-spec'].includes(e.detail.nodeId)).map(e => e.seq)));
    pass('independent design nodes parallel; architecture waits for both');
    const processArtifacts = p.graph.nodes.flatMap(n => n.attempts.flatMap(a => a.artifacts)).filter(a => a.name === 'process-report.json');
    assert.equal(processArtifacts.length, 4);
    assert.ok(processArtifacts.every(a => JSON.parse(a.content).realExecution === true && JSON.parse(a.content).exitCode === 0));
    pass('four real check/build processes succeed');
    assert.ok(p.graph.nodes.find(n => n.id === 'product-spec')!.attempts[0].artifacts[0].content.includes('功能和 UI 必须一起验收。'));
    pass('uploaded material content reaches the fixed design artifact');
    const decision = p.graph.nodes.find(n => n.id === 'product')!.attempts.at(-1)!;
    await assert.rejects(() => command('approve', { nodeId: 'product', inputDigest: '0'.repeat(64) }), /APPROVAL_STALE/);
    pass('stale decision rejected');
    for (const nodeId of ['product', 'device']) {
        p = await get();
        await command('approve', { nodeId, inputDigest: p.graph.nodes.find(n => n.id === nodeId)!.attempts.at(-1)!.inputDigest });
        await until(p => p.graph.nodes.find(n => n.id === nodeId)?.status === 'succeeded', 'decision');
    }
    p = await until(p => p.runs.at(-1)?.status === 'succeeded', 'development completion');
    assert.equal(p.graph.nodes.filter(n => n.status === 'succeeded').length, 12);
    pass('development decisions unblock evidence delivery');
    const artifact = (await call('ci_artifact_get', { projectId, nodeId: 'build', attempt: 1, index: 1 })).artifact;
    assert.equal(digest(artifact.content), artifact.sha256);
    assert.ok(artifact.content.includes('CIRuntime'));
    const other = new Client({ name: 'second-device', version: '0.1.0' });
    await other.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + env.CI_MCP_TOKEN } } }));
    const read = await other.callTool({ name: 'ci_project_get', arguments: { projectId } });
    assert.equal((read.structuredContent as any).project.runs.at(-1).id, first.runId);
    await other.close();
    pass('artifact SHA verification and independent client reads same Run');
    assert.equal((await call('ci_release_check', { projectId })).ready, false);
    pass('formal publishing remains blocked without real channel evidence');
    await call('ci_plan_save', { projectId, commandId: uid(), expectedVersion: p.version, title: p.title, goal: p.goal + ' 明确验收边界。', budget: p.budget, type: p.type });
    p = await get();
    assert.equal(p.graph.nodes.find(n => n.id === 'architecture')!.status, 'stale');
    pass('editing the delivery goal invalidates dependent design and execution');
    const definition = { stages: p.graph.stages, nodes: p.graph.nodes.map(({ id, title, stage, kind, depends, config }) => ({ id, title, stage, kind, depends, config })) };
    definition.nodes.find(n => n.id === 'ui-spec')!.config.goal = '修订 UI：覆盖错误态和依赖提示';
    await call('ci_graph_save', { projectId, commandId: uid(), expectedVersion: p.version, definition });
    p = await get();
    assert.equal(p.graph.nodes.find(n => n.id === 'architecture')!.status, 'stale');
    assert.equal(p.graph.nodes.find(n => n.id === 'build')!.status, 'stale');
    await command('start', { nodeIds: ['ui-spec'], auto: false });
    p = await until(p => p.runs.at(-1)?.status === 'succeeded', 'single rerun');
    assert.equal(p.graph.nodes.find(n => n.id === 'ui-spec')!.attempts.length, 2);
    assert.equal(p.graph.nodes.find(n => n.id === 'architecture')!.status, 'stale');
    pass('design editing invalidates downstream; rerun retains prior outputs');
    const cursor = p.events.at(-1)!.seq;
    assert.equal((await call('ci_events_list', { projectId, after: cursor })).events.length, 0);
    pass('event cursor avoids duplicate delivery');
    await command('start', { nodeIds: ['ui-spec'], auto: false });
    await command('pause');
    await until(p => p.runs.at(-1)?.status === 'paused', 'second pause');
    await command('cancel');
    p = await until(p => p.runs.at(-1)?.status === 'canceled', 'cancel');
    pass('pause and cancel converge to a terminal state');
    await writeFile(new URL('report.json', out), JSON.stringify({ passed: true, scope: 'local-development-MCP-Temporal', projectId, firstRunId: first.runId, checks, realAI: false, formalRelease: false, hostDeviceValidation: false, completedAt: new Date().toISOString() }, null, 2));
    console.log('E2E PASSED ' + checks.length + ' checks');
}
catch (error) {
    await writeFile(new URL('failure.json', out), JSON.stringify({ passed: false, error: String(error), checks }, null, 2));
    throw error;
}
finally {
    await client!?.close().catch(() => { });
    await stop(api!);
    await stop(worker!);
}
