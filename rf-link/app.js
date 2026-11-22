(function () {
    'use strict';

    const U = window.SpaceUI, O = window.SpaceOrbit, G = window.RFGeometry, B = window.RFBudget, D = window.RFDsp;
    const PU = window.SpacePlotUtil;
    const el = id => document.getElementById(id);
    const text = (id, value) => { const e = el(id); if (e.textContent !== value) e.textContent = value; };
    const P = window.RFPayloads;
    const initialTime = Date.UTC(2026, 10, 21);

    /* ---------------- radios and scenarios ---------------- */
    const RADIOS = {
        uhf: { freqMHz: 437.5, txPowerW: 1, txLossDb: 1, scAnt: 'omni', scGainDbi: 0, scPointDeg: 0, oscPpm: 1, phaseNoiseDbc: -85,
            modulation: 'gmsk', symbolRateKsps: 9.6, coding: 'rs',
            gsAnt: 'yagi', gsGainDbi: 14, gsDiameterM: 3, gsEffPct: 55, gsPointDeg: 2, polLossDb: 3, gsLineLossDb: 0.5, lnaNfDb: 0.8,
            noiseEnv: 'residential', rainRate: 0, implLossDb: 1, precorrect: true, predErrorKm: 0, searchKHz: 3, loopHz: 100 },
        sband: { freqMHz: 2245, txPowerW: 2, txLossDb: 1, scAnt: 'patch', scGainDbi: 6, scPointDeg: 0, oscPpm: 1, phaseNoiseDbc: -90,
            modulation: 'qpsk', symbolRateKsps: 2000, coding: 'concat',
            gsAnt: 'dish', gsGainDbi: 14, gsDiameterM: 3.7, gsEffPct: 55, gsPointDeg: 0.1, polLossDb: 0.5, gsLineLossDb: 0.2, lnaNfDb: 0.6,
            noiseEnv: 'quiet', rainRate: 0, implLossDb: 1, precorrect: true, predErrorKm: 0, searchKHz: 20, loopHz: 2000 },
        xband: { freqMHz: 8212.5, txPowerW: 5, txLossDb: 1.5, scAnt: 'isoflux', scGainDbi: 6, scPointDeg: 0, oscPpm: 0.5, phaseNoiseDbc: -95,
            modulation: '8psk', symbolRateKsps: 75000, coding: 'concat',
            gsAnt: 'dish', gsGainDbi: 14, gsDiameterM: 5.4, gsEffPct: 60, gsPointDeg: 0.03, polLossDb: 0.3, gsLineLossDb: 0.1, lnaNfDb: 0.5,
            noiseEnv: 'quiet', rainRate: 0, implLossDb: 1, precorrect: true, predErrorKm: 0, searchKHz: 100, loopHz: 50000 },
        beacon: { freqMHz: 437.5, txPowerW: 1, txLossDb: 1, scAnt: 'omni', scGainDbi: 0, scPointDeg: 0, oscPpm: 0.5, phaseNoiseDbc: -90,
            modulation: 'bpsk', symbolRateKsps: 4.8, coding: 'conv',
            gsAnt: 'yagi', gsGainDbi: 14, gsDiameterM: 3, gsEffPct: 55, gsPointDeg: 2, polLossDb: 3, gsLineLossDb: 0.5, lnaNfDb: 0.8,
            noiseEnv: 'rural', rainRate: 0, implLossDb: 1, precorrect: true, predErrorKm: 0, searchKHz: 1, loopHz: 30 }
    };
    // `at` places the transmission in the pass: centred on closest approach, early in the pass, or at an elevation.
    const SCENARIOS = {
        uhf: { radio: 'uhf', at: 'tca' },
        sband: { radio: 'sband', at: 'tca' },
        xband: { radio: 'xband', at: 'tca' },
        low: { radio: 'sband', at: { el: 6 } },
        rain: { radio: 'xband', set: { rainRate: 45 }, at: { el: 20 } },
        stale: { radio: 'beacon', set: { predErrorKm: 120 }, at: 'tca' },
        nodoppler: { radio: 'beacon', set: { precorrect: false }, at: { el: 15 } }
    };
    const RADIO_KEYS = Object.keys(RADIOS.sband);

    /* ---------------- state ---------------- */
    let source = U.presetSource('sso800', new Date(initialTime));
    let time = initialTime, searchStart = initialTime;
    const handoff = U.readOrbitLink(location.hash);
    if (handoff) { source = handoff.source; time = searchStart = handoff.time; }
    let satrec = null, passes = [], passIndex = -1, profile = [], passStats = [], jumps = [];
    let worker = null, workerReady = false, payloadNow = null, userFile = null, globeView = null, globeQueued = false;
    const payloadCache = {};
    let busy = null, next = null, last = null, revision = 0, serial = 0, runs = 0, progress = 0;
    let playing = false, playStamp = 0, lastDispatch = 0;
    const inputs = [...document.querySelectorAll('[data-setting]')];
    const lastRun = new Map();
    const valueOf = input => input.type === 'checkbox' ? input.checked : input.value;

    /* ---------------- formatting ---------------- */
    const clock = s => { const t = Math.max(0, Math.round(s)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
    function hz(v, digits = 2) {
        if (!Number.isFinite(v)) return '—';
        const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
        if (a >= 1e6) return s + (a / 1e6).toFixed(digits + 1) + ' MHz';
        if (a >= 1e3) return s + (a / 1e3).toFixed(digits) + ' kHz';
        return s + a.toFixed(1) + ' Hz';
    }
    function bitrate(v) {
        if (!Number.isFinite(v)) return '—';
        if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e8 ? 0 : 2) + ' Mbit/s';
        if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 2) + ' kbit/s';
        return v.toFixed(0) + ' bit/s';
    }
    function bytes(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GB';
        if (v >= 1e6) return (v / 1e6).toFixed(1) + ' MB';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + ' kB';
        return Math.round(v) + ' B';
    }
    const sci = v => v === null || v === undefined || !Number.isFinite(v) ? '—' : v === 0 ? '0' : v < 1e-12 ? '< 10⁻¹²' : v >= 0.01 ? v.toFixed(4) : v.toExponential(1).replace('e-', ' × 10⁻').replace(/⁻(\d+)/, (_, d) => '⁻' + [...d].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]).join(''));
    const db = (v, d = 1) => Number.isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + ' dB' : '—';
    const signedDb = (v, d = 1) => Number.isFinite(v) ? (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d) + ' dB' : '—';
    function duration(s) {
        if (!Number.isFinite(s)) return '—';
        if (s === 0) return '0 s';
        if (s < 1) return (s * 1000).toFixed(s < 0.01 ? 2 : 1) + ' ms';
        if (s < 90) return s.toFixed(1) + ' s';
        if (s < 5400) return Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s';
        return (s / 3600).toFixed(1) + ' h';
    }

    function status(message, state = '', stamp = '') {
        text('status', message);
        text('stamp', stamp);
        el('dot').className = 'dot ' + state;
    }

    /* ---------------- settings ---------------- */
    function station() {
        const id = el('station').value;
        const preset = G.STATIONS.find(s => s.id === id);
        return { id, name: preset ? preset.name : 'Custom site', lat: el('lat').valueAsNumber, lon: el('lon').valueAsNumber, alt: el('alt').valueAsNumber };
    }
    function radio() {
        const r = {};
        for (const key of RADIO_KEYS) {
            const input = el(key);
            r[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value;
        }
        r.gsEff = r.gsEffPct / 100;
        return r;
    }
    function setRadio(values) {
        for (const key of RADIO_KEYS) {
            const input = el(key);
            if (input.type === 'checkbox') input.checked = values[key];
            else input.value = values[key];
        }
        updateVisibility();
        lastRun.clear();
    }
    function updateVisibility() {
        const show = (selector, on) => { for (const f of document.querySelectorAll(selector)) { f.hidden = !on; const i = f.querySelector('input'); if (i) i.disabled = !on; } };
        show('[data-steered]', el('scAnt').value === 'steered');
        show('[data-yagi]', el('gsAnt').value === 'yagi');
        show('[data-dish]', el('gsAnt').value === 'dish');
        show('[data-precorrect]', el('precorrect').checked);
        show('[data-coherent]', el('modulation').value !== 'gmsk');
        text('scGain-label', { omni: 'Gain', isoflux: 'Edge-of-coverage gain', patch: 'Peak gain', steered: 'Peak gain' }[el('scAnt').value]);
    }
    function invalidInput() { return inputs.find(input => !input.disabled && !input.validity.valid); }
    function labelOf(input) {
        const label = input.closest('label');
        if (!label) return input.id;
        if (input.type === 'checkbox') return label.textContent.trim();
        const span = label.querySelector('span').cloneNode(true);
        span.querySelectorAll('em').forEach(unit => unit.remove());
        return span.textContent.trim();
    }

    /* ---------------- passes and the budget along them ---------------- */
    function airtime(r = radio()) {
        return D.plan({ modulation: r.modulation, coding: r.coding, symbolRate: r.symbolRateKsps * 1e3, payloadBytes: payloadNow ? payloadNow.bytes.length : 27648 }).seconds;
    }

    function computePasses() {
        try { satrec = O.satrecFromSource(source); } catch (err) { satrec = null; passes = []; status(err.message, 'err'); return; }
        const st = station();
        if (![st.lat, st.lon, st.alt, el('mask').valueAsNumber, el('days').valueAsNumber].every(Number.isFinite)) return;
        passes = G.passes(satrec, st, new Date(searchStart), el('days').valueAsNumber, el('mask').valueAsNumber);
        el('pass').replaceChildren(...passes.map((p, i) => U.h('option', { value: String(i), text: `${i + 1} · ${U.utc(p.aos).slice(5, 16)} · ${p.maxEl.toFixed(0)}°` })));
        computeStats();
        renderPassTable();
    }

    // Budget along every pass, for the pass table and totals.
    function computeStats() {
        const r = radio(), st = station();
        if (!satrec || invalidInput()) { passStats = []; return; }
        passStats = passes.map(p => {
            const step = Math.max(5, p.duration / 80);
            let positive = 0, peak = -Infinity, volume = 0;
            for (let s = 0; s <= p.duration; s += step) {
                const geo = G.look(satrec, st, new Date(p.aos.getTime() + s * 1000));
                if (!geo || geo.el < 0) continue;
                const b = B.compute(r, geo, st);
                peak = Math.max(peak, b.margin);
                if (b.margin >= 0) { positive += step; volume += b.rb * step / 8; }
            }
            return { positive: Math.min(positive, p.duration), peak, volume };
        });
    }

    function selectPass(i, at) {
        passIndex = i;
        el('pass').value = String(i);
        const p = passes[i];
        if (!p) { profile = []; return; }
        const st = station();
        const step = Math.max(1, Math.min(600, p.duration / 400));
        profile = G.profile(satrec, st, p.aos, p.los, step);
        recomputeProfileBudget();
        el('timeline').max = Math.round(p.duration);
        if (at !== undefined) time = placeTime(p, at);
        time = Math.min(p.los.getTime(), Math.max(p.aos.getTime(), time));
        buildJumps();
        renderPassTable();
        drawSky();
        if (el('payload').value === 'telemetry' && satrec && worker) setPayload(telemetryPayload());
    }

    function recomputeProfileBudget() {
        const r = radio(), st = station();
        if (invalidInput()) return;
        for (const s of profile) { const b = B.compute(r, s, st); s.margin = b.margin; s.doppler = b.doppler; s.ebn0 = b.ebn0; }
    }

    function placeTime(p, at) {
        const air = airtime();
        if (at === 'tca') return Math.round(Math.max(p.aos.getTime(), p.tca.getTime() - air * 500) / 1000) * 1000;
        if (at && at.el !== undefined) {
            const hit = profile.find(s => s.el >= at.el);
            return p.aos.getTime() + (hit ? hit.t : 0) * 1000;
        }
        return p.aos.getTime();
    }

    function bestPass() {
        const good = passes.findIndex(p => p.maxEl >= 45 && !p.clippedStart);
        if (good >= 0) return good;
        let best = 0;
        passes.forEach((p, i) => { if (p.maxEl > passes[best].maxEl) best = i; });
        return passes.length ? best : -1;
    }

    function passContaining(t) {
        return passes.findIndex(p => t >= p.aos.getTime() && t <= p.los.getTime());
    }

    // Named points of the pass: rise, set, closest approach, zero Doppler and margin crossings.
    function buildJumps() {
        const p = passes[passIndex];
        jumps = [];
        if (!p) { el('jump').replaceChildren(U.h('option', { value: '', text: 'Jump to pass point…' })); return; }
        jumps.push({ t: 0, name: p.clippedStart ? 'Start of search window' : 'Rise above the mask' });
        jumps.push({ t: (p.tca - p.aos) / 1000, name: `Maximum elevation (${p.maxEl.toFixed(1)}°)` });
        for (let i = 1; i < profile.length; i++) {
            const a = profile[i - 1], b = profile[i];
            const at = (va, vb) => a.t + (b.t - a.t) * va / (va - vb);
            if (a.rangeRate < 0 && b.rangeRate >= 0) jumps.push({ t: at(a.rangeRate, b.rangeRate), name: 'Zero Doppler (closest approach)' });
            if (Number.isFinite(a.margin) && a.margin < 0 && b.margin >= 0) jumps.push({ t: at(a.margin, b.margin), name: 'Margin rises above 0 dB' });
            if (Number.isFinite(a.margin) && a.margin >= 0 && b.margin < 0) jumps.push({ t: at(a.margin, b.margin), name: 'Margin falls below 0 dB' });
        }
        jumps.push({ t: p.duration, name: p.clippedEnd ? 'End of search window' : 'Set below the mask' });
        jumps = jumps.map(j => ({ ...j, t: Math.round(j.t) })).sort((a, b) => a.t - b.t);
        el('jump').replaceChildren(U.h('option', { value: '', text: 'Jump to pass point…' }),
            ...jumps.map((j, i) => U.h('option', { value: String(i), text: `+${clock(j.t)} · ${j.name}` })));
    }

    /* ---------------- clock and pass strip ---------------- */
    function updateClock() {
        const p = passes[passIndex];
        if (p) {
            const elapsed = Math.round((time - p.aos.getTime()) / 1000);
            el('timeline').value = elapsed;
            text('elapsed', '+' + clock(elapsed));
            text('period-text', `of ${clock(p.duration)} · rises ${U.utc(p.aos, true).slice(11)}`);
        } else {
            text('elapsed', '');
            text('period-text', 'No pass above the mask in the search window');
        }
        if (document.activeElement !== el('when') || playing) el('when').value = U.toLocalInput(new Date(time));
        drawStrip();
        renderBudget();
        drawSky();
        refreshRun();
        scheduleGlobe();
    }

    function marginColor(m) { return !Number.isFinite(m) ? '#151a24' : m >= 3 ? '#1f4a33' : m >= 0 ? '#4d4220' : '#4a1f22'; }

    function drawStrip() {
        const canvas = el('pass-strip'), w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
        const c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = '#0e1118';
        c.fillRect(0, 0, w, h);
        const p = passes[passIndex];
        if (!p || !profile.length) return;
        const span = p.duration || 1;
        for (let i = 0; i < profile.length; i++) {
            const s = profile[i], x0 = s.t / span * w, x1 = (profile[i + 1] ? profile[i + 1].t : span) / span * w;
            c.fillStyle = marginColor(s.margin);
            c.fillRect(x0, 0, x1 - x0 + 0.75, h);
        }
        // Elevation, 0–90°, as a line.
        c.strokeStyle = 'rgba(200, 214, 240, 0.75)';
        c.lineWidth = 1.2;
        c.beginPath();
        profile.forEach((s, i) => { const x = s.t / span * w, y = h - 2 - Math.max(0, s.el) / 90 * (h - 4); i ? c.lineTo(x, y) : c.moveTo(x, y); });
        c.stroke();
        // This transmission.
        const t0 = (time - p.aos.getTime()) / 1000, t1 = t0 + airtime();
        c.fillStyle = 'rgba(244, 244, 246, 0.22)';
        c.fillRect(t0 / span * w, 0, Math.max(2, (Math.min(span, t1) - t0) / span * w), h);
        c.fillStyle = 'rgba(244, 244, 246, 0.45)';
        for (const j of jumps) c.fillRect(Math.round(j.t / span * w), 0, 1, 6);
        c.fillStyle = '#f4f4f6';
        c.fillRect(Math.min(w - 2, Math.max(0, Math.round(t0 / span * w) - 1)), 0, 2, h);
    }

    /* ---------------- run control ---------------- */
    function snapshot() {
        return { radio: radio(), station: station(), source, time: Math.round(time), seed: el('seed').valueAsNumber };
    }

    function request() {
        revision++;
        next = {};
        dispatch();
        refreshRun();
    }

    function dispatch() {
        if (!workerReady || busy || !next || !payloadNow) return;
        if (invalidInput() || passIndex < 0 || !passes.length) { next = null; refreshRun(); return; }
        next = null;
        const id = ++serial;
        const run = snapshot();
        busy = { id, revision, snapshot: run, payload: payloadNow };
        progress = 0;
        lastDispatch = performance.now();
        worker.postMessage({ type: 'capture', id, ...run });
        if (!playing || !last) status('Transmitting and decoding…', 'busy');
        refreshRun();
    }

    function refreshRun() {
        const invalid = invalidInput();
        let state = 'current', message = '';
        if (!workerReady) { state = 'running'; message = 'Loading the payload…'; }
        else if (invalid) { state = 'invalid'; message = `Fix ${labelOf(invalid)} to update the transmission.`; }
        else if (!passes.length) { state = 'invalid'; message = 'No passes above the elevation mask. Change the orbit, site, mask or search window.'; }
        else if (busy && !playing) { state = 'running'; message = `Simulating transmission ${runs + 1}${busy.stage ? ' · ' + busy.stage.toLowerCase() : ''}…`; }
        el('run-state').dataset.state = state;
        el('run-state').hidden = state === 'current';
        text('run-text', message);
        // With no pass there is nothing to receive, so an older result must not stay on screen.
        if (workerReady && !passes.length) { el('placeholder').hidden = false; text('placeholder', 'No passes above the elevation mask in the search window.'); }
        else if (workerReady && last) el('placeholder').hidden = true;
        const bar = el('run-progress');
        const active = !!busy && !playing;
        bar.toggleAttribute('data-active', active);
        if (active) bar.style.setProperty('--progress', (Math.max(0.04, progress) * 100).toFixed(1) + '%');
    }

    function play(on) {
        playing = on;
        playStamp = 0;
        el('play').textContent = on ? 'Pause' : 'Play';
        el('play').setAttribute('aria-pressed', String(on));
        if (on) requestAnimationFrame(tick);
        refreshRun();
    }
    function tick(at) {
        if (!playing) return;
        const p = passes[passIndex];
        if (!p) { play(false); return; }
        if (playStamp) time = Math.min(p.los.getTime(), time + (at - playStamp) * +el('rate').value);
        playStamp = at;
        updateClock();
        if (time >= p.los.getTime()) { play(false); request(); return; }
        if (!busy && at - lastDispatch > 300) { next = {}; dispatch(); }
        requestAnimationFrame(tick);
    }
    function moveTo(seconds) {
        const p = passes[passIndex];
        if (!p) return;
        play(false);
        time = p.aos.getTime() + 1000 * Math.round(Math.min(p.duration, Math.max(0, seconds)));
        updateClock();
        request();
    }

    /* ---------------- results ---------------- */
    function receive({ data }) {
        if (data.type === 'ready') {
            workerReady = true;
            for (const id of ['play', 'back', 'step', 'timeline', 'jump']) el(id).disabled = false;
            el('placeholder').hidden = true;
            request();
            return;
        }
        if (data.type === 'progress') {
            if (busy && busy.id === data.id) { progress = data.fraction; busy.stage = data.stage; refreshRun(); }
            return;
        }
        if (!busy || busy.id !== data.id) return;
        const current = busy.revision === revision, ran = busy.snapshot, sentWith = busy.payload;
        busy = null;
        if (!current) { if (!next) next = {}; dispatch(); refreshRun(); return; }
        if (data.type === 'error') {
            play(false);
            status(data.message, 'err');
            if (!last) { el('placeholder').hidden = false; text('placeholder', data.message); }
            refreshRun();
            return;
        }
        last = { ...data.result, run: ++runs, snapshot: ran, time: data.time, payload: sentWith };
        el('placeholder').hidden = true;
        render();
        const c = last.counts, n = c.ok + c.corrected + c.failed + c.missed;
        status(last.acquisition.found ? `${c.ok + c.corrected} of ${n} frames received` : 'Carrier not acquired', c.ok + c.corrected === n ? 'ok' : '', U.utc(new Date(last.time), true));
        dispatch();
        refreshRun();
    }

    function render() {
        const r = last.snapshot.radio, mod = D.MODULATION[r.modulation];
        text('frame-meta', `Transmission ${last.run} · ${mod.label} ${(r.symbolRateKsps >= 1000 ? (r.symbolRateKsps / 1000).toFixed(r.symbolRateKsps >= 1e4 ? 1 : 3) + ' Msym/s' : r.symbolRateKsps.toFixed(r.symbolRateKsps < 10 ? 2 : 1) + ' ksym/s')} · ${D.CODING[r.coding].label} · ${U.utc(new Date(last.time), true)}`);
        drawConstellation();
        drawSpectrum();
        drawData();
        drawFrameStrip();
        renderReceiver();
        for (const id of ['export-iq', 'export-image', 'export-frames']) el(id).disabled = false;
    }

    function fitCanvas(canvas) {
        const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
        if (!w || !h) return null;
        if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
        const c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        return { c, w, h };
    }

    function drawConstellation() {
        const f = fitCanvas(el('iq'));
        if (!f || !last) return;
        const { c, w, h } = f, r = last.snapshot.radio;
        c.fillStyle = '#06070a';
        c.fillRect(0, 0, w, h);
        c.font = '11px ui-monospace, monospace';
        if (!last.points) {
            text('iq-title', r.modulation === 'gmsk' ? 'Discriminator output' : 'Constellation');
            text('iq-sub', '');
            c.fillStyle = '#9b9ba5'; c.textAlign = 'center';
            c.fillText('No carrier acquired', w / 2, h / 2);
            return;
        }
        if (r.modulation === 'gmsk') {
            text('iq-title', 'Discriminator output');
            text('iq-sub', 'normalized, ideal ±1');
            const bins = 90, lo = -2, hi = 2, hist = new Float64Array(bins);
            for (const v of last.points) { const b = Math.floor((v - lo) / (hi - lo) * bins); if (b >= 0 && b < bins) hist[b]++; }
            const max = Math.max(...hist) || 1, pad = 18;
            for (let i = 0; i < bins; i++) {
                const x = pad + i / bins * (w - 2 * pad), bh = hist[i] / max * (h - 2 * pad);
                c.fillStyle = '#8fb7ff';
                c.fillRect(x, h - pad - bh, (w - 2 * pad) / bins - 0.5, bh);
            }
            c.strokeStyle = 'rgba(255,255,255,.3)';
            c.setLineDash([3, 3]);
            for (const v of [-1, 0, 1]) { const x = pad + (v - lo) / (hi - lo) * (w - 2 * pad); c.beginPath(); c.moveTo(x, pad); c.lineTo(x, h - pad); c.stroke(); }
            c.setLineDash([]);
            c.fillStyle = '#9b9ba5'; c.textAlign = 'center';
            c.fillText('−1', pad + 0.25 * (w - 2 * pad), h - 4); c.fillText('+1', pad + 0.75 * (w - 2 * pad), h - 4);
            return;
        }
        text('iq-title', 'Constellation');
        text('iq-sub', `${(last.points.length / 2).toLocaleString()} symbols`);
        const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2, range = 1.7, n = 120;
        const grid = new Float32Array(n * n);
        const pts = last.points;
        for (let i = 0; i < pts.length; i += 2) {
            const x = Math.floor((pts[i] / range + 1) / 2 * n), y = Math.floor((1 - pts[i + 1] / range) / 2 * n);
            if (x >= 0 && x < n && y >= 0 && y < n) grid[y * n + x]++;
        }
        let max = 0; for (const v of grid) if (v > max) max = v;
        const img = c.createImageData(n, n);
        for (let i = 0; i < n * n; i++) {
            const t = grid[i] ? Math.log1p(grid[i]) / Math.log1p(max) : 0;
            const [R, Gc, Bc] = t ? PU.cmap(0.25 + 0.75 * t, 'inferno') : [6, 7, 10];
            img.data[4 * i] = R; img.data[4 * i + 1] = Gc; img.data[4 * i + 2] = Bc; img.data[4 * i + 3] = 255;
        }
        const tmp = document.createElement('canvas'); tmp.width = n; tmp.height = n;
        tmp.getContext('2d').putImageData(img, 0, 0);
        c.imageSmoothingEnabled = false;
        c.drawImage(tmp, ox, oy, size, size);
        c.strokeStyle = 'rgba(255,255,255,.14)';
        c.beginPath(); c.moveTo(ox, oy + size / 2); c.lineTo(ox + size, oy + size / 2); c.moveTo(ox + size / 2, oy); c.lineTo(ox + size / 2, oy + size); c.stroke();
        const ideal = D.constellation(r.modulation);
        c.strokeStyle = 'rgba(160, 230, 200, .9)';
        for (let v = 0; v < ideal.n; v++) {
            const x = ox + (ideal.re[v] / range + 1) / 2 * size, y = oy + (1 - ideal.im[v] / range) / 2 * size;
            c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); c.stroke();
        }
    }

    function drawSpectrum() {
        const f = fitCanvas(el('spectrum'));
        if (!f || !last) return;
        const { c, w, h } = f, s = last.spectrum, Fs = last.Fs, acq = last.acquisition;
        c.fillStyle = '#06070a';
        c.fillRect(0, 0, w, h);
        const l = 8, rgt = 8, top = 10, bottom = 22, pw = w - l - rgt, ph = h - top - bottom;
        let max = -Infinity; for (const v of s) max = Math.max(max, v);
        const lo = max - 45;
        const xOf = fr => l + (fr / Fs + 0.5) * pw;
        // Acquisition search window.
        const sw = Math.min(acq.searchHz, Fs / 2);
        c.fillStyle = 'rgba(143, 183, 255, 0.08)';
        c.fillRect(xOf(-sw), top, xOf(sw) - xOf(-sw), ph);
        c.strokeStyle = 'rgba(255,255,255,.12)';
        c.beginPath();
        for (let k = -2; k <= 2; k++) { const x = Math.round(xOf(k * Fs / 4)) + 0.5; c.moveTo(x, top); c.lineTo(x, top + ph); }
        for (let d = 0; d <= 45; d += 15) { const y = Math.round(top + d / 45 * ph) + 0.5; c.moveTo(l, y); c.lineTo(l + pw, y); }
        c.stroke();
        c.strokeStyle = '#d7dde8';
        c.lineWidth = 1.1;
        c.beginPath();
        for (let i = 0; i < s.length; i++) {
            const x = l + i / s.length * pw, y = top + (1 - Math.max(0, s[i] - lo) / 45) * ph;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        const carrier = acq.truthHz;
        if (Math.abs(carrier) < Fs / 2) {
            c.strokeStyle = '#e9bd7d'; c.setLineDash([3, 3]);
            const x = Math.round(xOf(carrier)) + 0.5;
            c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + ph); c.stroke(); c.setLineDash([]);
        }
        c.fillStyle = '#9b9ba5'; c.font = '10.5px ui-monospace, monospace'; c.textAlign = 'center';
        for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) {
            const x = Math.min(w - 24, Math.max(24, xOf(k * Fs)));
            c.fillText(k === 0 ? '0' : hz(k * Fs, 1).replace('+', ''), x, h - 6);
        }
        text('spec-sub', `carrier ${hz(carrier)} · 15 dB/div`);
    }

    /* ---------------- received data views ---------------- */
    // A frame hidden from the views: never received, or failed its CRC while failed frames are hidden.
    function hiddenFrame(i) {
        const st = last.status[i];
        return st === 'missed' || (st === 'failed' && !el('show-failed').checked);
    }
    const frameOf = byte => Math.floor(byte / D.PAYLOAD_BYTES);

    function drawData() {
        if (!last || !last.payload) return;
        const p = last.payload, kind = p.kind, sent = p.bytes, rx = last.image, view = el('image-view').value;
        el('image-wrap').hidden = kind !== 'image';
        el('data-text').hidden = kind !== 'text';
        el('data-file').hidden = kind !== 'file';
        text('data-title', { image: 'Downlinked image', text: 'Downlinked text', file: 'Downlinked file' }[kind]);
        let wrong = 0;
        for (let i = 0; i < sent.length; i++) if (rx[i] !== sent[i] && !hiddenFrame(frameOf(i))) wrong++;
        if (kind === 'image') drawImageData(p, rx, view);
        else if (kind === 'text') drawText(p, rx, view);
        else drawFile(p, rx, view);
        const missing = last.status.filter(s => s === 'missed').length;
        text('img-sub', view === 'sent' ? `${p.name} · ${bytes(sent.length)}`
            : `${wrong.toLocaleString()} wrong byte${wrong === 1 ? '' : 's'}${missing ? ` · ${missing} frame${missing === 1 ? '' : 's'} missing` : ''}`);
    }

    function drawImageData(p, rx, view) {
        const canvas = el('image'), { width, height, channels } = p, sent = p.bytes;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        canvas.style.aspectRatio = width + ' / ' + height;
        const c = canvas.getContext('2d'), img = c.createImageData(width, height), d = img.data;
        for (let px = 0; px < width * height; px++) {
            const o = 4 * px, b = channels * px;
            d[o + 3] = 255;
            if (view !== 'sent' && hiddenFrame(frameOf(b))) {
                const x = px % width, y = Math.floor(px / width), checker = ((x >> 2) + (y >> 2)) & 1 ? 34 : 22;
                d[o] = d[o + 1] = checker; d[o + 2] = checker + 6;
                continue;
            }
            let diff = false;
            for (let k = 0; k < channels; k++) diff ||= rx[b + k] !== sent[b + k];
            const src = view === 'sent' ? sent : rx;
            const val = k => src[b + (channels === 1 ? 0 : k)];
            if (view === 'errors') {
                const g = 0.3 * (channels === 1 ? sent[b] : (sent[b] + sent[b + 1] + sent[b + 2]) / 3);
                if (diff) { d[o] = 255; d[o + 1] = 80; d[o + 2] = 80; } else d[o] = d[o + 1] = d[o + 2] = g;
            } else { d[o] = val(0); d[o + 1] = val(1); d[o + 2] = val(2); }
        }
        c.putImageData(img, 0, 0);
    }

    // Runs of text with a class each, merged so a long payload stays a handful of DOM nodes.
    function renderRuns(pre, runs) {
        const nodes = [];
        let cls = null, buf = '';
        const flush = () => { if (!buf) return; nodes.push(cls ? U.h('span', { class: cls, text: buf }) : document.createTextNode(buf)); buf = ''; };
        for (const [t, k] of runs) { if (k !== cls) { flush(); cls = k; } buf += t; }
        flush();
        pre.replaceChildren(...nodes);
    }
    function charAt(bytes, i) {
        const b = bytes[i];
        if (b === 10) return ['\n', 1];
        if (b === 9) return ['    ', 1];
        if (b >= 32 && b < 127) return [String.fromCharCode(b), 1];
        const len = b >= 0xF0 && b < 0xF5 ? 4 : b >= 0xE0 ? 3 : b >= 0xC2 && b < 0xE0 ? 2 : 0;
        if (len) { try { return [new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(i, i + len)), len]; } catch (err) { /* damaged sequence */ } }
        return ['·', 1];
    }
    function drawText(p, rx, view) {
        const sent = p.bytes, src = view === 'sent' ? sent : rx, runs = [];
        for (let i = 0; i < sent.length;) {
            const f = frameOf(i);
            if (view !== 'sent' && hiddenFrame(f)) {
                const end = Math.min(sent.length, (f + 1) * D.PAYLOAD_BYTES);
                runs.push([`\n⟨frame ${f + 1} ${last.status[f] === 'missed' ? 'not received' : 'failed its CRC'}: ${(end - i).toLocaleString()} bytes⟩\n`, 'gap']);
                i = end;
                continue;
            }
            const [ch, n] = charAt(src, i);
            let bad = false;
            for (let k = 0; k < n; k++) bad ||= rx[i + k] !== sent[i + k];
            runs.push([ch, view !== 'sent' && bad ? 'err' : view === 'errors' ? 'dim' : null]);
            i += n;
        }
        renderRuns(el('data-text'), runs);
    }

    let fileUrl = null;
    function drawFile(p, rx, view) {
        const sent = p.bytes, src = view === 'sent' ? sent : rx, limit = Math.min(sent.length, 4096), runs = [];
        const hex = b => b.toString(16).padStart(2, '0');
        for (let line = 0; line < limit; line += 8) {
            runs.push([line.toString(16).padStart(6, '0') + '  ', 'dim']);
            let ascii = '';
            for (let i = line; i < line + 8; i++) {
                if (i >= limit) { runs.push(['   ', null]); continue; }
                const gone = view !== 'sent' && hiddenFrame(frameOf(i)), bad = view !== 'sent' && rx[i] !== sent[i];
                runs.push([(gone ? '··' : hex(src[i])) + ' ', gone ? 'gap' : bad ? 'err' : null]);
                ascii += gone ? ' ' : src[i] >= 32 && src[i] < 127 ? String.fromCharCode(src[i]) : '.';
            }
            runs.push([' ' + ascii + '\n', 'dim']);
        }
        if (limit < sent.length) runs.push([`\nShowing the first ${limit.toLocaleString()} of ${sent.length.toLocaleString()} bytes. Save the received file to see the rest.`, 'dim']);
        renderRuns(el('data-hex'), runs);
        const imgEl = el('file-image');
        if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
        if (!p.image) { imgEl.hidden = true; text('file-image-note', `${p.mime === 'application/octet-stream' ? 'Binary file' : p.mime} · ${bytes(sent.length)}`); return; }
        fileUrl = URL.createObjectURL(new Blob([src], { type: p.mime }));
        imgEl.onload = () => { imgEl.hidden = false; text('file-image-note', view === 'sent' ? 'Original file, decoded by your browser.' : 'The received bytes, decoded by your browser.'); };
        imgEl.onerror = () => { imgEl.hidden = true; text('file-image-note', 'The received bytes no longer decode as an image. Compressed formats rarely survive bit errors.'); };
        imgEl.src = fileUrl;
    }

    const STATUS_COLOR = { ok: '#83e4b6', corrected: '#8fb7ff', failed: '#f08a8a', missed: '#3a3f4b' };
    function drawFrameStrip() {
        const f = fitCanvas(el('frames'));
        if (!f || !last) return;
        const { c, w, h } = f, n = last.status.length, cw = w / n;
        last.status.forEach((s, i) => { c.fillStyle = STATUS_COLOR[s]; c.fillRect(i * cw + 0.5, 0, Math.max(1, cw - 1.5), h); });
    }

    function renderReceiver() {
        const r = last.snapshot.radio, c = last.counts, n = c.ok + c.corrected + c.failed + c.missed, got = c.ok + c.corrected;
        const st = last.stats, acq = last.acquisition, gm = r.modulation === 'gmsk';
        const lock = el('lock');
        if (!acq.found) {
            lock.textContent = 'Carrier not acquired'; lock.dataset.lock = 'no';
            const outside = Math.abs(acq.truthHz) > acq.searchHz;
            text('lock-note', last.blindFraction > 0.5
                ? `The carrier was ${hz(acq.truthHz)} from the receiver's tuning, outside its sample bandwidth. Enable Doppler pre-correction or reduce the prediction error.`
                : outside ? `The carrier was ${hz(acq.truthHz)} from the receiver's tuning, outside the ±${hz(acq.searchHz).replace('+', '')} search range.`
                    : `The carrier was inside the search range but too weak to detect (detection statistic ${acq.metric.toFixed(1)}, threshold ${(acq.threshold || 6).toFixed(1)}).`);
        } else if (got === n) {
            lock.textContent = 'Data received intact'; lock.dataset.lock = 'yes';
            text('lock-note', c.corrected ? `Reed–Solomon corrected ${st.corrected.toLocaleString()} byte errors in ${c.corrected} of ${n} frames. Every frame passed its CRC.` : `All ${n} frames passed their CRC without correction.`);
        } else {
            lock.textContent = got ? 'Data partly received' : 'No frames decoded'; lock.dataset.lock = got ? 'part' : 'no';
            const parts = [];
            if (c.failed) parts.push(`${c.failed} failed the CRC`);
            if (c.missed) parts.push(`${c.missed} never synchronized`);
            const below = last.belowHorizon > 0 ? ' The spacecraft set during the transmission.' : '';
            text('lock-note', `${got} of ${n} frames arrived intact; ${parts.join(' and ')}.${below}`);
        }
        text('rx-frames', `${got} / ${n}`);
        text('rx-frames-sub', `${c.corrected} corrected · ${c.failed} failed · ${c.missed} missed`);
        text('rx-ber', sci(st.chanBer));
        text('rx-ber-sub', st.theoryBer === null ? '' : `${gm ? 'Coherent MSK bound' : 'Theory'} ${sci(st.theoryBer)}`);
        text('rx-dec', sci(st.decBer));
        text('rx-dec-sub', st.decBits ? `${st.decErr.toLocaleString()} of ${st.decBits.toLocaleString()} bits before Reed–Solomon` : '');
        text('rx-esn0', gm ? '—' : db(st.esn0Measured, 2));
        text('rx-esn0-sub', gm ? `Predicted ${db(st.esn0Predicted, 2)}` : `Predicted ${db(st.esn0Predicted, 2)} · M2M4 estimate`);
        text('rx-acq', acq.found ? hz(acq.hz) : 'Not found');
        text('rx-acq-sub', `Truth ${hz(acq.truthHz)} · search ±${hz(acq.searchHz).replace('+', '')}`);
        // Each re-acquisition means the receiver lost frame sync (a cycle or symbol slip) and searched again.
        const locks = last.track.slice(2).map(b => b.lock);
        text('rx-lock', acq.found ? String(st.resyncs) : '—');
        text('rx-lock-sub', !acq.found ? 'No carrier' : gm ? 'Non-coherent detector' : `Phase-lock indicator ${locks.length ? (locks.reduce((a, v) => a + v, 0) / locks.length).toFixed(2) : '—'} (1 is clean)`);
        text('rx-air', duration(last.seconds));
        text('rx-air-sub', `${last.symbols.toLocaleString()} symbols · ${bitrate(B.infoRate(r))}`);
        text('rx-samples', (last.symbols * D.SPS).toLocaleString());
        text('rx-samples-sub', `Simulated in ${(st.computeMs / 1000).toFixed(2)} s`);
        const okFrames = got === n && acq.found;
        text('frame-summary', !acq.found ? 'Carrier not acquired · no frames decoded'
            : `${got}/${n} frames · channel BER ${sci(st.chanBer)} (${gm ? 'MSK bound' : 'theory'} ${sci(st.theoryBer)}) · ${c.corrected ? c.corrected + ' corrected by Reed–Solomon · ' : ''}${okFrames ? 'data intact' : 'data damaged'}`);
        // Frame table.
        const rows = last.frames.filter(f => !f.idle).map(f => U.h('tr', {},
            U.h('td', { text: String(f.index + 1) }), U.h('td', { text: f.time.toFixed(f.time < 1 ? 4 : 2) }), U.h('td', { text: f.esn0.toFixed(1) }),
            U.h('td', { text: f.chanBits ? `${f.chanErrors} / ${f.chanBits.toLocaleString()}` : '—' }),
            U.h('td', { text: f.decBits && D.CODING[r.coding].conv ? String(f.decErrors) : '—' }),
            U.h('td', { text: D.CODING[r.coding].rs && f.status !== 'missed' ? (f.status === 'failed' ? 'Uncorrectable' : `${f.corrected} bytes fixed`) : '—' }),
            U.h('td', { class: 'status-' + f.status, text: { ok: 'Clean', corrected: 'Corrected', failed: 'CRC failed', missed: 'Not received' }[f.status] })));
        el('frame-rows').replaceChildren(...rows);
        trackPlot.set([
            { name: 'Receiver estimate', color: '#8fb7ff', data: last.track.map(b => [b.t, b.hz]) },
            { name: 'True residual offset', color: '#e9bd7d', dash: [5, 4], data: last.track.map(b => [b.t, b.truth]) }
        ]);
        text('track-sub', acq.found ? 'carrier frequency remaining after pre-correction' : 'no carrier acquired');
    }

    /* ---------------- link budget tab ---------------- */
    function geometryNow() {
        if (!satrec) return null;
        return G.look(satrec, station(), new Date(time));
    }
    function budgetRows(b, r, geo) {
        const gsNote = r.gsAnt === 'dish' ? `${r.gsDiameterM} m dish, ${r.gsEffPct}% efficient, beamwidth ${b.gsBeamwidth.toFixed(2)}°` : `Yagi, beamwidth ${b.gsBeamwidth.toFixed(0)}°`;
        return [
            ['Transmit power', b.txDbw, 'dBW', `${r.txPowerW} W`],
            ['Line and circuit loss', -r.txLossDb, 'dB', ''],
            ['Spacecraft antenna gain', b.scGain, 'dBi', r.scAnt === 'steered' ? 'Pointed at the station' : `${B.SC_ANTENNAS[r.scAnt].label}, ${b.scTheta.toFixed(1)}° off boresight`],
            ...(r.scAnt === 'steered' ? [['Spacecraft pointing loss', -b.scPointing, 'dB', `${r.scPointDeg}° error`]] : []),
            ['EIRP', b.eirp, 'dBW', '', 'total'],
            ['Free-space path loss', -b.fspl, 'dB', `${Math.round(geo.range).toLocaleString()} km at ${(r.freqMHz).toLocaleString()} MHz`],
            ['Atmospheric gases', -b.gas, 'dB', `${geo.el.toFixed(1)}° elevation`],
            ['Rain', -b.rain, 'dB', r.rainRate ? `${r.rainRate} mm/h` : 'No rain'],
            ['Polarization loss', -b.pol, 'dB', ''],
            ['Ground tracking loss', -b.gsPointing, 'dB', `${r.gsPointDeg}° error`],
            ['Ground antenna gain', b.gsGain, 'dBi', gsNote, 'part'],
            ['System noise temperature', -10 * Math.log10(b.sysK), 'dBK', `${b.sysK.toFixed(0)} K: sky ${b.skyK.toFixed(0)} K, man-made ${b.manK.toFixed(0)} K, spillover ${b.spillK} K, LNA ${b.lnaK.toFixed(0)} K, line loss`, 'part'],
            ['G/T', b.gt, 'dB/K', `Antenna gain, minus ${r.gsLineLossDb} dB loss before the LNA, minus noise temperature`, 'total'],
            ['Boltzmann constant', 228.6, 'dB', ''],
            ['C/N0', b.cn0, 'dB-Hz', '', 'total'],
            ['Information rate', -10 * Math.log10(b.rb), 'dB-Hz', `${bitrate(b.rb)} of transfer frames`],
            ['Eb/N0', b.ebn0, 'dB', `Es/N0 ${b.esn0.toFixed(1)} dB at ${(b.rs / 1e3).toLocaleString()} ksym/s`, 'total'],
            ['Required Eb/N0', -b.required, 'dB', `${D.MODULATION[r.modulation].label}, ${D.CODING[r.coding].label}, 1% frame loss`],
            ['Implementation loss', -b.impl, 'dB', ''],
            ['Margin', b.margin, 'dB', '', 'margin']
        ];
    }
    let currentBudget = null;
    function renderBudget() {
        const geo = geometryNow(), r = radio();
        currentBudget = null;
        if (!geo || invalidInput()) return;
        const st = station(), b = B.compute(r, geo, st);
        currentBudget = { b, r, geo };
        const head = el('margin-head');
        head.textContent = geo.el < 0 ? 'Spacecraft below the horizon' : `Link margin ${signedDb(b.margin)}`;
        head.dataset.lock = geo.el < 0 || b.margin < 0 ? 'no' : b.margin < 3 ? 'part' : 'yes';
        text('margin-note', `At ${U.utc(new Date(time), true)}, the start of the transmission. Margin is Eb/N0 minus the required ${b.required.toFixed(2)} dB and ${b.impl.toFixed(1)} dB implementation loss.`);
        text('g-el', geo.el.toFixed(1) + '°'); text('g-az', 'Azimuth ' + geo.az.toFixed(1) + '°');
        text('g-range', Math.round(geo.range).toLocaleString() + ' km'); text('g-delay', 'One-way delay ' + b.delayMs.toFixed(2) + ' ms');
        text('g-doppler', hz(b.doppler)); text('g-rate', 'Rate ' + hz(-r.freqMHz * 1e6 * G.rangeAccel(satrec, st, new Date(time)) / B.C) + '/s');
        text('g-nadir', geo.offNadir.toFixed(1) + '°'); text('g-alt', 'Altitude ' + Math.round(geo.altitude).toLocaleString() + ' km');
        el('budget-rows').replaceChildren(...budgetRows(b, r, geo).map(([name, value, unit, note, kind]) => U.h('tr', { class: kind || '' },
            U.h('td', { text: kind === 'part' ? '↳ ' + name : name }), U.h('td', { class: 'strong', text: `${value < 0 ? '−' : kind && kind !== 'part' ? '' : '+'}${Math.abs(value).toFixed(2)} ${unit}` }), U.h('td', { class: 'l note-cell', text: note }))));
        const air = airtime(r);
        text('rate-note', `Information rate ${bitrate(b.rb)} · needs Eb/N0 ≥ ${b.required.toFixed(2)} dB`);
        if (payloadNow) {
            const plan = D.plan({ modulation: r.modulation, coding: r.coding, symbolRate: r.symbolRateKsps * 1e3, payloadBytes: payloadNow.bytes.length });
            el('payload-note').classList.remove('bad-text');
            text('payload-note', `${payloadNow.label} · ${bytes(payloadNow.bytes.length)} in ${plan.imageFrames} frames · airtime ${duration(air)}`);
        }
    }

    /* ---------------- passes tab ---------------- */
    const marginPlot = new window.SpacePlot(el('plot-margin'), { x: { label: 'Time since rise (min)', short: 't' }, y: { label: 'Margin (dB)', zero: false }, title: '' });
    const dopplerPlot = new window.SpacePlot(el('plot-doppler'), { x: { label: 'Time since rise (min)', short: 't' }, y: { label: 'Doppler shift (kHz)', zero: false }, title: '' });
    const trackPlot = new window.SpacePlot(el('plot-track'), { x: { label: 'Time into transmission (s)', short: 't' }, y: { label: 'Residual carrier (Hz)', zero: false }, title: '' });

    function renderPassPlots() {
        const p = passes[passIndex];
        if (!p || !profile.length) { marginPlot.set([]); dopplerPlot.set([]); return; }
        const now = (time - p.aos.getTime()) / 60000;
        marginPlot.set([{ name: 'Link margin', color: '#83e4b6', data: profile.map(s => [s.t / 60, s.margin]) }],
            [{ y: 0, label: '0 dB', color: 'rgba(240,138,138,.6)' }, { x: now, label: 'now', color: 'rgba(255,255,255,.5)' }]);
        dopplerPlot.set([{ name: 'Doppler shift', color: '#8fb7ff', data: profile.map(s => [s.t / 60, s.doppler / 1e3]) }],
            [{ y: 0, color: 'rgba(255,255,255,.2)' }, { x: now, label: 'now', color: 'rgba(255,255,255,.5)' }]);
        text('plot-margin-sub', `peak ${signedDb(Math.max(...profile.map(s => s.margin)))}`);
        text('plot-doppler-sub', `±${hz(Math.max(...profile.map(s => Math.abs(s.doppler)))).replace('+', '')}`);
    }

    function drawSky() {
        const f = fitCanvas(el('sky'));
        if (!f) return;
        const { c, w, h } = f, R = Math.min(w, h) / 2 - 18, cx = w / 2, cy = h / 2;
        c.strokeStyle = 'rgba(255,255,255,.14)';
        for (const e of [0, 30, 60]) { c.beginPath(); c.arc(cx, cy, R * (90 - e) / 90, 0, 7); c.stroke(); }
        c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
        c.fillStyle = '#9b9ba5'; c.font = '10.5px ui-monospace, monospace'; c.textAlign = 'center';
        c.fillText('N', cx, cy - R - 6); c.fillText('S', cx, cy + R + 13); c.fillText('E', cx + R + 9, cy + 4); c.fillText('W', cx - R - 9, cy + 4);
        const xy = s => { const rr = R * (90 - Math.max(0, s.el)) / 90, a = s.az * Math.PI / 180; return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)]; };
        for (let i = 1; i < profile.length; i++) {
            const [x0, y0] = xy(profile[i - 1]), [x1, y1] = xy(profile[i]);
            const m = profile[i].margin;
            c.strokeStyle = !Number.isFinite(m) ? '#555' : m >= 3 ? '#83e4b6' : m >= 0 ? '#e9bd7d' : '#f08a8a';
            c.lineWidth = 2;
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
        const geo = geometryNow();
        if (geo && geo.el >= 0) { const [x, y] = xy(geo); c.fillStyle = '#f4f4f6'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); }
    }

    function renderPassTable() {
        const rows = passes.map((p, i) => {
            const s = passStats[i] || {};
            return U.h('tr', { class: i === passIndex ? 'sel' : '', 'data-pass': String(i) },
                U.h('td', {}, U.h('button', { class: 'link', type: 'button', text: String(i + 1), 'data-pass': String(i) })),
                U.h('td', { text: U.utc(p.aos, true).replace(' UTC', '') + (p.clippedStart ? ' (in progress)' : '') }),
                U.h('td', { text: p.maxEl.toFixed(1) + '°' }), U.h('td', { text: duration(p.duration) }),
                U.h('td', { text: Number.isFinite(s.positive) ? duration(s.positive) : '—' }),
                U.h('td', { text: Number.isFinite(s.peak) ? s.peak.toFixed(1) : '—' }),
                U.h('td', { text: Number.isFinite(s.volume) ? bytes(s.volume) : '—' }));
        });
        el('pass-rows').replaceChildren(...(rows.length ? rows : [U.h('tr', {}, U.h('td', { colspan: 7, text: 'No passes above the elevation mask in the search window.' }))]));
        const days = el('days').valueAsNumber;
        text('ps-count', String(passes.length));
        text('ps-count-sub', Number.isFinite(days) ? `in ${days} day${days === 1 ? '' : 's'} above ${el('mask').value}°` : '');
        const positive = passStats.reduce((a, s) => a + (s.positive || 0), 0), volume = passStats.reduce((a, s) => a + (s.volume || 0), 0);
        text('ps-contact', duration(positive));
        text('ps-contact-sub', passes.length ? `of ${duration(passes.reduce((a, p) => a + p.duration, 0))} above the mask` : '');
        text('ps-volume', bytes(volume));
        text('ps-volume-sub', Number.isFinite(days) && days > 0 ? `${bytes(volume / days)} per day at this rate` : '');
        let gap = 0;
        for (let i = 1; i < passes.length; i++) gap = Math.max(gap, (passes[i].aos - passes[i - 1].los) / 1000);
        text('ps-gap', passes.length > 1 ? duration(gap) : '—');
        text('ps-gap-sub', 'between consecutive passes');
        renderPassPlots();
    }

    /* ---------------- edits ---------------- */
    function stationChanged(input) {
        if (input.id === 'station') {
            const preset = G.STATIONS.find(s => s.id === el('station').value);
            if (preset) { el('lat').value = preset.lat; el('lon').value = preset.lon; el('alt').value = preset.alt; }
            if (globeView) globeView.center(el('lat').valueAsNumber, el('lon').valueAsNumber);
        } else if (['lat', 'lon', 'alt'].includes(input.id)) el('station').value = 'custom';
        if (input.id === 'start') { const d = U.fromLocalInput(el('start').value); if (d) searchStart = d.getTime(); }
        reorbit();
    }

    // Orbit, station or search window changed: find passes again and keep the time if it is still in a pass.
    function reorbit(at) {
        play(false);
        if (invalidInput()) { refreshRun(); return; }
        computePasses();
        let i = passContaining(time);
        let place = at;
        if (i < 0) { i = bestPass(); if (place === undefined) place = 'tca'; }
        if (i >= 0) selectPass(i, place);
        else { passIndex = -1; profile = []; jumps = []; buildJumps(); renderPassTable(); }
        updateClock();
        request();
    }

    function radioChanged() {
        updateVisibility();
        recomputeProfileBudget();
        computeStats();
        buildJumps();
        renderPassTable();
        updateClock();
        request();
    }

    function changed(input) {
        lastRun.set(input, valueOf(input));
        el('scenario').value = '';
        if (['station', 'lat', 'lon', 'alt', 'mask', 'start', 'days'].includes(input.id)) stationChanged(input);
        else radioChanged();
    }
    const typed = U.debounce(input => { if (input.validity.valid && lastRun.get(input) !== valueOf(input)) changed(input); }, 450);
    for (const input of inputs) {
        input.addEventListener('change', () => { if (lastRun.get(input) !== valueOf(input)) changed(input); });
        input.addEventListener('input', () => { refreshRun(); if (input.type === 'number') typed(input); });
    }

    function applyScenario(name) {
        const sc = SCENARIOS[name];
        if (!sc) return;
        setRadio({ ...RADIOS[sc.radio], ...(sc.set || {}) });
        el('seed').value = 1;
        play(false);
        computePasses();
        const i = bestPass();
        if (i >= 0) selectPass(i, sc.at); else { passIndex = -1; profile = []; }
        updateClock();
        request();
    }
    el('scenario').addEventListener('change', () => applyScenario(el('scenario').value));

    el('pass').addEventListener('change', () => { play(false); selectPass(+el('pass').value, 'tca'); updateClock(); request(); });
    el('pass-rows').addEventListener('click', e => {
        const b = e.target.closest('[data-pass]');
        if (!b) return;
        play(false); selectPass(+b.dataset.pass, 'tca'); updateClock(); request();
        el('timeline').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    el('jump').addEventListener('change', () => {
        const v = el('jump').value;
        el('jump').selectedIndex = 0;
        if (v !== '' && jumps[+v]) moveTo(jumps[+v].t);
    });
    el('timeline').addEventListener('input', () => moveTo(+el('timeline').value));
    let dragging = false;
    const stripTime = e => { const box = el('pass-strip').getBoundingClientRect(); return (e.clientX - box.left) / box.width * (passes[passIndex]?.duration || 0); };
    el('pass-strip').addEventListener('pointerdown', e => { if (passIndex < 0) return; dragging = true; el('pass-strip').setPointerCapture(e.pointerId); moveTo(stripTime(e)); });
    el('pass-strip').addEventListener('pointermove', e => { if (dragging) moveTo(stripTime(e)); });
    el('pass-strip').addEventListener('pointerup', () => { dragging = false; });
    el('play').addEventListener('click', () => {
        const p = passes[passIndex];
        if (!p) return;
        if (!playing && time >= p.los.getTime()) time = p.aos.getTime();
        const was = playing;
        play(!was);
        if (was) request();
    });
    el('back').addEventListener('click', () => { const p = passes[passIndex]; if (p) moveTo((time - p.aos.getTime()) / 1000 - 10); });
    el('step').addEventListener('click', () => { const p = passes[passIndex]; if (p) moveTo((time - p.aos.getTime()) / 1000 + 10); });
    el('when').addEventListener('change', () => {
        const d = U.fromLocalInput(el('when').value);
        if (!d || !el('when').validity.valid) { status('Enter a valid UTC time.', 'err'); return; }
        const i = passContaining(d.getTime());
        if (i < 0) { status('That time is not inside a predicted pass. Pick a time between rise and set, or move the pass search window.', 'err'); el('when').value = U.toLocalInput(new Date(time)); return; }
        play(false);
        time = d.getTime();
        if (i !== passIndex) selectPass(i);
        updateClock();
        request();
    });
    el('image-view').addEventListener('change', drawData);
    el('show-failed').addEventListener('change', drawData);
    U.tabs(el('tabs'), name => {
        if (name === 'passes') { renderPassPlots(); drawSky(); }
        if (name === 'receiver' && last) renderReceiver();
    });
    const redraw = () => { drawStrip(); if (last) { drawConstellation(); drawSpectrum(); drawFrameStrip(); } drawSky(); };
    new ResizeObserver(redraw).observe(el('main'));

    /* ---------------- exports ---------------- */
    function tar(files) {
        const blocks = [];
        const enc = new TextEncoder();
        for (const { name, data } of files) {
            const head = new Uint8Array(512);
            const put = (s, off, len) => head.set(enc.encode(s).slice(0, len), off);
            put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
            put(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
            put(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
            put('        ', 148, 8); head[156] = 48; put('ustar\0', 257, 6); put('00', 263, 2);
            let sum = 0; for (const b of head) sum += b;
            put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
            blocks.push(head, data, new Uint8Array((512 - data.length % 512) % 512));
        }
        blocks.push(new Uint8Array(1024));
        return new Blob(blocks, { type: 'application/x-tar' });
    }
    function save(name, blob) {
        const url = URL.createObjectURL(blob);
        U.h('a', { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n');
    el('export-iq').addEventListener('click', () => {
        if (!last) return;
        const r = last.snapshot.radio, base = 'rf-link-capture';
        const meta = {
            global: { 'core:datatype': 'cf32_le', 'core:sample_rate': last.Fs, 'core:version': '1.0.0', 'core:recorder': 'RF Link Simulator',
                'core:description': `Simulated ${D.MODULATION[r.modulation].label} downlink, ${D.CODING[r.coding].label}, ${r.symbolRateKsps} ksym/s, after Doppler pre-correction. Four samples per symbol.` },
            captures: [{ 'core:sample_start': 0, 'core:frequency': r.freqMHz * 1e6, 'core:datetime': new Date(last.time).toISOString() }],
            annotations: []
        };
        const data = new Uint8Array(last.exportIq.buffer, last.exportIq.byteOffset, last.exportIq.byteLength);
        save(base + '.sigmf', tar([{ name: `${base}/${base}.sigmf-meta`, data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) }, { name: `${base}/${base}.sigmf-data`, data }]));
    });
    el('export-image').addEventListener('click', () => {
        if (!last) return;
        const p = last.payload;
        if (p.kind === 'image') PU.download('received-' + p.name.replace(/\.[a-z]+$/, '') + '.png', el('image').toDataURL('image/png'));
        else save('received-' + p.name, new Blob([last.image], { type: p.mime || 'application/octet-stream' }));
    });
    el('export-frames').addEventListener('click', () => {
        if (!last) return;
        save('rf-link-frames.csv', new Blob([csv([['frame', 'sent_s', 'predicted_esn0_db', 'channel_bit_errors', 'channel_bits', 'decoded_bit_errors', 'rs_bytes_corrected', 'result'],
            ...last.frames.filter(f => !f.idle).map(f => [f.index + 1, f.time, f.esn0.toFixed(2), f.chanErrors ?? '', f.chanBits ?? '', f.decErrors ?? '', f.corrected ?? '', f.status])])], { type: 'text/csv' }));
    });
    el('export-budget').addEventListener('click', () => {
        if (!currentBudget) return;
        const { b, r, geo } = currentBudget;
        save('rf-link-budget.csv', new Blob([csv([['term', 'value', 'unit', 'note'], ...budgetRows(b, r, geo).map(([n, v, u, note]) => [n, v.toFixed(3), u, note])])], { type: 'text/csv' }));
    });
    el('export-passes').addEventListener('click', () => {
        save('rf-link-passes.csv', new Blob([csv([['pass', 'rise_utc', 'set_utc', 'max_elevation_deg', 'duration_s', 'positive_margin_s', 'peak_margin_db', 'data_volume_bytes'],
            ...passes.map((p, i) => [i + 1, p.aos.toISOString(), p.los.toISOString(), p.maxEl.toFixed(2), p.duration, (passStats[i]?.positive ?? 0).toFixed(0), (passStats[i]?.peak ?? NaN).toFixed(2), Math.round(passStats[i]?.volume ?? 0)])])], { type: 'text/csv' }));
    });

    /* ---------------- start ---------------- */
    el('station').replaceChildren(...G.STATIONS.map(s => U.h('option', { value: s.id, text: s.name })), U.h('option', { value: 'custom', text: 'Custom site' }));
    el('station').value = 'svalbard';
    Object.assign(el('lat'), { value: G.STATIONS[0].lat }); el('lon').value = G.STATIONS[0].lon; el('alt').value = G.STATIONS[0].alt;
    el('mask').value = 5; el('days').value = 1; el('seed').value = 1;
    el('start').value = U.toLocalInput(new Date(searchStart));
    setRadio(RADIOS.sband);

    const editor = new U.OrbitEditor(el('orbit-editor'), {
        epoch: () => new Date(searchStart), idPrefix: 'rf-orbit',
        onChange: src => { source = src; el('scenario').value = ''; reorbit('tca'); }
    });
    editor.setSource(source);
    U.tabs(el('tabs'));
    computePasses();
    const first = handoff ? (passContaining(time) >= 0 ? passContaining(time) : bestPass()) : bestPass();
    if (first >= 0) selectPass(first, handoff && passContaining(time) >= 0 ? undefined : SCENARIOS.sband.at);
    updateClock();
    status('Loading the payload…', 'busy');

    /* ---------------- payloads ---------------- */
    function telemetryPayload() {
        const p = passes[passIndex];
        return P.telemetry(satrec, p ? p.aos.getTime() : time);
    }
    function setPayload(p) {
        payloadNow = p;
        if (worker) { const copy = p.bytes.slice(); worker.postMessage({ type: 'payload', buffer: copy.buffer }, [copy.buffer]); }
        renderBudget();
        drawStrip();
    }
    async function choosePayload() {
        const id = el('payload').value;
        el('file-row').hidden = id !== 'file';
        try {
            if (id === 'file') { if (userFile) setPayload(userFile); else text('payload-note', `Choose any file up to ${P.LIMIT / 1024} kB. It never leaves your browser.`); return; }
            if (id === 'telemetry') { if (satrec) setPayload(telemetryPayload()); return; }
            setPayload(payloadCache[id] || (payloadCache[id] = await P.image(P.PRESETS[id])));
        } catch (err) { status(err.message, 'err'); text('payload-note', err.message); }
    }
    el('payload').addEventListener('change', choosePayload);
    el('pick-file').addEventListener('click', () => el('payload-file').click());
    el('payload-file').addEventListener('change', async () => {
        const file = el('payload-file').files[0];
        el('payload-file').value = '';
        if (!file) return;
        try {
            if (file.size > P.LIMIT) throw new Error(`Files up to ${P.LIMIT / 1024} kB fit in one simulated transmission; this one is ${(file.size / 1024).toFixed(1)} kB.`);
            userFile = P.fromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
            text('file-name', file.name);
            if (el('payload').value === 'file') setPayload(userFile);
        } catch (err) { status(err.message, 'err'); text('payload-note', err.message); el('payload-note').classList.add('bad-text'); }
    });

    /* ---------------- globe ---------------- */
    function scheduleGlobe() {
        if (!globeView || globeQueued) return;
        globeQueued = true;
        requestAnimationFrame(() => { globeQueued = false; drawGlobe(); });
    }
    function drawGlobe() {
        if (!globeView || !satrec || invalidInput()) return;
        const st = station(), pass = passes[passIndex];
        const sum = globeView.update({
            satrec, time, station: st, stations: G.STATIONS, radio: radio(), mask: el('mask').valueAsNumber, pass,
            period: O.elementsOf(satrec).period, footprint: el('g-footprint').checked, lit: el('g-light').checked,
            name: source.name || 'Spacecraft', trackKey: JSON.stringify(source) + '|' + (pass ? pass.aos.getTime() : '')
        });
        if (!sum) return;
        const ns = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? ' N' : ' S'), ew = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? ' E' : ' W');
        text('globe-meta', `Spacecraft over ${ns(sum.lat)}, ${ew(sum.lon)} at ${Math.round(sum.alt).toLocaleString()} km · `
            + (sum.visible ? `${sum.el.toFixed(1)}° above ${st.name}, margin ${signedDb(sum.margin)}` : `below the horizon at ${st.name}`)
            + ` · ${sum.inView} of ${G.STATIONS.length} preset stations in view`);
    }
    function initGlobe() {
        try { globeView = new window.RFLinkGlobe(el('globe'), el('globe-tags')); }
        catch (err) { el('globe-placeholder').hidden = false; text('globe-placeholder', 'WebGL is not available in this browser, so the globe cannot be drawn.'); text('globe-meta', ''); return; }
        const st = station();
        globeView.center(st.lat, st.lon, 3.1);
        fetch('../space/data/land-110m.json').then(r => r.json()).then(land => { globeView.setLand(land); scheduleGlobe(); }).catch(() => {});
        new ResizeObserver(() => globeView.globe.draw()).observe(el('globe'));
        scheduleGlobe();
    }
    for (const id of ['g-footprint', 'g-light']) el(id).addEventListener('change', scheduleGlobe);
    el('g-center').addEventListener('click', () => { const st = station(); if (globeView) { globeView.follow = false; el('g-follow').setAttribute('aria-pressed', 'false'); globeView.center(st.lat, st.lon); } });
    el('g-follow').addEventListener('click', () => {
        if (!globeView) return;
        globeView.follow = !globeView.follow;
        el('g-follow').setAttribute('aria-pressed', String(globeView.follow));
        scheduleGlobe();
    });

    try {
        worker = new Worker('worker.js');
        worker.addEventListener('message', receive);
        worker.addEventListener('error', () => { play(false); status('The link worker stopped. Reload the page to retry.', 'err'); });
        choosePayload();
    } catch (err) {
        status('Could not start the link worker. Open this page from a web server.', 'err');
    }
    initGlobe();
})();
