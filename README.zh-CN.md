# Muse-CI 执行后端

插件 UI、MCP stdio 适配、标准 MCPB 和产品文档在 `../Muse-Plugin-Ecosystem/plugins/muse-ci/`。此目录包含执行后端与开发栈。正式架构见 docs/Architectur-Discussion.md，实际完成范围见插件 docs/06-IMPLEMENTATION-AND-ACCEPTANCE.zh-CN.md。

```sh
npm ci
npm run stack:up
npm run dev
```

打开 `http://127.0.0.1:4180/`。`/host` 是使用官方 MCP Apps SDK 的通用沙箱验证入口；`/mcp` 是经开发 token 验证的实际 MCP 服务。PostgreSQL 使用独立 15436 端口，Temporal 使用 17236/18236；都仅绑定 127.0.0.1。`.data/development.env` 自动生成、权限 0600、忽略提交；不在插件 HTML 中嵌入 token。

`npm run typecheck`、`npm test`、`npm run e2e` 和 `node scripts/host-conformance.mjs` 为验收入口。端到端脚本自行管理独立 API/worker，测试完关闭进程；开发 UI 栈由 `npm run dev` 管理。`npm run stack:stop` 保留数据卷。

当前是开发里程碑：开发身份、受控本机检查、数据库小产物、持久 Temporal。已接入本机 Codex 真实编码执行器（DSH 因余额不足保持阻断），执行隔离快照、候选补丁、受控应用与独立验证。使用说明及开发边界见 [编码执行器](docs/CODING-EXECUTOR.zh-CN.md)。生产隔离/对象存储、GoTrue/OAuth、Mobile 原生后装及正式发布仍待完成，不能用本机开发证据代替。
