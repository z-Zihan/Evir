# Evir Full QA Bug Report

## 汇总

| Severity    | Found | Fixed | Open |
| ----------- | ----: | ----: | ---: |
| P0 Critical |     0 |     0 |    0 |
| P1 High     |     2 |     2 |    0 |
| P2 Medium   |     3 |     3 |    0 |
| P3 Low      |     1 |     1 |    0 |

## 明细

| ID     | P   | 原始复现/问题                                         | 修复                                                      | Regression                           | 状态  |
| ------ | --- | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ | ----- |
| QA-001 | P2  | Project Composer 仍显示 Agent，与指定默认任务模型冲突 | 移除 Agent 按钮；Plan/Goal 再次点击回默认任务             | ModeSwitcher unit + Desktop E2E      | Fixed |
| QA-002 | P2  | Composer 常驻显示 token，增加主路径噪声               | 移除 Composer token，保留 Usage 统计                      | Usage E2E                            | Fixed |
| QA-003 | P1  | 无 Tool Calling 模型在 Project 中会被模式门禁阻断聊天 | 有效模式安全降级为 Ask，不注册项目工具                    | conversation-mode unit + Desktop E2E | Fixed |
| QA-004 | P1  | Plan/Goal 中切到文本模型可能留下隐形 Ask 状态         | Coordinator 切回默认 Project Task，按模型能力计算有效模式 | coordinator unit                     | Fixed |
| QA-005 | P2  | Diagnostics E2E 仍定位旧 `Export logs` 文案           | 更新为当前 `Export JSON`                                  | Web/Desktop E2E                      | Fixed |
| QA-006 | P3  | 最终门禁发现 4 个文件不符合 Prettier                  | 仅机械格式化目标文件                                      | `pnpm check`                         | Fixed |

## 未作为产品 Bug 的执行事件

- 首次并行运行 visual/a11y 时端口 1420 冲突；隔离串行重跑后 visual 6/6、a11y 18/18。
- VS Code Host 出现系统 `EMFILE` watcher 告警，但扩展宿主启动、测试并以 0 退出；列为环境噪声。
- 原生 AX 返回 `AXError.cannotComplete`；列为测试环境 BLOCKED，未虚报为产品通过。
