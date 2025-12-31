class PopupMenu {
    constructor() {
        this.element = null;
        this._handleClickOutside = this._handleClickOutside.bind(this);
    }

    /**
     * @typedef {Object} MenuItem
     * @property {string} [label]
     * @property {string} [icon] Codicon name (e.g. 'check', 'trash')
     * @property {string} [shortcut]
     * @property {'separator'|'item'} [type] Default is 'item'
     * @property {boolean} [danger] If true, the item will be styled as destructive
     * @property {() => void} [action]
     */

    /**
     * Show the popup menu
     * @param {MenuItem[]} items 
     * @param {number} x Client X
     * @param {number} y Client Y
     */
    show(items, x, y) {
        this.hide();

        this.element = document.createElement('div');
        this.element.className = 'popup-menu';
        this.element.tabIndex = -1; // Make focusable

        items.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'popup-menu-item separator';
                this.element.appendChild(sep);
                return;
            }

            const el = document.createElement('div');
            el.className = 'popup-menu-item';
            if (item.danger) {
                el.classList.add('danger');
            }

            // Icon
            const iconContainer = document.createElement('span');
            iconContainer.className = 'icon';
            if (item.icon) {
                const i = document.createElement('i');
                i.className = `codicon codicon-${item.icon}`;
                iconContainer.appendChild(i);
            }
            el.appendChild(iconContainer);

            // Label Container
            const labelContainer = document.createElement('div');
            labelContainer.className = 'label-container';

            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = item.label || '';
            labelContainer.appendChild(label);

            el.appendChild(labelContainer);

            // Shortcut
            if (item.shortcut) {
                const shortcut = document.createElement('span');
                shortcut.className = 'shortcut';
                shortcut.textContent = item.shortcut;
                el.appendChild(shortcut);
            }

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
                if (item.action) item.action();
            });

            this.element.appendChild(el);
        });

        document.body.appendChild(this.element);

        // Calculate position to keep within viewport
        const rect = this.element.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        let left = x;
        let top = y;

        if (left + rect.width > winWidth) {
            left = winWidth - rect.width - 5;
        }
        if (top + rect.height > winHeight) {
            top = winHeight - rect.height - 5;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;

        // Focus for keyboard accessibility and blur handling
        this.element.focus();

        // Close on blur or click outside
        setTimeout(() => {
            document.addEventListener('click', this._handleClickOutside);
            document.addEventListener('contextmenu', this._handleClickOutside);
        }, 0);
    }

    hide() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
        document.removeEventListener('click', this._handleClickOutside);
        document.removeEventListener('contextmenu', this._handleClickOutside);
    }

    _handleClickOutside(e) {
        if (this.element && !this.element.contains(e.target)) {
            this.hide();
        }
    }
}

// Export a singleton instance if desired, or let usage instantiate
// window.popupMenu = new PopupMenu();
