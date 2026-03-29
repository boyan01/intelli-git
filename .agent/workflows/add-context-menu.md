---
description: How to add a native context menu to a VS Code Webview element
---

This workflow details the steps to implement a native VS Code context menu item triggered from a Webview element.

## 1. Define the Command in `package.json`

Register the command that will be executed when the menu item is clicked.

```json
"contributes": {
  "commands": [
    {
      "command": "myExtension.doSomething",
      "title": "%myExtension.commands.doSomething.title%" // Use localization key
    }
  ]
}
```

## 2. Configure the Menu in `package.json`

Add the entry to `menus` -> `webview/context`.

*   **command**: The command ID defined in step 1.
*   **when**: Condition to show the menu. Use `webviewSection` to match the specific element context.
*   **group**: Controls sorting and grouping.
    *   `navigation`: Top (e.g., Go to Definition)
    *   `1_modification`: Middle (e.g., Rename, Copy Hash)
    *   `9_cutcopypaste`: Bottom (VS Code default Copy/Paste)

```json
"menus": {
  "webview/context": [
    {
      "command": "myExtension.doSomething",
      "when": "webviewSection == 'myTargetItem'",
      "group": "1_modification"
    }
  ]
}
```

## 3. Trigger in Webview (Frontend)

Add the `data-vscode-context` attribute to the HTML element. The value must be a JSON string.
This data will be passed as arguments to your command.

*   `webviewSection`: Must match the value used in the `when` clause in Step 2.
*   Other properties (e.g., `hash`, `id`) are passed as custom arguments.

```tsx
<div
  className="my-item"
  data-vscode-context={JSON.stringify({ 
    webviewSection: 'myTargetItem', 
    someId: '123' 
  })}
>
  Right click me
</div>
```

## 4. Implement Command (Backend)

Register the command handler in your `activate` function. The `data-vscode-context` object (excluding `webviewSection` by default, though sometimes included depending on VS Code version) is passed as the argument.

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('myExtension.doSomething', (args) => {
        // args matches { webviewSection: 'myTargetItem', someId: '123' }
        if (args && args.someId) {
            console.log('Action on:', args.someId);
        }
    })
);
```

## 5. Internationalization (Optional)

1.  Add the key to `package.nls.json` (and other language files like `package.nls.zh-cn.json`):
    ```json
    "myExtension.commands.doSomething.title": "Do Something"
    ```
2.  Use the key in `package.json`:
    ```json
    "title": "%myExtension.commands.doSomething.title%"
    ```
