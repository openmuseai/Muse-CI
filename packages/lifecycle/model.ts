import type { Project, Principal, GraphNode } from '../contracts/index.ts';
import { digest, event, fail } from '../../apps/api/store.ts';
import { createDocument, documentIndex, documentPin, editDocument, getDocument } from '../documents/smartdoc.ts';
import {assertStepConfiguration} from './step-config.ts';

type NodeSpec = [string, string, string, string];
const templates: Record<'version' | 'requirement', { id: string; name: string; nodes: NodeSpec[] }[]> = {
  version: [
    { id: 'definition', name: '版本定义', nodes: [['version-scope', '圈定版本范围与粗粒度 PRD', 'product', 'version-prd']] },
    { id: 'visual', name: '版本视觉与 UI', nodes: [['version-ui', '版本视觉方向与 UI 设计', 'ui', 'ui-design']] },
    { id: 'requirements', name: '需求拆分与交付', nodes: [['requirement-plan', '拆分子需求与验收边界', 'product', 'requirement-plan']] },
    { id: 'regression', name: '版本回归测试', nodes: [['regression-cases', '版本回归测试用例', 'test', 'test-cases'], ['regression-report', '执行版本回归与测试报告', 'test', 'test-report']] },
    { id: 'release', name: '版本上架', nodes: [['release-materials', '候选包、上架材料与渠道计划', 'artifact', 'release-plan'], ['release-result', '渠道上架与真实回执', 'approval', 'release-receipt']] },
  ],
  requirement: [
    { id: 'prd', name: '功能需求 PRD', nodes: [['feature-prd', '细化范围、规则与每一项验收条件', 'product', 'feature-prd']] },
    { id: 'design', name: '视觉与 UI 设计', nodes: [['feature-ui', '界面、交互状态与多端设计', 'ui', 'ui-design']] },
    { id: 'solution', name: '方案设计与研发', nodes: [['feature-solution', '架构、协议、数据与实施方案', 'architecture', 'solution'], ['implementation', '实现功能与研发验证', 'agent', 'implementation']] },
    { id: 'testing', name: '需求测试', nodes: [['feature-cases', '功能测试用例与覆盖矩阵', 'test', 'test-cases'], ['feature-report', '执行测试并交付测试报告', 'test', 'test-report']] },
    { id: 'merge', name: 'MR 提审与合并', nodes: [['mr-review', 'MR 提审、评审与修订', 'approval', 'mr-review'], ['mr-merge', '合并与来源提交核验', 'approval', 'merge-receipt']] },
  ],
};
export function lifecycleTemplates() { return structuredClone(templates); }
export function requiredNodeIds(kind:'version'|'requirement'){return new Set(templates[kind].flatMap(s=>s.nodes.map(n=>n[0])));}
const documentPrompts: Record<string, string[]> = {
  'version-prd': ['版本名称与目标：', '纳入功能及用户价值：', '明确不做的范围：', '渠道、平台、兼容性与迁移约束：', '版本验收标准与风险：'],
  'feature-prd': ['用户、场景、问题和可衡量目标：', '详细范围与明确不做的范围：', '每个流程的前置条件、输入、规则、输出：', '字段定义、权限、异常、边界、空态、并发、离线：', '平台差异、兼容、迁移、隐私与可访问性：', '逐项验收条件与可追溯编号：'],
  'ui-design': ['页面与组件清单：', '视觉稿与可定位的设计源文件：', '主路径、空态、加载、失败、禁用与恢复：', 'Desktop/Web/Mobile 适配与交互标注：', '产品验收项与设计元素对应关系：'],
  solution: ['上下游合同、数据模型与权限边界：', '模块拆分与实施任务：', '并发、失败恢复、迁移与兼容策略：', '方案取舍、风险、回滚与监控：', '验收项、实施改动与测试的映射：'],
  'test-cases': ['用例 ID | 关联需求 | 环境/前置条件 | 操作步骤 | 预期结果 | 优先级：', '主流程、异常、边界、权限、并发和升级用例：', '平台与设备覆盖、执行人和测试数据：'],
  'test-report': ['固定输入：版本、提交、包摘要、用例修订、环境与设备：', '实际执行的用例 ID、结果、时间、原始证据位置：', '通过/失败/未执行数量与未覆盖项：', '缺陷与回归记录、风险和结论：', '报告正文不能代替实际测试执行或产物证明。'],
  'requirement-plan': ['需求编号、目标、范围、负责人、依赖、交付标准：', '每个需求单独建立子流程，不在版本画布平铺研发节点。', '所有子需求达到交付关口后，才进入版本回归。'],
  implementation: ['实现范围、源码位置、来源提交与可审查的改动：', '构建/研发验证记录、已知风险、回滚：'],
  'release-plan': ['版本、渠道、候选包、构建号与摘要：', '签名、隐私、版权、截图、商店材料的位置：', '发布审批、回滚与分渠道计划：'],
  'release-receipt': ['真实上传、提审、审核、上架状态与渠道回执：', '未取得真实回执不得宣称已发布。'],
  'mr-review': ['代码仓库、源/目标分支、MR URL 和源提交：', '评审意见、修订、检查与验收记录：'],
  'merge-receipt': ['MR URL、合并状态、目标分支与实际合并提交：', '来源核验及合并后检查：', '文档或人工标过不构成真实合并证明。'],
};
export function initializeLifecycle(p: Project, kind: 'version' | 'requirement', versionName?: string) {
  p.type = kind === 'version' ? '版本生命周期' : '需求生命周期';
  p.documents = {};
  p.lifecycle = { kind, children: [], handbookId: '', agentEnabled: true, ...(versionName ? { versionName } : {}) };
  p.graph = { schema: 1, designVersion: 2, stepPolicy: 'ordered', revision: 1, sequence: 0, stages: templates[kind].map(s => ({ id: s.id, name: s.name })), nodes: [] };
  const handbook = createDocument(p, '00 · ' + p.title + ' · 流程总文档', 'handbook', [p.goal, '本总文档是流程唯一材料入口。按 Step 归档 PRD、UI、方案、用例、报告和回执；需求子流程在需求拆分 Step 进入。', '文档使用 SmartDoc 原生协作状态；历史尝试与产物不可覆盖。']);
  p.lifecycle.handbookId = handbook.id;
  for (const step of templates[kind]) for (const [id, title, nodeKind, docKind] of step.nodes) {
    const prior = p.graph.nodes.filter(n => n.stage === step.id).at(-1);
    const n: GraphNode = { id, title, stage: step.id, kind: nodeKind, status: 'pending', revision: 1, attempts: [], staleReason: '', depends: prior ? [prior.id] : [], config: { description: '交付归档于本 Step 的 SmartDoc 文档', goal: title, skills: [], tools: [], materials: [], outputName: id + '.sydoc', timeout: 20, retries: 0 } };
    const doc = createDocument(p, title, docKind, documentPrompts[docKind] || ['交付内容与证据：'], { stepId: step.id, nodeId: id, parentId: handbook.id });
    // Design deliverables compile a published native snapshot, not simulated AI text.
    if (!['agent', 'approval'].includes(nodeKind) && !['test-report'].includes(docKind)) n.config.tools = ['smartdoc-publish'];
    if(n.config.tools.includes('smartdoc-publish'))n.config.materials = [{ kind: 'smartdoc', name: doc.title, documentId: doc.id, revision: 1 }];
    p.graph.nodes.push(n);
    editDocument(p, handbook.id, handbook.revision, [{ op: 'link', text: step.name + ' / ' + title, documentId: doc.id }], { id: 'ci-system' }, false, '归档 Step 交付文档');
  }
  for(const n of p.graph.nodes.filter(n=>n.id.endsWith('report'))){
    const cases=Object.values(p.documents).find(d=>d.kind==='test-cases');
    if(cases)n.config.materials=[{kind:'smartdoc',name:cases.title,documentId:cases.id,revision:cases.revision}];
  }
  event(p, 'lifecycle.created', { kind, handbookId: handbook.id });
  return p;
}
export function lifecycleSummary(p: Project) {
  if (!p.lifecycle) return undefined;
  return { ...p.lifecycle, documents: documentIndex(p), steps: p.graph.stages.map((s, index) => {
    const nodes = p.graph.nodes.filter(n => n.stage === s.id);
    const docs = Object.values(p.documents || {}).filter(d => d.stepId === s.id);
    return { ...s, number: index + 1, status: nodes.every(n => ['succeeded', 'marked'].includes(n.status)) && nodes.length ? 'completed' : nodes.some(n => ['running', 'awaiting_review'].includes(n.status)) ? 'running' : 'pending', total: nodes.length, done: nodes.filter(n => ['succeeded', 'marked'].includes(n.status)).length, documents: docs.map(d => d.id) };
  }) };
}
export function stepAdmission(p: Project, n: GraphNode, externalVerification=false) {
  if (!p.lifecycle) return;
  assertStepConfiguration(p,n.stage);
  if(['mr-review','mr-merge'].includes(n.id)&&!externalVerification)fail('USE_MR_RECEIPT_VERIFICATION');
  if(n.id==='release-result'||n.id==='mr-merge'&&p.mergeRequest?.state!=='merged')fail('EXTERNAL_RECEIPT_PROVIDER_NOT_CONFIGURED');
  const index = p.graph.stages.findIndex(s => s.id === n.stage);
  const reportId=p.lifecycle.kind==='version'?'regression-report':'feature-report';
  const report=p.graph.nodes.find(x=>x.id===reportId);
  if(report&&index>p.graph.stages.findIndex(s=>s.id===report.stage)&&!verifiedTestReport(p,reportId))fail('ACTUAL_TEST_REPORT_REQUIRED');
  for(const upstream of p.graph.nodes.filter(x=>p.graph.stages.findIndex(s=>s.id===x.stage)<index&&x.status==='succeeded'))if(upstream.config.tools.some(t=>t.startsWith('mobile-fix-'))&&!p.events.some(e=>e.type==='coding.patch_applied'&&e.detail.nodeId===upstream.id&&e.detail.attempt===upstream.attempts.at(-1)?.id))fail('CODING_PATCH_NOT_APPLIED');
  for (const step of p.graph.stages.slice(0, index)) {
    for (const upstream of p.graph.nodes.filter(x => x.stage === step.id)) {
      if (!['succeeded', 'marked'].includes(upstream.status)) fail('PREVIOUS_STEP_INCOMPLETE');
      const docs = Object.values(p.documents || {}).filter(d => d.nodeId === upstream.id);
      if (!docs.length || docs.some(d => !d.publishedRevision || d.publishedRevision !== d.revision)) fail('STEP_DELIVERABLES_MISSING');
    }
  }
}
export function markNode(p: Project, nodeId: string, marked: boolean, reason: string, actor: Principal) {
  if (!p.lifecycle) fail('LIFECYCLE_REQUIRED');
  if (p.runs.some(r => !['failed', 'succeeded', 'canceled'].includes(r.status))) fail('RUN_ACTIVE_PLAN_LOCKED');
  const node = p.graph.nodes.find(n => n.id === nodeId);
  if (!node) fail('NODE_NOT_FOUND');
  if (marked && node.mark) fail('NODE_ALREADY_MARKED');
  if (marked) {
    node.mark = { actor: actor.id, reason, at: new Date().toISOString(), revision: node.revision, previousStatus: node.status };
    node.status = 'marked';
  } else {
    if (!node.mark) fail('NODE_NOT_MARKED');
    node.status = node.mark.previousStatus;
    delete node.mark;
  }
  // Ordered Steps make later results dependent on earlier human decisions.
  const stepIndex = p.graph.stages.findIndex(s => s.id === node.stage);
  const later = new Set(p.graph.stages.slice(stepIndex + 1).map(s => s.id));
  const affected=new Set(p.graph.nodes.filter(n=>later.has(n.stage)).map(n=>n.id));affected.add(node.id);
  let changed=true;while(changed){changed=false;for(const n of p.graph.nodes)if(!affected.has(n.id)&&n.depends.some(id=>affected.has(id))){affected.add(n.id);changed=true;}}
  for (const down of p.graph.nodes) if (down.id!==node.id&&affected.has(down.id)&&(down.attempts.length||down.mark)) { down.status = 'stale'; delete down.mark; down.staleReason = '上游人工标过记录变化，需要重新验证。'; }
  event(p, marked ? 'node.manually_marked' : 'node.mark_revoked', { nodeId, actor: actor.id, reason, revision: node.revision });
}
export function invalidateDocumentConsumers(p: Project, documentId: string) {
  const doc = getDocument(p, documentId);
  const seeds=p.graph.nodes.filter(n=>n.id===doc.nodeId||doc.kind==='step-config'&&n.stage===doc.stepId||n.config.materials.some(m=>m.kind==='smartdoc'&&m.documentId===documentId));
  const index=Math.min(...seeds.map(n=>p.graph.stages.findIndex(s=>s.id===n.stage)));
  const affected=new Set(seeds.map(n=>n.id));let changed=true;while(changed){changed=false;for(const n of p.graph.nodes)if(!affected.has(n.id)&&n.depends.some(id=>affected.has(id))){affected.add(n.id);changed=true;}}
  for (const n of p.graph.nodes) if (affected.has(n.id) || Number.isFinite(index) && p.graph.stages.findIndex(s => s.id === n.stage) > index) {
    const attempt=n.attempts.at(-1);
    if(['running','awaiting_review'].includes(n.status)&&attempt&&['running','awaiting_review'].includes(attempt.status)){
      attempt.status='failed';attempt.retryable=false;attempt.finishedAt=new Date().toISOString();delete attempt.lease;delete attempt.leaseUntil;
      attempt.logs.push({level:'error',text:'SMARTDOC_INPUT_CHANGED_DURING_RUN'});
      const run=p.runs.find(r=>r.id===attempt.runId);
      if(run&&!['succeeded','failed','canceled'].includes(run.status)){run.status='failed';run.finishedAt=attempt.finishedAt;for(const job of run.jobs)if(job.nodeId===n.id)job.completed=true;event(p,'run.input_invalidated',{runId:run.id,nodeId:n.id,documentId});}
    }
    if (n.attempts.length || n.mark) { n.status = 'stale'; delete n.mark; n.staleReason = 'SmartDoc 材料已修改，已发布修订与历史结果需要重验。'; }
  }
}
export function bindPublishedDocument(p: Project, documentId: string) {
  const doc = getDocument(p, documentId);
  for (const n of p.graph.nodes) n.config.materials = n.config.materials.map(m => m.kind === 'smartdoc' && m.documentId === documentId ? { ...m, revision: doc.revision } : m);
}
export function collectDocumentInputs(p: Project, n: GraphNode) {
  return n.config.materials.filter(m => m.kind === 'smartdoc').map(m => documentPin(p, m.documentId, m.revision));
}
export function verifiedTestReport(p:Project,id:string){
 const n=p.graph.nodes.find(n=>n.id===id),a=n?.attempts.at(-1);if(!n||n.status!=='succeeded'||a?.status!=='succeeded'||a.revision!==n.revision)return false;
 return a.artifacts.some(f=>{if(!['ci-test','ci-plugin-test','ci-policy','mobile-regression'].includes(f.producer)&&!f.producer.endsWith('-tests'))return false;try{const report=JSON.parse(f.content);return digest(f.content)===f.sha256&&report.realExecution===true&&report.exitCode===0;}catch{return false;}});
}
export function requirementsDelivered(child: Project) {
  return !!child.lifecycle && child.lifecycle.kind === 'requirement' && child.graph.nodes.every(n => ['succeeded','marked'].includes(n.status)) && verifiedTestReport(child,'feature-report') && child.mergeRequest?.state==='merged' && child.graph.nodes.find(n=>n.id==='mr-merge')?.status==='succeeded' && Object.values(child.documents || {}).filter(d => d.kind !== 'handbook').every(d => d.publishedRevision === d.revision);
}
