import { useSyncExternalStore } from 'react';
import type { FileIconFont, FileIconTheme } from '@shared/messages';
import { rpc, rpcEvents } from './rpc_client';

export type FileIconThemeState =
    | { status: 'loading' }
    | { status: 'ready'; theme: FileIconTheme }
    /** The extension could not resolve the VS Code theme; callers fall back to bundled icons. */
    | { status: 'unavailable' };

let state: FileIconThemeState = { status: 'loading' };
let requestSequence = 0;
const listeners = new Set<() => void>();
const loadedFontFamilies = new Set<string>();

function setState(next: FileIconThemeState): void {
    state = next;
    listeners.forEach((listener) => listener());
}

async function loadFonts(fonts: FileIconFont[]): Promise<void> {
    const pending = fonts
        .filter((font) => !loadedFontFamilies.has(font.family))
        .map(async (font) => {
            const source = font.sources
                .map(
                    ({ uri, format }) =>
                        `url(${JSON.stringify(uri)})${format ? ` format(${JSON.stringify(format)})` : ''}`
                )
                .join(', ');
            const face = new FontFace(font.family, source, {
                weight: font.weight,
                style: font.style,
                display: 'block',
            });
            document.fonts.add(face);
            await face.load();
            loadedFontFamilies.add(font.family);
        });
    await Promise.allSettled(pending);
}

async function loadFileIconTheme(): Promise<void> {
    const requestId = ++requestSequence;
    try {
        const theme = await rpc.getFileIconTheme();
        if (theme) {
            // Wait for glyph fonts so rows never flash placeholder characters.
            await loadFonts(theme.fonts);
        }
        if (requestId === requestSequence) {
            setState(theme ? { status: 'ready', theme } : { status: 'unavailable' });
        }
    } catch (error) {
        console.warn('[Intelli Git] Failed to load the file icon theme', error);
        if (requestId === requestSequence && state.status === 'loading') {
            setState({ status: 'unavailable' });
        }
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): FileIconThemeState {
    return state;
}

void loadFileIconTheme();
rpcEvents.fileIconThemeChange.subscribe(() => {
    void loadFileIconTheme();
});

export function useFileIconTheme(): FileIconThemeState {
    return useSyncExternalStore(subscribe, getSnapshot);
}
