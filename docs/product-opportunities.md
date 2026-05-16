# Intelli Git Product Opportunities

Date: 2026-05-12

本文从产品角度梳理 Intelli Git 仍然值得继续做的方向。判断标准不是“源码里还能改什么”，而是这些投入是否能强化用户对 VS Code 内 Git 工作流的信任、效率和差异化感知。

## 当前产品定位

Intelli Git 已经有一个清晰的产品切入点：把 JetBrains-style Git workflow 带到 VS Code，而不是替代 VS Code built-in Git。

现有能力已经覆盖：

- `Commit View`: staged / changes mode、changelist、inactive changes、hunk-level assignment、commit / amend / commit & push。
- `Git Log`: branch tree、commit graph、filters、commit details、file-level history actions。
- `Stash` 和 `Push` tabs。
- editor 侧 change block decorations / status bar / code actions。
- AI-assisted commit message generation，支持 GitHub Copilot、Anthropic、Google AI、custom OpenAI-compatible endpoint。

下一阶段更值得做的是：把这些能力从“功能存在”推进到“用户可以放心长期使用的产品闭环”。

## 产品原则

- **Trust first**: Git 产品的核心不是按钮多，而是不会悄悄丢失 staged state、changelist assignment、inactive changes、untracked files 或用户的 remote intent。
- **Expose the workflow, not the plumbing**: `changes` mode、changelist、hunk assignment 是差异化能力，应在 UI 中可见、可理解，而不是藏在 settings 或 context menu 里。
- **Context over generic commands**: 很多 Git 操作只有在具体 commit / file / branch / stash 上才有意义，应减少 Command Palette 里的 context-only no-op。
- **Scale is product quality**: Git Log、authors、graph 和 diff parsing 在大仓库里慢，会直接破坏产品信任。
- **Keep VS Code native where it matters**: context menu、commands、status bar、diff editor、l10n、theme variables 应继续走 VS Code native integration。

## Prioritized Roadmap

### P0. Product Entry And Empty-State Trust

#### 1. 把 `README` 和 Marketplace 首屏做成产品入口

证据：

- `README.md` 当前主要是 development / build / package instructions。
- `apps/extension/README.md` 已经有产品描述、features、privacy 和 known limitations，可作为 Marketplace 内容基础。
- `apps/webview-ui/README.md` 仍是 Vite 模板说明。

为什么值得做：

用户第一次接触扩展时，需要在 30 秒内理解它为什么比 built-in Git view 更适合复杂提交工作流。当前 root README 更像开发者文档，不像产品入口。

建议：

- root README 首屏改成 product-facing narrative：`Commit View`、`Changelists`、`Git Log`、`Stash`、`Push`、`AI commit message`。
- 增加 2-3 张真实截图或 GIF：commit panel、changes mode、git log。
- 保留 development 内容，但下沉到 `Development` section。
- 删除或改写 webview Vite 模板 README，避免发布包或仓库入口显得未收尾。

#### 2. 补 non-git / empty workspace 体验，并收敛 activation

证据：

- `apps/extension/package.json` 只有 `onStartupFinished` activation。
- `apps/extension/src/extension.ts` 在无 workspace 或无 repo 时直接 return。
- global commands 例如 AI provider setup、feedback command 也依赖 extension activation 后的 registration。

为什么值得做：

用户在非 Git workspace 安装扩展时，当前体验像“扩展失效”。这会影响 Marketplace 评分，也会让 AI setup、feedback 这类 global flow 不可发现。

建议：

- 拆分 global initialization 和 repo-bound initialization。
- 无 repo 时仍注册 `Intelli: Configure AI Provider`、`Intelli: Open Feedback`、基本 help command。
- webview 显示 actionable empty state：`Open a Git repository`、`Initialize repository`、`Open folder`。
- repository-bound commands 在无 active repo 时给明确提示，而不是静默 return。

### P1. Core Workflow Differentiation

#### 3. 把 dirty worktree protection 做成统一产品能力

证据：

- `GitService.withTemporaryStash` 已能保存 Git local changes，并保存 inactive/changelist snapshot。
- `switchBranch`、`pull --rebase`、remote checkout、rebase 已部分使用 temporary stash。
- `merge`、`pullWithMerge`、`reset`、`cherryPick`、`revert` 等仍有直接路径。

为什么值得做：

IntelliJ-style Git 产品的最大价值之一，是在 update / checkout / rebase 等流程中保护当前工作上下文。只覆盖部分路径，会造成“有时可靠、有时不可靠”的不一致体验。

