# Muse CI 的 Host 改动与插件代码量评估

日期：2026 年 11 月 18 日。依据 Muse-Client `04ba4adc` 与当前工作区源码进行静态评估，未实施代码或运行跨端原型。代码量为工程估算，不是已生成代码统计或承诺工期。

> 修订说明：完整核对见 [Host 协议与能力明细](HOST-PROTOCOL-CAPABILITY-DETAILS.zh-CN.md)。补充 Desktop Node-only 安装器与发行信任、事务生命周期后，Host 估算调整为生产 3,200–5,500 行、测试 2,500–4,500 行，共 5,700–10,000 行；当前表格已同步。纯 UI-only 并非现有 MCPB 标准 server 类型，需新增 OpenMuse 可安装远端 App 模式。

## 1 结论

**CI 领域能力可以全部放在可安装的 Muse-CI 插件及其执行后端中；当前 Host 仍需要一轮通用插件平台补齐。MCP/MCP Apps 的基础协议足够，现有两端实现和 OpenMuse 文件型 Capability profile 尚不足以直接完成全部方案。**

不需要在 Host 添加 CI 数据模型、计划调度、十二阶段业务规则、构建或签名逻辑。不需要修改 DSH Agent Loop、AppFlowy 数据内核或引入新的 CI 专属原生桥。需要修改市场安装、非文件型 App 启动、受限工具转发、连接鉴权及生命周期的通用实现；改动主要位于 Muse-Client 的市场插件和共享 SDK，部分现有代码物理上位于 Desktop Host 目录。

建议首版路径：`安装 Muse-CI 的受信发行记录与 UI artifact → 加载受审查的 MCP App → Host 绑定可信 MCP 后端 → tools/call → CI 后端完成 Project 授权、工作流和执行`。CI 只调用自己后端的已声明工具；首版不通过现有文件型 capabilities_bind 绑定 Project，也不为此先扩展 Host 的资源模型。

## 2 当前协议与实际实现

| 能力 | 协议是否可表达 | 当前实现事实 | 处理方式 |
| --- | --- | --- | --- |
| 同一插件两端安装 | Registry、MCPB、现有市场模型可承载 | Desktop 已有安装 App 路径；Mobile 固定 pin 策略拒绝空集合外的包，并拒绝 endpoint 非空条目 | 补审查包与可信远端的组合准入，保持身份/版本/摘要锁定 |
| 非文件型应用入口 | MCP tool 的 UI 元数据与 ui:// resource 已可表达 | Mobile 有零参数 openUi，但该路径主要寻找外部 HTML resource_link；离线 discovery 仍要求 base64 文件参数 | 按 UI metadata 直接发现和加载受审查 UI resource，不要求伪造文件参数 |
| App 调用后端工具 | MCP Apps serverTools 与 tools/call 足够 | Desktop Installed App 已启用并校验工具 Schema；Mobile 离线页未声明 serverAvailable，消息通道还没有同等后端工具会话绑定 | 复用共享 document/消息通道，新增通用会话路由，不重写 WebView |
| 远端身份与授权 | HTTP MCP Authorization 可承载 | Mobile withClient 直接创建 StreamableHttp transport；该调用点未接 token、刷新、受信实例绑定 | 补标准/预注册后端授权、凭据存储、刷新、撤销和 audience/origin 绑定 |
| CI 领域合同 | tools、JSON Schema、structuredContent、resources 足够 | ci_* tools 与领域 Schema 尚不存在 | 全部由插件和后端定义，不新增 Host 方法枚举 |
| Project/Run 权限 | 由 CI 服务领域授权即可表达 | Desktop Capability Gateway 的 GrantedResource 是 bytes；bind 强制验证 base64 contentMediaType | Project 选择和 ACL 放 CI 后端；不复用文件 grant 冒充项目授权 |
| 多插件能力组合 | 现有 Capability profile 适用于部分文件场景 | Gateway 每个 View 的授权是临时文件绑定，不是通用项目或服务绑定 | 首版 CI 在执行后端组合 Provider；如将来需要前端跨插件服务，再独立演进通用 profile |
| 状态恢复 | 普通查询工具加 cursor 可实现 | 无需先实现全套服务端推送到 WebView | 插件有界轮询，后端维护序列；先不新增 Host SSE/订阅协议 |
| 暂停与取消 | tools/call 的业务参数已可表达 | MCP 请求结束并不等于取消后台作业 | 后端持久命令；Host 只处理请求超时与页面销毁 |
| 人员发布决策 | 后端交互挑战/重新认证可承载 | tools/call 本身不证明是人的批准 | Agent 仅请求审批；首版高风险决定由后端一次性交互确认，不能将普通工具调用当成人员签字 |
| 长任务 | 工具立即返回 runRef，后续查询即可 | 当前 60/90 秒调用超时是请求级限制 | 不保持一个 HTTP 工具请求等待完整构建，工作流在后端持续运行 |

