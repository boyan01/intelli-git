export const AiProvider = {
    Copilot: 'copilot',
    Anthropic: 'anthropic',
    Google: 'google',
    OpenAi: 'custom'
} as const;

export type AiProvider = typeof AiProvider[keyof typeof AiProvider];

export const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';
export const DEFAULT_GOOGLE_MODEL = 'gemini-1.5-pro';
export const DEFAULT_CUSTOM_OPENAI_MODEL = 'gpt-3.5-turbo';
export const DEFAULT_GOOGLE_API_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_CUSTOM_OPENAI_API_URL = 'https://api.openai.com/v1';
export const DEFAULT_COMMIT_MESSAGE_PROMPT = 'Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks.';
