import i18n from '../i18n';

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;

export function formatRelativeDate(date: Date | string | number): string {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    // Within 1 hour
    if (diff < ONE_HOUR && diff >= 0) {
        const minutes = Math.floor(diff / ONE_MINUTE);
        if (minutes < 1) return i18n.t('date.justNow');
        return i18n.t('date.minutesAgo', { count: minutes });
    }

    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * ONE_HOUR);
    const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (targetDay.getTime() === today.getTime()) {
        return i18n.t('date.today', { time: timeStr });
    }

    if (targetDay.getTime() === yesterday.getTime()) {
        return i18n.t('date.yesterday', { time: timeStr });
    }

    return `${d.toLocaleDateString()} ${timeStr}`;
}
