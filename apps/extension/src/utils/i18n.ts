import * as vscode from 'vscode';
import enMessages from '@shared/l10n/bundle.l10n.json';
import zhCnMessages from '@shared/l10n/bundle.l10n.zh-cn.json';

type MessageMap = Record<string, string>;

const defaultMessages = enMessages as MessageMap;
const zhCnLocalizedMessages = zhCnMessages as MessageMap;

function hasMessage(messages: MessageMap, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(messages, key);
}

function formatMessage(message: string, args: (string | number | boolean)[]): string {
    return args.reduce<string>((result, value, index) => result.replaceAll(`{${index}}`, String(value)), message);
}

function getKeyedLocalizedMessage(key: string): string | undefined {
    const language = vscode.env.language.toLowerCase();

    if ((language === 'zh' || language === 'zh-cn') && hasMessage(zhCnLocalizedMessages, key)) {
        return zhCnLocalizedMessages[key];
    }

    return undefined;
}

export const i18n = {
    t: (key: string, ...args: (string | number | boolean)[]) => {
        if (hasMessage(defaultMessages, key) && key.startsWith('extension.')) {
            const message = getKeyedLocalizedMessage(key) ?? defaultMessages[key];
            return formatMessage(message, args);
        }

        return vscode.l10n.t(key, ...args);
    },
};
