export const EXPIRATION_DAYS = 30;
export const WARNING_DAYS = 23;

export const useVersionCheck = () => {
    const buildTimeStr = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : Date.now().toString();
    const buildTime = parseInt(buildTimeStr, 10);
    const daysSinceBuild = (Date.now() - buildTime) / (1000 * 60 * 60 * 24);

    const isExpired = typeof __IS_EXPIRED__ !== 'undefined' ? __IS_EXPIRED__ : (daysSinceBuild > EXPIRATION_DAYS);

    return {
        isExpired,
        needsWarning: !isExpired && daysSinceBuild >= WARNING_DAYS,
        daysRemaining: Math.max(0, Math.ceil(EXPIRATION_DAYS - daysSinceBuild))
    };
};
