declare const __BUILD_TIME__: string;
declare const __BUILD_CHANNEL__: 'marketplace' | 'dev';
declare const __IS_DEV_BUILD__: boolean;
declare const __IS_EXPIRED__: boolean;

interface Window {
    vscodeLanguage?: string;
    vscodeState?: unknown;
    initialRoute?: string;
}
