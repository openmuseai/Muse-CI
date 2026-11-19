# Muse-CI

Muse-CI 是 OpenMuse 可安装的 AI 原生 CI 插件与执行后端。当前迭代 **0.4.0**：简洁节点画布、SmartDoc 驱动阶段配置、原生文档与固定历史产物直接打开。

- `plugin/`：唯一活动插件源码，包含 UI、标准 MCPB stdio 适配、打包、交互测试与产品文档。
- `apps/`、`packages/`：MCP 服务、Temporal 持久执行、权限、版本化原生文档、配置编译与受控 Runner。
- [本轮范围、交互与验收计划](docs/releases/0.4.0/PLAN.zh-CN.md)、[实际 CI 主/子流程](docs/releases/0.4.0/CI-RUN.json)。

```sh
npm ci
npm run plugin:build
npm run stack:up
npm run dev
```

访问 `http://127.0.0.1:4180/`，`/host` 为通用 MCP Apps 沙箱，`/mcp` 为受开发凭据保护的服务。`npm run typecheck`、`npm test`、`npm run plugin:test`、`npm run e2e` 是实际验收入口。

本工程位于 OpenMuse 多仓工作区。原生 SmartDoc 引擎复用相邻 `Muse-Plugin-Ecosystem/plugins/markdown/smart_document/flutter/assets/wasm/` 的既有构建；Host 安装/真机脚本复用相邻 `Muse-Client`，无需将 CI 业务放入 Host。共同引擎与 Host 的许可证和源码保留在原仓库，不在此复制第三方源码。Ecosystem 中的 0.3 插件源码是历史基线；0.4 起在本仓库迭代并登记发行引用。

`.data/` 中的数据库、国内账号映射、Git/API 凭据及本地 token 全部忽略提交。PostgreSQL、Temporal、开发 API 默认仅监听回环地址。标准包为 `plugin/dist/muse-ci-0.4.0.mcpb`，发行描述为 `plugin/dist/release.development.json`。生产市场、OAuth、多用户隔离/对象存储、国内公网独立部署与商店上架属于独立发布关口。
