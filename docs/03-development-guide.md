# Evir 开发文档

## 1. 环境

- Node.js LTS
- pnpm
- Rust stable
- Tauri 2 系统依赖
- macOS 构建机用于 macOS 包；Windows 构建机用于 Windows 包

## 2. 初始化

```bash
git clone git@github.com:z-Zihan/Evir.git
cd Evir
pnpm install
pnpm dev:web
```

Desktop：

```bash
pnpm dev:desktop
```

## 3. 脚本约定

```text
dev:web             Web 开发服务器
dev:desktop         Tauri 开发模式
build:web           Web 静态产物
build:desktop       当前平台 Desktop 产物
build:vscode        VS Code 扩展生产 Bundle
package:vscode      生成 VSIX
build:cli           CLI 生产 Bundle
release:validate-tag 校验发布 Tag 与全部包版本
check               format + lint + typecheck + test
format              格式化
lint                 ESLint
 typecheck           TypeScript 检查
test                 单元测试
test:e2e            Web E2E
tauri                Tauri CLI
```

## 4. 环境变量

只允许公开的构建信息使用 `VITE_` 前缀。任何真实 API Key 不得打进 Web 构建产物。

```text
VITE_EVIR_TARGET=web|desktop
VITE_APP_VERSION=
EVIR_API_KEY=        CLI 当前进程覆盖；configure 时可导入系统凭据库
EVIR_CONFIG_DIR=     CLI 测试/便携配置根目录
```

## 5. 新增功能流程

1. 阅读 PRD、架构与设计规范。
2. 明确该功能属于 Domain、Application、Runtime 还是 UI。
3. 先定义类型、接口、状态和验收标准。
4. 编写最小测试。
5. 实现 Domain/Application。
6. 接入 Runtime Adapter。
7. 最后完成 UI、空态、错误态和无障碍。
8. 执行 `pnpm check`。
9. Web 与 Desktop 分别做冒烟测试。
10. 更新文档和变更记录。

## 6. 新增翻译

- 不在 JSX 中写用户可见硬编码文本。
- 按 namespace 添加 key。
- key 使用语义名称，不使用中文或完整句子作为 key。
- 中英文必须同时补齐。
- 动态数字、日期、复数使用 i18next 插值和 Intl。

## 7. 新增主题样式

- 优先使用 `bg-background`、`text-foreground` 等语义 Token。
- 禁止在业务组件中写 `#fff`、`#000` 作为主题颜色。
- 所有交互态必须在亮色和暗色下检查。
- 新颜色必须先进入 Design Token，再由组件使用。

## 8. 新增 Tauri Command

1. 在 Rust 层定义最小参数结构。
2. 校验路径、权限、大小、超时和取消。
3. 返回稳定的序列化结果，不把原始系统错误直接暴露给 UI。
4. 注册 command。
5. TypeScript 端通过 Desktop Adapter 调用，不在组件中直接 `invoke`。
6. 增加 Rust 单测和前端 Adapter 测试。

## 9. 本地存储与 Schema 变更

Desktop 的 SQLite 是嵌入式本地文件，不是远程数据库服务。

- 每次 Schema 变更创建新 migration。
- 不修改已发布 migration。
- 为破坏性变更提供备份或迁移说明。
- Repository 层负责 SQL，UI 不得直接访问数据库。
- Desktop/CLI 共享 Provider Profile 只能包含非敏感字段，使用版本化 Schema 和原子替换；系统凭据账户固定为 `provider:<provider-id>:api-key`。
- 修改共享 Schema 时必须同时更新 Rust Desktop Adapter、CLI Config Store、迁移兼容测试和 `docs/09-storage-artifacts-and-recovery.md`。

## 10. 发布

发布只由稳定版 SemVer Tag 触发；普通分支 push 和 PR 不运行 GitHub Actions。

Tag 格式固定为 `v<MAJOR>.<MINOR>.<PATCH>`：

- 合法：`v0.1.0`、`v1.0.0`、`v2.3.4`。
- 非法：`1.0.0`、`v1.0`、`v01.2.3`、`v1.2.3-beta.1`、`latest`。
- 三段数字不得有前导零；当前流程只接受稳定版，不接受 prerelease 或 build metadata。
- Tag 版本必须同时等于根 `package.json`、VS Code 扩展和 CLI 的 `version`。

发布流程：

1. 在 `main` 上完成本地质量检查：`pnpm check`。
2. 同步更新 `package.json`、`extensions/vscode/package.json`、`packages/cli/package.json` 和 changelog。
3. 本地校验：`pnpm release:validate-tag vX.Y.Z`。
4. 创建带说明的 Tag：`git tag -a vX.Y.Z -m "Evir vX.Y.Z"`。
5. 推送 Tag：`git push origin vX.Y.Z`。此时 Quality 与 Desktop Release 两个 workflow 才会启动。
6. 检查 VSIX、CLI tarball、macOS/Windows 安装包、签名、启动和基础对话，再发布同一个 GitHub Release。

已经推送的发布 Tag 不得覆盖或复用；修复后应递增 PATCH 并创建新 Tag。

## 11. 性能检查

阶段交付除功能测试外，还应执行：

- Web bundle 分析。
- Desktop 冷启动与空闲内存采样。
- 空闲 CPU 采样。
- 1000 条消息长会话滚动与流式输出测试。
- 256KB、1MB、10MB 工具输出的内存与 UI 响应测试。
- Skill/MCP 启动时延和按需加载验证。

禁止仅凭主观感受声称“轻量”或“性能良好”。
