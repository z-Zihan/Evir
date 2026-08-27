# README Refresh Report

> 2026-08-27 · 伴随 DOCUMENTATION_AUDIT_REPORT.md 的文档体系审计执行

## Main Problems Before

1. **产品模型过时**：README 仍描述 2026-08-27 重构前的模型（“Desktop 默认 Agent 可切换 Ask”“Plan 不是一级模式”“工作区入口在输入区附近”），而产品已是 Sidebar PROJECTS/CHATS + Composer Agent/Plan/Goal + 项目级权限。
2. **不实的“已实现”声明**：中英版都用现在时写“用户可在设置中导出诊断 ZIP”，实际只有 JSON 导出（该差距本轮以实现功能方式解决，而非改文案）。
3. **MCP 状态过时**：写“MCP 连接、发现与运行时调用仍在开发中”，实际 Runtime 已实现。
4. **内部周报感**：第一屏含“阶段 S：稳定性与体验整改”等内部阶段术语、开发计划链接、完整命令清单与发布细节，对 GitHub 访客价值低。
5. **中英不一致**：英文版把“Optional system notifications”列在"Complete everyday foundations"下，中文版如实写“尚未提供”。
6. 无产品截图，只有 hero SVG。

## Accuracy Changes

| 声明     | 之前                                       | 现在                                                                                                 |
| -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 模式模型 | Desktop 默认 Agent 可切 Ask；Plan 内部阶段 | 项目线程 Agent/Plan/Goal 一等模式；Standalone/Chat 恒 Ask                                            |
| 工作区   | 输入区附近选择                             | 来自 Sidebar Project（无选择器）                                                                     |
| 权限     | 未提及档位                                 | ask/workspace/full + 额外授权目录（配真实截图）                                                      |
| MCP      | “仍在开发中”                               | 已实现（stdio + Streamable HTTP），缺口如实列出                                                      |
| 诊断 ZIP | 现在时“可导出”（不实）                     | **功能已实现**（本轮补齐），文案如实描述预览/脱敏/手动发送                                           |
| 通知     | en 列为已有基础能力                        | 明确尚未开放（两语言一致）                                                                           |
| 性能数字 | 目标与达成混列                             | 明确标注“当前”数字来自最近基准（320.38 KiB / 2.94 MiB），其余为目标                                  |
| 当前状态 | “阶段 S”术语                               | 直接列已验收项（636+25 测试、GLM 实机、macOS 原生任务）与未验收项（Windows、正式性能测量、发布渠道） |
| 协议覆盖 | “计划内置…” 后接长清单（易读成已支持）     | 明确“已实现 7 种适配器”+ 自定义端点；矩阵链接保留                                                    |

## Structure Changes

新结构：Hero SVG → 一句定位 + hero 大图 → “在真实项目里工作”（Project/Thread/Mode/Permission 主流程 + Agent/Plan/Goal）→ 权限截图段 → BYOM（Provider 截图）→ 四端能力表（新增，替代四段重复描述）→ Web 截图 → 本地优先与可诊断 → 性能预算（压缩）→ 当前状态（压缩）→ 本地开发（命令精简）→ 文档（按用途分组、去重）→ License。

## Content Removed

- “产品速览”表（信息并入正文）、“为什么是 Evir”8 条长列表（压缩进各节）。
- 内部阶段术语（阶段 S）、完整的打包/发布说明（移至 docs/03 链接）、Repository SSH 地址段。
- 重复的 Ask/Plan/Agent、个性化、Skill/MCP 长段落（能力表 + 专项段替代）。
- 文档导航中的 Coding Agent Prompt 历史链接（AGENTS.md 是当前入口）。

## Content Added

- 4 张真实产品截图（见下）。
- 四端能力矩阵、权限档位说明、诊断 ZIP 描述、截图再生成命令。
- 文档导航新增入口：当前信息架构设计（project-chat-agent-redesign）、测试用例 docs/23、MCP 实现状态 docs/22。

## Product Claims Verified

| 声明                  | 证据                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 13 个内置工具         | `src/core/tools/builtin/local-file-tools.ts`（LOCAL_FILE_TOOLS）                         |
| 7 种协议适配器        | `src/core/providers/adapter-registry.ts`                                                 |
| 约 30 家预设          | `provider-presets.ts`                                                                    |
| 36/10 Skill           | `skill-registry.ts` shared/desktop manifests                                             |
| MCP stdio+HTTP        | `src/core/mcp/transports.ts`、`mcp_stdio*.rs`、32 个测试                                 |
| 权限三档              | `permission-profiles.ts`、`ProjectPermissionPanel.tsx`                                   |
| 诊断 ZIP              | 本轮实现：`diagnostics.rs` + `diagnostics-export.ts` + DiagnosticsSettings；Rust/TS 测试 |
| 636 TS + 25 Rust 测试 | 本轮 `pnpm test` / `cargo test` 实际输出                                                 |
| GLM 实机验收          | 项目记忆 Update Log 2026-08-26/27、ADVANCED_AGENT_REGRESSION_REPORT                      |
| 性能“当前”数字        | `docs/benchmarks/latest.json`（2026-08-27）                                              |
| 截图为真实 UI         | `scripts/capture-readme-screenshots.mjs` 对本地 dev server 确定性种子生成                |

## Screenshot Design / Files

| 文件                                   | 内容                                                                                                                                            | 生成方式                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `assets/readme/desktop-overview.png`   | Hero：侧栏 PROJECTS（Evir/Chorus + 任务）与 CHATS、项目线程内 Agent 执行时间线（读/搜/patch/测试/git diff 含耗时）、Composer 模式/权限/模型控件 | 桌面模式 dev server + 种子数据 |
| `assets/readme/project-permission.png` | 项目权限弹窗：三档 radio（Ask for Approval 选中）+ 说明                                                                                         | 同上                           |
| `assets/readme/provider-settings.png`  | 设置 → Providers：多家厂商/模型/能力标记，无任何密钥                                                                                            | 同上                           |
| `assets/readme/web-chat.png`           | Web 端聊天：Markdown 表格 + 代码块                                                                                                              | Web 模式 dev server + 种子数据 |

统一规格：1600×1000 视口（2x 输出 3200×2000）、Light 主题、英文 UI、真实但虚构的演示数据（项目名 Evir/Chorus、自然任务标题）、无 API Key、无测试占位串、无隐私路径（/Users/demo/…）。全部由 `node scripts/capture-readme-screenshots.mjs` 可重复生成。

## Chinese / English Consistency

README.md 与 README.en.md 结构、截图、能力矩阵、状态声明逐节对应；英文为自然表达非逐字直译。两版对通知、性能目标、未验收项的措辞一致。

## Remaining Limitations

1. 截图使用浏览器 Desktop Runtime（与 Tauri 原生窗口同一前端代码）；原生窗口截图可在发布前补充。
2. “Goal 模式”无独立截图（任务工作台状态依赖编排运行期数据，静态种子较难真实呈现；文字描述已如实）。
3. 安装包、冷启动等性能目标仍未正式测量，README 保持“目标”措辞。
4. VS Code / CLI 无截图（两端发布验收未完成，避免以截图暗示发布就绪）。
