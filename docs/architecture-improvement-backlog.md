# Architecture and Code Structure Backlog

梳理日期：2026-05-12

最近更新：2026-05-16，本轮在既有 `GitLogService` 之后继续完成 `GitBranchRemoteService` slice，把 branch、remote、push、pull、rebase/merge 和 log history mutation workflow 从 `GitService` 中拆出，并让 extension 侧调用点直接依赖新的 ownership 边界。本文档现在同时记录已落地状态和明确 deferred 的后续候选项。

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
      -> status, hunks, staging, commit, stash, file content
    GitLogService
      -> log loading, commit details, graph cache, ref parsing, authors
    GitBranchRemoteService
      -> branch, remote, push, pull, rebase/merge, branch-list data, log history mutations
    ChangelistStateService
      -> changelist invariants, hunk assignment, active-list commit plan
    InactiveChangesService
      -> inactive file and hunk state
  operations/
    ChangelistOperations
      -> shared changelist/inactive mutation workflows and decorator refresh side effects

  rpc/
    ExtensionRpcHandler
      -> webview RPC composition root, VS Code dialogs, remaining git operations, AI provider calls
    GitReadRpcHandler
      -> no-repository-safe git log/stash/push/read models
    ChangelistRpcHandler
      -> changelist/inactive RPC request shape and native input/confirmation

React webview
  App.tsx
    -> / local changes tabs
    -> /git-log log panel

  commit/
    CommitView
      -> commit view state, amend/rebase state, rendering
    changelistModel
      -> hunk grouping, changelist grouping, selected files, stats
    ChangelistTree
      -> tree rendering, context payloads, drag/drop, file commands

  git-log/
    GitLogView
      -> BranchListPanel + LogListPanel + CommitDetailsView
    persistedState
      -> git log feature-owned persisted keys and defaults

  shared/
    packages/shared/messages.ts
      -> RPC contracts and shared domain types
    packages/shared/rpc.ts
      -> typed RPC peer
    packages/shared/webviewContext.ts
      -> typed native webview context-menu payload sections
