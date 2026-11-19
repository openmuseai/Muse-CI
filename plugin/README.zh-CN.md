# Muse-CI 0.4.0 插件

本目录是 Muse-CI 的活动插件源码，和后端使用同一仓库、合同、版本与评审分支。

- [0.4.0 功能与交互](../docs/releases/0.4.0/PLAN.zh-CN.md)
- [实际 CI 版本主流程与子需求](../docs/releases/0.4.0/CI-RUN.json)
- Web/Desktop 默认 100% 缩放，节点只显示标题、状态与必要操作。更多信息、日志和人工标过在详情中。
- Step 的原生配置 SmartDoc 发布校验后生效，并固定到 Run。草稿/漂移不能启动执行。
- 可变文档进入完整原生编辑器；历史 .sydoc 产物通过摘要固定的标准 MCP Resources 进入只读原生 SmartDoc。浏览器直接阅读富文档。

在仓库根执行 `npm run plugin:test`、`npm run plugin:build`。开发安装脚本为 `plugin/scripts/install-development-hosts.mjs`，只更新明确指定的开发 Host，不放开正式市场策略。`docs/01` 至 `docs/10` 保留原型阶段的设计记录，历史证据保留在 Ecosystem 原仓库。
