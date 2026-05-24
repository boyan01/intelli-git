import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appRoot, '../..');
const srcRoot = path.join(appRoot, 'src');
const enBundlePath = path.join(repoRoot, 'packages/shared/l10n/bundle.l10n.json');
const zhBundlePath = path.join(repoRoot, 'packages/shared/l10n/bundle.l10n.zh-cn.json');

const ignoredDirectories = new Set(['assets', 'dist', 'node_modules']);
const ignoredFileSuffixes = ['.test.ts', '.test.tsx', '.d.ts'];
const userFacingJsxAttributes = new Set([
  'aria-label',
  'alt',
  'data-tooltip',
  'placeholder',
  'title',
]);

const hardcodedTextIgnores = [
  {
    file: 'src/components/git-log/filter-toolbar/FilterToolbar.tsx',
    kind: 'jsx-text',
    value: 'Cc',
    reason: 'Compact visual marker for the match-case toggle; the localized title provides accessible text.',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativePath(filePath) {
  return toPosixPath(path.relative(appRoot, filePath));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function collectSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...collectSourceFiles(fullPath));
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }

    if (ignoredFileSuffixes.some(suffix => entry.name.endsWith(suffix))) {
      continue;
    }

    files.push(fullPath);
  }

  return files.sort();
}

function getStaticString(node) {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function getHardcodedTextCandidate(node) {
  if (!node) {
    return undefined;
  }

  const staticString = getStaticString(node);
  if (staticString !== undefined) {
    return staticString;
  }

  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
    return parts.join('{{...}}');
  }

  return undefined;
}

