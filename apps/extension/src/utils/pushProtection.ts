import * as vscode from 'vscode';

const DEFAULT_PROTECTED_PUSH_TARGETS = ['origin/main', 'origin/master'];

function getPushTargetKey(remote: string, branch: string): string {
    return `${remote.trim()}/${branch.trim()}`;
}

export function isProtectedBranchConfirmationEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('intelli-git.push')
        .get<boolean>('confirmProtectedBranch', true);
}

export function getProtectedPushTargets(): string[] {
    return isProtectedBranchConfirmationEnabled()
        ? [...DEFAULT_PROTECTED_PUSH_TARGETS]
        : [];
}

export function isProtectedPushTarget(remote: string, branch: string): boolean {
    if (!isProtectedBranchConfirmationEnabled()) {
        return false;
    }

    return DEFAULT_PROTECTED_PUSH_TARGETS.includes(getPushTargetKey(remote, branch));
}