```

当前大方向是对的：`changelist` 和 `inactive changes` 的 durable state 放在 extension host，webview 负责 rendering 和 interaction dispatch，native VS Code context menu 通过 `data-vscode-context` 驱动。本轮已经处理多仓库 identity、初始 no-repo activation、commit/changelist webview domain logic、Git mutation refresh contract、context payload typing、`GitLogService` read-only slice、`GitBranchRemoteService` branch/remote slice、RPC feature ownership、native command/RPC changelist 行为复用，以及 webview persisted state ownership。`BasicTreeView` 继续保持 deferred：等下一次 tree selection、drag/drop、keyboard navigation 或 virtualization 的真实行为改动再抽 tested helper/hook。

## 2026-05-16 实施状态

已完成：

- 新增 `apps/extension/src/services/GitBranchRemoteService.ts`，承接 branch、remote、push、pull、rebase/merge、branch-list data、remote provider detection、push commit pagination，以及 reset/cherry-pick/revert/checkout commit 这类 log history mutation workflow。
- `GitService` 保留 status/hunks、staging、commit/stash、temporary index、file content 和 shared mutation notification primitive；branch/remote 调用点改为直接使用 `gitService.branchRemote`，没有保留一批 one-method pass-through。
- `GitBranchRemoteService` 继续复用 `GitService` 的 `withTemporaryStash` primitive，因此 dirty-worktree protection 仍会保留 inactive/changelist extension state snapshot 和 restore/reconcile 行为。
- `getRebaseStatus()` / `getRebaseCommitMessage()` 的 relative `.git` path resolution 现在基于 `gitRoot`，避免 workspace 打开在 repo 子目录时误读 `<workspaceRoot>/.git`。
- 新增 branch workflow tests：
  - dirty worktree 下 `switchBranch` 通过 temporary stash 切分支，并恢复 untracked file。
  - `checkoutRemoteBranch('origin/feature')` 创建 tracking local branch，upstream 指向 `origin/feature`。

当前 deferred：

- `GitWorkingTreeService` 和 `GitIndexCommitService` 仍保持后续候选。它们涉及 path scope、inactive hunk、temporary index、active changelist commit plan，拆分前应先补更强的 status/commit-plan tests。
- `BasicTreeView` 仍保持原状，等待下一次具体 tree 行为改动时再抽 tested helper/hook。

## 2026-05-12 实施状态

已完成：

- Repository scope 使用 `RepositoryScope` 表达 `workspaceRoot`、`gitRoot`、`repoPath`、`name` 和 `isSubmodule`，子目录打开仓库时不再静默扩大 workspace scope。
- revision/stash content URI 携带 repo identity；明确 scoped URI 找不到 repo 时不 fallback 到 active repo，避免 active repository 切换后读错内容。
- activation 不再因为初始无 Git repo 直接 early return；global providers、global commands、content providers、watcher 和 repository listeners 会先注册。
- no-repository 状态下，commit view、git log、stash、branch/push 相关 read RPC 返回空状态，而不是依赖 `No active repository` 异常。
- `CommitView.tsx` 中的纯 commit/changelist 计算已抽到 `apps/webview-ui/src/components/commit/changelistModel.ts`，并增加 webview-side unit tests。
- `GitService.onDidChange` contract 已收敛为：service 内成功完成的 Git mutation 触发事件，repository watcher 负责 external changes detection。
- `GitLogService` 已从 `GitService` 物理拆出，拥有 log loading、commit details、commit files、authors、graph cache 和 ref parsing；`GitService.fireChange()` 会 invalidate log graph cache。
- `GitReadRpcHandler` 已承接 no-repository-safe git log/stash/push/read RPC；`ChangelistRpcHandler` 已承接 changelist/inactive mutation RPC；`ExtensionRpcHandler` 保持 composition root。
- 泛型 `getWorkspaceState<T>` / `updateWorkspaceState<T>` RPC 已从 shared contract 和 handler 注册中移除。
- `ChangelistOperations` 已合并 native command 和 RPC 共用的 changelist/inactive mutation workflow，包含 inactive activation、index reconciliation、changelist move 和 decoration refresh。
- changes mode 下 webview drag/drop 已改为单次 `moveChangesToChangelist` RPC，避免 webview 侧串多次 RPC 造成半更新。
- `data-vscode-context` 已有 shared section/type contract：`packages/shared/webviewContext.ts`，并有轻量测试校验 package menu section。
- `RefLabels` 已移到 common，旧 `RefLabel.tsx` 和 Vite template `App.css` 已删除，顺手修正了一个 hardcoded `No data` 文案。
- webview persisted state schema 已拆到 feature-owned `persistedState.ts`，由 `persistedStateRegistry.ts` 聚合；stale historical keys 已从 active schema 移除并保留 legacy allowlist。
- `CommitDetailsView` 不再直接持有 git-log persisted key，`gitLog.commitDetailsSplitRatio` 由 `GitLogView` 传入。

自动验证已通过：

```bash
npm run compile
npm run lint
npm run test
git diff --check
```

明确 deferred：

- `GitWorkingTreeService`、`GitIndexCommitService` 仍是后续候选 slice。不要为了完成清单一次性机械拆；它们涉及 path scope、inactive hunk、temporary index、active changelist commit plan，必须在对应行为增强或测试补强时逐个抽。
- `BasicTreeView` 仍保持原状，等待下一次具体 tree 行为改动时再抽 tested helper/hook。

## 设计原则

- `changelist` 和 `inactive changes` 的 invariants 继续由 extension side 持有。
- commit tree UI 继续保持 file-oriented；hunk precision 属于 state 和 operation，不变成 tree child nodes。
- 只抽真正有 ownership 的模块，不为重命名加 wrapper。
- user-facing text 继续走现有 l10n bundle。
- VS Code webview routing 继续保持轻量，除非产品流需要更多 route。
- 大结构移动前先补行为测试，尤其是 commit/changelist、多仓库、context menu 和 refresh contract。

## P0: 修正 Repository Scope 和 Identity 边界

状态：已完成本轮主修复，后续只保留更复杂 multi-root/submodule 手动回归。

证据：

- `apps/extension/src/services/RepositoryManager.ts` 扫描 workspace folders，并按发现的 git root 创建 `GitService`。
- `apps/extension/src/services/GitService.ts` 已经存在 `workspaceRoot` 和 `gitRoot` 的拆分，也有 pathspec scope 相关逻辑。
- `apps/extension/src/providers/RevisionContentProvider.ts` 和 `apps/extension/src/providers/StashContentProvider.ts` 当前通过 active repository service 读内容。

为什么值得做：

- 用户打开 repository 子目录时，extension 应该保留 workspace path scope，而不是静默扩大到整个 git root。
- multi-root 或 submodule 场景下，已经打开的 revision/stash/diff URI 不应该因为 active repository 切换而读到另一个 repo。
- 这是 correctness 问题，不是代码洁癖。

建议设计：

- 已引入 `RepositoryScope`，包含 `workspaceRoot`、`gitRoot`、`repoPath`、`name`、`isSubmodule`。
- `RepositoryManager` 继续负责 scope resolution 和 active repository selection。
- revision/stash/content URI 已携带 repo identity；legacy URI 仍 fallback active repo，scoped URI 解析失败返回空内容。
- 已补自动测试：
  - workspace 打开在 repo 子目录内时 status 仍按 workspace scope 返回。
  - repository-aware revision/stash content provider 不受 active repo fallback 误读影响。
- 仍建议手动回归：
  - multi-root workspace 切 active repository。
  - submodule repo 选择与内容打开。
  - active repository 切换前打开的 diff tab 在切换后仍显示原 repo 内容。

## P1: 让 Activation 在初始无 Git Repo 时可恢复

状态：已完成核心生命周期修复。

证据：

- `apps/extension/src/extension.ts` 在 `repositoryManager.initialize()` 后如果没有 active service 会直接 return。
- 这个 early return 会跳过 webview provider、global commands、content provider、watcher、repository change listeners 的注册。

为什么值得做：

- VS Code 启动时如果当前 workspace 还不是 git repo，后续用户添加或打开 git repo 时，extension 没有完整恢复路径。
- extension 应该可以先显示 empty/no repository state，再在 repository 出现后绑定 repo-specific behavior。

建议设计：

- 已先注册 global providers、global commands、content providers 和 repository listeners，再处理 active repository 是否存在。
- repo-bound disposables 继续放在 `bindActiveRepository()` 生命周期里。
- webview 通过 RPC 渲染明确 no-repository state。
- read-heavy RPC 在 no-repository 状态返回空模型。
- 后续可补真实 VS Code integration harness，覆盖 activation 后 repository 才出现的流程；当前已有 unit-level no-repo read fallback coverage。

## P1: 从 React Rendering 中抽出 Commit/Changelist Domain Logic

状态：已完成核心抽取。

证据：

- `apps/webview-ui/src/components/commit/CommitView.tsx` 同时包含 hunk identity helper、inactive hunk 判断、logical file grouping、changelist grouping、selected files、stats 和 render state。
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx` 同时负责 tree building、context payload、descendant file collection 和 drag/drop mutation dispatch。

