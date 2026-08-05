# Harness 工程：构建真正让 AI 智能体有效运行的系统

# 前言

OpenAI 的 Codex 团队于2026年2月发表了一篇[官方文章](https://openai.com/zh-Hans-CN/index/harness-engineering/)，文章中项目团队构建了一个拥有超过100万行代码的生产应用程序，其中没有一行是由人编写的。工程师们没有编写代码，而是设计了一个让 AI 可靠地编写代码的系统。这个系统 —— 包括约束条件、反馈循环、文档、代码检查工具和生命周期管理——就是行业现在所说的**“Harness”**。

**Harness engineering 是设计这些系统的新学科。它正在改变软件工程师的含义。**

---

# **什么是 Harness Engineering?**

## **马的隐喻**

“Harness”一词字面意思是“马具”——套在马身上、让骑手控制方向和力量的整套装备。这是引导强大但不可预测的马朝正确方向前进的一整套装备。这个比喻是有意为之的：

- 马就像AI模型 —— **强大、快速，但它自己不知道该往哪里走，容易跑偏。**

- Harness 是一种基础设施—— **包括约束条件、护栏和反馈回路，它们能有效地引导模型的能力。**

- 骑手是人类工程师 —— **提供方向，而不是亲自奔跑。**

没有 Harness，AI 智能体就像旷野中的马。跑得快、令人震撼，但在完成工作方面却完全无用。

## **正式定义**

- LangChain 在其官方博客《Agent Frameworks, Runtimes, and Harnesses — oh my\!》中，将 Harness 明确为区别于 Framework 和 Runtime 的第三种架构层次。

- Latent Patterns 的术语表将其定义为"位于语言模型与现实世界之间的编排层，用于管理自主代理的行为，主要包含提示管理、工具执行、策略检查和循环控制"。

- [Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html?utm_source=chatgpt.com) 撰写过专门的架构分析文章，将其描述为“_he tooling and practices we can use to keep AI agents in check_”——但它不仅仅关乎安全。**一个好的 Harness 不仅能让智能体更可控，还能让它们更有能力。**

如果用一个公式来描述Harness的作用，那便是：**Agent = Model \+ Harness**

---

# **Harness Engineering 的重要性**

## **从“模型能力”到“系统能力”：Harness 才是关键变量**

AI 行业正面临着一个令人不安的事实：底层模型的重要性不如围绕它的系统。

LangChain 明确地证明了这一点。他们的编码代理在 Terminal Bench 2\.0 上从 52\.8% 上升到 66\.5%，从前 30 名跃升至前5名，没有改变模型。他们只改变了 Harness。

| **变更**                              | **做了什么**                                                        | **影响**                       |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| 自验证循环（Self\-verification loop） | 添加了“完成前检查清单”中间件                                        | 在提交前捕获错误               |
| 上下文工程（Context engineering）     | 在启动时映射目录结构                                                | Agent 从一开始就理解代码库     |
| 循环检测（Loop detection）            | 跟踪重复的文件编辑                                                  | 防止出现“死循环”（doom loops） |
| 推理夹层（Reasoning sandwich）        | planning / verification阶段使用高推理强度，实现阶段使用中等推理强度 | 在时间预算内获得更高质量结果   |

相同的模型，不同的方法，结果显著提升，这些改变恰恰验证了 Harness Engineering的重要性。

## **OpenAI 的百万行验证**

[OpenAI 的实验](https://openai.com/zh-Hans-CN/index/harness-engineering/)是迄今为止最有说服力的证据：

- 5个月的开发

- 最终产品中有 100w\+ 行代码

- 零手动编写行 —— 每一行均由 Codex 智能体生成

- 建造时间约为人类所需时间的 1/10

- 该产品有内部日常用户和外部 α 测试人员

- 它被运送、部署、损坏，然后被修复——所有这些都由管理框架内的代理完成。

工程师的工作是什么？**设计 Harness，明确意图，提供反馈，而不是编写代码。**

---

# **Harness Engineering 相关概念**

| **概念**             | **范围**        | **关注点**                     |
| -------------------- | --------------- | ------------------------------ |
| Prompt Engineering   | 单次交互        | 设计高效的提示词               |
| Context Engineering  | 模型上下文窗口  | 模型能看到哪些信息             |
| Harness Engineering  | 整个 Agent 系统 | 环境、约束、反馈机制、生命周期 |
| Agent Engineering    | Agent 架构      | Agent 内部设计与任务路由       |
| Platform Engineering | 基础设施        | 部署、扩展、运维               |

Harness 工程包含上下文工程，并借鉴提示词工程，但其所处层级更高 —— 它关注的是让 Agent 可靠运行的**完整系统**，而不仅仅是单次交互的输入设计。

---

# **Harness Engineering 工程的三大支柱**

OpenAI 的框架将 Harness Engineering 分为三个核心类别：

## **上下文工程 **

上下文工程可以确保智能体在正确的时间拥有正确的信息。

**静态上下文：**

- 仓库本地文档（架构说明、API 规范、代码风格指南）

- 编码特定项目规则的 `AGENTS.md` 或 `CLAUDE.md `文件

- 经过 linter 校验、相互关联的设计文档

**动态上下文：**

- Agent 可访问的可观测性数据（日志、指标、链路追踪）

- Agent 启动时的目录结构映射

- CI / CD 流水线状态和测试结果

**关键规则：**从 Agent 的角度来看，任何它在上下文中无法访问的内容都不存在。也就是说：存在于 Google Docs、Slack 对话、或人脑中的知识，对系统来说都是不可见的**。**因此： **代码仓库必须成为唯一的“事实来源”**

## **架构约束**

这是 Harness Engineering 与传统 AI 提示词工程最显著的区别。你不是告诉 Agent “编写好的代码”，而是机械地规定好的代码应该是什么样的。

**依赖分层：**

```Plain Text
Types → Config → Repo → Service → Runtime → UI
```

每一层只能从其左侧的层导入，这是由结构测试和 CI 验证强制执行的。

**Harness 执行工具：**

- 确定性Linter：自定义规则，自动检测并标记违规行为

- 基于 LLM 的审计器：使用 Agent 审查其他 Agent 生成的代码，确保其符合架构规范

- 结构化测试：类似 ArchUnit，用于验证 AI 生成代码的结构是否符合约束

- Pre\-commit 钩子：在代码提交前自动执行检查

为什么“约束”反而能提升效果？因为**限制解空间，反而能提升 Agent 的效率与质量。**

原因在于：

- 如果 Agent 可以“随意生成”，它会浪费大量 token 在无效尝试上（探索死胡同）

- 如果 Harness 设定了清晰边界，Agent 会更快收敛到正确解

## **熵管理（“垃圾回收”）**

这是最容易被低估的一个组成部分。随着时间推移，由 AI 生成的代码库会不断积累“熵”——文档逐渐偏离实际代码、命名规范开始不一致、无用代码不断堆积。

Harness Engineering 通过周期性清理 Agent 来解决这一问题：

- 文档一致性 Agent：验证文档是否与当前代码保持一致

- 约束违规扫描器：查找那些绕过早期检查的违规代码

- 模式规范 Agent：识别并修复偏离既有模式的实现

- 依赖审计 Agent：跟踪并解决循环依赖或不必要的依赖

这些 Agent 按照固定周期运行 —— 每日、每周，或在特定事件触发时执行——从而保持代码库对人类开发者和未来的 AI Agent 都始终健康、可维护。

---

# **Harness Engineering 实践**

目前 Harness Engineering 的实践正在重构软件工程范式：从“人写代码”，转向“人设计系统，Agent 执行代码”。将开发能力从“模型能力”转变为“系统能力（Harness）”

## **OpenAI 的方法：零人工代码**

[OpenAI 提出的 Harness Engineering 实践](https://openai.com/zh-Hans-CN/index/harness-engineering/)，本质是一种**以 AI Agent 为核心的软件工程新范式**：工程师不再直接编写代码，而是通过设计一整套包含环境、工具、规则和反馈机制的系统（Harness），来让像 Codex 这样的智能体自主完成代码生成、测试、CI、文档等完整开发流程；在这一体系中，人类负责定义目标与约束，Agent 负责执行，从而实现大规模、自动化且可控的软件生产。

下表展示了这一转变在各项工程职责中的具体体现：

|              | **传统方式** | **Harness Engineering**         |
| ------------ | ------------ | ------------------------------- |
| **编写代码** | 主要工作     | 不再需要                        |
| **设计架构** | 工作的一部分 | **核心工作**                    |
| **编写文档** | 事后补充     | 关键基础设施                    |
| **代码评审** | 审查代码     | 审查 Agent 输出 \+ Harness 效果 |
| **debug**    | 阅读代码     | 分析 Agent 行为模式             |
| **测试**     | 编写测试用例 | 设计由 Agent 执行的测试策略     |

## **Stripe 的方法：大规模的 Minions**

[Stripe 的内部编码 Agent，被称为 Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)，如今每周可以产出超过 1000 个已合并的 PR。它本质上是一种**端到端自动化的软件开发模式。**开发者只需在 Slack 中发布任务，Minion 即可自主完成从代码生成、测试执行、CI 校验到创建 PR 的完整流程，并最终由人工进行审核与合并。

我们可以很容易的发现，相较于传统的开发模式，Stripe 的开发方式可以概括成以下 5 步：

1. 开发者在 Slack 中发布任务

2. Minion 编写代码

3. Minion 通过 CI

4. Minion 创建 PR

5. 人工进行审核并合并

在第 1 步到第 5 步之间，开发者无需参与任何中间过程，整个开发链路均由 Harness 统一编排与执行——包括测试运行、代码规范校验以及文档更新。这一体系将开发流程从“人工逐步参与”转变为“Agent 全流程执行 \+ 人类最终决策”，从而实现大规模并行的代码生产能力。

## **LangChain 的方法：Middleware 优先**

[LangChain 将 Harness 设计为](https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/)[**可组合的中间件体系（Composable Middleware Stack）**](https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/)，通过在 Agent 执行流程中逐层插入能力模块，实现对 Agent 行为的精细控制与增强：

```Plain Text
Agent Request
  → LocalContextMiddleware (maps codebase)
  → LoopDetectionMiddleware (prevents repetition)
  → ReasoningSandwichMiddleware (optimizes compute)
  → PreCompletionChecklistMiddleware (enforces verification)
  → Agent Response
```

每一层 Middleware 都在**不改变核心 Agent 逻辑的前提下，独立增加一项能力**，从而将 Agent 从“单体逻辑”演化为“可扩展系统”。这种 Middleware\-first 的设计，使 Harness 具备：

- **可插拔性**（能力按需组合）

- **可测试性**（每一层可独立验证）

- **可演进性**（随模型能力持续迭代）

👉 本质上，LangChain 将 Harness 从“隐式逻辑”变成了“显式架构”。

---

# **构建你的第一个 Harness Engineering：实用框架**

## **Level 1: 个人开发者**

如果你在个人项目中使用 Claude Code、Cursor 或 Codex：

要设置的内容：

- 包含项目规范的 `CLAUDE.md` 或 `.cursorrules `文件

- 用于代码检查和格式化的 pre\-commit 钩子

- 一套可供 Agent 运行以进行自我验证的测试集

- 清晰的目录结构与一致的命名规范

> 搭建时间：1–2 小时
>
> 效果：避免最常见的 Agent 错误

## **Level 2: 小型团队**

适用于 3–10 名开发者共享同一代码库的团队：

在 Level 1 的基础上增加：

- 包含团队统一规范的 `AGENTS.md` 文件

- 通过 CI 强制执行的架构约束

- 针对常见任务的共享 Prompt 模板

- 以代码形式管理的文档，并通过 linter 校验

- 专门用于审查 Agent 生成 PR 的代码评审清单

> 搭建时间：1–2 天
>
> 效果：在团队范围内实现 Agent 行为的一致性

## **Level 3: 工程组织**

适用于同时运行数十个 Agent 的组织：

在 Level 2 的基础上增加：

- 自定义中间件层（循环检测、推理优化）

- 可观测性集成（Agent 可读取日志和指标）

- 定期运行的熵管理 Agent

- Harness 的版本管理与 A/B 测试

- Agent 性能监控看板

- 当 Agent 卡住时的升级处理机制（Escalation policies）

> 搭建时间：1–2 周
>
> 效果：Agent 能够作为“自主贡献者”运行

# **Harness Engineering 常见错误**

## **过度设计控制流**

> _"If you over\-engineer the control flow, the next model update will break your system\._

模型能力正在快速提升。2024 年还需要通过复杂流程（pipeline）才能完成的能力，如今只需一个上下文窗口内的提示（prompt）就可以实现。因此，在构建 Harness 时，应当具备“可拆卸性（rippable）”——当模型本身足够智能、不再需要某些“聪明”的逻辑时，你应该能够轻松移除这些逻辑。

## **将 Harness 视为静态**

Harness 需要随着模型一起演进。当新模型在推理能力上有所提升时，原本用于“优化推理”的中间件反而可能变得多余甚至产生负面效果。因此，应在每次模型重大升级后，都应当对 Harness 的各个组件进行重新评估与更新。

## **忽略文档层**

最有影响力的 Harness 优化，往往是最简单的一点：更好的文档。

如果你的 `AGENTS.md` 含糊不清，那么 Agent 的输出也会同样模糊。应当投入精力编写精确、机器可读的文档，使其成为 Agent 的“事实依据”。

## **无反馈回路**

没有反馈机制的 Harness 只是一个“笼子”，而不是“引导工具”。Agent 需要知道自己何时成功、何时失败。

因此应当构建：

- 在任务完成前的自我验证步骤

- 将测试执行纳入 Agent 工作流程

- 按任务类型统计 Agent 成功率的指标

## **Human\-Only 文档**

如果你的架构决策只存在于人的头脑中，或存放在 Agent 无法访问的 Confluence 页面中，那么你的 Harness 就存在缺口。Agent 所需的一切信息，必须都存在于代码仓库中。

---

# **对未来的影响**

## **程序员的工作正在发生变化**

Harness engineering 代表了软件工程师工作内容的一次真正的演变：

| **之前** | **之后**                       |
| -------- | ------------------------------ |
| 编写代码 | 设计让 AI 编写代码的执行环境   |
| 调试代码 | 调试 Agent 的行为              |
| 代码评审 | 评估 Agent 输出与 Harness 效果 |
| 编写测试 | 设计测试策略                   |
| 维护文档 | 将文档构建为机器可读的基础设施 |

这并不意味着工程师变得不那么技术化。恰恰相反，**Harness 工程需要更深层次的架构思考 —— 你是在设计一套无需持续人工干预也能稳定运行的系统。**

## **模型提供智能，Harness 让智能真正可用**

当下的 Harness 在一定程度上是在弥补模型的能力不足，但它同时也是围绕模型智能进行系统设计，从而放大模型的效果。一个良好配置的环境、合适的工具、可持续的状态管理以及验证循环，无论模型本身多么智能，都会让其更高效。

Harness Engineering 目前仍是一个非常活跃的研究领域。在 LangChain 中，我们通过该方向不断改进我们的 Harness 构建库 deepagents。目前正在探索的一些有趣问题包括：

- 在共享代码库上编排数百个并行协作的 Agent

- 让 Agent 分析自身执行轨迹，以识别并修复 Harness 层面的失败模式

- 构建能够根据具体任务“即时组装”所需工具和上下文的 Harness，而非预先固定配置
