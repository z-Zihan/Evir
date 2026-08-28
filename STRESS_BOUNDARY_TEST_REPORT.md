# Evir Stress and Boundary Test Report

## 自动化结果

`pnpm test:stress`：7 passed，1 skipped（Web 不适用的 Desktop 大导航）。

| 场景           | 规模/故障                               | 结果                                              |
| -------------- | --------------------------------------- | ------------------------------------------------- |
| 长对话         | 120 轮                                  | Web/Desktop 均完成压缩并继续交互                  |
| 异常 Streaming | malformed SSE                           | 安全失败，后续请求恢复                            |
| 快速重复操作   | 连续双触发发送                          | 仅产生一条用户消息和一条回复                      |
| Sidebar 压力   | 100 Projects / 500 Threads / 1000 Chats | Desktop 可搜索、响应正常                          |
| 极端消息       | 长 URL、代码、表格等                    | 无横向溢出                                        |
| Run ownership  | Stop/切会话/新 run                      | 旧流不污染当前会话状态                            |
| Shell 大输出   | stdout 超过 200 KB                      | 管道持续排空，保留输出有界且命令不被 SIGPIPE 误杀 |

## 边界结论

本轮未观察到死锁、重复发送、流归属串线、命令输出反压或错误后永久禁用 Composer。真实超长 Agent 外部 Provider 运行和系统资源长期 soak test 未执行。