为什么值得做：

- `staged` 和 `changes` mode 是产品核心语义，任何小 regression 都会影响用户信任。
- 当前核心转换逻辑混在 React component 文件里，难以做 focused unit tests。

建议设计：

- 已把纯计算抽到 `apps/webview-ui/src/components/commit/changelistModel.ts`。
- `CommitView.tsx` 现在主要保留 view state、event handler 和 rendering。
- 已增加 webview-side unit tests：
  - staged mode groups。
  - changes mode active list selection。
  - inactive file/hunk handling。
  - untracked group behavior。

仍需注意：

- `ChangelistTree.tsx` 仍负责 tree building、context payload、drag/drop mutation dispatch。它没有 hunk child nodes，但如果后续继续改 tree behavior，应围绕具体行为再抽 tested helper，不要机械拆文件。

这类抽取有真实价值，因为它让 domain rules 可测试。不要新建只把 props 传回原组件的 hook/helper。

## P1: 按真实职责拆分 `GitService`

状态：已完成两个 cohesive slice。`GitLogService` 已物理拆出并拥有真实 read-only history 行为；`GitBranchRemoteService` 已物理拆出并拥有 branch、remote、push、pull、rebase/merge 和 log history mutation 行为。working-tree、index/commit 继续作为 deferred slice，等对应行为变更或测试补强时逐个抽。

