import { describe, expect, it } from 'vitest';
import type { FileIconTheme } from '@shared/messages';
import { globToRegExp, hasFolderIcons, resolveFileIcon, resolveFolderIcon } from './fileIconThemeResolver';

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
        languageFilenamePatterns: [],
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

    it('detects languages from file name patterns like VS Code (Dockerfile.prod under Seti)', () => {
        const theme = createTheme({
            iconDefinitions: {
                default: { fontCharacter: '\uE023' },
                docker: { fontCharacter: '\uE025' },
                yaml: { fontCharacter: '\uE026' },
            },
            file: 'default',
            fileNames: {},
            fileExtensions: {},
            languageIds: { dockerfile: 'docker', yaml: 'yaml' },
            languageFileNames: { dockerfile: 'dockerfile' },
            languageExtensions: { dockerfile: 'dockerfile', prod: 'yaml', yml: 'yaml' },
            languageFilenamePatterns: [
                { pattern: '**/deploy/*.yml', languageId: 'dockerfile' },
                { pattern: 'dockerfile.*', languageId: 'dockerfile' },
            ],
        });

        expect(resolveFileIcon(theme, 'Dockerfile.prod')?.fontCharacter).toBe('\uE025');
        expect(resolveFileIcon(theme, 'build/Dockerfile.dev')?.fontCharacter).toBe('\uE025');
        expect(resolveFileIcon(theme, 'Dockerfile')?.fontCharacter).toBe('\uE025');
        expect(resolveFileIcon(theme, 'app/deploy/stack.yml')?.fontCharacter).toBe('\uE025');
        expect(resolveFileIcon(theme, 'app/stack.yml')?.fontCharacter).toBe('\uE026');
        expect(resolveFileIcon(theme, 'notes.prod.txt')?.fontCharacter).toBe('\uE023');
    });

    it('prefers the longest matching pattern and the earliest entry on ties', () => {
        const theme = createTheme({
            languageIds: { markdown: 'markdown', typescript: 'ts', other: 'git' },
            languageFileNames: {},
            languageExtensions: {},
            languageFilenamePatterns: [
                { pattern: '*.spec', languageId: 'typescript' },
                { pattern: '*.spec', languageId: 'other' },
                { pattern: 'readme.*.spec', languageId: 'markdown' },
            ],
        });

        expect(resolveFileIcon(theme, 'a.spec')?.iconUri).toBe('ts.svg');
        expect(resolveFileIcon(theme, 'README.app.spec')?.fontCharacter).toBe('\uE002');
    });

    it('does not use a language icon when a later language without an icon claims the file', () => {
        const theme = createTheme({ languageExtensions: { md: 'mdx' } });
        expect(resolveFileIcon(theme, 'notes.md')?.iconUri).toBe('file.svg');
    });

    it('prefers rules qualified by the parent folder', () => {
        const theme = createTheme({
            iconDefinitions: {
                file: { iconUri: 'file.svg' },
                ini: { iconUri: 'ini.svg' },
                win: { iconUri: 'win.svg' },
                yml: { iconUri: 'yml.svg' },
                workflow: { iconUri: 'workflow.svg' },
                graphql: { iconUri: 'graphql.svg' },
            },
            fileNames: { 'system/win.ini': 'win', '.config/graphqlrc': 'graphql' },
            fileExtensions: { ini: 'ini', yml: 'yml', 'workflows/yml': 'workflow' },
        });

        expect(resolveFileIcon(theme, 'C/Windows/System/WIN.INI')?.iconUri).toBe('win.svg');
        expect(resolveFileIcon(theme, 'win.ini')?.iconUri).toBe('ini.svg');
        expect(resolveFileIcon(theme, 'other/win.ini')?.iconUri).toBe('ini.svg');
        expect(resolveFileIcon(theme, 'repo/.config/graphqlrc')?.iconUri).toBe('graphql.svg');
        expect(resolveFileIcon(theme, '.config/nested/graphqlrc')?.iconUri).toBe('file.svg');
        expect(resolveFileIcon(theme, '.github/workflows/ci.yml')?.iconUri).toBe('workflow.svg');
        expect(resolveFileIcon(theme, 'ci.yml')?.iconUri).toBe('yml.svg');
    });

    it('keeps file name rules above folder-qualified extension rules', () => {
        const theme = createTheme({
            fileNames: { 'ci.yml': 'pkg' },
            fileExtensions: { 'workflows/yml': 'ts' },
        });

        expect(resolveFileIcon(theme, '.github/workflows/ci.yml')?.iconUri).toBe('pkg.svg');
    });

    it('caches results per path, not per base name', () => {
        const theme = createTheme({
            iconDefinitions: { file: { iconUri: 'file.svg' }, win: { iconUri: 'win.svg' } },
            fileNames: { 'system/win.ini': 'win' },
            fileExtensions: {},
        });

        expect(resolveFileIcon(theme, 'system/win.ini')?.iconUri).toBe('win.svg');
        expect(resolveFileIcon(theme, 'other/win.ini')?.iconUri).toBe('file.svg');
        expect(resolveFileIcon(theme, 'system/win.ini')?.iconUri).toBe('win.svg');
    });
});

