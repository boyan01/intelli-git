const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('production packaging creates the VSIX output directory in a clean checkout', (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-package-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const extension = path.join(temporary, 'apps/extension');
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/extension/package.json'), 'utf8'));
    const files = {
        'package.json': JSON.stringify({
            name: 'intelli-git',
            publisher: 'boyan01',
            version: '0.0.11',
            license: 'GPL-3.0-or-later',
            repository: { type: 'git', url: 'https://github.com/boyan01/intelli-git.git' },
            engines: { vscode: '^1.100.0' },
            activationEvents: ['onStartupFinished'],
            main: './out/extension.js',
            scripts: {
                package: sourceManifest.scripts.package,
                'verify:vsix': sourceManifest.scripts['verify:vsix'],
            },
        }),
        'README.md': '# Packaging fixture\n',
        'LICENSE.txt': fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
        '.vscodeignore': 'scripts/**\n',
        'out/extension.js': 'exports.activate = () => {};\n',
        'out/webview/index.html': '<html></html>',
        'out/webview/webview.js': 'console.log("test");',
        'scripts/verify-vsix.js': fs.readFileSync(path.join(root, 'apps/extension/scripts/verify-vsix.js'), 'utf8'),
    };
    for (const [file, contents] of Object.entries(files)) {
        const location = path.join(extension, file);
        fs.mkdirSync(path.dirname(location), { recursive: true });
        fs.writeFileSync(location, contents);
    }
    const output = path.join(temporary, 'out/intelli-git-0.0.11.vsix');
    assert.equal(fs.existsSync(path.dirname(output)), false);
    const result = spawnSync('npm', ['run', 'package'], {
        cwd: extension,
        env: { ...process.env, PATH: `${path.join(root, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` },
        encoding: 'utf8',
        timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(output), true);
    assert.match(result.stdout, /VSIX package verified:/);
});

test('VSIX checks allow source and maps but reject invalid versions, missing outputs and unwanted files', (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-vsix-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const files = {
        'extension/package.json': JSON.stringify({ name: 'intelli-git', publisher: 'boyan01', version: '0.0.11' }),
        'extension/out/extension.js': 'console.log("__IS_EXPIRED__");',
        'extension/out/webview/index.html': '<html></html>',
        'extension/out/webview/webview.js': 'console.log("test");',
        'extension/src/example.ts': 'export const value = 1;',
        'extension/out/extension.js.map': '{}',
    };
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
        fs.writeFileSync(path.join(temporary, file), contents);
    }
    const vsix = path.join(temporary, 'test.vsix');
    const pack = () => {
        fs.rmSync(vsix, { force: true });
        execFileSync('zip', ['-qr', vsix, 'extension'], { cwd: temporary });
    };
    const verify = (version = '0.0.11') => {
        const result = spawnSync(
            process.execPath,
            [path.join(root, 'apps/extension/scripts/verify-vsix.js'), vsix, '--version', version],
            { encoding: 'utf8' }
        );
        return { status: result.status, output: result.stdout + result.stderr };
    };
    pack();
    assert.equal(verify().status, 0);
    assert.match(verify('0.0.12').output, /Expected version/);
    for (const file of [
        'extension/.env',
        'extension/.npmrc',
        'extension/private-key.pem',
        'extension/example.test.ts',
        'extension/old.vsix',
        'extension/.agents/notes.md',
    ]) {
        const location = path.join(temporary, file);
        fs.mkdirSync(path.dirname(location), { recursive: true });
        fs.writeFileSync(location, 'test');
        pack();
        const result = verify();
        assert.equal(result.status, 1, file);
        assert.ok(result.output.includes(file), result.output);
        fs.rmSync(location);
    }
    fs.rmSync(path.join(temporary, 'extension/out/webview/index.html'));
    pack();
    assert.match(verify().output, /Missing required file: extension\/out\/webview\/index.html/);
});