证据：

- `apps/extension/src/services/GitLogService.ts` 负责 log loading、commit details、commit files、multi-commit files、authors、current user、graph cache、filtered ancestor stitching 和 ref parsing。
- `apps/extension/src/services/GitBranchRemoteService.ts` 负责 branch、remote、push、pull、rebase/merge、branch-list data、remote provider detection、push commit pagination，以及 reset/cherry-pick/revert/checkout commit 这类 log history mutation workflow。
- `apps/extension/src/services/GitService.ts` 保留 working tree、staging、stash、commit plan、file content 和 shared mutation notification primitive；不再直接持有 git-log 或 branch/remote implementation。
- `GitService.fireChange()` 会调用 `GitLogService.invalidateGraphCache()`，避免 mutation 后复用 stale graph。
- `apps/extension/src/services/GitLogService.test.ts` 覆盖 hash search、path scope、commit details、stats、refs、authors 和 filtered ancestor。
- `apps/extension/src/services/GitService.test.ts` 覆盖 branch switch temporary stash restore 和 remote branch tracking checkout。

为什么值得做：

- 修改一个功能区时，被迫同时理解大量无关 git workflow。
- 文件内部已经自然分成几个风险区：status/hunks、index/commit、branch/remote、log graph。

后续候选拆分方向：

- `GitWorkingTreeService`: status、hunk parsing、diagnostics decoration inputs、path conversion。
- `GitIndexCommitService`: staging support、temporary index、active changelist commit plan application。
- `GitLogService`: log loading、commit details、graph cache、ref parsing、authors。
- `GitBranchRemoteService`: 已完成，继续作为 branch/remote workflow ownership 边界维护。

已经落地的 `GitLogService` 和 `GitBranchRemoteService` 没有在 `GitService` 上保留一组 one-method pass-through；RPC、commands、status bar、branch picker 和 log actions 直接使用 `gitService.log` 或 `gitService.branchRemote`。

更新建议：

- 下一个优先候选不应继续机械拆 service。更适合先围绕 status/hunk 或 commit-plan 的真实行为风险补测试，再决定是 `GitWorkingTreeService` 还是 `GitIndexCommitService`。
- `GitWorkingTreeService` 和 `GitIndexCommitService` 要更谨慎：它们涉及 path scope、inactive hunk、temporary index、active changelist commit plan，拆分前先增加更强的 status/commit-plan tests。
- 不要先创建只改名转发的 facade。每个新 service 必须拥有 cohesive behavior 和对应测试。

## P1: 明确 Git Mutation 的 Refresh Contract

状态：已完成核心 contract 收敛。

证据：

- `GitService` 暴露 `onDidChange`，多个 extension 侧路径订阅它做 refresh。
- 一部分 mutating methods 调用 `fireChange()`，但 `stageFile`、`unstageFile`、`stash` 等流程目前依赖 watcher 或 caller 手动 refresh。

为什么值得做：

- 当前 refresh 来源混合了 service events、repository watcher 和手动 `provider.rpc?.refresh()`。
- 这会让 editor decorations、status bars、webview state 在不常见操作后更容易不同步。

建议设计：

- 已选择并写入 contract：service 内成功完成的 Git mutation 由 `GitService` fire `onDidChange`，watcher 只负责 external changes detection。
- 已补代表性 mutation tests：
  - `stageFile`
  - `unstageFile`
  - `stash`
  - `applyPatch`
  - `commitChangelistPlan`
  - branch switch
- 已补齐 `applyPatch`、rebase continue/abort、branch mutation、stash mutation 等路径的事件触发。
- `checkoutAndRebase()` 已避免通过两个 public mutation method 触发中间态双刷新。

