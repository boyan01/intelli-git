import * as vscode from 'vscode';
import { i18n } from '../utils/i18n';
import {
    AiProvider,
    DEFAULT_COPILOT_MODEL,
    DEFAULT_CUSTOM_OPENAI_API_URL,
    DEFAULT_CUSTOM_OPENAI_MODEL,
    DEFAULT_GOOGLE_API_URL,
    DEFAULT_GOOGLE_MODEL
} from '../services/ai';
import { getAiApiKey, setAiApiKey, type SecretBackedAiProvider } from '../utils/aiSecrets';
import { listCodexModels, type CodexModel } from '../services/CodexCliService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import type { CommitAiAction } from '@shared/messages';

interface CopilotModelPickItem extends vscode.QuickPickItem {
    model: vscode.LanguageModelChat;
}

interface SecretBackedProviderPickItem extends vscode.QuickPickItem {
    id: SecretBackedAiProvider;
}

type ConfigurableAiProvider = SecretBackedAiProvider | typeof AiProvider.Copilot | typeof AiProvider.Codex;

interface ProviderPickItem extends vscode.QuickPickItem {
    id: ConfigurableAiProvider;
}

interface ProviderActionPickItem extends vscode.QuickPickItem {
    action: 'changeExecutable' | 'setCurrent' | 'setApiKey' | 'clearApiKey' | 'changeModel' | 'changeApiUrl' | 'openSettingsJson';
}

const SECRET_BACKED_PROVIDERS: SecretBackedAiProvider[] = ['anthropic', 'google', 'custom'];

