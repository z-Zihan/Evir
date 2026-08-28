# Evir Full Product Test Matrix

- 执行日期：2026-08-27
- 环境：macOS 26.5.1 arm64，Node 24.18.0，pnpm 10.0.0，Rust 1.97.1
- 口径：`PASS` 仅表示本轮有自动化、构建、打包或宿主启动证据；fixture、浏览器 Desktop 页面与原生宿主分别记录，不互相替代。

| Platform             | Page / Surface      | Feature                        | State                               | User Action              | Expected Result                        | Test Type     | Automated | Result  | Evidence                                      | Bug ID |
| -------------------- | ------------------- | ------------------------------ | ----------------------------------- | ------------------------ | -------------------------------------- | ------------- | --------- | ------- | --------------------------------------------- | ------ |
| Web                  | First run           | 无 Provider 空态               | clean storage                       | 启动                     | 可进入配置入口，无本地工具             | E2E           | Yes       | PASS    | `core.spec.ts` first run                      | —      |
| Web                  | Chat                | Fixture 流式聊天               | provider ready                      | 发送消息                 | 流式回复且可继续输入                   | E2E           | Yes       | PASS    | `test:e2e`                                    | —      |
| Web                  | Chat                | Stop                           | streaming                           | 点击 Stop                | 中止且会话仍可用                       | E2E           | Yes       | PASS    | `core.spec.ts` stop                           | —      |
| Web                  | Chat                | 跨会话流归属                   | streaming                           | 切换会话                 | 回复留在原会话                         | E2E           | Yes       | PASS    | `core.spec.ts` ownership                      | —      |
| Web                  | Chat                | Provider 错误恢复              | injected error                      | 发送并重试               | 错误可见且页面不崩溃                   | E2E           | Yes       | PASS    | `core.spec.ts` provider errors                | —      |
| Web                  | Chat                | 超长消息布局                   | extreme content                     | 渲染消息                 | 无横向溢出                             | E2E/UI        | Yes       | PASS    | `core.spec.ts` extreme content                | —      |
| Web                  | Settings            | Provider 持久化                | edited provider                     | 保存并刷新               | 配置保留                               | E2E           | Yes       | PASS    | `core.spec.ts` provider persistence           | —      |
| Web                  | Settings / Usage    | Token 统计                     | seeded usage                        | 打开 Usage               | 显示 42 tokens，Composer 不显示 token  | E2E           | Yes       | PASS    | `core.spec.ts` Usage                          | QA-002 |
| Web                  | Settings            | 全页面可访问性                 | all routes                          | 键盘访问/axe             | 无 serious axe violation               | A11y          | Yes       | PASS    | `test:a11y` 9/9 Web                           | —      |
| Desktop frontend     | First run           | Runtime 能力边界               | clean storage                       | 启动                     | Desktop 能力按 capability 暴露         | E2E           | Yes       | PASS    | `core.spec.ts` first run                      | —      |
| Desktop frontend     | Sidebar             | Project/Thread/Chat CRUD       | populated                           | rename/pin/delete/reload | 状态持久化                             | E2E           | Yes       | PASS    | `core.spec.ts` conversation loop              | —      |
| Desktop frontend     | Project Composer    | 默认 Project Task              | tool model                          | 查看 Composer            | 无 Agent 选择器，默认可用工具          | E2E/unit      | Yes       | PASS    | `ModeSwitcher` tests + `core.spec.ts`         | QA-001 |
| Desktop frontend     | Project Composer    | 文本模型降级                   | no tool calling                     | 发送普通问题             | 可聊天、不暴露项目工具、Plan/Goal 隐藏 | E2E/unit      | Yes       | PASS    | `core.spec.ts` text-only model                | QA-003 |
| Desktop frontend     | Project Composer    | 模型切换降级                   | Plan/Goal active                    | 切换文本模型             | 回到默认任务，实际以 Ask 语义执行      | Unit/E2E      | Yes       | PASS    | coordinator + conversation-mode tests         | QA-004 |
| Desktop frontend     | Project Composer    | Plan 切换                      | tool model                          | 点 Plan/再次点击         | 进入 Plan/回到默认任务                 | Unit/E2E      | Yes       | PASS    | `ModeSwitcher` + capability E2E               | —      |
| Desktop frontend     | Project Composer    | Goal 切换                      | tool model                          | 点 Goal/再次点击         | 进入 Goal/回到默认任务                 | Unit/E2E      | Yes       | PASS    | `ModeSwitcher` + capability E2E               | —      |
| Desktop frontend     | Agent Workbench     | 多 Tool 活动                   | dense fixture                       | 展开活动                 | 分组清晰且窄屏不溢出                   | E2E           | Yes       | PASS    | `core.spec.ts` Agent activity                 | —      |
| Desktop frontend     | Approval            | 单一审批面                     | multiple tools                      | 查看审批                 | 只出现一个聚合审批面                   | E2E           | Yes       | PASS    | `core.spec.ts` approval                       | —      |
| Desktop frontend     | Agent               | Stop 状态                      | active run                          | Stop                     | 稳定显示 cancelled，不声称完成         | E2E/unit      | Yes       | PASS    | `core.spec.ts` cancelled run                  | —      |
| Desktop frontend     | Agent               | 恢复证据                       | persisted run                       | 刷新会话                 | 完成证据恢复                           | E2E           | Yes       | PASS    | `core.spec.ts` persisted run                  | —      |
| Desktop frontend     | Diagnostics         | 脱敏与 JSON 导出               | failed connection                   | 导出                     | 下载脱敏 JSON                          | E2E           | Yes       | PASS    | `core.spec.ts` diagnostics                    | QA-005 |
| Web/Desktop frontend | Conversation        | 120 轮上下文                   | 120 seeded turns                    | 继续发送                 | 压缩后仍可交互                         | Stress        | Yes       | PASS    | `test:stress` 2 platforms                     | —      |
| Web/Desktop frontend | Streaming           | malformed stream               | invalid SSE                         | 发送后再发送             | 安全失败且下一请求恢复                 | Stress        | Yes       | PASS    | `test:stress`                                 | —      |
| Web/Desktop frontend | Composer            | 快速双击发送                   | ready                               | 连续触发两次             | 仅一条用户消息和一条回复               | Stress        | Yes       | PASS    | `test:stress`                                 | —      |
| Desktop frontend     | Sidebar             | 大数据导航                     | 100 Projects/500 Threads/1000 Chats | 搜索导航                 | 可搜索、可交互、无溢出                 | Stress        | Yes       | PASS    | `test:stress` desktop                         | —      |
| Web/Desktop frontend | Responsive UI       | zh/en, light/dark, 720–1280 px | matrix                              | 截图                     | 布局完整，无明显横向溢出               | UI matrix     | Yes       | PASS    | `test:ui` 2/2，366 screenshots                | —      |
| Web/Desktop frontend | Visual baselines    | empty/chat/settings            | render                              | 截图比对                 | 无意外漂移                             | Visual        | Yes       | PASS    | `test:visual` 6/6                             | —      |
| Web/Desktop frontend | Accessibility       | dialogs/settings/chat          | keyboard/axe                        | 操作与扫描               | 焦点正确，无 serious violation         | A11y          | Yes       | PASS    | `test:a11y` 18/18                             | —      |
| Core                 | Quality gate        | format/lint/type/tests         | current diff                        | `pnpm check`             | 全部通过                               | Static/unit   | Yes       | PASS    | 647 + VS Code 8 + CLI 8                       | QA-006 |
| Core                 | Context/stream/race | ownership/error/finally        | edge cases                          | 单元与 E2E               | 不串流、不锁死、可恢复                 | Unit/E2E      | Yes       | PASS    | 105 test files + stress                       | —      |
| Web                  | Production build    | release assets                 | production                          | `pnpm build:web`         | 构建成功                               | Build         | Yes       | PASS    | Vite 2229 modules                             | —      |
| Desktop              | Production build    | arm64 app/DMG                  | release                             | `pnpm build:desktop`     | 生成 app 与 DMG                        | Build/package | Yes       | PASS    | 6.34 MB current DMG                           | —      |
| VS Code              | Extension           | check/build/host               | extension dev host                  | 测试与构建               | 8 tests、bundle、宿主退出 0            | Test/build    | Yes       | PASS    | 381.9 KB bundle; host exit 0                  | —      |
| CLI                  | CLI                 | check/build/package/smoke      | local package                       | 执行                     | 8 tests、bundle、tarball/smoke 成功    | Test/build    | Yes       | PASS    | 357.0 KB bundle                               | —      |
| Tauri/Rust           | Backend             | fmt/clippy/test                | all targets/features                | 执行门禁                 | 无 warning，测试通过                   | Static/unit   | Yes       | PASS    | Rust 31/31                                    | —      |
| Native macOS         | Release app         | 原生关键点击链路               | app running                         | AX 读取与交互            | 可定位控件并操作                       | Native UI     | Attempted | NOT RUN | `AXError.cannotComplete`; bundle id duplicate | —      |
| Desktop Windows      | Installer/runtime   | Windows x64                    | no Windows host                     | 构建并安装               | 原生安装与主链路通过                   | Native        | No        | NOT RUN | 当前仅 macOS arm64                            | —      |
| Desktop macOS Intel  | Installer/runtime   | x64 artifact                   | no Intel host                       | 安装并运行               | Intel 原生主链路通过                   | Native        | No        | NOT RUN | 仅有旧 x64 产物，无实机                       | —      |
| Desktop              | External Provider   | 实网 Agent                     | no credentials in scope             | 真实多轮任务             | Provider API 与工具闭环                | External      | No        | NOT RUN | 本轮仅 deterministic fixture                  | —      |
| Desktop              | External MCP        | stdio/HTTP server              | no external server                  | 连接与调用               | 外部服务闭环                           | External      | No        | NOT RUN | 仅本地集成/单测                               | —      |
| VS Code/CLI          | Distribution        | Marketplace/npm                | no publisher auth                   | 发布安装                 | 商店/registry 安装成功                 | Release       | No        | NOT RUN | 需要外部账号与发布权限                        | —      |
| macOS                | Release trust       | Developer ID/notarization      | credentials absent                  | 签名公证安装             | Gatekeeper 信任                        | Release       | No        | NOT RUN | 当前 ad-hoc `-` 签名，未公证                  | —      |
| macOS                | Accessibility       | VoiceOver 实机走查             | no manual session                   | 屏幕阅读器全流程         | 可理解、可操作                         | Manual a11y   | No        | NOT RUN | axe/键盘不能替代 VoiceOver                    | —      |

## 汇总

```text
Pages / Surfaces: 12
Features: 43
Tested: 35
Passed: 35
Failed: 0
NOT RUN: 8
```