这里“协议足够”仅指语义可以承载，不代表 MCP SDK 自动提供所有能力。HTTP 身份授权遵循 [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)；UI 与工具的交互依据 [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)。UI protocolVersion、MCP transport 协商版本及 CI contractVersion 分别校验，不混用一个版本号。

## 3 源码证据

| 位置 | 观察与含义 |
| --- | --- |
| [Mobile main.dart](../../Muse-Client/app/openmuse_mobile/lib/main.dart)，187/192 行 | allowDownloadedPlugins=false 与空 launchPackages；前者控制另一条 MobilePluginStore 路径，后者控制 RemoteMcpMarket，不能只改一个开关就声称所有安装路径已开启 |
| [RemoteMcpMarket](../../Muse-Client/plugins/mobile-plugin-market/lib/src/mcp_remote_market.dart)，104 行 _permits | 固定 pin 模式同时要求 endpoint==null；“已审查本地 UI＋远端 CI tools”会被拒绝 |
| 同文件，414–426 行 withClient | 创建有时限的远端 MCP 会话；此调用链未配置授权 provider，不应推断当前可直接访问需登录的 CI |
| 同文件，493/517 行 _cacheOfflineDiscovery | 无 base64 文件媒体类型的 UI 入口会被跳过；CI 不是文件转换器 |
| 同文件，712 行 openUi | 已有零参数 tool 入口，但主要返回外部 HTML URL，不能据此推定本地 MCPB App 受审查 UI 与鉴权工具已连通 |
| 同文件，1508/1525/1641 行 | 当前 Mobile App document 传入 resourceToolsAvailable，未传 serverAvailable:true；底层通道存在不代表应用被授予 serverTools |
| [共享 MCP App document](../../Muse-Client/packages/openmuse_plugin_sdk/lib/src/mcp_app_document.dart)，32/139/153 行 | 默认 serverAvailable=false；开关决定转发 tools/resources；CSP connect-src none 禁止 UI 绕过 Broker 直接 fetch 后端 |
| [Desktop Installed App](../../Muse-Client/app/openmuse_host/lib/src/host/mcp_installed_app.dart)，663/708/737 行 | 已提供 serverTools、Schema 校验与 MCP 调用转发，需抽取复用而非整体重造 |
| [Capability Gateway](../../Muse-Client/app/openmuse_host/lib/src/host/mcp_capability_gateway.dart)，37/198/220/247 行 | 资源是文件字节，绑定检查文件 contentMediaType；当前 profile 不适合直接给 CI Project 授权 |
| [生态 Plugin SDK](../../Muse-Plugin-Ecosystem/packages/plugin-sdk/src/index.ts)，6 行 | connect 明确依赖 serverTools；Mobile 桥接未补齐时会 HOST_UPDATE_REQUIRED |

行号对应本次检视，后续变更可能移动。以上是已检查路径的结论，不声称整个仓库不存在其他授权或消息基础设施。

## 4 Host 需要改哪些代码

将“Host 业务内核”与“Host 承载的通用插件平台”分别统计。前者 CI 专属改动目标为 0；后者是必要工作，不能承诺零改 Host。

