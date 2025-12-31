// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    // Restore state and convert serialized Sets back to Set objects
    const savedState = vscode.getState();
    /** @type {{ files: Array<{path: string, status: string, staged: boolean}>, branches: {current: string, all: string[]}, amend: boolean, collapsedGroups: Set<string>, groupByDirectory: boolean, stashList: Array<{index: number, message: string, branch: string}>, activeTab: string, expandedStashes: Set<number>, stashFiles: Object.<number, Array<{path: string, status: string}>> }} */
    let state = savedState ? {
        ...savedState,
        collapsedGroups: new Set(Array.isArray(savedState.collapsedGroups) ? savedState.collapsedGroups : []),
        expandedStashes: new Set(Array.isArray(savedState.expandedStashes) ? savedState.expandedStashes : [])
    } : {
        files: [],
        branches: { current: '', all: [] },
        amend: false,
        collapsedGroups: new Set(),
        groupByDirectory: false,
        stashList: [],
        activeTab: 'commit',
        expandedStashes: new Set(),
        stashFiles: {}
    };

    const elements = {
        fileList: document.getElementById('file-list'),
        commitMsg: /** @type {HTMLTextAreaElement} */ (document.getElementById('commit-msg')),
        amendCheckbox: /** @type {HTMLInputElement} */ (document.getElementById('amend-checkbox')),
        commitBtn: document.getElementById('commit-btn'),
        commitPushBtn: document.getElementById('commit-push-btn')
    };

    // Helper function to serialize state with Set objects
    function saveState() {
        vscode.setState({
            ...state,
            collapsedGroups: Array.from(state.collapsedGroups || []),
            expandedStashes: Array.from(state.expandedStashes || [])
        });
    }

    /**
     * @param {string} text
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'update':
                state.files = message.files;
                state.branches = message.branches;
                saveState();
                render();
                break;
            case 'clearMessage':
                if (elements.commitMsg) {
                    elements.commitMsg.value = '';
                }
                if (elements.amendCheckbox) {
                    elements.amendCheckbox.checked = false;
                    state.amend = false;
                    saveState();
                }
                break;
            case 'lastCommitMessage':
                if (elements.commitMsg && message.message) {
                    elements.commitMsg.value = message.message;
                }
                break;
            case 'aiGenerating':
                updateAiButtonState(message.generating);
                break;
            case 'generatedCommitMessage':
                if (elements.commitMsg && message.message) {
                    elements.commitMsg.value = message.message;
                }
                break;
            case 'stashList':
                state.stashList = message.stashList;
                saveState();
                renderStashList();
                break;
            case 'stashFiles':
                if (!state.stashFiles) state.stashFiles = {};
                state.stashFiles[message.index] = message.files;
                saveState();
                renderStashList();
                break;
            case 'switchTab':
                switchTab(message.tab);
                break;
        }
    });

    function render() {
        renderFiles();
    }

    function renderStashList() {
        const stashListEl = document.getElementById('stash-list');
        console.log('renderStashList called, stashListEl:', stashListEl, 'state.stashList:', state.stashList);
        if (!stashListEl) return;

        if (!state.stashList || state.stashList.length === 0) {
            stashListEl.innerHTML = '';
            return;
        }

        let html = '';
        for (const stash of state.stashList) {
            const isExpanded = state.expandedStashes?.has(stash.index);
            const files = state.stashFiles?.[stash.index] || [];

            html += `
                <div class="stash-item ${isExpanded ? 'expanded' : ''}" data-index="${stash.index}">
                    <div class="stash-item-header" data-index="${stash.index}">
                        <span class="stash-item-expand">
                            <i class="codicon codicon-chevron-${isExpanded ? 'down' : 'right'}"></i>
                        </span>
                        <span class="stash-item-name">${escapeHtml(stash.message)}</span>
                        ${stash.branch ? `<span class="stash-item-branch"><i class="codicon codicon-git-branch"></i>${escapeHtml(stash.branch)}</span>` : ''}
                    </div>
                    <div class="stash-item-files" data-index="${stash.index}">
                        ${files.map(f => `
                            <div class="stash-file-item" data-stash-index="${stash.index}" data-path="${escapeHtml(f.path)}">
                                <span class="stash-file-status status-${f.status}">${f.status}</span>
                                <span class="stash-file-name">${escapeHtml(f.path)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        stashListEl.innerHTML = html;
        attachStashListEventListeners();
    }

    function updateFileActionButtons() {
        const checkedCount = document.querySelectorAll('.file-checkbox:checked').length;
        const disabled = checkedCount === 0;

        const rollbackBtn = /** @type {HTMLButtonElement} */ (document.getElementById('rollback-btn'));
        const stashBtn = /** @type {HTMLButtonElement} */ (document.getElementById('stash-btn'));

        if (rollbackBtn) rollbackBtn.disabled = disabled;
        if (stashBtn) stashBtn.disabled = disabled;
    }

    function attachStashListEventListeners() {
        // Click on header to expand/collapse
        document.querySelectorAll('.stash-item-header').forEach(header => {
            header.addEventListener('click', () => {
                const index = parseInt(/** @type {HTMLElement} */(header).dataset.index || '0');
                toggleStashExpand(index);
            });

            // Right click for context menu (use VS Code QuickPick)
            // Right click for context menu
            header.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const mouseEvent = /** @type {MouseEvent} */ (e);
                const index = parseInt(/** @type {HTMLElement} */(header).dataset.index || '0');

                const menu = new PopupMenu();
                menu.show([
                    {
                        label: '弹出 (Pop)',
                        icon: 'check',
                        description: '应用并删除',
                        action: () => {
                            vscode.postMessage({ type: 'popStash', index });
                        }
                    },
                    {
                        label: '应用 (Apply)',
                        icon: 'arrow-up',
                        description: '应用不删除',
                        action: () => {
                            vscode.postMessage({ type: 'applyStash', index });
                        }
                    },
                    {
                        type: 'separator'
                    },
                    {
                        label: '删除 (Drop)',
                        icon: 'trash',
                        description: '删除贮藏',
                        danger: true,
                        action: () => {
                            vscode.postMessage({ type: 'dropStash', index });
                        }
                    }
                ], mouseEvent.clientX, mouseEvent.clientY);
            });
        });

        // Click on file to show diff
        document.querySelectorAll('.stash-file-item').forEach(item => {
            item.addEventListener('click', () => {
                const el = /** @type {HTMLElement} */ (item);
                const stashIndex = parseInt(el.dataset.stashIndex || '0');
                const filePath = el.dataset.path || '';
                vscode.postMessage({ type: 'showStashFileDiff', index: stashIndex, filePath });
            });
        });
    }

    function attachFileListEventListeners() {
        // Group header click - toggle collapse
        document.querySelectorAll('.file-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if ((/** @type {HTMLElement} */ (e.target)).classList.contains('checkbox')) return;

                const groupId = /** @type {HTMLElement} */ (header).dataset.group;
                if (!groupId) return;

                if (!state.collapsedGroups) state.collapsedGroups = new Set();

                if (state.collapsedGroups.has(groupId)) {
                    state.collapsedGroups.delete(groupId);
                } else {
                    state.collapsedGroups.add(groupId);
                }
                saveState();
                renderFiles();
            });
        });

        // Group checkbox - stage/unstage all in group
        document.querySelectorAll('.group-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const cb = /** @type {HTMLInputElement} */ (checkbox);
                const isStaged = cb.dataset.staged === 'true';

                if (cb.checked && !isStaged) {
                    vscode.postMessage({ type: 'stage-all' });
                } else if (!cb.checked && isStaged) {
                    vscode.postMessage({ type: 'unstage-all' });
                }
            });
        });

        // File checkbox - stage/unstage individual file
        document.querySelectorAll('.file-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                updateFileActionButtons(); // Update buttons immediately

                const cb = /** @type {HTMLInputElement} */ (checkbox);
                const path = cb.dataset.path;
                if (!path) return;

                vscode.postMessage({
                    type: cb.checked ? 'stage' : 'unstage',
                    path: path
                });
            });
        });

        // File item double-click - open file
        document.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                const path = /** @type {HTMLElement} */ (item).dataset.path;
                if (path) {
                    vscode.postMessage({ type: 'openFile', path });
                }
            });
        });
    }

    /**
     * @param {number} index
     */
    function toggleStashExpand(index) {
        if (!state.expandedStashes) {
            state.expandedStashes = new Set();
        }

        if (state.expandedStashes.has(index)) {
            state.expandedStashes.delete(index);
        } else {
            state.expandedStashes.add(index);
            // Request files if not loaded
            if (!state.stashFiles?.[index]) {
                vscode.postMessage({ type: 'getStashFiles', index });
            }
        }
        saveState();
        renderStashList();
    }

    /**
     * @param {MouseEvent} e
     * @param {number} index
     */
    function showStashContextMenu(e, index) {
        // Remove existing menu
        document.querySelector('.context-menu')?.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="pop"><i class="codicon codicon-check"></i>弹出（应用并删除）</div>
            <div class="context-menu-item" data-action="apply"><i class="codicon codicon-arrow-up"></i>应用（不删除）</div>
            <div class="context-menu-item" data-action="drop"><i class="codicon codicon-trash"></i>删除</div>
        `;
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        document.body.appendChild(menu);

        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = /** @type {HTMLElement} */ (item).dataset.action;
                if (action === 'pop') {
                    vscode.postMessage({ type: 'popStash', index });
                } else if (action === 'apply') {
                    vscode.postMessage({ type: 'applyStash', index });
                } else if (action === 'drop') {
                    vscode.postMessage({ type: 'dropStash', index });
                }
                menu.remove();
            });
        });

        // Close on outside click
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    // Tab switching
    /**
     * @param {string} tabName
     */
    function switchTab(tabName) {
        if (!tabName) return;

        // Update tab active state
        document.querySelectorAll('.tab').forEach(t => {
            const el = /** @type {HTMLElement} */ (t);
            if (el.dataset.tab === tabName) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // Update content visibility
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        const targetContent = document.getElementById(`${tabName}-tab-content`);
        targetContent?.classList.add('active');

        // Save active tab
        state.activeTab = tabName;
        saveState();

        // Load stash list when switching to stash tab
        if (tabName === 'stash') {
            vscode.postMessage({ type: 'getStashList' });
        }
    }

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = /** @type {HTMLElement} */ (tab).dataset.tab;
            if (tabName) {
                switchTab(tabName);
            }
        });
    });



    // Restore active tab on load
    if (state.activeTab && state.activeTab !== 'commit') {
        const tab = document.querySelector(`.tab[data-tab="${state.activeTab}"]`);
        if (tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(`${state.activeTab}-tab-content`)?.classList.add('active');
            if (state.activeTab === 'stash') {
                vscode.postMessage({ type: 'getStashList' });
            }
        }
    }

    function renderFiles() {
        if (!elements.fileList) return;

        if (state.files.length === 0) {
            elements.fileList.innerHTML = '<div class="empty-state">没有更改</div>';
            return;
        }

        const stagedFiles = state.files.filter(f => f.staged);
        const unstagedFiles = state.files.filter(f => !f.staged);

        let html = '';

        // Staged Changes Group
        if (stagedFiles.length > 0) {
            html += renderFileGroup('staged', '已暂存的更改', stagedFiles, true);
        }

        // Unstaged Changes Group
        if (unstagedFiles.length > 0) {
            html += renderFileGroup('changes', '更改', unstagedFiles, false);
        }

        elements.fileList.innerHTML = html;
        attachFileListEventListeners();
        updateFileActionButtons();
    }

    /**
     * @param {string} groupId
     * @param {string} title
     * @param {Array<{path: string, status: string, staged: boolean}>} files
     * @param {boolean} isStaged
     */
    function renderFileGroup(groupId, title, files, isStaged) {
        const isCollapsed = state.collapsedGroups?.has?.(groupId);
        const allChecked = files.every(f => f.staged);

        let html = `
            <div class="file-group" data-group="${groupId}">
                <div class="file-group-header ${isCollapsed ? 'collapsed' : ''}" data-group="${groupId}">
                    <input type="checkbox" class="checkbox group-checkbox" ${allChecked ? 'checked' : ''} data-group="${groupId}" data-staged="${isStaged}">
                    <span class="arrow codicon codicon-chevron-down"></span>
                    <span class="title">${title}</span>
                    <span class="count">${files.length} 个文件</span>
                </div>
        `;

        if (!isCollapsed) {
            files.forEach(file => {
                const statusClass = getStatusClass(file.status);
                const statusIcon = getStatusIcon(file.status);
                const fileName = file.path.split('/').pop();

                html += `
                    <div class="file-item" data-path="${escapeHtml(file.path)}">
                        <input type="checkbox" class="checkbox file-checkbox" ${file.staged ? 'checked' : ''} data-path="${escapeHtml(file.path)}">
                        <i class="codicon ${statusIcon} icon"></i>
                        <span class="name ${statusClass}" title="${escapeHtml(file.path)}">${escapeHtml(fileName || file.path)}</span>
                    </div>
                `;
            });
        }

        html += '</div>';
        return html;
    }

    /**
     * @param {string} status
     */
    function getStatusClass(status) {
        switch (status) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case 'D': return 'deleted';
            case '?': return 'untracked';
            default: return '';
        }
    }

    /**
     * @param {string} status
     */
    function getStatusIcon(status) {
        switch (status) {
            case 'M': return 'codicon-diff-modified';
            case 'A': return 'codicon-diff-added';
            case 'D': return 'codicon-diff-removed';
            case '?': return 'codicon-file';
            default: return 'codicon-file';
        }
    }

    function updateFileActionButtons() {
        const checkedCount = document.querySelectorAll('.file-checkbox:checked').length;
        const disabled = checkedCount === 0;

        const rollbackBtn = /** @type {HTMLButtonElement} */ (document.getElementById('rollback-btn'));
        const stashBtn = /** @type {HTMLButtonElement} */ (document.getElementById('stash-btn'));

        if (rollbackBtn) rollbackBtn.disabled = disabled;
        if (stashBtn) stashBtn.disabled = disabled;
    }

    function attachFileListEventListeners() {
        // ... (previous code) ...

        // File checkbox - stage/unstage individual file
        document.querySelectorAll('.file-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                // Update buttons immediately
                updateFileActionButtons();

                const cb = /** @type {HTMLInputElement} */ (checkbox);
                const path = cb.dataset.path;
                if (!path) return;

                vscode.postMessage({
                    type: cb.checked ? 'stage' : 'unstage',
                    path: path
                });
            });
        });

        // ... (rest of listeners) ...
    }

    // ...

    // Update buttons initially and after render
    const originalRenderFiles = renderFiles;
    // We can't easily wrap renderFiles due to scope, so we'll just add the call at the end of renderFiles definition if possible, 
    // or just ensure we call updateFileActionButtons inside renderFiles.
    // Since I'm replacing attachFileListEventListeners, I can't inject into renderFiles easily without replacing it too.
    // Let's replace attachFileListEventListeners and renderFiles partially or fully.


    // View options dropdown
    let viewOptionsOpen = false;
    document.getElementById('view-options-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = document.getElementById('view-options-btn');
        if (!btn) return;

        // Toggle dropdown
        let dropdown = document.getElementById('view-options-dropdown');
        if (dropdown) {
            dropdown.remove();
            viewOptionsOpen = false;
            return;
        }

        viewOptionsOpen = true;
        dropdown = document.createElement('div');
        dropdown.id = 'view-options-dropdown';
        dropdown.className = 'dropdown-menu';
        dropdown.innerHTML = `
            <label class="dropdown-item">
                <input type="checkbox" id="group-by-dir" ${state.groupByDirectory ? 'checked' : ''}>
                <span>按目录分组</span>
            </label>
        `;
        btn.parentElement?.appendChild(dropdown);

        dropdown.querySelector('#group-by-dir')?.addEventListener('change', (ev) => {
            state.groupByDirectory = /** @type {HTMLInputElement} */ (ev.target).checked;
            saveState();
            renderFiles();
            dropdown?.remove();
            viewOptionsOpen = false;
        });

        // Close on outside click
        const closeDropdown = () => {
            dropdown?.remove();
            viewOptionsOpen = false;
            document.removeEventListener('click', closeDropdown);
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    });

    document.getElementById('expand-all-btn')?.addEventListener('click', () => {
        if (!state.collapsedGroups) state.collapsedGroups = new Set();
        state.collapsedGroups.clear();
        saveState();
        renderFiles();
    });

    document.getElementById('collapse-all-btn')?.addEventListener('click', () => {
        if (!state.collapsedGroups) state.collapsedGroups = new Set();
        state.collapsedGroups.add('staged');
        state.collapsedGroups.add('changes');
        saveState();
        renderFiles();
    });

    // AI Commit Message Button
    document.getElementById('ai-commit-btn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'generateCommitMessage' });
    });

    /**
     * @param {boolean} generating
     */
    function updateAiButtonState(generating) {
        const btn = document.getElementById('ai-commit-btn');
        if (!btn) return;

        if (generating) {
            btn.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';
            btn.setAttribute('disabled', 'true');
        } else {
            btn.innerHTML = '<i class="codicon codicon-sparkle"></i>';
            btn.removeAttribute('disabled');
        }
    }

    // Amend Checkbox
    elements.amendCheckbox?.addEventListener('change', () => {
        state.amend = elements.amendCheckbox?.checked || false;
        saveState();

        if (state.amend) {
            vscode.postMessage({ type: 'getLastCommitMessage' });
        }
    });

    // Commit Button
    elements.commitBtn?.addEventListener('click', () => {
        const msg = elements.commitMsg?.value;
        if (!msg?.trim()) {
            return;
        }
        vscode.postMessage({
            type: 'commit',
            message: msg,
            amend: state.amend
        });
    });

    // Commit and Push Button
    elements.commitPushBtn?.addEventListener('click', () => {
        const msg = elements.commitMsg?.value;
        if (!msg?.trim()) {
            return;
        }
        vscode.postMessage({
            type: 'commitAndPush',
            message: msg,
            amend: state.amend
        });
    });

    // Initial render with cached state
    if (state.files.length > 0) {
        render();
    }

    // Request fresh data
    vscode.postMessage({ type: 'refresh' });

    // Initialize button state
    updateFileActionButtons();
})();
