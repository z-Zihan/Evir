# Evir UI/UX 稳定性审计报告

> 审计时间: 2026-08-06
> 审计 Commit: e57a888
> 审计环境: macOS 26.5.1, Web + Desktop

## 1. 主要问题

### P0 — 阻断性

- 无（应用可启动，聊天可用）

### P1 — 核心流程问题

1. **Web 显示了 Agent/Plan 模式** — Web 没有 filesystem/terminal 能力，但 ModeSwitcher 三个模式都展示
2. **WorkspaceSelector 占据页面顶部** — 应放在输入区附近作为 Context Chip
3. **默认模式是 "ask"** — Desktop 应默认 "agent"
4. **Plan 作为一级模式常驻** — 增加理解成本，应降为 Agent 内部阶段
5. **ModeSwitcher 样式 class "mode-button" 未定义** — Tailwind 迁移遗漏
6. **Composer drag-over class 未定义** — Tailwind 迁移遗漏
7. **CSS 两套变量冲突** — Tailwind --color-* vs 旧 CSS --background 等，导致黑色方块（已修复）

### P2 — 视觉/体验

8. 顶部栏信息过多（workspace + mode + model + 操作按钮）
9. 设置弹窗 tab 过多但无分组
10. 代码块在暗色模式下对比度不足
11. 消息间距不够清晰
12. 工具调用显示为独立卡片，未分组

## 2. 信息架构问题

- WorkspaceSelector 不应在最顶部
- ModeSwitcher 不应在 composer footer 里（位置不直观）
- 设置 tab 缺少分组

## 3. Web/Desktop 定位问题

- Web 和 Desktop 展示相同 UI（mode switcher、workspace）
- 应通过 Capability 判断，Web 只展示聊天

## 4. 调整方案

- Desktop 默认 Agent，保留 Ask 切换，移除 Plan 一级入口
- Web 不展示 Agent/Plan/Workspace
- WorkspaceSelector 从顶部移到输入区
- 顶部栏只保留：会话标题 + 模型名
