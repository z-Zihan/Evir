# Evir 开发规范

## 1. 总原则

代码应便于人类审查和长期维护，不以“AI 能生成”为设计依据。禁止通过大文件、重复代码和隐式副作用快速堆功能。

## 2. 文件规模约束

软上限：

- React 页面/组件：600 行。
- Hook/Service/Store：600 行。
- 普通 TypeScript 模块：600 行。
- Rust 模块：300 行。
- 单个函数：50 行。
- React 组件 Props：优先不超过 10 个。

达到软上限必须评估拆分；超过 400 行原则上不得合并，除非是生成文件、常量数据或有书面说明。

禁止为了满足行数机械拆文件。拆分依据是职责、变化原因和复用边界。

## 3. 目录与依赖

- 按 feature 组织业务，不建立无边界的 `utils/` 垃圾桶。
- Feature 不得随意跨层读取其他 Feature 内部文件。
- UI 不直接调用 Provider、SQLite、Tauri `invoke` 或 Shell。
- Domain 不依赖 React、Tauri 和具体数据库。
- Runtime Adapter 实现端口接口。
- 循环依赖为阻断问题。

## 4. React 规范

- 使用函数组件和 Hooks。
- 组件只负责展示与交互编排，复杂流程进入 use case/service。
- 不在 render 中执行副作用。
- 不滥用 `useEffect` 同步可推导状态。
- 远程/异步状态与纯 UI 状态分离。
- 列表必须有稳定 key。
- 组件文件默认只导出一个主组件；小型私有子组件可同文件存在。

## 5. TypeScript 规范

- 开启 strict。
- 禁止 `any`；必要时使用 `unknown` + 校验。
- 外部输入必须通过 Zod 或等价方式验证。
- 避免无意义类型断言和非空断言。
- 公共接口明确返回类型。
- 使用判别联合表达状态，避免多个互相矛盾的 boolean。

## 6. 错误处理

- 禁止空 catch。
- 错误分为用户错误、权限错误、Provider 错误、工具错误、系统错误。
- UI 展示用户可理解信息，日志保留可诊断上下文。
- 不把 API Key、Authorization、完整敏感文件内容写入日志。
- 所有长任务支持 AbortSignal 或等价取消机制。

## 7. Agent 与工具规范

- 工具输入必须验证。
- 每个工具声明能力、风险、超时和输出上限。
- 高风险操作必须审批。
- 路径必须规范化并检查是否位于授权范围。
- Shell 参数优先数组化，禁止直接拼接不可信输入。
- 工具执行必须记录开始、结束、状态和摘要。
- 模型说“完成”不等于完成，必须使用验证证据。

## 8. 样式规范

- 业务组件使用语义 Token。
- 禁止大面积内联 style。
- 禁止随意增加颜色和阴影。
- 新 UI 必须同时完成亮色与暗色。
- 不复制粘贴 shadcn 示例页；组件需符合 Evir 设计规范。

## 9. 国际化规范

- 用户可见文案全部进入 i18n。
- 翻译 key 使用 `feature.section.action`。
- 禁止字符串拼接组成句子。
- 日期、时间、数字使用 Intl。
- 错误码和用户文案分离。

## 10. 测试与质量门禁

PR 必须通过：

```text
format check
ESLint
TypeScript strict check
unit tests
critical integration tests
web production build
Rust fmt + clippy + tests
```

关键流程应有 E2E：首次配置、发送消息、停止生成、切换主题/语言、Desktop 工作区授权和审批。

阶段 S 起，质量门还包括独立的 `test:e2e`、`test:ui`、`test:visual`、`test:a11y` 和 `benchmark`。Vitest 只能收集 `src` 内单元/集成测试，Playwright 测试必须使用独立配置和确定性本地 fixture。视觉基准只能在人工确认差异合理后定向更新；Desktop Capability 浏览器测试不得写成原生完整验收。

## 11. AI 生成代码约束

Coding Agent 必须：

1. 开始前阅读相关文档。
2. 每个阶段先输出变更计划和涉及文件。
3. 小步提交，不一次改造无关模块。
4. 不擅自替换技术栈或增加重量级依赖。
5. 不使用占位逻辑伪装完成。
6. 不删除测试来让 CI 通过。
7. 不关闭 ESLint、TypeScript strict 或安全检查。
8. 不创建超大页面和万能 Store。
9. 发现文档冲突时停止扩散，记录决策。
10. 完成后运行质量门禁并报告真实结果。

## 12. 流式输出规范

- Provider 必须返回统一 `AsyncIterable<ModelEvent>` 或等价可取消流。
- 禁止先等待完整响应再伪装成打字机效果。
- UI 不得为每个 Token 更新全局 Store；使用局部 Buffer 与批量提交。
- Stop 必须同时取消网络请求、流消费、相关工具和后续 Agent 轮次。
- 流式异常时保留已生成文本，并标注未完整完成。
- 消息持久化应节流或在阶段节点提交，禁止每个 Token 写一次存储。

## 13. 性能与依赖规范

- 新增依赖前说明用途、包体积影响、可替代方案和加载时机。
- 禁止为了一个小组件引入整套重量级 UI 库。
- 禁止在应用启动时加载 Shiki、Monaco、Playwright、全部 Skill 正文或全部 MCP Tool Schema。
- 禁止空闲轮询、隐藏窗口持续动画和无边界事件监听。
- 列表超过 200 条或出现明显掉帧时必须虚拟化。
- 单次工具结果超过 256KB 时优先写入 Artifact；超过 1MB 禁止完整保留在 React 状态中。
- 对启动时间、内存、CPU、包体积和长会话进行可重复基准测试。
- 性能回归超过 `docs/10-streaming-and-performance.md` 阈值时不得无说明合并。

## 13. 个性化与基础设施约束

- 用户可编辑 Prompt 必须经过独立 Prompt Layer 注入，不得拼接到 protected system rules 前方。
- 禁止向用户开放修改 Security、Permission、Tool Policy 的写接口。
- Notification permission 只能由用户手势触发。
- Usage 记录按请求或批次持久化，禁止按 Token 持久化。
- 所有全局快捷键必须由 Shortcut Registry 注册、注销和检测冲突。
- 打开 Provider、帮助或 GitHub 外链必须使用统一 ExternalLinkService。
- 诊断包和反馈正文必须在用户可见预览后才能外发。

## 14. Harness 与模型切换约束

- Agent 行为边界必须由 Middleware、Tool Registry、Schema 和测试机械执行，不能只靠 Prompt。
- Model 切换必须经过 `ModelSwitchCoordinator`，禁止组件直接更新 activeModel 后继续旧 Tool 链。
- 跨 Provider 切换不得迁移不可解释的私有 Provider State。
- Context Summary 必须版本化，关键用户约束和审批状态使用结构化字段保存。
- 循环检测至少覆盖重复 Tool、重复文件编辑、相同错误重试和无验证进展。

## 15. 日志规范

- 业务模块只通过 `LoggerPort` 写日志，禁止直接写文件和长期依赖 `console.log`。
- 日志参数优先使用经过设计的安全结构，不传完整请求/响应后再脱敏。
- 新增模块必须定义关键事件、错误事件、耗时和 correlation ID。
- 日志写入失败必须降级，不得阻塞主流程或导致应用崩溃。
- 自动化测试必须扫描 API Key、Authorization、Token、Cookie 和 Secret 泄露。
- Raw Protocol Capture 默认关闭、限时且用户主动开启。
