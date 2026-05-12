# Architecture and Code Structure Backlog

梳理日期：2026-05-12

这份文档记录 Intelli Git 当前从代码结构、边界设计、架构演进角度值得做的事项。范围只包含能降低真实产品风险、让后续功能更稳的工作；不建议做纯粹为了“看起来更分层”的大改，也不建议加只负责改名转发的 thin wrapper。

## 当前结构概览

```text
VS Code extension host
  extension.ts
    -> RepositoryManager
    -> webview providers
    -> native commands
    -> status bars and editor change-block controller

  services/
    GitService
      -> status, hunks, staging, commit, stash, branch, push, rebase, log, file content
    ChangelistStateService
      -> changelist invariants, hunk assignment, active-list commit plan
    InactiveChangesService
      -> inactive file and hunk state

  rpc/
    ExtensionRpcHandler
      -> webview RPC entry point, VS Code dialogs, git operations, AI provider calls

React webview
  App.tsx
    -> / local changes tabs
    -> /git-log log panel

  commit/
    CommitView
      -> commit state, hunk grouping, changelist grouping, selection, amend/rebase state
    ChangelistTree
      -> tree rendering, context payloads, drag/drop, file commands

  git-log/
    GitLogView
      -> BranchListPanel + LogListPanel + CommitDetailsView

  shared/
    packages/shared/messages.ts
      -> RPC contracts and shared domain types
    packages/shared/rpc.ts
      -> typed RPC peer
```

当前大方向是对的：`changelist` 和 `inactive changes` 的 durable state 放在 extension host，webview 负责 rendering 和 interaction dispatch，native VS Code context menu 通过 `data-vscode-context` 驱动。主要问题不是缺框架，而是几个边界还不够稳：多仓库 identity、启动生命周期、超大 service/RPC 文件、webview 组件里混入过多 domain 计算，以及测试覆盖还没有压住这些边界。

## 设计原则

- `changelist` 和 `inactive changes` 的 invariants 继续由 extension side 持有。
- commit tree UI 继续保持 file-oriented；hunk precision 属于 state 和 operation，不变成 tree child nodes。
- 只抽真正有 ownership 的模块，不为重命名加 wrapper。
- user-facing text 继续走现有 l10n bundle。
- VS Code webview routing 继续保持轻量，除非产品流需要更多 route。
- 大结构移动前先补行为测试，尤其是 commit/changelist、多仓库、context menu 和 refresh contract。

## P0: 修正 Repository Scope 和 Identity 边界

证据：

- `apps/extension/src/services/RepositoryManager.ts` 扫描 workspace folders，并按发现的 git root 创建 `GitService`。
- `apps/extension/src/services/GitService.ts` 已经存在 `workspaceRoot` 和 `gitRoot` 的拆分，也有 pathspec scope 相关逻辑。
- `apps/extension/src/providers/RevisionContentProvider.ts` 和 `apps/extension/src/providers/StashContentProvider.ts` 当前通过 active repository service 读内容。

为什么值得做：

- 用户打开 repository 子目录时，extension 应该保留 workspace path scope，而不是静默扩大到整个 git root。
- multi-root 或 submodule 场景下，已经打开的 revision/stash/diff URI 不应该因为 active repository 切换而读到另一个 repo。
- 这是 correctness 问题，不是代码洁癖。

建议设计：

- 引入真正表达 repo identity 的模型，例如 `RepositoryScope`，包含 `workspaceRoot`、`gitRoot`、`repoPath`、`name`、`isSubmodule`。
- 让 `RepositoryManager` 继续负责 scope resolution 和 active repository selection。
- revision/stash/content URI 携带足够 repo identity，或者 provider 通过 URI root 反查目标 service。
- 增加 regression tests：
  - workspace 打开在 repo 子目录内
  - multi-root workspace 切 active repository
  - revision/stash content 在 active repository 切换前后仍读同一个 repo

## P1: 让 Activation 在初始无 Git Repo 时可恢复

证据：

- `apps/extension/src/extension.ts` 在 `repositoryManager.initialize()` 后如果没有 active service 会直接 return。
- 这个 early return 会跳过 webview provider、global commands、content provider、watcher、repository change listeners 的注册。

为什么值得做：

- VS Code 启动时如果当前 workspace 还不是 git repo，后续用户添加或打开 git repo 时，extension 没有完整恢复路径。
- extension 应该可以先显示 empty/no repository state，再在 repository 出现后绑定 repo-specific behavior。

建议设计：

- 先注册 global providers、global commands、content providers 和 repository listeners，再处理 active repository 是否存在。
- repo-bound disposables 继续放在现有 `bindActiveRepository()` 这类生命周期里。
- webview 通过 RPC 渲染明确的 no-repository state，而不是依赖 activation abort。
- 补一个小型测试或集成 harness，覆盖 activation 后 repository 才出现的情况。

## P1: 从 React Rendering 中抽出 Commit/Changelist Domain Logic

证据：

