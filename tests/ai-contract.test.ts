import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { newProject } from '../apps/api/service.ts';
import { G } from '../packages/contracts/graph.ts';
import { execute } from '../packages/providers/index.ts';
import { digest } from '../apps/api/store.ts';
test('AI adapter sends only consented task inputs to a real MCP transport and retains an unapplied proposal', async () => {
    let calls = 0;
    const handler = createMcpHandler(() => { const s = new McpServer({ name: 'explicit-ai-contract-fixture', version: '1.0.0' }); s.registerTool('plan_propose', { inputSchema: z.object({ goal: z.string(), materials: z.array(z.any()), skills: z.array(z.any()), allowedTools: z.array(z.string()), inputDigest: z.string() }) }, async (input) => { calls++; return { content: [{ type: 'text' as const, text: JSON.stringify({ fixture: true, goal: input.goal }) }], structuredContent: { fixture: true, proposal: { title: '合同测试提案' }, noRealModel: true } }; }); return s; });
    const server = createServer(async (req, res) => { const chunks: Buffer[] = []; for await (const chunk of req)
        chunks.push(chunk); const response = await handler.fetch(new Request(`http://127.0.0.1:${(server.address() as any).port}/mcp`, { method: req.method, headers: req.headers as any, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })); res.writeHead(response.status, Object.fromEntries(response.headers)); if (response.body)
        for await (const part of response.body as any)
            res.write(part); res.end(); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`, old = process.env.CI_AI_MCP_URL;
    process.env.CI_AI_MCP_URL = url;
    try {
        const p = await newProject({ id: 'dev' }, 'AI contract', '只验证 MCP 合同，不声称真实模型');
        const n = G.get(p.graph, 'source');
        n.kind = 'agent';
        n.config.materials = [{ kind: 'note', name: '需求', text: '一个明确输入' }];
        const attempt = { id: 1, status: 'running', revision: 1, inputDigest: digest('contract'), inputSnapshot: {}, startedAt: 'test', logs: [], artifacts: [] };
        const denied = await execute(n, attempt, undefined, new AbortController().signal);
        assert.equal(denied.status, 'failed');
        assert.equal(calls, 0);
        const result = await execute(n, attempt, { recipient: url, categories: ['目标', '节点材料'], grantedAt: new Date().toISOString() }, new AbortController().signal);
        assert.equal(result.status, 'succeeded');
        assert.equal(calls, 1);
        const proposal = JSON.parse(result.artifacts[0].content);
        assert.equal(proposal.applied, false);
        assert.equal(proposal.proposal.structuredContent.noRealModel, true);
        assert.equal(result.artifacts[0].sha256, digest(result.artifacts[0].content));
    }
    finally {
        if (old)
            process.env.CI_AI_MCP_URL = old;
        else
            delete process.env.CI_AI_MCP_URL;
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
