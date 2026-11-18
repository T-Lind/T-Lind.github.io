/* SpacePlot: a small, dependable canvas chart for engineering plots.
 * Log or linear axes, lines, bands, scatter, steps and stacked bars, an HTML legend
 * that toggles series, a hover readout, drag-to-zoom (double-click resets) and CSV export. */
(function (root) {
    'use strict';
    const FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
    const sup = n => String(n).split('').map(c => SUP[c] || c).join('');

    function fmt(v, digits = 3) {
        if (v === 0) return '0';
        if (!isFinite(v)) return '—';
        const a = Math.abs(v);
        if (a >= 1e5 || a < 1e-3) { const e = Math.floor(Math.log10(a)); return (v / 10 ** e).toFixed(digits - 1) + 'e' + e; }
        if (a >= 100) return v.toFixed(Math.max(0, digits - 3));
        return Number(v.toPrecision(digits)).toString();
    }

    function niceStep(span, target) {
        const raw = span / Math.max(1, target);
        const mag = 10 ** Math.floor(Math.log10(raw));
        const n = raw / mag;
        return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    }

    class Axis {
        constructor(opt) { Object.assign(this, { type: 'lin', label: '', min: null, max: null, format: null }, opt); }
        setRange(lo, hi) {
            if (this.type === 'log') { lo = Math.max(lo, 1e-300); hi = Math.max(hi, lo * 10); this.lo = Math.log10(lo); this.hi = Math.log10(hi); }
            else { if (hi === lo) { hi = lo + 1; lo -= 1; } this.lo = lo; this.hi = hi; }
        }
        t(v) { const x = this.type === 'log' ? Math.log10(v) : v; return (x - this.lo) / (this.hi - this.lo); }
        inv(f) { const x = this.lo + f * (this.hi - this.lo); return this.type === 'log' ? 10 ** x : x; }
        ticks(pixels) {
            const major = [], minor = [];
            if (this.type === 'log') {
                const span = this.hi - this.lo, step = Math.max(1, Math.ceil(span / Math.max(2, pixels / 46)));
                for (let d = Math.floor(this.lo); d <= Math.ceil(this.hi); d++) {
                    if (d >= this.lo - 1e-9 && d <= this.hi + 1e-9 && d % step === 0) major.push({ v: 10 ** d, label: this.format ? this.format(10 ** d) : (d >= 0 && d <= 3 ? String(10 ** d) : '10' + sup(d)) });
                    if (step === 1 && span < 9) for (let m = 2; m < 10; m++) { const lv = d + Math.log10(m); if (lv > this.lo && lv < this.hi) minor.push(10 ** lv); }
                }
                if (major.length < 2 && span < 1.2) { // narrow log range: label 1-2-5
                    for (let d = Math.floor(this.lo); d <= Math.ceil(this.hi); d++) for (const m of [2, 5]) { const lv = d + Math.log10(m); if (lv > this.lo && lv < this.hi) major.push({ v: 10 ** lv, label: fmt(10 ** lv, 2) }); }
                }
            } else {
                const step = niceStep(this.hi - this.lo, pixels / 70);
                const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
                for (let v = Math.ceil(this.lo / step) * step; v <= this.hi + step * 1e-9; v += step) {
                    const vv = Math.abs(v) < step * 1e-9 ? 0 : v;
                    const plain = Math.abs(vv) >= 1e6 || (vv !== 0 && Math.abs(vv) < 1e-3) ? fmt(vv, 3) : vv.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
                    major.push({ v: vv, label: this.tickFormat ? this.tickFormat(vv) : plain });
                }
            }
            return { major, minor };
        }
    }

    class SpacePlot {
        constructor(container, opt = {}) {
            this.el = typeof container === 'string' ? document.querySelector(container) : container;
            this.el.classList.add('splot');
            this.canvas = document.createElement('canvas');
            this.canvas.setAttribute('role', 'img');
            this.canvas.setAttribute('aria-label', opt.title || 'Chart');
            this.legendEl = document.createElement('div'); this.legendEl.className = 'splot-legend';
            this.tip = document.createElement('div'); this.tip.className = 'splot-tip'; this.tip.hidden = true;
            this.el.append(this.canvas, this.tip, this.legendEl);
            this.opt = Object.assign({ title: '', legend: true, readout: true, zoom: true }, opt);
            this.x = new Axis(opt.x); this.y = new Axis(opt.y);
            this.series = []; this.marks = []; this.hidden = new Set(); this.view = null; this.note = '';
            this.ctx = this.canvas.getContext('2d');
            this._bind();
            if (root.ResizeObserver) new ResizeObserver(() => this.draw()).observe(this.el);
        }
        setAxes(x, y) { if (x) Object.assign(this.x, x); if (y) Object.assign(this.y, y); this.view = null; }
        set(series, marks = [], note = '') { this.series = series.filter(Boolean); this.marks = marks; this.note = note; this.view = null; this._legend(); this.draw(); }
        _visible() { return this.series.filter(s => !this.hidden.has(s.name)); }
        _extent() {
            const ax = this.x, ay = this.y;
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (const s of this._visible()) {
                for (const p of s.data) {
                    const xv = p[0], yv = s.kind === 'bar' ? (p[3] || 0) + p[1] : p[1];
                    if (!(ax.type !== 'log' || xv > 0) || !isFinite(xv)) continue;
                    x0 = Math.min(x0, xv); x1 = Math.max(x1, s.kind === 'bar' && p[2] != null ? p[2] : xv);
                    for (const v of s.kind === 'band' ? [p[1], p[2]] : [yv]) if (isFinite(v) && (ay.type !== 'log' || v > 0)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
                }
            }
            if (!isFinite(x0)) { x0 = ax.type === 'log' ? 1 : 0; x1 = ax.type === 'log' ? 10 : 1; }
            if (!isFinite(y0)) { y0 = ay.type === 'log' ? 1 : 0; y1 = ay.type === 'log' ? 10 : 1; }
            if (ay.type === 'log' && ay.floorDecades) y0 = Math.max(y0, y1 / 10 ** ay.floorDecades);
            if (ay.type === 'lin' && ay.zero !== false) y0 = Math.min(0, y0);
            if (ay.type === 'lin') { const padv = (y1 - y0) * 0.06 || 1; y1 += padv; if (y0 < 0) y0 -= padv; }
            if (ay.type === 'log') { y0 /= 1.6; y1 *= 1.6; }
            return [ax.min ?? x0, ax.max ?? x1, ay.min ?? y0, ay.max ?? y1];
        }
        _layout() {
            const dpr = root.devicePixelRatio || 1;
            const w = Math.max(200, this.el.clientWidth), h = Math.max(160, this.canvas.clientHeight || this.el.clientHeight || 280);
            if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
                this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
            }
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const left = 62, right = 14, top = this.opt.title ? 26 : 12, bottom = 40;
            this.box = { l: left, t: top, w: w - left - right, h: h - top - bottom, W: w, H: h };
        }
        px(v) { return this.box.l + this.x.t(v) * this.box.w; }
        py(v) { return this.box.t + (1 - this.y.t(v)) * this.box.h; }
        draw() {
            if (!this.el.isConnected || this.el.offsetParent === null) return;
            this._layout();
            const ctx = this.ctx, b = this.box, ax = this.x, ay = this.y;
            const [x0, x1, y0, y1] = this.view || this._extent();
            ax.setRange(x0, x1); ay.setRange(y0, y1);
            ctx.clearRect(0, 0, b.W, b.H);
            ctx.font = FONT; ctx.textBaseline = 'middle';
            if (this.opt.title) { ctx.fillStyle = '#d8d8dc'; ctx.textAlign = 'left'; ctx.fillText(this.opt.title, b.l, 12); }
            const xt = ax.ticks(b.w), yt = ay.ticks(b.h);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.045)';
            ctx.beginPath();
            for (const v of xt.minor) { const x = Math.round(this.px(v)) + .5; ctx.moveTo(x, b.t); ctx.lineTo(x, b.t + b.h); }
            for (const v of yt.minor) { const y = Math.round(this.py(v)) + .5; ctx.moveTo(b.l, y); ctx.lineTo(b.l + b.w, y); }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.11)';
            ctx.beginPath();
            for (const t of xt.major) { const x = Math.round(this.px(t.v)) + .5; ctx.moveTo(x, b.t); ctx.lineTo(x, b.t + b.h); }
            for (const t of yt.major) { const y = Math.round(this.py(t.v)) + .5; ctx.moveTo(b.l, y); ctx.lineTo(b.l + b.w, y); }
            ctx.stroke();
            ctx.fillStyle = '#9a9aa3';
            ctx.textAlign = 'center';
            let lastX = -1e9;
            for (const t of xt.major) { const x = this.px(t.v); const tw = ctx.measureText(t.label).width; if (x - tw / 2 < lastX + 6) continue; ctx.fillText(t.label, x, b.t + b.h + 12); lastX = x + tw / 2; }
            ctx.textAlign = 'right';
            for (const t of yt.major) ctx.fillText(t.label, b.l - 6, this.py(t.v));
            ctx.fillStyle = '#bdbdc4'; ctx.textAlign = 'center';
            ctx.fillText(ax.label, b.l + b.w / 2, b.t + b.h + 30);
            ctx.save(); ctx.translate(13, b.t + b.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(ay.label, 0, 0); ctx.restore();

            ctx.save();
            ctx.beginPath(); ctx.rect(b.l, b.t, b.w, b.h); ctx.clip();
            for (const m of this.marks) this._mark(m);
            for (const s of this._visible()) this._series(s);
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.strokeRect(b.l + .5, b.t + .5, b.w, b.h);
            if (this.note) { ctx.fillStyle = '#7d7d86'; ctx.textAlign = 'right'; ctx.fillText(this.note, b.l + b.w - 6, b.t + 10); }
            if (this.view) { ctx.fillStyle = '#7d7d86'; ctx.textAlign = 'left'; ctx.fillText('zoomed · double-click to reset', b.l + 6, b.t + 10); }
            if (this._drag && this._drag.x1 != null) {
                const d = this._drag; ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
                ctx.strokeRect(Math.min(d.x0, d.x1) + .5, Math.min(d.y0, d.y1) + .5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
            }
        }
        _mark(m) {
            const ctx = this.ctx, b = this.box;
            ctx.save(); ctx.setLineDash(m.dash || [4, 4]); ctx.strokeStyle = m.color || 'rgba(255,255,255,.35)'; ctx.fillStyle = m.color || '#aaa';
            ctx.textAlign = 'left';
            if (m.x != null) { const x = this.px(m.x); ctx.beginPath(); ctx.moveTo(x, b.t); ctx.lineTo(x, b.t + b.h); ctx.stroke(); if (m.label) ctx.fillText(m.label, x + 4, b.t + 22 + (m.row || 0) * 12); }
            if (m.y != null) { const y = this.py(m.y); ctx.beginPath(); ctx.moveTo(b.l, y); ctx.lineTo(b.l + b.w, y); ctx.stroke(); if (m.label) ctx.fillText(m.label, b.l + 6, y - 7); }
            if (m.x0 != null) { const xa = this.px(m.x0), xb = this.px(m.x1); ctx.globalAlpha = .12; ctx.fillRect(xa, b.t, xb - xa, b.h); ctx.globalAlpha = 1; if (m.label) ctx.fillText(m.label, xa + 4, b.t + b.h - 10); }
            ctx.restore();
        }
        _ok(x, y) { return isFinite(x) && isFinite(y) && (this.x.type !== 'log' || x > 0) && (this.y.type !== 'log' || y > 0); }
        _series(s) {
            const ctx = this.ctx;
            ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width || 1.6;
            ctx.setLineDash(s.dash || []);
            if (s.kind === 'band') {
                ctx.globalAlpha = s.alpha ?? 0.18; ctx.beginPath();
                const pts = s.data.filter(p => this._ok(p[0], p[1]) && this._ok(p[0], p[2]));
                pts.forEach((p, i) => i ? ctx.lineTo(this.px(p[0]), this.py(p[2])) : ctx.moveTo(this.px(p[0]), this.py(p[2])));
                for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(this.px(pts[i][0]), this.py(pts[i][1]));
                ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; return;
            }
            if (s.kind === 'scatter') {
                const r = s.size || 1.6; ctx.globalAlpha = s.alpha ?? 0.8;
                for (const p of s.data) if (this._ok(p[0], p[1])) ctx.fillRect(this.px(p[0]) - r / 2, this.py(p[1]) - r / 2, r, r);
                ctx.globalAlpha = 1; return;
            }
            if (s.kind === 'bar') {   // p = [x0, y, x1, base]
                ctx.globalAlpha = s.alpha ?? 0.85;
                const base0 = this.y.type === 'log' ? 10 ** this.y.lo : 0;
                for (const p of s.data) {
                    const base = p[3] || base0, top = base + p[1];
                    if (!(p[1] > 0)) continue;
                    const xa = this.px(p[0]), xb = this.px(p[2]), ya = this.py(top), yb = this.py(Math.max(base, base0));
                    ctx.fillRect(xa + 0.5, ya, Math.max(1, xb - xa - 1), yb - ya);
                }
                ctx.globalAlpha = 1; return;
            }
            ctx.beginPath();
            let pen = false, prev = null;
            for (const p of s.data) {
                if (!this._ok(p[0], p[1])) { pen = false; continue; }
                const x = this.px(p[0]), y = this.py(p[1]);
                if (s.kind === 'step' && pen) ctx.lineTo(x, this.py(prev[1]));
                pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; prev = p;
            }
            ctx.stroke(); ctx.setLineDash([]);
            if (s.points) for (const p of s.data) if (this._ok(p[0], p[1])) { ctx.beginPath(); ctx.arc(this.px(p[0]), this.py(p[1]), 2.4, 0, 7); ctx.fill(); }
        }
        _legend() {
            this.legendEl.replaceChildren();
            if (!this.opt.legend) return;
            const seen = new Set();
            for (const s of this.series) {
                if (s.legend === false || seen.has(s.name)) continue; seen.add(s.name);
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'splot-key'; b.setAttribute('aria-pressed', String(!this.hidden.has(s.name)));
                const sw = document.createElement('i'); sw.style.background = s.color;
                if (s.dash) sw.classList.add('dash');
                if (s.kind === 'band' || s.kind === 'bar') sw.classList.add('box');
                b.append(sw, document.createTextNode(s.name));
                b.title = 'Show or hide this series';
                b.onclick = () => { this.hidden.has(s.name) ? this.hidden.delete(s.name) : this.hidden.add(s.name); b.setAttribute('aria-pressed', String(!this.hidden.has(s.name))); this.draw(); };
                this.legendEl.append(b);
            }
        }
        _bind() {
            const c = this.canvas;
            const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
            const inside = (x, y) => this.box && x >= this.box.l && x <= this.box.l + this.box.w && y >= this.box.t && y <= this.box.t + this.box.h;
            c.addEventListener('pointerdown', e => {
                const [x, y] = pos(e); if (!this.opt.zoom || !inside(x, y) || e.button !== 0) return;
                this._drag = { x0: x, y0: y }; c.setPointerCapture(e.pointerId);
            });
            c.addEventListener('pointermove', e => {
                const [x, y] = pos(e);
                if (this._drag) { this._drag.x1 = x; this._drag.y1 = y; this.draw(); this.tip.hidden = true; return; }
                if (this.opt.readout && inside(x, y)) this._readout(x, y); else this.tip.hidden = true;
            });
            c.addEventListener('pointerup', () => {
                const d = this._drag; this._drag = null;
                if (d && d.x1 != null && Math.abs(d.x1 - d.x0) > 8) {
                    const f = (px) => (px - this.box.l) / this.box.w, g = (py) => 1 - (py - this.box.t) / this.box.h;
                    const xa = this.x.inv(f(Math.min(d.x0, d.x1))), xb = this.x.inv(f(Math.max(d.x0, d.x1)));
                    let ya = this.y.inv(g(Math.max(d.y0, d.y1))), yb = this.y.inv(g(Math.min(d.y0, d.y1)));
                    if (Math.abs(d.y1 - d.y0) < 8) { ya = this.y.inv(0); yb = this.y.inv(1); }
                    this.view = [xa, xb, ya, yb];
                }
                this.draw();
            });
            c.addEventListener('pointerleave', () => { this.tip.hidden = true; });
            c.addEventListener('dblclick', () => { this.view = null; this.draw(); });
        }
        _readout(px, py) {
            const xv = this.x.inv((px - this.box.l) / this.box.w);
            const rows = [];
            for (const s of this._visible()) {
                if (s.kind === 'band' || s.readout === false || !s.data.length) continue;
                let best = null, bd = Infinity;
                for (const p of s.data) {
                    if (!this._ok(p[0], p[1])) continue;
                    const d = s.kind === 'scatter' ? Math.hypot(this.px(p[0]) - px, this.py(p[1]) - py) : Math.abs(this.px(p[0]) - px);
                    if (d < bd) { bd = d; best = p; }
                }
                if (best && bd < (s.kind === 'scatter' ? 10 : 40)) rows.push([s, best]);
            }
            if (!rows.length) { this.tip.hidden = true; return; }
            const fx = this.x.format || (v => fmt(v, 4)), fy = this.y.format || (v => fmt(v, 3));
            this.tip.replaceChildren();
            const head = document.createElement('div'); head.className = 'splot-tip-x';
            head.textContent = (this.x.short || this.x.label.split('(')[0].trim()) + ' = ' + fx(rows[0][1][0] ?? xv);
            this.tip.append(head);
            for (const [s, p] of rows.slice(0, 8)) {
                const r = document.createElement('div'); const sw = document.createElement('i'); sw.style.background = s.color;
                r.append(sw, document.createTextNode(`${s.name}: ${s.label ? s.label(p) : fy(p[1])}`)); this.tip.append(r);
            }
            this.tip.hidden = false;
            const tw = this.tip.offsetWidth, left = px + 14 + tw > this.box.W ? px - tw - 14 : px + 14;
            this.tip.style.left = left + 'px'; this.tip.style.top = Math.max(4, py - 10) + 'px';
        }
        /** CSV of the visible series (long format: series, x, y[, y2]). */
        toCSV() {
            const lines = [`series,${csvq(this.x.label)},${csvq(this.y.label)},extra`];
            for (const s of this._visible()) for (const p of s.data) lines.push([csvq(s.name), p[0], p[1], p[2] ?? ''].join(','));
            return lines.join('\n');
        }
        toPNG() { return this.canvas.toDataURL('image/png'); }
    }
    const csvq = s => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;

    /* Colour maps (polynomial fits to matplotlib's inferno and viridis, M. Zucker 2019). */
    const CMAPS = {
        inferno: [[0.0002189, 0.0016510, -0.0194809], [0.1065134, 0.5639564, 3.9327124], [11.6024931, -3.9728540, -15.9423941], [-41.7039961, 17.4363989, 44.3541452], [77.1629357, -33.4023589, -81.8073093], [-71.3194282, 32.6260643, 73.2095199], [25.1311262, -12.2426690, -23.0703250]],
        viridis: [[0.2777273, 0.0054073, 0.3340998], [0.1050930, 1.4046135, 1.3845902], [-0.3308618, 0.2148476, 0.0950952], [-4.6342305, -5.7991010, -19.3324410], [6.2282699, 14.1799334, 56.6905526], [4.7763850, -13.7451454, -65.3530326], [-5.4354559, 4.6458526, 26.3124352]]
    };
    function cmap(t, name = 'inferno') {
        const c = CMAPS[name]; t = Math.min(1, Math.max(0, t));
        const out = [0, 0, 0];
        for (let k = 0; k < 3; k++) { let v = c[6][k]; for (let i = 5; i >= 0; i--) v = v * t + c[i][k]; out[k] = Math.round(255 * Math.min(1, Math.max(0, v))); }
        return out;
    }

    function download(name, content, type = 'text/csv') {
        const a = document.createElement('a');
        a.href = content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], { type }));
        a.download = name; document.body.append(a); a.click(); a.remove();
        if (!content.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    root.SpacePlot = SpacePlot;
    root.SpacePlotUtil = { fmt, cmap, download, sup };
})(typeof self !== 'undefined' ? self : globalThis);
