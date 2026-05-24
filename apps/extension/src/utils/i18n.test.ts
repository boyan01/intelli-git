import { afterEach, describe, expect, it } from 'vitest';
import * as vscodeMock from 'vscode';
import { i18n } from './i18n';

const vscodeTestMock = vscodeMock as unknown as {
    __setLanguage(value: string): void;
};

afterEach(() => {
    vscodeTestMock.__setLanguage('en');
});

describe('i18n', () => {
    it('resolves extension message keys to default English text', () => {
        expect(i18n.t('extension.pullSuccess')).toBe('Project updated');
    });

    it('formats extension message keys with positional arguments', () => {
        expect(i18n.t('extension.pullFailed', 'network error')).toBe('Pull failed: network error');
    });

    it('resolves extension message keys to Simplified Chinese when VS Code uses zh-cn', () => {
        vscodeTestMock.__setLanguage('zh-cn');

        expect(i18n.t('extension.pullSuccess')).toBe('项目已更新');
        expect(i18n.t('extension.pullFailed', 'network error')).toBe('拉取失败: network error');
    });

    it('keeps vscode.l10n formatting for source-message calls', () => {
        expect(i18n.t('Checked out {0}', 'main')).toBe('Checked out main');
    });
});
