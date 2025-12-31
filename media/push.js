// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /** @type {{ commits: any[], files: any[], selectedCommitIndex: number, pushTags: boolean, tagOption: string, config: any }} */
    let state = vscode.getState() || {
        commits: [],
        files: [],
        selectedCommitIndex: 0,
        pushTags: false,
        tagOption: 'all',
        config: null
    };

    const elements = {
        commitsList: document.getElementById('commits-list'),
        filesList: document.getElementById('files-list'),
        pushTagsCheckbox: /** @type {HTMLInputElement} */ (document.getElementById('push-tags')),
        tagOptionSelect: /** @type {HTMLSelectElement} */ (document.getElementById('tag-option')),
        cancelBtn: document.getElementById('cancel-btn'),
        pushBtn: document.getElementById('push-btn'),
        pushDropdownBtn: document.getElementById('push-dropdown-btn'),
        dropdownMenu: document.getElementById('dropdown-menu'),
        loadingOverlay: document.getElementById('loading-overlay'),
        warningBanner: document.getElementById('warning-banner'),
        remoteSelect: /** @type {HTMLSelectElement} */ (document.getElementById('remote-select')),
        remoteBranchInput: /** @type {HTMLInputElement} */ (document.getElementById('remote-branch-input')),
        branchSuggestions: document.getElementById('branch-suggestions')
    };

    // Debug: log element bindings
    console.log('push.js loaded');
    console.log('remoteBranchInput:', elements.remoteBranchInput);
    console.log('branchSuggestions:', elements.branchSuggestions);
    console.log('remoteSelect:', elements.remoteSelect);

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'update':
                state.commits = message.commits || [];
                state.files = message.files || [];
                if (message.config) {
                    state.config = message.config;
                }
                vscode.setState(state);
                render();
                break;
            case 'updateFiles':
                state.files = message.files || [];
                vscode.setState(state);
                renderFiles();
                break;
            case 'pushComplete':
                hideLoading();
                break;
            case 'pushError':
                hideLoading();
                break;
        }
    });

    function render() {
        renderCommits();
        renderFiles();
        updateCommitDetails();
    }

    function renderCommits() {
        if (!elements.commitsList) return;

        if (state.commits.length === 0) {
            elements.commitsList.innerHTML = '<div class="empty-files">No commits to push</div>';
            return;
        }

        elements.commitsList.innerHTML = state.commits.map((commit, index) => `
            <div class="commit-item ${index === state.selectedCommitIndex ? 'selected' : ''}" 
                 data-index="${index}" data-full-hash="${escapeHtml(commit.fullHash || commit.hash)}">
                <span class="commit-hash">${escapeHtml(commit.hash)}</span>
                <div class="commit-info">
                    <div class="commit-msg">${escapeHtml(commit.message.split('\n')[0])}</div>
                    <div class="commit-meta">${escapeHtml(commit.author)} • ${formatDate(commit.date)}</div>
                </div>
            </div>
        `).join('');

        elements.commitsList.querySelectorAll('.commit-item').forEach(item => {
            // Click to select
            item.addEventListener('click', () => {
                const index = parseInt(/** @type {HTMLElement} */(item).dataset.index || '0');
                state.selectedCommitIndex = index;
                vscode.setState(state);
                vscode.postMessage({ type: 'selectCommit', index });
                renderCommits();
                updateCommitDetails();
            });

            // Right-click context menu
            item.addEventListener('contextmenu', (evt) => {
                const e = /** @type {MouseEvent} */ (evt);
                e.preventDefault();
                const fullHash = /** @type {HTMLElement} */(item).dataset.fullHash || '';
                showContextMenu(e.clientX, e.clientY, fullHash);
            });
        });
    }

    function updateCommitDetails() {
        const detailsEl = document.getElementById('commit-details');
        if (!detailsEl) return;

        const commit = state.commits[state.selectedCommitIndex];
        if (!commit) {
            detailsEl.style.display = 'none';
            return;
        }

        detailsEl.style.display = 'block';
        const messageEl = detailsEl.querySelector('.commit-details-message');
        const metaEl = detailsEl.querySelector('.commit-details-meta');

        if (messageEl) {
            messageEl.textContent = commit.message;
        }
        if (metaEl) {
            const hash = commit.hash || '';
            const author = commit.author || '';
            const email = commit.email || '';
            const date = formatDate(commit.date);
            metaEl.innerHTML = `<span class="hash">${escapeHtml(hash)}</span>  ${escapeHtml(author)} &lt;${escapeHtml(email)}&gt;,  ${date}`;
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {string} hash
     */
    function showContextMenu(x, y, hash) {
        // Remove existing context menu
        const existing = document.querySelector('.context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="copy-hash">
                <i class="codicon codicon-copy icon"></i>
                <span>Copy Commit Hash</span>
            </div>
        `;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        document.body.appendChild(menu);

        menu.querySelector('[data-action="copy-hash"]')?.addEventListener('click', () => {
            navigator.clipboard.writeText(hash);
            menu.remove();
        });

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 0);
    }

    function renderFiles() {
        if (!elements.filesList) return;

        if (state.files.length === 0) {
            elements.filesList.innerHTML = '<div class="empty-files">No changed files</div>';
            return;
        }

        const grouped = groupFilesByFolder(state.files);
        let html = '';

        for (const [folder, files] of Object.entries(grouped)) {
            html += `
                <div class="file-tree-item folder">
                    <i class="codicon codicon-folder icon"></i>
                    <span class="name">${escapeHtml(folder)}</span>
                    <span class="count">${files.length} file${files.length > 1 ? 's' : ''}</span>
                </div>
            `;
            files.forEach(file => {
                const statusClass = getStatusClass(file.status);
                const statusIcon = getStatusIcon(file.status);
                html += `
                    <div class="file-tree-item" data-path="${escapeHtml(file.path)}">
                        <span class="indent"></span>
                        <i class="codicon ${statusIcon} icon"></i>
                        <span class="name ${statusClass}">${escapeHtml(file.name)}</span>
                    </div>
                `;
            });
        }

        elements.filesList.innerHTML = html;

        // Update files count
        const filesCountEl = document.getElementById('files-count');
        if (filesCountEl) {
            filesCountEl.textContent = `${state.files.length} file${state.files.length !== 1 ? 's' : ''}`;
        }

        // File double-click to open diff
        elements.filesList.querySelectorAll('.file-tree-item[data-path]').forEach(item => {
            item.addEventListener('dblclick', () => {
                const path = /** @type {HTMLElement} */ (item).dataset.path;
                vscode.postMessage({ type: 'openDiff', path });
            });
        });

        // Folder click to toggle
        elements.filesList.querySelectorAll('.file-tree-item.folder').forEach(folder => {
            folder.addEventListener('click', () => {
                folder.classList.toggle('collapsed');
                // Hide/show files under this folder
                let next = folder.nextElementSibling;
                while (next && !next.classList.contains('folder')) {
                    // @ts-ignore
                    next.style.display = folder.classList.contains('collapsed') ? 'none' : 'flex';
                    next = next.nextElementSibling;
                }
            });
        });
    }

    // Expand All button
    document.getElementById('expand-all')?.addEventListener('click', () => {
        document.querySelectorAll('.file-tree-item.folder.collapsed').forEach(folder => {
            folder.classList.remove('collapsed');
            let next = folder.nextElementSibling;
            while (next && !next.classList.contains('folder')) {
                // @ts-ignore
                next.style.display = 'flex';
                next = next.nextElementSibling;
            }
        });
    });

    // Collapse All button
    document.getElementById('collapse-all')?.addEventListener('click', () => {
        document.querySelectorAll('.file-tree-item.folder:not(.collapsed)').forEach(folder => {
            folder.classList.add('collapsed');
            let next = folder.nextElementSibling;
            while (next && !next.classList.contains('folder')) {
                // @ts-ignore
                next.style.display = 'none';
                next = next.nextElementSibling;
            }
        });
    });

    /**
     * @param {any[]} files
     */
    function groupFilesByFolder(files) {
        /** @type {Record<string, any[]>} */
        const groups = {};
        files.forEach(file => {
            const parts = file.path.split('/');
            const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
            const name = parts[parts.length - 1];
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push({ ...file, name });
        });
        return groups;
    }

    /**
     * @param {string} status
     */
    function getStatusClass(status) {
        switch (status) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case 'D': return 'deleted';
            default: return 'modified';
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
            default: return 'codicon-file';
        }
    }

    /**
     * @param {string} text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * @param {string} dateStr
     */
    function formatDate(dateStr) {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return dateStr;
        }
    }

    function showLoading() {
        if (elements.loadingOverlay) {
            elements.loadingOverlay.classList.add('show');
        }
    }

    function hideLoading() {
        if (elements.loadingOverlay) {
            elements.loadingOverlay.classList.remove('show');
        }
    }

    let selectedSuggestionIndex = -1;
    /** @type {string[]} */
    let currentSuggestions = [];

    function showBranchSuggestions() {
        if (!elements.branchSuggestions) return;

        const input = (elements.remoteBranchInput?.value || '').trim();
        const remote = elements.remoteSelect?.value || 'origin';

        /** @type {string[]} */
        const allRemoteBranches = state.config?.remoteBranches || [];

        // Filter branches for the selected remote
        const remoteBranches = allRemoteBranches
            .filter((/** @type {string} */ b) => {
                const normalized = b.replace(/^remotes\//, '');
                return normalized.startsWith(`${remote}/`);
            })
            .map((/** @type {string} */ b) => {
                const normalized = b.replace(/^remotes\//, '');
                return normalized.replace(`${remote}/`, '');
            })
            .filter((/** @type {string} */ b) => b !== 'HEAD' && b.trim() !== '');

        // Filter by input if provided
        currentSuggestions = input
            ? remoteBranches.filter((/** @type {string} */ b) => b.toLowerCase().includes(input.toLowerCase()))
            : remoteBranches;

        // Reset selection
        selectedSuggestionIndex = -1;

        let html = '';

        // Show matching branches (no NEW option in dropdown)
        currentSuggestions.slice(0, 10).forEach((/** @type {string} */ branch, /** @type {number} */ index) => {
            html += `
                <div class="branch-suggestion-item" data-branch="${escapeHtml(branch)}" data-index="${index}">
                    <i class="codicon codicon-git-branch icon"></i>
                    <span class="branch-name">${escapeHtml(branch)}</span>
                </div>
            `;
        });

        // Show empty state if no branches
        if (!html && input) {
            html = '<div class="branch-suggestion-empty">No matching branches (will create new)</div>';
        } else if (!html && !input && allRemoteBranches.length === 0) {
            html = '<div class="branch-suggestion-empty">Loading branches...</div>';
        }

        elements.branchSuggestions.innerHTML = html;

        if (html && currentSuggestions.length > 0) {
            elements.branchSuggestions.classList.add('show');
        } else {
            elements.branchSuggestions.classList.remove('show');
        }

        // Add click handlers
        elements.branchSuggestions.querySelectorAll('.branch-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                selectBranch(/** @type {HTMLElement} */(item).dataset.branch || '');
            });
        });

        // Update NEW badge
        updateNewBadge();
    }

    function updateNewBadge() {
        const input = (elements.remoteBranchInput?.value || '').trim();
        const remote = elements.remoteSelect?.value || 'origin';

        /** @type {string[]} */
        const allRemoteBranches = state.config?.remoteBranches || [];
        const remoteBranches = allRemoteBranches
            .filter((/** @type {string} */ b) => {
                const normalized = b.replace(/^remotes\//, '');
                return normalized.startsWith(`${remote}/`);
            })
            .map((/** @type {string} */ b) => {
                const normalized = b.replace(/^remotes\//, '');
                return normalized.replace(`${remote}/`, '');
            });

        const isNewBranch = input && !remoteBranches.includes(input);

        // Find or create the NEW badge
        const wrapper = elements.remoteBranchInput?.parentElement;
        let badge = wrapper?.querySelector('.input-new-badge');

        if (isNewBranch) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'input-new-badge';
                badge.textContent = 'NEW';
                wrapper?.appendChild(badge);
            }
        } else {
            badge?.remove();
        }
    }

    /**
     * @param {string} branch
     */
    function selectBranch(branch) {
        if (elements.remoteBranchInput && branch) {
            elements.remoteBranchInput.value = branch;
            vscode.postMessage({ type: 'changeRemoteBranch', branch });
            updateNewBadge();
        }
        hideBranchSuggestions();
    }

    function updateSuggestionHighlight() {
        if (!elements.branchSuggestions) return;

        const items = elements.branchSuggestions.querySelectorAll('.branch-suggestion-item');
        items.forEach((item, index) => {
            if (index === selectedSuggestionIndex) {
                item.classList.add('highlighted');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('highlighted');
            }
        });
    }

    function hideBranchSuggestions() {
        if (elements.branchSuggestions) {
            elements.branchSuggestions.classList.remove('show');
        }
        selectedSuggestionIndex = -1;
    }

    // Remote select change
    elements.remoteSelect?.addEventListener('change', () => {
        const remote = elements.remoteSelect?.value || 'origin';
        vscode.postMessage({ type: 'changeRemote', remote });
        updateNewBadge();
    });

    // Branch input events
    elements.remoteBranchInput?.addEventListener('focus', () => {
        if (!state.config) {
            vscode.postMessage({ type: 'ready' });
        }
        showBranchSuggestions();
    });

    elements.remoteBranchInput?.addEventListener('input', () => {
        showBranchSuggestions();
    });

    elements.remoteBranchInput?.addEventListener('blur', () => {
        setTimeout(() => {
            hideBranchSuggestions();
            updateNewBadge();
        }, 200);
    });

    elements.remoteBranchInput?.addEventListener('keydown', (e) => {
        const suggestionsVisible = elements.branchSuggestions?.classList.contains('show');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (suggestionsVisible && currentSuggestions.length > 0) {
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, Math.min(currentSuggestions.length - 1, 9));
                updateSuggestionHighlight();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (suggestionsVisible && currentSuggestions.length > 0) {
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
                updateSuggestionHighlight();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestionsVisible && selectedSuggestionIndex >= 0 && selectedSuggestionIndex < currentSuggestions.length) {
                selectBranch(currentSuggestions[selectedSuggestionIndex]);
            } else {
                const branch = elements.remoteBranchInput?.value;
                if (branch) {
                    vscode.postMessage({ type: 'changeRemoteBranch', branch });
                    updateNewBadge();
                }
                hideBranchSuggestions();
            }
        } else if (e.key === 'Escape') {
            hideBranchSuggestions();
        }
    });

    // Event Listeners
    elements.cancelBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
    });

    elements.pushBtn?.addEventListener('click', () => {
        showLoading();
        vscode.postMessage({
            type: 'push',
            pushTags: state.pushTags,
            tagOption: state.tagOption,
            force: false
        });
    });

    elements.pushDropdownBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.dropdownMenu?.classList.toggle('show');
    });

    document.getElementById('force-push')?.addEventListener('click', () => {
        elements.dropdownMenu?.classList.remove('show');
        showLoading();
        vscode.postMessage({
            type: 'push',
            pushTags: state.pushTags,
            tagOption: state.tagOption,
            force: true
        });
    });

    elements.pushTagsCheckbox?.addEventListener('change', () => {
        state.pushTags = elements.pushTagsCheckbox?.checked || false;
        vscode.setState(state);
        updateTagSelectState();
    });

    elements.tagOptionSelect?.addEventListener('change', () => {
        state.tagOption = elements.tagOptionSelect?.value || 'all';
        vscode.setState(state);
    });

    function updateTagSelectState() {
        if (elements.tagOptionSelect) {
            elements.tagOptionSelect.disabled = !state.pushTags;
        }
    }

    // Initialize tag select state
    updateTagSelectState();

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (!target.closest('.btn-split')) {
            elements.dropdownMenu?.classList.remove('show');
        }
        if (!target.closest('.branch-input-wrapper')) {
            hideBranchSuggestions();
        }
    });

    // Toolbar buttons
    document.getElementById('prev-diff')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'prevDiff' });
    });

    document.getElementById('next-diff')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'nextDiff' });
    });

    document.getElementById('preview-file')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'previewFile' });
    });

    // Initial render
    if (state.commits.length > 0 || state.files.length > 0) {
        render();
    }

    // Request data
    vscode.postMessage({ type: 'ready' });
})();