建议：

- 优先覆盖 `merge`、`pullWithMerge`、`checkoutCommit`、`cherryPick`、`revert` 的 dirty preflight。
- 对 `resetHard`、`Force Update`、`Force Push` 单独做 stronger confirmation。
- 出现 conflict 或 restore failure 时，明确展示 temporary stash name、当前 Git state、recovery action。
- 保持 implementation local，不为了“统一”新造大框架；围绕危险操作补 preflight 和 recovery result 即可。

#### 4. 破坏性操作加影响预览和 recovery clue

证据：

- Git Log context menu 暴露 `resetSoft`、`resetMixed`、`resetHard`、`cherryPick`、`revert`、`undoCommit`。
- Push footer 有 `Force Push` option。
- branch update diverged 时可 `Force Update`。

为什么值得做：

Git 产品的危险操作必须让用户知道会影响哪些 commits / files，以及如何恢复。当前 modal confirmation 文案不足以建立信任。

建议：

- `resetHard`: 显示将丢弃的 local changes 数量和 sample files。
- `Force Push`: 默认改用 `--force-with-lease`，除非有明确 fallback。
- `Force Update`: 显示将被丢弃的 local commits。
- `undoCommit`: 继续限制 pushed commits，但提示如何 revert pushed commit。

### P1. Command And Repository UX

#### 5. 清理 Command Palette 里的 context-only commands

证据：

- `apps/extension/package.json` 贡献了大量 commands。
- `commandPalette` 只隐藏了少量 mode commands。
- `resetHard`、`stashDrop`、`changelist.rollback` 等命令如果没有 webview context args，要么 no-op，要么入口危险。

为什么值得做：

Command Palette 是用户探索扩展的入口。大量 context-only 命令会显得产品粗糙，也容易触发无反馈。

建议：

- 对必须依赖 webview args 的 commands 加 `commandPalette` hide。
- 对可以 argumentless 的命令补 QuickPick，例如选择 stash / commit / branch 后执行。
- 保留真正 global commands：focus commit view、focus git log、configure AI provider、open feedback、switch repository。

#### 6. 补齐 multi-repo / submodule 产品闭环

证据：

- `RepositoryManager` 已扫描 workspace folders 和 submodules。
- active repository 目前是内存态，默认选第一个。
- fallback watcher 只使用 `workspaceFolders[0]`。

为什么值得做：

monorepo 和 submodule 用户正是 Intelli Git 的高价值用户。当前“能扫描”还没完全变成“可长期使用”的产品体验。

建议：

- 持久化 active repository selection。
- commit view / git log / status bar 显示当前 repository。
- fallback watcher 覆盖所有 repository roots。
- repository switch 后清晰刷新 commit view、git log、branch status、change block decorations。

ASCII UI:

```text
Header
+---------------------------------------------------------+
| Repo: idea-commit-pannel v    Branch: main   Log  Push  |
+---------------------------------------------------------+
```

### P2. Git Log And History Workflows

#### 7. Git Log narrow expanded item 视觉重设计

证据：

- narrow mode 已去掉 hover-only side panel，并支持单击 commit row 展开 / 收起。
- 当前 inline details 仍偏像 list row 下方插入一个子面板，和 Git graph / commit row 的视觉关系不够自然。
- 文件树 toolbar、details shell、graph continuation 在窄布局里容易显得拥挤。

为什么值得做：

Git Log 是 daily driver 入口。窄屏展开态如果看起来像“面板塞进列表”，会破坏浏览历史的连续性，也会让 graph 成为噪音。

建议：

- 把展开态改为 variable-height commit item，而不是 child panel。
- details 内容从 subject 起点继续排版，只保留 body、meta、compact file summary。
- 文件少时 inline 展示文件路径；文件多时显示前几项和 `+N more`，完整文件树交给右侧详情或后续 action。
- graph gutter 只负责 graph，不放背景、accent border 或额外 guide line。
- 保留单击 row 展开 / 收起和多 commit 同时展开。

```text
graph   commit subject...                  author  date
  │     body first line...
  │     author · hash · time · +12 -3
  │     3 files: src/a.ts, src/b.ts, README.md
  │
graph   next commit...
```

#### 8. Git Log 大仓库性能继续产品化

证据：

- `getLog` 使用 `--skip` 分页。
- filtered graph 会 `rev-list --all --parents` 加载全图。
- `getAuthors` 每次读取全历史。

为什么值得做：

Git Log 是核心卖点。大仓库里一次明显卡顿，就会让用户回到 built-in Git 或 terminal。

