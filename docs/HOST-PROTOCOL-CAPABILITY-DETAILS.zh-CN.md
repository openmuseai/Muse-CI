# Muse CI 接入所需的 Host 协议与能力明细

日期：2026 年 11 月 18 日。源码基线：Muse-Client `04ba4adc`、Muse-Plugin-Ecosystem `fc5b717`。状态：设计与静态源码核对，尚未实施或完成跨端验证。

本报告把 Host 的通用插件平台补齐与 Muse-CI 的业务开发分开。首版明确覆盖 macOS 官网发行版、Android、iOS；Mac App Store 发行策略单独验收，Windows/Linux 的原生 App 容器不包含在本次已验证范围内。

## 1 最终边界

用户在 Desktop/Mobile 的插件市场安装 Muse-CI，安装器验证发行记录与 UI artifact，Host 加载固定摘要的 MCP App，连接一个经授权的 CI MCP 后端；插件用标准 tools/resources 访问其项目与运行。Host 不认识 CI 项目、任务、流水线、签名、上架阶段或商店状态。

**标准 MCP/MCP Apps 不需要为 CI 修改。需要新增 CI 业务合同、冻结 OpenMuse 通用安装与连接 profile，并补齐实际 Host 实现。** 现有文件型 `openmuse-capabilities/1` 不适合 Project 授权，首版不改它，项目 ACL 留在 CI 后端。

| 层 | 包含内容 | 本次处理 |
| --- | --- | --- |
| 标准通信 | MCP initialize、tools/list/call、resources/list/read；MCP Apps UI 初始化及消息 | 复用，补跨端接线与一致性测试 |
| 标准授权 | HTTP MCP Authorization、OAuth discovery/PKCE/resource binding | 按支持范围实现，不另造 CI 登录协议 |
| OpenMuse 通用 profile | 安装锁、后端连接、View scope、生命周期、兼容声明 | 新增/冻结实现合同，适用于任何有后端的可安装插件 |
| CI 业务协议 | Project、Plan、Run、Evidence、Approval、Release、revision/幂等/cursor | 新增 `openmuse.ci/1`，仅插件和后端理解 |
| 文件能力 profile | resources_choose、capabilities_bind/call | 保持兼容；不伪造文件来授予 Project 权限 |
| 可选服务能力 profile | 前端跨插件的非文件服务绑定 | 延后，不列为 CI 首版前置 |

## 2 Host 现状全表

“已有”只表示已定位到实现，不等于完成全部发行渠道的验收。“部分”表示基础可复用但未满足目标闭环。

