> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# Evir Performance Report

数据来自 2026-08-28 本机 `pnpm benchmark` 与 production build。

| Metric                  |                               Result |        Budget | Status   |
| ----------------------- | -----------------------------------: | ------------: | -------- |
| Web initial JS gzip     |                            290.27 KB |        350 KB | PASS     |
| Web total assets        |                           2644.93 KB |             — | measured |
| Web total JS gzip       |                            427.97 KB |             — | measured |
| Desktop frontend total  |                           2747.68 KB |         15 MB | PASS     |
| Desktop initial JS gzip |                            302.59 KB |             — | measured |
| Current arm64 DMG       |                             6.46 MiB | 120 MB target | PASS     |
| Main unit suite         | 675 tests / 17.19 s benchmark sample |             — | PASS     |
| Dependency count        |                  18 runtime / 23 dev |             — | measured |

`desktop.installers.status` 为 `stale-artifacts`：目录中同时存在旧 arm64 与 x64 DMG；本轮新生成的 `src-tauri/target/release/bundle/dmg/Evir_0.1.0_aarch64.dmg` 是 current artifact，且在体积预算内。该状态不等于当前包超预算。

构建仍提示单个 minified chunk 超过 500 KB；首屏 gzip 预算通过，故记录为后续优化项，不作为本轮阻塞缺陷。冷启动、长期内存/CPU、真实长任务能耗未取得可靠原生测量，不能由 bundle 指标替代。
