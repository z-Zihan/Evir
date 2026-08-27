# Evir 全项目全流程测试用例

> 适用基线：`main` / `f8cddc2`（2026-08-26）
>
> 适用产品：Evir Web、Evir Desktop、Evir for VS Code、Evir CLI
>
> 文档性质：发布验收主清单。测试文件存在或构建成功不等于产品闭环；真实 Provider、原生宿主、签名安装与跨平台结果必须分别取证。

## 1. 测试目标与判定规则

本用例集验证用户能从零开始接入自有模型，完成 Ask 或受控 Agent 任务，并在停止、失败、切换模型、崩溃、恢复、删除和发布场景下保持安全、可解释、可验证。首发不要求账号、第二模型、Embedding、Skill、MCP、通知或云端后端。

### 1.1 优先级

| 等级 | 含义                                 | 发布规则                           |
| ---- | ------------------------------------ | ---------------------------------- |
| P0   | 安全、数据、核心主流程、安装启动     | 任一失败即阻断发布                 |
| P1   | 首发承诺、恢复、可访问性、关键兼容性 | 未通过原则上阻断；例外必须书面审批 |
| P2   | 增强体验、长尾兼容、非核心设置       | 可带已知问题发布，但必须登记       |

### 1.2 证据等级

| 代码 | 证据                                    | 能证明什么                               | 不能替代什么                       |
| ---- | --------------------------------------- | ---------------------------------------- | ---------------------------------- |
| A    | 单元/集成/确定性 Fixture 自动化         | 逻辑、协议转换、稳定回归                 | 真实网络、系统权限、原生窗口       |
| B    | 浏览器渲染的 Web/Desktop Capability E2E | 前端流程、状态、响应式、无障碍           | Tauri 原生命令、Keychain、签名安装 |
| N    | 原生宿主实测                            | Tauri/VS Code Host/终端与 OS 集成        | 另一操作系统或另一 CPU 架构        |
| X    | 外部真实服务/硬件/发行渠道              | Provider、外部 MCP、签名、公证、安装升级 | 其他服务商、其他平台               |

发布结论只能使用 `PASS / FAIL / BLOCKED / NOT RUN / NOT APPLICABLE`。`BLOCKED` 必须记录阻塞项、负责人和解除条件；不得用 `SKIP` 冒充通过。

### 1.3 每条执行记录

每条用例至少记录：构建版本与 Commit、平台/架构、执行人和时间、实际结果、状态、日志/截图/视频/Artifact 路径、关联缺陷。任何含密钥的原始证据必须先脱敏。

## 2. 测试环境与数据

### 2.1 环境矩阵

| 环境    | 最低覆盖                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| Web     | Chrome 当前稳定版；Safari/Edge 各一次核心冒烟；390×844、800×600、1440×900、1600×1000 |
| macOS   | Apple Silicon 与 Intel；干净安装、升级安装；Light/Dark/System                        |
| Windows | Windows 11 x64；MSI 安装、升级、卸载；WebView2 安装/缺失恢复                         |
| VS Code | 官方 VS Code `^1.96.0`；Light/Dark/High Contrast；240/320/600px 侧栏                 |
| CLI     | macOS、Windows、Linux；TTY/非 TTY；80 列；UTF-8；`NO_COLOR=1`                        |
| 语言    | `zh-CN`、`en`，英文文本增长 50% 不破坏主操作                                         |
| 网络    | 正常、离线、DNS 失败、TLS 失败、慢速、断流、429、超时                                |

### 2.2 标准测试数据

- `P_FIXTURE`：本地确定性 Provider，支持 SSE、Tool Calling、Usage、延迟、断流及 12 类错误注入。
- `P_TEXT_ONLY`：不支持 Tool Calling 的真实或契约模型。
- `P_TOOL_A` / `P_TOOL_B`：两个不同数据目的地、支持 Tool Calling 的真实 Provider。
- `WS_CLEAN`：临时 Git 工作区，包含文本、二进制、长路径、空目录和可验证测试脚本。
- `WS_DIRTY`：含用户未提交修改的 Git 工作区。
- `WS_LINK`：含指向工作区外与敏感目录的符号链接。
- `MCP_STDIO_FIXTURE` / `MCP_HTTP_FIXTURE`：支持 initialize、分页 discovery、call、通知、重连和错误注入。
- `SECRET_CANARY`：只用于泄漏扫描的假密钥，如 `sk-evir-test-canary-never-real`。
- 附件集：空文件、UTF-8 文本、图片、二进制、超大文件、不支持类型、同名文件。

真实凭据不得写入仓库、截图、Playwright trace、命令历史或诊断包。CLI 测试必须使用临时 `EVIR_CONFIG_DIR`，原生文件任务必须使用一次性测试工作区。

## 3. 七条发布级黄金旅程

### J01 Web 首次成功对话（P0，B+X）

1. 清空站点数据并打开 Web；确认没有账号、Skill、MCP 或本地权限前置步骤。
2. 选择语言和主题，添加支持浏览器 CORS 的真实 Provider。
3. 获取模型列表；执行连接与真实流式测试；保存默认模型。
4. 新建会话，发送文本和附件，观察真实增量输出并中途停止一次。
5. 重试并完成多轮对话；执行复制、编辑重发、重新生成、分支、搜索、导出。
6. 刷新页面确认会话恢复；删除会话和 Provider，确认本地数据与可选持久密钥按策略清理。

预期：Web 始终只有 Ask，不出现 Workspace、Agent、Shell、Git 或 MCP；错误提供合法下一步；停止保留部分内容且仍可继续；无密钥泄漏。

### J02 Desktop 原生 Agent 完整任务（P0，N+X）

1. 从签名安装包首次启动，不预先授予文件/辅助功能/屏幕录制权限。
2. 添加 `P_TOOL_A`，验证 Tool Calling 证据后进入默认 Agent。
3. 选择 `WS_DIRTY`，提交“读取 → 制定计划 → 修改文件 → 运行测试 → 展示 Diff”的任务。
4. 核对 Task Brief、计划、数据去向、工作区范围；批准 L2 写入，拒绝一次 L3 操作后重试。
5. 在工具运行中停止，确认网络、子进程和后续轮次均终止；再次执行至验证完成。
6. 核对完成摘要、命令、审批、变更、验证、遗留项和 Artifact；执行回滚。
7. 验证用户原有未提交修改未丢失，任务改动被恢复，审计仍可查。

预期：模型文字不能单独标记完成；所有写入可追踪；越界/符号链接被双层阻止；拒绝或停止不显示 Completed。

### J03 Desktop 原生 MCP 完整任务（P0，N+X）

1. 确认冷启动时未启动 MCP 子进程、未建立远程连接。
2. 添加但不启用 stdio Server；测试连接、发现工具并确认测试结束后无残留进程。
3. 启用后确认 initialize、完整分页 discovery、PID、Server 信息和 Tool Registry 发布。
4. 从 Agent 对话触发 MCP Tool，核对来源、风险、参数、工作区/远程目的地并审批。
5. 重启 Server，确认代次更换、旧 PID/Session 退出、旧回调不发布结果。
6. 模拟断连并恢复；禁用/删除后确认调用取消、工具撤销、进程树/HTTP Session 清理。
7. 分别使用一个兼容的真实外部 stdio 与 HTTP MCP 重做核心路径。

预期：只有 `ready` 才暴露工具；配置、日志和持久化不含 Secret；HTTP 兼容性限制被真实验证或明确披露。

### J04 VS Code 首次 Agent 任务（P0，N+X）

1. 在干净 Profile 安装 VSIX并打开 Evir，独立配置 Provider/SecretStorage。
2. 完成 Ask、停止和重试；确认扩展不依赖 Desktop。
3. 在未信任、Remote 和无 Workspace 场景确认 Agent 禁用且原因唯一明确。
4. 信任本地 Workspace 后启动 Agent，核对数据去向；审批写入与命令。
5. 查看 step/tool/result/verification/completion，打开原生 Diff，测试正常回滚与冲突回滚。
6. 在 Light/Dark/High Contrast、240/320/600px 和键盘/屏幕阅读器下复验。

预期：Webview 不持有密钥或执行能力；关闭 View/新建会话会取消活动请求；完成状态有验证证据。

### J05 CLI 首次 Agent 任务（P0，N+X）

1. 从 tarball 全局或一次性安装；验证 `--help`、`--version`、`config-path`。
2. 在 TTY 中 `configure`，隐藏输入密钥；`doctor` 检查配置、凭据和连接。
3. 分别用参数和 stdin 执行 `ask`，确认正文只在 stdout，状态只在 stderr。
4. 对 `WS_CLEAN` 执行 `agent`；核对 Provider Host/工作区披露、默认 No 审批、验证和摘要。
5. 在非 TTY 中触发写入，确认拒绝；运行中 Ctrl+C，确认流与进程树停止且退出码 130。
6. 验证中英文、`NO_COLOR`、80 列、JSON/JSONL Schema 与目标退出码；最后升级并卸载。

预期：无原始 Zod、堆栈、ANSI 污染或密钥回显；路径逃逸和命令注入被拒绝。

### J06 升级、崩溃与数据恢复（P0，N）

1. 在旧版本创建 Provider、会话、记忆、Skill、MCP 配置和未完成 Agent Run。
2. 强制退出并安装新版本；启动时执行迁移和备份。
3. 确认普通数据可读，Secret 仍在安全存储，未完成任务被识别。
4. 选择查看、放弃和恢复；写入、命令、外发、高风险节点均不得自动重放。
5. 注入损坏数据库、未知 `providers.json` 版本、磁盘满和日志写入失败并验证恢复路径。

预期：迁移失败不静默覆盖原数据；聊天/Agent 不因日志失败崩溃；恢复状态和危险执行明确分离。

