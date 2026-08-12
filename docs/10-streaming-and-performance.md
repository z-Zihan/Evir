# Evir 流式输出与性能规范

## 1. 流式输出

Evir 对支持流式的模型默认使用真实流式接口，不等待完整结果后模拟打字效果。Provider Adapter 统一输出增量事件，支持取消、顺序校验、工具调用增量、用量、结束和错误。

UI 采用局部 Buffer，每 16-50ms 或每帧批量提交，不为每个 Token 更新全局 Store。网络中断或用户停止时保留已显示内容，并明确标记为中断。

不得展示模型私有推理链；可以展示产品生成的状态摘要，如“正在读取文件”“正在验证构建”。

## 2. 性能目标

以下为参考设备上的工程目标，不是对所有机器的绝对承诺：

- Provider 首个增量到达后 100ms 内显示。
- 输入框交互 P95 小于 50ms。
- 1000 条消息的会话仍可平滑滚动；超过 200 条优先虚拟化。
- Desktop 冷启动 P50 小于 2 秒，P95 小于 4 秒。
- Desktop 空闲内存目标不高于 150MB，回归警戒线 200MB。
- Desktop 空闲 CPU 长时间平均低于 1%，不允许无意义轮询。
- Web 初始 JavaScript gzip 目标不高于 350KB；重型功能拆分为异步 Chunk，Web 只打包 10 个共享 Skill 正文。
- Desktop 前端资源（minified，含按需 Chunk 和法务资产）目标不高于 3MiB；它与 Web 首屏预算独立，不套用 350KB 门槛。
- 不含可选 Sidecar 的 Desktop 安装产物目标不高于 120MiB，超过 120MiB 必须分析；180MiB 是阻断性回归警戒线，不是可消耗配额。
- 本地 1 万条消息/记录的常用搜索目标小于 150ms。
- VS Code 扩展激活不阻塞 Workbench；打开视图到可输入 P95 目标 < 500ms（已缓存 Extension Host），流式事件批量提交且不重绘全部历史消息。
- CLI `--help` / `--version` 热启动目标 < 200ms、冷启动目标 < 500ms；Ask 首 Token 额外 Presenter 开销 < 20ms。
- VSIX 与 CLI tarball 记录压缩/解压大小和依赖；增长超过 20% 必须给出原因。

## 3. 轻量策略

- 使用系统 WebView，不内置完整 Chromium。
- Sidecar 按需下载/打包并按需启动，不随主应用常驻。
- Shiki、文档解析器、图表、Playwright、Skill 正文和 MCP Schema 延迟加载。
- 不在启动时扫描整个用户目录或建立全量索引。
- Skill 首先加载 manifest，命中后再加载 SKILL.md。
- MCP 默认不自动启动，启用后也按需连接。
- 大日志边接收边写文件；UI 只保留窗口化片段和摘要。
- Store 使用细粒度 selector，避免流式更新导致无关组件重渲染。

## 4. 性能门禁

每个 Release 分别记录：Web 初始/全部 JavaScript、Web 10 个 Skill Chunk、Desktop 前端总资源与 36 个 Skill Chunk、各架构 Desktop 安装包、冷启动、空闲内存/CPU、流式渲染延迟、长列表 FPS、1MB/10MB 工具输出测试。安装包不存在时必须标为未测量；早于当前源码的旧产物标为 stale，不能伪造当前通过。新增依赖导致显著回归时必须说明收益或回退。

同时记录 VS Code 激活/视图打开/侧栏长会话、VSIX 大小，以及 CLI `help/version/ask` 启动、RSS、1MB 输出、tarball 大小。Extension Host 和 CLI 不允许空闲轮询或预加载 MCP/Skill。

## 5. 模型切换、压缩与日志性能

- 空闲模型切换 UI 反馈目标 < 100ms；网络能力验证异步执行并显示状态。
- 模型切换不得重新扫描整个工作区，只构建当前 Run 的 Handoff。
- Context Compaction 仅在预算阈值、步骤结束或切换前执行，不与每个 Token 同步。
- 日志使用异步有界队列和批量写入；默认日志对常规任务 CPU/延迟增量目标 < 2%。
- 日志查看器按页读取，不把全量日志放进 React State。
- 诊断导出在后台执行、可取消，并限制内存峰值。
- 长任务 Checkpoint 写入节流，不能因每个 Tool Delta 写一次数据库。

## 6. 2026-08-06 阶段 S 快照

- Web JavaScript gzip 271.08 KB，CSS gzip 21.32 KB，满足 350 KB Web 预算。
- Vite Web build 1.57 s；298 个单测 benchmark 3.63 s。
- 主 JavaScript chunk 约 897 KB minified，仍触发 Vite 大 chunk 告警。该项记录为性能债，未提高告警阈值；后续应按设置和 Markdown 能力做安全拆分。
- Desktop 冷启动分位、空闲 CPU/内存、长列表 FPS、1MB/10MB 输出和签名包体积尚未完成正式测量，不得视为通过。

## 7. Web / Desktop 独立构建门禁（2026-08-12）

- `pnpm build:web` 输出到 `dist/web`，只包含 10 个共享 Skill 正文 Chunk。
- `pnpm build:desktop:frontend` 输出到 `dist/desktop`，包含 10 个共享 + 26 个 Desktop-only Skill 正文 Chunk。
- `pnpm benchmark` 同时读取两份产物；Web 检查 350KiB 初始 JS gzip，Desktop 检查 3MiB 前端资源，并在存在安装包时报告 120/180MiB 状态。
- 增大 Desktop 包体预算不允许引入完整 Chromium、启动时加载全部 Skill、空闲 Sidecar 或轮询；冷启动、内存和 CPU 门禁保持不变。
