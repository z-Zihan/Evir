# Evir VS Code 与 CLI 产品/UI 评审

**日期**：2026-08-11

**方法**：`product-design-pro` 产品闭环审计 + `ui-design-review` 视觉/终端界面审计
**范围**：`extensions/vscode`、`packages/cli`；不把 Desktop/Web 证据外推到这两个产品面

## 1. 证据与限制

已检查：

- VS Code Manifest、Host/Webview 源码、Provider/会话/工具/审批/回滚实现。
- 官方 VS Code Electron 生成的 Dark/Light 配置、空态、Agent 数据披露和审批截图。
- 扩展单元/Host/视觉 QA 脚本与 VSIX 说明。
- CLI 参数、配置、Keyring、Provider、Agent、Workspace Tool 源码与测试入口。
- 真实 `evir --help`、`--version`、未配置 `doctor`、缺参数 `configure` 和未知命令输出。

本评审不是用户研究，也没有真实付费 Provider、High Contrast、屏幕阅读器、Windows/Linux Keyring、Marketplace/Open VSX/npm 安装证据。评分只代表当前仓库和现有渲染证据。

## 2. 执行结论

两个产品面的方向成立，安全边界也比一般首版骨架完整：扩展遵循 Workspace Trust/SecretStorage，CLI 遵循工作区边界、Keyring 和默认拒绝审批。但它们尚未达到“完整产品面”的发布标准。

最高优先级不是增加工具，而是让用户能看懂任务正在做什么、为什么完成或失败：

1. VS Code Webview 缺 Agent 步骤、工具结果、验证和完成摘要，审批是唯一完整显示的工具状态。
2. CLI 缺结构化运行状态、验证/完成摘要和稳定 IO/退出码契约。
3. 扩展把 Tool Calling 作为用户勾选的确定性能力，CLI 缺参数时直接输出 Zod JSON；两者都把内部实现细节暴露成产品判断。
4. CLI 只有英文；扩展仍有硬编码 `You`、`Tool`、`Mode`、`Conversation`，没有达到全界面中英文要求。

## 3. 产品闭环评审

### 3.1 VS Code

**用户目标**：在不离开编辑器、不安装 Desktop 的情况下，接入自己的模型完成 Ask 或安全的代码 Agent 任务。

**已闭环**：安装入口、Provider 配置、SecretStorage、Ask 流、停止、会话保存、Agent Capability Gate、数据去向提示、逐次审批、最后写入 Diff/回滚。

**未闭环**：能力验证来源、Agent Activity、工具失败后的可见下一步、完成验证、完整删除/卸载说明、High Contrast/屏幕阅读器、公开安装升级。

### 3.2 CLI

**用户目标**：把 Evir 作为可组合终端工具运行 Ask，或在明确工作区内执行可审批 Agent 任务。

**已闭环**：独立配置、共享非敏感 Profile/Keyring、参数或 stdin Ask、工作区 Agent、数据去向提示、默认 No 审批、非 TTY 写入拒绝、SIGINT、步骤和循环上限。

**未闭环**：首次配置向导、错误分类/恢复命令、中英文、机器输出、稳定退出码、Agent 状态/验证/完成摘要、长输出、跨平台安装。

## 4. 方案选择

### 方案 A：分别补 UI

- VS Code 增加本地 Agent Activity 组件。
- CLI 在 `cli.ts` 中继续增加状态文本和错误映射。
- 优点：改动小、交付快。
- 缺点：同一 Agent 状态在两个产品面重复定义，长期会出现术语、完成判断和退出语义漂移。
- 风险：功能看起来补齐，但验证证据仍可能只是各 UI 自己推断。

### 方案 B：共享运行事件契约，宿主分别呈现（推荐）