### J07 正式发布验收（P0，A+N+X）

1. 在干净 Commit 运行全部质量门禁、构建、E2E、视觉、无障碍与性能基准。
2. 校验 Tag、根/VS Code/CLI 版本一致和 Release workflow 三平台矩阵。
3. 检查 macOS arm64/x64 DMG、Windows x64 MSI、VSIX、CLI tarball 的命名、内容、哈希和大小。
4. 验证 macOS Developer ID 签名与公证、Windows 签名；在对应真实设备安装、启动、升级和卸载。
5. 运行 Web、Desktop、VS Code、CLI 各自核心冒烟；扫描包体、日志、Source Map 和诊断包中的 Secret。

预期：unsigned/ad-hoc 包只能作为开发证据；缺任一架构、签名、公证、实体机安装或 P0 证据时不得发布。

## 4. 原子测试用例

下表中的“执行”使用标准数据简称。除特别说明外，每条都要同时检查加载、成功、错误、禁用、取消和持久化中适用的状态。

### 4.1 安装、首次启动与 Runtime 边界

| ID      | P   | 证据 | 执行                          | 预期结果                                                            |
| ------- | --- | ---- | ----------------------------- | ------------------------------------------------------------------- |
| ENV-001 | P0  | N    | 全新安装后首次启动            | 可进入无 Provider 空态；无账号/云后端/第二模型前置                  |
| ENV-002 | P0  | N    | 离线首次启动                  | UI 可用并说明需配置网络 Provider；不崩溃、不死循环                  |
| ENV-003 | P1  | A+B  | 分别以 Web/Desktop 启动       | Web 仅 Ask；Desktop 默认 Agent 并可切 Ask；Plan 不作为一级入口      |
| ENV-004 | P0  | A+B  | 检查 Runtime 注册工具         | Web 无 filesystem/terminal/git/localMcp；Desktop 按 Capability 注册 |
| ENV-005 | P1  | N    | 拒绝首次工作区/系统权限       | 普通 Ask 不受影响，提供系统设置下一步                               |
| ENV-006 | P1  | N    | 重启应用和系统                | 语言、主题、非敏感配置与允许持久化的数据恢复                        |
| ENV-007 | P0  | A+N  | 注入 Storage 初始化失败并重试 | 显示可操作错误；重试成功或安全降级，不破坏数据                      |
| ENV-008 | P1  | N    | 检查冷启动进程/网络           | 未启用能力时无 MCP/Sidecar/浏览器进程、空闲轮询或意外外连           |
| ENV-009 | P0  | N    | 有活动任务时退出              | 提供暂停并退出、停止并退出、返回；不静默杀死或继续执行              |
| ENV-010 | P1  | N    | 升级兼容版本                  | Schema 迁移、备份、配置和会话兼容；版本一致                         |
| ENV-011 | P0  | N    | 卸载后复装                    | 数据保留/清理与隐私说明一致，密钥行为明确                           |
| ENV-012 | P1  | B+N  | 900×640 最小 Desktop 窗口     | 主流程无不可达控件、横向页面溢出或遮挡审批                          |

### 4.2 Provider、协议与模型能力

| ID      | P   | 证据 | 执行                            | 预期结果                                                               |
| ------- | --- | ---- | ------------------------------- | ---------------------------------------------------------------------- |
| PRO-001 | P0  | B+X  | 新增官方 Provider               | Preset、区域、协议、Endpoint 与官方链接分离且正确                      |
| PRO-002 | P0  | B+X  | 新增自定义兼容 Provider         | URL/认证/模型校验；不声称完整兼容                                      |
| PRO-003 | P1  | X    | 拉取模型列表成功                | 列表可选、带更新时间；切换账号/Key/区域清旧缓存                        |
| PRO-004 | P1  | B+X  | 模型列表失败                    | 可手动输入模型 ID，并显示失败原因和刷新入口                            |
| PRO-005 | P0  | X    | 无副作用连接测试                | 不启动服务端工具/MCP；状态含 request ID 与明确结论                     |
| PRO-006 | P0  | X    | 真实流式探测                    | 是真实增量而非假打字机；首增量和完成事件顺序正确                       |
| PRO-007 | P0  | B+X  | Tool/Vision/Structured probe    | 探测前提示可能费用；结果记录 `probe` 与时间                            |
| PRO-008 | P0  | A+B  | 用户手动覆盖 Tool Calling       | 标为 `user-override/未验证`，不伪装成探测通过                          |
| PRO-009 | P0  | A+B  | `P_TEXT_ONLY` 选择 Agent        | Agent 被阻止，可返回或降级 Ask                                         |
| PRO-010 | P0  | A+X  | AUTH_FAILED                     | 分类正确、Key 不回显、给出修复入口                                     |
| PRO-011 | P0  | A+X  | CORS_BLOCKED（Web）             | 明确改用 Desktop/可直连端点；不使用隐藏代理                            |
| PRO-012 | P1  | A+X  | RATE_LIMITED/余额不足           | 区分限流和余额；展示可重试性与下一步                                   |
| PRO-013 | P1  | A+X  | MODEL_NOT_FOUND/协议不兼容      | 分类正确，可改模型/协议，不统一成“请求失败”                            |
| PRO-014 | P0  | A+X  | 超时、DNS/TLS、断流             | 取消请求、保留部分结果、错误可重试                                     |
| PRO-015 | P1  | A    | 流式 Tool 参数分片              | 按 call ID 正确拼接；乱序/缺片/无效 JSON 安全失败                      |
| PRO-016 | P1  | A    | Tool 结果续轮与 opaque state    | 同兼容链可续用；不展示私有 reasoning；跨协议不迁移                     |
| PRO-017 | P1  | A    | Usage 缺失/准确/估算            | 三种状态可区分；重试、探测、工具续轮均计入                             |
| PRO-018 | P0  | A+B  | 保存、编辑、设默认、删除        | 唯一默认项；重启持久；删除同步清理凭据引用                             |
| PRO-019 | P0  | A+N  | Web/Desktop/VS Code Secret 边界 | Web 默认内存；Desktop Keychain；VS Code SecretStorage；均不进配置 JSON |
| PRO-020 | P0  | A+N  | Desktop/CLI 同时更新 Profile    | 按 ID/`updatedAt` 合并、原子写、0600、显式删除不被旧快照覆盖           |

### 4.3 Web Ask、会话与附件

| ID      | P   | 证据 | 执行                          | 预期结果                                             |
| ------- | --- | ---- | ----------------------------- | ---------------------------------------------------- |
| WEB-001 | P0  | B+X  | 首条 Ask                      | 创建会话、显示真实增量、完成后可继续输入             |
| WEB-002 | P0  | B+X  | 多轮对话                      | 角色和顺序正确，历史上下文生效且不重复发送           |
| WEB-003 | P0  | B    | 流式中 Stop                   | Abort 生效、部分文本保留并标 stopped、可再次发送     |
| WEB-004 | P1  | B    | 网络断流后重试                | 保留不完整内容，Retry 不重复用户消息或污染历史       |
| WEB-005 | P1  | A+B  | 重新生成                      | 原回答处理规则明确，新回答与 Usage 正确关联          |
| WEB-006 | P1  | A+B  | 编辑历史消息并重发            | 从正确节点继续，不暗改原分支                         |
| WEB-007 | P1  | A+B  | 从任意消息 Fork               | 新旧分支隔离，标题/时间/消息引用正确                 |
| WEB-008 | P1  | B    | Markdown/表格/链接/代码块     | 正确渲染、复制、横向滚动，无脚本执行/XSS             |
| WEB-009 | P0  | A+B  | 上传文本/图片附件             | 类型/大小校验、预览、移除、历史多轮引用正确          |
| WEB-010 | P0  | A+B  | 超大/空/恶意/不支持附件       | 明确拒绝或降级；不冻结、不越界读取                   |
| WEB-011 | P1  | B    | 输入中拖放多个附件            | 焦点与顺序稳定，重复/同名文件处理明确                |
| WEB-012 | P1  | A+B  | 新建、重命名、置顶            | 排序、选中态和刷新持久化正确                         |
| WEB-013 | P1  | B    | 搜索大量会话                  | 中英文匹配、无结果、清空、快捷键正确                 |
| WEB-014 | P1  | A+B  | Markdown 导出与导入           | 角色、附件索引、编码和冲突处理正确，不含 Key         |
| WEB-015 | P0  | B    | 删除会话取消/确认             | 取消不删除；确认后 UI 和存储均清理并恢复空态         |
| WEB-016 | P1  | A+B  | 隐私会话发送、关闭、重启      | 不持久化消息、长期记忆、Run/Checkpoint；临时附件清理 |
| WEB-017 | P1  | B    | 5000 字、长 URL、100 行代码   | 页面无横向溢出，输入与停止仍响应                     |
| WEB-018 | P0  | A+B  | Prompt Injection 请求本地访问 | Web 无本地工具 Schema；外部文本不能提权              |
| WEB-019 | P0  | B    | 检查所有 Web 菜单/设置        | 不出现 Workspace、Agent、MCP 或未实现占位入口        |

### 4.4 Desktop 模式、工作区、工具与回滚

