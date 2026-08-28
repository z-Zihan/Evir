# Evir Performance Report

数据来自 2026-08-27 本机 `pnpm benchmark` 与 production build。

| Metric                  |                              Result |        Budget | Status   |
| ----------------------- | ----------------------------------: | ------------: | -------- |
| Web initial JS gzip     |                           288.77 KB |        350 KB | PASS     |
| Web total assets        |                          2641.32 KB |             — | measured |
| Web total JS gzip       |                           426.40 KB |             — | measured |
| Desktop frontend total  |                          2744.00 KB |         15 MB | PASS     |
| Desktop initial JS gzip |                           301.08 KB |             — | measured |
| Current arm64 DMG       |                             6.34 MB | 120 MB target | PASS     |
| Main unit suite         | 647 tests / 6.78 s benchmark sample |             — | PASS     |
| Dependency count        |                 18 runtime / 23 dev |             — | measured |

`desktop.installers.status` 为 `stale-artifacts`：目录中同时存在旧 arm64 与 x64 DMG；本轮新生成的 `src-tauri/target/release/bundle/dmg/Evir_0.1.0_aarch64.dmg` 是 current artifact，且在体积预算内。该状态不等于当前包超预算。

构建仍提示单个 minified chunk 超过 500 KB；首屏 gzip 预算通过，故记录为后续优化项，不作为本轮阻塞缺陷。冷启动、长期内存/CPU、真实长任务能耗未取得可靠原生测量，不能由 bundle 指标替代。
