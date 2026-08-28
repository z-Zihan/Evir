# Evir UI / UX Audit Report

## 结果

UI 矩阵 2/2、视觉基线 6/6、axe/键盘测试 18/18 通过；生成并抽查 366 张 Web/Desktop、zh/en、light/dark、720–1280 px 截图，未见明显横向溢出或状态遮挡。

| 项目       | 结论                                              | 证据                            |
| ---------- | ------------------------------------------------- | ------------------------------- |
| Border     | PASS；控件边界与层级一致                          | UI matrix / visual              |
| Scrollbar  | PASS；窄屏与长内容未出现明显双滚动/横向溢出       | UI matrix / extreme-content E2E |
| Hover      | PASS；交互元素保持可识别状态                      | UI matrix                       |
| Focus      | PASS；设置、嵌套 Dialog、快捷键、模型列表焦点闭环 | a11y 18/18                      |
| Layout     | PASS；720–1280 px 与高密度 Agent Activity 可用    | UI matrix / core E2E            |
| Light/Dark | PASS                                              | UI matrix + visual              |
| zh/en      | PASS                                              | UI matrix                       |
| Narrow     | PASS；侧栏、Composer、Agent Activity 未溢出       | UI matrix / core E2E            |

## 本轮 UX 修正

- Composer 移除显式 Agent 选择器；Project Task 默认根据任务决定是否调用工具。
- Plan/Goal 保留为可进入、再次点击可退出的显式特殊模式。
- 文本模型在 Project 中仍可聊天，但不开放项目工具，并提供换模型提示。
- Composer 移除常驻 Token；Usage 设置继续提供统计。

原生 VoiceOver 与原生窗口 AX 交互未完成，不能由 axe 或浏览器渲染替代。

## 原生补充证据

当前 arm64 release app 已通过精确 bundle 路径启动并由 Accessibility Tree 读取；实际点击“添加供应商”、打开设置以及 Escape 返回主界面均成功。该证据只覆盖这些关键交互，不替代完整 VoiceOver 走查。
