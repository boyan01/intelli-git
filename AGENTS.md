# Project Context: Intelli Git

## 文档说明
本文档以中文为主，便于维护者审阅和协作。
Technical terms, code identifiers, file paths, commands, and source-level strings remain in English.

## 概览
这个仓库是 VS Code 扩展 `intelli-git` 的 monorepo。
它提供：
- 本地改动 / commit panel
- git log panel
- 与 branch、stash、changelist、AI-assisted git workflows 相关的功能

## Monorepo 架构

### Workspace 布局
- `apps/extension` - VS Code extension host、command registration、providers、services、packaging scripts、extension manifest
- `apps/webview-ui` - 渲染在 VS Code webview 中的 React + Vite webview application
- `packages/shared` - shared RPC types、shared message contracts、shared localization bundles
- `.agent/workflows` - 实现过程中使用的 agent workflow notes

### Extension Host (`apps/extension`)
主入口：`apps/extension/src/extension.ts`

职责：
- 激活扩展
- 初始化 `GitService` 和 `InactiveChangesService`
- 注册 webview providers
- 注册 commands
- 注册 revision / stash views 对应的 content providers
- 连接 repository watching 和 refresh events
- 管理 status bar items 等 VS Code native UI integrations

关键子目录：
- `apps/extension/src/commands` - 按功能分组的 command registration
- `apps/extension/src/providers` - webview view providers 和 content providers
- `apps/extension/src/services` - git、watcher、AI、state 相关 services
- `apps/extension/src/rpc` - extension side RPC bridge，用于和 webview 通信
- `apps/extension/src/ui` - status bars、pickers 等 VS Code native UI helpers
- `apps/extension/src/utils` - extension 侧共享 utilities

### Webview UI (`apps/webview-ui`)
主入口：`apps/webview-ui/src/App.tsx`

当前路由结构：
- `/` - local changes / commit view
- `/git-log` - git log view

职责：
- 使用 React function components 渲染 webview UI
- 通过 RPC 与 extension host 通信
- 展示 commit、changelist、push、stash、git log 相关视图
- 维护 webview 侧的 cached state 和交互逻辑

关键子目录：
- `apps/webview-ui/src/components` - feature UI components
- `apps/webview-ui/src/hooks` - 可复用 hooks
- `apps/webview-ui/src/lib` - VS Code bridge、RPC client、state cache、file icon helpers
- `apps/webview-ui/src/utils` - UI utility helpers

### Shared Package (`packages/shared`)
职责：
- 定义 shared RPC primitives
- 定义 shared messages / contracts
- 存放 extension host 和 webview 共用的 localization bundles

重要文件：
- `packages/shared/rpc.ts`
- `packages/shared/messages.ts`
- `packages/shared/l10n/bundle.l10n.json`
- `packages/shared/l10n/bundle.l10n.zh-cn.json`

## 开发命令

### 根目录脚本
- `npm run compile` - 编译所有 workspaces
- `npm run watch` - watch 所有暴露了 watch script 的 workspaces
- `npm run watch:extension` - 同时运行 extension 和 webview 的 watch
- `npm run lint` - lint 所有 workspaces
- `npm run test` - 运行各 workspace 的测试（如果存在）
- `npm run package:extension:dev` - 以 dev mode 构建 / 打包 extension

### Workspace 说明
- 根目录 package 使用 npm workspaces：`apps/*` 和 `packages/*`
- `apps/webview-ui` 使用 Vite
- `apps/extension` 使用自定义构建脚本，并会把 l10n assets 同步到 `apps/extension/l10n`

## 沟通规则
- 所有 responses、analysis、todo notes 必须使用简体中文。
- 所有写入源码文件的 code、comments、commit messages、technical strings 必须使用英文。

## 代码风格

### 命名
- React components: `PascalCase.tsx`
- Services / classes: `PascalCase.ts`
- Functions / variables: `camelCase`
- Global constants: `UPPER_SNAKE_CASE`

### Frontend (Webview)
- 使用 function components 和 hooks。
- 组件样式优先使用 CSS Modules。
- 与现有 UI 语言集成时，颜色和主题优先使用 VS Code theme variables。
- 保持当前 React + Vite 结构，不要随意引入新的 frontend stack。

