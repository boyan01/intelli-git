import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileStatus } from '@shared/messages';
import { ReviewedStateService } from './ReviewedStateService';

function createWorkspaceState() {
    const values: Record<string, unknown> = {};
    return {
        values,
        get<T>(key: string): T | undefined {
            return values[key] as T | undefined;
        },
        async update(key: string, value: unknown): Promise<void> {
            values[key] = value;
        },
    };
}

describe('ReviewedStateService', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-reviewed-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('keeps a reviewed mark until the file content changes again', async () => {
        const workspaceState = createWorkspaceState();
        const service = new ReviewedStateService({ workspaceState } as never, root, '/repo');
        fs.writeFileSync(path.join(root, 'a.ts'), 'first\n');
        fs.writeFileSync(path.join(root, 'b.ts'), 'other\n');
        const status: FileStatus[] = [
            { path: 'a.ts', status: 'M', staged: false },
            { path: 'b.ts', status: '?', staged: false },
        ];

        await service.setReviewed(['a.ts'], true);
        expect((await service.apply(status)).map((file) => file.reviewed)).toEqual([true, undefined]);

        // A reload restores the mark from workspace state.
        const reloaded = new ReviewedStateService({ workspaceState } as never, root, '/repo');
        expect((await reloaded.apply(status))[0].reviewed).toBe(true);

        fs.writeFileSync(path.join(root, 'a.ts'), 'second\n');
        expect((await reloaded.apply(status))[0].reviewed).toBeUndefined();

        // Reverting the content does not bring the cleared mark back.
        fs.writeFileSync(path.join(root, 'a.ts'), 'first\n');
        expect((await reloaded.apply(status))[0].reviewed).toBeUndefined();
    });

    it('drops marks for files that are no longer changed and supports unmarking', async () => {
        const workspaceState = createWorkspaceState();
        const service = new ReviewedStateService({ workspaceState } as never, root);
        fs.writeFileSync(path.join(root, 'a.ts'), 'a\n');
        fs.writeFileSync(path.join(root, 'b.ts'), 'b\n');

        await service.setReviewed(['a.ts', 'b.ts'], true);
        await service.setReviewed(['b.ts'], false);
        await service.apply([]);

        expect(workspaceState.values['intelli-git.reviewedFiles.v1']).toEqual({});
    });
});
