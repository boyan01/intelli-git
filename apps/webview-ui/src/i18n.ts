import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@shared/l10n/bundle.l10n.json';
import zh from '@shared/l10n/bundle.l10n.zh-cn.json';

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        zh: { translation: zh },
        'zh-cn': { translation: zh }, // Handle lowercase variant
        'zh-CN': { translation: zh }, // Handle uppercase variant
    },
    lng: window.vscodeLanguage || 'en', // Get language from injected global
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false, // React already safe from XSS
    },
    keySeparator: false,
    nsSeparator: false,
});

export default i18n;
