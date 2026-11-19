import { skillRegistry } from '../providers/registry.ts';
import {isCodingTool} from '../providers/coding.ts';
import { G } from '../contracts/graph.ts';
import type { Project, Run, GraphNode, Attempt, Artifact } from '../contracts/index.ts';
import { digest, event, uid, fail } from '../../apps/api/store.ts';
import { archiveExecutionDocument } from '../documents/smartdoc.ts';
import { stepAdmission, collectDocumentInputs } from '../lifecycle/model.ts';
import {stepConfigurationSnapshot} from '../lifecycle/step-config.ts';
const terminal = (r: Run) => ['succeeded', 'failed', 'canceled'].includes(r.status);
export function complete(p: Project, r: Run, n: GraphNode, a: Attempt, status: string, logs: {
    level: string;
    text: string;
}[], artifacts: Artifact[] = []) {
    if (!['running', 'awaiting_review'].includes(n.status) || a !== n.attempts.at(-1))
        return false;
    if(p.lifecycle&&status==='succeeded')archiveExecutionDocument(p,n.id,a.id,artifacts,n.kind==='agent'?'agent':'system');
    a.status = status;
    n.status = status;
    a.finishedAt = new Date().toISOString();
    a.logs.push(...logs);
    a.artifacts = artifacts;
    const job = r.jobs.find(j => j.nodeId === n.id && j.attempt === a.id);
    if (job)
        job.completed = true;
    event(p, 'node.finished', { runId: r.id, nodeId: n.id, attempt: a.id, status });
    return true;
}
export function tick(p: Project, runId: string) {
    const r = p.runs.find(x => x.id === runId);
    if (!r)
        fail('RUN_NOT_FOUND');
    if (terminal(r))
        return { status: r.status, jobs: [] };
    for (const command of r.commands.filter(c => !c.applied)) {
        switch (command.action) {
            case 'start':
                r.status = 'running';
                break;
            case 'pause':
                if (!terminal(r))
                    r.status = 'paused';
                break;
            case 'resume':
                if (!terminal(r))
                    r.status = 'running';
                break;
            case 'cancel':
                r.status = 'canceled';
                r.finishedAt = new Date().toISOString();
                for (const n of p.graph.nodes) {
                    const a = n.attempts.at(-1);
                    if (a?.runId === r.id)
                        complete(p, r, n, a, 'failed', [{ level: 'error', text: '运行已取消，迟到结果将被拒绝。' }]);
                }
                break;
            case 'approve':
            case 'reject':
            case 'stop-node': {
                const n = p.graph.nodes.find(n => n.id === command.nodeId), a = n?.attempts.at(-1);
                if (!n || !a || a.inputDigest !== command.inputDigest || a.runId !== r.id || terminal(r)) {
                    event(p, 'command.rejected', { commandId: command.id, reason: 'APPROVAL_STALE' });
                    break;
                }
                complete(p, r, n, a, command.action === 'approve' ? 'succeeded' : 'failed', [{ level: command.action === 'approve' ? 'info' : 'error', text: command.action === 'approve' ? '项目成员已记录开发验收决定；不是正式发布授权。' : '节点已被拒绝或停止。' }]);
                break;
            }
        }
        command.applied = true;
        event(p, 'command.applied', { commandId: command.id, action: command.action, runId: r.id });
    }
    if (terminal(r) || r.status === 'paused')
        return { status: r.status, jobs: [] };
    r.jobs = r.jobs.filter(job => {
        const n = G.get(p.graph, job.nodeId), a = n.attempts.at(-1);
        if (job.completed && n.status === 'failed' && a?.retryable && n.attempts.filter(x => x.runId === r.id).length <= n.config.retries) {
            event(p, 'node.retry_scheduled', {runId:r.id,nodeId:n.id,nextAttempt:n.attempts.length+1});
            return false;
        }
        return true;
    });
    const eligible = p.graph.nodes.filter(n => r.selected.includes(n.id) && !r.jobs.some(j => j.nodeId === n.id) && G.ready(p.graph, n) && (()=>{try{stepAdmission(p,n);return true;}catch{return false;}})());
    for (const n of eligible) {
        // Starting an earlier node invalidates later results in an ordered
        // lifecycle. Recheck after that mutation instead of admitting the
        // remainder from a snapshot of their previously successful states.
        if(!G.ready(p.graph,n))continue;
        try{stepAdmission(p,n);}catch{continue;}
        if (r.spent >= r.budget) {
            r.status = 'failed';
            r.finishedAt = new Date().toISOString();
            event(p, 'run.failed', { runId: r.id, reason: 'BUDGET_EXHAUSTED' });
            break;
        }
        let a: Attempt;
        try {
            a = G.run(p.graph, n.id);
        }
        catch (error) {
            const snapshot = { config: structuredClone(n.config), depends: [...n.depends] };
            a = { id: n.attempts.length + 1, status: 'failed', revision: n.revision, runId: r.id, inputSnapshot: snapshot, inputDigest: digest(snapshot), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), logs: [{ level: 'error', text: '节点未派发：' + (typeof (error as any)?.message === 'string' ? (error as Error).message : 'ADMISSION_FAILED') }], artifacts: [] };
            n.attempts.push(a);
            n.status = 'failed';
            r.jobs.push({ nodeId: n.id, attempt: a.id, completed: true });
            event(p, 'node.admission_failed', { runId: r.id, nodeId: n.id });
            continue;
        }
        a.inputSnapshot.lifecycle=p.lifecycle?.kind;
        a.inputSnapshot.stepConfiguration=stepConfigurationSnapshot(p,n.stage);
        a.runId = r.id;
        a.startedAt = new Date().toISOString();
        a.logs = [{ level: 'info', text: '服务端已固定产品、设计、能力与上游输入。' }];
        a.inputSnapshot.boundMaterials = n.config.materials.filter(m => m.kind === 'attachment').map(m => p.materials?.[m.sha256]);
        if (a.inputSnapshot.boundMaterials.some((m: any) => !m))
            fail('MATERIAL_NOT_FOUND');
        try{a.inputSnapshot.boundMaterials.push(...collectDocumentInputs(p,n));}catch{
            a.status='failed';n.status='failed';a.logs.push({level:'error',text:'SMARTDOC_NOT_PUBLISHED'});
            r.jobs.push({nodeId:n.id,attempt:a.id,completed:true});event(p,'node.admission_failed',{runId:r.id,nodeId:n.id,reason:'SMARTDOC_NOT_PUBLISHED'});continue;
        }
        a.inputSnapshot.boundSkills = n.config.skills.map(id => skillRegistry.find(s => s.id === id) || { id, unbound: true });
        a.inputDigest = digest({ revision: r.revision, nodeRevision: n.revision, snapshot: a.inputSnapshot, sourceDigest: r.sourceDigest });
        a.provider = n.kind === 'agent' ? n.config.tools.some(isCodingTool)?'ai.codex-local':'ai.mcp' : n.config.tools[0] || 'doc-compile';
        r.jobs.push({ nodeId: n.id, attempt: a.id, completed: false });
        r.spent++;
        event(p, 'node.started', { runId: r.id, nodeId: n.id, attempt: a.id, inputDigest: a.inputDigest });
    }
    if (r.status === 'failed')
        for (const n of p.graph.nodes) {
            const a = n.attempts.at(-1);
            if (a?.runId === r.id)
                complete(p, r, n, a, 'failed', [{ level: 'error', text: 'BUDGET_EXHAUSTED' }]);
        }
    const running = p.graph.nodes.some(n => n.attempts.at(-1)?.runId === r.id && n.status === 'running');
    const waiting = p.graph.nodes.some(n => n.attempts.at(-1)?.runId === r.id && n.status === 'awaiting_review');
    const remaining = r.selected.filter(id => !r.jobs.some(j => j.nodeId === id));
    if (!running && !waiting && r.status !== 'failed') {
        r.status = remaining.length || r.jobs.some(j => p.graph.nodes.find(n => n.id === j.nodeId)?.status === 'failed') ? 'failed' : 'succeeded';
        r.finishedAt = new Date().toISOString();
        event(p, 'run.finished', { runId: r.id, status: r.status, blocked: remaining });
    }
    else if (waiting && !running)
        r.status = 'waiting_approval';
    else if (r.status !== 'failed')
        r.status = 'running';
    return { status: r.status, jobs: terminal(r) ? [] : r.jobs.filter(j => !j.completed && G.get(p.graph, j.nodeId).status === 'running').map(j => ({ projectId: p.id, runId: r.id, ...j })) };
}
export function claim(p: Project, runId: string, nodeId: string, attempt: number) { const r = p.runs.find(r => r.id === runId); if (!r || terminal(r))
    fail('JOB_NO_LONGER_ACTIVE'); const n = G.get(p.graph, nodeId), a = n.attempts.at(-1); if (!a || a.id !== attempt || a.runId !== r.id || n.status !== 'running')
    fail('JOB_NO_LONGER_ACTIVE'); if (a.leaseUntil && a.leaseUntil > Date.now())
    fail('RUNNER_LEASE_BUSY'); a.lease = uid(); a.leaseUntil = Date.now() + 12000; return { lease: a.lease, node: structuredClone(n), attempt: structuredClone(a), consent: p.consent }; }
export function acceptResult(p: Project, runId: string, nodeId: string, attempt: number, lease: string, result: {
    logs: {
        level: string;
        text: string;
    }[];
    artifacts: Artifact[];
    status: string;
    retryable?: boolean;
}) { const r = p.runs.find(r => r.id === runId), n = G.get(p.graph, nodeId), a = n.attempts.at(-1); if (!r || terminal(r) || !a || a.id !== attempt || a.runId !== runId || a.lease !== lease || !a.leaseUntil || a.leaseUntil < Date.now() || n.status !== 'running')
    return { accepted: false }; a.retryable=result.retryable??false; return { accepted: complete(p, r, n, a, result.status, result.logs, result.artifacts) }; }