| ID | 能力 | Desktop 现状 | Mobile 现状 | 必须补齐 |
| --- | --- | --- | --- | --- |
| H01 | 市场目录与安装记录 | Registry、MCPB、receipt 和摘要已有 | Registry、离线包与安装记录已有 | 对齐产品身份、版本与跨端发行引用，不混用两个市场的信任结果 |
| H02 | 下载与解包 | 摘要、大小、路径、staging/backup 已有 | 摘要、web 资源提取、限额已有 | 通用便携 UI artifact 模式、断电/异常恢复、记录与文件原子一致 |
| H03 | 发布者与审核信任 | 检视安装路径主要校验 Registry 提供的 SHA-256 | MCPB 路径主要校验 SHA-256；另一市场有签名索引 | MCPB 所用目录的发布者/审核信任、签名或受信索引、撤销规则；摘要不是发布者证明 |
| H04 | 便携 UI-only 包 | 安装器要求 server.type=node，且安装时启动 Node 握手 | 提取 web/index.html，不执行包内 Node | 两端识别 UI＋远端工具组合；不能给 Desktop 塞无意义 Node server 规避缺口 |
| H05 | 非文件型入口 | Installed App 有 tool UI resource 入口 | 有 openUi，但主要返回外部 HTML URL；离线 discovery 要求文件媒体参数 | 基于 tool UI metadata 加载受审查的 ui:// resource，不强制 content 参数 |
| H06 | MCP App 容器 | 已有 AppKitView、iframe、消息桥 | Android PlatformView 与 iOS WebView 已有 | 复用容器，统一会话与 capability 接线；不新增 CI 原生 View |
| H07 | CSP 与网络边界 | 共享 document 限制 connect-src none | 同一受限 HTML 机制已存在 | 保留限制，UI 只通过已授权工具访问后端，不直接 fetch 任意 API |
| H08 | serverTools | Installed App 已打开并校验 Schema | 底层 onRequest 通道存在，离线 App 未开启同等 serverAvailable 会话 | 同一 View 绑定一个明确会话，支持已声明工具调用与安全返回 |
| H09 | serverResources | Desktop 转发 list/read | 共享 document 有门控，但 Mobile 对应后端接线不足 | 校验 URI/会话/预算，阻断跨插件资源读取 |
| H10 | HTTP MCP 远端连接 | 已有路径重点是本地 bundle runtime；不据此推定所有远端鉴权就绪 | withClient 已创建 StreamableHttp transport，按调用打开/关闭 | 抽象本地 stdio 与 HTTP 会话适配；远端会话具备认证、过期和重连行为 |
| H11 | 远端 OAuth/实例绑定 | 有 GoTrue 与安全存储基础，不等于第三方 MCP OAuth | withClient 调用点未配置授权 provider | 外部登录、PKCE、state、audience/origin、刷新、撤回及实例信任 |
| H12 | 通用安全存储 | FlutterSecureValueStore 已有 macOS Keychain 适配 | Flutter secure storage 接口已有 | 加插件/账号/实例/resource 命名空间，隔离第三方 token，禁止复用主账号原始 token |
| H13 | 工具权限与 Schema | Desktop 根据已发现工具校验输入；有 View scope | 已有消息通道，缺完整通用后端转发约束 | 工具白名单、调用来源、输入输出预算、过期结果丢弃及工具更新处理 |
| H14 | 文件能力授权 | GrantedResource(bytes)、文件选择和 base64 绑定已存在 | 有资源相关控制链 | 保留现状；CI Project 权限由后端验证，不改成万能资源权限 |
| H15 | 安装后连接与设置 | 有用户配置与 runtime 基础 | 后装包＋远端 endpoint 被当前 pin 模式拦截 | 安装成功但待连接的状态、可信连接设置、撤回与失败诊断 |
| H16 | 启停、升级与卸载 | 有 session/gateway close，安装有 staging/backup；不能等同完整卸载模型 | 有连接 dispose/安装记录；当前安装替换使用删除旧目录再 rename | 补持久 lifecycle、升级回退、卸载清理与恢复，客户端卸载不等于取消服务端 Run |
| H17 | 身份切换与失效 | Desktop scope 与开发授权撤回已有 | 需核对每个后端会话是否跟随账号撤回 | 主账号切换先关闭/撤回旧本地会话，不把旧结果发给新用户 |
| H18 | 请求超时与页面销毁 | 存在超时、销毁和通道关闭基础 | 有 pending 请求关联与连接 dispose | 保证超时/关闭后所有等待者完成或失败，迟到响应不更新新 View |
| H19 | 运行状态与历史恢复 | 不是 Host 业务职责 | 不是 Host 业务职责 | CI 后端持久化，插件 cursor 轮询；Host 只提供连接/页面生命周期 |
| H20 | 用户决策与审批 | 已有原生授权弹窗，不等于 CI 发布批准 | 不应相信页面传 userApproved=true | 后端一次性交互挑战/重新认证；Host 仅提供通用可信外部打开/回调能力 |
| H21 | Host 能力发现 | Desktop host_describe 输出 profiles | 尚未证明两端相同 profile 可用 | 两端公布真实实现 profile、限制和连接状态，不以版本号代替能力 |
| H22 | 后台与推送 | 后台执行应在 CI 后端 | App 进后台/被系统终止不能维持可靠 CI | 首版前台轮询和重连，APNs/SSE/后台常驻不作为前置 |
| H23 | 模型暴露插件工具 | Desktop 可发现插件 MCP tools；需逐路径验证 DSH 投影 | 不推定 App UI 能调用就代表 Mobile DSH 已可调用 | 冻结工具暴露范围；执行中的 Agent 通过后端 DSH adapter 使用同一合同，前台 DSH 入口另验 |
| H24 | 分发限制 | Mac App Store 模式禁止无 bundleBytes 的外部代码下载 | 默认空 pin/禁止下载策略影响不同安装路径 | 区分官网版、商店版和开发模式；经审查配置准入，不能直接删除限制 |

### 源码索引

