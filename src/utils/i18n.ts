import * as vscode from 'vscode';

export const i18n = {
    t: (key: string, ...args: (string | number | boolean)[]) => {
        return vscode.l10n.t(key, ...args);
    }
};
