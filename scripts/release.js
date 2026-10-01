const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const releaseRepository = 'boyan01/intelli-git';

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
}

function run(command, args, capture = false, env = process.env) {
    return execFileSync(command, args, {
        cwd: repoRoot,
        env,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8'
    })?.trim();
}

function changelogFor(version) {
    const text = fs.readFileSync(path.join(repoRoot, 'apps/extension/CHANGELOG.md'), 'utf8');
    const sections = text.split(/^## /m).slice(1);
    const matches = sections.filter(section => section.split(/\r?\n/, 1)[0] === version);
    if (matches.length !== 1 || !/^\s*- \S/m.test(matches[0])) {
        throw new Error(`Expected one non-empty changelog section for ${version}.`);
    }
    return matches[0].slice(version.length).trim();
}

function metadata(tag) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || '')) {
        throw new Error('Pass an existing vX.Y.Z release tag.');
    }
    const version = tag.slice(1);
    if (readJson('apps/extension/package.json').version !== version
        || readJson('package-lock.json').packages?.['apps/extension']?.version !== version) {
        throw new Error('Release tag, extension version and lockfile version must match.');
    }
    changelogFor(version);
    const commit = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], true);
    if (commit !== run('git', ['rev-parse', 'HEAD'], true)) {
        throw new Error('HEAD must be the release tag commit.');
    }
    if (run('git', ['cat-file', '-t', `refs/tags/${tag}`], true) !== 'tag') {
        throw new Error('Release tags must be annotated.');
    }
    if (run('git', ['status', '--porcelain', '--untracked-files=normal'], true)) {
        throw new Error('Release checkout must be clean.');
    }
    return { tag, version, commit, file: `intelli-git-${version}.vsix` };
}

function releaseNotes(info) {
    return `${changelogFor(info.version)}\n\n`
        + `[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git) · `
        + `[Install from Open VSX](https://open-vsx.org/extension/boyan01/intelli-git)\n\n`
        + `[Source (${info.tag})](https://github.com/${releaseRepository}/tree/${info.tag}) · `
        + `[Build instructions](https://github.com/${releaseRepository}/blob/${info.tag}/.agents/skills/intelli-git-release/SKILL.md)\n`;
}

