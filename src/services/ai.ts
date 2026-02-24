export const AiProvider = {
    Copilot: 'copilot',
    Anthropic: 'anthropic',
    Google: 'google',
    OpenAi: 'openai'
} as const;

export type AiProvider = typeof AiProvider[keyof typeof AiProvider];
