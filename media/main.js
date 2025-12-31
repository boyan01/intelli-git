// @ts-check

// Global utility
/**
 * @param {string} text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    // Restore state and convert serialized Sets back to Set objects
    const savedState = vscode.getState();
    /** @type {{ files: Array<{path: string, status: string, staged: boolean}>, branches: {current: string, all: string[]}, amend: boolean, collapsedGroups: Set<string>, groupByDirectory: boolean, stashList: Array<{index: number, message: string, branch: string}>, activeTab: string, expandedStashes: Set<number>, stashFiles: Object.<number, Array<{path: string, status: string}>>, selectedFiles: Set<string>, activeFile: string | null }} */
    let state = savedState ? {
        ...savedState,
        collapsedGroups: new Set(Array.isArray(savedState.collapsedGroups) ? savedState.collapsedGroups : []),
        expandedStashes: new Set(Array.isArray(savedState.expandedStashes) ? savedState.expandedStashes : []),
        selectedFiles: new Set(Array.isArray(savedState.selectedFiles) ? savedState.selectedFiles : []),
        activeFile: savedState.activeFile || null
    } : {
        files: [],
        branches: { current: '', all: [] },
        amend: false,
        collapsedGroups: new Set(),
        groupByDirectory: false,
        stashList: [],
        activeTab: 'commit',
        expandedStashes: new Set(),
        stashFiles: {},
        selectedFiles: new Set(),
        activeFile: null
    };

    const elements = {
        fileList: document.getElementById('file-list'),
        commitMsg: /** @type {HTMLTextAreaElement} */ (document.getElementById('commit-msg')),
        amendCheckbox: /** @type {HTMLInputElement} */ (document.getElementById('amend-checkbox')),
        commitBtn: document.getElementById('commit-btn'),
        commitPushBtn: document.getElementById('commit-push-btn'),
        rollbackBtn: /** @type {HTMLButtonElement} */ (document.getElementById('rollback-btn')),
        stashBtn: /** @type {HTMLButtonElement} */ (document.getElementById('stash-btn'))
    };

    // Helper function to serialize state with Set objects
    function saveState() {
        vscode.setState({
            ...state,
            collapsedGroups: Array.from(state.collapsedGroups || []),
            expandedStashes: Array.from(state.expandedStashes || []),
            selectedFiles: Array.from(state.selectedFiles || [])
        });
    }



    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'update':
                state.files = message.files;
                state.branches = message.branches;
                // On refresh, we might want to update selection?
                // For now, keep existing selection if possible.
                // Or maybe default select everything if selection is empty? 
                // Let's keep it simple: retain selection, clean up missing files.
                if (state.selectedFiles.size === 0 && state.files.length > 0) {
                    // Check if this is the first load?
                }

                // Cleanup missing files from selection
                const filePaths = new Set(state.files.map(f => f.path));
                for (const path of state.selectedFiles) {
                    if (!filePaths.has(path)) {
                        state.selectedFiles.delete(path);
                    }
                }

                // Default: Select all if selection is empty? 
                // Or just respect current state. 
                // If we want default behavior like "Staged" view having everything unchecked initially if unstaged... 
                // But user wants "Default changes list".
                // Let's default to selecting all if nothing is selected? 
                // Or maybe just select modified files by default?
                // Actually, let's select all files by default on FIRST load or if we want.
                // For now, just clean up.

                saveState();
                render();
                break;
            // ... (other cases)
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
            case 'activeFileChange':
                state.activeFile = message.path;
                saveState();
                // Update UI directly without full re-render if possible
                updateActiveFileHighlight();
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
        const checkedCount = state.selectedFiles.size;
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
                        action: () => {
                            vscode.postMessage({ type: 'popStash', index });
                        }
                    },
                    {
                        label: '应用 (Apply)',
                        icon: 'arrow-up',
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

    function updateActiveFileHighlight() {
        document.querySelectorAll('.file-item').forEach(item => {
            const path = /** @type {HTMLElement} */(item).dataset.path;
            if (path === state.activeFile) {
                item.classList.add('active');
                // Optional: scroll into view if needed
                // item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    function attachFileListEventListeners() {
        // Group header click - toggle collapse
        document.querySelectorAll('.file-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if ((/** @type {HTMLElement} */ (e.target)).classList.contains('checkbox')) return;
                const groupId = /** @type {HTMLElement} */(header).dataset.group;
                if (groupId) toggleGroupCollapse(groupId);
            });
        });

        // Group selection (Select/Deselect All)
        document.querySelectorAll('.group-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();

                const isAllSelected = /** @type {HTMLElement} */(e.target).dataset.allSelected === 'true';
                const groupId = /** @type {HTMLElement} */(e.target).dataset.group;

                // Find files in this group - currently hardcoded 'default', but logic handles dynamic
                // Since we merged everything into 'default', we just use state.files essentially
                // But let's assume filtering could happen.

                let groupFiles = state.files; // Default group has all files

                // If it was all selected, we verify unselect all.
                if (isAllSelected) {
                    groupFiles.forEach(f => state.selectedFiles.delete(f.path));
                } else {
                    groupFiles.forEach(f => state.selectedFiles.add(f.path));
                }

                saveState();
                renderFiles(); // Re-render to update checkboxes and counts
            });
        });

        // File selection
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();

                const el = /** @type {HTMLInputElement} */ (cb);
                const path = el.dataset.path;
                if (!path) return;

                if (el.checked) {
                    state.selectedFiles.add(path);
                } else {
                    state.selectedFiles.delete(path);
                }
                saveState();

                // We can just update buttons and this checkbox, OR re-render group header count too.
                // Re-rendering everything is easiest to keep group header "All" state correct.
                renderFiles();
            });
        });

        // Prevent default context menu on file items
        document.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        });

        // File open
        // File open
        document.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ignore if clicked on checkbox
                if (/** @type {HTMLElement} */(e.target).classList.contains('checkbox')) return;

                const path = /** @type {HTMLElement} */(item).dataset.path;
                vscode.postMessage({ type: 'openFile', path });
            });
        });
    }

    /**
     * @param {string} groupId
     */
    function toggleGroupCollapse(groupId) {
        if (!state.collapsedGroups) state.collapsedGroups = new Set();

        if (state.collapsedGroups.has(groupId)) {
            state.collapsedGroups.delete(groupId);
        } else {
            state.collapsedGroups.add(groupId);
        }
        saveState();
        renderFiles();
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

        // Combine and sort all files
        // Sort by staged status (staged first) then by path, or just path?
        // User request: "Default Changelist... don't distinguish staged vs other". 
        // This implies just a flat list? Or just one group.
        // Let's sort by path for consistency.
        const allFiles = [...state.files].sort((a, b) => a.path.localeCompare(b.path));

        let html = renderFileGroup('default', 'Default Changelist', allFiles);

        elements.fileList.innerHTML = html;
        attachFileListEventListeners();
        updateFileActionButtons();
    }

    /**
     * @param {string} groupId
     * @param {string} title
     * @param {Array<{path: string, status: string, staged: boolean}>} files
     */
    function renderFileGroup(groupId, title, files) {
        const isCollapsed = state.collapsedGroups?.has?.(groupId);
        // All checked if every file in this group is in selectedFiles
        const allChecked = files.length > 0 && files.every(f => state.selectedFiles.has(f.path));

        // Count selected files in this group
        const selectedCount = files.filter(f => state.selectedFiles.has(f.path)).length;

        let html = `
            <div data-group="${groupId}">
                <div class="file-group-header ${isCollapsed ? 'collapsed' : ''}" data-group="${groupId}">
                    <input type="checkbox" class="checkbox group-checkbox" ${allChecked ? 'checked' : ''} data-group="${groupId}" data-all-selected="${allChecked}">
                    <span class="arrow codicon codicon-chevron-down"></span>
                    <span class="title">${title}</span>
                    <span class="count">${selectedCount}/${files.length} 个文件</span>
                </div>
        `;

        if (!isCollapsed) {
            files.forEach(file => {
                const statusClass = getStatusClass(file.status);
                const statusIcon = getStatusIcon(file.status);
                const fileName = file.path.split('/').pop();
                const isSelected = state.selectedFiles.has(file.path);
                const isActive = file.path === state.activeFile;

                html += `
                    <div class="file-item ${isActive ? 'active' : ''}" data-path="${escapeHtml(file.path)}">
                        <input type="checkbox" class="checkbox file-checkbox" ${isSelected ? 'checked' : ''} data-path="${escapeHtml(file.path)}">
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
            amend: state.amend,
            files: Array.from(state.selectedFiles)
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
            amend: state.amend,
            files: Array.from(state.selectedFiles)
        });
    });

    // Rollback Button
    elements.rollbackBtn?.addEventListener('click', () => {
        if (state.selectedFiles.size === 0) return;
        vscode.postMessage({
            type: 'rollback',
            files: Array.from(state.selectedFiles)
        });
    });

    // Stash Button
    elements.stashBtn?.addEventListener('click', () => {
        if (state.selectedFiles.size === 0) return;
        vscode.postMessage({
            type: 'stash',
            files: Array.from(state.selectedFiles)
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