### Backend (Extension)
- 功能逻辑在合适的情况下放入 service classes。
- 使用 `async/await`。
- 遵循现有的 constructor / registration wiring dependency injection 风格，不要随意增加 global singletons。

## Localization (l10n)
所有 user-facing text 都必须被本地化。不要直接硬编码展示字符串。

### 1. Extension Host (`vscode.l10n`)
对于通过 VS Code native APIs 展示的文本：
- 使用 `vscode.l10n.t('English text')`
- 或使用 `apps/extension/src/utils/i18n.ts` 中的 `i18n.t()`
- 动态值使用位置占位符，例如 `{0}`

新增字符串时：
1. 在 `packages/shared/l10n/bundle.l10n.json` 中添加英文条目
2. 在 `packages/shared/l10n/bundle.l10n.zh-cn.json` 中添加中文条目
3. 通过现有 sync script / build flow 保持 extension l10n 输出同步

### 2. `package.json` Contributions (`package.nls`)
对于声明在 `apps/extension/package.json` 中的文本：
- 使用 `%key%` 语法

新增字符串时：
1. 在 `apps/extension/package.nls.json` 中添加英文 key
2. 在 `apps/extension/package.nls.zh-cn.json` 中添加中文 key

### 3. Webview UI (`i18next` / `react-i18next`)
对于 React webview 中展示的文本：
- 使用 `useTranslation`
- 使用 `{{variable}}` 插值语法

新增字符串时：
1. 在 `packages/shared/l10n/bundle.l10n.json` 中添加英文条目
2. 在 `packages/shared/l10n/bundle.l10n.zh-cn.json` 中添加中文条目

### 插值说明
Webview 和 extension host 共用同一组 l10n bundle files，但插值语法不同：
- webview: `{{var}}`
- extension host: `{0}`

编辑时使用对应 runtime 所要求的语法。

## Workflows

### 添加 Context Menus
参见 `.agent/workflows/add-context-menu.md`。

对于由 webview 触发的原生 VS Code context menu：
1. 在 `apps/extension/package.json` 中定义 command
2. 在 `menus.webview/context` 下添加 menu contribution
3. 在目标 webview element 上添加 `data-vscode-context`
4. 在 extension host 中注册 command handler

## Commit View Interaction Contract

这一节定义了 commit view 必须遵守的交互行为。
未来任何涉及 commit view、changelist state、tree rendering、context menus、commit selection、toolbar actions 的重构或功能修改，都必须保持这些规则，除非产品需求明确变更。当需要变更时，必须更新这一节的规则。

### Product Goals
- Commit UI 的 diff 处理必须在 state 和 operation 层精确到 hunk。File-oriented tree 只是展示形态，不能成为丢失 hunk identity、hunk assignment、partial commit precision 的理由。
- `staged` 和 `changes` 两种 mode 都是一等能力。实现或重构时不能为了简化其中一种 mode 而破坏另一种 mode 的语义、toolbar、context menu、commit selection 或 commit execution。
- 大 diff 场景必须保持可用性能。Diff parsing、state reconciliation、RPC payload、React rendering 都应避免无界全量工作；优先使用缓存、增量刷新、lazy loading、virtualized rendering 或按需拉取 diff content。
- 更新项目、`pull --rebase`、checkout / switch branch 等 git workflow 必须对 dirty worktree 更智能。遇到本地改动时不应直接失败；应先识别 staged、unstaged、untracked、inactive changes、changelist / hunk assignments，再通过明确可恢复的 temporary stash / shelf / autostash-style flow 保护本地改动。
- 自动保护本地改动时必须保留用户语义：staged state、active changelist、hunk-to-changelist assignment、inactive changes、untracked files 都不能被静默丢失。恢复失败或产生 conflict 时，必须把 recovery action 和当前 git state 明确暴露给用户。

### General Rules
- Commit view 只支持两种 mode：`staged` 和 `changes`。
- 当前 mode 由配置项 `intelli-git.changelist.mode` 控制。
- 两种 mode 下的用户交互都必须在 refresh、watcher updates、重新打开 webview 后保持稳定。
- Commit view tree 在 UI 上必须保持 file-oriented。tree UI 中 file items 不得渲染 hunk children nodes。
- `Untracked Changes` 必须保持为独立分组，不能并入普通 changelists。
- `Inactive Changes` 在 `staged` mode 语义下必须保持为独立分组，不能被悄悄移除。

