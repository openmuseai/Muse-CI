import { McpServer, createMcpHandler,ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CIService } from './service.ts';
import { Store } from './store.ts';
import { toolsSchemas } from '../../packages/contracts/index.ts';
import {artifactResource,artifactView} from '../../packages/documents/artifacts.ts';
export const uiPath = new URL('../../plugin/dist/index.html', import.meta.url);
export function buildServer(service: CIService, actor = { id: 'local-developer' }) {
    const server = new McpServer({ name: 'io.openmuse.ci', version: '0.4.0' }, { capabilities: { tools: {}, resources: {} } });
    server.registerResource('CI artifact',new ResourceTemplate('ci-artifact://{projectId}/{nodeId}/{attempt}/{index}',{list:async()=>{
        const resources=[];for(const meta of await service.store.list(actor)){
            const p=await service.store.get(meta.id,actor);for(const n of p.graph.nodes)for(const a of n.attempts)for(const [index,artifact]of a.artifacts.entries())resources.push(artifactResource(p.id,n.id,a.id,index,artifact));
        }if(resources.length>5000)throw Error('RESOURCE_LIST_TOO_LARGE');return {resources};
    }}),{},async(uri,v)=>{
        const args=toolsSchemas.ci_artifact_get.parse({projectId:v.projectId,nodeId:v.nodeId,attempt:Number(v.attempt),index:Number(v.index)});
        const p=await service.store.get(args.projectId,actor),result=artifactView(p,args.nodeId,args.attempt,args.index);
        return {contents:[{uri:uri.href,mimeType:result.artifact.kind,text:result.artifact.content}]};
    });
    server.registerResource('Muse-CI', 'ui://muse-ci/main', { mimeType: 'text/html;profile=mcp-app' }, async () => ({ contents: [{ uri: 'ui://muse-ci/main', mimeType: 'text/html;profile=mcp-app', text: await readFile(uiPath, 'utf8'), _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }));
    for (const [name, inputSchema] of Object.entries(toolsSchemas))
        server.registerTool(name, { description: ({ci_lifecycle_create:'Create a version or requirement lifecycle with ordered Steps and native SmartDoc deliverables.',ci_requirement_create:'Create an independent requirement subflow under the version; returns its project ID.',ci_node_mark:'Record or revoke an attributed manual mark. It is not test success, MR merge or release evidence.',ci_document_get:'Read native SmartDoc blocks and revision history. Use stable block IDs for edits.',ci_agent_document_edit:'CI Agent contribution delegated by this project member. Read document first, preserve others’ blocks, provide expectedRevision. Audits Agent role and delegator; not an independent cloud identity.',ci_document_publish:'Publish a native document revision as a pinned workflow input; this is not an approval or test result.'} as Record<string,string>)[name]||name.replaceAll('_', ' '), inputSchema, outputSchema: z.object({}).catchall(z.unknown()), annotations: { readOnlyHint: ['ci_open', 'ci_projects_list', 'ci_project_get', 'ci_document_get', 'ci_events_list', 'ci_artifact_get', 'ci_capabilities', 'ci_release_check','ci_git_profiles_list','ci_git_profile_verify'].includes(name) }, ...(['ci_mr_merge','ci_mr_reconcile','ci_mr_cancel'].includes(name) ? {_meta:{ui:{visibility:['app']}}}: {}), ...(name === 'ci_open' ? { _meta: { ui: { resourceUri: 'ui://muse-ci/main' } } } : {}) }, async (args: any) => { try {
            const result = await service.call(name, args, actor);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '';
            const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INPUT_INVALID';
            return { isError: true, content: [{ type: 'text' as const, text: code }] };
        } });
    return server;
}
export const createHandler = (service: CIService) => createMcpHandler(() => buildServer(service), { legacy: 'stateless' });
if (process.argv.includes('--stdio')) {
    const store = new Store();
    await store.init();
    await serveStdio(() => buildServer(new CIService(store)));
}
