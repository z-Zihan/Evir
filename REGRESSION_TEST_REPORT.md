# 回归测试报告（代码质量优化轮）

## Environment

- macOS 26.5.1（darwin 25.5.0，arm64）
- Node v24.18.0 / pnpm 10.0.0
- rustc 1.97.1 / cargo 1.97.1
- 分支 main（工作区含本轮优化前已存在的未提交改动 —— 系当天早些轮次的诊断 ZIP / README 等工作，非本轮产物，未触碰回退）

## Baseline（修改前）

| 检查                                      | 结果                        |
| ----------------------------------------- | --------------------------- |
| pnpm format:check                         | PASS                        |
| pnpm lint（--max-warnings 0）             | PASS                        |
| pnpm typecheck                            | PASS                        |
| pnpm test（主应用 vitest）                | PASS —— 103 文件 / 636 用例 |
| extensions/vscode check（typecheck+test） | PASS —— 8 用例              |
| packages/cli check（typecheck+test）      | PASS —— 8 用例              |
| pnpm release:validate-workflow            | PASS                        |
| cargo fmt --check                         | PASS                        |
| cargo clippy --all-targets                | PASS（0 警告）              |
| cargo test                                | PASS —— 25 用例             |

## Final（修改后）

| 检查                           | 结果                                 | 明细                                                                                         |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| pnpm format:check              | **PASS**                             |                                                                                              |
| pnpm lint                      | **PASS**                             | 修复过程中 3 个临时 lint 错误（未用导入/多余断言）当场清理                                   |
| pnpm typecheck                 | **PASS**                             | 0 错误                                                                                       |
| pnpm test                      | **PASS**                             | **105 文件 / 643 用例**（+2 文件 +7 用例，全部新增回归测试）                                 |
| extensions/vscode check        | **PASS**                             | 8 用例                                                                                       |
| packages/cli check             | **PASS**                             | 8 用例                                                                                       |
| pnpm release:validate-workflow | **PASS**                             | 随 `pnpm check` 全链执行                                                                     |
| cargo fmt --check              | **PASS**                             |                                                                                              |
| cargo clippy --all-targets     | **PASS**                             | 0 警告                                                                                       |
| cargo test                     | **PASS**                             | **31 用例**（+6：组件 id 穿越、UTF-8 截断、管道上限、home 阻断、快照负载包含、陈旧响应排空） |
| pnpm benchmark                 | **PASS**                             | 产物写入 docs/benchmarks/latest.json；依赖计数不变（未新增任何依赖）                         |
| pnpm test:ui（UI 矩阵）        | **PASS**                             | 2/2                                                                                          |
| pnpm test:a11y                 | **PASS**                             | 18/18                                                                                        |
| pnpm test:visual               | **PASS**                             | 6/6（无快照漂移）                                                                            |
| pnpm test:e2e（核心链路）      | **PASS 33 + 2 预存失败 + 9 skipped** | 见下                                                                                         |

## Pre-existing Failure（修改前即失败，非本轮回归）

`e2e/core.spec.ts:398 "failed provider connection is visible in redacted diagnostic logs"`（web-e2e 与 desktop-e2e 各 1 失败）。

**证据**：将全部工作区改动（本轮 + 早前轮次）`git stash` 后在纯 HEAD 上单跑该测试**同样失败**（同样的 "Export logs" 按钮定位超时），`git stash pop` 恢复后复跑仍稳定失败。该测试与工作区中尚未提交的诊断导出新 UI（DiagnosticsSettings bundle 导出流程）适配不完整，属当天诊断轮的遗留待办，与本次优化 diff 无关。其余 33 个核心 e2e 全绿。

## Commands（实际执行）

```
pnpm check                 # format:check + lint + typecheck + test + release:validate-workflow + vscode + cli
pnpm format                # 提交前统一格式化（项目自身 Prettier）
pnpm test / pnpm vitest run <file>   # 批次内定向验证
pnpm benchmark
pnpm test:e2e / test:ui / test:a11y / test:visual
pnpm exec playwright test --project=web-e2e --project=desktop-e2e -g "failed provider connection" e2e/core.spec.ts
git stash push -u / git stash pop     # 仅用于预存失败判定，工作区已完整恢复（51 项改动齐全）
cd src-tauri && cargo fmt --check && cargo clippy --all-targets && cargo test
```

## Not Run / 环境限制说明

| 项                                      | 原因与风险                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build:desktop`（tauri build 完整打包） | 全量门禁已含 tsc -b + vite build 前置类型/打包检查与 cargo clippy/test；打包链未动（仅 lib 代码修改），风险低。                                  |
| `build:vscode` / `package:vscode`       | vscode check（typecheck+test）已跑；打包配置未改动。                                                                                             |
| 桌面真机 GUI 手工回归                   | 本轮为代码质量轮；建议按 docs/23 §4.13 流程对 Agent 发送/停止/审批链路做一次真机冒烟（本轮恰修复了主线程阻塞与停止竞态，真机可感知验证收益高）。 |
| `release:validate-tag`                  | 需要具体发布 tag 上下文，属发布流程项，与代码无关。                                                                                              |

## 过程中的失败与处理（如实记录）

1. Batch 4 期间引入 `runStreamResponse` 拆分时丢失 `provider` 作用域 → 10 个 chat-store 测试失败 → 当场定位（新 catch 暴露 ReferenceError）并以参数传入修复 → 全绿。该失败从未离开本地。
2. 我新增的 Rust 测试 2 处初版断言/契约错误（截断计数、id-mismatch 旧契约）→ 修正后通过；其中旧契约测试按新语义重写并保留更强断言（响应不跨请求归属）。
3. e2e 2 失败经 stash 判定为预存（见上）。

## 结论

除 1 项预存 e2e 失败（与本次无关，已单列）外，**所有静态检查、单元/集成测试、Rust 三件套、benchmark、UI/a11y/visual/核心 e2e 全部通过**。本轮未新增任何依赖，未改任何公共接口、存储格式、事件与命令名。
