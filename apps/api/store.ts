import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import type { Project, Principal } from '../../packages/contracts/index.ts';
const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(key => [key, canonical(x[key])])) : x;
export const digest = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(canonical(x))).digest('hex');
export const uid = () => randomUUID();
export function fail(code: string): never { throw new Error(code); }
export function authorize(p: Project, actor: Principal, write = false) { const role = p.members[actor.id]; if (!role || (write && role === 'viewer'))
    fail('PROJECT_ACCESS_DENIED'); }
export function event(p: Project, type: string, detail: any) { p.events.push({ seq: (p.events.at(-1)?.seq || 0) + 1, time: new Date().toISOString(), type, detail }); }
export class Store {
    readonly pool: pg.Pool;
    constructor(url = process.env.CI_DATABASE_URL) { if (!url)
        fail('DATABASE_CONFIGURATION_REQUIRED'); this.pool = new pg.Pool({ connectionString: url, max: 10 }); }
    async init() { const c = await this.pool.connect(); try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(622019831)');
        await c.query(`CREATE TABLE IF NOT EXISTS ci_projects(id text PRIMARY KEY, document jsonb NOT NULL); CREATE TABLE IF NOT EXISTS ci_commands(project_id text NOT NULL,id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(project_id,id)); CREATE TABLE IF NOT EXISTS ci_outbox(id text PRIMARY KEY,run_id text NOT NULL,project_id text NOT NULL,delivered boolean NOT NULL DEFAULT false,created_at timestamptz DEFAULT now());`);
        await c.query('COMMIT');
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } }
    async list(actor: Principal) { const r = await this.pool.query('SELECT document FROM ci_projects ORDER BY id'); return r.rows.map(x => x.document as Project).filter(p => p.members[actor.id]).map(p => ({ id: p.id, title: p.title, version: p.version, kind: p.lifecycle?.kind, parentId: p.lifecycle?.parentId, legacyProjectId: p.lifecycle?.legacySource?.projectId, status: p.runs.at(-1)?.status || 'draft' })); }
    async get(id: string, actor?: Principal) { const r = await this.pool.query('SELECT document FROM ci_projects WHERE id=$1', [id]); const p = r.rows[0]?.document as Project; if (!p)
        fail('PROJECT_NOT_FOUND'); if (actor)
        authorize(p, actor); return p; }
    async create(p: Project, commandId: string) { const c = await this.pool.connect(); try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [p.id]);
        const fingerprint = digest({ actor: Object.keys(p.members)[0], title: p.title, goal: p.goal, ...(p.lifecycle ? {kind:p.lifecycle.kind,parentId:p.lifecycle.parentId,legacySource:p.lifecycle.legacySource,versionName:p.lifecycle.versionName}: {}) });
        const existing = await c.query('SELECT document FROM ci_projects WHERE id=$1', [p.id]);
        if (existing.rowCount) {
            const original = await c.query('SELECT fingerprint FROM ci_commands WHERE project_id=$1 AND id=$2', [p.id, commandId]);
            if (original.rows[0]?.fingerprint !== fingerprint)
                fail('COMMAND_ID_REUSED');
            await c.query('COMMIT');
            return existing.rows[0].document as Project;
        }
        await c.query('INSERT INTO ci_projects VALUES($1,$2)', [p.id, p]);
        await c.query('INSERT INTO ci_commands VALUES($1,$2,$3,$4)', [p.id, commandId, fingerprint, { project: p }]);
        await c.query('COMMIT');
        return p;
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } }
    // Child creation participates in the parent's transaction: a failed
    // handbook link or quota check must not leave an orphan requirement.
    async createChild(p:Project, commandId:string, c:pg.PoolClient){
        const fingerprint=digest({title:p.title,goal:p.goal,parentId:p.lifecycle?.parentId});
        const existing=await c.query('SELECT document FROM ci_projects WHERE id=$1',[p.id]);
        if(existing.rowCount){
            const command=await c.query('SELECT fingerprint FROM ci_commands WHERE project_id=$1 AND id=$2',[p.id,commandId]);
            if(command.rows[0]?.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED');
            return existing.rows[0].document as Project;
        }
        await c.query('INSERT INTO ci_projects VALUES($1,$2)',[p.id,p]);
        await c.query('INSERT INTO ci_commands VALUES($1,$2,$3,$4)',[p.id,commandId,fingerprint,{project:p}]);
        return p;
    }
    async mutate(id: string, actor: Principal | undefined, expected: number | undefined, commandId: string | undefined, input: unknown, fn: (p: Project, c: pg.PoolClient) => Promise<any> | any) {
        const c = await this.pool.connect();
        try {
            await c.query('BEGIN');
            const r = await c.query('SELECT document FROM ci_projects WHERE id=$1 FOR UPDATE', [id]);
            const p = r.rows[0]?.document as Project;
            if (!p)
                fail('PROJECT_NOT_FOUND');
            if (actor)
                authorize(p, actor, true);
            const fingerprint = digest(input);
            if (commandId) {
                const existing = await c.query('SELECT fingerprint,result FROM ci_commands WHERE project_id=$1 AND id=$2', [id, commandId]);
                if (existing.rowCount) {
                    if (existing.rows[0].fingerprint !== fingerprint)
                        fail('COMMAND_ID_REUSED');
                    await c.query('COMMIT');
                    return { ...existing.rows[0].result, project: p, replayed: true };
                }
            }
            if (expected !== undefined && expected !== p.version)
                fail('REVISION_CONFLICT');
            const before = JSON.stringify(p);
            const value = await fn(p, c);
            if (JSON.stringify(p) !== before) {
                p.version++;
                await c.query('UPDATE ci_projects SET document=$2 WHERE id=$1', [id, p]);
            }
            const result = { ...value, project: p };
            if (commandId)
                await c.query('INSERT INTO ci_commands VALUES($1,$2,$3,$4)', [id, commandId, fingerprint, result]);
            await c.query('COMMIT');
            return result;
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    }
    async close() { await this.pool.end(); }
}
