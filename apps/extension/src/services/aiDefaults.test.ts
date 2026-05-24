import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_COPILOT_MODEL,
    DEFAULT_CUSTOM_OPENAI_API_URL,
    DEFAULT_CUSTOM_OPENAI_MODEL,
    DEFAULT_GOOGLE_API_URL,
    DEFAULT_GOOGLE_MODEL
} from './ai';

describe('AI provider defaults', () => {
    it('keeps manifest defaults aligned with runtime helpers', () => {
        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const properties = packageJson.contributes.configuration.properties;

        expect(properties['intelli-git.ai.copilot.model'].default).toBe(DEFAULT_COPILOT_MODEL);
        expect(properties['intelli-git.ai.google.model'].default).toBe(DEFAULT_GOOGLE_MODEL);
        expect(properties['intelli-git.ai.google.apiUrl'].default).toBe(DEFAULT_GOOGLE_API_URL);
        expect(properties['intelli-git.ai.custom.model'].default).toBe(DEFAULT_CUSTOM_OPENAI_MODEL);
        expect(properties['intelli-git.ai.custom.apiUrl'].default).toBe(DEFAULT_CUSTOM_OPENAI_API_URL);
    });
});
