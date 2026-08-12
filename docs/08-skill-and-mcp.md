# Evir Skill 与 MCP 规范

## 1. 目标

Evir 同时支持 Skill 与 MCP，但两者职责必须分离：

- Skill：定义完成某类任务的方法、触发条件、步骤、限制和输出标准。
- MCP：向 Agent 提供外部工具、资源与提示词。

Skill 不等于工具，MCP 也不负责替代任务方法论。Skill 可以声明需要或可选的 Capability/MCP，但不得绕过 Evir 权限系统。

## 2. 平台边界

### Evir Desktop

支持：

- 本地 `stdio` MCP Server。
- 远程 Streamable HTTP MCP Server。
- MCP tools/resources/prompts 的发现与调用。
- 本地 Skill 的安装、启用、禁用、创建、编辑、导入和导出。

Evir 不需要建设云端业务后端。本地 MCP Server 运行在用户电脑，远程 MCP Server 由第三方或用户自行提供。

### Evir Web

第一版：

- 支持内置 Skill、用户自定义指令型 Skill。
- Web Skill 只能包含提示词、流程、触发条件和输出规范，不得声明 filesystem、terminal、script、local MCP 等本地能力。
- Desktop 完整 Skill 导入 Web 时必须阻止安装或只读预览，不得静默忽略依赖。
- 不支持本地 `stdio` MCP。
- 暂不开放远程 MCP，避免 CORS、OAuth、密钥暴露与浏览器兼容问题。

未来若增加远程 MCP，必须通过 Capability 和实验开关单独启用。

### Evir for VS Code 与 CLI

首版均不支持 Skill 或 MCP，也不展示占位入口：

- VS Code 扩展不读取 Desktop Skill/MCP 配置，不启动 Server，不把 Webview 消息映射为任意 MCP 调用。
- CLI 不读取或执行 Skill，不接受 MCP 配置，不为了复用 Desktop 能力启动后台进程。
- 未来接入前必须先有统一 RunEvent、Tool Registry、Capability、审批、审计、取消和长输出 Artifact 契约；不能直接把 Desktop 配置文件暴露给宿主。
- 添加这些能力不得改变首次路径“配置一个模型 → Ask/Agent”，且必须按需加载。

## 3. Skill 目录格式

```text
my-skill/
├── manifest.json
├── SKILL.md
├── references/     # 可选
├── templates/      # 可选
├── examples/       # 可选
└── scripts/        # 可选，默认不执行
```

`manifest.json` 最小格式：

```json
{
  "schemaVersion": 1,
  "id": "bug-fix",
  "name": "Bug Fix",
  "version": "0.1.0",
  "description": "复现、定位、最小修复并验证软件缺陷",
  "entry": "SKILL.md",
  "source": "builtin",
  "capabilities": ["filesystem.read"],
  "optionalCapabilities": ["filesystem.write", "terminal.run"],
  "optionalMcpServers": [],
  "riskLevel": "medium"
}
```

## 4. Skill 生命周期

```text
发现 -> 校验 -> 安装 -> 默认禁用/用户确认 -> 启用 -> 路由 -> 加载 -> 执行 -> 评估 -> 更新/卸载
```

安装来源：

1. Evir 内置。
2. 本地目录。
3. ZIP。
4. 用户在 Evir 中创建。
5. Git 仓库，后续阶段支持。

导入必须防护：ZIP Slip、解压炸弹、符号链接、隐藏可执行文件、同 ID 覆盖和超大文件。

## 5. Skill 路由

禁止把全部 Skill 完整内容长期放进上下文。

推荐流程：

1. Skill Registry 维护简短索引。
2. 用户显式选择 Skill 时直接加载。
3. 未显式选择时，Skill Router 只根据已启用 Skill 的明确 Trigger 选择候选，不设固定数量上限。
4. Context Builder 仅注入已激活 Skill 的完整内容。
5. Skill 与核心规则冲突时，核心安全规则优先。

Skill Router 必须允许用户关闭自动选择。所有内置 Skill 默认关闭；设置页启用仅代表允许自动路由。输入框中的显式选择优先，可临时使用未启用 Skill，只对下一条消息生效，发送后清空。Skill 正文受剩余上下文预算约束，不能靠无上限注入挤占会话、工具与输出空间。

## 6. 内置 Skill

当前内置库采用“共享核心小而精、Desktop 扩展按本地任务补充、来源可审计、运行时兼容”的社区精选策略。

Web 与 Desktop 共享 10 个纯指令型 Skill：

1. `requirements-discovery`：需求、方案与验收闭环。
2. `implementation-planning`：跨文件实现拆解与验证计划。
3. `systematic-debugging`：复现、根因、单一假设与回归证明。
4. `test-driven-development`：Red / Green / Refactor。
5. `verification-before-completion`：完成声明前的证据门禁。
6. `documentation-writing`：Diátaxis 教程、指南、参考与解释。
7. `architecture-decision-record`：架构决策与取舍记录。
8. `security-review`：信任边界、数据流和漏洞审查。
9. `frontend-design`：有明确视觉方向的前端界面设计。
10. `skill-creator`：Skill 创建、适配、触发和评估。

