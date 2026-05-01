import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { i18n } from '../utils/i18n';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface AnthropicApiResponse {
    content: Array<{
        type: string;
        text: string;
    }>;
    error?: {
        message: string;
    };
}

/**
 * Response wrapper that mimics vscode.LanguageModelChatResponse
 */
class AnthropicChatResponse implements vscode.LanguageModelChatResponse {
    private _text: string;

    constructor(text: string) {
        this._text = text;
    }

    get text(): AsyncIterable<string> {
        const text = this._text;
        return {
            async *[Symbol.asyncIterator]() {
                yield text;
            }
        };
    }

    get stream(): AsyncIterable<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | unknown> {
        const text = this._text;
        return {
            async *[Symbol.asyncIterator]() {
                yield new vscode.LanguageModelTextPart(text);
            }
        };
    }
}

/**
 * Anthropic model that implements vscode.LanguageModelChat interface
 */
export class AnthropicLanguageModel implements vscode.LanguageModelChat {
    readonly id: string;
    readonly name: string;
    readonly vendor: string = 'anthropic';
    readonly family: string;
    readonly version: string = '1.0.0';
    readonly maxInputTokens: number = 200000;

    private readonly apiKey: string;
    private readonly apiUrl: string;

    constructor(modelId: string, apiKey: string, apiUrl: string) {
        this.id = modelId;
        this.name = modelId;
        this.family = modelId;
        this.apiKey = apiKey;
        this.apiUrl = apiUrl;
    }

    async sendRequest(
        messages: vscode.LanguageModelChatMessage[],
        _options?: vscode.LanguageModelChatRequestOptions,
        _token?: vscode.CancellationToken
    ): Promise<vscode.LanguageModelChatResponse> {
        const anthropicMessages = this.convertMessages(messages);
        const responseText = await this.sendHttpRequest(anthropicMessages);
        return new AnthropicChatResponse(responseText);
    }

    countTokens(
        _text: string | vscode.LanguageModelChatMessage,
        _token?: vscode.CancellationToken
    ): Thenable<number> {
        // Rough estimation: ~4 chars per token
        const text = typeof _text === 'string' ? _text : this.messageToString(_text);
        return Promise.resolve(Math.ceil(text.length / 4));
    }

    private messageToString(message: vscode.LanguageModelChatMessage): string {
        if (typeof message.content === 'string') {
            return message.content;
        }
        return message.content
            .map(part => {
                if (part instanceof vscode.LanguageModelTextPart) {
                    return part.value;
                }
                return '';
            })
            .join('');
    }

    private convertMessages(messages: vscode.LanguageModelChatMessage[]): AnthropicMessage[] {
        return messages.map(msg => ({
            role: msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' as const : 'assistant' as const,
            content: this.messageToString(msg)
        }));
    }

    private sendHttpRequest(messages: AnthropicMessage[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.apiUrl);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestBody = JSON.stringify({
                model: this.id,
                max_tokens: 1024,
                messages
            });

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            const req = httpModule.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response: AnthropicApiResponse = JSON.parse(data);

                        if (response.error) {
                            reject(new Error(i18n.t('extension.anthropicRequestFailed', response.error.message)));
                            return;
                        }

                        if (response.content && response.content.length > 0) {
                            const textContent = response.content.find(c => c.type === 'text');
                            if (textContent) {
                                resolve(textContent.text);
                                return;
                            }
                        }

                        reject(new Error(i18n.t('extension.anthropicRequestFailed', 'No content in response')));
                    } catch (e) {
                        reject(new Error(i18n.t('extension.anthropicRequestFailed', `Failed to parse response: ${e}`)));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(i18n.t('extension.anthropicRequestFailed', e.message)));
            });

            req.write(requestBody);
            req.end();
        });
    }
}

/**
 * Service to get Anthropic language model
 */
export class AnthropicService {
    getModel(apiKey: string): AnthropicLanguageModel | undefined {
        const config = vscode.workspace.getConfiguration('intelli-git.ai.anthropic');
        const model = config.get<string>('model', '');
        const apiUrl = config.get<string>('apiUrl', '');

        if (!apiKey || !apiUrl) {
            return undefined;
        }

        return new AnthropicLanguageModel(model, apiKey, apiUrl);
    }
}
