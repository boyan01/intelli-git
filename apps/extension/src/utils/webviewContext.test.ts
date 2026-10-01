import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WEBVIEW_CONTEXT_SECTIONS } from '@shared/webviewContext';

describe('webview context menu contract', () => {
    it('keeps package menu webviewSection clauses aligned with shared section names', () => {
        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { menus?: { 'webview/context'?: Array<{ when?: string }> } };
        };
        const knownSections = new Set<string>(WEBVIEW_CONTEXT_SECTIONS);
        const menuSections = new Set<string>();

        for (const item of packageJson.contributes?.menus?.['webview/context'] || []) {
            const when = item.when || '';
            for (const match of when.matchAll(/webviewSection == '([^']+)'/g)) {
                menuSections.add(match[1]);
            }
        }

        expect(Array.from(menuSections).sort()).toEqual(
            Array.from(menuSections)
                .filter((section) => knownSections.has(section))
                .sort()
        );
    });
});
