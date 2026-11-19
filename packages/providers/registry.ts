import { digest } from '../../apps/api/store.ts';
export const skillRegistry = [
    { id: 'ci-product', version: '1.0.0', instructions: '输出用户、目标、范围、不做项、功能编号与可验证验收条件。设计提案与真实执行事实分开。' },
    { id: 'ci-ui', version: '1.0.0', instructions: '覆盖 Desktop 画布与 Mobile 分组列表、配置、材料、运行、错误和产物入口。每项交互关联功能与验收。' },
    { id: 'ci-architecture', version: '1.0.0', instructions: '定义 MCP 合同、真源、工作流、权限、输入失效、隔离与恢复，Host 不包含 CI 业务。' }
].map(s => ({ ...s, sha256: digest(s.instructions) }));
