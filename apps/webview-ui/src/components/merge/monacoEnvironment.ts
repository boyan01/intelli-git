import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';

// Loaded lazily from monacoRuntime so the worker source stays out of the main webview bundle.
const environment: Monaco.Environment = {
    getWorker() {
        return new EditorWorker();
    },
};

self.MonacoEnvironment = environment;
