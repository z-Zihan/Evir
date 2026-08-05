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
3. 未显式选择时，Skill Router 根据任务选择 0-3 个候选。
4. Context Builder 仅注入已激活 Skill 的完整内容。
5. Skill 与核心规则冲突时，核心安全规则优先。

Skill Router 必须允许用户关闭自动选择。

## 6. 内置 Skill

首批建议：

1. `task-planning`：目标澄清、步骤拆解和验收定义。
2. `file-organization`：安全整理文件，默认不删除。
3. `document-writing`：生成和维护结构化文档。
4. `frontend-development`：前端开发、多语言、多主题和验证。
5. `code-review`：架构、正确性、安全、性能和可维护性审查。
6. `bug-fix`：复现、定位、最小修复、回归验证。
7. `git-assistant`：状态、Diff、Commit/PR 文案，默认不 Push。
8. `research`：来源管理、事实/推断区分和报告输出。
9. `data-analysis`：结构化数据检查、分析和可复现结论。
10. `skill-creator`：创建、校验和测试新 Skill。

内置不代表默认全部激活。按任务动态加载。

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
