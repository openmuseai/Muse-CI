# Muse-CI 0.5.0：Mobile 公网接管与 MR 审查

分支 `feat/0.5-mobile-ci-review`，基于 0.4 开发分支 `41fee5b`，不代替尚未合并的 MR #1。

版本主流程与三个子需求已由 Muse-CI 创建，见 [CI-RUN.json](CI-RUN.json)。PRD、UI、方案与用例为流程中的原生 SmartDoc，由委托身份 CI Agent 参与编辑与发布；Markdown 只是仓库入口。

## 产品与交互

手机应用 Tab 显示已安装的 Muse-CI。点击进入版本列表，主流程与子需求分别进入各自画布。节点保留状态、运行/重跑、停止、人工标过与历史记录，操作权限和发布门禁保持一致。文档及文档产物使用原生 SmartDoc。

需求 MR Step 先同步真实回执，随后查看固定 head SHA 的文件变更。文件可折叠，显示新增/删除/修改/重命名，补丁独立横向滚动、分页读取。头部保留仓库、MR 编号、完整 SHA。二进制、缺失补丁、平台省略或大文件明确提示；源提交变化必须重新同步。查看 Diff 不等同于批准；平台禁止自审批时不伪造其他账号的批准。

## 已确定的公网链路

采用用户确认的既有通道：Mobile → 国内生产 HTTPS 配对中转 → Desktop 通用 MCP Apps 网关 → Desktop 私有 Muse-CI/Runner。无需另建 CI 公网域名或将开发 HTTP 服务直接暴露公网。USB 只用于安装和调试，不能转发业务端口。

手机从已配对 Desktop 发现已安装 App，校验本会话内的 UI 摘要，通过同一配对授权转发 MCP。Git/CI 令牌保留 Desktop。公共配对网关逐请求验证账号、设备授权及到期时间，并在请求完成后再次检查；授权撤销后丢弃在途结果。

## 工程边界

- CI 业务在插件和后端；复用 MobileWorkbenchContributor 的应用卡片、通用 MCP 会话及 SmartDoc 路由。
- RemoteMcpApp 通过通用配对发现接入 Mobile 注册表与应用 Tab，普通 QA 启动入口已实际使用。本机 remote-mcp-apps 开发目录仍受调试限制；配对安装的验证不等同于正式市场安装与发行包交付。
- Release 的插件市场还会拒绝非固定包的远端安装。需扩展通用受信安装和账号会话绑定，不可通过移除 `kDebugMode` 或摘要校验绕过。
- Diff 复用后端的受信仓库、Git profile 与平台 API 边界；Host 不执行仓库命令，GitHub Token 不进入手机 UI。后续版本管理插件可以复用同一合同，避免重复装载 Git 引擎。
- 公网 API 必须验证国内生产账号并将 uid 绑定到项目成员，使用 HTTPS、隔离持久存储和受信执行器。现有开发 HTTP 服务自动创建 local-developer 会话，不能直接经反向代理开放公网。

## 分解与验收

| 子需求 | 交付 | 验收 |
| --- | --- | --- |
| Mobile 插件 | 生产受信安装、应用 Tab、账号会话与通用资源路由 | 普通安装 App 发现卡片、卸载/重装、切账号撤回、离线恢复 |
| Diff/MR | SHA 固定的只读分页 Diff、明确缺失/截断状态、复用提审与合并门禁 | 真实平台读取、拉取前后 SHA 变化拒绝、XSS/响应大小/权限边界、手机审查 |
| 国内公网 E2E | 生产账号与 CI 公网会话、节点操作、SmartDoc、Diff/MR 全链路 | 不使用 adb reverse 或 Mac 回环；实际手机、真实回执、报告与截图 |

## 本轮进展与门禁

2026-11-23，OPPO Find N6 展开屏与物理折叠外屏均已完成普通 QA 的国内公网核心操作验收。链路是既有国内生产 HTTPS 配对中转，展开屏验收使用蜂窝网络；物理外屏本轮核验默认网络为 Wi-Fi，两轮均无 `adb reverse` 业务转发。USB 仅安装、镜像和诊断。保留原有日常 App 与资料，验收包使用独立 `com.openmuseai.mobile.acceptance`，并以普通 `main.dart` 启动。