function fixture(t) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-release-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const directory = path.join(temporary, 'repo');
    const state = path.join(temporary, 'state');
    const bin = path.join(temporary, 'bin');
    for (const folder of [
        directory,
        state,
        bin,
        path.join(directory, 'scripts'),
        path.join(directory, 'apps/extension/scripts'),
    ]) {
        fs.mkdirSync(folder, { recursive: true });
    }
    fs.copyFileSync(path.join(root, 'scripts/release.js'), path.join(directory, 'scripts/release.js'));
    fs.copyFileSync(
        path.join(root, 'apps/extension/scripts/verify-vsix.js'),
        path.join(directory, 'apps/extension/scripts/verify-vsix.js')
    );
    fs.writeFileSync(path.join(directory, '.gitignore'), 'out/\nnode_modules/\n');
    fs.writeFileSync(
        path.join(directory, 'apps/extension/package.json'),
        JSON.stringify({ name: 'intelli-git', version: '0.0.11' })
    );
    fs.writeFileSync(
        path.join(directory, 'package-lock.json'),
        JSON.stringify({ packages: { 'apps/extension': { version: '0.0.11' } } })
    );
    fs.writeFileSync(
        path.join(directory, 'apps/extension/CHANGELOG.md'),
        '# Changelog\n\n## 0.0.11\n\n- Fixed branch switching.\n\n## 0.0.10\n\n- Previous release.\n'
    );
    const git = (...args) =>
        execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Release Test');
    git('config', 'user.email', 'release-test@example.invalid');
    const commit = () => {
        git('add', '.');
        git('commit', '-qm', 'Prepare test release');
    };
    commit();
    const execute = (command, value, env = {}) => {
        const result = spawnSync(process.execPath, ['scripts/release.js', command, value], {
            cwd: directory,
            env: {
                ...process.env,
                PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                FAKE_RELEASE_STATE: state,
                GITHUB_ACTIONS: 'true',
                GITHUB_REPOSITORY: 'boyan01/intelli-git',
                VSCE_PAT: 'test-marketplace',
                OVSX_PAT: 'test-open-vsx',
                ...env,
            },
            encoding: 'utf8',
        });
        return { status: result.status, output: result.stdout + result.stderr };
    };
    const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const state = process.env.FAKE_RELEASE_STATE;