| 模块 | 主要工作 | 预计生产有效行 |
| --- | --- | ---: |
| 安装模式、发行信任与安装锁 | 可安装远端 App profile、受信 UI artifact 与后端关联 | 450–750 |
| 共享 View/session/tool/resource bridge | 提取 Desktop 逻辑并提供通用会话与转发 | 600–950 |
| Desktop 接入 | 区分远端 App 和 Node MCPB，保留既有运行路径 | 250–450 |
| Mobile 接入 | 市场、非文件入口与 Android/iOS 会话接线 | 700–1,150 |
| 通用连接鉴权 | OAuth、可信实例、安全存储及撤回 | 850–1,450 |
| 生命周期 | 事务安装、升级、卸载和恢复 | 250–450 |
| profile/错误/兼容 | 真实能力描述与兼容处理 | 100–300 |
| **生产小计** | 共用实现只计一次 | **3,200–5,500** |
| **测试另计** | 协议、权限、错误、升级和跨端回归 | **2,500–4,500** |

总计约 **5,700–10,000 行**。首版范围为 macOS 官网版、Android、iOS；Mac App Store 的外部安装限制需独立评估，Windows/Linux 原生 UI 未包含在已验证范围。对原文件重构的删行与新实现不重复累计。

最主要改动位置是 `plugins/mobile-plugin-market`、`packages/openmuse_plugin_sdk` 和 Desktop 当前 `mcp_installed_app.dart`。建议将共用运行会话抽到 `packages/openmuse_mcp_runtime`，这是待新增的通用包，不能包含 ci_* 工具名或 CI 任务模型。Android/iOS 通道已存在，预期主要调整 Dart 接线与少量生命周期/登录适配，不需要新原生 CI 插件。

此估算包含首版必需鉴权与正式准入，不是通过删除 CSP、开放任意 URL 或解除所有 pin 获得的演示闭环。任意自托管认证方案、全量动态 OAuth 注册、后台推送及 Windows/Linux 容器差异扩展不在首版估算内。

## 5 Plugin 与执行后端代码量

插件产品包含客户端包和服务端执行发行物。只统计 MCP App 页面会严重低估 CI 本身；两端共享一套 UI 和领域合同，不能计算为两份客户端业务实现。

首版目标：Desktop/Mobile 安装同一插件、连接一个受信后端、导入现有发布单、发起有预算的 AI 开发任务、产生补丁并运行真实检查、查看证据及暂停取消恢复。沿用现有测试脚本和一个 Linux Runner；正式签名、多渠道自动提审与完整设备池留在后续阶段。

| 插件产品模块 | 预计生产有效行 |
| --- | ---: |
| 共用 MCP App UI：项目、计划、Run、diff、证据和决策 | 2,500–4,000 |
| CI contract client、MCP server/tools、输入输出校验 | 700–1,200 |
| AI 计划、DSH 适配、角色与预算/修复闭环 | 1,500–2,500 |
| API、数据库、Outbox、Temporal、Run 与审批状态 | 3,000–5,000 |
| Linux Runner、Git 工作区、lease/fencing 与执行适配 | 2,000–3,500 |
| 测试/来源/证据与现有 release gate adapters | 1,200–2,000 |
| UI artifact、Registry、workflow bundle 与发行锁 | 300–600 |
| **首版生产小计** | **11,200–18,800** |
| **首版测试另计** | **6,000–10,000** |

首版插件产品约 **17,000–29,000 行（含测试）**；其中客户端 UI、合同和打包约 3,500–5,800 行，剩余主要在执行后端。Temporal、DSH、MCP SDK、现有构建脚本和三方依赖源码不纳入自研行数。

扩展到方案 P3/P4，额外预计：

| 后续能力 | 额外生产有效行 |
| --- | ---: |
| macOS Runner、签名分权、平台打包和可信制品 | 2,000–3,500 |
| 真机池、安装/行为验证、截图及设备清理 | 1,500–2,500 |
| 首批 Apple/Play/国内渠道与插件市场 adapter、状态核对、拒审 cycle | 2,500–4,500 |
| 来源审查、合规证据、归档恢复及运维完善 | 1,500–3,000 |
| **扩展生产小计** | **7,500–13,500** |
| **扩展测试另计** | **5,000–9,000** |

完整插件产品约 **30,000–51,000 行（含测试）**。其中“版权检查”是来源与证据采集及发布阻塞机制，不承诺自动作出版权法律结论。渠道 API、签名环境及真机差异是最大不确定项，原型后应重新估算。

## 6 协议要新增什么

### 不需要新增 Host 协议的内容

