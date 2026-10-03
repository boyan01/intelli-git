import { describe, expect, it } from 'vitest';
import type { FileIconTheme } from '@shared/messages';
import { resolveFileIcon, resolveFolderIcon } from './fileIconThemeResolver';

function createTheme(overrides: Partial<FileIconTheme> = {}): FileIconTheme {
    return {
        id: 'test',
        iconDefinitions: {
            file: { iconUri: 'file.svg' },
            ts: { iconUri: 'ts.svg' },
            dts: { iconUri: 'dts.svg' },
            pkg: { iconUri: 'pkg.svg' },
            git: { iconUri: 'git.svg' },
            markdown: { fontCharacter: '\uE002' },
        },
        fonts: [],
        file: 'file',
        fileNames: { 'package.json': 'pkg' },
        fileExtensions: { ts: 'ts', 'd.ts': 'dts', gitignore: 'git' },
        languageIds: { markdown: 'markdown' },
        languageFileNames: { readme: 'markdown' },
        languageExtensions: { md: 'markdown' },
        folderNames: {},
        folderNamesExpanded: {},
        ...overrides,
    };
}

describe('resolveFileIcon', () => {
    it('prefers file names over extensions', () => {
        const theme = createTheme({ fileExtensions: { json: 'ts' } });
        expect(resolveFileIcon(theme, 'Package.json')?.iconUri).toBe('pkg.svg');
    });

    it('prefers the longest matching extension', () => {
        const theme = createTheme();
        expect(resolveFileIcon(theme, 'index.d.ts')?.iconUri).toBe('dts.svg');
        expect(resolveFileIcon(theme, 'index.TS')?.iconUri).toBe('ts.svg');
        expect(resolveFileIcon(theme, '.gitignore')?.iconUri).toBe('git.svg');
    });

    it('falls back to language icons and then the default file icon', () => {
        const theme = createTheme();
        expect(resolveFileIcon(theme, 'notes.md')?.fontCharacter).toBe('\uE002');
        expect(resolveFileIcon(theme, 'README')?.fontCharacter).toBe('\uE002');
        expect(resolveFileIcon(theme, 'unknown.xyz')?.iconUri).toBe('file.svg');
    });

    it('returns nothing when the theme has no icons', () => {
        const theme = createTheme({ iconDefinitions: {}, file: undefined, fileNames: {}, fileExtensions: {} });
        expect(resolveFileIcon(theme, 'index.ts')).toBeUndefined();
    });
});

describe('resolveFolderIcon', () => {
    const folderTheme = createTheme({
        iconDefinitions: {
            folder: { iconUri: 'folder.svg' },
            folderOpen: { iconUri: 'folder-open.svg' },
            src: { iconUri: 'folder-src.svg' },
            srcOpen: { iconUri: 'folder-src-open.svg' },
            docs: { iconUri: 'folder-docs.svg' },
        },
        folder: 'folder',
        folderExpanded: 'folderOpen',
        folderNames: { src: 'src', docs: 'docs' },
        folderNamesExpanded: { src: 'srcOpen' },
    });

    it('prefers folder name icons and their expanded variants', () => {
        expect(resolveFolderIcon(folderTheme, 'SRC', false)?.iconUri).toBe('folder-src.svg');
        expect(resolveFolderIcon(folderTheme, 'src', true)?.iconUri).toBe('folder-src-open.svg');
        expect(resolveFolderIcon(folderTheme, 'docs', true)?.iconUri).toBe('folder-docs.svg');
    });

    it('falls back to the default folder icons', () => {
        expect(resolveFolderIcon(folderTheme, 'other', false)?.iconUri).toBe('folder.svg');
        expect(resolveFolderIcon(folderTheme, 'other', true)?.iconUri).toBe('folder-open.svg');
        expect(resolveFolderIcon(createTheme({ folder: 'file' }), 'other', true)?.iconUri).toBe('file.svg');
    });

    it('returns nothing when the theme has no folder icons', () => {
        expect(resolveFolderIcon(createTheme(), 'src', true)).toBeUndefined();
    });
});
