> **Historical（2026-08 快照，2026-09-04 归档）** — 历史评审记录，不是当前规范来源。

# Evir 稳定性缺陷登记

> **历史快照（2026-08-06）**。所列缺陷已全部修复；EVIR-S-006 描述的是旧信息架构（输入区工作区控件），已被 2026-08-27 Project 重构取代。
> 日期：2026-08-06
> 状态：阶段 S 整改工作区

| ID         | 等级 | 模块             | 实际行为与根因                                                                                         | 修复                                                                                                             | 证据                                                                    | 状态   |
| ---------- | ---- | ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| EVIR-S-001 | P0   | Desktop 本地工具 | 工具只过滤敏感系统路径，没有强制所选工作区；清除工作区后最近目录仍可被运行时读取，符号链接还可能逃逸。 | Tool Registry 校验当前工作区；当前选择独立持久化；Tauri 命令解析真实路径并校验组件边界，搜索不跟随目录符号链接。 | TS workspace 13 tests；Rust workspace boundary/symlink test；Rust 5/5。 | 已修复 |
| EVIR-S-002 | P1   | Web 能力边界     | Web 设置仍暴露本地 MCP，造成能力承诺与 Runtime 不一致。                                                | 设置导航按 Capability 移除 MCP；E2E 断言 Web 不存在 MCP。                                                        | `core.spec.ts`，Web/Desktop E2E 9 pass、1 expected skip。               | 已修复 |
| EVIR-S-003 | P1   | 危险数据操作     | 多个删除/清理按钮直接执行，易误删 Provider、Skill、MCP、记忆或本地数据。                               | 统一 `ConfirmationDialog`，对删除、清理和解绑增加明确对象与后果。                                                | Confirmation/DataClearing 相关单测；TS 298/298。                        | 已修复 |
| EVIR-S-004 | P2   | Settings 无障碍  | 对话框缺少可靠首焦点、焦点循环、Escape 和关闭后焦点恢复。                                              | 增加键盘行为和 opener focus restore。                                                                            | a11y 4/4；Settings 单测。                                               | 已修复 |
| EVIR-S-005 | P2   | Light 主题       | 弱文本、时间戳和免责声明对比不足。                                                                     | 调深 muted token，移除降低可读性的 opacity。                                                                     | axe serious violations 0；Light 截图矩阵。                              | 已修复 |
| EVIR-S-006 | P2   | Workspace UI     | 工作区入口视觉权重过高并占据核心布局。                                                                 | 改为 composer 附近的紧凑中性上下文控件。                                                                         | Desktop 视觉基准与 24 张矩阵截图。                                      | 已修复 |
| EVIR-S-007 | P2   | Desktop 文案     | 原生 Desktop 无 Provider 时错误显示“浏览器聊天模式”。                                                  | 按 Runtime 使用 `desktopLocal` / `chatOnly` 文案。                                                               | E2E 双向断言；原生 Accessibility Tree 显示“本地桌面模式”。              | 已修复 |
| EVIR-S-008 | P2   | 测试隔离         | Vitest 默认收集 Playwright E2E 文件，导致单测入口失败。                                                | 增加独立 `vitest.config.ts`，只收集 `src` 单测。                                                                 | `pnpm test` 45 files / 298 tests pass。                                 | 已修复 |

## 复现与预期摘要

- EVIR-S-001：选择 `/tmp/project` 后请求 `/tmp/project-copy` 或工作区内指向外部的 symlink。预期拒绝；整改前仅敏感前缀会被拒绝。
- EVIR-S-002：以 Web Runtime 打开 Settings。预期没有 MCP；整改前导航与 Desktop 混用。
- EVIR-S-004：键盘打开 Settings，连续 Tab、Escape。预期焦点留在对话框、关闭后返回入口。
- EVIR-S-007：无 Provider 启动 Desktop。预期显示本地 Desktop 上下文，不应出现浏览器文案。

完整测试、截图与环境证据见 `docs/reviews/automated-quality-report.md`。