const args = process.argv.slice(2);
const store = path.join(state, 'release.json');
const assets = path.join(state, 'assets');
const read = () => fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : null;
const write = value => fs.writeFileSync(store, JSON.stringify(value));
fs.mkdirSync(assets, { recursive: true });
if (['vsce', 'ovsx'].includes(path.basename(process.argv[1]))) {
    const channel = process.argv[1].includes('/ovsx/') ? 'open-vsx' : 'marketplace';
    fs.appendFileSync(path.join(state, 'calls'), 'publish:' + channel + '\\n');
    if (channel === 'open-vsx' && process.env.FAIL_OPEN_VSX === 'true') process.exit(1);
    const file = args.at(-1);
    fs.appendFileSync(path.join(state, 'published'), channel + ' ' + require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '\\n');
} else if (path.basename(process.argv[1]) === 'npm') {
    const script = args[1];
    fs.appendFileSync(path.join(state, 'calls'), script + '\\n');
    if (script === 'package:extension') {
        const source = path.resolve('out/package');
        fs.mkdirSync(path.join(source, 'extension/out/webview'), { recursive: true });
        fs.writeFileSync(path.join(source, 'extension/package.json'), JSON.stringify({ version: '0.0.11', name: 'intelli-git', publisher: 'boyan01' }));
        fs.writeFileSync(path.join(source, 'extension/out/extension.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(source, 'extension/out/webview/index.html'), '<html></html>');
        fs.writeFileSync(path.join(source, 'extension/out/webview/webview.js'), 'console.log("test");');
        execFileSync('zip', ['-qr', '../intelli-git-0.0.11.vsix', 'extension'], { cwd: source });
    }
} else if (args[0] === 'api') {
    const endpoint = args.at(-1);
    if (endpoint.includes('git/ref/tags')) console.log(JSON.stringify({ object: { type: 'tag', sha: 'annotated-tag' } }));
    else if (endpoint.includes('git/tags')) console.log(JSON.stringify({ object: { type: 'commit', sha: process.env.REMOTE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } }));
    else console.log(JSON.stringify([read() ? [read()] : []]));
} else if (args[0] === 'release') {
    const operation = args[1];
    if (operation === 'create') {
        const files = args.slice(-2);
        const release = { tag_name: args[2], draft: true, assets: files.map(file => ({ name: path.basename(file) })) };
        for (const file of files) fs.copyFileSync(file, path.join(assets, path.basename(file)));
        write(release);
        fs.writeFileSync(path.join(state, 'notes'), fs.readFileSync(args[args.indexOf('--notes-file') + 1]));
    } else if (operation === 'download') {
        const name = args[args.indexOf('--pattern') + 1];
        fs.copyFileSync(path.join(assets, name), path.join(args[args.indexOf('--dir') + 1], name));
    } else if (operation === 'upload') {
        const release = read();
        const file = args[3];
        if (release.assets.some(asset => asset.name === path.basename(file))) process.exit(1);
        fs.copyFileSync(file, path.join(assets, path.basename(file)));
        release.assets.push({ name: path.basename(file) });
        write(release);
    } else if (operation === 'edit') {
        const release = read();
        release.draft = false;
        write(release);
    } else throw new Error('Unexpected release operation');
} else throw new Error('Unexpected command');
`;
    for (const name of ['gh', 'npm']) {
        fs.writeFileSync(path.join(bin, name), mock, { mode: 0o755 });
    }
    for (const module of ['@vscode/vsce/vsce', 'ovsx/bin/ovsx']) {
        const location = path.join(directory, 'node_modules', module);
        fs.mkdirSync(path.dirname(location), { recursive: true });
        fs.writeFileSync(location, mock);
    }
    const ready = () => {
        git('tag', '-a', 'v0.0.11', '-m', 'Release test');
    };
    const clearOutput = () => fs.rmSync(path.join(directory, 'out'), { recursive: true, force: true });
    return { directory, state, git, commit, execute, ready, clearOutput };
}

test('check validates version alignment and the exact clean annotated tag', (t) => {
    const f = fixture(t);
    assert.match(f.execute('check', 'v01.0.0').output, /vX.Y.Z/);
    f.git('tag', 'v0.0.11');
    assert.match(f.execute('check', 'v0.0.11').output, /annotated/);
    f.git('tag', '-d', 'v0.0.11');
    f.git('tag', '-a', 'v0.0.11', '-m', 'Release test');
    assert.equal(f.execute('check', 'v0.0.11').status, 0);
    assert.match(f.execute('check', 'v0.0.12').output, /must match/);
    const lockPath = path.join(f.directory, 'package-lock.json');
    const lock = fs.readFileSync(lockPath);
    fs.writeFileSync(lockPath, JSON.stringify({ packages: { 'apps/extension': { version: '0.0.10' } } }));
    assert.match(f.execute('check', 'v0.0.11').output, /must match/);
    fs.writeFileSync(lockPath, lock);
    fs.writeFileSync(path.join(f.directory, 'unexpected.txt'), 'dirty');
    assert.match(f.execute('check', 'v0.0.11').output, /clean/);
    f.commit();
    assert.match(f.execute('check', 'v0.0.11').output, /HEAD/);
});

test('partial publication resumes the original artifact and skips successful channels', (t) => {
    const f = fixture(t);
    f.ready();
    const first = f.execute('publish', 'v0.0.11', { FAIL_OPEN_VSX: 'true' });
    assert.equal(first.status, 1, first.output);
    const stored = () => JSON.parse(fs.readFileSync(path.join(f.state, 'release.json')));
    assert.equal(stored().draft, true);
    assert.ok(stored().assets.some((asset) => asset.name === 'published-marketplace.json'));
    const notes = fs.readFileSync(path.join(f.state, 'notes'), 'utf8');
    assert.match(notes, /Fixed branch switching/);
    assert.doesNotMatch(notes, /Previous release/);
    assert.match(notes, /\/blob\/v0\.0\.11\/\.agents\/skills\/intelli-git-release\/SKILL.md/);
    f.clearOutput();
    const retry = f.execute('publish', 'v0.0.11');
    assert.equal(retry.status, 0, retry.output);
    assert.equal(stored().draft, false);
    const calls = fs.readFileSync(path.join(f.state, 'calls'), 'utf8').trim().split('\n');
    assert.equal(calls.filter((call) => call === 'package:extension').length, 1);
    assert.equal(calls.filter((call) => call === 'publish:marketplace').length, 1);
    const published = fs.readFileSync(path.join(f.state, 'published'), 'utf8').trim().split('\n');
    assert.equal(published.length, 2);
    assert.equal(published[0].split(' ')[1], published[1].split(' ')[1]);
    f.clearOutput();
    assert.equal(f.execute('publish', 'v0.0.11').status, 0);
    assert.equal(fs.readFileSync(path.join(f.state, 'calls'), 'utf8').trim().split('\n').length, calls.length);
});

test('recovery rejects altered packages, invalid receipts and incomplete historical assets', (t) => {
    const f = fixture(t);
    f.ready();
    assert.equal(f.execute('publish', 'v0.0.11', { FAIL_OPEN_VSX: 'true' }).status, 1);
    f.clearOutput();
    const asset = path.join(f.state, 'assets/intelli-git-0.0.11.vsix');
    const bytes = fs.readFileSync(asset);
    fs.appendFileSync(asset, 'corruption');
    assert.match(f.execute('publish', 'v0.0.11').output, /checksum/);
    fs.writeFileSync(asset, bytes);
    f.clearOutput();
    const receipt = path.join(f.state, 'assets/published-marketplace.json');
    const saved = JSON.parse(fs.readFileSync(receipt));
    saved.commit = 'different-commit';
    fs.writeFileSync(receipt, JSON.stringify(saved));
    assert.match(f.execute('publish', 'v0.0.11').output, /Invalid publication receipt/);
    f.clearOutput();
    fs.writeFileSync(
        path.join(f.state, 'release.json'),
        JSON.stringify({ tag_name: 'v0.0.11', draft: false, assets: [] })
    );
    assert.match(f.execute('publish', 'v0.0.11').output, /lacks managed artifacts/);
});

test('formal publishing refuses local runs, other repositories and moved remote tags', (t) => {
    const f = fixture(t);
    f.ready();
    assert.match(f.execute('publish', 'v0.0.11', { GITHUB_ACTIONS: 'false' }).output, /only runs/);
    assert.match(f.execute('publish', 'v0.0.11', { GITHUB_REPOSITORY: 'someone/fork' }).output, /only runs/);
    assert.match(f.execute('publish', 'v0.0.11', { REMOTE_COMMIT: 'different-commit' }).output, /no longer matches/);
    assert.equal(fs.existsSync(path.join(f.state, 'release.json')), false);
});
