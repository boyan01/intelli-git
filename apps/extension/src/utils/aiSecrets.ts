import * as vscode from 'vscode';
import { logger } from './logger';

export type SecretBackedAiProvider = 'anthropic' | 'google' | 'custom';

const SECRET_KEYS: Record<SecretBackedAiProvider, string> = {
    anthropic: 'intelli-git.ai.anthropic.apiKey',
    google: 'intelli-git.ai.google.apiKey',
    custom: 'intelli-git.ai.custom.apiKey',
};

export async function getAiApiKey(context: vscode.ExtensionContext, provider: SecretBackedAiProvider): Promise<string> {
    const secretKey = SECRET_KEYS[provider];
    const stored = await context.secrets.get(secretKey);
    if (stored) {
        return stored;
    }

    const config = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`);
    const legacyValue = config.get<string>('apiKey', '');
    if (!legacyValue) {
        return '';
    }

    await context.secrets.store(secretKey, legacyValue);
    await clearLegacyApiKey(provider);
    logger.info(`[AI] Migrated ${provider} API key from settings to SecretStorage`);
    return legacyValue;
}

export async function setAiApiKey(
    context: vscode.ExtensionContext,
    provider: SecretBackedAiProvider,
    apiKey: string
): Promise<void> {
    const secretKey = SECRET_KEYS[provider];
    if (apiKey.trim()) {
        await context.secrets.store(secretKey, apiKey.trim());
    } else {
        await context.secrets.delete(secretKey);
    }
    await clearLegacyApiKey(provider);
}

async function clearLegacyApiKey(provider: SecretBackedAiProvider): Promise<void> {
    const config = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`);
    const targets = [
        vscode.ConfigurationTarget.Global,
        vscode.ConfigurationTarget.Workspace,
        vscode.ConfigurationTarget.WorkspaceFolder,
    ];

    for (const target of targets) {
        try {
            await config.update('apiKey', undefined, target);
        } catch {
            // Some targets are not available in all workspace shapes.
        }
    }
}
