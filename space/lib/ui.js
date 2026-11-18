/* Shared page helpers and the orbit editor used by both space tools. */
(function (root) {
    'use strict';
    const O = root.SpaceOrbit;

    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
        return el;
    }
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const pad2 = n => String(n).padStart(2, '0');
    function utc(d, seconds = false) {
        if (!(d instanceof Date) || isNaN(d)) return '—';
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${seconds ? ':' + pad2(d.getUTCSeconds()) : ''} UTC`;
    }
    /** Value for <input type="datetime-local"> holding a UTC time. */
    function toLocalInput(d) { return d.toISOString().slice(0, 19); }
    function fromLocalInput(v) { const d = new Date(v.length === 16 ? v + ':00Z' : v + 'Z'); return isNaN(d) ? null : d; }
    function num(v, digits = 3) { return root.SpacePlotUtil.fmt(v, digits); }
    function km(v) { return isFinite(v) ? Math.round(v).toLocaleString('en-US') + ' km' : '—'; }
    function regime(el) {
        if (el.perigee < 2000 && el.apogee < 2000) return 'LEO';
        if (Math.abs(el.period - 1436) < 30 && el.e < 0.05) return 'GEO';
        if (el.e > 0.25) return 'HEO';
        return el.apogee < 35000 ? 'MEO' : 'High';
    }
    function summary(el) {
        return `${km(el.perigee)} × ${km(el.apogee)} · ${el.inc.toFixed(1)}° · ${el.period.toFixed(1)} min`;
    }
    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; }
    }

    function presetSource(id, epoch) {
        const p = O.PRESETS.find(x => x.id === id);
        if (!p) return null;
        const { perigee, apogee, inc, raan, argp, ma } = p;
        return { kind: 'elements', name: p.name.split(' (')[0], epoch: epoch.toISOString(), perigee, apogee, inc, raan, argp, ma, bstar: 0, preset: id };
    }

    function encodeLink(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function decodeLink(value) {
        if (!value) return null;
        try {
            const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (err) { return null; }
    }
    function orbitLink(path, source, time) {
        const hash = new URLSearchParams({ orbit: encodeLink(source), time: new Date(time).toISOString() });
        return path + '#' + hash;
    }
    function readOrbitLink(hash) {
        const params = new URLSearchParams(hash.slice(1));
        if (!params.has('orbit') && !params.has('preset')) return null;
        const time = Date.parse(params.get('time'));
        if (!Number.isFinite(time)) return null;
        const source = params.has('orbit') ? decodeLink(params.get('orbit')) : presetSource(params.get('preset'), new Date(time));
        if (!source || !['elements', 'tle', 'omm'].includes(source.kind) || typeof source.name !== 'string') return null;
        try {
            const { epoch, perigee, apogee, inc, period } = O.elementsOf(O.satrecFromSource(source));
            if ([epoch.getTime(), perigee, apogee, inc, period].every(Number.isFinite) && period > 0) return { source, time };
        } catch (err) { /* fall back to the page defaults for invalid links */ }
        return null;
    }

    const FIELDS = [
        ['perigee', 'Perigee altitude', 'km', 120, 400000, 1],
        ['apogee', 'Apogee altitude', 'km', 120, 400000, 1],
        ['inc', 'Inclination', 'deg', 0, 180, 0.01],
        ['raan', 'RAAN', 'deg', 0, 360, 0.01],
        ['argp', 'Arg. of perigee', 'deg', 0, 360, 0.01],
        ['ma', 'Mean anomaly', 'deg', 0, 360, 0.01]
    ];

    /**
     * Orbit editor with three entry modes. Emits orbit sources (see SpaceOrbit.satrecFromSource).
     * opts: { onChange(source), onMany(sets) (optional: offer "add all"), epoch: Date, idPrefix }
     */
    class OrbitEditor {
        constructor(el, opts = {}) {
            this.el = el; this.opts = opts; this.mode = 'preset';
            const id = (opts.idPrefix || 'oe') + '-';
            this.tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Orbit entry method' });
            this.panes = {};
            for (const [mode, label] of [['preset', 'Preset'], ['elements', 'Elements'], ['tle', 'TLE / OMM']]) {
                const b = h('button', { type: 'button', role: 'tab', 'data-mode': mode, id: id + 'tab-' + mode, 'aria-controls': id + mode + '-pane', text: label, onclick: () => this.setMode(mode) });
                this.tabs.append(b);
            }
            // preset
            this.preset = h('select', { id: id + 'preset', 'aria-label': 'Preset orbit' });
            const groups = {};
            for (const p of O.PRESETS) { groups[p.group] = groups[p.group] || h('optgroup', { label: p.group }); groups[p.group].append(h('option', { value: p.id, text: p.name })); }
            Object.values(groups).forEach(g => this.preset.append(g));
            this.preset.addEventListener('change', () => this._fromPreset());
            this.panes.preset = h('div', { class: 'oe-pane', id: id + 'preset-pane', role: 'tabpanel' },
                h('label', { class: 'fld wide', for: id + 'preset' }, h('span', { text: 'Reference orbit' }), this.preset),
                h('p', { class: 'hint', text: 'Presets fill the element fields; switch to Elements to fine-tune them.' }));
            // elements
            this.inputs = {};
            this.nameIn = h('input', { type: 'text', id: id + 'name', value: 'Manual orbit', maxlength: 40, spellcheck: 'false' });
            this.epochIn = h('input', { type: 'datetime-local', id: id + 'epoch', step: 1 });
            const grid = h('div', { class: 'fld-grid' },
                h('label', { class: 'fld wide', for: id + 'name' }, h('span', { text: 'Name' }), this.nameIn),
                h('label', { class: 'fld wide', for: id + 'epoch' }, h('span', { text: 'Epoch (UTC)' }), this.epochIn));
            for (const [key, label, unit, min, max, step] of FIELDS) {
                const inp = h('input', { type: 'number', id: id + key, min, max, step, inputmode: 'decimal', required: true });
                this.inputs[key] = inp;
                grid.append(h('label', { class: 'fld', for: id + key }, h('span', {}, label, h('em', { text: unit })), inp));
            }
            this.bstarIn = h('input', { type: 'number', id: id + 'bstar', step: 'any', value: 0 });
            grid.append(h('label', { class: 'fld', for: id + 'bstar', title: 'SGP4 drag term in 1/Earth radii. 0 disables drag decay.' }, h('span', {}, 'B* drag', h('em', { text: '1/ER' })), this.bstarIn));
            const onEdit = debounce(() => this._fromElements(), 250);
            grid.addEventListener('input', onEdit);
            this.panes.elements = h('div', { class: 'oe-pane', id: id + 'elements-pane', role: 'tabpanel' }, grid);
            // tle
            this.text = h('textarea', { id: id + 'tle', rows: 4, spellcheck: 'false', autocomplete: 'off', placeholder: 'ISS (ZARYA)\n1 25544U 98067A   26322.51239583  .00016717  00000-0  30571-3 0  9993\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50094086 12345' });
            this.tleMsg = h('div', { class: 'oe-msg', role: 'status' });
            this.pick = h('select', { 'aria-label': 'Element set to use', hidden: true });
            this.pick.addEventListener('change', () => this._useSet(+this.pick.value));
            const parseBtn = h('button', { type: 'button', class: 'btn', text: 'Use elements', onclick: () => this._fromText() });
            const fileIn = h('input', { type: 'file', accept: '.txt,.tle,.json,.3le,text/plain,application/json', hidden: true });
            fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (f) { this.text.value = await f.text(); this._fromText(); } fileIn.value = ''; });
            const fileBtn = h('button', { type: 'button', class: 'btn ghost', text: 'Open file…', onclick: () => fileIn.click() });
            this.manyBtn = h('button', { type: 'button', class: 'btn ghost', text: 'Add the other sets as cases', hidden: true, onclick: () => { if (this.opts.onMany) this.opts.onMany(this.sets.filter((_, i) => i !== +this.pick.value)); this.manyBtn.hidden = true; } });
            this.panes.tle = h('div', { class: 'oe-pane', id: id + 'tle-pane', role: 'tabpanel' },
                h('label', { class: 'fld wide', for: id + 'tle' }, h('span', { text: 'Two-line elements or OMM JSON' }), this.text),
                h('div', { class: 'row' }, parseBtn, fileBtn, this.manyBtn, fileIn), this.pick, this.tleMsg);
            this.derived = h('div', { class: 'oe-derived', 'aria-live': 'polite' });
            this.copyBtn = h('button', { type: 'button', class: 'btn ghost small', text: 'Copy as TLE', onclick: () => this._copy() });
            el.append(this.tabs, this.panes.preset, this.panes.elements, this.panes.tle, h('div', { class: 'oe-foot' }, this.derived, this.copyBtn));
            this.setMode('preset');
        }
        setMode(mode) {
            this.mode = mode;
            for (const b of this.tabs.children) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
            for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== mode;
        }
        _emit(src) {
            this.source = src;
            try {
                this.satrec = O.satrecFromSource(src);
                this.el_ = O.elementsOf(this.satrec);
                this.derived.textContent = `a ${num(this.el_.a, 6)} km · e ${this.el_.e.toFixed(5)} · ${this.el_.period.toFixed(1)} min · ${regime(this.el_)}`;
                this.derived.classList.remove('bad');
                this.opts.onChange && this.opts.onChange(src, this.el_);
            } catch (err) { this.derived.textContent = err.message; this.derived.classList.add('bad'); }
        }
        _fillElements(src) {
            this.nameIn.value = src.name || 'Manual orbit';
            this.epochIn.value = toLocalInput(new Date(src.epoch));
            for (const [k] of FIELDS) this.inputs[k].value = +(+src[k]).toFixed(k === 'perigee' || k === 'apogee' ? 1 : 4);
            this.bstarIn.value = src.bstar || 0;
        }
        _fromPreset() {
            const epoch = this.opts.epoch ? this.opts.epoch() : new Date(Math.floor(Date.now() / 60000) * 60000);
            const src = presetSource(this.preset.value || O.PRESETS[0].id, epoch);
            this._fillElements(src); this._emit(src);
        }
        _fromElements() {
            const epoch = fromLocalInput(this.epochIn.value);
            if (!epoch) { this.derived.textContent = 'Enter a valid UTC epoch.'; this.derived.classList.add('bad'); return; }
            const src = { kind: 'elements', name: this.nameIn.value.trim() || 'Manual orbit', epoch: epoch.toISOString(), bstar: +this.bstarIn.value || 0 };
            for (const [k, label, , min, max] of FIELDS) {
                const v = +this.inputs[k].value;
                if (this.inputs[k].value === '' || !isFinite(v) || v < min || v > max) { this.derived.textContent = `${label} must be between ${min} and ${max}.`; this.derived.classList.add('bad'); return; }
                src[k] = v;
            }
            if (src.apogee < src.perigee) { this.derived.textContent = 'Apogee must be at or above perigee.'; this.derived.classList.add('bad'); return; }
            this._emit(src);
        }
        _fromText() {
            const { sets, errors } = O.parseElements(this.text.value);
            this.sets = sets;
            this.pick.replaceChildren(...sets.map((s, i) => h('option', { value: i, text: `${s.name} · #${s.satrec.satnum}` })));
            this.pick.hidden = sets.length < 2;
            this.manyBtn.hidden = !(sets.length > 1 && this.opts.onMany);
            const notes = [...errors, ...sets.flatMap(s => s.warnings.map(w => `${s.name}: ${w}`))];
            this.tleMsg.textContent = (sets.length ? `${sets.length} element set${sets.length > 1 ? 's' : ''} read${sets.length > 1 ? '; the selected one is applied' : ''}. ` : '') + notes.slice(0, 4).join(' ');
            this.tleMsg.classList.toggle('bad', !sets.length);
            if (sets.length) this._useSet(0);
        }
        _useSet(i) {
            const s = this.sets[i];
            this._emit(s.omm ? { kind: 'omm', name: s.name, omm: s.omm } : { kind: 'tle', name: s.name, line1: s.line1, line2: s.line2 });
        }
        /** Load an existing source into the editor without emitting a change. */
        setSource(src) {
            this.source = src;
            if (src.kind === 'elements') {
                this._fillElements(src);
                if (src.preset) { this.preset.value = src.preset; this.setMode('preset'); } else this.setMode('elements');
            } else {
                this.text.value = src.kind === 'tle' ? `${src.name}\n${src.line1}\n${src.line2}` : JSON.stringify(src.omm, null, 1);
                this.pick.hidden = true; this.manyBtn.hidden = true; this.tleMsg.textContent = '';
                this.setMode('tle');
            }
            try {
                this.satrec = O.satrecFromSource(src); this.el_ = O.elementsOf(this.satrec);
                if (src.kind !== 'elements') this._fillElements({ name: src.name, epoch: this.el_.epoch.toISOString(), perigee: this.el_.perigee, apogee: this.el_.apogee, inc: this.el_.inc, raan: this.el_.raan, argp: this.el_.argp, ma: this.el_.ma, bstar: this.el_.bstar });
                this.derived.textContent = `a ${num(this.el_.a, 6)} km · e ${this.el_.e.toFixed(5)} · ${this.el_.period.toFixed(1)} min · ${regime(this.el_)}`;
                this.derived.classList.remove('bad');
            } catch (err) { this.derived.textContent = err.message; this.derived.classList.add('bad'); }
        }
        async _copy() {
            if (!this.el_) return;
            const text = this.source.kind === 'tle' ? `${this.source.name}\n${this.source.line1}\n${this.source.line2}` : O.toTLE(this.el_, (this.source.name || 'ORBIT').toUpperCase().slice(0, 24));
            const ok = await copyText(text);
            this.copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
            setTimeout(() => { this.copyBtn.textContent = 'Copy as TLE'; }, 1400);
        }
    }

    /** Wire a tab strip: buttons[data-tab] toggle panels[data-panel]. */
    function tabs(strip, onShow) {
        const buttons = [...strip.querySelectorAll('[data-tab]')];
        const show = name => {
            for (const b of buttons) {
                const on = b.dataset.tab === name;
                b.setAttribute('aria-selected', String(on));
                b.tabIndex = on ? 0 : -1;
                const panel = document.getElementById(b.getAttribute('aria-controls'));
                if (panel) panel.hidden = !on;
            }
            onShow && onShow(name);
        };
        strip.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
        strip.addEventListener('keydown', e => {
            const i = buttons.indexOf(document.activeElement); if (i < 0) return;
            const j = e.key === 'ArrowRight' ? (i + 1) % buttons.length : e.key === 'ArrowLeft' ? (i - 1 + buttons.length) % buttons.length : -1;
            if (j >= 0) { e.preventDefault(); buttons[j].focus(); show(buttons[j].dataset.tab); }
        });
        return show;
    }

    root.SpaceUI = { h, debounce, utc, toLocalInput, fromLocalInput, num, km, regime, summary, copyText, presetSource, encodeLink, decodeLink, orbitLink, readOrbitLink, OrbitEditor, tabs };
})(typeof self !== 'undefined' ? self : globalThis);
