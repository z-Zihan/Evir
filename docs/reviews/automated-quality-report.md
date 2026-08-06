# Evir 自动化质量报告

> 日期：2026-08-06
> 分支：`main`
> 基线 Commit：`5754ec91bb58f269d5fcab3248b707390cddb6b3`
> 系统：macOS 26.5.1 arm64
> Node / pnpm：24.18.0 / 10.0.0
> Rust：1.97.1

## 结果

| 类别                    |                      数量 | 通过 | 失败 | 结果                                    |
| ----------------------- | ------------------------: | ---: | ---: | --------------------------------------- |
| TypeScript 单元/集成    |                       298 |  298 |    0 | 通过                                    |
| Rust                    |                         5 |    5 |    0 | 通过                                    |
| Web/Desktop E2E         |                        10 |    9 |    0 | 通过；Web 多工具场景 1 个按能力边界跳过 |
| UI 矩阵                 | 2 suites / 48 screenshots |    2 |    0 | 通过                                    |
| 视觉基准                |                         6 |    6 |    0 | 通过                                    |
| 无障碍                  |                         4 |    4 |    0 | 通过，serious axe violations 0          |
| Web build               |                         1 |    1 |    0 | 通过                                    |
| Rust debug build        |                         1 |    1 |    0 | 通过                                    |
| Desktop release compile |                         1 |    1 |    0 | 二进制通过；签名打包失败                |

Format、ESLint、TypeScript strict、`git diff --check` 在最终门禁中执行。测试使用本地确定性 SSE Provider fixture，不需要或记录真实 API Key。

## 核心覆盖

- 首次进入、无 Provider 引导、Web/Desktop Capability 边界。
- 生产 Adapter 路径的 SSE 增量、Usage、停止后保留内容与继续发送。
- Provider 错误恢复、多工具 Agent Activity、单一审批面。
- Light/Dark、zh-CN/en、1440×900 至 720×800。
- 设置对话框键盘行为、焦点与颜色对比。
- 工作区同目录、同名前缀目录、未选择、符号链接及不存在目标路径边界。

## 性能

- Web JavaScript gzip：277,581 bytes（271.08 KB），低于 350 KB 预算。
- CSS gzip：21,830 bytes（21.32 KB）。
- `dist/`：1,034,652 bytes（1010.40 KB），5 files。
- Web build：Vite 1.57 s；端到端命令 wall time 3.79 s。
- 单测 benchmark：298 tests，3.63 s。
- 主 chunk：896.53 KB minified。动态/静态 i18n import 告警已消除；大 chunk 告警保留为已登记性能债，不通过提高阈值隐藏。

## Desktop

`cargo test`、`cargo build` 和 release binary 编译通过。预签名 macOS `.app` 已实际启动，验证默认 Agent、Ask 切换、本地桌面文案、设置导航与 Escape 关闭。打包在 codesign 阶段因 `no identity found` 失败；这是外部签名环境阻塞。

未验证：真实 Provider、原生工作区多工具修改任务、系统权限弹窗、签名安装与升级、Windows build/UI。Desktop Capability 的 Playwright 结果不作为这些项目的替代。

## 截图与产物

- UI 矩阵：`artifacts/playwright/screenshots/`
- Playwright 报告：`artifacts/playwright/report/index.html`
- 视觉基准：`e2e/snapshots/`
- 性能快照：`docs/benchmarks/latest.json`

## 进度重审

| 项目     | 完成度 | 依据                                                                     |
| -------- | -----: | ------------------------------------------------------------------------ |
| 阶段 0   |   100% | 工程门禁、Web build、Rust build、原生启动通过                            |
| 阶段 1   |    92% | 聊天/附件/Provider 管道已自动化；真实多 Provider 网络验收未重复          |
| 阶段 2   |    78% | Agent Loop、工具、审批、工作区边界已实现并测试；真实原生多工具任务未验收 |
| 阶段 S   |    90% | P0/P1/P2 整改与矩阵回归完成；真实网络/原生任务/签名包仍缺                |
| 产品体验 |    88% | 主流程、主题、语言、窄屏和原生基础交互已审查                             |

按阶段 0/1/2/S 权重 20%/30%/25%/25% 计算，整体加权完成度约 90%。这是当前已有范围的工程进度，不代表首发发布就绪。

硬门槛：自动化门禁通过；Web 预算通过；macOS 原生启动通过；签名包、Windows、真实付费 Provider 与原生真实 Agent 任务未通过验收。
