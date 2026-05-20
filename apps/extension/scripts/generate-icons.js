const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { generateFonts, FontAssetType } = require('fantasticon');

const extensionRoot = path.resolve(__dirname, '..');
const iconsDir = path.join(extensionRoot, 'resources', 'icons');
const iconManifestPath = path.join(iconsDir, 'icons.json');
const fontName = 'intelli-git-icons';
const fontPath = path.join(extensionRoot, 'resources', `${fontName}.woff`);
const cssPath = path.join(extensionRoot, 'media', `${fontName}.css`);
const packageJsonPath = path.join(extensionRoot, 'package.json');

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeFileIfChanged(filePath, content, encoding = 'utf8') {
    const isBufferContent = Buffer.isBuffer(content);

    try {
        const current = await fs.readFile(filePath, isBufferContent ? undefined : encoding);
        if (isBufferContent ? current.equals(content) : current === content) {
            return false;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, isBufferContent ? undefined : encoding);
    return true;
}

function formatCodepoint(codepoint) {
    return `\\${codepoint.toUpperCase()}`;
}

function buildIconContribution(icons) {
    return icons.reduce((result, icon) => {
        result[icon.id] = {
            description: icon.description,
            default: {
                fontPath: `resources/${fontName}.woff`,
                fontCharacter: formatCodepoint(icon.codepoint)
            }
        };
        return result;
    }, {});
}

function buildCss(icons) {
    const classes = icons.map(icon => {
        return `.intelli-git-icon-${icon.name}::before {\n    content: "${formatCodepoint(icon.codepoint)}";\n}`;
    }).join('\n\n');

    return `@font-face {
    font-family: "IntelliGitIcons";
    src: url("../resources/${fontName}.woff") format("woff");
    font-weight: normal;
    font-style: normal;
}

.intelli-git-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "IntelliGitIcons";
    font-size: 16px;
    font-style: normal;
    font-weight: normal;
    line-height: 1;
    speak: never;
    text-rendering: auto;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

${classes}
`;
}

async function validateIconSources(icons) {
    const names = new Set();
    const ids = new Set();
    const codepoints = new Set();

    for (const icon of icons) {
        if (!icon.name || !icon.id || !icon.codepoint || !icon.description) {
            throw new Error('Each icon entry must include name, id, codepoint, and description.');
        }
        if (names.has(icon.name)) {
            throw new Error(`Duplicate icon name: ${icon.name}`);
        }
        if (ids.has(icon.id)) {
            throw new Error(`Duplicate icon id: ${icon.id}`);
        }
        if (codepoints.has(icon.codepoint)) {
            throw new Error(`Duplicate icon codepoint: ${icon.codepoint}`);
        }

        names.add(icon.name);
        ids.add(icon.id);
        codepoints.add(icon.codepoint);

        await fs.access(path.join(iconsDir, `${icon.name}.svg`));
    }
}

async function generateIconFont(icons) {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intelli-git-icons-'));

    try {
        await generateFonts({
            inputDir: iconsDir,
            outputDir,
            name: fontName,
            fontTypes: [FontAssetType.WOFF],
            assetTypes: [],
            codepoints: icons.reduce((result, icon) => {
                result[icon.name] = Number.parseInt(icon.codepoint, 16);
                return result;
            }, {}),
            fontHeight: 1000,
            descent: 0,
            normalize: true
        });

        const generatedFont = await fs.readFile(path.join(outputDir, `${fontName}.woff`));
        await writeFileIfChanged(fontPath, generatedFont);
    } finally {
        await fs.rm(outputDir, { recursive: true, force: true });
    }
}

async function updatePackageJson(icons) {
    const packageJson = await readJson(packageJsonPath);
    packageJson.contributes = packageJson.contributes || {};
    packageJson.contributes.icons = buildIconContribution(icons);
    await writeFileIfChanged(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function main() {
    const icons = await readJson(iconManifestPath);
    await validateIconSources(icons);
    await generateIconFont(icons);
    await writeFileIfChanged(cssPath, buildCss(icons));
    await updatePackageJson(icons);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
