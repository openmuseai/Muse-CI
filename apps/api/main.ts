import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as TemporalClient, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { Store } from './store.ts';
import { CIService } from './service.ts';
import { createHandler } from './mcp.ts';
import {cloudConfigured}from'../../packages/cloud/workspace.ts';
import {flushCloudOutbox}from'../../packages/cloud/reconcile.ts';
const store = new Store();
await store.init();
const service = new CIService(store), handler = createHandler(service);
const port = Number(process.env.CI_PORT || 4180), origin = `http://127.0.0.1:${port}`, token = process.env.CI_MCP_TOKEN;
if (!token)
    throw Error('MCP_TOKEN_CONFIGURATION_REQUIRED');
const web = fileURLToPath(new URL('../../../Muse-Plugin-Ecosystem/plugins/muse-ci/web/', import.meta.url));
let client: Client | undefined;
async function host() { if (!client) {
    const candidate = new Client({ name: 'Muse-CI development web host', version: '0.1.0' });
    await candidate.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + token } } }));
    client = candidate;
} return client; }
const sessions = new Map<string, number>();
function authenticated(cookie: string | undefined) { const id = cookie?.match(/(?:^|; )ci_session=([a-f0-9]{48})/)?.[1]; const expires = id ? sessions.get(id) : undefined; return !!expires && expires > Date.now(); }
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: any) { const parts: Buffer[] = []; let size = 0; for await (const p of req) {
    size += p.length;
    if (size > 2 * 1024 * 1024)
        throw Error('INPUT_TOO_LARGE');
    parts.push(p);
} return Buffer.concat(parts); }
function json(res: any, status: number, data: any, headers = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(data)); }
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', origin);
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || ''))
            return json(res, 403, { error: 'HOST_DENIED' });
        if (req.headers.origin && !new Set([origin, `http://localhost:${port}`]).has(req.headers.origin))
            return json(res, 403, { error: 'ORIGIN_DENIED' });
        if (url.pathname === '/health') {
            return json(res, 200, { ready: true, contract: 'openmuse.ci/1', identity: 'local-development' });
        }
        if (url.pathname === '/mcp') {
            if (!eq(req.headers.authorization || '', 'Bearer ' + token))
                return json(res, 401, { error: 'AUTH_REQUIRED' });
            const bytes = req.method === 'POST' ? await body(req) : undefined;
            const request = new Request(origin + url.pathname, { method: req.method, headers: req.headers as Record<string, string>, ...(bytes ? { body: bytes } : {}) });
            const response = await handler.fetch(request);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body)
                for await (const chunk of response.body as any)
                    res.write(chunk);
            return res.end();
        }
        if (url.pathname === '/api/session' && req.method === 'GET') {
            let cookie = '';
            if (!authenticated(req.headers.cookie)) {
                const id = randomBytes(24).toString('hex');
                sessions.set(id, Date.now() + 8 * 3600000);
                cookie = `ci_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
            }
            return json(res, 200, { mode: 'service', actor: 'local-developer', identity: 'local-development', contract: 'openmuse.ci/1' }, { ...(cookie ? { 'set-cookie': cookie } : {}) });
        }
        if (url.pathname === '/api/host/rpc' && req.method === 'POST') {
            if (!authenticated(req.headers.cookie))
                return json(res, 401, { error: 'AUTH_REQUIRED' });
            if (!req.headers['content-type']?.startsWith('application/json'))
                return json(res, 415, { error: 'JSON_REQUIRED' });
            const input = JSON.parse((await body(req)).toString());
            const h = await host();
            let result: any;
            if (input.method === 'tools/call')
                result = await h.callTool(input.params);
            else if (input.method === 'tools/list')
                result = await h.listTools();
            else if (input.method === 'resources/read')
                result = await h.readResource(input.params);
            else if (input.method === 'resources/list')
                result = await h.listResources();
            else
                return json(res, 400, { error: 'METHOD_NOT_ALLOWED' });
            return json(res, 200, { result });
        }
        if (url.pathname === '/host') {
            const html = await readFile(new URL('../../../Muse-Plugin-Ecosystem/plugins/muse-ci/host/index.html', import.meta.url), 'utf8');
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(html);
        }
        const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const file = path.resolve(web, rel);
        if (!file.startsWith(web) || !['.html', '.css', '.js'].includes(path.extname(file)))
            return json(res, 404, { error: 'NOT_FOUND' });
        const bytes = await readFile(file);
        res.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)]!, 'cache-control': 'no-store' });
        res.end(bytes);
    }
    catch (e) {
        const code = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'REQUEST_FAILED';
        json(res, 400, { error: code });
    }
});
await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
console.log('Muse-CI development service ' + origin);
const connection = await Connection.connect({ address: process.env.CI_TEMPORAL_ADDRESS || '127.0.0.1:17236' });
const temporal = new TemporalClient({ connection });
let dispatching = false;
const dispatcher = setInterval(async () => { if (dispatching)
    return; dispatching = true; try {
    const rows = await store.pool.query('SELECT * FROM ci_outbox WHERE NOT delivered ORDER BY created_at LIMIT 50');
    for (const row of rows.rows) {
        try {
            await temporal.workflow.start('delivery', { workflowId: 'ci-run-' + row.run_id, taskQueue: process.env.CI_TASK_QUEUE || 'muse-ci-v1', args: [{ projectId: row.project_id, runId: row.run_id }] });
        }
        catch (e) {
            if (!(e instanceof WorkflowExecutionAlreadyStartedError))
                throw e;
        }
        await temporal.workflow.getHandle('ci-run-'+row.run_id).signal('command');
        await store.pool.query('UPDATE ci_outbox SET delivered=true WHERE id=$1', [row.id]);
    }
}
catch {
    console.error('OUTBOX_DISPATCH_RETRY');
}
finally {
    dispatching = false;
} }, 300);
let cloudFlushing=false;
const cloudOutbox=setInterval(()=>{if(!cloudConfigured()||cloudFlushing)return;cloudFlushing=true;void flushCloudOutbox(store).catch(()=>{}).finally(()=>cloudFlushing=false);},3000);
let mrDraining=false;
const mrOutbox=setInterval(()=>{if(mrDraining)return;mrDraining=true;void service.drainMROperations().catch(()=>{}).finally(()=>mrDraining=false);},3000);
const shutdown = async () => { clearInterval(mrOutbox);clearInterval(cloudOutbox);clearInterval(dispatcher); server.close(); await client?.close(); await connection.close(); await store.close(); process.exit(0); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
