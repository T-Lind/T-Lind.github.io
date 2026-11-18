/* Van Allen Belt Radiation tool: page controller. Heavy work runs in worker.js. */
(function () {
    'use strict';
    const O = window.SpaceOrbit, U = window.SpaceUI, P = window.SpacePlotUtil, h = U.h;
    const $ = id => document.getElementById(id);
    const COLORS = ['#e8e8ec', '#7fb8ff', '#ffb347', '#8fd694', '#ff7a7a', '#c59bff'];
    const MAX_CASES = 6;
    const DATA = '../space/data/';
    const fmt = (v, d = 3) => P.fmt(v, d);

    const state = {
        cases: [], sel: null, results: {}, running: false, runId: 0, ready: false, dirty: false,
        settings: { start: null, dur: 1, unit: 31557600, solar: 'max', field: '1970', geometry: 'sphere', refMm: 2.54, rdm: 2, ef: 'practical', eThr: 1, pThr: 10, samples: 60000, windowS: 86400 }
    };
    let worker, energies, land, fieldMeta, fieldLoaded = { 1970: false, 2025: false }, nextKey = 1;
    let editor;

    /* ---------------------------------------------------------- status */
    function status(text, kind = '') { $('status').textContent = text; $('dot').className = 'dot ' + kind; }
    function progress(v) { const p = $('progress'); if (v == null) { p.hidden = true; return; } p.hidden = false; p.value = v; }

    /* ---------------------------------------------------------- loading */
    async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
    async function fetchBin(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.arrayBuffer(); }

    async function boot() {
        status('Loading AE8/AP8 tables, IGRF grid and NIST data…', 'busy');
        try {
            const [ae8ap8, meta, f1970, nist, coast] = await Promise.all([
                fetchJSON(DATA + 'ae8ap8.json'), fetchJSON(DATA + 'field.json'), fetchBin(DATA + 'field-1970.bin'), fetchJSON(DATA + 'nist.json'), fetchJSON(DATA + 'land-110m.json')]);
            energies = ae8ap8.energies; fieldMeta = meta; land = coast;
            worker = new Worker('worker.js');
            worker.onmessage = onWorker;
            worker.onerror = e => status('Worker error: ' + e.message, 'err');
            worker.postMessage({ type: 'init', ae8ap8, fieldMeta: meta, fields: { 1970: f1970 }, nist }, [f1970]);
            fieldLoaded[1970] = true;
        } catch (err) { status('Could not load model data: ' + err.message, 'err'); return; }
        const showTab = setupControls();
        restore(showTab);
        renderMethod();
    }

    /* ---------------------------------------------------------- cases */
    function defaultStart() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; }
    function freeColor() { const used = new Set(state.cases.map(c => c.color)); return COLORS.find(c => !used.has(c)) || COLORS[state.cases.length % COLORS.length]; }
    function addCase(source, select = true) {
        if (state.cases.length >= MAX_CASES) { status(`Up to ${MAX_CASES} cases can be compared at once.`, 'err'); return null; }
        const c = { key: 'c' + nextKey++, color: freeColor(), source };
        state.cases.push(c);
        if (select) selectCase(c.key);
        renderCases(); schedule();
        return c;
    }
    function caseElements(c) { try { return O.elementsOf(O.satrecFromSource(c.source)); } catch (err) { return null; } }
    function renderCases() {
        const ul = $('cases'); ul.replaceChildren();
        for (const c of state.cases) {
            const el = caseElements(c);
            const li = h('li', { class: 'case', 'aria-current': String(c.key === state.sel), tabindex: 0, 'data-key': c.key },
                h('span', { class: 'sw', style: `background:${c.color}` }),
                h('span', {}, h('span', { class: 'nm', text: c.source.name || 'Orbit' }), h('span', { class: 'sub', text: el ? U.summary(el) : 'invalid elements' })),
                h('span', { class: 'acts' },
                    h('button', { type: 'button', title: 'Remove case', 'aria-label': `Remove ${c.source.name}`, text: '×', onclick: e => { e.stopPropagation(); removeCase(c.key); } })));
            li.addEventListener('click', () => selectCase(c.key));
            li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCase(c.key); } });
            ul.append(li);
        }
        $('case-count').textContent = `${state.cases.length} / ${MAX_CASES}`;
        $('add-case').disabled = $('dup-case').disabled = state.cases.length >= MAX_CASES;
        for (const id of ['dose-case', 'map-case']) {
            const s = $(id), cur = s.value;
            s.replaceChildren(...state.cases.map(c => h('option', { value: c.key, text: c.source.name })));
            s.value = state.cases.some(c => c.key === cur) ? cur : (state.sel || '');
        }
    }
    function selectCase(key) {
        state.sel = key;
        const c = state.cases.find(x => x.key === key);
        if (c) { editor.setSource(c.source); $('edit-name').textContent = c.source.name; }
        updateDebrisLink();
        for (const li of $('cases').children) li.setAttribute('aria-current', String(li.dataset.key === key));
        $('dose-case').value = key; $('map-case').value = key;
        if (Object.keys(state.results).length) { renderDose(); renderMap(); }
    }
    function removeCase(key) {
        if (state.cases.length <= 1) { status('Keep at least one case.', 'err'); return; }
        state.cases = state.cases.filter(c => c.key !== key); delete state.results[key];
        if (state.sel === key) selectCase(state.cases[0].key);
        renderCases(); renderAll(); saveHash();
    }

    /* ---------------------------------------------------------- controls */
    function setupControls() {
        editor = new U.OrbitEditor($('editor'), {
            idPrefix: 'va', epoch: () => new Date(state.settings.start),
            onChange: src => {
                const c = state.cases.find(x => x.key === state.sel); if (!c) return;
                c.source = src; $('edit-name').textContent = src.name; renderCases(); updateDebrisLink(); schedule();
            },
            onMany: sets => {
                for (const s of sets) if (state.cases.length < MAX_CASES) addCase(s.omm ? { kind: 'omm', name: s.name, omm: s.omm } : { kind: 'tle', name: s.name, line1: s.line1, line2: s.line2 }, false);
                renderCases();
            }
        });
        const eSel = $('e-thr'), pSel = $('p-thr'), bSel = $('belt-e');
        for (const E of energies.e) eSel.append(h('option', { value: E, text: E }));
        for (const E of energies.p) pSel.append(h('option', { value: E, text: E }));
        $('add-case').onclick = () => addCase(U.presetSource('hst', new Date(state.settings.start)));
        $('dup-case').onclick = () => { const c = state.cases.find(x => x.key === state.sel); if (c) addCase(JSON.parse(JSON.stringify({ ...c.source, name: c.source.name + ' (copy)', preset: undefined }))); };
        $('start-now').onclick = () => { const d = new Date(); d.setUTCSeconds(0, 0); $('start').value = U.toLocalInput(d); readSettings(); };
        $('start-epoch').onclick = () => { const c = state.cases.find(x => x.key === state.sel); const el = c && caseElements(c); if (el) { $('start').value = U.toLocalInput(el.epoch); readSettings(); } };
        for (const b of $('solar').querySelectorAll('button')) b.onclick = () => { for (const o of $('solar').children) o.setAttribute('aria-pressed', String(o === b)); readSettings(); };
        for (const id of ['start', 'dur', 'dur-unit', 'field', 'geometry', 'ref-mm', 'rdm', 'ef', 'e-thr', 'p-thr', 'samples', 'window']) $(id).addEventListener('change', readSettings);
        $('run').onclick = () => run();
        $('dose-case').onchange = renderDose; $('dose-unit').onchange = renderDose; $('dose-margin').onchange = renderDose;
        $('map-case').onchange = () => { $('map-h').value = Math.round(meanAlt($('map-case').value)); renderMap(true); };
        $('map-part').onchange = () => renderMap(true); $('map-h').onchange = () => renderMap(true);
        $('map-h-case').onclick = () => { $('map-h').value = Math.round(meanAlt($('map-case').value)); renderMap(true); };
        const fillBelt = () => { const part = $('belt-part').value; bSel.replaceChildren(...energies[part].map(E => h('option', { value: E, text: E }))); bSel.value = part === 'e' ? '1' : '10'; };
        $('belt-part').onchange = () => { fillBelt(); renderBelt(true); }; bSel.onchange = () => renderBelt(true); $('belt-r').onchange = () => renderBelt(true);
        fillBelt();
        $('share').onclick = async () => { saveHash(); const ok = await U.copyText(location.href); status(ok ? 'Link copied. It reproduces these cases and settings.' : 'Copy the address bar to share this analysis.', 'ok'); };
        $('export-summary').onclick = () => P.download('van-allen-summary.csv', summaryCSV());
        document.querySelectorAll('[data-csv]').forEach(b => b.onclick = () => exportCSV(b.dataset.csv));
        const showTab = U.tabs($('tabs'), name => { state.tab = name; requestAnimationFrame(() => { drawTab(name); }); });
        bindMapHover(); bindBeltHover();
        window.addEventListener('resize', U.debounce(() => drawTab(state.tab || 'spectra'), 150));
        return showTab;
    }
    function readSettings() {
        const s = state.settings;
        const d = U.fromLocalInput($('start').value); if (d) s.start = d.toISOString();
        s.dur = Math.max(0.001, +$('dur').value || 1); s.unit = +$('dur-unit').value;
        if (s.dur * s.unit > 30 * 31557600) { s.dur = 30 * 31557600 / s.unit; $('dur').value = +s.dur.toFixed(3); }
        s.solar = $('solar').querySelector('[aria-pressed=true]').dataset.v; s.field = $('field').value;
        s.geometry = $('geometry').value; s.refMm = Math.max(0.01, +$('ref-mm').value || 2.54); s.rdm = Math.max(1, +$('rdm').value || 1);
        s.ef = $('ef').value; s.eThr = +$('e-thr').value; s.pThr = +$('p-thr').value; s.samples = +$('samples').value; s.windowS = +$('window').value;
        $('badge-field').textContent = 'IGRF ' + s.field; $('badge-solar').textContent = s.solar.toUpperCase();
        updateDebrisLink();
        schedule();
    }
    function writeSettings() {
        const s = state.settings;
        $('start').value = U.toLocalInput(new Date(s.start)); $('dur').value = s.dur; $('dur-unit').value = String(s.unit);
        for (const o of $('solar').children) o.setAttribute('aria-pressed', String(o.dataset.v === s.solar));
        $('field').value = s.field; $('geometry').value = s.geometry; $('ref-mm').value = s.refMm; $('rdm').value = s.rdm; $('ef').value = String(s.ef);
        $('e-thr').value = String(s.eThr); $('p-thr').value = String(s.pThr); $('samples').value = String(s.samples); $('window').value = String(s.windowS);
        $('badge-field').textContent = 'IGRF ' + s.field; $('badge-solar').textContent = s.solar.toUpperCase();
    }
    const schedule = U.debounce(() => { saveHash(); if ($('auto').checked && state.ready) run(); else if (state.ready) status('Inputs changed. Press Run analysis to update.', ''); }, 450);

    /* ---------------------------------------------------------- share link */
    function updateDebrisLink() {
        const source = state.cases.find(c => c.key === state.sel)?.source;
        const link = $('open-debris');
        link.hidden = !source;
        if (source) link.href = U.orbitLink('../debris/', source, state.settings.start);
    }
    function saveHash() {
        const doc = { v: 1, s: state.settings, c: state.cases.map(c => c.source) };
        history.replaceState(null, '', '#a=' + U.encodeLink(doc));
    }
    function restore(showTab) {
        const linked = U.readOrbitLink(location.hash);
        const doc = linked ? { s: { start: new Date(linked.time).toISOString() }, c: [linked.source] }
            : U.decodeLink(new URLSearchParams(location.hash.slice(1)).get('a'));
        if (doc && Array.isArray(doc.c) && doc.c.length) {
            Object.assign(state.settings, doc.s || {});
            if (!state.settings.start) state.settings.start = defaultStart().toISOString();
            if (!['practical', 'csda', 'detour'].includes(state.settings.ef)) state.settings.ef = 'practical';
            writeSettings();
            for (const src of doc.c.slice(0, MAX_CASES)) { try { O.satrecFromSource(src); addCase(src, false); } catch (err) { /* skip invalid */ } }
        }
        if (!state.cases.length) {
            state.settings.start = defaultStart().toISOString(); writeSettings();
            const ep = new Date(state.settings.start);
            for (const id of ['iss', 'gto', 'gps']) addCase(U.presetSource(id, ep), false);
        }
        selectCase(state.cases[0].key);
        renderCases();
        $('map-h').value = Math.round(meanAlt(state.cases[0].key));
        if (linked) showTab('belts');
        state.ready = true;
        run();
    }

    /* ---------------------------------------------------------- run */
    async function ensureField(year) {
        if (fieldLoaded[year]) return;
        status(`Loading IGRF ${year} field grid…`, 'busy');
        const buf = await fetchBin(DATA + `field-${year}.bin`);
        await new Promise(res => { const prev = worker.onmessage; worker.onmessage = e => { if (e.data.type === 'field-ready') { worker.onmessage = prev; res(); } else prev(e); }; worker.postMessage({ type: 'field', year: +year, fieldMeta, buffer: buf }, [buf]); });
        fieldLoaded[year] = true;
    }
    async function run() {
        if (!worker || !state.cases.length) return;
        try { await ensureField(state.settings.field); } catch (err) { status('Could not load the field grid: ' + err.message, 'err'); return; }
        const s = state.settings;
        const id = ++state.runId;
        state.running = true; state.pending = new Set(state.cases.map(c => c.key)); state.partial = {};
        status(`Propagating ${state.cases.length} case${state.cases.length > 1 ? 's' : ''} through AE8/AP8…`, 'busy'); progress(0);
        $('run').disabled = true;
        worker.postMessage({
            type: 'run', id,
            settings: { start: s.start, durationS: s.dur * s.unit, solar: s.solar, field: s.field, eThr: s.eThr, pThr: s.pThr, samples: s.samples, windowS: s.windowS, geometry: s.geometry, ef: s.ef, refMm: s.refMm, eLevel: 1e3, pLevel: 1 },
            cases: state.cases.map(c => ({ key: c.key, source: c.source }))
        });
        state.t0 = performance.now();
    }
    function onWorker(e) {
        const m = e.data;
        if (m.type === 'ready') { status('Models loaded.', 'ok'); return; }
        if (m.type === 'error') { status('Calculation error: ' + m.error, 'err'); $('run').disabled = false; progress(null); return; }
        if (m.type === 'progress' && m.id === state.runId) {
            const done = state.cases.length - state.pending.size;
            progress((done + m.frac) / state.cases.length); return;
        }
        if (m.type === 'case' && m.id === state.runId) {
            state.pending.delete(m.key);
            state.partial[m.key] = m.error ? { error: m.error } : m.result;
            return;
        }
        if (m.type === 'done' && m.id === state.runId) {
            state.results = state.partial; state.running = false; $('run').disabled = false; progress(null);
            const secs = ((performance.now() - state.t0) / 1000).toFixed(1);
            const n = Object.values(state.results).reduce((a, r) => a + (r.N || 0), 0);
            status(`Computed ${state.cases.length} case${state.cases.length > 1 ? 's' : ''} · ${n.toLocaleString()} orbit samples · ${secs} s`, 'ok');
            $('stamp').textContent = `AE8/AP8 ${state.settings.solar.toUpperCase()} · IGRF ${state.settings.field} · ${U.utc(new Date(state.settings.start))} + ${durText()}`;
            renderAll();
            return;
        }
        if (m.type === 'map' && m.id === state.mapReq) { state.mapGrid = m; drawMap(); return; }
        if (m.type === 'belt' && m.id === state.beltReq) { state.beltImg = m; drawBelt(); return; }
    }
    function durText() { const s = state.settings; const units = { 3600: 'h', 86400: 'd', 31557600: 'yr' }; return `${+s.dur.toFixed(3)} ${units[s.unit] || 's'}`; }
    const ok = () => state.cases.filter(c => state.results[c.key] && !state.results[c.key].error);

    /* ---------------------------------------------------------- rendering */
    const plots = {};
    function plot(id, opt) { if (!plots[id]) plots[id] = new window.SpacePlot($(id), opt); return plots[id]; }
    function renderAll() {
        renderSummary(); renderSpectra(); renderFluence(); renderDose(); renderHistory(); renderL();
        state.mapGrid = null; state.beltImg = null;
        if (state.tab === 'map') renderMap(true); if (state.tab === 'belts') renderBelt(true);
    }
    function drawTab(name) {
        if (name === 'map') renderMap(); else if (name === 'belts') renderBelt();
        else for (const p of Object.values(plots)) p.draw();
    }

    function doseUnit(rad) {
        const u = $('dose-unit').value;
        return u === 'krad' ? rad / 1000 : u === 'Gy' ? rad / 100 : rad;
    }
    function renderSummary() {
        const s = state.settings, thead = $('summary').tHead, tb = $('summary').tBodies[0];
        thead.replaceChildren(h('tr', {},
            h('th', {}, 'Case'), h('th', { class: 'l' }, 'Orbit', h('span', { class: 'units', text: 'perigee × apogee km · incl. · period' })), h('th', {}, 'Max L'),
            h('th', {}, `e⁻ > ${s.eThr} MeV`, h('span', { class: 'units', text: 'avg cm⁻² s⁻¹' })), h('th', {}, `p⁺ > ${s.pThr} MeV`, h('span', { class: 'units', text: 'avg cm⁻² s⁻¹' })),
            h('th', {}, `Peak p⁺ > ${s.pThr}`, h('span', { class: 'units', text: 'cm⁻² s⁻¹' })), h('th', {}, 'Belt passes', h('span', { class: 'units', text: 'per day · min/day' })),
            h('th', {}, 'Fluence e⁻', h('span', { class: 'units', text: 'cm⁻² mission' })), h('th', {}, 'Fluence p⁺', h('span', { class: 'units', text: 'cm⁻² mission' })),
            h('th', {}, `TID @ ${s.refMm} mm Al`, h('span', { class: 'units', text: 'krad(Si) mission' })), h('th', {}, `× RDM ${s.rdm}`, h('span', { class: 'units', text: 'krad(Si)' }))));
        tb.replaceChildren();
        const warn = $('warnings'); warn.replaceChildren();
        for (const c of state.cases) {
            const r = state.results[c.key];
            const name = h('td', { class: 'l strong' }, h('span', { class: 'sw', style: `background:${c.color}` }), c.source.name);
            if (!r) { tb.append(h('tr', {}, name, h('td', { colspan: 10, class: 'l', text: 'Not computed yet' }))); continue; }
            if (r.error) { tb.append(h('tr', {}, name, h('td', { colspan: 10, class: 'l bad-text', text: r.error }))); continue; }
            const el = r.elements, eAvg = r.fluence.e / r.durationS, pAvg = r.fluence.p / r.durationS;
            const tr = h('tr', { class: c.key === state.sel ? 'sel' : '' }, name,
                h('td', { class: 'l', text: `${Math.round(el.perigee).toLocaleString()} × ${Math.round(el.apogee).toLocaleString()} · ${el.inc.toFixed(1)}° · ${el.period.toFixed(1)} min` }),
                h('td', { text: r.Lmax ? (r.Lmax >= 12.8 ? '> 12' : r.Lmax.toFixed(2)) : '—' }), h('td', { text: fmt(eAvg) }), h('td', { text: fmt(pAvg) }), h('td', { text: fmt(r.peak.p) }),
                h('td', { text: `${r.passes.perDay.toFixed(1)} · ${r.passes.minutesPerDay.toFixed(0)}` }), h('td', { text: fmt(r.fluence.e) }), h('td', { text: fmt(r.fluence.p) }),
                h('td', { class: 'strong', text: fmt(r.refDose.total / 1000) }), h('td', { class: 'strong', text: fmt(r.refDose.total / 1000 * s.rdm) }));
            tr.addEventListener('click', () => selectCase(c.key));
            tb.append(tr);
            for (const w of r.warnings) warn.append(h('div', { class: 'callout', text: `${c.source.name}: ${w}` }));
        }
        warn.hidden = !warn.children.length;
    }

    function renderSpectra() {
        const se = plot('plot-se', { x: { type: 'log', label: 'Energy threshold E (MeV)', short: 'E', format: v => fmt(v, 3) + ' MeV' }, y: { type: 'log', label: 'Integral flux > E (cm⁻² s⁻¹)', floorDecades: 9 } });
        const sp = plot('plot-sp', { x: { type: 'log', label: 'Energy threshold E (MeV)', short: 'E', format: v => fmt(v, 3) + ' MeV' }, y: { type: 'log', label: 'Integral flux > E (cm⁻² s⁻¹)', floorDecades: 9 } });
        se.set(ok().map(c => ({ name: c.source.name, color: c.color, data: state.results[c.key].spectra.e.E.map((E, i) => [E, state.results[c.key].spectra.e.J[i]]), points: true })), [{ x: state.settings.eThr, label: 'threshold' }]);
        sp.set(ok().map(c => ({ name: c.source.name, color: c.color, data: state.results[c.key].spectra.p.E.map((E, i) => [E, state.results[c.key].spectra.p.J[i]]), points: true })), [{ x: state.settings.pThr, label: 'threshold' }]);
    }

    function renderFluence() {
        const s = state.settings, days = s.dur * s.unit / 86400, inHours = days < 3;
        const xs = inHours ? 24 : 1, xl = inHours ? 'Mission elapsed time (hours)' : 'Mission elapsed time (days)';
        const mk = (id, part) => {
            const p = plot(id, { x: { type: 'lin', label: xl, short: 't' }, y: { type: 'log', label: 'Cumulative fluence (cm⁻²)', floorDecades: 8 } });
            p.setAxes({ label: xl });
            p.set(ok().map(c => { const r = state.results[c.key]; return { name: c.source.name, color: c.color, data: r.cum.t.map((t, i) => [t * xs, r.cum[part][i]]) }; }));
        };
        mk('plot-fe', 'e'); mk('plot-fp', 'p');
        $('fl-e-sub').textContent = `E > ${s.eThr} MeV`; $('fl-p-sub').textContent = `E > ${s.pThr} MeV`;
    }

    function renderDose() {
        const cs = ok(); if (!cs.length) return;
        const s = state.settings, margin = $('dose-margin').checked ? s.rdm : 1;
        const unit = $('dose-unit').value, ul = unit === 'krad' ? 'krad(Si)' : unit === 'Gy' ? 'Gy(Si)' : 'rad(Si)';
        const p = plot('plot-dose', { x: { type: 'log', label: 'Aluminium shield thickness (mm)', short: 't', format: v => fmt(v, 3) + ' mm' }, y: { type: 'log', label: 'Mission dose', floorDecades: 8 } });
        p.setAxes(null, { label: `Mission total ionizing dose (${ul})` });
        const key = $('dose-case').value || cs[0].key, sel = cs.find(c => c.key === key) || cs[0], r0 = state.results[sel.key];
        const series = cs.map(c => { const r = state.results[c.key]; return { name: c.source.name + ' · total', color: c.color, width: 2, data: r.dose.mm.map((mm, i) => [mm, doseUnit(r.dose.total[i]) * margin]) }; });
        series.push(
            { name: `${sel.source.name} · electron transport range`, color: '#7fb8ff', kind: 'band', alpha: 0.14, data: r0.dose.mm.map((mm, i) => [mm, Math.max(1e-30, doseUnit(r0.dose.eLo[i]) * margin), doseUnit(r0.dose.eHi[i]) * margin]) },
            { name: `${sel.source.name} · electrons`, color: '#7fb8ff', dash: [6, 4], width: 1.3, data: r0.dose.mm.map((mm, i) => [mm, doseUnit(r0.dose.e[i]) * margin]) },
            { name: `${sel.source.name} · protons`, color: '#ffb347', dash: [2, 3], width: 1.3, data: r0.dose.mm.map((mm, i) => [mm, doseUnit(r0.dose.p[i]) * margin]) },
            { name: `${sel.source.name} · bremsstrahlung (approx.)`, color: '#9a9aa3', dash: [8, 3, 2, 3], width: 1.3, data: r0.dose.mm.map((mm, i) => [mm, doseUnit(r0.dose.b[i]) * margin]) });
        p.set(series, [{ x: s.refMm, label: `${s.refMm} mm reference` }]);
        $('dose-sub').textContent = `${s.geometry === 'sphere' ? 'solid sphere' : 'semi-infinite slab'} · ${durText()}${margin > 1 ? ` · ×${margin} margin` : ''}`;
        const t = r0.table, tbl = $('dose-table');
        tbl.replaceChildren(
            h('thead', {}, h('tr', {}, h('th', {}, `${sel.source.name}`), ...t.mm.map(mm => h('th', {}, `${mm} mm`, h('span', { class: 'units', text: `${(mm / 0.0254).toFixed(0)} mil · ${(mm * 0.2699).toFixed(2)} g/cm²` }))))),
            h('tbody', {}, ...[['Electrons', t.e], ['Protons', t.p], ['Bremsstrahlung', t.b], ['Total', t.total]].map(([lab, arr]) =>
                h('tr', {}, h('td', { class: 'l' + (lab === 'Total' ? ' strong' : ''), text: `${lab} (${ul})` }), ...arr.map(v => h('td', { class: lab === 'Total' ? 'strong' : '', text: fmt(doseUnit(v) * margin) }))))));
    }

    function renderHistory() {
        const s = state.settings, cs = ok();
        const p = plot('plot-hist', { x: { type: 'lin', label: 'Time from mission start (hours)', short: 't', format: v => v.toFixed(2) + ' h' }, y: { type: 'log', label: 'Integral flux (cm⁻² s⁻¹)', floorDecades: 7 } });
        const series = [];
        for (const c of cs) {
            const H = state.results[c.key].hist;
            series.push({ name: `${c.source.name} p⁺>${s.pThr}`, color: c.color, data: Array.from(H.t, (t, i) => [t / 3600, H.fp[i]]), label: q => `${fmt(q[1])} cm⁻²s⁻¹` });
            series.push({ name: `${c.source.name} e⁻>${s.eThr}`, color: c.color, dash: [4, 3], width: 1.1, data: Array.from(H.t, (t, i) => [t / 3600, H.fe[i]]) });
        }
        p.set(series);
        $('hist-sub').textContent = `solid p⁺ > ${s.pThr} MeV · dashed e⁻ > ${s.eThr} MeV`;
        const q = plot('plot-hl', { x: { type: 'lin', label: 'Time from mission start (hours)', short: 't', format: v => v.toFixed(2) + ' h' }, y: { type: 'lin', label: 'McIlwain L', zero: false } });
        q.set(cs.map(c => { const H = state.results[c.key].hist; return { name: c.source.name, color: c.color, data: Array.from(H.t, (t, i) => [t / 3600, Math.min(H.L[i], 15), H.h[i]]), label: v => `L ${v[1].toFixed(2)} · ${Math.round(v[2]).toLocaleString()} km` }; }), [], 'L capped at 15');
    }

    function renderL() {
        const p = plot('plot-L', { x: { type: 'lin', label: 'McIlwain L', short: 'L', format: v => v.toFixed(1) }, y: { type: 'lin', label: 'Fraction of mission time (%)' } });
        p.set(ok().map(c => { const r = state.results[c.key], H = r.Lhist; return { name: c.source.name, color: c.color, kind: 'step', width: 1.6, data: H.frac.map((f, i) => [H.lo + i * H.step, 100 * f]).concat([[H.lo + H.frac.length * H.step, 0]]) }; }),
            [{ x0: 1.2, x1: 2.5, label: 'inner zone', color: '#ffb347' }, { x0: 3, x1: 7, label: 'outer zone', color: '#7fb8ff' }]);
    }

    /* ---------------------------------------------------------- map */
    function meanAlt(key) { const c = state.cases.find(x => x.key === key); const el = c && caseElements(c); return el ? Math.min(60000, Math.max(100, (el.perigee + el.apogee) / 2)) : 500; }
    function renderMap(force) {
        if (state.tab !== 'map') return;
        const part = $('map-part').value, s = state.settings;
        const req = { key: `${part}_${s.solar}`, E: part === 'e' ? s.eThr : s.pThr, h: Math.min(60000, Math.max(100, +$('map-h').value || 500)), field: s.field };
        const sig = JSON.stringify(req);
        if (force || !state.mapGrid || state.mapSig !== sig) { state.mapSig = sig; state.mapReq = Math.random(); worker.postMessage({ type: 'map', id: state.mapReq, ...req }); }
        drawMap();
    }
    function canvasSize(cv) {
        const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hh = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
        const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [ctx, w, hh];
    }
    function logScale(data) {
        let mx = 0; for (const v of data) if (v > mx) mx = v;
        const hi = mx > 0 ? Math.log10(mx) : 0, lo = hi - 4;
        return { lo, hi, t: v => (v > 0 ? (Math.log10(v) - lo) / (hi - lo) : -1) };
    }
    function scaleBar(el, sc, label) {
        el.replaceChildren();
        const cv = h('canvas', { width: 180, height: 10 }); const ctx = cv.getContext('2d');
        for (let i = 0; i < 180; i++) { const [r, g, b] = P.cmap(i / 179); ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(i, 0, 1, 10); }
        el.append(h('span', { text: `10${P.sup(Math.round(sc.lo))}` }), cv, h('span', { text: `10${P.sup(Math.round(sc.hi))} ${label}` }));
    }
    function drawCoast(ctx, X, Y) {
        ctx.strokeStyle = 'rgba(235,235,240,.55)'; ctx.lineWidth = 0.8; ctx.beginPath();
        for (const ring of land.rings) {
            let plon = null;
            for (let i = 0; i < ring.length; i += 2) {
                const lon = ring[i] / 20, lat = ring[i + 1] / 20;
                if (plon === null || Math.abs(lon - plon) > 180) ctx.moveTo(X(lon), Y(lat)); else ctx.lineTo(X(lon), Y(lat));
                plon = lon;
            }
        }
        ctx.stroke();
    }
    function drawMap() {
        const cv = $('map'); if (!cv.offsetParent) return;
        const [ctx, w, hh] = canvasSize(cv);
        const X = lon => (lon + 180) / 360 * w, Y = lat => (90 - lat) / 180 * hh;
        ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, w, hh);
        const g = state.mapGrid;
        if (g) {
            const sc = logScale(g.data);
            const img = new ImageData(g.nx, g.ny);
            for (let k = 0; k < g.data.length; k++) {
                const t = sc.t(g.data[k]);
                if (t < 0) { img.data[4 * k + 3] = 0; continue; }
                const [r, gg, b] = P.cmap(Math.max(0, t) * 0.92 + 0.08);
                img.data[4 * k] = r; img.data[4 * k + 1] = gg; img.data[4 * k + 2] = b; img.data[4 * k + 3] = t <= 0 ? 0 : 235;
            }
            const off = h('canvas', { width: g.nx, height: g.ny }); off.getContext('2d').putImageData(img, 0, 0);
            ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, w, hh);
            const part = $('map-part').value;
            scaleBar($('map-scale'), sc, `${part === 'e' ? 'e⁻' : 'p⁺'} > ${part === 'e' ? state.settings.eThr : state.settings.pThr} MeV cm⁻² s⁻¹`);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let lon = -150; lon <= 150; lon += 30) { ctx.moveTo(X(lon) + .5, 0); ctx.lineTo(X(lon) + .5, hh); }
        for (let lat = -60; lat <= 60; lat += 30) { ctx.moveTo(0, Y(lat) + .5); ctx.lineTo(w, Y(lat) + .5); }
        ctx.stroke();
        drawCoast(ctx, X, Y);
        ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '10px ui-monospace, monospace';
        for (let lon = -150; lon <= 150; lon += 30) ctx.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`, X(lon) + 3, hh - 4);
        for (let lat = -60; lat <= 60; lat += 30) ctx.fillText(`${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`, 3, Y(lat) - 3);
        // ground track
        const key = $('map-case').value, c = state.cases.find(x => x.key === key), r = state.results[key];
        const kv = $('map-kv'); kv.replaceChildren();
        if (!r || r.error) return;
        const H = r.hist, part = $('map-part').value, f = part === 'e' ? H.fe : H.fp;
        ctx.lineWidth = 1.2; ctx.strokeStyle = c.color; ctx.globalAlpha = 0.5; ctx.beginPath();
        for (let i = 0; i < H.t.length; i++) { if (i && Math.abs(H.lon[i] - H.lon[i - 1]) > 180) ctx.moveTo(X(H.lon[i]), Y(H.lat[i])); else if (i) ctx.lineTo(X(H.lon[i]), Y(H.lat[i])); else ctx.moveTo(X(H.lon[i]), Y(H.lat[i])); }
        ctx.stroke(); ctx.globalAlpha = 1;
        const sc = logScale(f);
        for (let i = 0; i < H.t.length; i++) {
            const t = sc.t(f[i]); if (t < 0) continue;
            const [rr, gg, bb] = P.cmap(Math.max(0, t) * 0.85 + 0.15); ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
            ctx.beginPath(); ctx.arc(X(H.lon[i]), Y(H.lat[i]), 2.2, 0, 7); ctx.fill();
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(H.lon[0]), Y(H.lat[0]), 3.5, 0, 7); ctx.fill();
        const s = state.settings;
        const add = (k, v) => kv.append(h('dt', { text: k }), h('dd', { text: v }));
        add('Track shown', `${(r.passes.windowS / 3600).toFixed(1)} h from ${U.utc(new Date(s.start))} (white dot = start)`);
        add('Belt passes (p⁺ > ' + s.pThr + ' MeV > 1 cm⁻² s⁻¹)', `${r.passes.count} in window · ${r.passes.perDay.toFixed(1)} per day · ${r.passes.minutesPerDay.toFixed(0)} min per day`);
        add(`Peak flux on track`, `${fmt(Math.max(...f))} cm⁻² s⁻¹ (${part === 'e' ? 'e⁻ > ' + s.eThr : 'p⁺ > ' + s.pThr} MeV)`);
        add('Background', `${part === 'e' ? 'AE8' : 'AP8'}${s.solar.toUpperCase()} at ${(+$('map-h').value).toLocaleString()} km, IGRF ${s.field}; track dots coloured on their own log scale`);
    }
    function bindMapHover() {
        const cv = $('map'), tip = $('map-tip');
        cv.addEventListener('pointermove', e => {
            const g = state.mapGrid; if (!g) return;
            const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
            const lon = x / r.width * 360 - 180, lat = 90 - y / r.height * 180;
            const i = Math.min(g.nx - 1, Math.max(0, Math.round((lon + 179) / 2))), j = Math.min(g.ny - 1, Math.max(0, Math.round((89 - lat) / 2)));
            tip.hidden = false;
            tip.textContent = `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'} · flux ${fmt(g.data[j * g.nx + i])} cm⁻² s⁻¹`;
            tip.style.left = Math.min(x + 26, r.width - tip.offsetWidth) + 'px'; tip.style.top = (y + 8) + 'px';
        });
        cv.addEventListener('pointerleave', () => { tip.hidden = true; });
    }

    /* ---------------------------------------------------------- belt cross-section */
    function renderBelt(force) {
        if (state.tab !== 'belts') return;
        const part = $('belt-part').value, rmax = +$('belt-r').value;
        const req = { key: `${part}_${state.settings.solar}`, E: +$('belt-e').value, rmax, nx: 300, nz: 420, zfrac: 0.7 };
        const sig = JSON.stringify(req);
        if (force || !state.beltImg || state.beltSig !== sig) { state.beltSig = sig; state.beltReq = Math.random(); state.beltMeta = req; worker.postMessage({ type: 'belt', id: state.beltReq, ...req }); }
        drawBelt();
    }
    function drawBelt() {
        const cv = $('belt'); if (!cv.offsetParent) return;
        const [ctx, w, hh] = canvasSize(cv);
        ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, w, hh);
        const b = state.beltImg, meta = state.beltMeta; if (!b || !meta) return;
        const rmax = meta.rmax, zmax = rmax * meta.zfrac;
        const sx = w / (2 * rmax), sz = hh / (2 * zmax), s = Math.min(sx, sz);
        const cx = w / 2, cz = hh / 2;
        const X = x => cx + x * s, Z = z => cz - z * s;
        const sc = logScale(b.data);
        // b is laid out as rows j (z from +zmax to -zmax) by columns i (x from 0 to rmax). Columns are (nz rows × nx cols)
        const img = new ImageData(b.nx * 2, b.nz);
        for (let j = 0; j < b.nz; j++) for (let i = 0; i < b.nx; i++) {
            const v = b.data[j * b.nx + i], t = sc.t(v);
            for (const col of [b.nx + i, b.nx - 1 - i]) {
                const k = 4 * (j * b.nx * 2 + col);
                if (!(t >= 0)) { img.data[k + 3] = 0; continue; }
                const [r, g, bb] = P.cmap(t * 0.92 + 0.08); img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = bb; img.data[k + 3] = 255;
            }
        }
        const off = h('canvas', { width: b.nx * 2, height: b.nz }); off.getContext('2d').putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, X(-rmax), Z(zmax), 2 * rmax * s, 2 * zmax * s);
        // field lines L = 2, 3, 4, 6
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        for (const L of [1.5, 2, 3, 4, 5, 6, 8, 10].filter(L => L <= rmax)) {
            for (const side of [1, -1]) {
                ctx.beginPath();
                for (let k = 0; k <= 120; k++) {
                    const lam = -Math.acos(Math.sqrt(1 / L)) + k / 120 * 2 * Math.acos(Math.sqrt(1 / L));
                    const r = L * Math.cos(lam) ** 2; const x = side * r * Math.cos(lam), z = r * Math.sin(lam);
                    k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z));
                }
                ctx.stroke();
            }
            if (L >= 2 && (L * s) > 26) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '10px ui-monospace, monospace'; ctx.fillText(`L=${L}`, X(-L) - 30, Z(0) - 5); }
        }
        ctx.setLineDash([]);
        // Earth
        ctx.fillStyle = '#122437'; ctx.beginPath(); ctx.arc(X(0), Z(0), s, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(0), Z(0), s, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(X(-1), Z(0)); ctx.lineTo(X(1), Z(0)); ctx.stroke();
        // orbits (right half)
        for (const c of ok()) {
            const H = state.results[c.key].hist;
            ctx.fillStyle = c.color;
            for (let i = 0; i < H.rho.length; i++) { if (!isFinite(H.rho[i]) || H.rho[i] > rmax) continue; ctx.fillRect(X(H.rho[i]) - 1, Z(H.z[i]) - 1, 2, 2); }
        }
        // axes
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('R⊕ →', w - 44, Z(0) + 14);
        ctx.fillText('magnetic north ↑', 8, 14);
        const part = meta.key[0];
        scaleBar($('belt-scale'), sc, `${part === 'e' ? 'e⁻' : 'p⁺'} > ${meta.E} MeV cm⁻² s⁻¹`);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        let y = hh - 10;
        for (const c of ok().slice().reverse()) { ctx.fillStyle = c.color; ctx.fillText('■ ' + c.source.name, 8, y); y -= 14; }
    }
    function bindBeltHover() {
        const cv = $('belt'), tip = $('belt-tip');
        cv.addEventListener('pointermove', e => {
            const meta = state.beltMeta; if (!meta || !state.beltImg) return;
            const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
            const rmax = meta.rmax, zmax = rmax * meta.zfrac, s = Math.min(r.width / (2 * rmax), r.height / (2 * zmax));
            const x = (px - r.width / 2) / s, z = -(py - r.height / 2) / s, rr = Math.hypot(x, z);
            if (rr < 1) { tip.hidden = true; return; }
            const lam = Math.atan2(z, Math.abs(x)), L = rr / Math.cos(lam) ** 2, bb0 = Math.sqrt(1 + 3 * Math.sin(lam) ** 2) / Math.cos(lam) ** 6;
            const b = state.beltImg, i = Math.min(b.nx - 1, Math.floor(Math.abs(x) / rmax * b.nx)), j = Math.min(b.nz - 1, Math.max(0, Math.floor((1 - z / zmax) / 2 * b.nz)));
            tip.hidden = false;
            tip.textContent = `R ${rr.toFixed(2)} R⊕ · λ ${(lam * 180 / Math.PI).toFixed(1)}° · L ${L.toFixed(2)} · B/B₀ ${bb0.toFixed(2)} · flux ${fmt(b.data[j * b.nx + i])} cm⁻² s⁻¹`;
            tip.style.left = Math.min(px + 16, r.width - tip.offsetWidth) + 'px'; tip.style.top = (py + 10) + 'px';
        });
        cv.addEventListener('pointerleave', () => { tip.hidden = true; });
    }

    /* ---------------------------------------------------------- export */
    const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    function summaryCSV() {
        const s = state.settings;
        const lines = [`# Van Allen belt radiation summary; AE8/AP8 ${s.solar.toUpperCase()}; IGRF ${s.field}; start ${s.start}; duration ${durText()}; ${s.geometry}; RDM ${s.rdm}`,
            ['case', 'perigee_km', 'apogee_km', 'inclination_deg', 'period_min', 'max_L', `e_gt_${s.eThr}MeV_avg_cm2s`, `p_gt_${s.pThr}MeV_avg_cm2s`, `p_gt_${s.pThr}MeV_peak_cm2s`, 'belt_passes_per_day', 'belt_minutes_per_day', `e_fluence_cm2`, `p_fluence_cm2`, `tid_${s.refMm}mm_krad_si`, 'tid_with_rdm_krad_si', 'source'].join(',')];
        for (const c of ok()) {
            const r = state.results[c.key], el = r.elements;
            lines.push([q(c.source.name), el.perigee.toFixed(1), el.apogee.toFixed(1), el.inc.toFixed(3), el.period.toFixed(2), r.Lmax.toFixed(3), r.fluence.e / r.durationS, r.fluence.p / r.durationS, r.peak.p, r.passes.perDay.toFixed(2), r.passes.minutesPerDay.toFixed(1), r.fluence.e, r.fluence.p, r.refDose.total / 1000, r.refDose.total / 1000 * s.rdm, c.source.kind].join(','));
        }
        return lines.join('\n');
    }
    function exportCSV(kind) {
        const cs = ok(), lines = [];
        if (kind === 'spectra') {
            lines.push('case,particle,E_MeV,integral_flux_cm2s');
            for (const c of cs) for (const part of ['e', 'p']) { const sp = state.results[c.key].spectra[part]; sp.E.forEach((E, i) => lines.push([q(c.source.name), part, E, sp.J[i]].join(','))); }
        } else if (kind === 'fluence') {
            lines.push(`case,t_days,e_gt_${state.settings.eThr}MeV_cm2,p_gt_${state.settings.pThr}MeV_cm2`);
            for (const c of cs) { const r = state.results[c.key].cum; r.t.forEach((t, i) => lines.push([q(c.source.name), t, r.e[i], r.p[i]].join(','))); }
        } else if (kind === 'dose') {
            lines.push('case,al_mm,electron_rad_si,proton_rad_si,brems_rad_si,total_rad_si');
            for (const c of cs) { const d = state.results[c.key].dose; d.mm.forEach((mm, i) => lines.push([q(c.source.name), mm, d.e[i], d.p[i], d.b[i], d.total[i]].join(','))); }
        } else if (kind === 'history') {
            lines.push(`case,t_s,lat_deg,lon_deg,alt_km,L,B_over_B0,e_gt_${state.settings.eThr}MeV_cm2s,p_gt_${state.settings.pThr}MeV_cm2s`);
            for (const c of cs) { const H = state.results[c.key].hist; for (let i = 0; i < H.t.length; i++) lines.push([q(c.source.name), H.t[i], H.lat[i].toFixed(3), H.lon[i].toFixed(3), H.h[i].toFixed(1), H.L[i].toFixed(4), H.bb0[i].toFixed(4), H.fe[i], H.fp[i]].join(',')); }
        }
        P.download(`van-allen-${kind}.csv`, lines.join('\n'));
    }

    /* ---------------------------------------------------------- method text */
    function renderMethod() {
        $('method').innerHTML = `
<h3>What this tool calculates</h3>
<p>For each orbit case, the tool samples the trajectory over the mission and looks up the trapped-particle environment at every sample. It reports the time-averaged omnidirectional integral flux (particles cm⁻² s⁻¹ above each energy), the fluence (flux × time), and the total ionizing dose in silicon behind aluminium shielding.</p>
<h3>Orbit propagation</h3>
<p>All inputs run through SGP4/SDP4 (satellite.js 6.0.1, the Vallado 2006 revision). A pasted TLE or OMM is used as published, including its drag term. Typed elements become a mean-element set at the stated epoch with B* as entered, so J2 secular motion and deep-space lunisolar terms are included. The mission is sampled at N stratified-random instants, one per equal time slice, so long missions cover every node and perigee geometry. Over a year the result converges to the orbit average.</p>
<h3>Magnetic coordinates</h3>
<p>AE8/AP8 are organised in McIlwain L and B/B₀. The tool interpolates both from a geodetic grid (3° × 6° in latitude and longitude, 92 altitudes from 100 to 60,000 km) tabulated with the IGRF/DGRF field and SHELLG field-line tracing in NASA's <code>radbelt</code> package. Against direct <code>radbelt</code> calls at 600 random points, the median error is 0.1% in L and 0.2% in B/B₀.</p>
<h3>Trapped particles</h3>
<p>The NASA AE8 (electrons, 0.04–7 MeV, L ≤ 11) and AP8 (protons, 0.1–400 MeV, L ≤ 6.6) models were evaluated with the NSSDC Fortran through <code>radbelt</code> on 141 L nodes × 40 normalised B/B₀ nodes at 26 electron and 29 proton energies. For each energy and L the tables store the cutoff B/B₀ where trapped flux ends, and flux on nodes normalised to that cutoff. Interpolation at a fixed normalised position follows the cutoff as it moves with L, the same idea as the models' own TRARA routine. Log flux is interpolated linearly in energy, as the models do. Against direct model calls at random positions the median error is about 1% and the 90th percentile is under 9%.</p>
<h3>Dose–depth</h3>
<p>Dose uses the straight-ahead continuous-slowing-down approximation (CSDA) with NIST PSTAR/ESTAR ranges and stopping powers for aluminium (shield) and silicon (target). For a point at the centre of a solid sphere, every direction sees the same path. The slab option integrates over angle for one exposed face. The integral runs over residual energy at the target, which keeps the Bragg region smooth at every depth. Electrons scatter, so CSDA overstates how far they penetrate. The nominal electron transport uses the Katz–Penfold practical range in aluminium instead of the CSDA range. The plot shades the span between CSDA (upper bound) and a path-length detour of ×1.6 (lower estimate). Monte Carlo transport such as SHIELDOSE-2 usually falls near the low side of that span behind a few millimetres. Bremsstrahlung is approximate: a thick-target (Kramers) photon spectrum normalised to the ESTAR radiative yield, half emitted inward, attenuated with a linear buildup factor. Treat it as good to about a factor of two. AE8 starts at 40 keV and AP8 at 100 keV, so the curve starts at 0.05 mm; doses behind thinner layers would be lower bounds. It matters most behind thick shields in electron-dominated orbits (MEO, GEO).</p>
<h3>Validation</h3>
<p>For a 1,000 km, 35° circular orbit at solar minimum, this tool's proton dose behind 82, 232 and 457 mil of aluminium is 3,853, 2,559 and 1,975 rad(Si) per year. CREME96 TRP/AP8MIN gives 3,746, 2,576 and 1,950, so the two agree within 3%. Orbit averages in low Earth orbit match direct AE8/AP8 evaluation along the same trajectory within about 1%. The site's automated tests repeat these checks.</p>
<h3>Limits</h3>
<ul>
<li>AE8/AP8 are static, averaged climatology models from 1960s–70s data. They carry no storms, no solar particle events and no galactic cosmic rays, and they are often wrong by a factor of two or more in the slot region and outer zone. For flight design use AE9/AP9/SPM (with confidence levels), CREME96 for single-event effects, and SHIELDOSE-2 or Monte Carlo transport for dose. Apply a radiation design margin.</li>
<li>Above 60,000 km (beyond the field grid) and outside the model's L range, trapped flux is reported as zero.</li>
<li>Dose is for an idealised shield. Spacecraft shielding varies by direction; use sector analysis of the real geometry for parts-level work.</li>
<li>Present-day-field results shift the SAA geographically but do not correct the models' absolute flux for secular field decay.</li>
</ul>
<h3>References</h3>
<ul>
<li>Vette, J. I. (1991). <em>The AE-8 trapped electron model environment.</em> NSSDC/WDC-A-R&amp;S 91-24.</li>
<li>Sawyer, D. M. &amp; Vette, J. I. (1976). <em>AP-8 trapped proton environment for solar maximum and solar minimum.</em> NSSDC/WDC-A-R&amp;S 76-06.</li>
<li>NASA GSFC <a href="https://github.com/nasa/radbelt">radbelt</a>: Python interface to AE8/AP8 and IGRF.</li>
<li>Berger, M. J. et al. NIST <a href="https://physics.nist.gov/PhysRefData/Star/Text/intro.html">ESTAR/PSTAR</a> stopping-power and range tables.</li>
<li>Seltzer, S. M. (1980). <em>SHIELDOSE: a computer code for space-shielding radiation dose calculations.</em> NBS Technical Note 1116.</li>
<li>Vallado, D. A. et al. (2006). <em>Revisiting Spacetrack Report #3.</em> AIAA 2006-6753.</li>
</ul>`;
    }

    boot();
})();