| ID      | P   | 证据 | 执行                              | 预期结果                                                   |
| ------- | --- | ---- | --------------------------------- | ---------------------------------------------------------- |
| DES-001 | P0  | A+B  | Ask 请求读取工作区                | Tool Registry 拒绝；无 Tauri 文件调用                      |
| DES-002 | P0  | A+N  | Plan 读取目录/Git                 | 只读工具可用；写入、安装、状态变更命令被拒绝               |
| DES-003 | P0  | A+N  | Agent 读取/写入/验证              | 按权限执行并生成 RunEvent、Diff、验证证据                  |
| DES-004 | P0  | N    | 选择 `WS_CLEAN`                   | 原生 picker 只授权所选根，重启后状态符合设置               |
| DES-005 | P0  | A+N  | `../`、绝对外部路径、同名前缀目录 | 每次执行重新校验并拒绝                                     |
| DES-006 | P0  | A+N  | `WS_LINK` 符号链接/挂载逃逸       | realpath 后拒绝；Rust 边界再次拒绝                         |
| DES-007 | P0  | A+N  | `.ssh`、凭据、浏览器目录          | 敏感目录默认禁止，即使模型请求也不能放行                   |
| DES-008 | P1  | A+N  | read/list/search/stat             | 结果正确、范围受限、超大结果摘要/Artifact 化               |
| DES-009 | P0  | A+N  | write/patch/mkdir                 | 输入 Schema、快照、冲突、审批和审计正确                    |
| DES-010 | P0  | A+N  | 删除/安装依赖/Git 写              | L3 逐次审批，展示原始安全预览与影响                        |
| DES-011 | P0  | A+N  | 发布/sudo/凭据/系统目录           | L4 禁止或逐次审批，不能会话级永久放行                      |
| DES-012 | P0  | B+N  | 审批弹窗                          | 展示做什么/哪里/原因/影响/可撤销；首焦点拒绝               |
| DES-013 | P0  | A+N  | 拒绝审批                          | 本次调用不执行，Agent 获得拒绝结果并安全调整               |
| DES-014 | P0  | A+N  | 伪造 persisted approval metadata  | 校验失败，不复用或扩大授权                                 |
| DES-015 | P0  | A+N  | `run_command` 参数注入            | program+args、`shell:false`、cwd 固定、环境最小化          |
| DES-016 | P0  | A+N  | 命令超时/大输出                   | 终止进程树；256KB+ Artifact 化；1MB+ 不进 React 全局状态   |
| DES-017 | P0  | A+N  | 工具执行时停止任务                | Provider、当前工具、子进程和后续轮次全取消                 |
| DES-018 | P1  | A+N  | 单工具失败                        | 应用不崩溃，状态 failed/partial，提供重试或替代路径        |
| DES-019 | P0  | A+N  | 写前快照与正常回滚                | 仅恢复本 Run 改动，哈希和审计一致                          |
| DES-020 | P0  | A+N  | 回滚前用户再次编辑                | 报冲突，不覆盖用户新内容，提供 Diff/取消                   |
| DES-021 | P0  | N    | 在 `WS_DIRTY` 完成并回滚          | 不 reset、checkout 或覆盖原有未提交修改                    |
| DES-022 | P1  | A+B  | 多工具 Activity                   | 同 Run 分组，状态/耗时/摘要可展开，原始参数默认折叠        |
| DES-023 | P0  | A+B  | cancelled/interrupted Run         | 绝不显示 Completed；已产生影响和恢复入口清晰               |
| DES-024 | P0  | A+N  | CompletionVerifier 无证据         | 状态停在 needs_verification/partial，模型“完成”无效        |
| DES-025 | P1  | A+N  | 自动检测 check/test/build         | 选择合适验证器，记录命令、退出码、摘要与 Artifact          |
| DES-026 | P0  | A+N  | 清除 Workspace                    | 二次确认；立即撤销工具范围且刷新后仍清除                   |
| DES-027 | P1  | N    | 权限被 OS 撤销                    | 下一次操作检测到并提示重新授权，不沿用旧状态               |
| DES-028 | P0  | A+N  | 网络读取与上传本地内容            | 两项权限独立；上传前明确目的地与本地对象                   |
| DES-029 | P1  | A+B  | 完成摘要                          | 含目标、状态、文件、命令、审批、验证、Artifact、遗留与回滚 |
| DES-030 | P0  | N    | 崩溃后恢复 Run                    | 只恢复事件/检查点；写入、命令、外发和高风险节点等待决策    |

### 4.5 智能任务理解、DAG 与 Worker

| ID      | P   | 证据 | 执行                      | 预期结果                                                 |
| ------- | --- | ---- | ------------------------- | -------------------------------------------------------- |
| ORC-001 | P1  | A+B  | 清晰简单任务              | 生成版本化 Brief，不提出无关问题，不影响 Web Ask         |
| ORC-002 | P1  | A+B  | 缺范围/权限/数据去向      | 每轮最多 3 个阻塞问题、最多 2 轮，建议与假设可见         |
| ORC-003 | P0  | A    | 模型返回非法 Brief/Plan   | 严格 Schema 拒绝，使用确定性回退；不从正文截 JSON        |
| ORC-004 | P0  | A    | 模型尝试切模式/扩权限     | 宿主忽略并按当前模式、Capability 与授权执行              |
| ORC-005 | P0  | A    | 环、自依赖、未知节点/工具 | PlanValidator 阻断且给出可诊断原因                       |
| ORC-006 | P1  | A    | 合法 DAG 条件边           | Ready/skip/failed 传播符合定义，Revision 单调递增        |
| ORC-007 | P0  | A+N  | 两个不相交只读节点        | 最多 2 Worker 并行，事件能证明时间重叠                   |
| ORC-008 | P0  | A+N  | 同文件/未知写范围节点     | 自动串行，同资源写入并发数为 0                           |
| ORC-009 | P1  | A    | 配置 Worker 1-4           | 边界校验正确，默认 2，无空闲轮询                         |
| ORC-010 | P0  | A    | Worker 工具/上下文        | 只获父任务子集、最小上下文、独立 RunContext 和 12 轮预算 |
| ORC-011 | P0  | A    | Worker 请求再派发         | 被拒绝；首版不递归创建 Worker                            |
| ORC-012 | P0  | A+N  | 中途 Stop                 | 同一 AbortSignal 传播，停止后新增执行节点数为 0          |
| ORC-013 | P1  | A+B  | 暂停/恢复检查点           | 在安全边界暂停；恢复不重复已完成节点或危险副作用         |
| ORC-014 | P0  | A    | 事件持久化失败            | 不更新派生快照为虚假成功；失败可恢复                     |
| ORC-015 | P0  | A    | 验证节点无成功证据        | Plan 不得 Completed，可为 partial/needs_verification     |
| ORC-016 | P1  | A+B  | 50 节点/4 Worker 压力     | UI 可交互，时间线可读，原始输出不进全局 React State      |
| ORC-017 | P0  | A    | 隐私会话编排              | Brief/Plan/Event/Worker 内容只在内存，关闭后清除         |

### 4.6 模型切换、上下文、记忆与恢复

| ID      | P   | 证据 | 执行                          | 预期结果                                               |
| ------- | --- | ---- | ----------------------------- | ------------------------------------------------------ |
| CTX-001 | P1  | A+B  | 空闲同 Provider 切换          | 立即切换并持久化选择，历史不丢失                       |
| CTX-002 | P1  | A+B  | 文本流式中切换                | 默认下一轮生效；可停止后立即切换，不混合两模型输出     |
| CTX-003 | P0  | A+N  | Tool pending/running 时切换   | 暂停并确认，等待安全边界或先终止工具                   |
| CTX-004 | P0  | A+X  | 跨 Provider 切换              | 明确新数据目的地；确认前不发送；默认不自动回退         |
| CTX-005 | P0  | A    | 切到无 Tool Calling 模型      | Agent 被阻止或确认降级 Ask/Plan                        |
| CTX-006 | P1  | A    | 目标上下文更小                | 先压缩；仍超限给出分支/移除附件/缩小历史选项           |
| CTX-007 | P1  | A    | 目标不支持附件                | 列出不兼容附件并阻止发送                               |
| CTX-008 | P0  | A    | 跨协议切换                    | 不迁移 opaque reasoning/tool handles；用 Handoff 重建  |
| CTX-009 | P0  | A    | Handoff 内容                  | 保留目标、约束、审批、步骤、变更、证据、错误和版本     |
| CTX-010 | P1  | A    | Context <60%                  | 仅去明显噪声，不主动摘要                               |
| CTX-011 | P1  | A    | 60%-75%                       | 归档长工具输出、合并重复状态，引用仍可追溯             |
| CTX-012 | P0  | A+X  | 75%-90%                       | 摘要旧对话并保留最新原文与全部关键状态                 |
| CTX-013 | P0  | A+X  | >90%                          | 创建强制检查点，压缩后任务仍能正确继续                 |
| CTX-014 | P0  | A    | 文件变化后继续                | FileContextReference 标 stale 并重读，不基于旧内容写入 |
| CTX-015 | P1  | A    | 多代摘要                      | 版本化、记录来源范围；达到层级后从原始记录重建         |
| CTX-016 | P1  | A+B  | 会话/工作区/全局记忆 CRUD     | 范围、来源、置信度、置顶、编辑、删除和关闭正确         |
| CTX-017 | P0  | A    | 不可信内容要求写长期记忆/提权 | 不改变安全规则；仅按用户授权写入                       |
| CTX-018 | P0  | A+B  | 隐私会话记忆与切换            | 不检索/持久长期记忆，不持久 Handoff/Checkpoint         |
| CTX-019 | P1  | A    | 摘要 Provider 失败/取消       | 原始本地数据不丢失，可重试且主任务状态一致             |
| CTX-020 | P1  | A+N  | 长任务重启恢复                | Run Capsule/Checkpoint 关联正确，无危险自动重放        |

### 4.7 Skill、MCP 与组件 Runtime

