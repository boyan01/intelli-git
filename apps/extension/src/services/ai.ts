export const AiProvider = {
    Copilot: 'copilot',
    Codex: 'codex',
    Anthropic: 'anthropic',
    Google: 'google',
    OpenAi: 'custom',
} as const;

export type AiProvider = (typeof AiProvider)[keyof typeof AiProvider];

export const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';
export const DEFAULT_GOOGLE_MODEL = 'gemini-1.5-pro';
export const DEFAULT_CUSTOM_OPENAI_MODEL = 'gpt-3.5-turbo';
export const DEFAULT_GOOGLE_API_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_CUSTOM_OPENAI_API_URL = 'https://api.openai.com/v1';
export const DEFAULT_COMMIT_MESSAGE_PROMPT =
    'Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks.';
export const DEFAULT_PULL_REQUEST_TITLE_PROMPT =
    'Generate a concise pull request title from the provided local commits and changed files. Use imperative mood. Return only the title, no markdown and no quotes.';
export const DEFAULT_PULL_REQUEST_BODY_PROMPT =
    'Generate a pull request body from the provided local commits and changed files. Use markdown with Summary and Testing sections. Keep it factual and do not claim tests were run unless the context says so.';