- [Desktop 市场安装器](../../Muse-Client/app/openmuse_host/lib/src/host/mcp_market.dart)：430 行 install；434 行附近 App Store 限制；443 行摘要检查；477 行附近 Node-only manifest 检查；安装路径包含 runtime.tools 握手。
- [Desktop Installed App](../../Muse-Client/app/openmuse_host/lib/src/host/mcp_installed_app.dart)：663 行 serverAvailable；708 行 tools/call；737 行 Schema；dispose 关闭 gateway/session；build 使用 AppKitView。
- [Desktop Capability Gateway](../../Muse-Client/app/openmuse_host/lib/src/host/mcp_capability_gateway.dart)：GrantedResource 与 capabilities_bind 的文件 contentMediaType 检查。
- [Mobile 市场与容器](../../Muse-Client/plugins/mobile-plugin-market/lib/src/mcp_remote_market.dart)：104 行 pin；414 行 withClient；493/517 行文件型 discovery；545 行解包；712 行 openUi；1221 行消息连接；1508/1525/1641 行页面接线。
- [共享 App document](../../Muse-Client/packages/openmuse_plugin_sdk/lib/src/mcp_app_document.dart)：serverAvailable 默认 false；tools/resources 门控；CSP 限制。
- [Mobile 产品装配](../../Muse-Client/app/openmuse_mobile/lib/main.dart)：187/192 行附近两种安装策略配置。
- [安全存储基础](../../Muse-Client/plugins/auth-gotrue/lib/src/secure_session_store.dart)：可复用存储接口，不代表当前已提供 MCP 远端 token broker。
- [另一 Mobile 市场的签名索引](../../Muse-Client/packages/openmuse_mobile_plugin_runtime/lib/src/mobile_market_source.dart)：SignedRemoteMobileMarketSource 路径，不能直接套用到 MCPB 路径。

行号对应本次源码观察。现有 AppKitView 路径只证明 macOS 实现；Windows/Linux 的平台声明不能替代其实际 UI runtime 验证。

## 3 必须加入或冻结的通用协议合同

以下 P01–P08 是实施合同编号，不是八套新的 JSON-RPC，也不是现有已发布 profile。对外仍使用 MCP/MCP Apps；内部 Schema 在原型后固化，兼容能力通过现有 host_describe 形式公开。

### P01 安装锁与信任记录

新增通用 `openmuse.installed-app/1` profile，数据保存为 Host install lock/receipt，绑定标准 Registry 的远端声明及受审查的 UI artifact；Node MCPB 继续使用其标准发行内容。不能擅自在严格 Manifest v2 或 Registry 标准字段内增加私有顶层字段。

必需数据：

- pluginId、version、packageDigest、uiResourceUri、uiDigest。
- 本次选定的 executionMode：local-stdio 或 remote-mcp；远端模式保存 backendRef，不能仅按一个 URL 自动授信。
- 支持 target、最低 Host profiles、兼容 MCP/MCP Apps 版本范围。
- 发布者/审核信任来源、签名或签名目录的标识、撤销状态与 policyVersion。
- installed/enabled 状态、当前及上一发行物摘要、安装事务 ID。

UI-only＋remote-mcp 必须是 OpenMuse 显式新增的可安装远端 App 模式，不声称它是标准 MCPB server 类型。Desktop 不再要求这类包包含 Node server；Mobile 不执行包内 Desktop 程序。若一个标准 MCPB 同时携带 Node 与 web，仍需明确选择本机模式，不能仅因安装而自动运行伴随程序。

验收：未知发行者、摘要变化、目标不支持、缺 profile 均拒绝；断电恢复后只能看到完整旧版或完整新版；不能留下“receipt 已升级而资源未升级”。

### P02 后端连接与授权

内部 SessionBinding 必须包含：connectionRef、plugin release digest、view scope、用户身份隔离键、resource/audience、可信 endpoint、transport、已授权 scopes、凭据引用和 sessionEpoch。token 不进入返回给 UI 的结构。

远端按标准 MCP Authorization 发现受保护资源及授权服务器。首版支持预注册/受信实例，不承诺任意动态注册。登录用系统可信外部授权流程，校验 state/PKCE/redirect/resource，Host 存储和刷新凭据；重定向、后台 endpoint 变化不继承旧信任。401 需要授权、403 权限不足、网络失败分别处理，不能无限重试或扩大 scope。

