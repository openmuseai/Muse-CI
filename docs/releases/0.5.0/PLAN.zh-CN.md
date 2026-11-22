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
- 当前 RemoteMcpApp 已有工作台贡献接口，Mobile 应用 Tab 也已有通用注册表展示。但 main.dart 只在调试模式加载本机 remote-mcp-apps；这不构成生产安装交付。
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

已实现 `ci_mr_diff` 合同、平台读取和插件 Diff 视图；新增源 SHA 竞态与缺失补丁测试。实际本地 MCP → GitHub MR #1 读取成功，只作为后端预检，不能作为手机公网验收。

Host 通用配对 App 转发已提交 `b42f2066`；Mobile 侧通过现有插件注册表展示应用卡片，复用原生 MCP App 沙箱与资源提供器。改动没有去掉 release 安装摘要门禁，也没有将 CI 状态机加入 Host。新增 3 项运行时边界测试及配对网关在途撤销测试通过，网关相关 4 项回归通过。

国内生产登录超时已于 2026-11-22 恢复：已定位现有北京实例，VNC 确认严重内存回收阻塞。正常重启恢复入口后，使用 `.account` 的原始完整密码（包括末尾 `!`）两次真实登录成功。新增 2 GiB swap 与持久配置，修复故障时会丢失数据的内存采样，服务器提交 `302c840`。GoTrue、数据库、Cloud、DSH 健康，数据库查询正常；尚未认定某个进程存在泄漏。见 [认证恢复回执](evidence/production-auth-recovery.json)。继续复用国内既有中转，无需另部署公网 CI。

验收设备为 OPPO Find N6（PLP110，展开屏 2248×2480），原有 `com.openmuseai.mobile` 保留。用户已完成安装保护确认，并当次授权代理点击首次协议；真实界面处理完成，未注入同意状态。隔离 QA 已更新至 `1.0.2+112204`。测试拒绝 Mobile 本机直连开发 App，强制验证国内 HTTPS 配对会话，并检查没有 adb reverse 业务转发。目前 Mac 自动锁屏，手机也已休眠，QA Activity 暂停，真实界面与设备绘制测试等待解锁后续跑。

已由 `ci_mr_create` 创建真实草稿 [MR #2](https://github.com/openmuseai/Muse-CI/pull/2)，绑定手机 Diff 子需求，以 `feat/0.4-smartdoc-steps` 为基线。保留草稿状态，未提审或合并；手机尚未完成对该 MR 的验收。

公网验收保持未通过。完整真机节点/产物/Diff 操作与折叠/展开布局仍需执行；不将上一版 QA/USB 转发证据复用为此版本的公网证明。
