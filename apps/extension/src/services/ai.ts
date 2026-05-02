export const AiProvider = {
    Copilot: 'copilot',
    Anthropic: 'anthropic',
    Google: 'google',
    OpenAi: 'custom'
} as const;

export type AiProvider = typeof AiProvider[keyof typeof AiProvider];

export const DEFAULT_COMMIT_MESSAGE_PROMPT = 'Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks.';