export function registerAiCommands(context: vscode.ExtensionContext, commitViewProvider?: CommitViewProvider) {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.ai.configureProvider', async () => {
            await configureAiProvider(context);
        }),
        vscode.commands.registerCommand('intelli-git.ai.setApiKey', async (provider?: string) => {
            const selectedProvider = isSecretBackedAiProvider(provider)
                ? provider
                : await pickSecretBackedProvider(context);

            if (selectedProvider) {
                await setProviderApiKey(context, selectedProvider);
            }
        }),
        vscode.commands.registerCommand('intelli-git.ai.openCommitPromptSettings', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'intelli-git.ai.commitPrompt');
        })
    );

    if (commitViewProvider) {
        const registerCommitAiAction = (command: string, action: CommitAiAction) => {
            return vscode.commands.registerCommand(command, () => {
                commitViewProvider.triggerCommitAiAction(action);
            });
        };

        context.subscriptions.push(
            registerCommitAiAction('intelli-git.ai.generateMessageFromWebview', 'generateMessage'),
            registerCommitAiAction('intelli-git.ai.generateSubjectFromWebview', 'generateSubject'),
            registerCommitAiAction('intelli-git.ai.generateBodyFromWebview', 'generateBody'),
            registerCommitAiAction('intelli-git.ai.rewriteSelectionFromWebview', 'rewriteSelection'),
            registerCommitAiAction('intelli-git.ai.configureProviderFromWebview', 'configureProvider'),
            registerCommitAiAction('intelli-git.ai.selectCopilotModelFromWebview', 'selectCopilotModel'),
            registerCommitAiAction('intelli-git.ai.testProviderFromWebview', 'testProvider'),
            registerCommitAiAction('intelli-git.ai.openCommitPromptSettingsFromWebview', 'openCommitPromptSettings')
        );
    }

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
                    iconPath: isCurrent ? new vscode.ThemeIcon('check') : undefined,
                    detail: details,
                    model
                };
            });

            const selected = await showCopilotModelQuickPick(items, {
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

async function showCopilotModelQuickPick(
    items: CopilotModelPickItem[],
    options: vscode.QuickPickOptions
): Promise<CopilotModelPickItem | undefined> {
    const currentItem = items.find(item => item.description === i18n.t('extension.current'));
    const quickPick = vscode.window.createQuickPick<CopilotModelPickItem>();

    quickPick.title = options.title;
    quickPick.placeholder = options.placeHolder;
    quickPick.matchOnDescription = options.matchOnDescription ?? false;
    quickPick.matchOnDetail = options.matchOnDetail ?? false;
    quickPick.items = items;
    if (currentItem) {
        quickPick.activeItems = [currentItem];
    }

    return new Promise(resolve => {
        const disposables: vscode.Disposable[] = [];
        disposables.push(
            quickPick.onDidAccept(() => {
                resolve(quickPick.selectedItems[0] || quickPick.activeItems[0]);
                quickPick.hide();
            }),
            quickPick.onDidHide(() => {
                resolve(undefined);
                for (const disposable of disposables) {
                    disposable.dispose();
                }
                quickPick.dispose();
            })
        );

        quickPick.show();
    });
}

async function configureAiProvider(context: vscode.ExtensionContext): Promise<void> {
    const provider = await pickConfigurableProvider(context);

    if (!provider) {
        return;
    }

    const action = await pickProviderAction(context, provider);

    if (!action) {
        return;
    }

    if (action === 'setCurrent') {
        await setCurrentProvider(provider);
        return;
    }

    if (action === 'setApiKey' && isSecretBackedAiProvider(provider)) {
        await setProviderApiKey(context, provider);
        return;
    }

    if (action === 'clearApiKey' && isSecretBackedAiProvider(provider)) {
        await setAiApiKey(context, provider, '');
        vscode.window.showInformationMessage(i18n.t('extension.aiApiKeyCleared', getProviderLabel(provider)));
        return;
    }

    if (action === 'changeExecutable') {
        const config = vscode.workspace.getConfiguration('intelli-git.ai.codex');
        const executable = await vscode.window.showInputBox({
            title: i18n.t('extension.codexExecutable'),
            prompt: i18n.t('extension.codexExecutablePrompt'),
            value: config.get<string>('path', 'codex'),
            ignoreFocusOut: true
        });
        if (executable !== undefined) {
            await config.update('path', executable.trim() || 'codex', vscode.ConfigurationTarget.Global);
        }
        return;
    }

    if (action === 'changeModel') {
        await changeProviderModel(provider);
        return;
    }

    if (action === 'changeApiUrl' && isSecretBackedAiProvider(provider)) {
        await changeProviderApiUrl(provider);
        return;
    }

    if (action === 'openSettingsJson') {
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    }
}

async function pickConfigurableProvider(context: vscode.ExtensionContext): Promise<ConfigurableAiProvider | undefined> {
    const currentProvider = getCurrentProvider();
    const items: ProviderPickItem[] = [
        {
            label: getProviderLabel(AiProvider.Copilot),
            description: currentProvider === AiProvider.Copilot ? i18n.t('extension.current') : undefined,
            detail: i18n.t('extension.aiProviderCopilotStatus', getProviderModel(AiProvider.Copilot)),
            id: AiProvider.Copilot
        }
    ];

    items.push({
        label: 'Codex CLI',
        description: currentProvider === AiProvider.Codex ? i18n.t('extension.current') : undefined,
        detail: getCodexConfigurationSummary(),
        id: AiProvider.Codex
    });

    for (const provider of SECRET_BACKED_PROVIDERS) {
        const hasApiKey = Boolean(await getAiApiKey(context, provider));
        const isCurrent = provider === currentProvider;

        items.push({
            label: getProviderLabel(provider),
            description: [
                isCurrent ? i18n.t('extension.current') : undefined,
                hasApiKey ? i18n.t('extension.configured') : i18n.t('extension.apiKeyMissing')
            ].filter(Boolean).join(' • '),
            detail: getSecretBackedProviderDetail(provider),
            id: provider
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        title: i18n.t('extension.configureAiProvider'),
        placeHolder: i18n.t('extension.chooseAiProviderToConfigure'),
        matchOnDescription: true,
        matchOnDetail: true
    });

    return selected?.id;
}

async function pickProviderAction(
    context: vscode.ExtensionContext,
    provider: ConfigurableAiProvider
): Promise<ProviderActionPickItem['action'] | undefined> {
    const actions: ProviderActionPickItem[] = [];
    const isCurrent = provider === getCurrentProvider();

    if (!isCurrent) {
        actions.push({
            label: i18n.t('extension.setAsCurrentProvider'),
            action: 'setCurrent'
        });
    }

    if (provider === AiProvider.Copilot) {
        actions.push({
            label: i18n.t('extension.changeModel'),
            detail: getProviderModel(provider),
            action: 'changeModel'
        });
    } else if (provider === AiProvider.Codex) {
        actions.push(
            { label: i18n.t('extension.codexExecutable'), detail: vscode.workspace.getConfiguration('intelli-git.ai.codex').get<string>('path', 'codex').trim() || 'codex', action: 'changeExecutable' },
            { label: i18n.t('extension.codexModelAndEffort'), detail: getCodexConfigurationSummary(), action: 'changeModel' }
        );
    } else {
        const hasApiKey = Boolean(await getAiApiKey(context, provider));

        actions.push({
            label: hasApiKey ? i18n.t('extension.replaceApiKey') : i18n.t('extension.setApiKey'),
            detail: hasApiKey ? i18n.t('extension.apiKeyConfigured') : i18n.t('extension.apiKeyMissing'),
            action: 'setApiKey'
        });

        if (hasApiKey) {
            actions.push({
                label: i18n.t('extension.clearApiKey'),
                action: 'clearApiKey'
            });
        }

        actions.push(
            {
                label: i18n.t('extension.changeModel'),
                detail: getProviderModel(provider) || i18n.t('extension.notSet'),
                action: 'changeModel'
            },
            {
                label: i18n.t('extension.changeApiUrl'),
                detail: getProviderApiUrl(provider) || i18n.t('extension.notSet'),
                action: 'changeApiUrl'
            }
        );
    }

    actions.push({
        label: i18n.t('extension.openSettingsJson'),
        detail: i18n.t('extension.openSettingsJsonDetail'),
        action: 'openSettingsJson'
    });

    const selected = await vscode.window.showQuickPick(actions, {
        title: i18n.t('extension.configureAiProviderTitle', getProviderLabel(provider)),
        placeHolder: getProviderActionPlaceholder(provider)
    });

    return selected?.action;
}

async function pickSecretBackedProvider(context: vscode.ExtensionContext): Promise<SecretBackedAiProvider | undefined> {
    const selected = await vscode.window.showQuickPick<SecretBackedProviderPickItem>(
        await Promise.all(SECRET_BACKED_PROVIDERS.map(async provider => ({
            label: getProviderLabel(provider),
            description: await getAiApiKey(context, provider)
                ? i18n.t('extension.configured')
                : i18n.t('extension.apiKeyMissing'),
            id: provider
        }))),
        {
            title: i18n.t('extension.setAiApiKey'),
            placeHolder: i18n.t('extension.chooseAiProvider')
        }
    );

    return selected?.id;
}

async function setProviderApiKey(
    context: vscode.ExtensionContext,
    provider: SecretBackedAiProvider
): Promise<void> {
    const providerLabel = getProviderLabel(provider);
    const apiKey = await vscode.window.showInputBox({
        title: i18n.t('extension.setAiApiKey'),
        prompt: i18n.t('extension.enterAiApiKey', providerLabel),
        password: true,
        ignoreFocusOut: true
    });

    if (apiKey === undefined) {
        return;
    }

    await setAiApiKey(context, provider, apiKey);
    vscode.window.showInformationMessage(
        apiKey.trim()
            ? i18n.t('extension.aiApiKeySaved', providerLabel)
            : i18n.t('extension.aiApiKeyCleared', providerLabel)
    );
}

async function setCurrentProvider(provider: ConfigurableAiProvider): Promise<void> {
    await vscode.workspace.getConfiguration('intelli-git.ai').update(
        'provider',
        provider,
        vscode.ConfigurationTarget.Global
    );

    vscode.window.showInformationMessage(i18n.t('extension.aiProviderSetTo', getProviderLabel(provider)));
}

async function changeProviderModel(provider: ConfigurableAiProvider): Promise<void> {
    if (provider === AiProvider.Copilot) {
        await vscode.commands.executeCommand('intelli-git.ai.selectCopilotModel');
        return;
    }

    if (provider === AiProvider.Codex) {
        const selection = await pickCodexModel();
        if (!selection) { return; }
        const config = vscode.workspace.getConfiguration('intelli-git.ai.codex');
        await config.update('reasoningEffort', selection.reasoningEffort, vscode.ConfigurationTarget.Global);
        await config.update('model', selection.model, vscode.ConfigurationTarget.Global);
        return;
    }

    const model = await vscode.window.showInputBox({
        title: i18n.t('extension.changeProviderModelTitle', getProviderLabel(provider)),
        prompt: i18n.t('extension.changeProviderModelPrompt'),
        value: getProviderModel(provider),
        ignoreFocusOut: true
    });

    if (model === undefined) {
        return;
    }

    await vscode.workspace
        .getConfiguration(`intelli-git.ai.${provider}`)
        .update('model', model.trim(), vscode.ConfigurationTarget.Global);
}

async function pickCodexModel(): Promise<{ model: string; reasoningEffort: string } | undefined> {
    const current = getProviderModel(AiProvider.Codex);
    const config = vscode.workspace.getConfiguration('intelli-git.ai.codex');
    const executable = config.get<string>('path', 'codex').trim() || 'codex';
    while (true) {
        let models: CodexModel[] = [];
        let issue: string | undefined;
        let cancelled = false;
        try {
            models = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: i18n.t('extension.codexLoadingModels'),
                cancellable: true
            }, async (_progress, token) => {
                try { return await listCodexModels(executable, token); }
                finally { cancelled = token.isCancellationRequested; }
            });
        } catch (error) {
            issue = error instanceof Error ? error.message : String(error);
        }
        if (cancelled) { return undefined; }
        const items: (vscode.QuickPickItem & { model?: string; action?: 'manual' | 'retry' })[] = [{
            label: i18n.t('extension.codexDefaultModel'),
            description: current === '' ? i18n.t('extension.current') : undefined,
            model: ''
        }];
        items.push(...models.map(model => ({
            label: model.displayName,
            description: [model.model, model.model === current ? i18n.t('extension.current') : undefined,
                model.isDefault ? i18n.t('extension.codexRecommendedModel') : undefined].filter(Boolean).join(' • '),
            detail: model.description,
            model: model.model
        })));
        if (current && !models.some(model => model.model === current)) {
            items.push({ label: current, description: i18n.t('extension.current'), model: current });
        }
        items.push({ label: i18n.t('extension.codexManualModel'), action: 'manual' });
        if (issue || models.length === 0) {
            items.push({ label: i18n.t('extension.codexRetryModels'), detail: issue || i18n.t('extension.codexNoModels'), action: 'retry' });
        }
        const selected = await vscode.window.showQuickPick(items, {
            title: i18n.t('extension.changeProviderModelTitle', 'Codex CLI'),
            placeHolder: issue ? i18n.t('extension.codexModelListFailed') : i18n.t('extension.codexChooseModel'),
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!selected) { return undefined; }
        if (selected.action === 'retry') { continue; }
        let selectedModel = selected.model;
        if (selected.action === 'manual') {
            selectedModel = await vscode.window.showInputBox({
                title: i18n.t('extension.changeProviderModelTitle', 'Codex CLI'),
                prompt: i18n.t('extension.codexModelPrompt'),
                value: current,
                ignoreFocusOut: true
            });
        }
        if (selectedModel === undefined) { return undefined; }
        selectedModel = selectedModel.trim();
        const metadata = selectedModel ? models.find(model => model.model === selectedModel) : models.find(model => model.isDefault);
        const currentEffort = config.get<string>('reasoningEffort', '');
        const efforts = [{
            label: i18n.t('extension.codexDefaultEffort'),
            description: metadata?.defaultReasoningEffort,
            detail: metadata ? undefined : i18n.t('extension.codexUnknownEfforts'),
            effort: ''
        }, ...(metadata?.supportedReasoningEfforts || []).map(option => ({
            label: option.reasoningEffort,
            description: [option.reasoningEffort === currentEffort ? i18n.t('extension.current') : undefined,
                option.reasoningEffort === metadata?.defaultReasoningEffort ? i18n.t('extension.codexRecommendedModel') : undefined].filter(Boolean).join(' • '),
            detail: option.description,
            effort: option.reasoningEffort
        }))];
        const effort = await vscode.window.showQuickPick(efforts, {
            title: i18n.t('extension.codexChooseEffort', metadata?.displayName || selectedModel || i18n.t('extension.codexDefaultModel')),
            placeHolder: i18n.t('extension.codexEffortPrompt'),
            matchOnDescription: true
        });
        if (!effort) { return undefined; }
        return { model: selectedModel, reasoningEffort: effort.effort };
    }
}

async function changeProviderApiUrl(provider: SecretBackedAiProvider): Promise<void> {
    const apiUrl = await vscode.window.showInputBox({
        title: i18n.t('extension.changeProviderApiUrlTitle', getProviderLabel(provider)),
        prompt: i18n.t('extension.changeProviderApiUrlPrompt'),
        value: getProviderApiUrl(provider),
        ignoreFocusOut: true
    });

    if (apiUrl === undefined) {
        return;
    }

    await vscode.workspace
        .getConfiguration(`intelli-git.ai.${provider}`)
        .update('apiUrl', apiUrl.trim(), vscode.ConfigurationTarget.Global);
}

function getCurrentProvider(): ConfigurableAiProvider {
    const provider = vscode.workspace.getConfiguration('intelli-git.ai').get<string>('provider', AiProvider.Copilot);
    return provider === AiProvider.Copilot || provider === AiProvider.Codex || isSecretBackedAiProvider(provider) ? provider : AiProvider.Copilot;
}

function getProviderLabel(provider: ConfigurableAiProvider): string {
    if (provider === AiProvider.Codex) {
        return 'Codex CLI';
    }

    if (provider === AiProvider.Copilot) {
        return 'Copilot';
    }

    if (provider === AiProvider.Anthropic) {
        return 'Anthropic';
    }

    if (provider === AiProvider.Google) {
        return 'Google';
    }

    return 'Custom OpenAI-Compatible';
}

function getProviderModel(provider: ConfigurableAiProvider): string {
    if (provider === AiProvider.Copilot) {
        return vscode.workspace.getConfiguration('intelli-git.ai.copilot').get<string>('model', DEFAULT_COPILOT_MODEL);
    }

    const configuredModel = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`).get<string>('model', '');
    return configuredModel || (provider === AiProvider.Codex ? '' : getProviderDefaultModel(provider));
}

function getProviderApiUrl(provider: SecretBackedAiProvider): string {
    const configuredApiUrl = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`).get<string>('apiUrl', '');
    return configuredApiUrl || getProviderDefaultApiUrl(provider);
}

function getProviderDefaultModel(provider: SecretBackedAiProvider): string {
    if (provider === AiProvider.Google) {
        return DEFAULT_GOOGLE_MODEL;
    }

    if (provider === AiProvider.OpenAi) {
        return DEFAULT_CUSTOM_OPENAI_MODEL;
    }

    return '';
}

function getProviderDefaultApiUrl(provider: SecretBackedAiProvider): string {
    if (provider === AiProvider.Google) {
        return DEFAULT_GOOGLE_API_URL;
    }

    if (provider === AiProvider.OpenAi) {
        return DEFAULT_CUSTOM_OPENAI_API_URL;
    }

    return '';
}

function getSecretBackedProviderDetail(provider: SecretBackedAiProvider): string {
    return [
        i18n.t('extension.providerModelDetail', getProviderModel(provider) || i18n.t('extension.notSet')),
        i18n.t('extension.providerApiUrlDetail', getProviderApiUrl(provider) || i18n.t('extension.notSet'))
    ].join(' • ');
}

function getCodexConfigurationSummary(): string {
    const config = vscode.workspace.getConfiguration('intelli-git.ai.codex');
    return i18n.t('extension.codexConfigurationSummary',
        config.get<string>('model', '').trim() || i18n.t('extension.codexDefaultModelValue'),
        config.get<string>('reasoningEffort', '').trim() || i18n.t('extension.codexDefaultEffortValue'));
}

function getProviderActionPlaceholder(provider: ConfigurableAiProvider): string {
    if (provider === AiProvider.Codex) {
        return getCodexConfigurationSummary();
    }

    if (provider === AiProvider.Copilot) {
        return i18n.t('extension.providerModelDetail', getProviderModel(provider));
    }

    return getSecretBackedProviderDetail(provider);
}

function isSecretBackedAiProvider(value: unknown): value is SecretBackedAiProvider {
    return value === AiProvider.Anthropic || value === AiProvider.Google || value === AiProvider.OpenAi;
}