| ID      | P   | 证据 | 执行                                   | 预期结果                                                 |
| ------- | --- | ---- | -------------------------------------- | -------------------------------------------------------- |
| SKL-001 | P1  | A+B  | Web/Desktop 打开 Skill                 | Web 恰有共享 10 项；Desktop 36 项；默认全部关闭          |
| SKL-002 | P1  | A    | 构建产物检查                           | Web 不包含 26 个 Desktop-only 正文；正文按需 Chunk       |
| SKL-003 | P1  | A+B  | 启用并自动匹配                         | 仅命中明确 Trigger 的已启用项，显示原因和版本            |
| SKL-004 | P1  | A+B  | 显式选择未启用 Skill                   | 仅下一条消息生效，发送后清空                             |
| SKL-005 | P0  | A+B  | Ask 选择本地 Capability Skill          | 禁用并解释必须 Agent；不能静默降级                       |
| SKL-006 | P0  | A    | Skill 指令要求越权                     | Tool Registry/审批仍阻止；Skill 不授予 Capability        |
| SKL-007 | P1  | A+B  | 搜索/分类/中英文 Trigger               | 结果、空态、自定义分类规范化和重复 Trigger 阻断正确      |
| SKL-008 | P0  | A    | 导入 ZIP Slip/炸弹/符号链接/可执行文件 | 拒绝并不写出目标目录                                     |
| SKL-009 | P1  | A+B  | 创建/校验/安装/编辑/导出/卸载          | 未通过校验只能草稿；版本和来源可追溯                     |
| SKL-010 | P0  | A    | 核心规则与 Skill 冲突                  | Core/Security/Permission 优先，冲突有审计                |
| MCP-001 | P0  | B+N  | 新增 stdio/HTTP Server                 | 默认 disabled；敏感 env/header 只存引用                  |
| MCP-002 | P0  | A+N  | 启动 stdio                             | 单一持久子进程、最小环境、PID 可见、stderr 有界          |
| MCP-003 | P0  | A+N  | 初始化与分页 discovery                 | 协议校验、initialized、全部页成功后原子发布              |
| MCP-004 | P0  | A    | 无效 Schema/重复 cursor/超限响应       | 安全失败，无部分工具代次泄露                             |
| MCP-005 | P0  | A+N  | 工具调用                               | 名称稳定、来源/风险正确、Schema 校验、超时和取消生效     |
| MCP-006 | P0  | A+N  | 远程调用含本地数据                     | 同时通过远程目的地和本地数据外发策略；审批展示 URL       |
| MCP-007 | P1  | A+N  | tools/list_changed                     | fetch-then-swap；旧代次调用与新工具列表不混合            |
| MCP-008 | P0  | A+N  | 断线和重连                             | 健康时无轮询；指数退避有上限；重连期间撤销旧工具         |
| MCP-009 | P0  | A+N  | restart/disable/delete                 | 调用取消、Tool Registry 清理、PID/Session/Timer 全部释放 |
| MCP-010 | P1  | N+X  | 外部 stdio/HTTP MCP                    | 真实连接、发现、Agent 调用、审批、重启和清理通过         |
| MCP-011 | P0  | B    | Web/VS Code/CLI 检查                   | 不展示或启动 MCP，不读取 Desktop MCP 配置                |
| CMP-001 | P0  | A    | Component 依赖顺序与卸载               | 拓扑激活、反向 LIFO、幂等 disposer                       |
| CMP-002 | P0  | A    | 配置/定义替换失败                      | 新效果清理并恢复完整旧图，无残留贡献                     |
| CMP-003 | P1  | A    | 禁用 Terminal                          | 只移除 `run_command`，文件/Git 与其他 Harness 仍工作     |
| CMP-004 | P0  | A    | 伪造 Tool Policy 组件                  | protected Middleware 不可替换、关闭或重复注册            |
| CMP-005 | P1  | A    | 关闭可移除 Middleware                  | 采用文档化安全降级；Verification 关闭时不得 Completed    |

### 4.8 存储、隐私、日志与诊断

| ID      | P   | 证据 | 执行                              | 预期结果                                                   |
| ------- | --- | ---- | --------------------------------- | ---------------------------------------------------------- |
| DAT-001 | P0  | A+N  | Web/真实 Desktop 保存同一实体     | Web IndexedDB；Tauri SQLite；UI 仅经 StoragePort           |
| DAT-002 | P0  | A+N  | 并发/批量写和事务失败             | 不产生半条 Run/审批/消息；可重试或恢复                     |
| DAT-003 | P0  | A+N  | Migration 成功/失败               | 单向版本、迁移前备份；失败不覆盖原库                       |
| DAT-004 | P0  | A    | 损坏/未知/超 100 项 Profile       | 拒绝加载且不静默替换；给出修复路径                         |
| DAT-005 | P0  | A+N  | 删除 Provider/会话/记忆/Skill/MCP | 对应结构化数据、Artifact、缓存和凭据引用按规则清理         |
| DAT-006 | P1  | A+N  | `.evir-backup` 导入导出           | Manifest/版本/冲突/校验正确；Key 默认不导出                |
| DAT-007 | P0  | A+N  | 私密备份选择                      | 敏感数据仅显式选择且密码加密后导出                         |
| DAT-008 | P1  | A+N  | 10k 记录搜索                      | 结果正确并满足 <150ms 目标设备预算                         |
| LOG-001 | P0  | A+B  | `SECRET_CANARY` 贯穿失败路径      | UI 日志、导出、trace、包体均无密钥/Auth/Cookie             |
| LOG-002 | P0  | A    | Prompt/文件/环境/Provider Body    | 默认不记录全文，只保留安全摘要与引用                       |
| LOG-003 | P1  | A+B  | correlation IDs                   | session/run/step/tool/request 可串联且无错链               |
| LOG-004 | P1  | A+N  | Diagnostic/Audit/Crash            | 三者生命周期和清理独立；清诊断不丢审计                     |
| LOG-005 | P0  | A+N  | 队列满/磁盘满/文件损坏            | 优先丢低级日志并计数；fatal/audit 不静默丢；主流程不崩溃   |
| LOG-006 | P1  | N    | 滚动与保留                        | 10-20MB 文件、100MB/14 天预算按配置执行，无高频扫描        |
| LOG-007 | P0  | N    | Debug/Trace/Raw Capture           | 用户主动、限时、默认关闭，仍保护 Secret；无远程开关        |
| LOG-008 | P0  | N    | 导出诊断 ZIP                      | 离线、可取消、先预览；默认不含正文/环境/SSH/Key            |
| LOG-009 | P1  | B+N  | GitHub 反馈                       | 只打开预填 Issue；无 Token、无后台上传，附件由用户手动添加 |
| LOG-010 | P1  | A+N  | 日志性能对照                      | 常规任务 CPU/延迟增量 <2%，空闲 CPU 增量接近 0             |

### 4.9 设置、UI、i18n 与可访问性

| ID     | P   | 证据 | 执行                         | 预期结果                                            |
| ------ | --- | ---- | ---------------------------- | --------------------------------------------------- |
| UX-001 | P1  | B    | 访问所有设置页               | 分类清楚、≤12 一级分类目标或有书面例外；无不可达页  |
| UX-002 | P1  | B    | Light/Dark/System 切换与重启 | 即时生效、持久化、无闪白、层级和对比可读            |
| UX-003 | P1  | B    | zh-CN/en 切换                | 全部用户文案、错误、状态、ARIA 本地化，无硬编码残留 |
| UX-004 | P1  | B    | 390×844、800×600、1600×1000  | 主流程、弹窗、审批和长内容无裁切/溢出               |
| UX-005 | P1  | B    | 仅键盘完成核心旅程           | Tab 顺序、Enter/Space、快捷键、可见焦点正确         |
| UX-006 | P0  | B    | 普通/嵌套 Dialog             | 首焦点、焦点循环、Escape 顶层优先、关闭后恢复焦点   |
| UX-007 | P0  | B    | 破坏性确认                   | 首焦点安全按钮；取消无副作用；文案说明对象和影响    |
| UX-008 | P1  | B    | 图标按钮与 Tooltip           | 可访问名称、Tooltip、禁用原因、选中语义完整         |
| UX-009 | P1  | B    | 全设置页 axe                 | 无 serious/critical；规则豁免有证据和负责人         |
| UX-010 | P1  | N    | VoiceOver/Narrator 手测      | 朗读顺序、动态状态、审批、错误、停止、完成可理解    |
| UX-011 | P1  | B    | 快捷键录制/冲突/恢复         | 平台格式正确，冲突可解释，退出/禁用注销全局快捷键   |
| UX-012 | P1  | A+B  | 个性化启用/关闭/预览         | 三步内完成；作用域正确；不能覆盖安全与权限规则      |
| UX-013 | P1  | A+B  | Usage 页面                   | 时间筛选、准确/估算/不可用、清空/导出/隐私会话正确  |
| UX-014 | P1  | B+N  | 通知关闭/开启/拒绝           | 默认不请求；仅用户手势申请；正文默认无敏感内容      |
| UX-015 | P1  | B    | 错误、空、加载、禁用态       | 每个关键页面有唯一下一步，不用营销占位代替功能      |

### 4.10 VS Code 扩展

