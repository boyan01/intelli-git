import { describe, expect, it } from 'vitest';
import {
    deserializePersistedValue,
    legacyPersistedKeys,
    persistedKeys,
    serializePersistedValue,
} from './persistedStateRegistry';

describe('persistedStateRegistry', () => {
    it('round-trips Set-backed feature state', () => {
        const stored = serializePersistedValue('commit.expandedIds', new Set(['root', 'child']));

        expect(stored).toEqual(['root', 'child']);
        expect(deserializePersistedValue('commit.expandedIds', stored)).toEqual(new Set(['root', 'child']));
    });

    it('falls back to the feature default when a Set-backed key has an invalid shape', () => {
        expect(deserializePersistedValue('branchList.expandedIds', 'local')).toEqual(new Set(['local']));
    });

    it('keeps removed historical keys out of the active schema', () => {
        for (const key of legacyPersistedKeys) {
            expect(persistedKeys).not.toContain(key);
        }
    });
});
