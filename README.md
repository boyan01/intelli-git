# Intelli Git

A VS Code extension that provides an enhanced Git experience with a webview-based UI, inspired by IntelliJ IDEA's Git integration.

## Development

### Prerequisites

- Node.js 22.13.0+ or 20.19.0+
- VS Code

### Install Dependencies

```bash
npm ci
```

### Build

```bash
# Full build (webview + extension TypeScript)
npm run compile

# Build webview only
npm run build:webview --workspace intelli-git

# Watch extension and webview builds together
npm run watch:extension

# Watch mode for webview UI
npm run watch --workspace webview-ui
```

### Quality Checks

```bash
npm run lint
npm run compile
npm run test
```

### Package

```bash
# Create a Marketplace-ready .vsix package
npm run package:extension

# Create a dev .vsix package
npm run package:extension:dev
```

### Publish

```bash
# Requires a Visual Studio Marketplace publisher and vsce login/PAT setup
npm run publish:extension:marketplace
```

### Development Workflow

1. Run `npm run watch:extension`
2. Press `F5` in VS Code to launch the Extension Development Host
3. Make changes and reload the extension host to see updates


## License

Proprietary License - All rights reserved. See LICENSE file for details.
