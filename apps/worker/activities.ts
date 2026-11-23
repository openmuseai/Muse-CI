import { Context, heartbeat } from '@temporalio/activity';
import { Store, event } from '../api/store.ts';
import { tick, claim, acceptResult } from '../../packages/policy/engine.ts';
import { sourceManifest } from '../../packages/providers/source.ts';
import {ProjectCatalog} from '../../packages/projects/catalog.ts';
import { execute } from '../../packages/providers/index.ts';
import{synchronizeCloud,cloudActorFor}from'../../packages/cloud/reconcile.ts';
export function activities(store: Store) {
    return {
        async advance(input: {
            projectId: string;
            runId: string;
        }) { const result = await store.mutate(input.projectId, undefined, undefined, undefined, {}, p => tick(p, input.runId)); return { status: result.status as string, jobs: result.jobs as {
                projectId: string;
                runId: string;
                nodeId: string;
                attempt: number;
                completed: boolean;
            }[] }; },
        async executeJob(job: {
            projectId: string;
            runId: string;
            nodeId: string;
            attempt: number;
        }) {
            let current = await store.get(job.projectId);
            const cloudInputs=async()=>{
                const p=await store.get(job.projectId),node=p.graph.nodes.find(n=>n.id===job.nodeId);
                const ids=new Set(node?.config.materials.filter(m=>m.kind==='smartdoc').map(m=>m.documentId));
                for(const doc of Object.values(p.documents||{}))if(doc.cloud&&(ids.has(doc.id)||doc.nodeId===job.nodeId))await synchronizeCloud(store,p.id,await cloudActorFor(store,p.id),doc.id);
            };
            await cloudInputs();
            current=await store.get(job.projectId);
            if(current.graph.nodes.find(n=>n.id===job.nodeId)?.status!=='running')return {accepted:false};
            const existing = current.graph.nodes.find(n => n.id === job.nodeId)?.attempts.at(-1);
            if (existing?.id === job.attempt && !['running'].includes(existing.status))
                return { accepted: false };
            const claimed = await store.mutate(job.projectId, undefined, undefined, undefined, {}, p => claim(p, job.runId, job.nodeId, job.attempt));
            const ac = new AbortController();
            const context = Context.current();
            const abort = () => ac.abort();
            context.cancellationSignal.addEventListener('abort', abort, { once: true });
            const timeout = setTimeout(abort, claimed.node.config.timeout * 60000);
            let checking = false;
            const timer = setInterval(async () => { if (checking)
                return; checking = true; try {
                heartbeat({ nodeId: job.nodeId, attempt: job.attempt });
                const result = await store.mutate(job.projectId, undefined, undefined, undefined, {}, p => { const r = p.runs.find(r => r.id === job.runId), n = p.graph.nodes.find(n => n.id === job.nodeId), a = n?.attempts.at(-1); if (claimed.node.kind === 'agent' && (!p.consent || p.consent.recipient !== claimed.consent?.recipient))
                    return { active: false }; if (!r || ['canceled', 'failed'].includes(r.status) || r.commands.some(c => !c.applied && (c.action === 'cancel' || c.action === 'stop-node' && c.nodeId === job.nodeId)) || !a || a.lease !== claimed.lease || n?.status !== 'running')
                    return { active: false }; a.leaseUntil = Date.now() + 12000; return { active: true }; });
                if (!result.active)
                    ac.abort();
            }
            catch {
                ac.abort();
            }
            finally {
                checking = false;
            } }, 2000);
            try {
                const before = await sourceManifest(current.graph,current.hierarchy?.repositoryRoot);
                const run = current.runs.find(r => r.id === job.runId);
                const childInputsCurrent=async()=>{
                    if(run?.projectContext){try{const catalog=new ProjectCatalog(store),managed=await catalog.get(run.projectContext.hierarchy.projectId,{id:run.projectContext.actor},true);if((await catalog.fs.executionContext(managed,run.projectContext.actor,run.projectContext.hierarchy)).digest!==run.projectContext.digest)return false;}catch{return false;}}
                    for(const [id,revision] of Object.entries(run?.childRevisions||{}))if((await store.get(id)).version!==revision)return false;
                    return true;
                };
                let result;
                if (!await childInputsCurrent())
                    result={status:'failed',logs:[{level:'error',text:'REQUIREMENT_INPUT_CHANGED'}],artifacts:[]};
                else if (run?.sourceDigest && before.digest !== run.sourceDigest)
                    result = { status: 'failed', logs: [{ level: 'error', text: 'SOURCE_INPUT_CHANGED' }], artifacts: [] };
                else {
                    result = await execute(claimed.node, claimed.attempt, claimed.consent, ac.signal);
                    const after = await sourceManifest(current.graph,current.hierarchy?.repositoryRoot);
                    if (after.digest !== before.digest)
                        result = { status: 'failed', logs: [{ level: 'error', text: 'SOURCE_INPUT_CHANGED' }], artifacts: [] };
                    else if(!await childInputsCurrent())result={status:'failed',logs:[{level:'error',text:'REQUIREMENT_INPUT_CHANGED'}],artifacts:[]};
                }
                await cloudInputs();
                const accepted=await store.mutate(job.projectId, undefined, undefined, undefined, {}, p => acceptResult(p, job.runId, job.nodeId, job.attempt, claimed.lease, result));
                // Artifacts stay in the store; never copy the entire growing project into Temporal history.
                return {accepted:accepted.accepted};
            }
            finally {
                clearInterval(timer);
                clearTimeout(timeout);
                context.cancellationSignal.removeEventListener('abort', abort);
            }
        }
    };
}
export type Activities = ReturnType<typeof activities>;
