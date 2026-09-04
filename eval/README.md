# Agent Eval — Golden Tasks

Agent 质量不再只靠单测数量证明（§42）。这套评测把 **真实的 agent 执行栈**（工具、权限策略、工作区隔离、快照、验证记录、agent loop）跑在一个冻结的 fixture 仓库上，只有模型层是脚本化的——所以它测的是 Evir 自己的行为质量，并且在 CI 里可重复。

## 运行

```bash
pnpm test:agent-eval
```

- 结果写入 `eval/results/latest.json`（gitignored），含 Evir 版本、commit、任务明细与全部指标。
- 控制台单独输出 PASS/FAIL 表（§80），不埋在单测数字里。

## 任务（§44 的 20 个）

| #   | 任务                           | 类别              |
| --- | ------------------------------ | ----------------- |
| 01  | 修一个失败测试                 | fix + verify      |
| 02  | 给已有 API 增加 validation     | feature + test    |
| 03  | 跨 3 文件 rename symbol        | refactor          |
| 04  | 修类型/契约错误                | fix               |
| 05  | 修 UI 字符串 bug               | fix               |
| 06  | 修 async race                  | fix               |
| 07  | 拒绝修改 workspace 外文件      | scope safety      |
| 08  | 修改后正确运行 targeted tests  | verify            |
| 09  | 命令失败后诊断并恢复           | recovery          |
| 10  | 修改后测试失败，继续修到通过   | persistence       |
| 11  | 不必要时不得修改文件           | restraint         |
| 12  | 用户只要求分析时不得写入       | restraint         |
| 13  | 长任务中需要 approval          | permission        |
| 14  | 重构但行为必须保持             | refactor + verify |
| 15  | dependency / package bug       | fix               |
| 16  | dirty workspace 不覆盖用户修改 | safety            |
| 17  | 大量上下文后仍保持任务要求     | context           |
| 18  | tool call 失败后恢复           | recovery          |
| 19  | Stop 后不得继续写文件          | stop safety       |
| 20  | 完成声明必须有证据             | verification      |

每个任务定义在 `agent-eval/tasks.ts`：固定 prompt、固定 fixture seed（committed → SHA 冻结）、固定脚本化模型行为、显式 success/failure criteria。

## 指标（§45）

`latest.json` 每任务记录：taskSuccess / testsPass / buildPass（node --check）/ unauthorizedOperations（**执行了**的越权操作；被拒绝的尝试是策略在工作，不计违规）/ outOfScopeChanges / unnecessaryFilesChanged / diff 大小 / userInterventions（脚本层为 0）/ approvalCount / toolFailures / retries / durationMs / recoverySuccess / completionEvidence。

汇总：成功率、平均工具错误、平均时长、unauthorized 总数（必须为 0）、outOfScope 总数（必须为 0）。

## 结果可比性（§46）

每次运行记录 model/provider/tier/evir version/commit。Harness、context、compression、skill、loop、verification 的任何改动都应对照 `eval/results/latest.json` 前后对比。

## 已抓到的真实 bug

- **workspace 档相对路径写入被误判越权**（task 01 首跑暴露）：`tool-executor` 的权限边界检查未把相对路径解析到 workspace root 再判定，导致 workspace profile 下 `apply_patch src/x.js` 仍要求审批。已修复（`src/core/tools/tool-executor.ts` 的 `resolveCandidatePath`）。

## 真实 Provider 档（real-model tier）

本仓库当前只包含确定性档。真实 provider 档协议：

1. 同样的 20 个 prompt + fixture + criteria，模型响应来自真实 provider（OpenAI-compatible / Anthropic / Gemini / GLM）而非脚本。
2. Runner 记录 Model / Provider / Evir Version / Commit / Metrics 到 `eval/results/real-<date>.json`。
3. 没有合法可用的 API 配额时，结果必须标 **NOT RUN**——禁止假 PASS（§50）。
4. Provider 成熟度分级以此为准：跑过 Golden Agent Tasks 的才可标 **Agent Verified**（§48）。

**当前状态：real-model tier = NOT RUN（本轮未消耗真实配额）。**
