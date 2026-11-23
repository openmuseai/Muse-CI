# Muse-CI 0.6 验收记录

2026-11-23，分支 `feat/0.6-project-hierarchy`。实现已推送，草稿 MR：[openmuseai/Muse-CI#3](https://github.com/openmuseai/Muse-CI/pull/3)，目标分支为 0.5 迭代分支。未提审、未合并、未正式发布。

长期项目、版本、需求和节点分开管理；项目配置位于 `.muse-project-muse-ci/project.json`。版本归档在其 `versions/0.6.0`，需求根为实际 Git 仓库，材料在 `.muse/requirements/<id>`。项目 Skill、规范与流程模板采用约定目录，显式配置严格验证。历史 ID、原生文档和运行记录保留，0.4/0.5 与 Mobile 1.0.2 均显式归属。

验证：71 项后端测试、34 项插件测试、TypeScript 校验及打包通过；7 项真实 PostgreSQL/文件系统集成用例通过。真实 Muse-CI 版本与三个子需求已建立，原生 SmartDoc 通过国内云协作发布，节点实际执行、运行输入和结果归档。重跑使下游结果过期，随后由 CI 重新执行；MR 与版本发布门禁保持。

## 实际设备

普通 QA App `com.openmuseai.mobile.acceptance`，1.0.2+112360，入口 `lib/main.dart`。国内生产服务 `cn.openmuseai.com`，既有公网配对中转至 Desktop，再访问 Desktop 私有 CI；没有 `adb reverse` 业务转发。

| 环境 | 实际操作与结果 |
| --- | --- |
| Desktop QA | DSH 旁打开 CI；切换到 Muse-CI 0.6；交付物直接打开完整原生 SmartDoc |
| Find N6 展开屏（PLP110，2248×2480） | 应用 Tab → Muse-CI；项目切换；0.6→0.5→0.6；真实 MR #2 同步固定源 SHA 并查看 Diff；产品稿原生打开；版本节点第二次执行成功与 .sydoc 产物 |
| Find N6 物理折叠外屏（1140×2616） | 项目/版本选择；进入 HIER-02 独立需求；显式同步 9 份文档归档，显示三个根路径；feature-prd 第二次执行成功；第二次产物在原生 SmartDoc 打开 |

证据索引：[device-e2e.json](evidence/device-e2e.json)、[immutable-attempts.json](evidence/immutable-attempts.json)、[postgres-integration.json](evidence/postgres-integration.json)、[EXECUTION.json](EXECUTION.json)。截图见 evidence 目录。设备操作通过原生镜像完成；物理折叠由用户操作。镜像在键盘操作后需要重启输入通道，未把该问题宣称为 App 功能缺陷。更新/重启 Desktop 后，手机通过现有配对页刷新授权再连接。

CI Agent 以已授权国内账号的委托身份将实际验收写入 HIER-03 原生测试报告；这不构成独立服务账号或平台审批。

后续用户将重点转向独立通用 Repository Review 插件，其 0.1.0 版本已另外建立。现有 CI 内嵌 Diff 页面仅作为旧功能回归证据，不等同新插件已完成高亮审阅交付。