最小连接状态：`unbound → connecting → auth_required → connected`，另有 reconnecting、expired、revoked、failed。插件可显示状态，不能任意写状态。初期由 Host 安装/连接设置管理绑定，不额外暴露万能 network_request 或 setAuthorizationHeader 工具给插件。

验收：一个插件不能读取另一个 token；切换账号隔离缓存和会话；远端 endpoint 或 resource 变化需新绑定；WebView 和日志里没有长期 token。

### P03 通用 App 启动规则

使用已声明 tool 的 `_meta.ui.resourceUri` 和对应 `text/html;profile=mcp-app` resource。入口不要求含文件参数；工具可以零参数，也可以通过标准 Schema 展示必要配置，但不能依赖 CI 专属启动字段。

固定 UI 来自安装锁声明的受审查本地资源。远端若返回 UI，其摘要必须匹配已审核版本；不能用一个工具返回任意 URL 就替换当前 UI。现有外部 HTML URL 模式如继续保留，必须单独定义信任等级，不混同为已审查本地 UI。

UI 初始化只声明真实接通的 serverTools/serverResources 等能力。断网时可打开静态 UI，并显示待连接，不虚报有可用工具会话。

### P04 App 调用后端的会话合同

标准方法范围首版为 tools/list、tools/call、resources/list、resources/read；ui/initialize、ping、主题/语言与尺寸变化继续复用。未知方法拒绝。必要外部授权页使用受限的标准 ui/open-link 支持或 Host 设置入口；不能将任意导航当成可信登录回调。

内部调用上下文至少有：viewId、sessionEpoch、安装版本、请求 ID、截止时间和认证会话引用。这些信息由 Host 创建，不能相信网页提交同名字段。远端工具名必须在当前发现并允许的列表中，输入过 Schema；工具列表变化触发刷新与授权重评，不自动接受权限扩大。

Host 工具与 server 工具名冲突必须拒绝或采用明确路由，不能因名字相同获得 Host 权限。响应有内容/大小预算；资源 URI 只交给当前已绑定后端，不因资源链接暗中切换服务器。输出遵循 Schema 的检查范围需明确，结构化失败不能当作业务通过。

这里不新增 ci_runs_start 等 Host case；这些工具仅来自插件后端。

### P05 生命周期和请求取消

安装状态与页面会话分离：安装不等于启用；启用不等于已连接；页面关闭不等于取消后端 Run。

通用要求：启用注册入口，停用阻止新调用，页面关闭完成所有 pending 的取消/失败，登出撤回本设备身份关联。升级采用事务切换和回退；卸载删除本地代码/缓存/绑定引用，按凭据共享引用计数清理凭据，不能误删其他插件的连接。重装重新校验发行物和授权。

MCP 请求取消只能影响当前请求，后台 CI 的取消是 ci_runs_cancel 业务命令。超时后是否重发由业务幂等语义决定，Host 不自动重放一切 tools/call。

### P06 能力发现与版本兼容

复用现有 host_describe 工具模式，扩展 profile 列表与限制，候选 profile 为 `openmuse.installed-app/1` 和 `openmuse.mcp-app-runtime/1`；正式命名在合同 PR 冻结。它们不是 MCP 标准新增版本。

返回语义包含：支持本地 stdio/远端 MCP、UI-only、非文件型 App、serverTools/resources、授权方式、目标平台、最大消息预算和请求时限。现有未实现能力不得仅为通过安装而写 true。

插件按 profile 和合同版本判断可运行性；MCP transport 协商、MCP Apps UI version 与 CI domain version 分开。Host 不支持时返回可定位的 HOST_UPDATE_REQUIRED 或不兼容原因，不静默退化成无鉴权网页。

### P07 用户交互与审计

Host 只证明通用授权操作发生在受信交互中，不理解“发布苹果版本”。网页或模型提供 userApproved=true 不具有证明力。

首版 CI 高风险批准由后端生成一次性、限定操作及输入摘要的交互挑战，在可信外部流程中重新确认身份；经批准的结果由后端保存并验证。插件提供可审查入口；普通 Agent tools 只发起审批请求。后续若引入统一 Host user-action attestation，应作为独立通用安全协议和验收，不偷偷放到 CI 专用桥。

审计至少记录插件版本、连接、方法/工具、请求 ID、结果类型与时长；不默认记录原始参数、源码或 token。

