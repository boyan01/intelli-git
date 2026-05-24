import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { i18n } from '../utils/i18n';
import { DEFAULT_CUSTOM_OPENAI_API_URL, DEFAULT_CUSTOM_OPENAI_MODEL } from './ai';

interface OpenAiMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface OpenAiApiResponse {
    id?: string;
    choices?: Array<{
        message?: {
            role: string;
            content: string;
        };
        finish_reason?: string;
    }>;
    error?: {
        message: string;
        type?: string;
        code?: string;
    };
}

/**
 * Response wrapper that mimics vscode.LanguageModelChatResponse
 */
class CustomOpenAiChatResponse implements vscode.LanguageModelChatResponse {
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
 * Custom OpenAI compatible model that implements vscode.LanguageModelChat interface
 */
export class CustomOpenAiLanguageModel implements vscode.LanguageModelChat {
    readonly id: string;
    readonly name: string;
    readonly vendor: string = 'custom';
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
        const openAiMessages = this.convertMessages(messages);
        const responseText = await this.sendHttpRequest(openAiMessages);
        return new CustomOpenAiChatResponse(responseText);
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

    private convertMessages(messages: vscode.LanguageModelChatMessage[]): OpenAiMessage[] {
        return messages.map(msg => ({
            role: msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' as const : 'assistant' as const,
            content: this.messageToString(msg)
        }));
    }

    private sendHttpRequest(messages: OpenAiMessage[]): Promise<string> {
        return new Promise((resolve, reject) => {
            let fullUrlString = this.apiUrl;
            if (!fullUrlString.match(/\/chat\/completions\/?$/)) {
                if (!fullUrlString.endsWith('/')) {
                    fullUrlString += '/';
                }
                fullUrlString += 'chat/completions';
            }

            const url = new URL(fullUrlString);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestBody = JSON.stringify({
                model: this.id,
                messages: messages,
                stream: false
            });

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody).toString()
            };

            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: headers
            };

            const req = httpModule.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response: OpenAiApiResponse = JSON.parse(data);

                        if (response.error || res.statusCode && res.statusCode >= 400) {
                            const errorMsg = response.error?.message || `HTTP Status ${res.statusCode}`;
                            reject(new Error(i18n.t('extension.customRequestFailed', errorMsg)));
                            return;
                        }

                        if (response.choices && response.choices.length > 0) {
                            const message = response.choices[0].message;
                            if (message && message.content) {
                                resolve(message.content);
                                return;
                            }
                        }

                        reject(new Error(i18n.t('extension.customRequestFailed', 'No content in response')));
                    } catch (e) {
                        reject(new Error(i18n.t('extension.customRequestFailed', `Failed to parse response: ${e}`)));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(i18n.t('extension.customRequestFailed', e.message)));
            });

            req.write(requestBody);
            req.end();
        });
    }
}

/**
 * Service to get Custom OpenAI Compatible language model
 */
export class OpenAiService {
    getModel(apiKey: string): CustomOpenAiLanguageModel | undefined {
        const config = vscode.workspace.getConfiguration('intelli-git.ai.custom');
        let model = config.get<string>('model', '');
        let apiUrl = config.get<string>('apiUrl', '');

        if (!model) {
            model = DEFAULT_CUSTOM_OPENAI_MODEL;
        }

        if (!apiUrl) {
            apiUrl = DEFAULT_CUSTOM_OPENAI_API_URL;
        }

        return new CustomOpenAiLanguageModel(model, apiKey, apiUrl);
    }
}
