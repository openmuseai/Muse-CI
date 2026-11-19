import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, applyDefinition } from '../apps/api/service.ts';
import { tick, complete, claim, acceptResult } from '../packages/policy/engine.ts';
import { G } from '../packages/contracts/graph.ts';
import type { Project, Run, Definition } from '../packages/contracts/index.ts';
import { uid } from '../apps/api/store.ts';
const actor = { id: 'developer' };
export function start(p: Project, selected = p.graph.nodes.map(n => n.id)) { const r: Run = { id: uid(), projectId: p.id, revision: p.graph.revision, graphDigest: 'test', status: 'queued', auto: true, selected, budget: p.budget, spent: 0, startedAt: new Date().toISOString(), decisionScope: 'development', jobs: [], commands: [{ id: uid(), action: 'start', applied: false }] }; p.runs.push(r); return r; }
const def = (p: Project): Definition => ({ stages: structuredClone(p.graph.stages), nodes: p.graph.nodes.map(({ id, title, stage, kind, depends, config }) => ({ id, title, stage, kind, depends: [...depends], config: structuredClone(config) })) } as Definition);
test('product and UI run concurrently; architecture waits for both successful documents', async () => { const p = await newProject(actor, 'CI', '交付 CI'), r = start(p); const first = tick(p, r.id); assert.deepEqual(first.jobs.map(j => j.nodeId), ['product-spec', 'ui-spec']); assert.equal(G.get(p.graph, 'architecture').status, 'pending'); for (const id of ['product-spec', 'ui-spec']) {
    const n = G.get(p.graph, id);
    complete(p, r, n, n.attempts.at(-1)!, 'succeeded', []);
} const next = tick(p, r.id); assert.equal(next.jobs[0].nodeId, 'architecture'); });
test('pause prevents new jobs and resume keeps same run and fixed revision', async () => { const p = await newProject(actor, 'CI', '交付 CI'), r = start(p); r.commands.push({ id: uid(), action: 'pause', applied: false }); assert.equal(tick(p, r.id).jobs.length, 0); assert.equal(r.status, 'paused'); r.commands.push({ id: uid(), action: 'resume', applied: false }); assert.equal(tick(p, r.id).jobs.length, 2); assert.equal(r.revision, p.graph.revision); });
test('changed design invalidates architecture and downstream while preserving historical outputs', async () => { const p = await newProject(actor, 'CI', '交付 CI'); for (const n of p.graph.nodes) {
    n.status = 'succeeded';
    n.attempts.push({ id: 1, status: 'succeeded', revision: 1, inputSnapshot: {}, startedAt: 'test', logs: [], artifacts: [] });
} const d = def(p); d.nodes.find(n => n.id === 'ui-spec')!.config.goal = '修改交互'; applyDefinition(p, d); assert.equal(G.get(p.graph, 'architecture').status, 'stale'); assert.equal(G.get(p.graph, 'build').status, 'stale'); assert.equal(G.get(p.graph, 'build').attempts.length, 1); });
test('cycle and execution facts in a definition are rejected atomically', async () => { const p = await newProject(actor, 'CI', '交付 CI'), before = JSON.stringify(p.graph), d = def(p); d.nodes.find(n => n.id === 'product-spec')!.depends = ['release']; assert.throws(() => applyDefinition(p, d), /GRAPH_INVALID/); assert.equal(JSON.stringify(p.graph), before); assert.throws(() => applyDefinition(p, { ...d, nodes: d.nodes.map(n => ({ ...n, status: 'succeeded' })) } as any)); });
test('budget exhaustion terminates pending execution without leaving phantom running nodes', async () => { const p = await newProject(actor, 'CI', '交付 CI'); p.budget = 1; const r = start(p); tick(p, r.id); assert.equal(r.status, 'failed'); assert.ok(p.graph.nodes.every(n => n.status !== 'running')); });
test('cancellation rejects late provider results and marks attempts stopped', async () => { const p = await newProject(actor, 'CI', '交付 CI'), r = start(p); tick(p, r.id); const job = claim(p, r.id, 'product-spec', 1); r.commands.push({ id: uid(), action: 'cancel', applied: false }); tick(p, r.id); assert.equal(r.status, 'canceled'); assert.equal(acceptResult(p, r.id, 'product-spec', 1, job.lease, { status: 'succeeded', logs: [], artifacts: [] }).accepted, false); assert.equal(G.get(p.graph, 'product-spec').status, 'failed'); });
test('expired and replaced runner leases cannot write successful evidence', async () => { const p = await newProject(actor, 'CI', '交付 CI'), r = start(p); tick(p, r.id); const first = claim(p, r.id, 'product-spec', 1); const n = G.get(p.graph, 'product-spec'); n.attempts[0].leaseUntil = Date.now() - 1; const next = claim(p, r.id, 'product-spec', 1); assert.notEqual(first.lease, next.lease); assert.equal(acceptResult(p, r.id, 'product-spec', 1, first.lease, { status: 'succeeded', logs: [], artifacts: [] }).accepted, false); assert.equal(acceptResult(p, r.id, 'product-spec', 1, next.lease, { status: 'succeeded', logs: [], artifacts: [] }).accepted, true); });
test('invalid old upstream material fails admission without leaving a stuck workflow', async () => { const p = await newProject(actor, 'CI', '交付 CI'); const n = G.get(p.graph, 'architecture'); for (const id of n.depends) {
    const up = G.get(p.graph, id);
    up.status = 'succeeded';
} n.config.materials = [{ kind: 'upstream', name: 'old output', nodeId: 'product-spec', attempt: 77, index: 0 }]; const r = start(p, ['architecture']); assert.doesNotThrow(() => tick(p, r.id)); assert.equal(r.status, 'failed'); assert.equal(n.status, 'failed'); assert.ok(n.attempts[0].logs[0].text.includes('材料')); });

test('retryable check failure honors the configured node retry limit and retains attempts',async()=>{
 const p=await newProject(actor,'CI','重试有界');const n=G.get(p.graph,'product-spec');n.config.retries=1;const r=start(p,['product-spec']);tick(p,r.id);let a=n.attempts.at(-1)!;a.retryable=true;complete(p,r,n,a,'failed',[]);tick(p,r.id);assert.equal(n.attempts.length,2);assert.equal(n.status,'running');a=n.attempts.at(-1)!;a.retryable=true;complete(p,r,n,a,'failed',[]);tick(p,r.id);assert.equal(n.attempts.length,2);assert.equal(r.status,'failed');assert.equal(r.spent,2);
});

test('database JSON key ordering does not invalidate unchanged or unrelated nodes',async()=>{
 const project=await newProject(actor,'CI','稳定定义');
 for(const n of project.graph.nodes){n.status='succeeded';n.attempts.push({id:1,status:'succeeded',revision:1,inputSnapshot:{},startedAt:'test',logs:[],artifacts:[]});}
 const sort=(x:any):any=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
 const p=sort(project) as Project;const d=def(p);d.nodes.find(n=>n.id==='ui-spec')!.config.goal='只修改 UI';applyDefinition(p,d);
 assert.equal(G.get(p.graph,'product-spec').status,'succeeded');assert.equal(G.get(p.graph,'product-spec').revision,1);assert.equal(G.get(p.graph,'ui-spec').status,'stale');assert.equal(G.get(p.graph,'architecture').status,'stale');
});
