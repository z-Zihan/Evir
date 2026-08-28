> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# Evir Full QA Bug Report

## 汇总

| Severity    | Found | Fixed | Open |
| ----------- | ----: | ----: | ---: |
| P0 Critical |     0 |     0 |    0 |
| P1 High     |     5 |     5 |    0 |
| P2 Medium   |     4 |     4 |    0 |
| P3 Low      |     1 |     1 |    0 |

## 明细

| ID     | P   | 原始复现/问题                                                            | 修复                                                              | Regression                           | 状态  |
| ------ | --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------ | ----- |
| QA-001 | P2  | Project Composer 仍显示 Agent，与指定默认任务模型冲突                    | 移除 Agent 按钮；Plan/Goal 再次点击回默认任务                     | ModeSwitcher unit + Desktop E2E      | Fixed |
| QA-002 | P2  | Composer 常驻显示 token，增加主路径噪声                                  | 移除 Composer token，保留 Usage 统计                              | Usage E2E                            | Fixed |
| QA-003 | P1  | 无 Tool Calling 模型在 Project 中会被模式门禁阻断聊天                    | 有效模式安全降级为 Ask，不注册项目工具                            | conversation-mode unit + Desktop E2E | Fixed |
| QA-004 | P1  | Plan/Goal 中切到文本模型可能留下隐形 Ask 状态                            | Coordinator 切回默认 Project Task，按模型能力计算有效模式         | coordinator unit                     | Fixed |
| QA-005 | P2  | Diagnostics E2E 仍定位旧 `Export logs` 文案                              | 更新为当前 `Export JSON`                                          | Web/Desktop E2E                      | Fixed |
| QA-006 | P3  | 最终门禁发现 4 个文件不符合 Prettier                                     | 仅机械格式化目标文件                                              | `pnpm check`                         | Fixed |
| QA-007 | P1  | 子进程输出超过 200 KB 或读取被信号中断时可能提前关管道并误判成功命令失败 | 达到保留上限后继续排空；`Interrupted` 自动重试                    | Rust pipe regression 2/2             | Fixed |
| QA-008 | P2  | 自动验证把任意失败都伪造为 exit 1，timeout/cancelled 状态不可达          | 解析本地命令标准证据，保留真实 exit code/stdout/stderr 与终止状态 | `verification.test.ts` 6/6           | Fixed |
| QA-009 | P1  | Workspace/Full 权限会自动放行 L4 发布、凭据或不可逆操作                  | L4 无论权限档位都必须逐次显式审批                                 | permission matrix 10/10              | Fixed |
| QA-010 | P1  | 无 `approvalId` 的旧审批可能命中同 Tool Call 的新审批请求                | 审批 ID 严格相等；旧记录只可匹配旧记录                            | approval regression 8/8              | Fixed |

## 未作为产品 Bug 的执行事件

- 首次并行运行 visual/a11y 时端口 1420 冲突；隔离串行重跑后 visual 6/6、a11y 18/18。
- VS Code Host 出现系统 `EMFILE` watcher 告警，但扩展宿主启动、测试并以 0 退出；列为环境噪声。
- 应用名曾命中同 bundle id 的旧构建；退出旧实例并使用当前 release bundle 精确路径后，原生关键点击成功。
