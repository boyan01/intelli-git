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
        if (minutes < 1) return i18n.t('just now');
        return i18n.t('{{count}} min ago', { count: minutes });
    }

    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * ONE_HOUR);
    const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (targetDay.getTime() === today.getTime()) {
        return i18n.t('Today {{time}}', { time: timeStr });
    }

    if (targetDay.getTime() === yesterday.getTime()) {
        return i18n.t('Yesterday {{time}}', { time: timeStr });
    }

    return `${d.toLocaleDateString()} ${timeStr}`;
}
