#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const extensionRoot = path.resolve(__dirname, '..');
const RAW_MACROS = [
    '__BUILD_TIME__',
    '__BUILD_CHANNEL__',
    '__IS_DEV_BUILD__',
    '__IS_EXPIRED__'
];
const DEV_VERSION_PATTERN = /-dev\.\d+$/;
const EARLY_ACCESS_EXPIRATION_PATTERN = /Date\.now\(\)\s*-\s*\d+\s*>\s*(?:180\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*(?:1000|1e3)|4320\s*\*\s*60\s*\*\s*60\s*\*\s*(?:1000|1e3)|15552e6|15552000000)/;
const BLOCKED_VSIX_ENTRIES = [
    { pattern: /^extension\/(?:\.agent|\.agents|\.codex|\.claude)\//, reason: 'agent-local notes must not ship' },
    { pattern: /^extension\/(?:src|apps|packages)\//, reason: 'source workspace files must not ship' },
    { pattern: /^extension\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/, reason: 'tests must not ship' },
    { pattern: /^extension\/.*\.map$/, reason: 'source maps must not ship' },
    { pattern: /^extension\/.*\.vsix$/, reason: 'previous VSIX artifacts must not ship' },
    { pattern: /^extension\/(?:.*\/)?\.env(?:\..*)?$/, reason: 'env files must not ship' },
    { pattern: /^extension\/(?:.*\/)?\.npmrc$/, reason: 'npm auth config must not ship' },
    { pattern: /^extension\/.*(?:id_rsa|id_ed25519|private-key|private_key|\.pem|\.key)$/, reason: 'private keys must not ship' }
];

function parseArgs(argv) {
    const args = {
        channel: undefined,
        vsix: undefined
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--channel') {
            args.channel = argv[index + 1];
            index += 1;
        } else if (arg === '--vsix') {
            args.vsix = argv[index + 1];
            index += 1;
        } else if (arg === '--help') {
            printUsage();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (args.channel !== 'marketplace' && args.channel !== 'dev') {
        throw new Error('Pass --channel marketplace or --channel dev.');
    }

    return args;
}

function printUsage() {
    console.log('Usage: node scripts/audit-release-channel.js --channel <marketplace|dev> [--vsix path/to/intelli-git.vsix]');
}

function readTextFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read ${filePath}. Run npm run compile before auditing source outputs. ${error.message}`);
    }
}

function readVsixEntry(vsixPath, entryName) {
    try {
        return execFileSync('unzip', ['-p', vsixPath, entryName], {
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024
        });
    } catch (error) {
        throw new Error(`Unable to read ${entryName} from ${vsixPath}. ${error.message}`);
    }
}

function listVsixEntries(vsixPath) {
    try {
        return execFileSync('unzip', ['-Z1', vsixPath], {
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024
        }).split(/\r?\n/).filter(Boolean);
    } catch (error) {
        throw new Error(`Unable to list ${vsixPath}. ${error.message}`);
    }
}

function readArtifacts(args) {
    if (args.vsix) {
        const vsixPath = path.resolve(args.vsix);
        if (!fs.existsSync(vsixPath)) {
            throw new Error(`VSIX not found: ${vsixPath}`);
        }

        return {
            source: vsixPath,
            packageSource: 'vsix',
            packageJson: JSON.parse(readVsixEntry(vsixPath, 'extension/package.json')),
            entries: listVsixEntries(vsixPath),
            bundles: [
                {
                    name: 'extension/out/extension.js',
                    contents: readVsixEntry(vsixPath, 'extension/out/extension.js')
                },
                {
                    name: 'extension/out/webview/webview.js',
                    contents: readVsixEntry(vsixPath, 'extension/out/webview/webview.js')
                }
            ]
        };
    }

    return {
        source: path.join(extensionRoot, 'out'),
        packageSource: 'source',
        packageJson: JSON.parse(readTextFile(path.join(extensionRoot, 'package.json'))),
        entries: [],
        bundles: [
            {
                name: 'out/extension.js',
                contents: readTextFile(path.join(extensionRoot, 'out/extension.js'))
            },
            {
                name: 'out/webview/webview.js',
                contents: readTextFile(path.join(extensionRoot, 'out/webview/webview.js'))
            }
        ]
    };
}

function auditPackageVersion(packageJson, packageSource, channel, issues) {
    const version = String(packageJson.version || '');
    const isDevVersion = DEV_VERSION_PATTERN.test(version);

    if (channel === 'marketplace' && isDevVersion) {
        issues.push(`Marketplace package version must not include a dev suffix: ${version}`);
    }

    if (channel === 'dev' && packageSource === 'vsix' && !isDevVersion) {
        issues.push(`Dev VSIX package version must include a -dev timestamp suffix: ${version}`);
    }
}

function auditBundle(bundle, channel, issues) {
    for (const macro of RAW_MACROS) {
        if (bundle.contents.includes(macro)) {
            issues.push(`${bundle.name} still contains raw build macro ${macro}`);
        }
    }

    const hasEarlyAccessExpiration = EARLY_ACCESS_EXPIRATION_PATTERN.test(bundle.contents);
    if (hasEarlyAccessExpiration) {
        issues.push(`${bundle.name} still contains the Early Access expiration expression`);
    }
}

function auditVsixEntries(entries, issues) {
    for (const entry of entries) {
        const blocked = BLOCKED_VSIX_ENTRIES.find(item => item.pattern.test(entry));
        if (blocked) {
            issues.push(`${entry}: ${blocked.reason}`);
        }
    }
}

function run() {
    const args = parseArgs(process.argv.slice(2));
    const artifacts = readArtifacts(args);
    const issues = [];

    auditPackageVersion(artifacts.packageJson, artifacts.packageSource, args.channel, issues);
    auditVsixEntries(artifacts.entries, issues);
    for (const bundle of artifacts.bundles) {
        auditBundle(bundle, args.channel, issues);
    }

    if (issues.length > 0) {
        console.error(`Release channel audit failed for ${args.channel} (${artifacts.source}):`);
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log(`Release channel audit passed for ${args.channel} (${artifacts.source}).`);
    console.log(`Package version: ${artifacts.packageJson.version}`);
    if (artifacts.entries.length > 0) {
        console.log(`Checked ${artifacts.entries.length} VSIX entries`);
    }
    for (const bundle of artifacts.bundles) {
        console.log(`Checked ${bundle.name}`);
    }
}

try {
    run();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
