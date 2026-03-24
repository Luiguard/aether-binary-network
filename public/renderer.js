/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AETHER BINARY UI RENDERER
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Converts Aether Binary AST arrays into real DOM elements.
 *  Format: [1, "ComponentName", {props}, [children]]
 *
 *  This is the bridge between the AI-generated binary protocol
 *  and the visible user interface. Zero HTML needed.
 */

'use strict';

const AetherRenderer = (() => {

    // ─── COMPONENT REGISTRY ──────────────────────────────────────
    const COMPONENTS = {

        Button(props, children, container) {
            const btn = el('button', 'ae-btn');
            btn.textContent = props.label || '';
            if (props.color) btn.style.setProperty('--ae-color', resolveColor(props.color));
            if (props.icon) btn.textContent = resolveIcon(props.icon) + ' ' + (props.label || '');
            if (props.id) btn.id = props.id;
            if (props.action) btn.dataset.action = props.action;
            btn.addEventListener('click', () => dispatchAction(props.action, props));
            return btn;
        },

        Text(props) {
            const tag = props.style === 'h1' ? 'h1' : props.style === 'h2' ? 'h2' : 
                        props.style === 'h3' ? 'h3' : props.style === 'sub' ? 'p' : 
                        props.style === 'label' ? 'label' : 'span';
            const t = el(tag, 'ae-text');
            t.textContent = props.content || '';
            if (props.color) t.style.color = resolveColor(props.color);
            if (props.style === 'sub') t.classList.add('ae-sub');
            return t;
        },

        Input(props) {
            const inp = el('input', 'ae-input');
            inp.type = props.type || 'text';
            inp.placeholder = props.placeholder || '';
            if (props.id) inp.id = props.id;
            return inp;
        },

        TextInput(props) {
            const ta = document.createElement('textarea');
            ta.className = 'ae-input ae-textarea';
            ta.placeholder = props.placeholder || '';
            if (props.lines) ta.rows = props.lines;
            return ta;
        },

        Image(props) {
            const img = el('img', 'ae-image');
            img.src = props.src || '';
            img.alt = props.alt || '';
            if (props.shape === 'circle') img.classList.add('ae-circle');
            return img;
        },

        Icon(props) {
            const ic = el('span', 'ae-icon');
            ic.textContent = resolveIcon(props.name || 'star');
            if (props.color) ic.style.color = resolveColor(props.color);
            if (props.size === 'large') ic.classList.add('ae-icon-lg');
            if (props.anim === 'spin') ic.classList.add('ae-spin');
            return ic;
        },

        Row(props, children) {
            const row = el('div', 'ae-row');
            if (props.align) row.style.justifyContent = props.align === 'right' ? 'flex-end' : 
                              props.align === 'center' ? 'center' : 'flex-start';
            if (props.gap) row.style.gap = props.gap + 'px';
            renderChildren(children, row);
            return row;
        },

        Col(props, children) {
            const col = el('div', 'ae-col');
            if (props.align) col.style.alignItems = props.align === 'center' ? 'center' : 'stretch';
            if (props.gap) col.style.gap = props.gap + 'px';
            renderChildren(children, col);
            return col;
        },

        Panel(props, children) {
            const p = el('div', 'ae-panel');
            if (props.glass) p.classList.add('ae-glass');
            if (props.theme === 'dark') p.classList.add('ae-dark');
            if (props.blur) p.style.backdropFilter = `blur(${props.blur})`;
            if (props.padding) p.style.padding = props.padding + 'px';
            if (props.id) p.id = props.id;
            if (props.height) p.style.minHeight = props.height + 'px';
            renderChildren(children, p);
            return p;
        },

        Nav(props, children) {
            const nav = el('nav', 'ae-nav');
            if (props.title) {
                const t = el('span', 'ae-nav-title');
                t.textContent = props.title;
                nav.appendChild(t);
            }
            renderChildren(children, nav);
            return nav;
        },

        NavItem(props) {
            const ni = el('a', 'ae-nav-item');
            ni.textContent = (props.icon ? resolveIcon(props.icon) + ' ' : '') + (props.label || '');
            ni.href = '#';
            return ni;
        },

        Alert(props, children) {
            const a = el('div', 'ae-alert');
            a.classList.add('ae-alert-' + (props.type || 'info'));
            if (props.anim === 'flash_red') a.classList.add('ae-flash');
            renderChildren(children, a);
            return a;
        },

        Badge(props) {
            const b = el('span', 'ae-badge');
            b.textContent = (props.icon || '') + ' ' + (props.label || '') + ' ' + (props.value || '');
            if (props.color) b.style.setProperty('--ae-color', resolveColor(props.color));
            return b;
        },

        Table(props, children) {
            const table = el('table', 'ae-table');
            if (props.cols && Array.isArray(props.cols)) {
                const thead = el('thead');
                const tr = el('tr');
                props.cols.forEach(c => { const th = el('th'); th.textContent = c; tr.appendChild(th); });
                thead.appendChild(tr);
                table.appendChild(thead);
            }
            const tbody = el('tbody');
            renderChildren(children, tbody);
            table.appendChild(tbody);
            return table;
        },

        ProgressBar(props) {
            const wrap = el('div', 'ae-progress');
            const fill = el('div', 'ae-progress-fill');
            const pct = Math.min(100, Math.max(0, props.val || 0)) / (props.max || 100) * 100;
            fill.style.width = pct + '%';
            if (props.color) fill.style.setProperty('--ae-color', resolveColor(props.color));
            wrap.appendChild(fill);
            if (props.label) {
                const lbl = el('span', 'ae-progress-label');
                lbl.textContent = props.label + ' ' + Math.round(pct) + '%';
                wrap.appendChild(lbl);
            }
            return wrap;
        },

        Slider(props) {
            const wrap = el('div', 'ae-slider-wrap');
            if (props.label) {
                const lbl = el('label', 'ae-label');
                lbl.textContent = props.label;
                wrap.appendChild(lbl);
            }
            const inp = el('input', 'ae-slider');
            inp.type = 'range';
            inp.min = props.min ?? 0;
            inp.max = props.max ?? 100;
            inp.value = props.value ?? props.val ?? 50;
            if (props.id) inp.id = props.id;
            wrap.appendChild(inp);
            return wrap;
        },

        Form(props, children) {
            const f = el('form', 'ae-form');
            if (props.layout === 'grid') f.classList.add('ae-grid');
            f.addEventListener('submit', e => e.preventDefault());
            renderChildren(children, f);
            return f;
        },

        Grid(props, children) {
            const g = el('div', 'ae-grid');
            if (props.cols) g.style.gridTemplateColumns = `repeat(${props.cols}, 1fr)`;
            renderChildren(children, g);
            return g;
        },

        List(props, children) {
            const ul = el('div', 'ae-list');
            if (props.scroll) ul.classList.add('ae-scroll');
            renderChildren(children, ul);
            return ul;
        },

        ListItem(props) {
            const li = el('div', 'ae-list-item');
            const t = el('span', 'ae-list-title');
            t.textContent = props.title || '';
            li.appendChild(t);
            if (props.subtitle) {
                const s = el('span', 'ae-list-sub');
                s.textContent = props.subtitle;
                li.appendChild(s);
            }
            if (props.action) li.addEventListener('click', () => dispatchAction(props.action, props));
            return li;
        },

        Switch(props) {
            const wrap = el('label', 'ae-switch-wrap');
            const inp = el('input', 'ae-switch-input');
            inp.type = 'checkbox';
            inp.checked = props.state === 'on';
            if (props.id) inp.id = props.id;
            const slider = el('span', 'ae-switch-slider');
            wrap.appendChild(inp);
            wrap.appendChild(slider);
            if (props.label) {
                const lbl = el('span', 'ae-switch-label');
                lbl.textContent = props.label;
                wrap.appendChild(lbl);
            }
            return wrap;
        },

        Checkbox(props) {
            const wrap = el('label', 'ae-checkbox-wrap');
            const inp = el('input');
            inp.type = 'checkbox';
            inp.className = 'ae-checkbox';
            if (props.id) inp.id = props.id;
            wrap.appendChild(inp);
            if (props.label) {
                const lbl = el('span');
                lbl.textContent = props.label;
                wrap.appendChild(lbl);
            }
            return wrap;
        },

        Select(props, children) {
            const sel = el('select', 'ae-select');
            if (props.id) sel.id = props.id;
            renderChildren(children, sel);
            if (props.selected) sel.value = props.selected;
            return sel;
        },

        Option(props) {
            const opt = document.createElement('option');
            opt.value = props.val || '';
            opt.textContent = props.label || props.val || '';
            return opt;
        },

        Divider(props) {
            const d = el('hr', 'ae-divider');
            if (props.shadow) d.classList.add('ae-shadow');
            return d;
        },

        Carousel(props, children) {
            const wrap = el('div', 'ae-carousel');
            renderChildren(children, wrap);
            return wrap;
        },

        Card(props, children) {
            const c = el('div', 'ae-card');
            if (props.shadow) c.classList.add('ae-shadow');
            renderChildren(children, c);
            return c;
        },

        Container(props) {
            const c = el('div', 'ae-container');
            if (props.color) c.style.background = resolveColor(props.color);
            if (props.width) c.style.width = props.width;
            if (props.height) c.style.height = props.height;
            if (props.content) c.textContent = props.content;
            return c;
        },

        View(props, children) {
            const v = el('div', 'ae-view');
            if (props.id) v.id = props.id;
            if (props.layout === 'col') v.classList.add('ae-col');
            renderChildren(children, v);
            return v;
        },

        VideoPlayer(props) {
            const v = el('video', 'ae-video');
            if (props.src) v.src = props.src;
            v.controls = props.controls !== false;
            if (props.autoplay) v.autoplay = true;
            return v;
        },

        Msg(props) {
            const m = el('div', 'ae-msg');
            m.classList.add(props.from === 'system' ? 'ae-msg-sys' : 'ae-msg-user');
            const name = el('span', 'ae-msg-name');
            name.textContent = props.from || '';
            const text = el('span', 'ae-msg-text');
            text.textContent = props.text || '';
            m.appendChild(name);
            m.appendChild(text);
            return m;
        },

        MessageBubble(props) {
            return COMPONENTS.Msg(props);
        },

        Graph(props) {
            const g = el('div', 'ae-graph-placeholder');
            g.textContent = '📊 ' + (props.src || 'Graph');
            return g;
        },

        Stepper(props) {
            const s = el('div', 'ae-stepper');
            (props.steps || []).forEach((step, i) => {
                const dot = el('div', 'ae-step');
                if (i + 1 === (props.active || 1)) dot.classList.add('ae-step-active');
                dot.textContent = step;
                s.appendChild(dot);
            });
            return s;
        },

        Slot(props) {
            const s = el('div', 'ae-slot');
            s.dataset.id = props.id ?? '';
            return s;
        },
    };

    // ─── HELPERS ──────────────────────────────────────────────────

    function el(tag, cls) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    const COLOR_MAP = {
        blue: '#3b82f6', red: '#ef4444', green: '#22c55e', purple: '#a855f7',
        orange: '#f97316', gold: '#eab308', gray: '#6b7280', cyan: '#06b6d4',
        magenta: '#ec4899', primary: '#6366f1', white: '#ffffff', black: '#000000',
    };

    function resolveColor(c) {
        return COLOR_MAP[c] || c;
    }

    const ICON_MAP = {
        'star': '⭐', 'user': '👤', 'settings': '⚙️', 'home': '🏠', 'search': '🔍',
        'bell': '🔔', 'send': '📤', 'alert': '⚠️', 'alert-triangle': '⚠️',
        'arrow-up': '↑', 'arrow-down': '↓', 'radar': '📡', 'heart': '❤️',
        '0x1A': '🏠', '0x1B': '⚙️',
    };

    function resolveIcon(name) {
        return ICON_MAP[name] || name || '•';
    }

    function renderChildren(children, parent) {
        if (!children || !Array.isArray(children)) return;
        children.forEach(child => {
            if (Array.isArray(child) && child[0] === 1) {
                const rendered = renderNode(child);
                if (rendered) parent.appendChild(rendered);
            }
        });
    }

    function dispatchAction(actionCode, props) {
        document.dispatchEvent(new CustomEvent('aether-action', { 
            detail: { action: actionCode, props } 
        }));
    }

    // ─── CORE RENDER FUNCTION ────────────────────────────────────

    function renderNode(ast) {
        if (!Array.isArray(ast) || ast[0] !== 1) return null;

        const [_, componentName, props = {}, children] = ast;
        const factory = COMPONENTS[componentName];

        if (!factory) {
            console.warn(`[AetherRenderer] Unknown component: ${componentName}`);
            const fallback = el('div', 'ae-unknown');
            fallback.textContent = `<${componentName}/>`;
            return fallback;
        }

        return factory(props, children);
    }

    /**
     * Render a complete Aether Binary AST into a target container.
     * @param {Array} ast - The binary AST array [1, "Component", {props}, [children]]
     * @param {HTMLElement} target - DOM element to render into
     */
    function render(ast, target) {
        target.innerHTML = '';
        const node = renderNode(ast);
        if (node) target.appendChild(node);
    }

    /**
     * Render multiple AST nodes into a target container.
     */
    function renderAll(astArray, target) {
        target.innerHTML = '';
        astArray.forEach(ast => {
            const node = renderNode(ast);
            if (node) target.appendChild(node);
        });
    }

    return { render, renderAll, renderNode };
})();
