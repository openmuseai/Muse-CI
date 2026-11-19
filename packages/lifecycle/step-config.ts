import {z} from 'zod';
import {configSchema,definitionSchema,type Project,type Principal,type Definition} from '../contracts/index.ts';
import {createDocument,editDocument,getDocument,nativeProjection,documentPin} from '../documents/smartdoc.ts';
import {digest,fail,event} from '../../apps/api/store.ts';
import {skillRegistry} from '../providers/registry.ts';
import {knownTools} from '../providers/index.ts';
import {isCodingTool} from '../providers/coding.ts';

export const stepConfigurationSchema=z.object({
  $schema:z.literal('openmuse.ci.step/1'),stepId:z.string().min(1).max(100),goal:z.string().min(1).max(6000),
  nodes:z.array(z.object({nodeId:z.string().min(1).max(100),config:configSchema}).strict()).min(1).max(60),
}).strict();
const nodeConfiguration=(p:Project,stepId:string)=>p.graph.nodes.filter(n=>n.stage===stepId).map(n=>({nodeId:n.id,config:n.config}));
export const stepConfigDigest=(p:Project,stepId:string)=>digest(nodeConfiguration(p,stepId));

export function createStepConfiguration(p:Project,stepId:string,actor:Principal){
  if(!p.lifecycle)fail('LIFECYCLE_REQUIRED');const stage=p.graph.stages.find(s=>s.id===stepId);if(!stage)fail('STEP_NOT_FOUND');
  const existing=p.stepConfigurations?.[stepId];if(existing)return getDocument(p,existing.documentId);
  const doc=createDocument(p,stage.name+' · 阶段配置','step-config',[
    '本智能文档是本阶段的配置来源。可与 CI Agent 协作编辑目标、Skill、受信工具、材料与输出。',
    '下方 JSON 代码块使用 openmuse.ci.step/1。只有发布并通过校验后才生效；草稿与修改会阻止旧配置运行。禁止任意 Shell、URL 工具及未授权材料。',
  ],{stepId,parentId:p.lifecycle.handbookId});
  editDocument(p,doc.id,doc.revision,[{op:'append',type:'code',text:JSON.stringify({$schema:'openmuse.ci.step/1',stepId,goal:stage.name,nodes:nodeConfiguration(p,stepId)},null,2)}],actor,false,'初始化原生阶段配置');
  const parent=getDocument(p,p.lifecycle.handbookId);editDocument(p,parent.id,parent.revision,[{op:'link',text:stage.name+' / 阶段配置',documentId:doc.id}],actor,false,'归档阶段配置入口');
  p.stepConfigurations??={};p.stepConfigurations[stepId]={documentId:doc.id};event(p,'step.configuration_created',{stepId,documentId:doc.id,actor:actor.id});return doc;
}
export function compileStepConfiguration(p:Project,documentId:string):Definition{
  const doc=getDocument(p,documentId);if(doc.kind!=='step-config'||!doc.stepId||p.stepConfigurations?.[doc.stepId]?.documentId!==doc.id)fail('STEP_CONFIG_NOT_BOUND');
  const code=nativeProjection(doc.body).filter((b:any)=>b.type==='code');if(code.length!==1)fail('STEP_CONFIG_CODE_REQUIRED');
  let data;try{data=stepConfigurationSchema.parse(JSON.parse(code[0].text));}catch{fail('STEP_CONFIG_INVALID');}
  if(data.stepId!==doc.stepId)fail('STEP_CONFIG_SCOPE_MISMATCH');
  const nodes=p.graph.nodes.filter(n=>n.stage===doc.stepId),ids=data.nodes.map(n=>n.nodeId);
  if(new Set(ids).size!==ids.length||ids.length!==nodes.length||nodes.some(n=>!ids.includes(n.id)))fail('STEP_CONFIG_NODE_COVERAGE');
  for(const {config} of data.nodes){
    if(config.skills.some(id=>!skillRegistry.some(s=>s.id===id)))fail('STEP_CONFIG_SKILL_UNTRUSTED');
    if(config.tools.some(tool=>!knownTools.has(tool)&&!isCodingTool(tool)))fail('STEP_CONFIG_TOOL_UNTRUSTED');
    for(const m of config.materials){
      if(m.kind==='smartdoc'){const input=getDocument(p,m.documentId);if(input.id===doc.id||input.publishedRevision!==m.revision||input.revision!==m.revision)fail('SMARTDOC_NOT_PUBLISHED');}
      else if(m.kind==='attachment'){if(!p.materials?.[m.sha256]||p.materials[m.sha256].size!==m.size)fail('MATERIAL_NOT_FOUND');}
      else if(m.kind==='upstream'){if(!p.graph.nodes.some(n=>n.id===m.nodeId))fail('NODE_NOT_FOUND');}
      else fail('USE_SMARTDOC_FOR_DOCUMENT_MATERIALS');
    }
  }
  return definitionSchema.parse({stages:p.graph.stages,nodes:p.graph.nodes.map(({id,title,stage,kind,depends,config})=>({id,title,stage,kind,depends,config:data.nodes.find(n=>n.nodeId===id)?.config||config}))});
}
export function assertStepConfiguration(p:Project,stepId:string){
  const binding=p.stepConfigurations?.[stepId];if(!binding)return;
  const doc=getDocument(p,binding.documentId);
  if(!binding.publishedRevision||binding.publishedRevision!==doc.revision||doc.publishedRevision!==doc.revision)fail('STEP_CONFIG_NOT_PUBLISHED');
  if(binding.configDigest!==stepConfigDigest(p,stepId))fail('STEP_CONFIG_DRIFT');
}
export function stepConfigurationSnapshot(p:Project,stepId:string){
  assertStepConfiguration(p,stepId);const binding=p.stepConfigurations?.[stepId];if(!binding)return undefined;
  const doc=getDocument(p,binding.documentId),blocks=nativeProjection(doc.body);
  const config=JSON.parse(blocks.find((b:any)=>b.type==='code').text);
  return {...documentPin(p,binding.documentId,binding.publishedRevision!),goal:config.goal as string,instructions:blocks.filter((b:any)=>b.type!=='code').map((b:any)=>b.text).join('\n')};
}
