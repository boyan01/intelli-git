import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/logger';

interface GoogleMessagePart {
    text: string;
}

interface GoogleMessage {
    role: 'user' | 'model';
    parts: GoogleMessagePart[];
}

interface GoogleApiResponse {
    candidates?: Array<{
        content: {
            parts: Array<{ text: string }>;
            role: string;
        };
    }>;
    error?: {
        message: string;
    };
}

/**
 * Response wrapper that mimics vscode.LanguageModelChatResponse
 */
class GoogleChatResponse implements vscode.LanguageModelChatResponse {
    private _stream: AsyncGenerator<string, void, unknown>;

    constructor(stream: AsyncGenerator<string, void, unknown>) {
        this._stream = stream;
    }

    get text(): AsyncIterable<string> {
        const stream = this._stream;
        return {
            async *[Symbol.asyncIterator]() {
                for await (const chunk of stream) {
                    yield chunk;
                }
            }
        };
    }

    get stream(): AsyncIterable<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | unknown> {
        const stream = this._stream;
        return {
            async *[Symbol.asyncIterator]() {
                for await (const chunk of stream) {
                    yield new vscode.LanguageModelTextPart(chunk);
                }
            }
        };
    }
}

/**
 * Google AI model that implements vscode.LanguageModelChat interface
 */
export class GoogleLanguageModel implements vscode.LanguageModelChat {
    readonly id: string;
    readonly name: string;
    readonly vendor: string = 'google';
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
        const googleMessages = this.convertMessages(messages);
        const stream = await this.sendHttpRequestStream(googleMessages, _token);
        return new GoogleChatResponse(stream);
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

    private convertMessages(messages: vscode.LanguageModelChatMessage[]): GoogleMessage[] {
        return messages.map(msg => ({
            role: msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' as const : 'model' as const,
            parts: [{ text: this.messageToString(msg) }]
        }));
    }

    private sendHttpRequestStream(messages: GoogleMessage[], token?: vscode.CancellationToken): Promise<AsyncGenerator<string, void, unknown>> {
        return new Promise((resolve, reject) => {
            let fullUrlString = this.apiUrl;
            if (fullUrlString.includes('generateContent')) {
                fullUrlString = fullUrlString.replace('generateContent', 'streamGenerateContent');
                if (!fullUrlString.includes('alt=sse')) {
                    fullUrlString += (fullUrlString.includes('?') ? '&' : '?') + 'alt=sse';
                }
            } else {
                if (!fullUrlString.endsWith('/')) {
                    fullUrlString += '/';
                }
                fullUrlString += `v1beta/models/${this.id}:streamGenerateContent?alt=sse`;
            }

            const url = new URL(fullUrlString);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestBody = JSON.stringify({
                contents: messages,
            });

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                    'x-goog-api-key': this.apiKey
                },
                timeout: 60000
            };

            const req = httpModule.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => {
                        errorData += chunk;
                    });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(errorData);
                            reject(new Error(i18n.t('extension.googleRequestFailed', parsed.error?.message || errorData)));
                        } catch {
                            reject(new Error(i18n.t('extension.googleRequestFailed', `HTTP ${res.statusCode}: ${errorData}`)));
                        }
                    });
                    return;
                }

                async function* generateStream() {
                    let buffer = '';
                    for await (const chunk of res) {
                        if (token?.isCancellationRequested) {
                            req.destroy();
                            break;
                        }

                        buffer += chunk.toString('utf-8');
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmedLine = line.trim();
                            if (!trimmedLine) continue;
                            if (trimmedLine.startsWith('data: ')) {
                                const dataStr = trimmedLine.slice(6);
                                if (dataStr === '[DONE]') continue;

                                try {
                                    const response: GoogleApiResponse = JSON.parse(dataStr);
                                    if (response.error) {
                                        logger.error(`[GoogleAiService] Stream returned error:`, response.error);
                                        throw new Error(response.error.message);
                                    }

                                    if (response.candidates && response.candidates.length > 0) {
                                        const content = response.candidates[0].content;
                                        if (content && content.parts && content.parts.length > 0) {
                                            const textChunk = content.parts[0].text;
                                            if (textChunk) {
                                                yield textChunk;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    if (e instanceof Error && e.message === 'Unexpected end of JSON input') {
                                        // Ignore partial JSON parsing errors if any
                                    } else {
                                        logger.error(`[GoogleAiService] Failed to parse stream chunk:`, e, dataStr);
                                    }
                                }
                            }
                        }
                    }
                }

                resolve(generateStream());
            });

            req.on('error', (e) => {
                logger.error(`[GoogleAiService] Request error:`, e.message);
                reject(new Error(i18n.t('extension.googleRequestFailed', e.message)));
            });

            req.on('timeout', () => {
                logger.error(`[GoogleAiService] Request timeout after ${options.timeout}ms`);
                req.destroy();
                reject(new Error(i18n.t('extension.googleRequestFailed', 'Request timeout')));
            });

            token?.onCancellationRequested(() => {
                logger.info(`[GoogleAiService] Request cancelled by user before resolving`);
                req.destroy();
            });

            req.write(requestBody);
            req.end();
        });
    }
}

/**
 * Service to get Google AI language model
 */
export class GoogleAiService {
    getModel(apiKey: string): GoogleLanguageModel | undefined {
        const config = vscode.workspace.getConfiguration('intelli-git.ai.google');
        let model = config.get<string>('model', '');
        let apiUrl = config.get<string>('apiUrl', '');

        if (!model) {
            model = 'gemini-1.5-flash';
        }
        if (!apiUrl) {
            apiUrl = 'https://generativelanguage.googleapis.com';
        }

        if (!apiKey) {
            return undefined;
        }

        return new GoogleLanguageModel(model, apiKey, apiUrl);
    }
}