| ID      | P   | 证据 | 执行                              | 预期结果                                                                |
| ------- | --- | ---- | --------------------------------- | ----------------------------------------------------------------------- |
| VSC-001 | P0  | N    | 安装 VSIX/激活/打开 View          | 5 分钟内可配置并 Ask；不要求 Desktop                                    |
| VSC-002 | P0  | A+N  | Webview 消息攻击/未知字段         | Zod 判别联合拒绝；CSP nonce；无 Secret/宿主句柄注入                     |
| VSC-003 | P0  | A+N  | 保存/修改 Provider                | API Key 仅 SecretStorage；空 Key 编辑保留已有 Secret                    |
| VSC-004 | P0  | N+X  | Ask 真实流与 Stop                 | 增量正确；1 秒内 stopped；部分内容保留                                  |
| VSC-005 | P0  | A+N  | 未信任/Remote/WSL/Web Workspace   | Agent 禁用，具体原因和下一步正确                                        |
| VSC-006 | P0  | A+N  | 路径、符号链接、敏感目录          | 每次工具前重新校验并拒绝逃逸                                            |
| VSC-007 | P0  | A+N  | 写入/命令审批                     | 逐次、默认拒绝、program+args、`shell:false`                             |
| VSC-008 | P0  | N    | View 销毁/新会话/Stop             | Provider、审批等待、监听器和子进程清理                                  |
| VSC-009 | P0  | N    | Agent 运行事件                    | step/tool/result/verification/stopped/failed/completed 全部可见         |
| VSC-010 | P0  | A+N  | 无验证证据                        | 不能仅凭文本/流结束显示完成                                             |
| VSC-011 | P0  | A+N  | Diff、正常回滚、冲突回滚          | 使用原生 Diff；冲突不覆盖外部编辑                                       |
| VSC-012 | P1  | N    | Light/Dark/High Contrast          | 只用 `--vscode-*` 语义颜色，焦点和对比正确                              |
| VSC-013 | P1  | N    | 240/320/600px、中英文             | 按钮可换行，审批可见，输入不被长历史挤出                                |
| VSC-014 | P1  | N    | 键盘/屏幕阅读器                   | 模式 `aria-pressed`、Dialog、拒绝首焦点、状态播报正确                   |
| VSC-015 | P0  | A+N  | VSIX 内容/Secret 扫描             | 仅 Manifest/README/LICENSE/Icon/生产 Bundle，无 QA/凭据/敏感 Source Map |
| VSC-016 | P1  | X    | Marketplace/Open VSX 安装升级卸载 | Publisher、许可证、隐私、版本和清理说明真实有效                         |
| VSC-017 | P2  | X    | VSCodium/Cursor/Windsurf          | 安装和 Ask 实测；未通过前只标“可能兼容”                                 |

### 4.11 CLI

| ID      | P   | 证据 | 执行                                | 预期结果                                              |
| ------- | --- | ---- | ----------------------------------- | ----------------------------------------------------- |
| CLI-001 | P0  | A+N  | `--help/--version/config-path`      | 输出准确、退出 0、热/冷启动满足预算                   |
| CLI-002 | P0  | A+N  | `configure` TTY                     | 缺项进入友好向导；Key 隐藏；保存后建议 doctor         |
| CLI-003 | P0  | A    | `configure` 非 TTY 缺项/非法 Flag   | 一条完整示例、退出 2，无原始 Zod/堆栈                 |
| CLI-004 | P0  | A+N  | `doctor` 各失败类型                 | 配置/凭据/认证/网络/模型/协议分类和修复命令正确       |
| CLI-005 | P0  | N+X  | 参数 Ask 与 stdin Ask               | 文本只写 stdout；状态/错误只写 stderr；可管道组合     |
| CLI-006 | P0  | A+N  | Ask 尝试访问工作区                  | 不解析/注册 Workspace Tool                            |
| CLI-007 | P0  | A+N  | Agent 无/非法/文件 Workspace        | 真实绝对目录校验，错误码 5，给出修复方式              |
| CLI-008 | P0  | A+N  | 路径遍历/绝对逃逸/符号链接          | 执行时再次拒绝，不泄漏外部文件                        |
| CLI-009 | P0  | N    | Agent 数据披露                      | 执行前 stderr 显示 Provider Host、工作区和可能外发    |
| CLI-010 | P0  | A+N  | TTY 写入/命令                       | 显示工具/风险/作用域/影响，`[y/N]` 默认 No，逐次批准  |
| CLI-011 | P0  | A+N  | 非 TTY 写入/命令                    | 自动拒绝且不执行；目标退出码 6；只读仍受限制          |
| CLI-012 | P0  | A+N  | 命令注入、超时、大输出              | `shell:false`、终止树、输出上限和 Artifact 摘要       |
| CLI-013 | P0  | N+X  | Ctrl+C 流/工具/审批                 | 全链取消、部分输出保留、最终状态 stopped、退出 130    |
| CLI-014 | P0  | A    | 目标退出码 0/2/3/4/5/6/7/130        | 每类稳定、文档一致，stderr 含可执行下一步             |
| CLI-015 | P1  | A+N  | `--json/--jsonl`                    | SchemaVersion/事件顺序稳定，无本地化字段和文本流混写  |
| CLI-016 | P1  | N    | zh-CN/en、80 列、NO_COLOR/TERM=dumb | 无 ANSI/Spinner，换行不隐藏风险对象，机器字段不翻译   |
| CLI-017 | P0  | A+N  | 环境 Key 与 Keyring 优先级          | `EVIR_API_KEY` 仅当前进程覆盖，不进配置/子进程/日志   |
| CLI-018 | P0  | A    | 损坏/未知 Profile 与旧配置迁移      | 不静默覆盖；迁移原子且保留备份/提示                   |
| CLI-019 | P0  | A+N  | Agent 完成/partial/failed           | 变更、验证、错误和遗留明确；退出 0 不等于自动验证完成 |
| CLI-020 | P0  | N+X  | 三平台 tarball 安装/升级/卸载       | bin、Keyring、全局/一次性运行和清理行为通过           |

### 4.12 性能、稳定性与发布

| ID       | P   | 证据 | 执行                      | 预期结果                                                             |
| -------- | --- | ---- | ------------------------- | -------------------------------------------------------------------- |
| PERF-001 | P0  | A    | Web production build      | 初始 JS gzip ≤350KiB；仅 10 个共享 Skill Chunk                       |
| PERF-002 | P0  | A    | Desktop frontend build    | 全部资源 ≤15MiB；36 个 Skill Chunk；MCP/重模块按需分包               |
| PERF-003 | P1  | N    | Desktop 冷启动 30 次      | P50 <2s、P95 <4s，记录设备和采样方法                                 |
| PERF-004 | P1  | N    | Desktop 空闲 10 分钟      | 平均 CPU <1%；内存目标 ≤150MB、警戒 200MB                            |
| PERF-005 | P1  | B+N  | Provider 首增量到 UI      | 到达后 ≤100ms；输入 P95 <50ms；无全局 Store 每 Token 更新            |
| PERF-006 | P1  | B+N  | 1000 消息滚动+流式        | 平滑可交互，历史项不随每个 Token 重渲染                              |
| PERF-007 | P1  | A+N  | 256KB/1MB/10MB 工具输出   | 大输出流入 Artifact，UI 只保留窗口和摘要，内存有界                   |
| PERF-008 | P1  | A+N  | 10k 搜索                  | 常用查询 <150ms，结果准确                                            |
| PERF-009 | P1  | N    | MCP disabled/enabled 对照 | disabled 无进程/请求/Timer；enabled 开销和连接时延有记录             |
| PERF-010 | P1  | N    | Context/日志对照          | 压缩只在阈值/边界执行；日志常规开销 <2%                              |
| PERF-011 | P1  | N    | VS Code 激活/长会话       | 已缓存 View 可输入 P95 <500ms，无历史全量重绘                        |
| PERF-012 | P1  | N    | CLI help/version/Ask      | 热 <200ms、冷 <500ms、Presenter 首 Token 额外开销 <20ms              |
| PERF-013 | P0  | A    | 单元/浏览器持续运行与泄漏 | Listener/Timer/AbortController/子进程无累积；单失败不拖垮应用        |
| REL-001  | P0  | A    | `pnpm check` 与 Rust gate | Format、Lint、strict TS、Vitest、VS Code/CLI、fmt/clippy/test 全过   |
| REL-002  | P0  | B    | Playwright 四套           | E2E、UI 矩阵、Visual、A11y 分开运行并保留报告                        |
| REL-003  | P0  | A    | Tag/版本/workflow         | 稳定 SemVer；三 Manifest 一致；arm64/x64/Windows 矩阵完整            |
| REL-004  | P0  | N+X  | macOS arm64/x64 包        | 对应设备签名安装、启动、升级、卸载、Gatekeeper/公证通过              |
| REL-005  | P0  | N+X  | Windows x64 MSI           | 签名安装、启动、升级、卸载、进程树终止通过                           |
| REL-006  | P0  | A+N  | 包体与许可                | Desktop 目标 ≤120MiB、≥180MiB 阻断；VSIX/tarball 内容与许可证正确    |
| REL-007  | P0  | A    | Secret/恶意内容扫描       | 构建产物、日志、截图、trace、诊断、Source Map 无真实或 Canary Secret |
| REL-008  | P0  | X    | 发布后冒烟                | 四产品面核心路径、下载链接架构标识、Release 哈希与版本一致           |

### 4.13 GUI 交互级回归用例（2026-08-26 真实操作实测沉淀）

以下用例来自 2026-08-26 对 Web（1420）与 Desktop Capability Runtime（1421）的真实 GUI 操作（浏览器自动化逐元素点击/输入），每条含前置、步骤、预期。适用环境：`pnpm exec vite --mode web|desktop` + `node e2e/fixtures/provider-server.mjs`；编排用例需节点感知 Agent fixture（见 §8.3 附注）。

#### 4.13.1 聊天输入与发送

