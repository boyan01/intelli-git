import * as vscode from 'vscode';

interface CopilotModelPickItem extends vscode.QuickPickItem {
    model: vscode.LanguageModelChat;
}

const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';

export function registerAiCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.ai.selectCopilotModel', async () => {
            const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

            if (copilotModels.length === 0) {
                vscode.window.showErrorMessage('No GitHub Copilot models are currently available.');
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
                    description: isCurrent ? 'Current' : undefined,
                    detail: details,
                    model
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                title: 'Select Copilot Model',
                placeHolder: 'Choose a GitHub Copilot model for commit message generation',
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

            vscode.window.showInformationMessage(`Copilot model set to ${selected.model.name || selected.model.id}`);
        })
    );
}