function normalizeJsxText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function hasUserFacingText(value) {
  if (!value) {
    return false;
  }

  const withoutEntities = value.replace(/&[a-zA-Z0-9#]+;/g, '');
  return /[A-Za-z\u00C0-\u024F\u4E00-\u9FFF]/.test(withoutEntities);
}

function isUseTranslationCall(node) {
  return !!node
    && ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'useTranslation';
}

function collectTranslationFunctionNames(sourceFile) {
  const names = new Set(['t']);

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && isUseTranslationCall(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const propertyName = element.propertyName;
        if (propertyName && (!ts.isIdentifier(propertyName) || propertyName.text !== 't')) {
          continue;
        }
        if (!propertyName && (!ts.isIdentifier(element.name) || element.name.text !== 't')) {
          continue;
        }
        if (ts.isIdentifier(element.name)) {
          names.add(element.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

function isTranslationCall(node, translationFunctionNames) {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return false;
  }

  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return translationFunctionNames.has(expression.text);
  }

  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'i18n'
    && expression.name.text === 't';
}

function locationOf(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relativePath(sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

function makeIgnoreKey(file, value, kind) {
  return `${file}\u0000${kind}\u0000${value}`;
}

function validateIgnores() {
  const errors = [];
  for (const entry of hardcodedTextIgnores) {
    if (!entry.file || !entry.value || !entry.reason?.trim()) {
      errors.push(`Invalid hardcoded text ignore entry: ${JSON.stringify(entry)}`);
    }
  }
  return errors;
}

function findIgnore(file, value, kind) {
  return hardcodedTextIgnores.find(entry => (
    entry.file === file
    && entry.value === value
    && (!entry.kind || entry.kind === kind)
  ));
}

function addHardcodedTextIssue(issues, usedIgnores, sourceFile, node, value, kind) {
  const normalized = normalizeJsxText(value);
  if (!hasUserFacingText(normalized)) {
    return;
  }

  const file = relativePath(sourceFile.fileName);
  const ignore = findIgnore(file, normalized, kind);
  if (ignore) {
    usedIgnores.add(makeIgnoreKey(ignore.file, ignore.value, ignore.kind || kind));
    return;
  }

  issues.push({
    kind,
    location: locationOf(sourceFile, node),
    value: normalized,
  });
}

function visitSourceFile(filePath, enBundle, zhBundle, issues, usedIgnores, stats) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const translationFunctionNames = collectTranslationFunctionNames(sourceFile);

  function visit(node) {
    if (isTranslationCall(node, translationFunctionNames)) {
      const key = getStaticString(node.arguments[0]);
      if (key) {
        stats.translationKeyCount += 1;
        if (!hasOwn(enBundle, key)) {
          issues.push({
            kind: 'missing-en-key',
            location: locationOf(sourceFile, node.arguments[0]),
            value: key,
          });
        }
        if (!hasOwn(zhBundle, key)) {
          issues.push({
            kind: 'missing-zh-key',
            location: locationOf(sourceFile, node.arguments[0]),
            value: key,
          });
        }
      }
    }

    if (ts.isJsxText(node)) {
      addHardcodedTextIssue(issues, usedIgnores, sourceFile, node, node.getText(sourceFile), 'jsx-text');
    }

    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      const text = getStaticString(node.expression);
      if (text) {
        addHardcodedTextIssue(issues, usedIgnores, sourceFile, node.expression, text, 'jsx-expression');
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
      if (!userFacingJsxAttributes.has(attributeName)) {
        ts.forEachChild(node, visit);
        return;
      }

      const initializer = node.initializer;
      const directText = initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
      const expressionText = initializer && ts.isJsxExpression(initializer)
        ? getHardcodedTextCandidate(initializer.expression)
        : undefined;
      const text = directText ?? expressionText;
      if (text) {
        addHardcodedTextIssue(issues, usedIgnores, sourceFile, initializer, text, 'jsx-attribute');
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function groupIssues(issues) {
  return issues.reduce((groups, issue) => {
    const list = groups.get(issue.kind) || [];
    list.push(issue);
    groups.set(issue.kind, list);
    return groups;
  }, new Map());
}

function printIssues(issues) {
  const labels = new Map([
    ['missing-en-key', 'Missing English l10n keys'],
    ['missing-zh-key', 'Missing zh-cn l10n keys'],
    ['jsx-text', 'Hardcoded JSX text'],
    ['jsx-expression', 'Hardcoded JSX string expressions'],
    ['jsx-attribute', 'Hardcoded user-facing JSX attributes'],
    ['stale-ignore', 'Stale hardcoded text ignore entries'],
    ['invalid-ignore', 'Invalid hardcoded text ignore entries'],
  ]);

  console.error('Webview l10n audit failed.');
  for (const [kind, group] of groupIssues(issues)) {
    console.error(`\n${labels.get(kind) || kind}:`);
    for (const issue of group) {
      if (issue.location) {
        console.error(`  ${issue.location} ${JSON.stringify(issue.value)}`);
      } else {
        console.error(`  ${issue.value}`);
      }
    }
  }
}

function main() {
  const enBundle = readJson(enBundlePath);
  const zhBundle = readJson(zhBundlePath);
  const issues = [];
  const usedIgnores = new Set();
  const stats = { translationKeyCount: 0 };

  for (const message of validateIgnores()) {
    issues.push({ kind: 'invalid-ignore', value: message });
  }

  const sourceFiles = collectSourceFiles(srcRoot);
  for (const filePath of sourceFiles) {
    visitSourceFile(filePath, enBundle, zhBundle, issues, usedIgnores, stats);
  }

  for (const entry of hardcodedTextIgnores) {
    const genericKey = makeIgnoreKey(entry.file, entry.value, entry.kind || 'jsx-text');
    const used = usedIgnores.has(genericKey)
      || usedIgnores.has(makeIgnoreKey(entry.file, entry.value, 'jsx-text'))
      || usedIgnores.has(makeIgnoreKey(entry.file, entry.value, 'jsx-expression'))
      || usedIgnores.has(makeIgnoreKey(entry.file, entry.value, 'jsx-attribute'));
    if (!used) {
      issues.push({
        kind: 'stale-ignore',
        value: `${entry.file} ${JSON.stringify(entry.value)} (${entry.reason})`,
      });
    }
  }

  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }

  console.log(`Webview l10n audit passed. Checked ${sourceFiles.length} files and ${stats.translationKeyCount} static translation keys.`);
}

main();
