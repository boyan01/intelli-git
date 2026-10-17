import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { FileStatus } from '@shared/messages';

const MAX_HASHED_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Remembers which changed files the user has reviewed. Each mark stores a fingerprint of the
 * worktree content, so a file drops back to unreviewed as soon as it is modified again
 * (for example by an AI agent), and marks for files that are no longer changed are discarded.
 */
export class ReviewedStateService {
    private static readonly STORAGE_KEY = 'intelli-git.reviewedFiles.v1';
    private readonly storageKey: string;
    private fingerprints: Record<string, string>;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly workspaceRoot: string,
        repoPath?: string
    ) {
        this.storageKey = repoPath
            ? `${ReviewedStateService.STORAGE_KEY}.${repoPath.replace(/[^a-zA-Z0-9]/g, '_')}`
            : ReviewedStateService.STORAGE_KEY;
        this.fingerprints = { ...(context.workspaceState.get<Record<string, string>>(this.storageKey) || {}) };
    }

    public async setReviewed(paths: string[], reviewed: boolean): Promise<void> {
        for (const filePath of new Set(paths)) {
            if (reviewed) {
                this.fingerprints[filePath] = await this.fingerprint(filePath);
            } else {
                delete this.fingerprints[filePath];
            }
        }
        await this.save();
    }

    /**
     * Drops marks whose file changed again or is no longer changed. Returns true when a mark was
     * dropped, so callers can refresh views even if the Git status itself looks unchanged.
     */
    public async prune(status: FileStatus[]): Promise<boolean> {
        const changedPaths = new Set(status.map((file) => file.path));
        let changed = false;

        for (const [filePath, fingerprint] of Object.entries(this.fingerprints)) {
            if (changedPaths.has(filePath) && (await this.fingerprint(filePath)) === fingerprint) {
                continue;
            }

            delete this.fingerprints[filePath];
            changed = true;
        }

        if (changed) {
            await this.save();
        }
        return changed;
    }

    /** Marks status entries whose content still matches the reviewed fingerprint. */
    public async apply(status: FileStatus[]): Promise<FileStatus[]> {
        await this.prune(status);
        return status.map((file) => (this.fingerprints[file.path] ? { ...file, reviewed: true } : file));
    }

    private async fingerprint(filePath: string): Promise<string> {
        const absolutePath = path.join(this.workspaceRoot, filePath);
        try {
            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) {
                return `entry:${stat.mtimeMs}`;
            }
            if (stat.size > MAX_HASHED_FILE_BYTES) {
                return `large:${stat.size}:${stat.mtimeMs}`;
            }
            const content = await fs.promises.readFile(absolutePath);
            return crypto.createHash('sha1').update(content).digest('hex');
        } catch {
            return 'missing';
        }
    }

    private async save(): Promise<void> {
        await this.context.workspaceState.update(this.storageKey, this.fingerprints);
    }
}