### P08 错误与恢复约定

冻结通用错误语义：HOST_UPDATE_REQUIRED、PLUGIN_NOT_TRUSTED、BACKEND_NOT_BOUND、AUTH_REQUIRED、AUTH_EXPIRED、SCOPE_REVOKED、TOOL_NOT_ALLOWED、INPUT_INVALID、RESOURCE_DENIED、REQUEST_TIMEOUT、VIEW_CLOSED、RATE_LIMITED、BACKEND_UNAVAILABLE。

错误码与重试提示通过标准 MCP 错误/结构化结果映射，不创建另一套 transport。Host 描述连接/协议失败，CI 后端描述 REVISION_CONFLICT、APPROVAL_STALE、BUDGET_EXHAUSTED 等业务失败。超时不代表后台业务失败或取消。

### P01 的标准兼容澄清

[MCPB Manifest 官方规范](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)当前列出必需 server 配置及 node/python/binary 类型，不能把纯 UI-only manifest 当作既有 MCPB 标准。本方案定案采用：**新增 OpenMuse 可安装远端 MCP App 模式，复用标准 remote MCP endpoint 和 UI resource，通过受信发行目录及 installed-app profile 固定 UI artifact 摘要。**

该模式使用独立安装记录与 UI 缓存/artifact，允许首次从标准 resources/read 取 UI 后验证摘要，或从审核目录取同摘要静态资源。它不是伪造 server.type=remote 的 MCPB，也不修改标准 Registry。现有 Node MCPB 继续由原安装器处理。发行目录的受信关联是 OpenMuse 明确新增的通用合同，需 Schema、签名和迁移测试。

两端相同指 pluginId、产品版本、合同及 UI digest 相同，不强制所有平台读取完全相同的标准 MCPB 文件。此前“相同 UI-only MCPB 已由标准支持”的表述据此更正。

## 4 需要交付的 Host 代码及任务

源码包名均为建议新增或调整位置，不代表已经存在。所有新实现不得包含 CI 工具名的特殊分支。

| 任务 | 位置 | 实现内容 | 完成证据 |
| --- | --- | --- | --- |
| T01 通用合同 | 新 `packages/openmuse_mcp_runtime` contracts | InstalledAppLock、BackendBinding、RuntimeProfile、错误及生命周期 Schema | Schema fixtures、未知字段和版本拒绝测试 |
| T02 发行物准入 | 两端市场＋通用 verifier | 新 remote App 安装模式、审核目录签名/摘要/撤销与 target；保留旧 Node MCPB | 两种模式独立测试；不可信发行物被拒绝 |
| T03 事务安装 | 通用 store＋两端接线 | staging、receipt、前版引用、异常恢复、升级回退、卸载 | 任意阶段故障注入后旧版或新版均完整可读 |
| T04 App 启动 | 从 Desktop Installed App 提取共享逻辑 | UI metadata、非文件型零参数入口、受信 UI、真实 capability 初始化 | 无 content 文件参数也能从市场启动 |
| T05 MCP 会话 | 新共享 runtime | stdio/HTTP adapter、工具发现、Schema、资源路由、超时/epoch/pending | 旧 stdio、远端工具和被撤回会话回归 |
| T06 鉴权 Broker | 共享 runtime＋现有 secure store | 受信实例、OAuth discovery/PKCE、callback/token/refresher、隔离与撤回 | token 过期/并发刷新/换账号/恶意重定向测试 |
| T07 Desktop 接线 | mcp_market / mcp_installed_app | 区分安装模式，接共享 session；保留 AppKitView | 官网 macOS 真机安装、连接、升级与退出 |
| T08 Mobile 接线 | mobile-plugin-market / main | pin 准入、非文件入口、serverAvailable、onRequest 绑定、iOS/Android 生命周期 | 两端真机完整验证，而非仅可显示页面 |
| T09 交互能力 | 通用 runtime＋必要平台 adapter | 受限外部授权打开、回调、可用能力和来源校验 | 非可信打开被拒绝，登录 code 不泄漏到 UI |
| T10 通用验收插件 | 独立测试 fixture | UI、登录后 list、异步 task、分页查询，不依赖 CI 业务 | Desktop/Android/iOS 同一合同通过 |