### Staged Mode
- `staged` mode 必须保持原有 staged-vs-unstaged 的心智模型。
- Tracked changes 必须分为 staged 和 non-staged groups。
- 与 staging 相关的 toolbar actions 只能在 `staged` mode 中可用。
- `staged` mode 下的 file context menu 可按场景暴露 `Stage`、`Unstage`、`Mark as Inactive Changes`、`Move to Active Changes`。
- `staged` mode 下的 commit selection 由 staged files 决定。
- `staged` mode 下的 commit execution 必须保持现有基于 git index 的行为。

### Changes Mode
- `changes` mode 使用类似 IntelliJ IDEA 的 changelists，tree UI 中不得暴露 staged-vs-unstaged 分组。
- 必须始终至少存在一个 changelist。
- 必须始终且仅存在一个 active changelist。
- 新检测到的 tracked changes 必须分配到 active changelist。
- 用户可以创建、重命名、删除、切换 active changelist。
- 删除 changelist 时，绝不能让状态变成没有有效 changelist；受影响项必须移动到其他剩余列表。
- 同一文件的不同 hunks 在 state 中可以属于不同 changelists，即使 tree UI 仍然保持 file-only。
- `changes` mode 下的 commit execution 必须只提交 active changelist，其他 changelists 必须从最终 commit 结果中排除。

### Changes Mode Tree Behavior
- Tree 必须展示 changelist roots，以及 `Untracked Changes` 这类专用 functional roots。
- Active changelist root 只能通过更强的文字权重表现。
- Active changelist root 不得显示单独的 badge，例如 `Active`。
- Hover changelist root 时，不得显示 rename、delete、set active 等 inline action icons。
- File items 不得显示 hunk child nodes。
- 如果已支持，changelist roots 之间的 drag and drop 文件重分配行为应继续可用。

### Changes Mode Context Menu Rules
- 右键 changelist root 时，必须打开原生 VS Code webview context menu。
- Changelist root context menu 应按场景包含 set active、rename、delete 等 changelist management actions。
- 在 `changes` mode 中右键 file item 时，不得显示 inactive 相关 actions。
- 在 `changes` mode 中右键 file item 时，应改为暴露 `Move to Changelist...`。
- 在 `changes` mode 中右键 tree 空白区域时，应暴露 `Create Changelist`。
- Context menu 的可用性必须通过 `data-vscode-context` 和 `menus.webview/context` 控制，不能依赖临时拼出来的 custom DOM menus。

### Implementation Guardrails
- Changelist state logic 属于 extension-side state/service code，不应只存在于 webview local state。
- Webview 负责 rendering 和 interaction dispatch，但 extension-side services 持有 durable changelist state 和相关 invariants。
- Changelist mode、changelist state、changelist operations 的 shared contracts 必须保留在 `packages/shared/messages.ts`。
- 任何新增的 commit view 用户可见文本都必须遵守仓库的 l10n 规则。
- 如果 commit view context menu 行为发生变化，必须同时更新 webview 的 `data-vscode-context` shape 和 `apps/extension/package.json` 中的 menu contributions。

### Regression Checklist
- 在 `staged` 和 `changes` mode 之间切换时，toolbar 和 context menu 行为必须正确。
- `changes` mode 绝不能显示 staged/unstaged split groups。
- `changes` mode 绝不能在 changelist root 上显示 active badge。
- `changes` mode 下 root hover 绝不能显示 inline operation icons。
- File items 绝不能显示 child hunk nodes。
- 在 `changes` mode 中右键空白区域可以创建 changelist。
- 在 `changes` mode 中右键 file item 提供的是 move-to-changelist，而不是 inactive actions。
- 在 create、rename、delete、refresh、reopen 等流程之后，始终且仅存在一个 active changelist。

## Project Structure Summary
- `apps/extension/` - extension host code 和 packaging
- `apps/webview-ui/` - React webview app
- `packages/shared/` - shared contracts 和 l10n
- `.agent/workflows/` - workflow docs