建议：

- authors lazy load + cache，按 refs / HEAD / fetch event 失效。
- graph cache 按 repo + refs snapshot 管理。
- filter mode 避免每次全图 BFS；优先只为当前 batch 补 edge metadata。
- UI 显示 incremental loading state，不要空白等待。

### P2. Push, Remote Providers, And Sync

#### 9. 修正 `Commit & Push` 的 remote / upstream 语义

证据：

- shared `push` RPC 有 `remote`、`branch` params。
- `commit` RPC 只有 `push?: boolean`。
- commit 后 push 当前固定使用 `origin/currentBranch` 路径。

为什么值得做：

多 remote、无 upstream、新分支、fork workflow 都容易出现“推到意外目标”的风险。commit & push 是高信任操作，不能猜错。

建议：

- `Commit & Push` 复用 `PushInitState` 里的 upstream 和 selected target。
- 无 upstream 或 target 不明确时，切到 Push tab 让用户确认。
- commit form 中显示 push target summary。
- push 后自动 set upstream 的逻辑继续保留，但必须基于用户确认的 remote/branch。

ASCII UI:

```text
Commit footer
+---------------------------------------------------------+
| Message...                                              |
| Push target: origin/feature-login      [Change...]      |
| [Commit] [Commit & Push] [Options v]                    |
+---------------------------------------------------------+
```

#### 10. Push tab 补 empty、target validation 和 danger guard

证据：

- `PushTab` commits view 只 map commits，没有 zero outgoing state。
- `PushFooter` 在 `commitCount === 0` 时 disabled push。
- `Force Push` 是 dropdown toggle。

为什么值得做：

zero outgoing commits 是正常状态；force push 是危险状态。两者都应该清晰表达。

建议：

- no outgoing commits 显示 `Everything up to date`，并提供 `Fetch` / `Open Git Log`。
- target branch 不存在时显示 `New remote branch` 状态。
- force push 开启后需要二次确认，并解释 `force-with-lease`。
- push rejection behind 不再靠 string sentinel 驱动 UI，见 structured result。

#### 11. 把 GitHub-only 外链升级成 provider-aware remote link contract

证据：

- remote provider context 当前只处理 GitHub。
- `Open on GitHub` 只在 `intelli-git.gitRemoteProvider == 'github'` 时出现。

为什么值得做：

用户已经明确会有 GitLab / Bitbucket / Azure DevOps 的后续扩展需求。现在就应该从 contract 角度收敛，而不是继续堆 host-specific boolean。

建议：

- shared remote provider model: `github | gitlab | bitbucket | azure | unknown`。
- provider capabilities: commit URL、branch URL、file URL、compare URL。
- menu label 根据 provider 生成，例如 `Open on GitHub` / `Open on GitLab`。
- 对 self-hosted GitLab 只要 URL parser 能识别就可支持。

### P3. AI Workflow

#### 12. AI generate 增加 provider visibility、test connection 和 no-diff feedback

证据：

- commit form 只有 sparkle generate icon。
- provider configuration commands 已存在。
- generate button context menu 当前主要到 prompt settings。
- no diff / provider missing / unavailable model 时容易只显示技术错误。

为什么值得做：

AI 失败很容易被用户归因到产品质量，而不是 provider 配置。AI commit message 是信任型功能，需要让用户知道它会发送什么、发送给谁、失败时怎么修。

建议：

- generate dropdown 显示 current provider / model。
- 提供 `Configure AI Provider`、`Select Copilot Model`、`Test Provider`、`Edit Commit Prompt`。
- no selected diff 时给 inline empty state：`Select changes to generate a commit message`。
- provider missing 时直接提供配置入口。
- 统一 default model 来源，避免 manifest 和 command helper 漂移。

ASCII UI:

```text
AI generate
+-------------------------------+
| Provider: GitHub Copilot       |
| Model: gpt-4.1                 |
| [Generate]                     |
| [Configure Provider]           |
| [Test Provider]                |
| [Edit Prompt]                  |
+-------------------------------+
```

#### 13. Commit message AI 应支持 scoped generation 和 revision

证据：

- `generateCommitMessage(files?: string[])` 已按 selected files 调用。
- commit form 保存 message，并支持 amend。

为什么值得做：

复杂 changelist 下，用户经常需要“先生成 subject，再 refine body”，而不是一次性替换全部 message。

建议：

