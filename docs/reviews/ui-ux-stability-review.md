# Evir UI/UX 稳定性审查

> **历史快照（2026-08-06）**。其中“Desktop 默认 Agent / Plan 非一级入口 / 输入区工作区”为旧信息架构；当前模型见 `docs/project-chat-agent-redesign.md`。
> 日期：2026-08-06
> 基线：`5754ec91bb58f269d5fcab3248b707390cddb6b3`（工作区未提交整改）
> 范围：Web、Desktop Capability UI、macOS 原生预签名 `.app`

## 结论

阶段 S 的主界面整改已完成自动化回归。Web 保持聊天与附件边界，不出现 Agent、Plan、Workspace 或 MCP；Desktop 默认 Agent，可切换 Ask，Plan 不作为一级入口。工作区改为输入区附近的轻量上下文控件，同一 Agent Run 的工具状态集中在 Agent Activity 中。

原生 macOS 窗口已实际启动并检查默认 Agent、Ask 切换、Desktop 文案、设置导航和 Escape 关闭。真实 Provider、真实工作区多工具修改任务、系统权限弹窗和签名安装包仍未完成端到端验收。

## 本轮调整

- 信息架构：移除 Web 的 Desktop 能力入口；顶部保留会话、模式和模型等必要信息。
- 工作区：从高权重主按钮改为 composer 附近的中性上下文控件；清除选择会立即撤销工具工作区权限。
- Agent 对话流：多工具调用归并展示，当前步骤突出，完成步骤弱化，审批只保留一个操作面。
- 设置：导航分组；危险或破坏性清理/删除操作使用统一确认对话框。
- 无障碍：设置对话框首焦点、Focus Trap、Escape、关闭后焦点恢复；修复浅色主题弱文本对比度。
- 运行时文案：Desktop 无 Provider 状态显示“本地桌面模式”，Web 显示“浏览器聊天模式”。

## 截图审查

自动截图目录：`artifacts/playwright/screenshots/`，共 48 张，覆盖 Web/Desktop、中文/英文、Light/Dark，以及 1440×900、1280×800、1024×768、800×600、720×800。另有设置 Skill/MCP/Usage 与侧边栏收起状态。

视觉基准目录：`e2e/snapshots/`，6 张核心状态。审查重点包括层级、间距、窄窗口、长内容、主题对比、语言换行和 Web/Desktop 边界。Desktop 文案修复后仅定向更新 `desktop-no-provider.png`，随后 6/6 全量视觉回归通过。

## 当前欠账

- 主 JavaScript chunk 仍约 897 KB minified；总 JavaScript gzip 271.08 KB，在 350 KB 预算内，但后续应按设置和 Markdown 能力做安全拆分。
- 浏览器中的 Desktop Capability 测试不等于完整原生验收。
- 未使用真实付费 Provider 验证跨供应商错误、超时和真实网络条件。
- 未完成原生真实工作区的“读 → 搜 → 改 → 命令验证 → Git diff → 回滚”全链路。
- Windows 原生界面与安装包未验证；macOS `.app` 因缺少 codesign identity 未生成可分发签名包。
