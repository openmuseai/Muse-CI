import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, digest } from '../apps/api/store.ts';
import { newProject, releaseCheck } from '../apps/api/service.ts';
import { execute } from '../packages/providers/index.ts';
import { G } from '../packages/contracts/graph.ts';
const actor = { id: 'developer' };
test('cross-project and read-only actors cannot mutate the project', async () => { const p = await newProject(actor, 'CI', '交付 CI'); assert.throws(() => authorize(p, { id: 'other' }, true), /PROJECT_ACCESS_DENIED/); p.members.viewer = 'viewer'; authorize(p, { id: 'viewer' }); assert.throws(() => authorize(p, { id: 'viewer' }, true), /PROJECT_ACCESS_DENIED/); });
test('unknown tools and unresolved file bytes never silently succeed', async () => { const p = await newProject(actor, 'CI', '交付 CI'); const n = G.get(p.graph, 'product-spec'); n.config.tools = ['arbitrary-shell']; const a = { id: 1, status: 'running', revision: 1, inputSnapshot: {}, inputDigest: digest('test'), startedAt: 'test', logs: [], artifacts: [] }; const result = await execute(n, a, undefined, new AbortController().signal); assert.equal(result.status, 'failed'); assert.equal(result.logs[0].text, 'TOOL_PROVIDER_NOT_BOUND'); n.config.tools = ['doc-compile']; n.config.materials = [{ kind: 'file', name: 'secret', size: 4, type: 'text/plain' }]; assert.equal((await execute(n, a, undefined, new AbortController().signal)).logs[0].text, 'MATERIAL_CONTENT_REQUIRED'); });
test('AI provider missing or unconsented produces explicit failure rather than fabricated results', async () => { const p = await newProject(actor, 'CI', '交付 CI'); const n = G.get(p.graph, 'source'); n.kind = 'agent'; const previous = process.env.CI_AI_MCP_URL; delete process.env.CI_AI_MCP_URL; try {
    const a = { id: 1, status: 'running', revision: 1, inputSnapshot: {}, inputDigest: digest('test'), startedAt: 'test', logs: [], artifacts: [] };
    const result = await execute(n, a, undefined, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.equal(result.logs[0].text, 'AI_PROVIDER_NOT_CONFIGURED');
    process.env.CI_AI_MCP_URL = 'https://example.invalid/mcp';
    assert.equal((await execute(n, a, undefined, new AbortController().signal)).logs[0].text, 'AI_DATA_CONSENT_REQUIRED');
}
finally {
    if (previous)
        process.env.CI_AI_MCP_URL = previous;
    else
        delete process.env.CI_AI_MCP_URL;
} });
test('all development checks passed cannot forge a formal channel receipt', async () => { const p = await newProject(actor, 'CI', '交付 CI'); p.graph.nodes.forEach(n => n.status = 'succeeded'); const gate = releaseCheck(p); assert.equal(gate.ready, false); assert.ok(gate.missing.some(x => x.includes('渠道'))); });