- 支持 `Generate subject only`、`Generate body`、`Rewrite selected message`。
- changes mode 下默认只基于 active changelist。
- 明确显示 AI 使用的 file count / hunk count。
- 不要自动覆盖用户已编辑 message，除非用户确认。

### P3. Quality Bar

#### 14. 加 webview l10n audit

证据：

- webview 中存在多个 `t()` key 不一定在 shared bundle 中有对应条目。
- 存在硬编码 user-facing text，例如 `No data`、`NEW`。

为什么值得做：

本项目已经要求所有 user-facing text 走 l10n。缺 key 会直接影响中文用户体验，也会让发布质量不可控。

建议：

- 增加脚本扫描 webview `t('...')` key 是否同时存在于 en / zh bundle。
- 扫描明显 JSX text literal，并允许少量 ignore list。
- 接入 `npm run lint` 或 release audit。

#### 15. 收敛重复 control styles，但不要做薄 wrapper

证据：

- `iconBtn`、dropdown、split button、tooltip 样式分散在多个 CSS Modules。

为什么值得做：

工具型 UI 的一致性来自 hover、focus、disabled、z-index、keyboard state 的稳定。重复样式长期会漂移。

建议：

- 先抽 shared CSS module tokens / class composition。
- 不为了重命名新增 React wrapper。
- 优先收敛 button、dropdown、tooltip、split button、empty state。

### P4. Release And Support Trust

#### 16. 明确 dev build expiration / release channel 语义

证据：

- webview 有 `VersionCheckBanner` 和 `VersionExpiredPanel`。
- release / packaging scripts 已区分 dev package。

为什么值得做：

如果用户安装的是 dev build，过期提示合理；如果 Marketplace build 也触发，会是严重产品信任问题。这个机制需要在 release audit 中明确。

建议：

- 仅 dev build 启用 expiration。
- expired panel 提供 `Install latest release` / `Open feedback` / `Rebuild dev VSIX` 的明确路径。
- release checklist 中检查 `__IS_EXPIRED__`、`__BUILD_TIME__`、VSIX content。

#### 17. structured operation result 替代 string sentinel

证据：

- push behind 使用 `PUSH_REJECTED_BEHIND:{count}` string sentinel。
- RPC error 当前主要是 message string。

为什么值得做：

push / pull / checkout / rebase / stash recovery 都需要 UI 分支。用字符串协议会脆弱，也不利于 l10n。

建议：

- 不做泛化 framework。
- 只给高价值操作引入 discriminated result，例如 `PushResult`、`GitOperationErrorCode`。
- UI 根据 code 渲染本地化文案和 action buttons。

## Suggested Delivery Order

### Milestone 1: Trust And First-Run Polish

- README / Marketplace content。
- non-git / empty workspace flow。
- command palette hygiene。
- webview l10n audit。
- push empty state 和 force push confirmation。

### Milestone 2: Changelist Workflow Maturity

- unified dirty worktree preflight for merge / pull / checkout / cherry-pick / revert。
- destructive operation impact preview。

### Milestone 3: Git Log As A Daily Driver

- narrow expanded item 视觉重设计。
- Git Log cache and large-repo performance pass。

### Milestone 4: AI And Remote Ecosystem

- AI provider visibility and test connection。
- scoped AI message generation。
- provider-aware remote links beyond GitHub。
- structured operation results for push / sync flows。

## Things To Defer

- Full replacement of VS Code built-in Git SCM provider. 当前定位是 complementary workflow，替换 built-in Git 会显著扩大维护面。
- Custom DOM context menus. 现有 project contract 明确使用 native VS Code webview context menu，应继续保持。
- Hunk children in commit tree. 这会破坏 file-oriented tree contract；用 editor decorations 和 compact indicators 更稳。
- Full PR review / code review product. 当前最强产品线是 local changes + history + commit workflow，PR review 会把产品边界拉得太散。
- Big abstraction refactor for all Git operations. 先围绕高风险操作补 preflight / structured result，比抽象一层通用 workflow 更有产品回报。

## Product Success Signals

- 新用户能从 README / Marketplace 直接理解 `changes` mode 和 Git Log 的差异化。
- clean / no repo / no result / no outgoing commits 都有明确、可行动的状态。
- 用户执行 checkout / update / rebase / merge 时，staged state、inactive changes、changelist assignment 不会静默丢失。
- Git Log 在大仓库中持续可滚动、可过滤、可恢复选中状态。
- AI generate 失败时，用户能直接知道是 no diff、provider missing、model unavailable 还是 network/API failure。
- Command Palette 里剩下的命令都能在无 context 下产生有意义的结果。