后续注意：

- 每新增一个 mutating Git method，都应明确是否触发 `fireChange()`，并补最小测试或把它放在已有 covered workflow 内。

## P2: 收窄 `ExtensionRpcHandler`

状态：已完成第一批 feature ownership 拆分。

证据：

- `apps/extension/src/rpc/GitReadRpcHandler.ts` 承接 no-repository-safe git log/stash/push/read methods。
- `apps/extension/src/rpc/ChangelistRpcHandler.ts` 承接 changelist/inactive mutation RPC shape、输入框和删除确认。
- `apps/extension/src/rpc/ExtensionRpcHandler.ts` 仍注册完整 `ExtensionMethods` surface，但现在作为 RPC composition root，而不是把所有 feature ownership 都写在单个类里。
- `packages/shared/messages.ts` 已移除泛型 `getWorkspaceState<T>` 和 `updateWorkspaceState<T>` RPC methods。

为什么值得做：

- webview 不再能通过泛型 RPC 写任意 workspace-state key。
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

更新建议：

- no-repo fallback contract 已保留：read methods 返回空模型，write/mutation methods 仍由具体 handler 决定 no-op 或明确错误。
- 后续如果继续扩 RPC 面，优先给新增 feature 建 dedicated handler；不要回到单个类里堆全部实现。
- 如果将来确实需要 extension-backed persisted state，应加 typed、prefixed operation，不要恢复任意 key 泛型 workspace-state RPC。

## P2: 合并 Native Command 和 RPC 的 Changelist 行为链路

状态：已完成核心 operation layer。

证据：