- `apps/webview-ui/src/components/commit/CommitView.tsx` 同时包含 hunk identity helper、inactive hunk 判断、logical file grouping、changelist grouping、selected files、stats 和 render state。
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx` 同时负责 tree building、context payload、descendant file collection 和 drag/drop mutation dispatch。

为什么值得做：

- `staged` 和 `changes` mode 是产品核心语义，任何小 regression 都会影响用户信任。
- 当前核心转换逻辑混在 React component 文件里，难以做 focused unit tests。

建议设计：

- 把纯计算抽到类似 `apps/webview-ui/src/components/commit/changelistModel.ts` 的模块。
- React components 只保留 view state、event handler 和 rendering。
- 增加 webview-side unit tests：
  - staged mode groups
  - changes mode active list selection
  - inactive file/hunk handling
  - untracked group behavior
  - file-only tree expectations

这类抽取有真实价值，因为它让 domain rules 可测试。不要新建只把 props 传回原组件的 hook/helper。

## P1: 按真实职责拆分 `GitService`

证据：

- `apps/extension/src/services/GitService.ts` 超过 2,000 行，当前覆盖 working tree status、hunk parsing、staging、temporary index commit plan、stash、branch、push、rebase、log graph、commit details 和 file content。

为什么值得做：

- 修改一个功能区时，被迫同时理解大量无关 git workflow。
- 文件内部已经自然分成几个风险区：status/hunks、index/commit、branch/remote、log graph。

建议拆分方向：

- `GitWorkingTreeService`: status、hunk parsing、diagnostics decoration inputs、path conversion。
- `GitIndexCommitService`: staging support、temporary index、active changelist commit plan application。
- `GitBranchRemoteService`: branch、checkout、push、pull、fetch、rebase、merge。
- `GitLogService`: log loading、commit details、graph cache、ref parsing、authors。

第一步可以保持 public call sites 稳定，但只能作为迁移手段。被抽出的模块必须拥有实际行为和测试，不能变成一堆 one-method pass-through wrappers。

## P1: 明确 Git Mutation 的 Refresh Contract

证据：

- `GitService` 暴露 `onDidChange`，多个 extension 侧路径订阅它做 refresh。
- 一部分 mutating methods 调用 `fireChange()`，但 `stageFile`、`unstageFile`、`stash` 等流程目前依赖 watcher 或 caller 手动 refresh。

为什么值得做：

- 当前 refresh 来源混合了 service events、repository watcher 和手动 `provider.rpc?.refresh()`。
- 这会让 editor decorations、status bars、webview state 在不常见操作后更容易不同步。

建议设计：

- 明确选择一种 contract，并写进代码注释和测试：
  - 所有成功的 git mutation 都由 `GitService` fire `onDidChange`
  - 或者 `GitService` 完全不负责 UI refresh，caller 必须显式触发
- 更推荐第一种，让 watcher 只负责 external changes detection。
- 增加代表性 mutation tests：
  - `stageFile`
  - `unstageFile`
  - `stash`
  - `commitChangelistPlan`
  - branch switch/update

## P2: 收窄 `ExtensionRpcHandler`

证据：

- `apps/extension/src/rpc/ExtensionRpcHandler.ts` 在一个类里注册了几乎整个 `ExtensionMethods` surface。
- 它同时处理 git operations、VS Code input dialogs、AI provider selection、commit generation、workspace state read/write、changelist operations 和 error display。
- `packages/shared/messages.ts` 暴露了泛型 `getWorkspaceState<T>` 和 `updateWorkspaceState<T>` RPC methods。

为什么值得做：

- webview 当前可以通过泛型 RPC 写任意 workspace-state key，边界偏宽。
- feature-specific error handling 和 UI side effects 全混在一个 handler 里，后续审计成本高。

建议设计：

- 按 feature ownership 拆分：
  - commit/changelist RPC
  - git log RPC
  - stash/push RPC
  - AI commit-message RPC
  - webview state RPC
- 用 typed、prefixed operations 替代泛型 workspace state RPC。
- 暂不改 `RpcPeer`；问题是 method ownership，不是 transport。

## P2: 合并 Native Command 和 RPC 的 Changelist 行为链路

证据：

- `apps/extension/src/commands/changelistCommands.ts` 和 `apps/extension/src/rpc/ExtensionRpcHandler.ts` 都会执行 changelist 和 inactive-change mutations。
- 一些流程还需要在 mutation 后 refresh editor decorations 和 webview。

为什么值得做：

- native context menu command 和 webview RPC 很容易行为漂移。
- changelist operation 决定哪些内容会被 commit，属于用户信任边界。

建议设计：

- 只在有真实行为组合的地方加 operation layer，例如 changelist mutation workflow 同时负责：
  - state mutation
  - inactive-change reconciliation
  - 必要时调整 index
  - refresh/decorator side effects
- commands 只负责确认、输入和 native UI。
- RPC methods 只负责 webview request/response shape。

## P2: 给 `data-vscode-context` 建 Typed Contract

证据：

- `apps/webview-ui/src/components/commit/ChangelistTree.tsx`、`apps/webview-ui/src/components/git-log/LogListPanel.tsx`、`apps/webview-ui/src/components/stash/StashView.tsx` 都在各自文件里拼 native menu context payload。
- `apps/extension/package.json` 的 `menus.webview/context` `when` clauses 依赖这些字符串字段名。

为什么值得做：

- context menu contract 目前是隐式的。webview payload 字段拼错时，native command 可能静默消失或错误展示。

建议设计：

- 增加 shared context payload types，例如 `packages/shared/webviewContext.ts`。
- 覆盖 section discriminants：`changelistFile`、`changelistRoot`、`gitLogCommit`、`stashItem`、`gitLogCommitFile`。
- 只有在 builder 会 validate 或 normalize context shape 时才加 builder；不要只是把 object literal 换个名字。
- 可以加一个轻量测试，校验已知 section names 和 `apps/extension/package.json` menu clauses 对齐。

## P2: 清理 Webview Common 边界

证据：

- `apps/webview-ui/src/components/common/CommitDetailsView.tsx` 从 `components/git-log` 反向引用 ref label UI。
- `apps/webview-ui/src/components/git-log/RefLabel.tsx` 看起来是 `RefLabels.tsx` 旁边的旧实现或并行实现。
- `apps/webview-ui/src/App.css` 像 Vite template 残留，不属于当前 app structure。

建议工作：

- 把共享的 ref chip components 移到 `components/common` 或 `components/ref-labels`。
- 删除确认无人引用的 UI 残留文件，删除前用 `rg` 查清引用。
- 顺手修掉碰到的硬编码 user-facing text，按现有 l10n bundle 规则处理。

## P2: 明确 Webview Persisted State Ownership

证据：

- `apps/webview-ui/src/hooks/usePersistedState.ts` 持有全局 persisted-state schema。
- git log filters 分散在 toolbar state、loader 和 cache behavior 之间。
- 一些 persisted keys 看起来是历史遗留或 feature-specific。

建议设计：

- 把 feature-specific state schema 移近对应 feature module。
- 为 stale keys 增加 typed migration 或 cleanup policy。
- 继续使用 `vscode.getState()` 和 `vscode.setState()` 作为 backing store；不需要引入全局状态库。

## P3: Tree 宽文件先不机械拆

证据：

- `apps/webview-ui/src/components/common/BasicTreeView.tsx` 同时负责 virtualization、sticky headers、keyboard focus、native context payload support 和 drag/drop。

为什么先 defer：

- 这个文件确实宽，但目前不是最高风险边界。
- 纯机械拆分会带来 churn，不一定让行为更可靠。

合适触发点：

- 下一次改 tree selection、drag/drop、keyboard navigation 或 virtualization 时，再围绕那个具体行为抽 tested pure helpers 或 focused hook。

## Test and Verification Backlog

结构改动前后建议补这些覆盖：

- `RepositoryManager` 的 workspace-root 与 git-root scope 测试。
- repository-aware revision/stash content provider 测试。
- `GitService.onDidChange` mutation event tests。
- webview commit/changelist model tests。
- native menu context payload tests。
- 手动回归：
  - staged mode 和 changes mode 切换
  - active changelist commit 排除其他 changelists
  - inactive files 和 inactive hunks 不进入 commit
  - untracked changes 仍是独立 group
  - changelist root、file、blank area、git log commit、stash item 的右键菜单
  - multi-root workspace active repository switch

常用命令：

```bash
npm run compile
npm run lint
npm run test
npm run package:extension:dev
```

## Suggested PR Sequence

1. Repository scope and activation lifecycle。
   - 修 initial no-repo activation behavior。
   - 让 revision/stash providers repository-aware。
   - 补 repository lifecycle tests。

2. Commit/changelist webview model extraction。
   - 抽 pure grouping 和 selection logic。
   - 增加 focused unit tests。
   - 保持 UI behavior 不变。

3. Git mutation event contract。
   - 选择并记录 refresh contract。
   - 统一 successful mutation events。
   - 只有在测试证明不需要时，才删除 redundant manual refresh。

4. GitService behavior slices。
   - 一次只抽一个 cohesive area。
   - 可以先从 log 或 commit-plan code 开始，因为输入输出边界清楚。
   - 保持 public behavior 稳定。

5. RPC and command operation cleanup。
   - 按 feature 拆 handler ownership。
   - 用 typed operations 替代 generic workspace-state RPC。
   - 在 native commands 和 RPC 之间共享 changelist operation behavior。

6. Low-risk cleanup。
   - 移动 shared ref labels。
   - 删除 confirmed-dead files。
   - 修碰到的 hardcoded user-facing strings。

## 暂不值得做

- 不引入 Redux、Zustand 或其他 webview global state library。
- 不替换 `HashRouter`，它适合 VS Code webview。
- 不重写 `RpcPeer`，当前 transport 小且已有 regression coverage。
- 不引入 DI container，`extension.ts` 继续作为 composition root 即可。
- 不把 changelist state 搬到 webview。
- 不因为 `packages/shared/messages.ts` 是 shared file 就立刻拆；等 feature growth 让 ownership 真的不清楚时再拆。
- 不创建 file-per-method services 或 pass-through wrappers 包 `GitService`。
- 在 CSS Modules 和 VS Code theme variables 成为瓶颈前，不做完整 design system。