| ID      | P   | 前置                | 步骤                                       | 预期                                                                      |
| ------- | --- | ------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| GUI-001 | P0  | 已配置可用 Provider | 输入框为空时按 Enter；再输入文字但不发送   | 空输入 Enter 不创建会话；有文字时 Send 由禁用变可用                       |
| GUI-002 | P0  | 中文输入法环境      | 组词状态（candidate 未上屏）按 Enter       | Enter 仅确认候选词，不触发发送；上屏后 Enter 正常发送（isComposing 守卫） |
| GUI-003 | P1  | 任意会话            | 发送含 [slow] 的 Ask 消息，流式中按 Escape | 流式立即停止，部分内容保留并标注 stopped；可立即继续发送                  |
| GUI-004 | P1  | 任意会话            | 发送消息后立即切到另一会话再切回           | 流式内容只归属原会话；切回时仍在流式或已完成；另一会话无串扰              |
| GUI-005 | P1  | Ask 模式            | 模型返回 tool_calls（无正文）时            | 不显示空白回复，显示"模型尝试调用工具（X），当前模式无工具权限"解释文案   |
| GUI-006 | P1  | 长回复              | 复制按钮点击                               | 按钮变为"已复制！"反馈；剪贴板内容完整                                    |
| GUI-007 | P1  | 用户消息            | "记住"点击后                               | 按钮变"已记住"禁用；记忆设置面板出现该条记忆                              |
| GUI-008 | P1  | 多轮会话            | 连发 3 条消息                              | 严格 user/assistant 交替；历史顺序正确；token 计数与用量统计对账一致      |

#### 4.13.2 会话与侧栏

| ID      | P   | 前置         | 步骤                                  | 预期                                                                                   |
| ------- | --- | ------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| GUI-010 | P1  | ≥2 个会话    | 悬停会话条目 → 点置顶                 | 出现"已置顶"分区；刷新后保持                                                           |
| GUI-011 | P1  | 任意会话     | 点重命名 → 内联输入新名 → Enter       | 侧栏与主区标题同步更新；刷新持久                                                       |
| GUI-012 | P0  | 删除当前会话 | 点删除 → 确认弹窗（首焦点取消）→ 确认 | 会话从侧栏与存储移除；主区回到新对话空态（t(chat.title) 回退），无残留视图             |
| GUI-013 | P1  | 任意状态     | ⌘N / ⌘, / ⌘B / ⌘/                     | 新建会话/打开设置/切换侧栏/快捷键帮助，全部实际生效（帮助只列已接线快捷键，无 ⌘K/⌘⇧O） |
| GUI-014 | P1  | 任意状态     | 按 ⌘K                                 | 无反应（命令面板未实现，帮助中亦不展示）                                               |
| GUI-015 | P1  | 已发送消息   | 编辑消息重发                          | 消息替换并重新生成回复；后续对话从新节点继续                                           |

#### 4.13.3 Provider 配置表单

| ID      | P   | 前置                 | 步骤                                                       | 预期                                                                                                                  |
| ------- | --- | -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GUI-020 | P0  | 设置→模型供应商→添加 | 填写名称/URL/Key/模型，勾选 Tool Calling，保存             | 供应商出现在列表；密钥掩码显示；设为默认后新会话使用该模型                                                            |
| GUI-021 | P0  | 配置表单有未保存修改 | 按 Esc / 点背景 / 点关闭                                   | 出现"继续编辑/放弃更改"确认条（首焦点安全按钮）；确认后才关闭；无修改时直接关闭                                       |
| GUI-022 | P1  | macOS 原生           | 在名称/URL/模型输入框输入小写连串词（如 evir-agent-model） | 不被系统自动纠正改写（autoCorrect/autoCapitalize/spellCheck 已关闭）                                                  |
| GUI-023 | P1  | 已填 URL+Key         | 点"获取模型"                                               | 无论成败均有可见反馈：成功显示"已获取 N 个模型"；失败显示原因；诊断日志有 provider.fetch-models-completed/failed 事件 |
| GUI-024 | P1  | 编辑已有 Provider    | 不改任何字段直接 Esc                                       | 无脏确认，直接关闭；改一个字符后 Esc 出现脏确认                                                                       |
| GUI-025 | P0  | 跨 Provider 切换     | 模型切换器选另一 Provider                                  | 弹"安全切换模型"确认：数据去向+能力降级说明；确认后头部更新、历史保留                                                 |
| GUI-026 | P1  | 测试连接             | 正确/错误 Key 各测一次                                     | 成功显示 Connection successful；错误分类展示（认证失败/限流/服务错误/协议不兼容）并附重试按钮                         |

#### 4.13.4 编排任务流（Agent 模式）

| ID      | P   | 前置                                 | 步骤                                        | 预期                                                                                                                                 |
| ------- | --- | ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GUI-030 | P0  | Agent 模式+可用 Provider             | 发送写类任务（goalKind=change）             | 生成 Brief → 4 节点计划（Inspect/Confirm execution/Execute/Verify）→ "计划需要确认"面板（首焦点取消）                                |
| GUI-031 | P0  | 计划确认面板                         | 点"确认并开始"                              | 进入 Executing plan；节点按依赖串行；写节点触发 L3 审批（工具/风险/参数完整展示，拒绝与本次允许按钮）                                |
| GUI-032 | P0  | L3 审批弹出                          | 点"拒绝"                                    | 本次调用不执行；Agent 收到拒绝结果继续或收尾；审批状态持久                                                                           |
| GUI-033 | P0  | L3 审批弹出                          | 点"本次允许"（原生+已选工作区）             | 真实磁盘写入成功；执行证据"修改的文件"计数正确                                                                                       |
| GUI-034 | P1  | 节点级隔离                           | 在 Inspect 节点让模型调用 write_file        | 被拦截，文案为"当前步骤未授予此工具权限"（不再误称浏览器模式）；日志有 agent.tool-call-blocked（含原因与放行清单）                   |
| GUI-035 | P1  | 只读低风险任务                       | 发送 goalKind=inspect、risk=low、无疑问任务 | 不出现计划确认面板，直接执行（≤3 只读节点免确认）；有未答疑问时仍确认                                                                |
| GUI-036 | P0  | 长任务（多节点慢流）                 | 等首个节点有部分输出后再点"在检查点暂停"    | 当前节点完成后进入"任务已暂停"+恢复按钮；暂停期间无新节点开始                                                                        |
| GUI-037 | P0  | 已暂停                               | 点"恢复任务"                                | 从未完成节点继续执行至结束；已完成节点不重跑                                                                                         |
| GUI-038 | P0  | 任务结束（failed/cancelled/partial） | 查看状态条                                  | 标题按 plan.status 四态显示（已完成/部分完成/失败/已停止），不统一显示"任务已结束"                                                   |
| GUI-039 | P0  | failed/cancelled/partial 结束态      | 点"重试任务"                                | 保留已完成节点，重置其余节点继续执行；高风险工具仍逐次审批；completed 态无重试按钮                                                   |
| GUI-040 | P0  | 验证节点无工具证据                   | 模型文字声称"验证通过"但无成功工具结果      | Verify 节点判失败；运行总结"部分完成"；显示"未记录成功的验证证据"；模型文字不标记完成                                                |
| GUI-041 | P1  | 相同工具+参数连续失败                | 构造 read_file 连续失败 3 次                | 第 3 次尝试被拦截（stopFailedRetries=2）；文案"同一操作连续失败，已停止重试"；UI 无重复失败卡刷屏（折叠为 1 张卡+"已重试 N 次"徽标） |
| GUI-042 | P1  | 澄清流                               | 任务带 unknowns 发送                        | "等待澄清"面板：问题卡带编号/建议词/输入框；无答案时继续按钮禁用；选择建议后进入计划确认                                             |
| GUI-043 | P1  | 任务失败后追问                       | 同会话发送"为什么失败"                      | 追问走独立轮次；goalKind=answer/inspect 时免确认直答，不再强制走完整编排确认                                                         |

#### 4.13.5 原生桌面（macOS，N 层）

| ID      | P   | 前置              | 步骤                                                              | 预期                                                                                       |
| ------- | --- | ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GUI-050 | P0  | ad-hoc release 包 | 完整走 GUI-020/030/031/033                                        | Keychain 真实写入；L3 审批后磁盘文件内容与参数一致（cat 验证）；验证器拒绝无证据的模型文字 |
| GUI-051 | P0  | 已选工作区        | 写入前将 output.txt 设为基线值 → Agent 写入 → 检查执行证据 → 回滚 | 写入后文件为新内容；回滚入口可展开；回滚后恢复基线（待原生点击复验，底层逆序快照有单测）   |
| GUI-052 | P1  | 原生窗口          | ⌘N/⌘, 快捷键                                                      | 与 Web 一致生效                                                                            |
| GUI-053 | P0  | 清除工作区        | 点清除 → 确认弹窗（首焦点取消）                                   | 工作区关联移除，本地工具范围立即撤销；刷新后仍清除；文件不被删除                           |
| GUI-054 | P0  | 原生目录选择器    | 点选择/切换工作区                                                 | 标准 NSOpenPanel 打开；选择后主界面显示新工作区路径                                        |

#### 4.13.6 结构化日志证据（诊断面板验证）

| ID      | P   | 触发动作                   | 诊断面板应出现的事件                                        |
| ------- | --- | -------------------------- | ----------------------------------------------------------- |
| LOG-G10 | P1  | 聊天发送/完成              | chat.stream-started / chat.stream-completed                 |
| LOG-G11 | P1  | Agent 节点开始/结束        | orchestration.node-started / node-finished（含状态与耗时）  |
| LOG-G12 | P1  | 模型计划被 Schema 拒绝回退 | orchestration.model-plan-rejected（含原因）                 |
| LOG-G13 | P1  | 工具被策略拦截             | agent.tool-call-blocked（含 blockReason 与 allowedToolIds） |
| LOG-G14 | P1  | 审批请求/允许/拒绝         | approval.requested / granted / denied                       |
| LOG-G15 | P1  | 获取模型                   | provider.fetch-models-completed/failed（含数量/原因）       |
| LOG-G16 | P0  | 贯穿全部失败路径           | 无 API Key/Authorization/Cookie/完整会话正文泄漏            |

## 5. 自动化映射与执行顺序

### 5.1 仓库现有入口

