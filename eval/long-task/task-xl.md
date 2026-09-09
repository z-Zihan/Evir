超长任务（四命令版）：为 packages/cli 的全部子命令实现统一的机器可读输出与退出码契约，并扩展 doctor 为完整环境体检。要求分阶段执行，每阶段结束输出进度（已完成/下一步）：

阶段1 通读 packages/cli 全部源码（src/ 各模块）与现有测试（test/），输出架构梳理：命令分发、参数解析层次、错误处理路径、每条子命令的现有输出方式与退出码；

阶段2 设计统一输出契约并写入 packages/cli/README，新增小节标题固定为“## JSON 输出 schema”（整个任务只写这一次，续跑时不要重复添加该小节）。契约必须覆盖：

- 四条子命令（doctor、ask 以及你在阶段1 找到的其余全部子命令）都支持 --json
- doctor --json：检查项数组 {id, status(ok|warn|fail), details} + 总体 {ok, summary}
- doctor 新增“命令环境体检”检查组：探测 node/npm/git/python3 是否可用（不可用记 warn），每项 details 含探测路径或缺失说明
- doctor --strict：warn 视为 fail；退出码契约：0=全 ok（含 --strict），1=有 fail，2=用法错误
- ask --json：{answer, usage}；provider 失败输出 {error:{code,message}} 且退出码非 0
- 其他子命令 --json 的输出对象设计（各至少 3 个字段，说明语义）
  （阶段2 只写 schema，不动实现）；

阶段3 实现：统一 flag 解析（--json/--strict）、doctor 环境体检检查组与退出码、ask 的 JSON 与错误路径、其余子命令的 --json 输出；TypeScript strict、不引入新依赖；

阶段4 测试矩阵：doctor（--json 三态 + 环境检查组 mock 注入 + --strict + 三个退出码）、ask（成功与 provider 失败）、其余每条子命令 --json 与默认输出各至少一条；不发起真实网络请求；

阶段5 在 packages/cli 内运行 pnpm test 与 pnpm typecheck 直到全绿；

阶段6 输出最终变更摘要（文件清单+每文件要点）、四命令契约一览表与验证证据（测试命令、数量与结果）。

约束：只允许修改 packages/cli 内的文件；不引入新依赖（不得改动任何 package.json）；遵守仓库 TypeScript strict 与现有代码风格；不要修改 README 中除该小节外的其他内容。