describe('globToRegExp', () => {
    it('supports the glob syntax used by language contributions', () => {
        expect(globToRegExp('dockerfile.*').test('Dockerfile.prod')).toBe(true);
        expect(globToRegExp('dockerfile.*').test('my.dockerfile')).toBe(false);
        expect(globToRegExp('**/.github/*.yml').test('.github/ci.yml')).toBe(true);
        expect(globToRegExp('**/.github/*.yml').test('a/b/.github/ci.yml')).toBe(true);
        expect(globToRegExp('**/.github/*.yml').test('.github/x/ci.yml')).toBe(false);
        expect(globToRegExp('*.{yml,yaml}').test('a.yaml')).toBe(true);
        expect(globToRegExp('[!a]?.txt').test('bc.txt')).toBe(true);
        expect(globToRegExp('[!a]?.txt').test('ac.txt')).toBe(false);
        expect(globToRegExp('a+b(1).txt').test('a+b(1).txt')).toBe(true);
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

    it('resolves compacted folder paths and prefers rules qualified by the parent folder', () => {
        const theme = createTheme({
            iconDefinitions: {
                folder: { iconUri: 'folder.svg' },
                folderOpen: { iconUri: 'folder-open.svg' },
                workflows: { iconUri: 'folder-workflows.svg' },
                ghWorkflows: { iconUri: 'folder-gh-workflows.svg' },
                ghWorkflowsOpen: { iconUri: 'folder-gh-workflows-open.svg' },
                config: { iconUri: 'folder-config.svg' },
            },
            folder: 'folder',
            folderExpanded: 'folderOpen',
            folderNames: { workflows: 'workflows', '.github/workflows': 'ghWorkflows', 'system/config': 'config' },
            folderNamesExpanded: { '.github/workflows': 'ghWorkflowsOpen' },
        });

        expect(resolveFolderIcon(theme, 'repo/.github/workflows', true)?.iconUri).toBe('folder-gh-workflows-open.svg');
        expect(resolveFolderIcon(theme, '.github/Workflows', false)?.iconUri).toBe('folder-gh-workflows.svg');
        expect(resolveFolderIcon(theme, 'docs/workflows', false)?.iconUri).toBe('folder-workflows.svg');
        expect(resolveFolderIcon(theme, 'docs/workflows', true)?.iconUri).toBe('folder-workflows.svg');
        expect(resolveFolderIcon(theme, 'a/system/config', false)?.iconUri).toBe('folder-config.svg');
        expect(resolveFolderIcon(theme, 'config', false)?.iconUri).toBe('folder.svg');
    });
});

describe('hasFolderIcons', () => {
    it('is false for themes without folder icons, such as Seti', () => {
        expect(hasFolderIcons(createTheme())).toBe(false);
    });

    it('is true when the theme defines a default or named folder icon', () => {
        expect(hasFolderIcons(createTheme({ folder: 'file' }))).toBe(true);
        expect(hasFolderIcons(createTheme({ folderExpanded: 'file' }))).toBe(true);
        expect(hasFolderIcons(createTheme({ folderNames: { src: 'file' } }))).toBe(true);
        expect(hasFolderIcons(createTheme({ folderNamesExpanded: { src: 'file' } }))).toBe(true);
    });
});
