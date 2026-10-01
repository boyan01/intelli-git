#!/usr/bin/env node

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REQUIRED_ENTRIES = [
    'extension/package.json',
    'extension/out/extension.js',
    'extension/out/webview/index.html',
    'extension/out/webview/webview.js',
];
const BLOCKED_ENTRIES = [
    { pattern: /^extension\/(?:\.agent|\.agents|\.codex|\.claude)\//, reason: 'development notes must not ship' },
    { pattern: /^extension\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/, reason: 'tests must not ship' },
    { pattern: /^extension\/.*\.vsix$/, reason: 'previous VSIX packages must not ship' },
    { pattern: /^extension\/(?:.*\/)?\.env(?:\..*)?$/, reason: 'env files must not ship' },
    { pattern: /^extension\/(?:.*\/)?\.npmrc$/, reason: 'npm auth config must not ship' },
    {
        pattern: /^extension\/.*(?:id_rsa|id_ed25519|private-key|private_key|\.pem|\.key)$/,
        reason: 'private key files must not ship',
    },
];

try {
    const [file, flag, expectedVersion, ...extra] = process.argv.slice(2);
    if (!file || flag !== '--version' || !expectedVersion || extra.length) {
        throw new Error('Usage: node scripts/verify-vsix.js <file.vsix> --version <expected-version>');
    }
    const vsix = path.resolve(file);
    const unzip = (args) =>
        execFileSync('unzip', args, {
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
        });
    const entries = unzip(['-Z1', vsix]).split(/\r?\n/).filter(Boolean);
    const issues = REQUIRED_ENTRIES.filter((entry) => !entries.includes(entry)).map(
        (entry) => `Missing required file: ${entry}`
    );
    for (const entry of entries) {
        const blocked = BLOCKED_ENTRIES.find((rule) => rule.pattern.test(entry));
        if (blocked) {
            issues.push(`${entry}: ${blocked.reason}`);
        }
    }
    if (entries.includes('extension/package.json')) {
        const packageJson = JSON.parse(unzip(['-p', vsix, 'extension/package.json']));
        if (packageJson.version !== expectedVersion) {
            issues.push(`Expected version ${expectedVersion}, got ${packageJson.version}.`);
        }
        if (packageJson.name !== 'intelli-git' || packageJson.publisher !== 'boyan01') {
            issues.push('Packaged extension identity must be boyan01.intelli-git.');
        }
    }
    if (issues.length) {
        throw new Error(`VSIX package verification failed:\n${issues.join('\n')}`);
    }
    console.log(`VSIX package verified: ${vsix} (${expectedVersion}, ${entries.length} entries).`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