Host 业务内核不新增发布任务、工作流表或 CI 菜单；产品安装后入口由通用插件目录呈现。若某个步骤需要 `if pluginId == io.openmuse.ci`，应将该逻辑移到插件或通用合同中重新设计。

### 修订后的代码量

这次进一步核查增加了 Desktop Node-only 安装路径、remote App 发行关联、两条市场信任链和事务生命周期的工作，上一轮估计偏乐观。以下替代前版 Host 估算，计新增或实质改写有效代码行，复用只计一次。

| Host 模块 | 生产有效行估算 |
| --- | ---: |
| 安装模式、发行信任与安装锁 | 450–750 |
| 共享 View/session/tool/resource bridge | 600–950 |
| Desktop 适配 | 250–450 |
| Android/iOS 市场、入口与会话适配 | 700–1,150 |
| 远端授权与凭据 Broker | 850–1,450 |
| 生命周期、升级/卸载/恢复 | 250–450 |
| profile、错误与兼容输出 | 100–300 |
| **生产代码合计** | **3,200–5,500** |
| **协议/安全/恢复/跨端测试** | **2,500–4,500** |
| **Host 总计** | **5,700–10,000** |

不含三方依赖、生成文件、完整市场审核服务、Windows/Linux 原生 UI、新 APNs/推送、任意自托管 OAuth 兼容或完整前端 service binding。Mac App Store 的准入政策需要独立确认和验收；这里不承诺仅完成技术实现就自动符合商店要求。Host 改动规模仍以原型校准，不用代码行数直接推导确定上线日期。

## 5 Plugin 与后端必须实现的领域合同

所有接口均作为插件 MCP tools、resources 或内部后端接口提供，不加入 Host 的领域枚举。

| 合同 | 关键输入 | 关键输出/不变量 | 实现位置 |
| --- | --- | --- | --- |
| ProjectAccess | 已认证用户、projectRef | 可访问仓库/环境/角色；后端每次复验 | 插件后端 |
| WorkItem | 需求、验收、拒审证据引用 | 不可变修订与来源 | 插件后端＋UI |
| PlanRevision | workItemRef、约束、预算、能力目录 | 有类型 DAG、版本、依赖、风险与计划摘要 | Planner＋后端 |
| SourceSet | 仓库及 lock/工具链/外部输入引用 | 固定 commit 与输入 digest；不隐含 dirty 相邻目录 | Git/构建 Provider |
| RunCommand | commandId、expectedRevision、plan/source 引用 | accepted/applied 分开，重复命令幂等 | API＋Outbox＋Temporal |
| RunQuery | runRef、cursor、limit | 快照、eventSeq、nextCursor、可执行动作 | 后端＋UI |
| StepAttempt | runner lease、输入、预算和 deadline | 结果/证据、fencing、次数与消耗 | Worker＋Runner |
| Evidence | 生成器、输入 digest、输出 digest、分类 | 不可变记录、受授权下载/分页，不直接灌入模型 | 制品服务 |
| Approval | 操作/源码/制品/计划摘要与有效期 | 人员决定及失效规则；Agent 不能自签 | 后端交互确认 |
| Release | 版本/渠道/build/阶段与来源 | 沿用十二阶段；状态由可信证据推进 | Release Provider |
| ProviderLock | 类型、版本、artifactDigest、操作 Schema | 每 Run 固定版本，更新不改变旧运行 | Provider registry |
| Archive | SourceSet/Plan/运行/制品/外部回执 | 完整摘要、保留策略及恢复校验 | 后端 |

首版公开工具：ci_projects_list、ci_runs_list/get、ci_plans_propose/revise、ci_runs_start/pause/resume/cancel、ci_steps_retry、ci_evidence_get、ci_approvals_request。分页、幂等键、revision、error 和 cursor 均使用 versioned CI Schema。高风险人员决定由独立交互验证后端接口完成，首版不向模型暴露可自我批准的 ci_approvals_decide。

首版插件代码量沿用修订前估计：生产 **11,200–18,800 行**、测试 **6,000–10,000 行**，约 **17,000–29,000 行**。包含 MCP App、合同、AI 执行、Temporal/API、Linux Runner、证据和既有脚本适配；不含正式多平台签名和全渠道自动化。完整 P3/P4 插件产品约 **30,000–51,000 行含测试**。安装 profile 的 Host 侧实现计入 Host 表，插件发行配置和 UI/后端业务只计插件侧。

