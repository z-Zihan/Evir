长任务（扩展版）：为 packages/cli 的 evir doctor 与 evir ask 两条子命令实现 --json 机器可读输出，并扩展 doctor 的检查体系与退出码契约。要求连续执行到底：每阶段结束只用一行标注进度（已完成/下一步）并立即开始下一阶段，不要在中途停下等待确认；只有全部阶段完成后才输出最终摘要：

阶段1 通读 packages/cli 全部源码（src/ 十个模块）与现有测试（test/ 四个文件），输出当前架构梳理：命令分发方式、参数解析层次、错误处理路径、doctor 现有检查项清单；

阶段2 设计输出 schema 并写入 packages/cli/README，新增小节标题固定为“## JSON 输出 schema”（整个任务只写这一次，续跑时不要重复添加该小节）。schema 必须覆盖：

- doctor --json：各检查项数组，每项 {id, status, details}，status ∈ ok|warn|fail；总体 {ok, summary}
- doctor 新增检查项：命令环境探测（node/pnpm/git/python3 是否可用；不可用记 warn 而不是 fail），复用/参考 workspace-boundary 与 config 检查的既有风格
- doctor --strict：任何 warn 视为 fail
- doctor 退出码契约：0=全部 ok（含 --strict），1=存在 fail，2=参数/用法错误
- ask --json：{answer, usage}，默认（无 --json）人类可读输出保持不变
- ask --json 在 provider 调用失败时输出 {error: {code, message}} 且退出码非 0
  （阶段2 只写 schema 设计，不动实现）；

阶段3 实现全部上述行为：flag 解析（--json/--strict 加到两条命令）、doctor 新检查项与退出码、ask 的 JSON 与错误路径；保持 TypeScript strict 与现有代码风格，不引入新依赖；

阶段4 为 packages/cli 补 vitest 测试：doctor --json（含新检查项的 ok/warn/fail 三态、--strict 升级、退出码）、ask --json（成功与 provider 失败路径）、默认人类可读输出不回归；测试用现有 fixture/注入风格，不发起真实网络请求；

阶段5 在 packages/cli 内运行 pnpm test 与 pnpm typecheck 确认全绿，失败则修复直到通过；

阶段6 输出最终变更摘要（文件清单+每文件改动要点）、schema 设计要点回顾与验证证据（测试命令与结果、测试数量）。

约束：只允许修改 packages/cli 内的文件；不引入新依赖（不得改动任何 package.json）；遵守仓库 TypeScript strict 与现有代码风格；不要修改 README 中除该小节外的其他内容。
