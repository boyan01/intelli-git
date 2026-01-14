# Intelli Git

A VS Code extension that provides an enhanced Git experience with a webview-based UI, inspired by IntelliJ IDEA's Git integration.

## Development

### Prerequisites

- Node.js (v18+)
- VS Code

### Install Dependencies

```bash
# Install extension dependencies
npm install

# Install webview UI dependencies
cd webview-ui && npm install
```

### Build

```bash
# Full build (webview + extension TypeScript)
npm run compile

# Build webview only
npm run build:webview

# Watch mode for extension TypeScript
npm run watch

# Watch mode for webview UI
npm run watch:webview
```

### Package

```bash
# Create a dev .vsix package
npm run package:dev
```

### Development Workflow

1. Run `npm run watch` and `npm run watch:webview` in separate terminals
2. Press `F5` in VS Code to launch the Extension Development Host
3. Make changes and reload the extension host to see updates

## License

Proprietary License - All rights reserved. See LICENSE file for details.