ci_projects_list、ci_plans_propose、ci_runs_start、ci_runs_get、ci_runs_pause、ci_runs_cancel、ci_evidence_get 都是标准 MCP tools。Project 选择、任务参数、游标、幂等键、revision、预算和审批请求都是插件业务 Schema，归 `openmuse.ci/1` 管理。后端自动工作流也不要求 Host 理解 Plan、Step、Artifact 或 Release。

CI 的轮询是普通 tools/call；每次返回有界增量。构建工具先返回 runRef，不受一次调用 60/90 秒限制。先不用新增 Host streaming、push 或 MCP Tasks，实现后再按实际收益升级。

### 必须补实现或冻结的通用合同

1. Installed App 的本地 UI artifact 与远端 MCP endpoint 的关联、信任和版本 pin。
2. 每个 View 对应的后端会话、工具白名单、Schema 校验、请求关联、取消和销毁行为。
3. HTTP MCP Authorization 与平台外部登录、凭据存储及 scope 撤回。
4. UI resource 发现规则、非文件型零参数入口及安装兼容 capability。
5. 受信用户交互与普通模型工具请求的边界；不能仅靠工具 annotation 或页面传入 userApproved=true。

这些合同优先沿用标准 MCP/MCP Apps 与通用 Host profile；如内部需补字段，应作为通用实现/profile 演进，具有版本与兼容测试，不能宣称标准本身已有所有 OpenMuse 安装策略。

### 暂不作为前置的扩展

现有 `openmuse-capabilities/1` 的文件资源模型无需为了 CI 强改。如果将来要求 CI 的前端插件直接调用其他插件的有状态非文件服务，才新增通用 service binding profile：opaque serviceRef、权限域、租约和撤回，独立于 bytes/file grant。届时还需两端 TCK 和迁移支持，估计再增加 800–1,500 行生产实现与 600–1,200 行测试，未计入当前 Host 小计。

## 7 是否入侵 Host

| 改动 | 本方案判断 |
| --- | --- |
| Host 内硬编码 io.openmuse.ci 或 ci_* 分支 | 不需要，应拒绝 |
| Host 内增加 CI 页面、Temporal、发布状态机和签名 | 不需要，应留在插件后端 |
| 修改 DSH 内核和 Agent Loop | 不需要，采用既有工具及执行适配 |
| 修改 Plugin 市场安装和通用 App runtime | 需要，属于明确的平台代码改动 |
| 修改共享 Dart bridge、鉴权、scope 及生命周期 | 需要，属于通用平台能力 |
| 增加 CI 专属原生 WebView 或下载原生执行代码到手机 | 不需要 |
| 为新 Runner 访问当前 Desktop 的目录 | 注册独立、经授权 Runner；不能默认获得整个 Host 工作目录 |

所以准确表述是：**CI 业务可以不侵入 Host；为了独立可安装插件在 Mobile 完整工作，当前 Host 的通用平台实现必须改。** 平台补齐后，后续 CI 模板、页面和 Provider 业务升级可通过插件发行，不再常规修改 Host；新原生能力、协议主版本和平台安全修复仍按 Host 发版。

## 8 推荐实施和估算验证

先做一个小的、可安装的通用验证插件：只包含 UI resource、零参数 open、一个需要登录的 list 工具和一个幂等异步任务。安装包不包含 CI 业务，后端返回假定领域的真实结构化结果。

必须在 Desktop、Android、iOS 验证：安装 → UI → OAuth/实例绑定 → tools/call → 卸载/重装；再验证 token 过期、登出、重复请求、页面销毁和未知工具拒绝。只读 HTML 能显示不算完成。此原型锁定真实 SDK 复用率，随后调整行数估算。

正式首版收敛为：一个受信后端、一套 MCP App、已有 release 导入、一个 Linux Runner、前台轮询；先不做任意服务前端互调、完整推送、全渠道自动化和新的原生系统能力。先完成 Host 通用底座与协议 TCK，插件后端、UI 与合同可以并行开发；此处描述工作流分工，不代表本轮已启动并行 Agent 或实施。

投入估算仅用于容量规划：Host 底座约 3–5 人周；首版插件与后端约 10–17 人周；跨端联调及验收再预留 3–5 人周，总计约 16–27 人周。它不是日历工期，也不以 AI 生成代码速度直接折算；需经上述原型和团队实际熟悉度校准。P3/P4 因真实渠道和设备尚未验证，不给出确定上线日期。
