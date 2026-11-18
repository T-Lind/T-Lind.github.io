/* Space Debris Visualizer: page controller. SGP4 for the catalog runs in worker.js. */
(function () {
    'use strict';
    const O = window.SpaceOrbit, U = window.SpaceUI, P = window.SpacePlotUtil, D = window.DebrisEnv, h = U.h;
    const $ = id => document.getElementById(id);
    const fmt = (v, d = 3) => P.fmt(v, d);
    const MU = O.MU, RE = O.RE;
    const KINDS = ['Payload', 'Rocket body', 'Debris', 'Unknown'];
    const KCOL = ['#7fb8ff', '#ffb347', '#ff8a80', '#a8a8b3'];
    const KRGB = KCOL.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255));
    const OWNERS = { US: 'United States', PRC: 'China', CIS: 'Russia / USSR', UK: 'United Kingdom', FR: 'France', JPN: 'Japan', IND: 'India', ESA: 'ESA', ITSO: 'Intelsat', GER: 'Germany', CA: 'Canada', SES: 'SES', ISRA: 'Israel', IT: 'Italy', SPN: 'Spain', KOR: 'South Korea', ARGN: 'Argentina', BRAZ: 'Brazil', AUS: 'Australia', TBD: 'To be determined', EUME: 'EUMETSAT', GLOB: 'Globalstar', ORB: 'Orbcomm', IRID: 'Iridium', NZ: 'New Zealand', UAE: 'UAE', SAUD: 'Saudi Arabia', TURK: 'Türkiye', IRAN: 'Iran', NOR: 'Norway', LUXE: 'Luxembourg', FIN: 'Finland' };

    const st = {
        cat: null, F: null, n: 0, kind: null, inc: null, ecc: null, per: null, apo: null, period: null, a: null, year: null, rcs: null, owner: null, search: null, intl: null,
        mask: null, colors: null, sel: -1, simTime: Date.now(), playing: true, rate: 60, frame: 'inertial',
        frameData: null, pending: false, lastReq: 0, mine: null, mineEl: null, mineTrack: null, selTrack: null, orbitTracks: [], snapshot: null
    };
    let worker, globe, editor, land;

    function status(text, kind = '') { $('status').textContent = text; $('dot').className = 'dot ' + kind; }

    /* ---------------------------------------------------------------- boot */
    async function boot() {
        try {
            globe = new window.Globe($('globe'), { dist: 4.4 });
        } catch (err) { $('globe-msg').hidden = false; $('globe-msg').textContent = 'The 3D globe needs WebGL, which this browser has turned off. The analysis tabs below still work.'; }
        status('Loading the orbital catalog (about 2 MB)…', 'busy');
        try {
            const [cat, coast] = await Promise.all([fetch('../space/data/catalog.json').then(r => { if (!r.ok) throw new Error('catalog HTTP ' + r.status); return r.json(); }), fetch('../space/data/land-50m.json').then(r => r.json())]);
            land = coast; if (globe) globe.setCoast(coast);
            st.snapshot = cat;
            worker = new Worker('worker.js');
            worker.onmessage = onWorker;
            worker.onerror = e => status('Worker error: ' + e.message, 'err');
            setupControls();
            useCatalog(cat, true);
        } catch (err) { status('Could not load the catalog: ' + err.message, 'err'); }
    }

    function useCatalog(cat, initial) {
        st.cat = cat; st.F = Object.fromEntries(cat.fields.map((f, i) => [f, i]));
        derive();
        status(`Initialising SGP4 for ${st.n.toLocaleString()} objects…`, 'busy');
        worker.postMessage({ type: 'load', rows: cat.rows, fields: cat.fields });
        const m = cat.metadata || {};
        $('badge-count').textContent = st.n.toLocaleString();
        const ref = m.referenceEpoch ? new Date(m.referenceEpoch) : medianEpoch();
        $('badge-date').textContent = ref.toISOString().slice(0, 10);
        st.refEpoch = ref;
        const kv = $('cat-kv'); kv.replaceChildren();
        const add = (k, v) => kv.append(h('dt', { text: k }), h('dd', { text: v }));
        add('Source', m.title || 'User file');
        add('Objects', st.n.toLocaleString());
        if (m.retrievedAt) add('Retrieved', m.retrievedAt.slice(0, 16).replace('T', ' ') + ' UTC');
        add('Median epoch', ref.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
        if (m.attribution) add('Attribution', m.attribution);
        $('load-default').hidden = cat === st.snapshot;
        st.sel = -1;
        if (initial) {
            // open at the catalog epoch if "now" is far from it; elements age quickly
            const gap = Math.abs(Date.now() - ref.getTime()) / 86400e3;
            st.simTime = gap > 14 ? ref.getTime() : Date.now();
        }
        buildFilterOptions(); applyFilters(); renderObject();
    }
    function medianEpoch() {
        const ix = st.F.epoch, ts = st.cat.rows.map(r => Date.parse(r[ix] + 'Z')).filter(isFinite).sort((a, b) => a - b);
        return new Date(ts[Math.floor(ts.length / 2)] || Date.now());
    }
    function derive() {
        const rows = st.cat.rows, F = st.F, n = rows.length;
        st.n = n;
        const f32 = () => new Float32Array(n);
        st.kind = new Uint8Array(n); st.inc = f32(); st.ecc = f32(); st.per = f32(); st.apo = f32(); st.period = f32(); st.a = f32(); st.year = new Uint16Array(n); st.rcs = new Uint8Array(n);
        st.owner = new Array(n); st.search = new Array(n); st.intl = new Array(n);
        const RC = { L: 1, M: 2, S: 3 };
        for (let k = 0; k < n; k++) {
            const r = rows[k];
            const nn = r[F.n] * 2 * Math.PI / 86400, a = Math.pow(MU / (nn * nn), 1 / 3), e = r[F.e];
            st.kind[k] = r[F.kind]; st.inc[k] = r[F.i]; st.ecc[k] = e; st.a[k] = a; st.per[k] = a * (1 - e) - RE; st.apo[k] = a * (1 + e) - RE; st.period[k] = 1440 / r[F.n];
            const intl = r[F.intl] || '';
            st.year[k] = +(r[F.launch] || '').slice(0, 4) || +intl.slice(0, 4) || 0;
            st.rcs[k] = RC[r[F.rcsClass]] || 0; st.owner[k] = r[F.country] || ''; st.intl[k] = intl;
            st.search[k] = (r[F.name] + ' ' + intl).toLowerCase();
        }
        st.mask = new Uint8Array(n); st.colors = new Float32Array(n * 4);
    }

    /* ---------------------------------------------------------------- filters */
    function buildFilterOptions() {
        const n = st.n;
        const counts = [0, 0, 0, 0]; for (let k = 0; k < n; k++) counts[st.kind[k]]++;
        const types = $('types'); types.replaceChildren();
        KINDS.forEach((name, i) => types.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-kind': i, checked: true }), h('span', { class: 'sw', style: `background:${KCOL[i]}` }), name, h('span', { class: 'count', 'data-count': i, text: counts[i].toLocaleString() }))));
        types.onchange = applyFilters;
        const own = new Map(); for (let k = 0; k < n; k++) own.set(st.owner[k], (own.get(st.owner[k]) || 0) + 1);
        const cs = $('country'); cs.replaceChildren(h('option', { value: '', text: 'Any' }));
        [...own.entries()].filter(([c, v]) => c && v >= 10).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => cs.append(h('option', { value: c, text: `${OWNERS[c] || c} · ${v.toLocaleString()}` })));
        // fragmentation families: debris grouped by launch (international designator prefix)
        const fam = new Map();
        for (let k = 0; k < n; k++) { if (st.kind[k] !== 2) continue; const p = st.intl[k].slice(0, 8); if (p.length < 8) continue; fam.set(p, (fam.get(p) || 0) + 1); }
        // name each family by its most common debris name ("FENGYUN 1C DEB" -> "FENGYUN 1C")
        const names = new Map();
        for (let k = 0; k < n; k++) {
            if (st.kind[k] !== 2) continue; const p = st.intl[k].slice(0, 8); if (!fam.has(p)) continue;
            const base = String(st.cat.rows[k][st.F.name]).replace(/\s+(DEB|COOLANT|SHROUD|PLATFORM|R\/B)\b.*$/, '').trim();
            const m = names.get(p) || new Map(); m.set(base, (m.get(base) || 0) + 1); names.set(p, m);
        }
        const parent = new Map([...names.entries()].map(([p, m]) => [p, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
        const fs = $('family'); fs.replaceChildren(h('option', { value: '', text: 'All objects' }));
        [...fam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([p, v]) => {
            let name = parent.get(p);
            if (!name) { const k = st.intl.findIndex(x => x.startsWith(p)); name = (st.cat.rows[k][st.F.name] || '').replace(/\s+DEB.*$/, ''); }
            fs.append(h('option', { value: p, text: `${name} (${p}) · ${v.toLocaleString()} debris` }));
        });
    }
    function readFilters() {
        const kinds = new Set([...$('types').querySelectorAll('input[data-kind]')].filter(i => i.checked).map(i => +i.dataset.kind));
        const num = (id, d) => { const v = $(id).value; return v === '' ? d : +v; };
        return {
            kinds, q: $('search').value.trim().toLowerCase(), family: $('family').value, regime: $('regime').value,
            pmin: num('pmin', -Infinity), amax: num('amax', Infinity), imin: num('imin', -Infinity), imax: num('imax', Infinity),
            owner: $('country').value, rcs: $('rcs').value, ymin: num('ymin', 0), ymax: num('ymax', 9999), dim: $('dim').checked
        };
    }
    function matches(k, f) {
        if (!f.kinds.has(st.kind[k])) return false;
        if (f.family && !st.intl[k].startsWith(f.family)) return false;
        if (f.q) {
            if (/^\d+$/.test(f.q)) { if (String(st.cat.rows[k][st.F.id]) !== f.q) return false; }
            else if (!st.search[k].includes(f.q)) return false;
        }
        const pe = st.per[k], ap = st.apo[k], e = st.ecc[k];
        if (f.regime === 'leo' && !(ap < 2000)) return false;
        if (f.regime === 'geo' && !(Math.abs(st.period[k] - 1436) < 30 && e < 0.05)) return false;
        if (f.regime === 'heo' && !(e > 0.25)) return false;
        if (f.regime === 'meo' && !(ap >= 2000 && e <= 0.25 && !(Math.abs(st.period[k] - 1436) < 30))) return false;
        if (pe < f.pmin || ap > f.amax || st.inc[k] < f.imin || st.inc[k] > f.imax) return false;
        if (f.owner && st.owner[k] !== f.owner) return false;
        if (f.rcs) { const c = { L: 1, M: 2, S: 3, '?': 0 }[f.rcs]; if (st.rcs[k] !== c) return false; }
        if (st.year[k] && (st.year[k] < f.ymin || st.year[k] > f.ymax)) return false;
        return true;
    }
    function applyFilters() {
        if (!st.cat) return;
        const f = readFilters(); st.filter = f;
        const counts = [0, 0, 0, 0]; let shown = 0;
        for (let k = 0; k < st.n; k++) {
            const ok = matches(k, f); st.mask[k] = ok ? 1 : 0;
            const c = KRGB[st.kind[k]], o = 4 * k;
            st.colors[o] = c[0]; st.colors[o + 1] = c[1]; st.colors[o + 2] = c[2];
            st.colors[o + 3] = ok ? 0.95 : (f.dim ? 0.12 : 0);
            if (ok) { counts[st.kind[k]]++; shown++; }
        }
        if (st.sel >= 0) { const o = 4 * st.sel; st.colors[o] = st.colors[o + 1] = st.colors[o + 2] = 1; st.colors[o + 3] = 1; }
        $('shown').textContent = `${shown.toLocaleString()} of ${st.n.toLocaleString()}`;
        const lg = $('legend'); lg.replaceChildren(...KINDS.map((name, i) => h('div', { class: 'k' }, h('i', { style: `background:${KCOL[i]}` }), name, h('span', { class: 'c', text: counts[i].toLocaleString() }))));
        if (globe) globe.setColors(st.colors);
        if (f.q && shown === 1) { const k = st.mask.indexOf(1); if (k !== st.sel) select(k); }
        updateOrbitTracks();
        renderAnalysis();
        draw();
    }
    const applyFiltersSoon = U.debounce(applyFilters, 180);

    /* ---------------------------------------------------------------- controls */
    function setupControls() {
        for (const id of ['search', 'pmin', 'amax', 'imin', 'imax', 'ymin', 'ymax']) $(id).addEventListener('input', applyFiltersSoon);
        for (const id of ['family', 'regime', 'country', 'rcs', 'dim']) $(id).addEventListener('change', applyFilters);
        $('search').addEventListener('keydown', e => { if (e.key === 'Enter') { const k = st.mask.indexOf(1); if (k >= 0) { select(k); focusOn(k); } } });
        $('reset').onclick = () => {
            for (const id of ['search', 'pmin', 'amax', 'imin', 'imax', 'ymin', 'ymax']) $(id).value = '';
            for (const id of ['family', 'regime', 'country', 'rcs']) $(id).value = '';
            $('types').querySelectorAll('input').forEach(i => { i.checked = true; });
            applyFilters();
        };
        $('play').onclick = () => setPlaying(!st.playing);
        $('rate').onchange = () => { st.rate = +$('rate').value; };
        st.rate = +$('rate').value;
        $('now').onclick = () => setTime(Date.now());
        $('epoch').onclick = () => setTime(st.refEpoch.getTime());
        $('when').addEventListener('change', () => { const d = U.fromLocalInput($('when').value); if (d) setTime(d.getTime()); });
        for (const b of $('frame').querySelectorAll('button')) b.onclick = () => { st.frame = b.dataset.v; for (const o of $('frame').children) o.setAttribute('aria-pressed', String(o === b)); if (globe) globe.frame = st.frame; draw(); };
        $('psize').oninput = () => { $('psize-v').textContent = $('psize').value + ' px'; if (globe) { globe.pointSize = +$('psize').value; draw(); } };
        $('grid').onchange = () => { if (globe) { globe.showGrid = $('grid').checked; draw(); } };
        $('light').onchange = () => { if (globe) { globe.lit = $('light').checked ? 1 : 0; draw(); } };
        $('orbits').onchange = updateOrbitTracks;
        $('mine-on').onchange = () => { updateMine(); };
        $('area').oninput = U.debounce(renderExposure, 200); $('years').oninput = U.debounce(renderExposure, 200);
        $('load-file').onclick = () => $('file').click();
        $('file').onchange = loadFile;
        $('load-default').onclick = () => useCatalog(st.snapshot, false);
        $('dens-range').onchange = renderDensity;
        $('scr-run').onclick = runScreen;
        document.querySelectorAll('[data-csv]').forEach(b => b.onclick = () => exportCSV(b.dataset.csv));
        editor = new U.OrbitEditor($('editor'), { idPrefix: 'db', epoch: () => new Date(st.simTime), onChange: src => { st.mineSource = src; updateMine(); } });
        U.tabs($('tabs'), name => { st.tab = name; renderAnalysis(); });
        st.tab = 'object';
        if (globe) {
            globe.onclick = e => {
                const r = $('globe').getBoundingClientRect();
                const k = globe.pick(e.clientX - r.left, e.clientY - r.top, i => st.colors[4 * i + 3] > 0.2);
                select(k);
            };
            globe.onchange = placeTags;
            new ResizeObserver(() => draw()).observe($('globe-wrap'));
        }
        // default "your orbit": the ISS preset
        editor.preset.value = 'iss'; editor._fromPreset();
        requestAnimationFrame(loop);
    }
    function setPlaying(on) { st.playing = on; $('play').textContent = on ? 'Pause' : 'Play'; $('play').setAttribute('aria-pressed', String(on)); }
    function setTime(t) { st.simTime = t; requestPositions(true); updateTracksForTime(); draw(); }

    /* ---------------------------------------------------------------- animation */
    let lastFrame = performance.now(), lastUi = 0;
    function loop(now) {
        const dt = Math.min(0.25, (now - lastFrame) / 1000); lastFrame = now;
        if (st.playing) st.simTime += dt * 1000 * st.rate;
        requestPositions(false);
        if (st.playing || st.dirty) { draw(); st.dirty = false; }
        if (now - lastUi > 500) { lastUi = now; updateClock(); if (st.tab === 'object' && st.sel >= 0) updateLive(); }
        requestAnimationFrame(loop);
    }
    function requestPositions(force) {
        if (!worker || !st.ready) return;
        if (st.pending) { if (force) st.again = true; return; }
        if (!force && st.frameData && Math.abs(st.simTime - st.frameData.time) < 50 && !st.playing) return;
        st.pending = true;
        // ask a little ahead so the answer lands near the time it is drawn
        const lead = st.playing ? st.rate * 60 : 0;
        worker.postMessage({ type: 'positions', time: st.simTime + lead });
    }
    let work = null;
    function draw() {
        if (!globe) return;
        const g = O.gmst(new Date(st.simTime));
        globe.gmst = g; globe.sun = sunDir(st.simTime); globe.frame = st.frame;
        const fd = st.frameData;
        if (fd) {
            const dt = (st.simTime - fd.time) / 1000, n = fd.pos.length / 3;
            if (!work || work.length !== fd.pos.length) work = new Float32Array(fd.pos.length);
            const p = fd.pos, v = fd.vel;
            for (let i = 0; i < n; i++) {
                const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
                const r2 = x * x + y * y + z * z, k = -0.5 * MU / (r2 * Math.sqrt(r2)) * dt * dt;
                work[3 * i] = x + v[3 * i] * dt + k * x; work[3 * i + 1] = y + v[3 * i + 1] * dt + k * y; work[3 * i + 2] = z + v[3 * i + 2] * dt + k * z;
            }
            globe.setPoints(work, null);
        }
        const markers = [];
        if (st.mine && $('mine-on').checked) { const pv = O.stateAt(st.mine, new Date(st.simTime)); if (pv) { st.minePos = [pv.position.x, pv.position.y, pv.position.z]; markers.push({ pos: st.minePos, color: [0.9, 0.82, 0.66, 1] }); } else st.minePos = null; }
        if (st.sel >= 0 && work && isFinite(work[3 * st.sel])) markers.push({ pos: [work[3 * st.sel], work[3 * st.sel + 1], work[3 * st.sel + 2]], color: [1, 1, 1, 1] });
        globe.setMarkers(markers);
        const tracks = [...st.orbitTracks];
        if (st.selTrack) tracks.push({ points: st.selTrack, color: [1, 1, 1, 0.75] });
        if (st.mineTrack && $('mine-on').checked) tracks.push({ points: st.mineTrack, color: [0.9, 0.82, 0.66, 0.9] });
        if (st.tracksDirty) { globe.setTracks(tracks); st.tracksDirty = false; }
        globe.draw();
        placeTags();
    }
    function placeTags() {
        const M = globe.matrices();
        const tag = $('tag'), tm = $('tag-mine');
        if (st.sel >= 0 && work && isFinite(work[3 * st.sel])) {
            const s = globe.project([work[3 * st.sel], work[3 * st.sel + 1], work[3 * st.sel + 2]], M);
            tag.hidden = !s || s.hidden; if (s) { tag.style.left = s.x + 'px'; tag.style.top = s.y + 'px'; tag.textContent = st.cat.rows[st.sel][st.F.name]; }
        } else tag.hidden = true;
        if (st.minePos && $('mine-on').checked) {
            const s = globe.project(st.minePos, M);
            tm.hidden = !s || s.hidden; if (s) { tm.style.left = s.x + 'px'; tm.style.top = s.y + 'px'; tm.textContent = (st.mineSource && st.mineSource.name) || 'Your orbit'; }
        } else tm.hidden = true;
    }
    function sunDir(t) {
        const n = t / 86400000 + 2440587.5 - 2451545.0, rad = Math.PI / 180;
        const L = (280.460 + 0.9856474 * n) * rad, g = (357.528 + 0.9856003 * n) * rad;
        const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
        return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
    }
    function updateClock() {
        const d = new Date(st.simTime);
        $('clock').textContent = U.utc(d, true);
        if (document.activeElement !== $('when')) $('when').value = U.toLocalInput(d);
        if (st.refEpoch) {
            const age = (st.simTime - st.refEpoch.getTime()) / 86400e3, el = $('age');
            el.textContent = `${Math.abs(age).toFixed(1)} days ${age >= 0 ? 'after' : 'before'} catalog epoch${Math.abs(age) > 7 ? ' · positions degrade' : ''}`;
            el.classList.toggle('warn', Math.abs(age) > 7);
        }
    }

    /* ---------------------------------------------------------------- worker */
    function onWorker(e) {
        const m = e.data;
        if (m.type === 'loaded') {
            st.ready = true; st.pending = false;
            status(`${st.n.toLocaleString()} objects ready${m.bad ? ` · ${m.bad} could not be initialised` : ''}. Elements are mean SGP4 sets; positions are good to a few km near their epoch.`, 'ok');
            $('stamp').textContent = (st.cat.metadata && st.cat.metadata.attribution) || '';
            requestPositions(true); return;
        }
        if (m.type === 'positions') {
            st.frameData = m; st.pending = false; st.dirty = true;
            if (st.again) { st.again = false; requestPositions(true); }
            return;
        }
        if (m.type === 'track' && m.id === st.trackReq) { st.selTrack = m.points; st.tracksDirty = true; st.dirty = true; return; }
        if (m.type === 'tracks' && m.id === st.tracksReq) { st.orbitTracks = m.tracks.map(t => ({ points: t, color: [1, 1, 1, 0.12], loop: true })); st.tracksDirty = true; st.dirty = true; return; }
        if (m.type === 'screen-progress' && m.id === st.screenId) { $('scr-prog').value = m.frac; status(`Screening ${m.candidates.toLocaleString()} candidate objects… ${Math.round(m.frac * 100)}%`, 'busy'); return; }
        if (m.type === 'screen' && m.id === st.screenId) { renderScreen(m); return; }
        if (m.type === 'error') { status(`${m.what} failed: ${m.error}`, 'err'); if (m.what === 'screen') { $('scr-run').disabled = false; $('scr-prog').hidden = true; } if (m.what === 'positions') st.pending = false; }
    }

    /* ---------------------------------------------------------------- selection */
    function select(k) {
        const prev = st.sel; st.sel = k;
        if (prev >= 0) { const c = KRGB[st.kind[prev]], o = 4 * prev; st.colors[o] = c[0]; st.colors[o + 1] = c[1]; st.colors[o + 2] = c[2]; st.colors[o + 3] = st.mask[prev] ? 0.95 : (st.filter && st.filter.dim ? 0.12 : 0); }
        if (k >= 0) { const o = 4 * k; st.colors[o] = st.colors[o + 1] = st.colors[o + 2] = 1; st.colors[o + 3] = 1; }
        if (globe) globe.setColors(st.colors);
        st.selTrack = null; st.tracksDirty = true;
        if (k >= 0) { st.trackReq = Math.random(); worker.postMessage({ type: 'track', id: st.trackReq, index: k, time: st.simTime }); }
        renderObject(); st.dirty = true;
        if (k >= 0 && st.tab !== 'object' && st.tab !== 'screen') document.querySelector('[data-tab=object]').click();
    }
    function focusOn(k) {
        if (!globe || !work || !isFinite(work[3 * k])) return;
        let x = work[3 * k], y = work[3 * k + 1];
        if (st.frame === 'fixed') { const g = -globe.gmst, c = Math.cos(g), s = Math.sin(g); [x, y] = [c * x - s * y, s * x + c * y]; }
        const z = work[3 * k + 2], r = Math.hypot(x, y, z);
        globe.cam.az = Math.atan2(y, x); globe.cam.el = Math.asin(z / r); globe.cam.dist = Math.max(globe.cam.dist, r / RE * 1.6 + 0.5);
        draw();
    }
    function updateTracksForTime() {
        if (st.sel >= 0) { st.trackReq = Math.random(); worker.postMessage({ type: 'track', id: st.trackReq, index: st.sel, time: st.simTime }); }
        if (st.mine) { st.mineTrack = mineTrack(); st.tracksDirty = true; }
        updateOrbitTracks();
    }
    function updateOrbitTracks() {
        if (!worker || !st.ready && !st.cat) return;
        if (!$('orbits').checked) { if (st.orbitTracks.length) { st.orbitTracks = []; st.tracksDirty = true; st.dirty = true; } return; }
        const idx = []; for (let k = 0; k < st.n && idx.length < 300; k++) if (st.mask[k]) idx.push(k);
        st.tracksReq = Math.random(); worker.postMessage({ type: 'tracks', id: st.tracksReq, indices: idx, time: st.simTime });
    }
    function rowOMM(k) {
        const r = st.cat.rows[k], F = st.F;
        return { OBJECT_NAME: r[F.name], OBJECT_ID: r[F.intl], EPOCH: r[F.epoch], MEAN_MOTION: r[F.n], ECCENTRICITY: r[F.e], INCLINATION: r[F.i], RA_OF_ASC_NODE: r[F.raan], ARG_OF_PERICENTER: r[F.argp], MEAN_ANOMALY: r[F.M], EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: r[F.id], ELEMENT_SET_NO: 999, REV_AT_EPOCH: r[F.rev] || 0, BSTAR: r[F.bstar], MEAN_MOTION_DOT: r[F.ndot], MEAN_MOTION_DDOT: r[F.nddot] };
    }
    function renderObject() {
        const body = $('object-body');
        if (st.sel < 0 || !st.cat) { body.replaceChildren(h('p', { class: 'note', text: 'Click an object on the globe, or search for one by name or number. Press Enter in the search box to jump to the first match.' })); return; }
        const k = st.sel, r = st.cat.rows[k], F = st.F;
        const sr = O.satellite.json2satrec(rowOMM(k)), el = O.elementsOf(sr);
        const epoch = new Date(r[F.epoch] + 'Z');
        const STATUS = { '+': 'Operational', '-': 'Non-operational', P: 'Partially operational', B: 'Backup', S: 'Spare', X: 'Extended mission', D: 'Decayed', '?': 'Unknown' };
        const kv = (rows) => h('dl', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
        st.liveEl = h('dl', { class: 'kv' });
        const famPrefix = (r[F.intl] || '').slice(0, 8);
        body.replaceChildren(
            h('div', { class: 'obj-title' },
                h('div', {}, h('h2', { text: r[F.name] }), h('div', { class: 'sub', text: `NORAD ${r[F.id]} · COSPAR ${r[F.intl] || '—'} · ${KINDS[r[F.kind]]}` })),
                h('div', { class: 'row' },
                    h('button', { type: 'button', class: 'btn small', text: 'Use as your orbit', onclick: () => { const src = { kind: 'omm', name: r[F.name], omm: rowOMM(k) }; editor.setSource(src); st.mineSource = src; updateMine(); } }),
                    h('button', { type: 'button', class: 'btn small ghost', text: 'Centre view', onclick: () => focusOn(k) }),
                    famPrefix.length === 8 ? h('button', { type: 'button', class: 'btn small ghost', text: `Show launch ${famPrefix}`, onclick: () => { $('search').value = famPrefix; applyFilters(); } }) : null,
                    h('button', { type: 'button', class: 'btn small ghost', text: 'Deselect', onclick: () => select(-1) }))),
            h('div', { class: 'obj-grid' },
                h('div', {}, h('h3', { text: 'Catalog' }), kv([
                    ['Owner', OWNERS[r[F.country]] ? `${OWNERS[r[F.country]]} (${r[F.country]})` : (r[F.country] || '—')], ['Launch date', r[F.launch] || '—'], ['Status', STATUS[r[F.status]] || (r[F.status] || 'Not listed')],
                    ['Radar cross-section', r[F.rcs] != null ? `${r[F.rcs]} m² (${{ L: 'large', M: 'medium', S: 'small' }[r[F.rcsClass]] || '—'})` : ({ L: 'Large', M: 'Medium', S: 'Small' }[r[F.rcsClass]] || '—')],
                    ['Element epoch', U.utc(epoch, true)], ['Element age at view time', `${((st.simTime - epoch.getTime()) / 86400e3).toFixed(2)} days`]])),
                h('div', {}, h('h3', { text: 'Mean elements (SGP4)' }), kv([
                    ['Perigee × apogee', `${U.km(el.perigee)} × ${U.km(el.apogee)}`], ['Semi-major axis', `${el.a.toFixed(1)} km`], ['Eccentricity', el.e.toFixed(7)], ['Inclination', `${el.inc.toFixed(4)}°`],
                    ['RAAN', `${el.raan.toFixed(4)}°`], ['Arg. of perigee', `${el.argp.toFixed(4)}°`], ['Mean anomaly', `${el.ma.toFixed(4)}°`], ['Period', `${el.period.toFixed(2)} min · ${(1440 / el.period).toFixed(4)} rev/day`], ['B*', `${r[F.bstar].toExponential(4)} 1/ER`]])),
                h('div', {}, h('h3', { text: 'State at view time' }), st.liveEl)));
        updateLive();
    }
    function updateLive() {
        if (st.sel < 0 || !st.liveEl || !st.cat) return;
        const sr = st.liveSat && st.liveSat.k === st.sel ? st.liveSat.s : (st.liveSat = { k: st.sel, s: O.satellite.json2satrec(rowOMM(st.sel)) }).s;
        const d = new Date(st.simTime), pv = O.stateAt(sr, d);
        const rows = [];
        if (!pv) rows.push(['SGP4', 'No solution (decayed or invalid at this time)']);
        else {
            const g = O.geodetic(pv.position, O.gmst(d)), v = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
            rows.push(['Time', U.utc(d, true)], ['Latitude', `${Math.abs(g.lat).toFixed(3)}° ${g.lat < 0 ? 'S' : 'N'}`], ['Longitude', `${Math.abs(g.lon).toFixed(3)}° ${g.lon < 0 ? 'W' : 'E'}`],
                ['Geodetic altitude', U.km(g.h)], ['Inertial speed', `${v.toFixed(3)} km/s`], ['TEME position', `${pv.position.x.toFixed(1)}, ${pv.position.y.toFixed(1)}, ${pv.position.z.toFixed(1)} km`]);
            if (st.minePos) rows.push(['Range from your orbit', U.km(Math.hypot(pv.position.x - st.minePos[0], pv.position.y - st.minePos[1], pv.position.z - st.minePos[2]))]);
        }
        st.liveEl.replaceChildren(...rows.flatMap(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
    }

    /* ---------------------------------------------------------------- your orbit */
    function updateMine() {
        try { st.mine = st.mineSource ? O.satrecFromSource(st.mineSource) : null; st.mineEl = st.mine ? O.elementsOf(st.mine) : null; }
        catch (err) { st.mine = null; st.mineEl = null; }
        st.mineTrack = st.mine ? mineTrack() : null; st.tracksDirty = true; st.dirty = true;
        renderAnalysis();
    }
    function mineTrack() {
        const P = st.mineEl.period * 60e3, out = [];
        for (let k = 0; k <= 360; k++) { const pv = O.stateAt(st.mine, new Date(st.simTime + P * k / 360)); if (!pv) break; out.push(pv.position.x, pv.position.y, pv.position.z); }
        return new Float32Array(out);
    }

    /* ---------------------------------------------------------------- density math */
    /** Fraction of orbit time with radius in each shell [edges[i], edges[i+1]] (radii, km). */
    function shellFractions(a, e, edges, out, weight = 1) {
        const rp = a * (1 - e), ra = a * (1 + e), n = edges.length - 1;
        if (ra < edges[0] || rp > edges[n]) return;
        if (e < 1e-6) { const i = bisect(edges, a); if (i >= 0 && i < n) out[i] += weight; return; }
        const Mof = r => { const c = Math.min(1, Math.max(-1, (1 - r / a) / e)); const E = Math.acos(c); return E - e * Math.sin(E); };
        let i0 = Math.max(0, bisect(edges, rp)), i1 = Math.min(n - 1, bisect(edges, ra));
        for (let i = i0; i <= i1; i++) {
            const lo = Math.max(edges[i], rp), hi = Math.min(edges[i + 1], ra);
            if (hi > lo) out[i] += weight * (Mof(hi) - Mof(lo)) / Math.PI;
        }
    }
    function bisect(edges, r) { let lo = 0, hi = edges.length - 1; if (r < edges[0]) return -1; if (r >= edges[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (edges[m] <= r) lo = m; else hi = m; } return lo; }
    function densityProfile(edges, byKind) {
        const n = edges.length - 1, out = byKind ? [0, 1, 2, 3].map(() => new Float64Array(n)) : [new Float64Array(n)];
        for (let k = 0; k < st.n; k++) { if (!st.mask[k]) continue; shellFractions(st.a[k], st.ecc[k], edges, out[byKind ? st.kind[k] : 0]); }
        for (const arr of out) for (let i = 0; i < n; i++) arr[i] /= 4 / 3 * Math.PI * (edges[i + 1] ** 3 - edges[i] ** 3);
        return out;
    }
    const logEdges = (h0, h1, n) => Array.from({ length: n + 1 }, (_, i) => RE + h0 * Math.pow(h1 / h0, i / n));

    /* ---------------------------------------------------------------- analysis */
    const plots = {};
    function plot(id, opt) { if (!plots[id]) plots[id] = new window.SpacePlot($(id), opt); return plots[id]; }
    function renderAnalysis() {
        if (!st.cat) return;
        const t = st.tab;
        if (t === 'density') renderDensity(); else if (t === 'gabbard') renderGabbard(); else if (t === 'incl') renderIncl();
        else if (t === 'counts') renderCounts(); else if (t === 'exposure') renderExposure(); else if (t === 'method') renderMethod(); else if (t === 'screen') renderScreenHead();
    }
    function mineMarks() { return st.mineEl && $('mine-on').checked ? [{ x0: Math.max(1, st.mineEl.perigee - 5), x1: st.mineEl.apogee + 5, label: 'your orbit', color: '#e6d2a8' }] : []; }
    function renderDensity() {
        const all = $('dens-range').value === 'all';
        const edges = all ? logEdges(200, 40000, 240) : Array.from({ length: 181 }, (_, i) => RE + 200 + 10 * i);
        const prof = densityProfile(edges, true);
        const mids = edges.slice(0, -1).map((r, i) => (r + edges[i + 1]) / 2 - RE);
        const total = mids.map((_, i) => prof.reduce((s, a) => s + a[i], 0));
        const p = plot('plot-density', { x: { type: 'lin', label: 'Altitude (km)', short: 'h', format: v => Math.round(v).toLocaleString() + ' km' }, y: { type: 'log', label: 'Spatial density (objects / km³)', floorDecades: 6 } });
        p.setAxes({ type: all ? 'log' : 'lin' });
        const series = [{ name: 'All filtered', color: '#e8e8ec', width: 2, kind: 'step', data: mids.map((m, i) => [m, total[i]]) }];
        KINDS.forEach((name, i) => { if (prof[i].some(v => v > 0)) series.push({ name, color: KCOL[i], kind: 'step', width: 1.2, data: mids.map((m, j) => [m, prof[i][j]]) }); });
        p.set(series, mineMarks());
        st.densityCSV = ['altitude_km,total,payload,rocket_body,debris,unknown', ...mids.map((m, i) => [m.toFixed(1), total[i], prof[0][i], prof[1][i], prof[2][i], prof[3][i]].join(','))].join('\n');
    }
    function renderGabbard() {
        const ap = [], pe = [];
        for (let k = 0; k < st.n; k++) { if (!st.mask[k]) continue; ap.push([st.period[k], st.apo[k], k]); pe.push([st.period[k], st.per[k], k]); }
        const many = ap.length > 4000;
        const p = plot('plot-gabbard', { x: { type: 'lin', label: 'Orbital period (min)', short: 'T', format: v => v.toFixed(1) + ' min' }, y: { type: 'lin', label: 'Altitude (km)', zero: false } });
        const name = q => st.cat.rows[q[2]][st.F.name];
        p.set([
            { name: 'Apogee', color: '#ff8a80', kind: 'scatter', size: many ? 1.4 : 2.4, data: ap, label: q => `${name(q)} · ${Math.round(q[1]).toLocaleString()} km` },
            { name: 'Perigee', color: '#7fb8ff', kind: 'scatter', size: many ? 1.4 : 2.4, data: pe, label: q => `${name(q)} · ${Math.round(q[1]).toLocaleString()} km` }
        ], [], `${ap.length.toLocaleString()} objects`);
    }
    function renderIncl() {
        const series = KINDS.map((name, i) => ({ name, color: KCOL[i], kind: 'scatter', size: 1.6, alpha: 0.7, data: [], label: q => `${st.cat.rows[q[2]][st.F.name]} · ${q[1].toFixed(2)}°` }));
        for (let k = 0; k < st.n; k++) { if (!st.mask[k]) continue; series[st.kind[k]].data.push([Math.max(150, (st.per[k] + st.apo[k]) / 2), st.inc[k], k]); }
        const p = plot('plot-incl', { x: { type: 'log', label: 'Mean altitude (km)', short: 'h', format: v => Math.round(v).toLocaleString() + ' km' }, y: { type: 'lin', label: 'Inclination (deg)', min: 0, max: 145 } });
        const marks = [{ y: 98, label: 'sun-synchronous ≈ 97–99°', color: 'rgba(255,255,255,.25)' }, { x: 35786, label: 'GEO', color: 'rgba(255,255,255,.25)' }];
        if (st.mineEl && $('mine-on').checked) marks.push({ x: (st.mineEl.perigee + st.mineEl.apogee) / 2, label: 'your orbit', color: '#e6d2a8' });
        p.set(series.filter(s => s.data.length), marks);
    }
    function renderCounts() {
        const years = new Map(), kinds = [0, 1, 2, 3];
        let y0 = 9999, y1 = 0;
        for (let k = 0; k < st.n; k++) { if (!st.mask[k] || !st.year[k]) continue; const y = st.year[k]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); const a = years.get(y) || [0, 0, 0, 0]; a[st.kind[k]]++; years.set(y, a); }
        const series = [];
        const base = new Map();
        for (const i of kinds) {
            const data = [];
            for (let y = y0; y <= y1; y++) { const a = years.get(y) || [0, 0, 0, 0], b = base.get(y) || 0; data.push([y - 0.5, a[i], y + 0.5, b]); base.set(y, b + a[i]); }
            if (data.some(d => d[1] > 0)) series.push({ name: KINDS[i], color: KCOL[i], kind: 'bar', data, label: q => `${Math.round(q[0] + 0.5)}: ${q[1]} ${KINDS[i].toLowerCase()}` });
        }
        plot('plot-years', { x: { type: 'lin', label: 'Launch year', short: 'year', format: v => String(Math.round(v)) }, y: { type: 'lin', label: 'Objects still in orbit' } }).set(series);
        const edges = Array.from({ length: 41 }, (_, i) => 150 * Math.pow(45000 / 150, i / 40));
        const cnt = kinds.map(() => new Array(40).fill(0));
        for (let k = 0; k < st.n; k++) { if (!st.mask[k]) continue; const hm = (st.per[k] + st.apo[k]) / 2; const i = Math.floor(Math.log(hm / 150) / Math.log(45000 / 150) * 40); if (i >= 0 && i < 40) cnt[st.kind[k]][i]++; }
        const s2 = [], b2 = new Array(40).fill(0);
        for (const i of kinds) { const data = cnt[i].map((c, j) => { const d = [edges[j], c, edges[j + 1], b2[j]]; b2[j] += c; return d; }); if (cnt[i].some(c => c)) s2.push({ name: KINDS[i], color: KCOL[i], kind: 'bar', data, label: q => `${Math.round(q[0])}–${Math.round(q[2])} km: ${q[1]}` }); }
        plot('plot-alt', { x: { type: 'log', label: 'Mean altitude (km)', short: 'h', format: v => Math.round(v).toLocaleString() + ' km' }, y: { type: 'lin', label: 'Objects' } }).set(s2);
        // regime table
        const regimes = [['LEO', k => st.apo[k] < 2000], ['MEO', k => st.apo[k] >= 2000 && st.ecc[k] <= 0.25 && !(Math.abs(st.period[k] - 1436) < 30)], ['GEO belt', k => Math.abs(st.period[k] - 1436) < 30 && st.ecc[k] < 0.05], ['HEO', k => st.ecc[k] > 0.25], ['Other', () => true]];
        const tab = regimes.map(() => [0, 0, 0, 0]);
        for (let k = 0; k < st.n; k++) { if (!st.mask[k]) continue; const r = regimes.findIndex(([, f]) => f(k)); tab[r][st.kind[k]]++; }
        $('count-table').replaceChildren(
            h('thead', {}, h('tr', {}, h('th', { text: 'Regime' }), ...KINDS.map(k => h('th', { text: k })), h('th', { text: 'Total' }))),
            h('tbody', {}, ...regimes.map(([name], r) => h('tr', {}, h('td', { class: 'l', text: name }), ...tab[r].map(v => h('td', { text: v.toLocaleString() })), h('td', { class: 'strong', text: tab[r].reduce((a, b) => a + b, 0).toLocaleString() })))));
    }

    function renderExposure() {
        const head = $('exposure-head');
        if (st.tab !== 'exposure') return;
        if (!st.mineEl) { head.replaceChildren(h('p', { class: 'note', text: 'Define your orbit in the panel on the left (a preset, elements, or a TLE/OMM) to see its debris exposure.' })); return; }
        const el = st.mineEl, A = Math.max(1e-6, +$('area').value || 1), T = Math.max(0.001, +$('years').value || 1);
        // user time fraction in log shells
        const edges = logEdges(150, 45000, 480), n = edges.length - 1;
        const fu = new Float64Array(n); shellFractions(el.a, el.e, edges, fu);
        const dens = densityProfile(edges, false)[0];
        const mids = edges.slice(0, -1).map((r, i) => (r + edges[i + 1]) / 2);
        let rho = 0, flux = 0, leoFrac = 0;
        for (let i = 0; i < n; i++) {
            if (!fu[i]) continue;
            rho += fu[i] * dens[i];
            const hkm = mids[i] - RE;
            if (hkm < 2000) { const v = D.VREL_OVER_VCIRC * Math.sqrt(MU / mids[i]); flux += fu[i] * dens[i] * v * 1e-6 * 3.15576e7; leoFrac += fu[i]; }
        }
        const crossing = [0, 0, 0, 0];
        for (let k = 0; k < st.n; k++) if (st.mask[k] && st.per[k] <= el.apogee && st.apo[k] >= el.perigee) crossing[st.kind[k]]++;
        const nTr = flux * A * T, pTr = -Math.expm1(-nTr);
        // small-particle proxies, weighted by time at each altitude
        let cov = 0; for (let i = 0; i < n; i++) { const hkm = mids[i] - RE; if (hkm >= D.H_MIN && hkm <= D.H_MAX) cov += fu[i]; }
        const sizes = []; for (let i = 0; i <= 50; i++) sizes.push(1e-4 * Math.pow(1e4, i / 50));
        const avg = (fn) => { let s = 0; for (let i = 0; i < n; i++) if (fu[i]) s += fu[i] * fn(mids[i] - RE); return s; };
        const inBand = hk => hk >= D.H_MIN && hk <= D.H_MAX;
        const ordem = sizes.map(d => avg(hk => inBand(hk) ? D.debrisFlux('ORDEM', hk, d) : 0));
        const master = sizes.map(d => avg(hk => inBand(hk) ? D.debrisFlux('MASTER', hk, d) : 0));
        const mem = sizes.map(d => avg(hk => D.meteoroidFlux(hk, d)));
        const metric = (lab, val, sub) => h('div', { class: 'metric' }, h('div', { class: 'lab', text: lab }), h('div', { class: 'val' }, val, sub ? h('small', { text: ' ' + sub }) : null));
        head.replaceChildren(
            h('p', { class: 'note', style: 'margin:0 0 .7rem' }, `${(st.mineSource && st.mineSource.name) || 'Your orbit'} · ${U.summary(el)} · exposed area ${A} m² · ${T} years. Catalog figures use the filtered set (${[...st.mask].reduce((a, b) => a + b, 0).toLocaleString()} objects).`),
            h('div', { class: 'metrics' },
                metric('Catalog objects crossing your altitudes', crossing.reduce((a, b) => a + b, 0).toLocaleString(), `${crossing[2].toLocaleString()} debris`),
                metric('Mean tracked-object density', fmt(rho), 'per km³'),
                metric('Tracked-object flux', leoFrac > 0 ? fmt(flux) : '—', leoFrac > 0 ? 'per m² per year' : 'LEO only'),
                metric('Expected tracked impacts', leoFrac > 0 ? fmt(nTr) : '—', leoFrac > 0 ? `P(≥1) = ${(100 * pTr).toPrecision(2)}%` : ''),
                metric('Small-debris model coverage', `${(100 * cov).toFixed(0)}%`, 'of orbit time in 200–1,500 km')));
        $('exp-sub').textContent = `time-averaged over your orbit · ${A} m² · ${T} yr`;
        const marks = [{ x: 0.1, label: 'tracked ≈ 10 cm', color: 'rgba(255,255,255,.3)' }];
        const fx = plot('plot-flux', { x: { type: 'log', label: 'Particle diameter (m)', short: 'd', format: v => v >= 0.01 ? (v * 100).toPrecision(3) + ' cm' : (v * 1000).toPrecision(3) + ' mm' }, y: { type: 'log', label: 'Cumulative flux > d (impacts / m² / yr)', floorDecades: 12 } });
        const series = [];
        if (cov > 0) series.push({ name: 'ORDEM 3.1 proxy (debris)', color: '#ff8a80', width: 2, data: sizes.map((d, i) => [d, ordem[i]]) }, { name: 'MASTER-8 proxy (debris)', color: '#ffb347', width: 2, dash: [6, 4], data: sizes.map((d, i) => [d, master[i]]) });
        series.push({ name: 'MEM R2 proxy (meteoroids)', color: '#7fb8ff', width: 1.6, data: sizes.map((d, i) => [d, mem[i]]).filter(p => p[1] > 0) });
        if (leoFrac > 0 && flux > 0) series.push({ name: 'Catalog (tracked, filtered set)', color: '#e8e8ec', kind: 'scatter', size: 7, data: [[0.1, flux]] });
        fx.set(series, marks);
        // tracked density along the orbit
        const lo = Math.max(150, el.perigee - 150), hi = el.apogee + 150;
        const prof = []; for (let i = 0; i < n; i++) { const hk = mids[i] - RE; if (hk >= lo && hk <= hi) prof.push([hk, dens[i], fu[i]]); }
        const sh = plot('plot-shell', { x: { type: el.apogee / Math.max(200, el.perigee) > 4 ? 'log' : 'lin', label: 'Altitude (km)', short: 'h', format: v => Math.round(v).toLocaleString() + ' km' }, y: { type: 'log', label: 'Spatial density (objects / km³)', floorDecades: 6 } });
        sh.setAxes({ type: el.apogee / Math.max(200, el.perigee) > 4 ? 'log' : 'lin' });
        sh.set([{ name: 'Catalog density', color: '#e8e8ec', kind: 'step', data: prof, label: q => `${fmt(q[1])} /km³ · ${(100 * q[2]).toFixed(2)}% of your time` }], [{ x: Math.max(lo, el.perigee), label: 'perigee', color: '#e6d2a8' }, { x: el.apogee, label: 'apogee', color: '#e6d2a8', row: 1 }]);
        // table
        const pick = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 0.1];
        const at = (arr, d) => { const i = sizes.findIndex(s => s >= d * 0.999); return arr[Math.max(0, i)]; };
        const rowFor = (lab, arr) => h('tr', {}, h('td', { class: 'l', text: lab }), ...pick.flatMap(d => { const F = at(arr, d), N = F * A * T; return [h('td', { text: fmt(F) }), h('td', { class: 'strong', text: N >= 0.01 ? fmt(N) : (N > 0 ? N.toExponential(1) : '0') })]; }));
        const sz = d => d >= 0.01 ? `${(d * 100).toPrecision(2)} cm` : `${(d * 1000).toPrecision(2)} mm`;
        $('exposure-table').replaceChildren(
            h('thead', {}, h('tr', {}, h('th', { text: 'Environment' }), ...pick.flatMap(d => [h('th', {}, `> ${sz(d)}`, h('span', { class: 'units', text: 'flux /m²/yr' })), h('th', {}, `> ${sz(d)}`, h('span', { class: 'units', text: 'impacts, mission' }))]))),
            h('tbody', {}, cov > 0 ? rowFor('ORDEM 3.1 proxy', ordem) : null, cov > 0 ? rowFor('MASTER-8 proxy', master) : null, rowFor('MEM R2 proxy (meteoroids)', mem)));
        $('exposure-note').textContent = `Impacts = flux × ${A} m² × ${T} yr on a randomly tumbling surface (cross-sectional flux). The ORDEM and MASTER proxies are digitised from Horstmann et al. (2021) for 2016 populations, ±25% reading accuracy; they disagree by up to 100× near 1 mm, which is why both are shown. Tracked-object flux uses a mean relative speed of 1.16 × circular speed, a LEO value, and only counts time below 2,000 km. None of this replaces an ORDEM 3.2 or MASTER-8 run for a design.`;
    }

    /* ---------------------------------------------------------------- screening */
    function renderScreenHead() { $('scr-start').textContent = `from ${U.utc(new Date(st.simTime))}`; }
    function runScreen() {
        if (!st.mineSource) { status('Define your orbit first.', 'err'); return; }
        const exclude = st.mine && st.mine.satnum ? [+st.mine.satnum] : [];
        st.screenId = Math.random(); st.screenStart = st.simTime;
        $('scr-run').disabled = true; $('scr-prog').hidden = false; $('scr-prog').value = 0;
        worker.postMessage({ type: 'screen', id: st.screenId, source: st.mineSource, start: st.simTime, hours: +$('scr-hours').value, threshold: Math.max(0.5, +$('scr-km').value || 10), exclude });
    }
    function renderScreen(m) {
        $('scr-run').disabled = false; $('scr-prog').hidden = true;
        status(`Screen complete: ${m.events.length} approach${m.events.length === 1 ? '' : 'es'} within ${$('scr-km').value} km among ${m.candidates.toLocaleString()} candidates.${m.truncated ? ' Your orbit stopped propagating before the window ended.' : ''}`, 'ok');
        const tb = h('tbody');
        if (!m.events.length) tb.append(h('tr', {}, h('td', { colspan: 9, class: 'l', text: 'No catalog object comes within the threshold during this window.' })));
        m.events.forEach((ev, i) => {
            const r = st.cat.rows[ev.index];
            const btn = h('button', { type: 'button', class: 'link', text: r[st.F.name], onclick: () => { setPlaying(false); setTime(ev.tca); select(ev.index); focusOn(ev.index); } });
            tb.append(h('tr', {}, h('td', { text: String(i + 1) }), h('td', { class: 'l' }, btn, h('span', { class: 'units', text: `#${ev.norad} · ${KINDS[st.kind[ev.index]]}` })),
                h('td', { class: 'l', text: U.utc(new Date(ev.tca), true) }), h('td', { class: 'strong', text: ev.miss.toFixed(3) }),
                h('td', { text: ev.ric.r.toFixed(3) }), h('td', { text: ev.ric.i.toFixed(3) }), h('td', { text: ev.ric.c.toFixed(3) }), h('td', { text: ev.vrel.toFixed(3) }),
                h('td', { text: ((ev.tca - st.screenStart) / 3600e3).toFixed(2) })));
        });
        st.screenResult = m;
        $('scr-table').replaceChildren(h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { class: 'l', text: 'Object' }), h('th', { class: 'l', text: 'Time of closest approach' }),
            h('th', {}, 'Miss', h('span', { class: 'units', text: 'km' })), h('th', {}, 'Radial', h('span', { class: 'units', text: 'km' })), h('th', {}, 'In-track', h('span', { class: 'units', text: 'km' })),
            h('th', {}, 'Cross-track', h('span', { class: 'units', text: 'km' })), h('th', {}, 'Rel. speed', h('span', { class: 'units', text: 'km/s' })), h('th', {}, 'After start', h('span', { class: 'units', text: 'hours' })))), tb);
    }

    /* ---------------------------------------------------------------- user catalog files */
    function tleToRow(set) {
        const l1 = set.line1, l2 = set.line2, s = set.satrec;
        const exp = str => { str = str.trim(); if (!str) return 0; const m = str.match(/^([+-]?)(\d+)([+-]\d)$/); return m ? (m[1] === '-' ? -1 : 1) * +('0.' + m[2]) * 10 ** +m[3] : +str; };
        const yy = +l1.slice(18, 20), doy = +l1.slice(20, 32), yr = yy < 57 ? 2000 + yy : 1900 + yy;
        const epoch = new Date(Date.UTC(yr, 0, 1) + (doy - 1) * 86400e3);
        const id = l1.slice(9, 17).trim(), intl = id ? `${+id.slice(0, 2) < 57 ? 20 : 19}${id.slice(0, 2)}-${id.slice(2)}` : '';
        const name = set.name.replace(/^0 /, '');
        const kind = /\bDEB\b/.test(name) ? 2 : /R\/B/.test(name) ? 1 : 0;
        return [+s.satnum, name, intl, kind, '', '', '', '', null, epoch.toISOString().replace('Z', ''), +l2.slice(52, 63), +('0.' + l2.slice(26, 33).trim()), +l2.slice(8, 16), +l2.slice(17, 25), +l2.slice(34, 42), +l2.slice(43, 51), exp(l1.slice(53, 61)), +l1.slice(33, 43), exp(l1.slice(44, 52)), +l2.slice(63, 68) || 0];
    }
    async function loadFile() {
        const f = $('file').files[0]; $('file').value = ''; if (!f) return;
        status(`Reading ${f.name}…`, 'busy');
        const text = await f.text();
        const { sets, errors } = O.parseElements(text);
        if (!sets.length) { status(`No element sets read from ${f.name}. ${errors[0] || ''}`, 'err'); return; }
        const KT = { PAYLOAD: 0, 'ROCKET BODY': 1, DEBRIS: 2 };
        const rows = sets.map(s => s.omm ? [+s.omm.NORAD_CAT_ID, s.omm.OBJECT_NAME || '', s.omm.OBJECT_ID || '', KT[s.omm.OBJECT_TYPE] ?? (/\bDEB\b/.test(s.omm.OBJECT_NAME) ? 2 : /R\/B/.test(s.omm.OBJECT_NAME) ? 1 : 3), s.omm.COUNTRY_CODE || '', s.omm.LAUNCH_DATE || '', '', (s.omm.RCS_SIZE || '').slice(0, 1), null, String(s.omm.EPOCH).replace('Z', ''), +s.omm.MEAN_MOTION, +s.omm.ECCENTRICITY, +s.omm.INCLINATION, +s.omm.RA_OF_ASC_NODE, +s.omm.ARG_OF_PERICENTER, +s.omm.MEAN_ANOMALY, +s.omm.BSTAR || 0, +s.omm.MEAN_MOTION_DOT || 0, +s.omm.MEAN_MOTION_DDOT || 0, +s.omm.REV_AT_EPOCH || 0] : tleToRow(s));
        const cat = { metadata: { title: `${f.name} (loaded in your browser)`, attribution: 'User-supplied element file' }, kinds: st.snapshot.kinds, fields: st.snapshot.fields, rows };
        useCatalog(cat, false);
        setTime(medianEpoch().getTime());
        if (errors.length) status(`${rows.length.toLocaleString()} objects loaded; ${errors.length} records skipped.`, 'ok');
    }

    /* ---------------------------------------------------------------- export & method */
    function exportCSV(kind) {
        if (kind === 'density') { renderDensity(); P.download('debris-spatial-density.csv', st.densityCSV); return; }
        if (kind === 'gabbard') {
            const lines = ['norad,name,intl,type,period_min,perigee_km,apogee_km,inclination_deg,eccentricity'];
            for (let k = 0; k < st.n; k++) if (st.mask[k]) { const r = st.cat.rows[k]; lines.push([r[st.F.id], `"${String(r[st.F.name]).replace(/"/g, '""')}"`, r[st.F.intl], KINDS[st.kind[k]], st.period[k].toFixed(3), st.per[k].toFixed(1), st.apo[k].toFixed(1), st.inc[k].toFixed(4), st.ecc[k].toFixed(7)].join(',')); }
            P.download('debris-filtered-objects.csv', lines.join('\n'));
        }
    }
    function renderMethod() {
        if ($('method').dataset.done) return; $('method').dataset.done = '1';
        const m = (st.snapshot && st.snapshot.metadata) || {};
        $('method').innerHTML = `
<h3>Catalog</h3>
<p>${m.title || 'Public catalog'}: ${(m.count || 0).toLocaleString()} objects, retrieved ${m.retrievedAt ? m.retrievedAt.slice(0, 10) : '—'} with element epochs from ${m.epochRange && m.epochRange[0] ? m.epochRange[0].slice(0, 10) : '—'} to ${m.epochRange && m.epochRange[1] ? m.epochRange[1].slice(0, 10) : '—'}. ${m.coverage || ''}</p>
<p>${m.attribution || ''} The snapshot does not refresh itself. Use <em>Load TLE / OMM file</em> to view a current download; the file stays in your browser.</p>
<h3>Positions</h3>
<p>Every object is propagated with SGP4/SDP4 (satellite.js 6.0.1) from its mean elements in a background thread. Between those updates, the globe advances each object with a second-order two-body step so motion stays smooth at high time rates. Public elements are good to roughly 1 km at epoch, and errors grow by kilometres per day, faster for low, high-drag objects. Treat views more than a week from the catalog epoch as illustrative.</p>
<h3>Spatial density</h3>
<p>Each object's time-averaged radial distribution is computed exactly from its semi-major axis and eccentricity: the fraction of an orbit spent between radii r₁ and r₂ is ΔM/π, from Kepler's equation. Summing over the filtered set and dividing by shell volume gives objects per km³, the method behind NASA ODPO density plots. It ignores the latitude dependence that inclination introduces.</p>
<h3>Your orbit: exposure</h3>
<p>Tracked-object flux is the catalog density weighted by the time your orbit spends at each altitude, times a mean relative speed (1.16 × circular speed, from a 51.6° LEO direction ensemble), counted below 2,000 km only. Small-particle flux uses screening proxies for NASA ORDEM 3.1 and ESA MASTER-8 debris (200–1,500 km, 2016 populations) and NASA MEM R2 meteoroids, digitised by the skyhook project from Horstmann et al. (2021). Expected impacts assume a randomly tumbling surface of the given area (cross-sectional flux). Probabilities are Poisson, 1 − e⁻ᴺ.</p>
<h3>Close approaches</h3>
<p>The screen keeps catalog objects whose perigee–apogee band overlaps yours, padded by the threshold plus 25 km. It propagates them and your orbit at 120 s SGP4 nodes and interpolates each with cubic Hermite polynomials. It searches every interval at 10 s sub-steps and refines each candidate with exact SGP4 by golden-section search. Each result gives the miss distance and its radial, in-track and cross-track components in your orbit's frame. This is a screening aid. It has no covariance, so it gives no collision probability.</p>
<h3>References</h3>
<ul>
<li>Horstmann, A. et al. (2021). <em>Flux comparison of MASTER-8 and ORDEM 3.1 modelled space debris population.</em> 8th European Conference on Space Debris. <a href="https://ntrs.nasa.gov/citations/20210011563">NTRS 20210011563</a>.</li>
<li>Vallado, D. A., Crawford, P., Hujsak, R. &amp; Kelso, T. S. (2006). <em>Revisiting Spacetrack Report #3.</em> AIAA 2006-6753.</li>
<li>Gabbard, J. R. (1981). <em>The explosion of satellite 10704 and other delta second stage rockets.</em> NORAD technical memorandum 81-5.</li>
<li>Kessler, D. J. (1981). <em>Derivation of the collision probability between orbiting objects.</em> Icarus 48, 39–48.</li>
<li>NASA Orbital Debris Program Office, <a href="https://orbitaldebris.jsc.nasa.gov/">orbitaldebris.jsc.nasa.gov</a>.</li>
</ul>`;
    }

    boot();
})();
