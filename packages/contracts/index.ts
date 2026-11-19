import { z } from 'zod';
export const CONTRACT = 'openmuse.ci/1';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const materialSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('smartdoc'), name: z.string().min(1).max(200), documentId: id, revision: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('note'), name: z.string().min(1).max(120), text: z.string().max(20000) }).strict(),
    z.object({ kind: z.literal('attachment'), name: z.string().max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/), type: z.string().max(120), size: z.number().int().max(65536).nonnegative() }).strict(),
    z.object({ kind: z.literal('file'), name: z.string().max(200), size: z.number().int().nonnegative(), type: z.string().max(120) }).strict(),
    z.object({ kind: z.literal('upstream'), name: z.string().max(200), nodeId: id, attempt: z.number().int().positive(), index: z.number().int().nonnegative() }).strict()
]);
export const configSchema = z.object({ description: z.string().max(160), goal: z.string().min(1).max(6000), skills: z.array(z.string().max(120)).max(20), tools: z.array(z.string().max(120)).max(20), materials: z.array(materialSchema).max(30), outputName: z.string().max(120), retries: z.number().int().min(0).max(5), timeout: z.number().int().min(1).max(120) }).strict();
export const definitionSchema = z.object({ stages: z.array(z.object({ id, name: z.string().min(1).max(80) }).strict()).min(1).max(20), nodes: z.array(z.object({ id, title: z.string().min(1).max(80), stage: id, kind: z.enum(['product', 'ui', 'architecture', 'agent', 'test', 'build', 'approval', 'artifact']), depends: z.array(id).max(60), config: configSchema }).strict()).min(1).max(60) }).strict();
export type Definition = z.infer<typeof definitionSchema>;
export interface Artifact {
    id?: string;
    name: string;
    kind: string;
    content: string;
    sha256: string;
    producer: string;
    inputDigest: string;
    createdAt: string;
}
export interface Attempt {
    id: number;
    status: string;
    revision: number;
    runId?: string;
    inputDigest?: string;
    inputSnapshot: any;
    startedAt: string;
    finishedAt?: string;
    logs: {
        level: string;
        text: string;
    }[];
    artifacts: Artifact[];
    lease?: string;
    leaseUntil?: number;
    provider?: string;
    retryable?: boolean;
}
export interface GraphNode {
    id: string;
    title: string;
    stage: string;
    kind: string;
    status: string;
    depends: string[];
    revision: number;
    config: z.infer<typeof configSchema>;
    attempts: Attempt[];
    staleReason: string;
    mark?: { actor: string; reason: string; at: string; revision: number; previousStatus: string };
}
export interface Graph {
    schema: 1;
    stepPolicy?: 'ordered';
    designVersion?: number;
    revision: number;
    sequence: number;
    stages: {
        id: string;
        name: string;
    }[];
    nodes: GraphNode[];
}
export interface Run {
    id: string;
    projectId: string;
    revision: number;
    graphDigest: string;
    sourceDigest?: string;
    childRevisions?: Record<string,number>;
    status: string;
    auto: boolean;
    selected: string[];
    budget: number;
    spent: number;
    startedAt: string;
    finishedAt?: string;
    decisionScope: 'development';
    jobs: {
        nodeId: string;
        attempt: number;
        completed: boolean;
    }[];
    commands: {
        id: string;
        action: string;
        nodeId?: string;
        decision?: boolean;
        inputDigest?: string;
        applied: boolean;
    }[];
}
export interface Project {
    stepConfigurations?: Record<string,{documentId:string;publishedRevision?:number;configDigest?:string}>;
    id: string;
    title: string;
    goal: string;
    type: string;
    budget: number;
    version: number;
    graph: Graph;
    runs: Run[];
    members: Record<string, 'owner' | 'developer' | 'viewer'>;
    events: {
        seq: number;
        time: string;
        type: string;
        detail: any;
    }[];
    consent?: {
        recipient: string;
        categories: string[];
        grantedAt: string;
    };
    createdAt: string;
    lifecycle?: {
        kind: 'version' | 'requirement';
        parentId?: string;
        parentStep?: string;
        versionName?: string;
        children: { projectId: string; title: string }[];
        legacySource?: { projectId: string; version: number };
        handbookId: string;
        agentEnabled: boolean;
    };
    documents?: Record<string, SmartDocRecord>;
    repository?: { provider:'github'|'gitlab'; path:string; baseBranch:string; sourceBranch:string;gitProfileId?:string };
    mergeRequest?: { provider:string; repository:string; number:number; url:string; state:string; headSha:string; mergeSha?:string; baseBranch:string; draft:boolean; verifiedAt:string };
    mrOperations?: Record<string,{action:import('../providers/repository.ts').MRAction;repository:NonNullable<Project['repository']>;status:'prepared'|'confirmed'|'blocked';receipt?:NonNullable<Project['mergeRequest']>;error?:string;waitingFor?:string;nextAttemptAt?:string;lease?:string;leaseUntil?:string;actor:string;at:string}>;
    materials?: Record<string, {
        name: string;
        content: string;
        sha256: string;
        size: number;
        type: string;
    }>;
}
export interface SmartDocRecord {
    id: string; title: string; kind: string; stepId?: string; nodeId?: string;
    parentId?: string; revision: number; publishedRevision?: number;
    archivedFromNode?: string;
    cloud?: {origin:string;workspaceId:string;viewId:string;subject:string;parentViewId:string;connectedAt:string;lastAcceptedAt?:string;pending?:boolean};
    body: { profile: 'muse.smart-document/phase1'; objectId: string; docState: string };
    versions: { revision: number; body: SmartDocRecord['body']; sha256: string; actor: string; role: 'human' | 'agent' | 'system' | 'cloud'; onBehalfOf?: string; at: string; summary: string }[];
}
export interface Principal {
    id: string;
    role?: string;
}
export const commandSchema = z.object({ projectId: id, commandId: id, expectedVersion: z.number().int().positive(), action: z.enum(['start', 'pause', 'resume', 'cancel', 'approve', 'reject', 'stop-node']), nodeIds: z.array(id).max(60).optional(), auto: z.boolean().optional(), nodeId: id.optional(), inputDigest: z.string().length(64).optional() }).strict();
export const toolsSchemas = {
    ci_step_config_create:z.object({projectId:id,stepId:id,commandId:id,expectedVersion:z.number().int().positive()}).strict(),
    ci_git_profiles_list:z.object({}).strict(),
    ci_git_profile_verify:z.object({profileId:id,repository:z.string().max(160).optional()}).strict(),
    ci_mr_reconcile:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),operationId:id}).strict(),
    ci_mr_cancel:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),operationId:id}).strict(),
    ci_mr_create:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),expectedHeadSha:z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),title:z.string().min(1).max(200),body:z.string().max(12000)}).strict(),
    ci_mr_submit:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),expectedHeadSha:z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),number:z.number().int().positive()}).strict(),
    ci_mr_merge:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),expectedHeadSha:z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),number:z.number().int().positive(),method:z.enum(['merge','squash','rebase']).default('squash')}).strict(),
    ci_document_cloud_connect:z.object({projectId:id,documentId:id,commandId:id,expectedVersion:z.number().int().positive()}).strict(),
    ci_document_sync:z.object({projectId:id,documentId:id}).strict(),
    ci_repository_bind:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),provider:z.enum(['github','gitlab']),repository:z.string().min(3).max(160),baseBranch:z.string().min(1).max(120),sourceBranch:z.string().min(1).max(120),gitProfileId:id.optional()}).strict(),
    ci_mr_verify:z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),number:z.number().int().min(1).max(100000000)}).strict(),
    ci_lifecycle_create: z.object({ kind: z.enum(['version','requirement']), title: z.string().min(1).max(100), goal: z.string().min(1).max(2000), versionName: z.string().max(40).optional(), commandId: id, legacyProjectId: id.optional() }).strict(),
    ci_requirement_create: z.object({ projectId:id, commandId:id, expectedVersion:z.number().int().positive(), title:z.string().min(1).max(100), goal:z.string().min(1).max(2000) }).strict(),
    ci_node_mark: z.object({ projectId:id, commandId:id, expectedVersion:z.number().int().positive(), nodeId:id, marked:z.boolean(), reason:z.string().min(3).max(1000) }).strict(),
    ci_document_get: z.object({projectId:id,documentId:id,revision:z.number().int().positive().optional()}).strict(),
    ci_document_create: z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),title:z.string().min(1).max(120),parentId:id,stepId:id.optional()}).strict(),
    ci_document_edit: documentEditSchema(),
    ci_agent_document_edit: documentEditSchema(),
    ci_document_publish: z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),documentId:id,expectedRevision:z.number().int().positive()}).strict(),
    ci_agent_access: z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),enabled:z.boolean()}).strict(),
    ci_open: z.object({}).strict(), ci_projects_list: z.object({}).strict(),
    ci_projects_create: z.object({ title: z.string().min(1).max(100), goal: z.string().min(1).max(2000), commandId: id }).strict(),
    ci_project_get: z.object({ projectId: id }).strict(),
    ci_plan_save: z.object({ projectId: id, commandId: id, expectedVersion: z.number().int().positive(), title: z.string().min(1).max(100), goal: z.string().min(1).max(2000), budget: z.number().int().min(1).max(1000), type: z.string().max(50) }).strict(),
    ci_graph_save: z.object({ projectId: id, commandId: id, expectedVersion: z.number().int().positive(), definition: definitionSchema }).strict(),
    ci_run_command: commandSchema,
    ci_events_list: z.object({ projectId: id, after: z.number().int().nonnegative().default(0) }).strict(),
    ci_artifact_get: z.object({ projectId: id, nodeId: id, attempt: z.number().int().positive(), index: z.number().int().nonnegative() }).strict(),
    ci_capabilities: z.object({}).strict(),
    ci_ai_consent: z.object({ projectId: id, commandId: id, expectedVersion: z.number().int().positive(), recipient: z.string().url(), categories: z.array(z.string()).min(1).max(5), grant: z.boolean() }).strict(),
    ci_material_put: z.object({ projectId: id, commandId: id, expectedVersion: z.number().int().positive(), name: z.string().min(1).max(200), text: z.string().max(65536) }).strict(),
    ci_release_check: z.object({ projectId: id }).strict()
    ,ci_coding_apply: z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),nodeId:id,attempt:z.number().int().positive(),inputDigest:z.string().length(64)}).strict()
};
function documentEditSchema(){return z.object({projectId:id,commandId:id,expectedVersion:z.number().int().positive(),documentId:id,expectedRevision:z.number().int().positive(),summary:z.string().min(1).max(200),edits:z.array(z.discriminatedUnion('op',[
    z.object({op:z.literal('append'),text:z.string().max(20000),type:z.enum(['paragraph','heading','code']).default('paragraph')}).strict(),
    z.object({op:z.literal('replace'),blockId:id,text:z.string().max(20000)}).strict(),
    z.object({op:z.literal('link'),text:z.string().min(1).max(200),documentId:id,projectId:id.optional()}).strict()
])).min(1).max(60)}).strict();}
export const releaseStages = ['需求与范围', '源码冻结', '隐私与来源', '功能回归', '构建', '包验证', '真机验收', '上传', '提审', '审核', '发布', '归档'];
