import { describe, expect, it } from 'vitest';
import { getVersionCheckState } from './useVersionCheck';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 24);

describe('getVersionCheckState', () => {
    it('expires marketplace builds when the build macro is expired', () => {
        const state = getVersionCheckState({
            buildTime: NOW - (45 * DAY_MS),
            isDevBuild: false,
            isExpired: true,
            now: NOW
        });

        expect(state.isExpired).toBe(true);
        expect(state.needsWarning).toBe(false);
    });

    it('warns before an Early Access build expires', () => {
        const state = getVersionCheckState({
            buildTime: NOW - (24 * DAY_MS),
            isDevBuild: false,
            isExpired: false,
            now: NOW
        });

        expect(state.isExpired).toBe(false);
        expect(state.needsWarning).toBe(true);
        expect(state.daysRemaining).toBe(6);
    });

    it('preserves dev build metadata while expiring dev builds', () => {
        const state = getVersionCheckState({
            buildTime: NOW - (31 * DAY_MS),
            isDevBuild: true,
            isExpired: true,
            now: NOW
        });

        expect(state.isDevBuild).toBe(true);
        expect(state.isExpired).toBe(true);
        expect(state.needsWarning).toBe(false);
    });
});