| 验收项 | 当前证据与结论 |
| --- | --- |
| 国内账号与应用入口 | 使用 `.account` 原始完整密码（末尾 `!`）；真实生产登录、同账号 Desktop 发现、HTTPS 授权、应用 Tab 卡片打开与实际 MCP 查询通过。[入口回执](evidence/foldable-public-entry.json) |
| 版本与需求画布 | 手机实际进入 0.5 主流程及 MR 独立子需求，保持主子流程边界。 |
| 节点人工标过 | 手机及 Desktop 实际记录临时原因，再撤回；原状态已恢复，不作为测试通过或发布批准。[手机截图](evidence/find-n6-node-mark.png)、[Desktop 截图](evidence/desktop-node-mark.png) |
| 手机触发重跑 | `feature-report` Run `39651c42-2175-435c-a144-396159288445`，2026-11-22T18:01:59.080Z 至 18:02:29.385Z，实际成功。[运行截图](evidence/find-n6-node-run.png) |
| 产物 | 手机打开上述 Run 第 7 次尝试的真实测试 JSON；历史 `.sydoc` 产物在完整原生 SmartDocument 中只读打开。[本次产物](evidence/find-n6-run-artifact.png)、[历史原生文档快照](evidence/find-n6-artifact.png) |
| MR 与 Diff | 手机真实同步 [MR #2](https://github.com/openmuseai/Muse-CI/pull/2)，读取提交 `388ea1d77da69756f8d318b46032fc5db15c627b` 的实际 GitHub Diff 第 1 页。保留草稿，未批准或合并。[Diff 截图](evidence/find-n6-mr-diff.png) |
| Desktop 回读与审查 | DSH 右侧实际读回手机 Run 的第 7 次报告，并打开相同源提交的真实 Diff。[报告](evidence/desktop-phone-run-readback.png)、[Diff](evidence/desktop-mr-diff.png) |
| 手机云端原生文档 | 从流程总文档直接进入国内云端 SmartDoc，显示协作服务已接收；点击文档内链接打开版本 PRD 子文档。本项证明打开与导航，不声称新增编辑。[总文档](evidence/find-n6-cloud-handbook.png)、[子文档](evidence/find-n6-cloud-subdocument.png) |
| 已连接设备刷新 | 普通 QA `1.0.2+112309` 实际点击同账号 Desktop 刷新按钮，再从应用 Tab 打开 Muse-CI，加载后端流程。[截图](evidence/find-n6-reconnected-app.png) |
| 物理折叠外屏 | `1140×2616`，普通 QA `1.0.2+112309`。应用卡片、主/子流程、真实重跑第 8 次、运行产物、MR 同步及 Diff 第 1/2 页、云端原生 SmartDoc 子文档跳转通过。[外屏完整回执](evidence/foldable-outer-display.json) |
| 云端 SmartDoc 与 Agent | 初始 49 份流程材料接入国内云端。Agent 以现有账号明确委托身份写入本轮测试报告，云端接受且实时协作连接成功；不是独立云端 Agent 账号。[云端回执](evidence/cloud-documents.json)、[本轮操作回执](evidence/foldable-ordinary-operations.json) |

本轮 CI 修复已提交并推送：安全随机命令 ID（`db78e4e`）、沙箱本地表单提交（`9c491b0`）、表单内持久错误提示（`cb27b30`）、画布产物元数据与按需读取（`388ea1d`）。历史产物内容仍保留在持久存储，不扩大 Host 沙箱或响应大小边界。相关检查为 64 项后端测试、29 项插件测试、类型检查与构建通过；Muse-CI 自身六节点 Run `e49d2cbb-4c5f-46aa-9d1b-79098ec5dda7` 成功，随后由手机独立触发上述重跑。

Host 通用能力修复在 Muse-Client 的当前发布恢复分支中细粒度提交：已配对时允许设备重选（`f44e0297`）、只输出安全错误码（`cb7347b7`）、为已连接设备提供刷新按钮（`1e7dfe53`）。13 项 Mobile 工作台、2 项错误脱敏测试通过。未推送混有其他工作的整个 Host 分支。

验收中曾观察到“操作已落盘，但回复被通道拒绝”；后续刷新读取到已成功结果，手机后来可正常打开 Diff。此情况不能视为稳定性已完全验证，也不能盲目重试写操作。安全错误码现区分网络、超时、授权与响应问题，原始异常消息不会进入插件 UI。

国内生产认证服务曾因严重内存回收阻塞而超时，已正常重启恢复，配置持久 2 GiB swap 和有时限的诊断采样；服务器修复提交 `302c840`。已真实登录核验；未认定某个进程存在泄漏。[恢复回执](evidence/production-auth-recovery.json)。

**完整发布门禁仍未通过**：当前版本卸载重装/离线/撤回回归、正式市场与签名候选包尚需验收。物理折叠外屏的核心操作已通过；它不代替完整生命周期回归。普通 QA 与国内生产网络的结果分别记录，不据此宣称正式渠道发行完成。本轮实际业务默认网络核验为蜂窝网络；结束检查 Wi-Fi 开关已开启，未改动热点配置。最新普通 QA 已安装为 `1.0.2+112309`。

在线 SmartDoc 是协作权威来源，仓库 [archive/INDEX.json](archive/INDEX.json) 按版本/需求、Step、文档 ID 和修订归档原生快照；执行事实、测试产物和截图保存在 evidence，不用人工标过覆盖真实测试或平台结果。

## 物理外屏补充验收

2026-11-23，用户实际折叠 Find N6 后，Android 报告物理尺寸 `1140×2616`，没有使用屏幕尺寸覆盖模拟折叠。外屏从应用 Tab 再次打开 Muse-CI，进入版本主流程与 MR 子需求，实际触发 Run `33e313ff-f1bd-4eb9-ad10-591660ab6d86`，01:55:27.985Z 至 01:55:35.048Z 成功（北京时间 09:55）。该 Run 为 `feature-report` 第 8 次尝试，手机实际打开其 JSON 产物，含真实命令、退出码 0 和 `realExecution: true`。[节点截图](evidence/find-n6-folded-node-rerun.png)、[产物截图](evidence/find-n6-folded-run-artifact.png)。

外屏同步 MR #2 后，实际查看固定提交 `c514eeceef4ae909ee0e194351ea0027fadecba3` 的真实 GitHub Diff 第 1、2 页，文件折叠、长路径和二进制缺失补丁提示均已观察。[第一页](evidence/find-n6-folded-mr-diff.png)、[第二页](evidence/find-n6-folded-diff-page-2.png)。后续证据归档提交不改变这些截图所验证的固定提交。

CI Agent 通过既有账号委托身份将本轮事实写入云端测试报告第 7 修订，云端接受、实时协作连接成功。外屏原生总文档与 PRD 子文档已打开，不声称本次手机新增编辑。隔离镜像工具仍观察到键盘后需刷新输入，部分请求反馈存在等待；这不构成产品网络稳定性全面通过。未执行 MR 批准或合并。

外屏原生总文档、同流程 PRD 子文档及跨子需求总文档跳转均已核验。[原生总文档](evidence/find-n6-folded-smartdoc-handbook.png)、[PRD](evidence/find-n6-folded-smartdoc-child.png)、[跨子需求跳转](evidence/find-n6-folded-child-workflow.png)。跨子需求最后一步由用户在本机辅助点击，Agent 截图确认，并非全自动镜像输入通过。

本轮发现并修复跨子需求链接仍保留 CI 内部地址的问题（`65a8ad9`）：父流程重连云端时，只将有权访问、父子关系匹配且云服务、账号、工作区一致的目标转换为原生引用，保留块 ID、格式、原文与历史；无权访问或绑定不一致不转换。65 项后端测试及类型检查通过。Muse-CI 通过 MCP 工具执行新源码的独立 Run `4f33d2a9-4523-4a61-a66a-4728b7226572`（尝试 9）成功；它不是手机触发的尝试 8。云端测试报告已追加至第 9 修订，保留此前“待核验”的历史记录，并追加补验结果。外屏完整回执见 [foldable-outer-display.json](evidence/foldable-outer-display.json)。
