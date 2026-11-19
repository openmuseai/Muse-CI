# 本机 AI 整改执行器

2026-11-18，Mobile 1.0.2 首个真实试验。

## 运行方式

Muse-CI 的 Temporal Activity 直接调用本机已认证的 Codex 非交互进程，使用 Desktop 随附的 CLI。Homebrew CLI 不兼容当前模型，不能混用。DSH 首次真实探测返回 `QUOTA: Insufficient Balance`；没有将该失败写成模型可用。既有 `CI_AI_MCP_URL` 提案接口保留，但它不能自动执行代码。

配置位于本机忽略的 `.data/development.env`：`CI_CODING_EXECUTOR=codex-local`、`CI_CODEX_EXECUTABLE`、`CI_CODEX_MODEL`。账号仍由 CLI 管理；插件页面和项目数据不保存账号令牌。当前接收方为 ChatGPT，数据类别为目标、节点材料、选定源码；项目保存明确授权，撤回会停止后续工作。

采用 [官方非交互执行方式](https://learn.chatgpt.com/docs/non-interactive-mode)，同时以实际安装版本的 `exec --help` 为参数真源。仅固定四种整改工具可进入执行器，节点不能指定任意 shell、工作目录或 CLI 参数。

## 完整开发闭环

1. `prepare` 保留并取消上一轮检查 Run，导入 A01–A04 及 V01–V03，记录用户已确认的 1.0.2 / 四渠道范围。品牌不自动决定。
2. `run A01` 从选定当前源码生成独立快照，用 `workspace-write` 执行模型任务。快照不复制 Git 元数据、环境文件、凭据、用户文档、编译缓存或 vendor 源码。
3. 执行器要求真实进程退出 0 和 `turn.completed`，保存模型用量、最终答复、候选变更及基线摘要。模型推理文本不投影为项目产物。
4. 监督者审查实际候选内容，再调用 `ci_coding_apply`。后端检查本次最新成功 Attempt、输入摘要、Run 源码摘要、内容摘要、任务写入范围、逐文件基线与目标符号链接。禁止删除文件、修改许可证、凭据、发布状态和执行器自身。
5. 应用操作记录 `coding.patch_applied` 事件。既有机器检查标记过期；下游编码和验证节点必须有对应应用事件，不能把候选生成成功当已应用。
6. 每项编码任务独立 Run，顺序应用，重新固定下一轮输入。V01–V03 和 C01–C08 在真实检出独立运行，不信任模型自报通过。最终包、真机和商店回执仍是独立关口。

```sh
npx tsx scripts/mobile-remediate.ts prepare
npx tsx scripts/mobile-remediate.ts run A01
# 审查导出的 candidate-patch.json 后，执行：
npx tsx scripts/mobile-remediate.ts apply A01
# 依次处理 A02、A03、A04，然后：
npx tsx scripts/mobile-remediate.ts verify
```

重复调用不会自动重复已应用任务。重新修复需要新增 Attempt，保留原候选、失败和检查证据。

## 开发边界

- 这是本机开发执行面，不是生产多租户隔离 Runner。操作系统写入限制与文件范围校验不能替代容器或微虚拟机隔离。
- 模型费用与 token 用量保存为事实；节点额度只限制派发次数，不是金额预算。
- 每个节点有超时、取消和租约；进程组接收 TERM 后升级为 KILL，撤回授权触发停止。确认撤回前已经发送的数据不能撤回。
- 源码快照只覆盖选定路径；不宣称是完整冻结 SourceSet。来源审查、许可证义务及最终构建 SBOM 不能由扫描零命中推导。
- 文件应用与 PostgreSQL 提交尚不是跨文件系统原子事务。保留候选和应用事件，崩溃后的基线冲突必须显式恢复，不能盲目覆盖。
- 修复旧流程时保留原 Temporal 历史，在确认没有执行中作业后重启其控制执行。新流程使用命令 Signal 唤醒，空闲时不高频轮询，并定期 Continue-As-New 限制历史大小。

本机 worker 使用 `maxCachedWorkflows: 0`，避免强制重启后工作继续等待旧进程的 sticky queue；新进程从持久历史回放。该设置有回放开销，不能直接当生产调优结论，选项见 [Temporal WorkerOptions](https://typescript.temporal.io/api/interfaces/worker.WorkerOptions#maxcachedworkflows)。Activity 返回接收回执，不再把完整项目/候选源码复制进 Temporal 历史。端到端测试使用独立 PostgreSQL schema 和 task queue，避免测试 API 抢走真实整改 Run 的 Outbox。