```bash
# 静态检查与各 TypeScript 产品面单测
pnpm check

# 根应用单元/集成测试（明确只收集 src）
pnpm exec vitest run src

# 循环检测（相同失败重试上限）专项
pnpm exec vitest run src/runtime/__tests__/loop-detection.test.ts

# 编排失败重试（retryCurrentRun 节点重置）专项
pnpm exec vitest run src/features/orchestration/__tests__/retry-run.test.ts

# Rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# Web/Desktop 浏览器能力层，必须分开运行
pnpm test:e2e
pnpm test:ui
pnpm test:visual
pnpm test:a11y

# 构建与预算
pnpm build:web
pnpm build:desktop:frontend
pnpm benchmark

# VS Code
pnpm --dir extensions/vscode check
pnpm --dir extensions/vscode test:host
pnpm package:vscode

# CLI
pnpm --dir packages/cli check
pnpm --dir packages/cli test:smoke
pnpm --dir packages/cli pack:check

# 发布结构
pnpm release:validate-workflow
pnpm release:validate-tag v0.1.0
```

### 5.2 推荐流水线

1. PR 快速门：format、lint、typecheck、根/VS Code/CLI 单测、Rust fmt/clippy/test、Web build。
2. PR 产品门：Playwright E2E、UI、A11y；视觉变更经人工确认后定向更新基线。
3. `main` 夜间门：双前端 build、benchmark、长列表/大输出、泄漏、fixture MCP。
4. Release Candidate：真实 Provider、原生 Desktop Agent、外部 MCP、VS Code Host、CLI TTY/三平台。
5. Tag 门：版本与矩阵、签名/公证、安装升级卸载、包体和 Secret 扫描、发布后冒烟。

## 6. 发布阻断清单

以下任一项未通过，不能把 Evir 宣布为完整首发就绪：

- Web 与 Desktop 至少一个真实 Provider 的配置、真实流式、停止和错误恢复。
- 原生 Desktop 在真实工作区完成读取、修改、审批、验证、Diff 和冲突安全回滚。
- Ask/Plan/Agent、工作区、网络外发和 L3/L4 权限边界无绕过。
- MCP 从 Agent 对话发起的审批调用、至少一个外部 Server，以及 Windows 生命周期证据。
- macOS arm64/x64 与 Windows x64 的签名安装、启动、升级和卸载。
- VS Code Agent 完整运行事件/验证摘要与 High Contrast/屏幕阅读器验收。
- CLI 友好错误、稳定退出码、JSON/JSONL、三平台 Keyring 与安装验收。
- Desktop 冷启动、空闲 CPU/内存、长会话、大输出、日志开销的可重复测量。
- P0/P1 缺陷关闭，或存在经负责人批准、带用户影响与回退方案的例外。

## 7. 执行报告模板

```text
版本 / Commit:
分支 / 工作区状态:
平台 / 架构 / OS:
Provider / Model / Protocol:
安装包 / 哈希 / 签名状态:
执行范围:
PASS / FAIL / BLOCKED / NOT RUN:
P0/P1 未关闭缺陷:
证据目录:
结论: 可发布 / 不可发布
审批人 / 日期:
```

报告中必须把 A、B、N、X 四层结果分开；不得用 Fixture、浏览器 Desktop Runtime、ad-hoc 签名或旧安装包替代真实外部/原生/正式发布证据。

## 8. 真实 Provider 原生冒烟执行记录（2026-08-25）

| 项目                    | 结果    | 实际证据                                                                                                                         |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 基线                    | INFO    | `main` / `f14ed82` 加未提交修复，macOS Apple Silicon，原生 Tauri ad-hoc release 构建                                             |
| Provider                | PASS    | EvoMap，OpenAI Compatible，`https://api.evomap.ai/v1`，模型 `glm-5.2`；真实 API Key 仅由用户在 Evir UI 输入，未写入本文档或终端  |
| 连接测试                | PASS    | 重启前连接测试成功；Anthropic Messages 虽能通过连接测试，但真实 Ask 返回空白，改为 OpenAI Compatible 后恢复                      |
| 真实 Ask                | PASS    | 返回精确文本 `EVIR_REAL_PROVIDER_OK`                                                                                             |
| 流式 Stop               | PASS    | 生成长中文响应时停止，消息状态显示“已停止”                                                                                       |
| Stop 后恢复             | PASS    | 同一会话继续发送后返回精确文本 `RECOVERED`                                                                                       |
| 会话重启恢复            | PASS    | 退出并重启 Evir 后，成功响应、停止状态和 `RECOVERED` 均仍可见                                                                    |
| Provider 元数据重启恢复 | PASS    | 名称、协议、Base URL、默认状态和模型在重启后仍存在                                                                               |
| Provider 凭证重启恢复   | BLOCKED | 已加入 Keychain 写入后立即回读校验并构建新版；旧进程中的凭证未实际持久化，需用户在新版中重新输入一次后执行重启验收               |
| 跨会话流式隔离          | PASS    | 单元测试与 Web/Desktop E2E 均验证：A 流式期间切到 B 不显示 A 内容；A 完成后只持久化到 A；快速 B→C 查询不发生旧结果覆盖           |
| 工作区选择              | PASS    | 原生目录选择器成功授权一次性目录 `/tmp/evir-e2e-adXU2J`；目录仅含 `input.txt` 与确定性 `verify.sh`                               |
| Agent 读取/写入/验证    | BLOCKED | 凭证丢失发生在任何模型或工具调用之前，未修改测试文件                                                                             |
| Agent 审批、Diff、回滚  | BLOCKED | 依赖真实 Agent 运行；不得以 Fixture 或静态测试冒充原生证据                                                                       |
| 诊断 UI                 | PASS    | Web/Desktop E2E 验证连接失败可见、导出含安全 Provider 错误字段与 request ID，且不含 Authorization 或测试密钥；真实原生复验待凭证 |

### 8.1 本轮缺陷

- `P0 / PRO-018 / PRO-019`：根因是 keyring 3.x 不默认启用平台后端，原配置 `keyring = "3"` 在 macOS 静默使用仅 Entry 内有效的 mock backend，导致写入返回成功而新 Entry 立即读不到。现已显式启用 `apple-native` / `windows-native`，保留写后回读校验，并加入原生后端类型回归测试；当前需用户在修复版重新输入一次以完成真实重启验收。
- `P0 / WEB-020`：已修复全局 `streamingContent/error/pendingToolApproval/latestAgentRun` 污染当前会话的问题。运行态新增所属会话 ID；增量、错误、审批和结果只向原会话可见；异步会话加载增加 stale-result guard。
- `P1 / i18n`：`chat.apiKeyMissing` 已补齐中英文文案，不再直接显示内部翻译键。
- `P0 / LOG-001`：已补齐 Provider 连接结构化日志与聊天流生命周期日志；浏览器导出脱敏自动化通过，真实原生诊断复验待凭证恢复。

### 8.2 继续执行条件

新版已构建并打开在现有 Provider 编辑页。用户需亲自重新输入凭证并保存；应用会立即校验 Keychain 回读。随后必须重启并证明连接测试和新会话仍成功，再继续 `DES-003`、`DES-009`、`DES-012`、`DES-013`、`DES-019`、`DES-020`、`DES-021`、`DES-029`。本轮临时工作区保持原始内容，尚未发生真实 Agent 写入。

### 8.3 本轮自动化结果

| 命令                          | 结果 | 明细                                                                                     |
| ----------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| Provider/存储/日志定向 Vitest | PASS | Keychain 写后回读、失败不落元数据、诊断脱敏与会话隔离定向测试通过                        |
| `pnpm check`                  | PASS | Format、ESLint、TypeScript、80 个文件/488 个测试、Release workflow、VS Code/CLI 全部通过 |
| `pnpm typecheck`              | PASS | TypeScript 构建类型检查通过                                                              |
| VS Code `check`               | PASS | 类型检查及 8 个测试通过                                                                  |
| CLI `check`                   | PASS | 类型检查及 8 个测试通过                                                                  |
| Rust fmt / clippy / test      | PASS | 格式与 lint 通过，17 个测试通过                                                          |
| Release workflow validation   | PASS | macOS Apple Silicon 与 Intel 目标校验通过                                                |
| `pnpm test:e2e`               | PASS | 34 通过、8 个按 Web/Desktop 能力边界预期跳过；含跨会话串流隔离及诊断导出                 |
| `pnpm test:ui`                | PASS | Web/Desktop 响应式、主题与语言矩阵 2/2                                                   |
| `pnpm test:visual`            | PASS | Web/Desktop 视觉基线 6/6                                                                 |
| `pnpm test:a11y`              | PASS | Web/Desktop 无障碍检查 18/18                                                             |
| `pnpm benchmark`              | PASS | 488/488；Web 初始 JS gzip 301.99 KiB，Desktop 前端 1.26 MiB，当前 arm64 DMG 5.26 MiB     |
| 原生 arm64 构建               | PASS | `Evir.app` 与 `Evir_0.1.0_aarch64.dmg` 生成；仅 ad-hoc 签名，未公证                      |

浏览器 Desktop capability E2E 不能替代原生 Tauri、Keychain 或真实 Provider 证据；正式签名、公证、Intel/Windows 实机和真实 Agent 完整任务仍不可由本轮自动化结果代替。

## 9. 真实 Provider 原生 Agent 执行记录（2026-08-26）

### 9.1 本轮原生结果

