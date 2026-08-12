# Evir 可组合组件运行时

## 1. 目标

Evir 的长期方向是让工具、Harness Middleware、工作流、权限策略适配器和界面贡献可以在代码与配置层重新组合，使产品在不增加首次使用步骤的前提下，逐渐适配用户自己的工作方式。

第一阶段只建立可信内置组件运行时：

- 现有能力可以声明为组件并按目标宿主组装。
- 组件声明依赖与贡献，不自行控制全局启动顺序。
- 启用、禁用、配置或代码版本变化时，只重载受影响的依赖子图。
- 激活失败时恢复旧组件图，避免 Runtime 停在半更新状态。
- 组件的每个内部效果都进入幂等、LIFO 的恢复链。

这是一项内部架构能力，不增加 Provider 首次配置步骤，也不在主界面增加插件入口。

## 2. 产品方案决策

### 方案 A：可信内置组件运行时（当前实现）

组件随 Evir 构建发布，使用类型化 Manifest、配置解析器和受限 Activation Context。优点是启动轻、可测试、可回滚，并能继续依赖现有 Tool Registry 与 Tauri 权限边界。缺点是用户暂时不能安装任意代码插件。

### 方案 B：隔离的第三方组件宿主（后续候选）

第三方组件运行在独立进程、Web Worker、WASM 或受限 Sidecar 中，通过版本化 Bridge 提交工具、工作流和 UI 声明。隔离和兼容成本更高，只有在权限、签名、迁移和资源限制完成后才能开放。

### 方案 C：应用进程内加载任意 JavaScript（拒绝）

这种方式开发成本最低，但插件可直接访问 DOM、存储、网络和宿主对象，无法把 Manifest 权限声明变成真实安全边界，也难以可靠卸载。Evir 不采用该方案。

## 3. 核心模型

```text
Host Capability
  → Component Manifest
  → Dependency Resolution
  → Activation Context
  → Effect Scope
  → Tool / Middleware / Workflow / UI contribution
```

`ComponentManifest` 声明：

- `id` 与 `version`
- `kind`
- `targets`：Web 或 Desktop
- `provides`：组件提供的依赖键
- `requires`：激活前必须存在的依赖键
- `defaultEnabled`
- `trust`：第一阶段固定为 `builtin`

宿主能力以 `capability:<name>` 进入依赖图。组件不能覆盖宿主能力。当前内置工具组件为：

| 组件                    | 依赖                    | 贡献               |
| ----------------------- | ----------------------- | ------------------ |
| `evir.tools.filesystem` | `capability:filesystem` | `tools:filesystem` |
| `evir.tools.terminal`   | `capability:terminal`   | `tools:terminal`   |
| `evir.tools.git`        | `capability:git`        | `tools:git`        |

## 4. 生命周期与一致性

```text
registered → inactive → active → disposed
                     ↘ activation failed → previous graph restored
```

运行时对账步骤：

1. 根据目标宿主、默认值和配置计算期望组件。
2. 解析每个启用组件的配置。
3. 检查重复贡献，并让依赖尚未满足的组件保持 `inactive`。
4. 计算配置或定义发生变化的组件。
5. 沿依赖图扩展受影响集合。
6. 按反向激活顺序卸载受影响组件。
7. 按新的拓扑顺序激活组件。
8. 任一步失败时，清理新效果并恢复旧定义和旧配置。

`EffectScope` 将 Tool 注册、事件监听和其他清理函数包装为最多执行一次的 disposer。卸载按 LIFO 执行；一个 disposer 失败不阻止其余清理函数运行。

## 5. 配置契约

当前配置入口是类型化的 Runtime 配置，不读取任意插件目录：

```ts
createRuntime({
  componentConfiguration: {
    "evir.tools.terminal": { enabled: false },
  },
});
```

运行后也可通过 `componentRuntime.reconcile()` 重新对账。每个组件负责解析自己的配置；不可序列化或不符合 Schema 的配置在任何卸载发生前失败。

第一阶段不包含设置页、配置文件持久化、第三方下载、自动代码生成或生产环境 HMR。用户可见的组件管理必须等到状态、失败恢复、删除、版本迁移和多语言闭环完成后再进入设置。

## 6. 权限与安全边界

- Manifest 的 `requires` 是生命周期依赖，不是授权凭证。
- 组件只能通过 Activation Context 提交贡献。
- Tool 仍由 Tool Registry 按 Ask/Plan/Agent 和风险等级过滤。
- Tool Executor 仍检查 Runtime Capability、工作区和审批状态。
- Tauri/Rust 命令继续执行第二层工作区与系统权限校验。
- 组件不得修改 Security、Permission 或 Tool Policy 的高优先级规则。
- 第三方不可信代码未来必须隔离运行，不能只依靠依赖注入或 JavaScript Proxy。

## 7. 状态与失败行为

| 状态           | 含义                             | 当前行为                               |
| -------------- | -------------------------------- | -------------------------------------- |
| `inactive`     | 已注册、目标兼容，但依赖尚未满足 | 依赖出现后自动激活；依赖消失时自动卸载 |
| `active`       | 依赖满足且效果已提交             | 对外提供声明的贡献                     |
| `disabled`     | 配置明确关闭                     | 卸载自身及依赖它的组件                 |
| `incompatible` | 当前宿主不在 `targets`           | 不加载、不降级伪装                     |
| 激活失败       | 新定义或配置无法工作             | 回滚到上一组件图并抛出错误             |

## 8. 性能约束

- 不引入新运行时依赖和后台进程。
- 不在启动时扫描插件目录。
- 未受影响的组件不重载。
- Web 仍不注册 Desktop 本地工具。
- 后续 Sidecar、MCP 和大型 UI 贡献必须按需加载，不能因组件化改为启动时常驻。

## 9. 第一阶段验收标准

- Desktop 通过组件组装后提供与迁移前相同的本地工具集合。
- Web 运行时不注册任何 Desktop 本地工具。
- 单独禁用 Terminal 组件只移除 `run_command`，不影响文件和 Git 工具。
- 组件替换只重载它和传递依赖者，无关组件保持活动。
- 新组件激活失败后，旧组件和依赖者恢复活动。
- 卸载效果幂等并按 LIFO 执行。
- 依赖消失时自动卸载依赖者，依赖恢复时按拓扑顺序重新连接。
- 重复贡献等冲突在修改当前活动图之前被拒绝。

## 10. 后续阶段

1. 把 Harness Middleware 注册接入同一 Component Runtime。
2. 增加版本化配置 Repository、迁移和用户可见状态事件。
3. 定义声明式工作流和受限 UI Slot，不允许任意 DOM 注入。
4. 设计隔离 Bridge、签名、来源和资源配额后，再评估第三方组件。
5. 最后才增加设置页管理入口，并完成启用、禁用、失败、升级、删除和恢复闭环。