- 在纯 TypeScript Core 定义版本化 `RunEvent`/`CompletionEvidence`，不依赖 React、VS Code 或 Node stream。
- Extension Host 把事件传给 Webview；CLI Presenter 映射为 stderr 文本或 JSONL。
- Tool Registry/Verifier 决定状态，UI 不从模型文本猜完成。
- 优点：产品术语、安全状态、验证和自动化输出一致；更容易测试。
- 缺点：需要先梳理当前两个 Agent Runner 的差异，初始成本较高。
- 失败条件：如果契约塞入宿主专属对象或无限增长的原始输出，会形成新的大一统 Runtime。

**推荐路径**：先用方案 A 的最小界面补丁验证信息结构，同时以方案 B 的事件 Schema 作为唯一数据源；不先重写工具执行器。

## 5. 优先问题

### P1-1 VS Code Agent 缺运行与验证可见性

- 位置：Evir Webview Agent 模式。
- 触发：Agent 读取、搜索、运行命令或完成验证。
- 影响：用户只在需要审批时看到工具事实，无法判断当前步骤、失败、验证或为何完成。
- 建议：Host 发出统一 RunEvent；Webview 增加紧凑 Agent Activity，完成时显示变更、验证和遗留。
- 验证：真实任务截图覆盖 pending/running/success/error/stopped/verification/completed。

### P1-2 VS Code 能力声明可能误导

- 位置：Provider 对话框 “This model supports tool calling”。
- 触发：用户手动勾选后保存。
- 影响：界面把用户声明显示为确定能力，可能让不支持工具的模型进入 Agent。
- 建议：改为“我确认/用户声明”，记录 evidence；实际探测成功后才显示“已验证”。
- 验证：声明、测试中、已验证、失败、未知五种状态有明确文案和 Agent Gate 测试。

### P1-3 CLI 配置失败暴露内部 Schema

- 位置：无参数运行 `evir configure`。
- 触发：首次用户漏填协议、URL 或模型。
- 影响：终端输出完整 Zod issue 数组，没有一条可直接执行的修复命令。
- 建议：TTY 进入字段向导；非 TTY 输出缺失字段和完整示例，返回参数错误码。
- 验证：缺每个字段、非法 URL、未知协议与互斥 Flag 的快照测试不出现 Zod JSON/堆栈。

### P1-4 CLI 缺稳定 Agent 输出契约

- 位置：`agent` 的 stdout/stderr 和退出码。
- 触发：工具执行、验证失败、部分完成或脚本消费结果。
- 影响：模型文本、工具事实和完成证据没有统一事件；自动化无法可靠判断状态。
- 建议：stdout 只放正文/JSON，stderr 放状态；增加版本化 JSONL 与稳定退出码。
- 验证：人类/JSONL 两套 Golden Test，覆盖停止、拒绝、工具失败、验证失败和部分完成。

### P1-5 CLI 未满足中英文产品要求

- 位置：Help、配置、Doctor、审批、错误与 Agent 状态。
- 触发：中文 Locale 或 `--language zh-CN`。
- 影响：跨产品体验不一致，中文用户首次配置和错误恢复成本高。
- 建议：建立 CLI 消息目录；机器字段和错误码不翻译。
- 验证：zh-CN/en 快照、80 列换行和 UTF-8 管道测试。

### P2-1 VS Code 文案与 ARIA 未完全本地化

- 位置：消息角色 `You/Tool`、模式组 `Mode`、会话区 `Conversation`。
- 影响：屏幕阅读器和中文界面混用英语。
- 建议：全部进入 localization，并在单元测试扫描 Webview 硬编码用户文案。
- 验证：中文 Accessibility Tree 不出现未批准英语。

### P2-2 VS Code 窄侧栏配置层级拥挤

- 位置：Provider 对话框底部按钮。
- 证据：600px 高截图中 “Test connection” 换成两行，对话框后仍露出被遮挡的模式警告和 Composer。
- 影响：首次配置的视觉焦点被背景状态分散，三个动作权重接近。
- 建议：测试作为次级动作放在字段区，底部只保留取消/保存；测试中显示就地结果。
- 验证：240/320px 宽、600px 高、中英文 50% 文本增长无裁切且焦点顺序正确。

### P2-3 CLI Help 缺自动化契约