| 项目                  | 结果            | 实际证据                                                                                                                                                  |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider 凭证重启恢复 | PASS            | 修复版重启后保留 EvoMap Provider、OpenAI Compatible 协议、模型与凭证；真实会话可继续调用。凭证未写入仓库、命令或本文档。                                  |
| 工作区相对路径        | PASS            | 原生 Agent 成功解析并读取 `input.txt`、`verify.sh`、`.` 与 Git 工作区；同时保留路径遍历、同名前缀及符号链接逃逸防护。                                     |
| 文件写入审批          | PASS            | `write_file output.txt` 显示 L3、目标和参数；用户选择“本次允许”后写入精确内容 `ALPHA\nBETA\nGAMMA\n`。                                                    |
| 命令审批              | PASS            | `bash ./verify.sh` 显示 L3、工作目录和参数；用户单次允许后执行。                                                                                          |
| 约束保持              | PASS            | `input.txt` 执行前后 SHA-256 均为 `5165f3b1…`，未被修改。                                                                                                 |
| 预期失败表达          | PASS            | `verify.sh` 因 `input.txt` 缺少 `gamma` 返回 exit 1；模型明确报告失败原因，未伪造 `VERIFIED_OK`。                                                         |
| Git 状态与 Diff       | PASS            | 原生工具报告 `?? output.txt`，已跟踪文件无 diff，结论与测试工作区状态一致。                                                                               |
| 停止传播              | FAIL→FIXED(A+B) | 原生复现停止后编排仍进入后续读取；已修复授权续轮收到 Abort/Stopped 后直接取消整个 Run，并新增回归测试。修复后 Desktop E2E 21/21。                         |
| 运行证据续接          | FAIL→FIXED(A)   | 原生复现写入成功但最终卡片显示“修改文件 0”，导致回滚入口消失；已按编排 Run ID 合并授权前后 Tool、Result、Snapshot 与 File Reference，并新增聚合回归测试。 |
| 原生回滚              | BLOCKED         | 故障版本在停止后丢失回滚入口，未能完成本轮原生点击回滚；底层逆序 Snapshot 恢复测试通过，修复版仍需再做一次真实点击验收。                                  |
| 原生窗口复验          | BLOCKED         | 最新 ad-hoc 构建成功，但桌面自动化接口在重启后持续超时，未取得修复版窗口交互证据；不能以浏览器 Desktop capability 测试替代。                              |

### 9.2 本轮体验与可靠性修复

- 普通 Ask/Agent 流显示真实等待秒数；15 秒后显示慢响应说明，停止操作保持可见。
- Agent 单个模型回合上限为 120 秒；超时返回明确可重试错误，不再无限等待。
- 完成后的 Task Workbench 与 Agent 运行总结默认折叠为单行状态条；模型正文保持主视觉，执行细节和回滚仍可展开。
- 授权续轮停止后不再继续推进计划；写入、命令、快照和文件引用跨续轮合并，回滚入口不会因最终验证节点覆盖而消失。
- Provider 密钥继续只存安全存储；所有测试记录与构建日志均不得包含真实 Key。

### 9.3 2026-08-26 自动化与构建结果

| 命令                     | 结果             | 明细                                                                                                       |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm check`             | PASS             | Format、ESLint、strict TypeScript、80 个文件/500 个测试、Release workflow、VS Code 8/8、CLI 8/8 全部通过。 |
| Rust fmt / clippy / test | PASS             | `cargo fmt --check`、Clippy `-D warnings`、19/19 Rust 测试通过。                                           |
| `pnpm test:e2e`          | PASS             | Web/Desktop 合计 34 通过、8 个按产品能力边界预期跳过；Desktop 单独复跑 21/21。                             |
| `pnpm test:ui`           | PASS             | Web/Desktop 响应式、主题与语言矩阵 2/2。                                                                   |
| `pnpm test:visual`       | PASS             | Web/Desktop 视觉基线 6/6。                                                                                 |
| `pnpm test:a11y`         | PASS             | Web/Desktop axe 与键盘流程 18/18。                                                                         |
| `pnpm benchmark`         | PASS             | 500/500；Web 首屏 JS gzip 301.99 KiB；Desktop 前端 1.29 MiB；所有预算通过。                                |
| VS Code Host             | PASS             | 官方 VS Code 1.134.0 arm64 启动 Extension Host 并以 exit 0 结束。                                          |
| VSIX / CLI 包            | PASS             | VSIX 85.69 KiB；CLI smoke 通过并生成 `evir-cli-0.1.0.tgz`。                                                |
| macOS arm64 原生包       | PASS（开发证据） | 生成 `Evir.app` 与 `Evir_0.1.0_aarch64.dmg`；仅 ad-hoc 签名，未公证。                                      |

### 9.4 当前发布结论

本轮已关闭真实 Provider 保存、原生相对路径读取、写入/命令审批、预期失败报告、Git 证据、停止传播和证据续接问题。当前仍不可声明正式发布：修复版原生点击回滚尚未复验，macOS Developer ID/公证、Intel 实机、Windows 签名实机、真实外部 MCP、VS Code 完整真实 Provider Agent 与 CLI 三平台真实 Provider 验收仍缺失。

## 10. GUI 深度实测执行记录（2026-08-26 下午）

### 10.1 本轮环境

| 项                         | 值                                                                          |
| -------------------------- | --------------------------------------------------------------------------- |
| 基线                       | `main` / `2cbb58e` → `5b550ec`（本节测试期间连续提交）                      |
| 平台                       | macOS Apple Silicon（darwin 25.5.0）                                        |
| Web Runtime                | `vite --mode web` @1420                                                     |
| Desktop Capability Runtime | `vite --mode desktop` @1421                                                 |
| 原生                       | ad-hoc release bundle（`com.zihan.evir`）                                   |
| Provider                   | 节点感知 Agent fixture @1431（v4→v6，见 §10.5）+ 标准 provider-server @1430 |

### 10.2 长任务暂停/恢复实测（GUI-036/037）

| 步骤                                                             | 结果                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 发送 `[long]` 只读检查任务（goalKind=inspect, risk=low, 无疑问） | **未出现计划确认面板，直接 Executing plan**——只读免确认路径真实生效（GUI-035 PASS）                                                      |
| 等待首节点部分输出（"第一段检查进行中"流式可见，articles≥2）     | 暂停前已有部分输出，符合"不要一上来就暂停"                                                                                               |
| 点击"在检查点暂停"                                               | 当前节点完成后进入 Task paused + Resume task 按钮；暂停期间无新节点开始                                                                  |
| 暂停 3 秒后点击"恢复任务"                                        | 从未完成节点继续执行；已完成节点未重跑                                                                                                   |
| 运行结束                                                         | "Task partially completed"（新四态文案真实生效）；运行总结 2 完成/1 未解决/0 跳过；Verify 节点诚实判失败（无成功工具证据，GUI-040 PASS） |
| 证据截图                                                         | `gui-test-screenshots/r6_task_paused.png`、`r6_resume_partial.png`                                                                       |
| 本轮发现并修复                                                   | `partial` 状态原先不显示"重试任务"按钮（只覆盖 failed/cancelled）——已加入 partial 并补测试（GUI-039 补全）                               |

### 10.3 本轮（下午）发现与修复闭环

| #   | 发现                                                      | 处置                                                                                        | 提交             |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| 1   | 中文输入法组词中 Enter 被当发送（3 次实测复现）           | `isComposing` 守卫                                                                          | `2cbb58e`        |
| 2   | 相同工具+参数连续失败重试 10 次刷屏（循环检测到 12 才停） | `stopFailedRetries=2`（第 3 次拦截）+ UI 折叠重复失败卡为 1 张+"已重试 N 次"徽标 + 独立文案 | `5b550ec`        |
| 3   | 失败任务无重试入口                                        | `retryCurrentRun`（保留已完成节点重跑其余）+ 状态条按钮（failed/cancelled/partial）         | `5b550ec` + 本轮 |
| 4   | partial 态漏掉重试按钮（本轮长任务实测发现）              | retryable 条件加入 partial + 测试                                                           | 本轮             |
| 5   | 只读低风险任务确认面板偏重                                | 确认判定本已免确认（≤3 只读节点），实测验证生效并补回归锁定测试                             | `5b550ec`        |

### 10.4 本轮自动化结果

| 命令                             | 结果 | 明细                                                                                           |
| -------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                     | PASS | format/lint/strict TS/518 Vitest（较上轮 +6）/VS Code 8/CLI 8                                  |
| `pnpm test:e2e`                  | PASS | 34 通过/8 预期跳过；多轮连跑 34/34×3 零失败                                                    |
| `pnpm test:visual` / `test:a11y` | PASS | 6/6、18/18                                                                                     |
| 中途 E2E 失败 1 次               | 已修 | provider 错误用例的 `/Retry/i` 宽松断言被新"重试任务"按钮命中两元素 → 改为精确匹配消息级 Retry |

### 10.5 节点感知 Agent fixture 说明（可复用测试资产）

编排 GUI 用例需一个能按节点 system 指令（"Execute only this plan node: X."）行事的 OpenAI Compatible fixture：

- `submit_task_brief` 请求 → 返回结构化 Brief（[long] 触发 inspect 低风险 Brief 用于免确认/暂停测试；默认 change Brief 用于审批流测试）
- `submit_plan_graph` 请求 → 返回非法计划触发内置模板回退（同时验证 model-plan-rejected 日志）
- 节点指令 Inspect context / Execute task / Verify result → 分别返回 read_file 调用、write_file 调用、验证文本
- [long] 模式下每节点输出慢速长文本（~9 秒/节点），供暂停窗口
- [clarify] 模式 Brief 含 unknowns 触发澄清面板

fixture 存放：会话临时目录（本轮 `/tmp/agent-fixture.mjs` v4–v6）；建议后续固化为 `e2e/fixtures/agent-fixture.mjs` 入库。

### 10.6 本节结论

长任务"部分输出后暂停 → 安全边界生效 → 恢复 → 如实部分完成"全链路在 Desktop Capability Runtime 真实通过；原生层暂停/恢复与回滚点击复验仍待 CUA 会话恢复后补充（底层调度/快照逻辑已有单测覆盖）。发布阻断清单不变（§6）。