- `apps/extension/src/operations/ChangelistOperations.ts` 负责 shared changelist/inactive mutation workflow。
- native commands 继续负责 VS Code input、confirmation 和 quick pick。
- `ChangelistRpcHandler` 继续负责 webview RPC request/response shape。
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx` changes-mode drag/drop 已改用单次 `moveChangesToChangelist` RPC。
- `apps/extension/src/operations/ChangelistOperations.test.ts` 覆盖 inactive file unstage reconciliation，以及 inactive file/hunk move 到 changelist 的组合 workflow。

为什么值得做：

- native context menu command 和 webview RPC 很容易行为漂移。
- changelist operation 决定哪些内容会被 commit，属于用户信任边界。

建议设计：

- 已只在有真实行为组合的地方加 operation layer，例如 changelist mutation workflow 同时负责：
  - state mutation
  - inactive-change reconciliation
  - 必要时调整 index
  - refresh/decorator side effects
- commands 只负责确认、输入和 native UI。
- RPC methods 只负责 webview request/response shape。

## P2: 给 `data-vscode-context` 建 Typed Contract

状态：已完成基础 typed section contract。

证据：

- `apps/webview-ui/src/components/commit/ChangelistTree.tsx`、`apps/webview-ui/src/components/git-log/LogListPanel.tsx`、`apps/webview-ui/src/components/stash/StashView.tsx` 都在各自文件里拼 native menu context payload。
- `apps/extension/package.json` 的 `menus.webview/context` `when` clauses 依赖这些字符串字段名。

为什么值得做：

- context menu contract 目前是隐式的。webview payload 字段拼错时，native command 可能静默消失或错误展示。

建议设计：

- 已增加 `packages/shared/webviewContext.ts`。
- 已覆盖主要 section discriminants：`changelistFile`、`changelistRoot`、`changelistFolder`、`changelistBackground`、`gitLogCommit`、`stashItem`、`gitLogCommitFile` 等。
- 已在 webview object literals 上用 `satisfies` 绑定类型，没有引入无行为 builder。
- 已加轻量测试校验已知 section names 和 `apps/extension/package.json` menu clauses 对齐。

后续注意：

- 新增 native webview context menu 时，必须同步更新 `webviewContext.ts` 和 menu section alignment test。

## P2: 清理 Webview Common 边界

状态：已完成本轮列出的低风险清理。

证据：

- `apps/webview-ui/src/components/common/CommitDetailsView.tsx` 从 `components/git-log` 反向引用 ref label UI。
- `apps/webview-ui/src/components/git-log/RefLabel.tsx` 看起来是 `RefLabels.tsx` 旁边的旧实现或并行实现。
- `apps/webview-ui/src/App.css` 像 Vite template 残留，不属于当前 app structure。

建议工作：

- 已把 `RefLabels` 移到 `components/common`。
- 已删除无人引用的 `components/git-log/RefLabel.tsx` 和 Vite template `src/App.css`。
- 已修正碰到的 hardcoded `No data` 文案，并加入 l10n bundle。

## P2: 明确 Webview Persisted State Ownership

状态：已完成 feature-owned schema 收敛。

证据：

- `apps/webview-ui/src/components/commit/persistedState.ts`
- `apps/webview-ui/src/components/local-changes/persistedState.ts`
- `apps/webview-ui/src/components/push/persistedState.ts`
- `apps/webview-ui/src/components/stash/persistedState.ts`
- `apps/webview-ui/src/components/git-log/persistedState.ts`
- `apps/webview-ui/src/lib/persistedStateRegistry.ts`
- `apps/webview-ui/src/lib/persistedStateRegistry.test.ts`

建议设计：

- feature-specific state schema 已移近对应 feature module。
- stale keys 已从 active schema 移除，并在 `legacyPersistedKeys` 保留 allowlist 防止未来误复用。
- `usePersistedState`、`useRpcData` 和 `useLogCommitLoader` 现在使用同一套 serialize/deserialize 规则。
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

已补自动覆盖：

- `RepositoryManager` 的 workspace-root 与 git-root scope 测试。
- repository-aware revision/stash content provider 测试。
- `GitService.onDidChange` mutation event tests。
- `GitLogService` log/details/ref/author/path-scope tests。
- `ChangelistOperations` inactive reconciliation and move workflow tests。
- webview commit/changelist model tests。
- webview persisted state registry tests。
- native menu context payload tests。

仍建议手动回归：

- staged mode 和 changes mode 切换。
- active changelist commit 排除其他 changelists。
- inactive files 和 inactive hunks 不进入 commit。
- untracked changes 仍是独立 group。
- changelist root、file、blank area、git log commit、stash item 的右键菜单。
- multi-root workspace active repository switch。
- subdir workspace 下 git log file diff、compare local、open repository version、revert/cherry-pick/create patch。

常用命令：

```bash
npm run compile
npm run lint
npm run test
npm run package:extension:dev
```

## Suggested PR Sequence

已完成：

- Repository scope and activation lifecycle。
- Commit/changelist webview model extraction。
- Git mutation event contract。
- Git log behavior slice。
- Branch/remote behavior slice。
- RPC read/changelist ownership split。
- Changelist operation layer shared by native commands and RPC。
- Native menu context typed contract。
- Low-risk webview common cleanup。
- Webview persisted state ownership。

下一步建议：

1. Working-tree 或 index/commit behavior slice 的前置测试。
   - 先围绕 status/hunk parsing、inactive hunk、temporary index、active changelist commit plan 补充精确 regression tests。
   - 有明确行为增强或 bug fix 时再抽 service，不要为了完成清单机械拆文件。
   - 保持 public behavior 稳定。

2. Tree behavior focused extraction。
   - 只在下一次改 selection、drag/drop、keyboard navigation 或 virtualization 时做。
   - 围绕具体行为抽 tested pure helpers 或 focused hook。

## 暂不值得做

- 不引入 Redux、Zustand 或其他 webview global state library。
- 不替换 `HashRouter`，它适合 VS Code webview。
- 不重写 `RpcPeer`，当前 transport 小且已有 regression coverage。
- 不引入 DI container，`extension.ts` 继续作为 composition root 即可。
- 不把 changelist state 搬到 webview。
- 不因为 `packages/shared/messages.ts` 是 shared file 就立刻拆；等 feature growth 让 ownership 真的不清楚时再拆。
- 不创建 file-per-method services 或 pass-through wrappers 包 `GitService`。
- 在 CSS Modules 和 VS Code theme variables 成为瓶颈前，不做完整 design system。