function checksum(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyManifest(manifest, info, vsix) {
    for (const key of ['tag', 'version', 'commit', 'file']) {
        if (manifest[key] !== info[key]) {
            throw new Error(`Stored release ${key} does not match the tagged checkout.`);
        }
    }
    if (manifest.sha256 !== checksum(vsix)) {
        throw new Error('Stored VSIX checksum does not match release-manifest.json.');
    }
}

function gh(args, capture = false) {
    return run('gh', args, capture);
}

function assertRemoteTag(info) {
    let ref = JSON.parse(gh(['api', `repos/${releaseRepository}/git/ref/tags/${info.tag}`], true)).object;
    if (ref.type !== 'tag') {
        throw new Error('Remote release tag must be annotated.');
    }
    ref = JSON.parse(gh(['api', `repos/${releaseRepository}/git/tags/${ref.sha}`], true)).object;
    if (ref.type !== 'commit' || ref.sha !== info.commit) {
        throw new Error('Remote release tag no longer matches the checked-out commit.');
    }
}

function publish(tag) {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== releaseRepository) {
        throw new Error(`Formal publishing only runs in GitHub Actions on ${releaseRepository}.`);
    }
    const info = metadata(tag);
    const directory = path.join(repoRoot, 'out/release');
    fs.mkdirSync(directory, { recursive: true });
    const vsix = path.join(directory, info.file);
    const manifestPath = path.join(directory, 'release-manifest.json');
    const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${releaseRepository}/releases?per_page=100`], true));
    const matches = pages.flat().filter(release => release.tag_name === tag);
    if (matches.length > 1) {
        throw new Error('Multiple releases refer to this tag. Resolve them before publishing.');
    }
    const existing = matches[0];
    let manifest;
    if (existing) {
        const names = new Set(existing.assets.map(asset => asset.name));
        if (!names.has(info.file) || !names.has('release-manifest.json')) {
            throw new Error('Existing release lacks managed artifacts. Do not rebuild or overwrite it; see the project release skill.');
        }
        for (const name of [info.file, 'release-manifest.json', 'published-marketplace.json', 'published-open-vsx.json']) {
            if (names.has(name)) {
                gh(['release', 'download', tag, '--repo', releaseRepository, '--pattern', name, '--dir', directory]);
            }
        }
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        verifyManifest(manifest, info, vsix);
        run(process.execPath, ['apps/extension/scripts/verify-vsix.js', vsix, '--version', info.version]);
        assertRemoteTag(info);
    } else {
        for (const script of ['lint', 'test', 'test:release', 'package:extension']) {
            run('npm', ['run', script], false, {
                ...process.env,
                VSCE_BASE_CONTENT_URL: `https://raw.githubusercontent.com/${releaseRepository}/${tag}`,
                VSCE_BASE_IMAGES_URL: `https://raw.githubusercontent.com/${releaseRepository}/${tag}`
            });
        }
        fs.copyFileSync(path.join(repoRoot, 'out', info.file), vsix);
        manifest = { ...info, sha256: checksum(vsix) };
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const notesPath = path.join(directory, 'release-notes.md');
        fs.writeFileSync(notesPath, releaseNotes(info));
        assertRemoteTag(info);
        gh(['release', 'create', tag, '--repo', releaseRepository, '--verify-tag', '--draft',
            '--title', `Intelli Git ${info.version}`, '--notes-file', notesPath, vsix, manifestPath]);
    }

    for (const channel of ['marketplace', 'open-vsx']) {
        const receipt = path.join(directory, `published-${channel}.json`);
        if (fs.existsSync(receipt)) {
            const saved = JSON.parse(fs.readFileSync(receipt, 'utf8'));
            if (saved.channel !== channel || Object.keys(manifest).some(key => saved[key] !== manifest[key])) {
                throw new Error(`Invalid publication receipt for ${channel}.`);
            }
            console.log(`${channel}: already published this artifact.`);
            continue;
        }
        if (existing && !existing.draft) {
            throw new Error('Public release lacks publication receipts. Do not change an existing public release.');
        }
        const secret = channel === 'marketplace' ? 'VSCE_PAT' : 'OVSX_PAT';
        if (!process.env[secret]) {
            throw new Error(`Missing ${secret} in Actions secrets.`);
        }
        const cli = channel === 'marketplace' ? '@vscode/vsce/vsce' : 'ovsx/bin/ovsx';
        const args = channel === 'marketplace' ? ['publish', '--packagePath', vsix] : ['publish', vsix];
        const env = { ...process.env };
        delete env.GH_TOKEN;
        delete env[channel === 'marketplace' ? 'OVSX_PAT' : 'VSCE_PAT'];
        run(process.execPath, [require.resolve(cli), ...args], false, env);
        fs.writeFileSync(receipt, `${JSON.stringify({ ...manifest, channel }, null, 2)}\n`);
        gh(['release', 'upload', tag, receipt, '--repo', releaseRepository]);
    }
    if (!existing || existing.draft) {
        gh(['release', 'edit', tag, '--repo', releaseRepository, '--draft=false']);
    }
    const summary = `Released ${tag} from ${info.commit}\n\nSHA-256: ${manifest.sha256}\n\n`
        + `Marketplace and Open VSX published; [GitHub Release](https://github.com/${releaseRepository}/releases/tag/${tag}).\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
}

try {
    const [command, value, ...extra] = process.argv.slice(2);
    if (extra.length) {
        throw new Error('Unexpected release arguments.');
    }
    if (command === 'check') {
        console.log(JSON.stringify(metadata(value), null, 2));
    } else if (command === 'publish') {
        publish(value);
    } else {
        throw new Error('Usage: node scripts/release.js <check|publish> vX.Y.Z');
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
