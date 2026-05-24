export const EXPIRATION_DAYS = 30;
export const WARNING_DAYS = 23;

export interface VersionCheckState {
    isDevBuild: boolean;
    isExpired: boolean;
    needsWarning: boolean;
    daysRemaining: number;
}

export interface VersionCheckInput {
    buildTime: number;
    isDevBuild: boolean;
    isExpired: boolean;
    now?: number;
}

export function getVersionCheckState(input: VersionCheckInput): VersionCheckState {
    const now = input.now ?? Date.now();
    const daysSinceBuild = (now - input.buildTime) / (1000 * 60 * 60 * 24);
    const isExpired = input.isDevBuild && input.isExpired;

    return {
        isDevBuild: input.isDevBuild,
        isExpired,
        needsWarning: input.isDevBuild && !isExpired && daysSinceBuild >= WARNING_DAYS,
        daysRemaining: Math.max(0, Math.ceil(EXPIRATION_DAYS - daysSinceBuild))
    };
}

export const useVersionCheck = () => {
    const buildTimeStr = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : Date.now().toString();
    const buildTime = parseInt(buildTimeStr, 10);
    const buildChannel = typeof __BUILD_CHANNEL__ !== 'undefined' ? __BUILD_CHANNEL__ : 'marketplace';
    const isDevBuild = typeof __IS_DEV_BUILD__ !== 'undefined' ? __IS_DEV_BUILD__ : buildChannel === 'dev';
    const macroExpired = typeof __IS_EXPIRED__ !== 'undefined' ? __IS_EXPIRED__ : false;

    return getVersionCheckState({
        buildTime,
        isDevBuild,
        isExpired: macroExpired
    });
};
