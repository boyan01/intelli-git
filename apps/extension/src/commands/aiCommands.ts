import * as vscode from 'vscode';
import { i18n } from '../utils/i18n';
import { setAiApiKey, type SecretBackedAiProvider } from '../utils/aiSecrets';

interface CopilotModelPickItem extends vscode.QuickPickItem {
    model: vscode.LanguageModelChat;
}

const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';

export function registerAiCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.ai.setApiKey', async () => {
            const provider = await vscode.window.showQuickPick(
                [
                    { label: 'Anthropic', id: 'anthropic' },
                    { label: 'Google', id: 'google' },
                    { label: 'Custom OpenAI-Compatible', id: 'custom' }
                ] satisfies Array<{ label: string; id: SecretBackedAiProvider }>,
                {
                    title: i18n.t('extension.setAiApiKey'),
                    placeHolder: i18n.t('extension.chooseAiProvider')
                }
            );

            if (!provider) {
                return;
            }

            const apiKey = await vscode.window.showInputBox({
                title: i18n.t('extension.setAiApiKey'),
                prompt: i18n.t('extension.enterAiApiKey', provider.label),
                password: true,
                ignoreFocusOut: true
            });

            if (apiKey === undefined) {
                return;
            }

            await setAiApiKey(context, provider.id, apiKey);
            vscode.window.showInformationMessage(
                apiKey.trim()
                    ? i18n.t('extension.aiApiKeySaved', provider.label)
                    : i18n.t('extension.aiApiKeyCleared', provider.label)
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.ai.selectCopilotModel', async () => {
            const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

            if (copilotModels.length === 0) {
                vscode.window.showErrorMessage(i18n.t('extension.noCopilotModelsAvailable'));
                return;
            }

            const currentModel = vscode.workspace.getConfiguration('intelli-git.ai.copilot').get<string>('model', DEFAULT_COPILOT_MODEL);
            const normalizedCurrentModel = currentModel.trim().toLowerCase();

            const items: CopilotModelPickItem[] = copilotModels.map(model => {
                const details = [model.id, model.family].filter(Boolean).join(' • ');
                const isCurrent = [model.id, model.name, model.family]
                    .filter(Boolean)
                    .some(value => value.trim().toLowerCase() === normalizedCurrentModel);

                return {
                    label: model.name || model.id,
                    description: isCurrent ? i18n.t('extension.current') : undefined,
                    detail: details,
                    model
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                title: i18n.t('extension.selectCopilotModel'),
                placeHolder: i18n.t('extension.chooseCopilotModelForCommitGen'),
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected) {
                return;
            }

            await vscode.workspace.getConfiguration('intelli-git.ai.copilot').update(
                'model',
                selected.model.id,
                vscode.ConfigurationTarget.Global
            );

            vscode.window.showInformationMessage(
                i18n.t('extension.copilotModelSetTo', selected.model.name || selected.model.id)
            );
        })
    );
}
