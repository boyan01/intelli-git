---
name: intelli-git-release
description: Prepare Intelli Git release changelogs and versions, trigger tagged GitHub Actions releases, or recover a partially completed publication.
---

# Intelli Git Release

开发和发布统一使用 `boyan01/intelli-git`。本地准备 changelog 和版本；`.github/workflows/release.yml` 调用 `scripts/release.js` 构建和发布。

## 准备版本

1. 检查工作区和 remote URL，发布目标是 `boyan01/intelli-git`。读取 `AGENTS.md` 的 commit message 约定。
2. 用仓库最新正式 release 的 tag 作为基线。读取从基线源码 commit 到目标 commit 的完整 commit subject/body，必要时核对 diff。不要把历史 `intelli-git-extension-*` tag 当成当前版本格式。
3. 在 `apps/extension/CHANGELOG.md` 顶部添加 `## X.Y.Z`。只提炼产品可见变化；排除 CI、构建、测试、依赖和内部重构。保持现有英文文档语言，不能把未验证的效果写进 changelog。
4. 选择比当前版本更新、尚未发布的稳定 `X.Y.Z`，运行 `npm version X.Y.Z --workspace=intelli-git --no-git-tag-version`，由 npm 同步 extension version 和根 lockfile。检查 diff；release commit 使用 `Release Intelli Git X.Y.Z`，body 使用同一份产品 changelog。
5. 发布已获授权时，在 release commit 上创建 annotated `vX.Y.Z` tag（如 `v0.0.10`），运行 `node scripts/release.js check vX.Y.Z`，再推送源码和 tag。准备版本的请求本身不代表用户要求立即发布。

## GitHub 配置

- 先将 workflow 合入仓库默认分支，手动触发入口才能使用。
- 在仓库 Actions secrets 配置 `VSCE_PAT` 和 `OVSX_PAT`，分别用于 Marketplace 和 Open VSX 的 `boyan01` publisher。Workflow 已声明 `contents: write`，供 `GITHUB_TOKEN` 管理 release assets。

## 构建和发布

tag push 自动触发正式发布。也可以针对已有 tag 手动运行：

```bash
gh workflow run release.yml --repo boyan01/intelli-git -f tag=vX.Y.Z
```

CI 检查 tag 与 extension/lockfile version 一致，HEAD 是 tag commit，changelog 非空且 checkout 干净。发布前核对远端 tag，不能从未打 tag 的 branch head 发布。首次发布运行 lint、仓库测试、release 恢复测试，再构建和检查 VSIX。

本地复查对应 tag 的构建时，使用 `.nvmrc` 指定的 Node.js，在 clean checkout 运行：

```bash
npm ci
npm run lint
npm run test
npm run test:release
VSCE_BASE_CONTENT_URL="https://raw.githubusercontent.com/boyan01/intelli-git/vX.Y.Z" \
VSCE_BASE_IMAGES_URL="https://raw.githubusercontent.com/boyan01/intelli-git/vX.Y.Z" \
npm run package:extension
```

构建通过 `vscode:prepublish` 编译，输出 `out/intelli-git-X.Y.Z.vsix`。打包命令调用 `verify:vsix` 检查版本、extension identity、必要构建文件，以及凭据和无用文件；源码和 source map 不作为阻断条件。SHA-256 标识首次构建的文件；重新构建可能因时间戳而产生不同 hash。

CI 先创建 draft release，保存 VSIX 和 `release-manifest.json`（tag、version、commit、filename、SHA-256）。两个 publisher 直接消费该 VSIX。每个渠道成功后上传 `published-<channel>.json` 回执，绑定同一份 manifest。两者都成功后公开 GitHub Release，notes 使用 tag 中的产品 changelog，并链接安装页、对应源码和本 skill 的构建说明。

公开 release 必须使用对应 tag，附加同一份已检查 VSIX，保留 Marketplace 安装链接和对应源码/构建说明。迁移前的 tags、releases 和附件保持原样，不移动 tag，不覆盖旧附件。

## 恢复失败发布

- 读取 Actions 日志和 draft assets，优先使用 **Re-run failed jobs**，或用已有 tag 手动触发。CI 下载保存的包，核对 commit、checksum 和包内 identity，重跑包检查，跳过有有效回执的渠道。重试不会重新构建，也不会覆盖公开 release 的 notes 或附件。
- VSIX 或 manifest 缺失时停止。如果是初次上传中断的 draft，人工确认两个 publisher 都未执行后，可以删除该不完整 draft 再重试。历史公开 release 保持原样。
- hash/commit/回执不符，或 tag 被移动时停止，先调查原因，不能覆盖附件来消除错误。
- publisher 成功但回执上传失败时，重试可能报版本重复。人工核对原始成功日志和保存的 VSIX；确认发布的是该文件后，复制 manifest，增加 `channel` 字段（`marketplace` 或 `open-vsx`），以 `published-<channel>.json` 上传到 draft，再重试。不能靠 `--skip-duplicate` 推断成功。
- 完成后报告版本、基线、changelog、验证结果和 Actions/Release 链接。区分“本地已准备”和“渠道已发布”；不能仅凭 workflow 已触发就报告发布成功。