Desktop 额外提供 26 个扩展 Skill；这些 manifest 与正文不会进入 Web 构建。首批 6 个本地工作 Skill：

1. `code-review`：基于 Diff、测试与仓库上下文做回归风险审查。
2. `git-delivery`：整理提交边界、分支、Commit 与交付说明。
3. `file-organization`：分析并安全整理本地文件，避免静默覆盖或删除。
4. `data-analysis`：检查本地表格/数据文件，执行可复现分析并验证结果。
5. `project-onboarding`：读取仓库规则、架构、命令和风险，建立项目工作模型。
6. `release-readiness`：汇总构建、测试、包体、签名和平台证据，判断发布就绪度。

新增 20 个社区精选扩展：

1. 办公与内容：`meeting-minutes`、`email-drafting`、`performance-review-writing`、`daily-focus`、`professional-post`。
2. 编程与开发工具：`code-tour`、`cli-design`、`system-command-planning`。
3. 数据：`sql-review`、`sql-optimization`、`credit-risk-analysis`。
4. Git / DevOps 与安全：`github-actions-hardening`、`github-release-planning`、`dependency-update-planning`、`incident-postmortem`。
5. 研究与信息收集：`evidence-mapping`、`context-mapping`、`technical-spike`。
6. 设计与法律：`diagramming`、`privacy-compliance-review`。

设置页按编程、办公文档、数据、Git / DevOps、安全、研究、信息收集、系统工具、办公效率、开发工具、内容创作、设计、法律、金融投资与其他分类展示，支持搜索和分类筛选。用户创建或导入 Skill 可以选择标准分类，也可以填写规范化后的自定义分类。

内置 manifest 使用 `platforms` 明确 `web` / `desktop` 边界；旧的本地或导入 Skill 未声明该字段时保持兼容，默认两端可见，但安装阶段仍必须执行 Capability 校验。Desktop-only 项在设置中显示平台标记。

社区内容进入内置库必须满足：

- 上游仍可追溯，并记录作者、仓库、许可证、文件路径和不可变 Commit。
- 许可证允许分发和修改；应用分发物包含必要许可证与版权声明。
- Evir 修改版在正文和 manifest 中明确标记，不伪装成原作者原版。
- `SKILL.md` 在当前 Loader 中自包含，不引用未打包的脚本、模板或参考文件。
- 不依赖特定第三方 Agent、子 Agent、账号、云服务、全局状态目录或未注册工具。
- 不授予 Capability；实际工具、工作区、网络、审批和模式边界仍由 Evir Runtime 强制执行。
- 中英文触发词经过测试；重复 Trigger 会阻断目录测试，自动路由仅使用明确 Trigger，并由上下文预算控制注入量。
- 内置不代表默认激活；全部默认关闭，正文仅在启用且命中任务时懒加载。
- Ask 只允许纯指令型 Skill；声明本地 Capability 的 Skill 只能在 Agent 中选择，最终工具权限仍由 Tool Registry 强制执行。
- Web 构建只包含 10 个共享 manifest 和 10 个正文 Chunk；Desktop 构建包含全部 36 个，构建基准必须检查数量。

第三方声明见 `skills/builtin/THIRD_PARTY_NOTICES.md`。

## 7. Skill 创建器

支持：

- 表单创建：名称、用途、触发条件、禁用场景、流程、工具依赖、输出、风险。
- 对话创建：Agent 访谈用户后生成草稿。
- 实时预览 `manifest.json` 与 `SKILL.md`。
- 静态校验、正常测试、边界测试、对抗测试和回归测试。
- 用户确认后安装。

用户创建的 Skill 默认不得携带自动执行脚本。脚本能力应在后续版本单独审批。Skill 只有通过结构校验和最低测试后才能从草稿变为可启用状态。

## 8. MCP 配置

### stdio

```json
{
  "id": "filesystem",
  "name": "Filesystem MCP",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
  "cwd": null,
  "env": {},
  "enabled": false
}
```

### Streamable HTTP

```json
{
  "id": "remote-service",
  "name": "Remote Service",
  "transport": "streamable-http",
  "url": "https://example.com/mcp",
  "headers": {},
  "enabled": false
}
```

敏感 Header 和环境变量必须存入安全存储，配置文件只保存引用。

## 9. MCP 安全

- 新增 Server 默认禁用。
- 首次连接展示 Server 元数据和全部能力。
- 工具逐项或整体授权。
- MCP 工具统一进入 Tool Registry 和 Permission Engine。
- MCP 描述、资源与返回值均视为不可信数据。
- 启动 stdio Server 时使用最小环境变量，不继承全部父进程环境。
- 限制命令、工作目录、超时、输出大小和子进程生命周期。
- 高风险工具仍需逐次审批。
- 禁止 MCP 自行提升权限或绕过审计。

## 10. 模型交互

模型请求由以下内容组成，而不是只有系统提示词：

```text
Evir 核心指令
+ 安全与权限规则
+ 当前任务与运行状态
+ 激活 Skill
+ 相关记忆
+ 近期对话
+ 内置/MCP 工具 Schema
+ 工具执行结果
+ 当前用户消息
```

模型只提出工具调用；Evir 执行参数校验、权限判断和真实调用。