## 6 首版不新增的能力

- Host 不内置 Temporal、Git checkout、Linux/macOS Runner、商店 SDK 或签名密钥。
- 不让插件修改 Host 的网络策略、密钥存储原始值或发布准入策略。
- 不把 Project 变成 base64 JSON“文件”，借此套用文件 Capability grant。
- 不实现前端任意插件之间的非文件 service binding；首版 Provider 组合在后端完成。
- 不新增 Host ci/* JSON-RPC，也不为 CI 建专用 PlatformView。
- 不要求手机保持后台连接；不先实现流式日志推送、APNs、MCP Tasks 或断网控制命令排队。
- 不将 Desktop 本机目录隐式授予 CI。需本机执行时显式注册 Runner，按授权目录物化，手机只是选择已授权执行能力。

## 7 最小跨端验收矩阵

| 编号 | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| A01 | 从市场安装同一插件版本 | pluginId/版本/UI digest 一致；两端生成各自 receipt |
| A02 | 未审查发行者、坏 digest、撤销版本 | 安装失败，无残留有效记录 |
| A03 | 非文件型 App 打开 | 零文件参数可启动，UI 来自已验证资源 |
| A04 | UI-only remote App 与旧 Node MCPB | 两条模式分别可用；remote 模式不会启动 Node |
| A05 | 后端未连接 | 显示待连接，不能虚报 tools 可调用 |
| A06 | OAuth 登录/刷新/撤回 | token 不进 WebView；过期后安全刷新；撤回阻止调用 |
| A07 | 更换账号/endpoint | 不复用旧凭据或 View 结果；重新绑定 |
| A08 | 未声明工具、坏参数、资源越界 | 调用被拒绝；不存在 CI 特权绕过 |
| A09 | 工具名与 Host 冲突 | 安装/路由明确拒绝冲突，不提升权限 |
| A10 | 页面关闭/挂起/恢复 | pending 收敛；新页面恢复后重新查状态；旧响应被丢弃 |
| A11 | 升级中断/损坏与回退 | receipt 与资源一致；可用旧版或完整新版 |
| A12 | 单端卸载再安装 | 本地缓存和绑定按策略移除；服务端 Run 仍可由另一端访问 |
| A13 | tool 请求超时、重复 start | Host 不盲重放；后端幂等，真实 Run 只有一个 |
| A14 | 人员审批挑战与模型调用 | 模型只请求审批，不能提交伪造的批准结果 |
| A15 | UI 通过 fetch 读取外部 API | 被 CSP 阻止，合法读取只能走授权 bridge |
| A16 | 主模型调用与 UI 工具调用 | 暴露范围明确；能显示 UI 不等于模型获得所有 Tools |
| A17 | Android/iOS 真机 | 安装、登录、调用、登出、重装实测通过 |
| A18 | macOS 官网版与商店版 | 各自记录支持状态；不把官网测试当作商店版证明 |

## 8 交付顺序和责任

1. **平台合同冻结**：Host 与市场维护者确定 P01/P02/P06，UI artifact 发行形态、审核信任和官方受信后端；完成 Schema fixtures。
2. **通用原型**：一个无 CI 业务的测试插件跑通市场安装、非文件 UI、登录和受限工具；在 macOS 官网版、Android、iOS 实测。
3. **共享 runtime 与生命周期**：完成 P03/P04/P05/P08，旧插件回归、失败注入和账号隔离。
4. **CI 产品首版**：用正式合同接入计划、运行、证据及后端执行；Host 测试不依赖 ci_*。
5. **交互与发布**：完成 P07 后端验证流程，继续 P3/P4 正式签名、设备和渠道实施。

市场团队还需提供可验证的发行审核/签名材料、撤销及可信后端目录。它是 Host 实现的外部依赖，不能把尚无实现的服务假定为现成。CI 插件团队负责产品页面、业务授权、工具实现、执行编排及证据；平台团队负责通用安装/会话/鉴权/生命周期。

## 9 标准依据

- [MCPB Manifest](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)：不要把自定义 UI-only 包形态误认为标准已有 server 模式。
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)：UI resource 与 Host 消息桥复用标准模式。
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)：HTTP transport 的身份授权与 token 处理依据。
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：领域工具通过 Schema 和结构化结果表达，MCP 本身不定义 CI 发布批准的业务含义。