- 位置：`evir --help`。
- 影响：没有退出码、stdout/stderr、stdin、JSON、语言和非交互审批说明，脚本作者只能读源码。
- 建议：Help 保持短，详细契约写 Man/README 并链接；每个命令增加 `--help`。
- 验证：Help 快照与文档命令自动执行。

## 6. UI 评分

### 6.1 VS Code Webview：70/100

| 维度                | 分数 | 结论                                               |
| ------------------- | ---: | -------------------------------------------------- |
| Visual hierarchy    |    7 | 模式、内容、Composer 清楚；Agent Activity 缺失     |
| Typography          |    7 | 使用平台字体和紧凑字号；角色层级基础               |
| Color               |    8 | 主要服从 VS Code 语义色；Light/Dark 一致           |
| Spacing             |    7 | 4-10px 节奏稳定；配置按钮在窄高视口拥挤            |
| Consistency         |    7 | 控件一致；Unicode 设置图标与 Codicon 体系略脱节    |
| Imagery/icons       |    6 | 克制但品牌识别弱；图标系统未完全统一               |
| Layout              |    7 | 侧栏结构稳定；长 Agent 状态尚无布局证据            |
| Components          |    7 | 配置、Composer、审批完整；运行/错误/验证组件缺口大 |
| Brand/personality   |    6 | 安静可信但较通用，差异主要来自产品规则             |
| Modern/platform fit |    8 | 遵循 VS Code 平台，不做 Desktop 页面缩放           |

第一印象：专业、克制、可信，但更像安全的首版工具面板，还不是完整的编辑器 Agent。最强项是平台适配和审批；最大缺口是运行证据。

### 6.2 CLI：62/100

| 维度                | 分数 | 结论                                             |
| ------------------- | ---: | ------------------------------------------------ |
| Hierarchy           |    6 | Help 简洁；Agent/错误层级不足                    |
| Typography          |    7 | 继承终端且无装饰噪声                             |
| Color               |    7 | 不依赖颜色，兼容性好；尚无显式 NO_COLOR 契约     |
| Spacing             |    6 | Help/审批可读；复杂错误直接倾倒 Schema           |
| Consistency         |    6 | `evir:` 错误前缀稳定；命令级帮助/错误结构不完整  |
| Graphics            |    6 | 不需要图形；缺结构符号/状态标识的统一规则        |
| Layout              |    6 | 普通输出适合管道；窄终端/长路径未验证            |
| Components          |    5 | 配置、Doctor、审批均为最小文本，没有完整状态组件 |
| Brand/personality   |    6 | 清楚直接，但与 Evir 中英文语气尚未统一           |
| Modern terminal fit |    7 | stdin、stdout、stderr 和 SIGINT 基础方向正确     |

第一印象：安全、朴素、可运行，但更接近工程 CLI 骨架。最大问题不是缺颜色，而是内部 Schema 和 Agent 状态没有被翻译成稳定终端交互。

## 7. 成功指标与验收

- Provider 首次配置成功率；失败后一次修正成功率。
- 安装到首个 Ask 的中位步骤和时间。
- Agent 审批后用户能正确回答“将修改什么/在哪里/能否撤销”的比例（需后续可用性测试）。
- Stop 到 Provider/子进程终止的 P50/P95；停止后错误完成率为 0。
- Agent 完成中含验证证据的比例；模型文本单独标记完成的比例应为 0。
- VS Code Light/Dark/High Contrast、中英文、三种侧栏宽度的视觉/无障碍通过率。
- CLI 人类/JSONL 输出 Schema、退出码和 stdout/stderr Golden Test 通过率。
- VSIX/tarball Secret 扫描、安装/升级/卸载和跨平台烟测通过率。

## 8. 评审决定

- 不增加 MCP、Skill、Inline Completion 或无人值守权限来掩盖闭环缺口。
- 先统一运行事件、完成证据、错误恢复和语言，再扩展工具数量。
- 当前 VSIX、CLI Bundle 和自动化测试证明“可构建/基础可运行”，不证明 Marketplace/npm 发布就绪。
