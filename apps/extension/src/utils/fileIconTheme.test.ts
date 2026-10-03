import { describe, expect, it } from 'vitest';
import {
    buildFileIconTheme,
    decodeFontCharacter,
    mapFileIconThemeResources,
    parseJsonWithComments,
} from './fileIconTheme';

const resolveResource = (relativePath: string) => `file:///themes/icons/${relativePath.replace(/^\.\//, '')}`;

describe('parseJsonWithComments', () => {
    it('accepts comments and trailing commas without touching string contents', () => {
        const parsed = parseJsonWithComments(`{
            // line comment
            "a": "http://example.com/*not-a-comment*/",
            /* block */
            "b": [1, 2,],
        }`);

        expect(parsed).toEqual({ a: 'http://example.com/*not-a-comment*/', b: [1, 2] });
    });
});

describe('decodeFontCharacter', () => {
    it('decodes CSS escapes used by font icon themes', () => {
        expect(decodeFontCharacter('\\E001')).toBe('\uE001');
        expect(decodeFontCharacter('A')).toBe('A');
    });
});

describe('buildFileIconTheme', () => {
    const document = {
        iconDefinitions: {
            _file: { iconPath: './file.svg' },
            _ts: { iconPath: './ts.svg' },
            _ts_light: { iconPath: './ts-light.svg' },
            _dts: { iconPath: './dts.svg' },
            _pkg: { iconPath: './pkg.svg' },
            _markdown: { fontCharacter: '\\E002', fontColor: '#519aba' },
            _missing_font: { fontCharacter: '\\E003', fontId: 'other', fontSize: '120%' },
        },
        fonts: [{ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], size: '150%' }],
        file: '_file',
        fileNames: { 'Package.JSON': '_pkg', 'broken.txt': '_does_not_exist' },
        fileExtensions: { TS: '_ts', 'd.ts': '_dts' },
        languageIds: { markdown: '_markdown', unused: '_missing_font' },
        light: { fileExtensions: { ts: '_ts_light' } },
    };
    const languages = [
        { id: 'markdown', extensions: ['.md', '.MARKDOWN'], filenames: ['README'] },
        { id: 'typescript', extensions: ['.ts'] },
    ];

    it('flattens associations, lower-cases keys and drops unresolvable entries', () => {
        const theme = buildFileIconTheme({ id: 'vs-seti', document, colorKind: 'dark', languages, resolveResource });

        expect(theme.file).toBe('_file');
        expect(theme.fileNames).toEqual({ 'package.json': '_pkg' });
        expect(theme.fileExtensions).toEqual({ ts: '_ts', 'd.ts': '_dts' });
        expect(theme.iconDefinitions._ts).toEqual({ iconUri: 'file:///themes/icons/ts.svg' });
        expect(theme.languageExtensions).toEqual({ md: 'markdown', markdown: 'markdown' });
        expect(theme.languageFileNames).toEqual({ readme: 'markdown' });
        expect(theme.languageIds.typescript).toBeUndefined();
    });

    it('resolves font glyphs against the default font', () => {
        const theme = buildFileIconTheme({ id: 'vs-seti', document, colorKind: 'dark', languages, resolveResource });

        expect(theme.fonts).toEqual([
            {
                family: 'intelli-git-icon-vs-seti-seti',
                sources: [{ uri: 'file:///themes/icons/seti.woff', format: 'woff' }],
                weight: undefined,
                style: undefined,
            },
        ]);
        expect(theme.iconDefinitions._markdown).toEqual({
            fontCharacter: '\uE002',
            fontColor: '#519aba',
            fontSize: '150%',
            fontFamily: 'intelli-git-icon-vs-seti-seti',
        });
        expect(theme.iconDefinitions._missing_font).toMatchObject({ fontSize: '120%' });
    });

    it('applies light overrides only for light color themes', () => {
        const dark = buildFileIconTheme({ id: 't', document, colorKind: 'dark', languages, resolveResource });
        const light = buildFileIconTheme({ id: 't', document, colorKind: 'light', languages, resolveResource });
        const highContrast = buildFileIconTheme({
            id: 't',
            document,
            colorKind: 'highContrast',
            languages,
            resolveResource,
        });

        expect(dark.fileExtensions.ts).toBe('_ts');
        expect(light.fileExtensions.ts).toBe('_ts_light');
        expect(highContrast.fileExtensions.ts).toBe('_ts');
    });

    it('flattens folder associations with light overrides', () => {
        const folderDocument = {
            iconDefinitions: {
                _folder: { iconPath: './folder.svg' },
                _folder_open: { iconPath: './folder-open.svg' },
                _folder_src: { iconPath: './folder-src.svg' },
                _folder_src_open: { iconPath: './folder-src-open.svg' },
                _folder_src_light: { iconPath: './folder-src-light.svg' },
            },
            folder: '_folder',
            folderExpanded: '_folder_open',
            folderNames: { SRC: '_folder_src', broken: '_does_not_exist' },
            folderNamesExpanded: { src: '_folder_src_open' },
            light: { folderNames: { src: '_folder_src_light' } },
        };

        const dark = buildFileIconTheme({
            id: 't',
            document: folderDocument,
            colorKind: 'dark',
            languages,
            resolveResource,
        });
        const light = buildFileIconTheme({
            id: 't',
            document: folderDocument,
            colorKind: 'light',
            languages,
            resolveResource,
        });

        expect(dark.folder).toBe('_folder');
        expect(dark.folderExpanded).toBe('_folder_open');
        expect(dark.folderNames).toEqual({ src: '_folder_src' });
        expect(dark.folderNamesExpanded).toEqual({ src: '_folder_src_open' });
        expect(dark.iconDefinitions._folder_open).toEqual({ iconUri: 'file:///themes/icons/folder-open.svg' });
        expect(light.folderNames).toEqual({ src: '_folder_src_light' });
    });

    it('rewrites icon and font URIs for the webview', () => {
        const theme = buildFileIconTheme({ id: 't', document, colorKind: 'dark', languages, resolveResource });
        const mapped = mapFileIconThemeResources(theme, (uri) => uri.replace('file:///', 'https://webview/'));

        expect(mapped.iconDefinitions._ts.iconUri).toBe('https://webview/themes/icons/ts.svg');
        expect(mapped.fonts[0].sources[0].uri).toBe('https://webview/themes/icons/seti.woff');
        expect(theme.iconDefinitions._ts.iconUri).toBe('file:///themes/icons/ts.svg');
    });
});
