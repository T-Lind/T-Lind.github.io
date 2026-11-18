/* Van Allen tool computation worker: SGP4 sampling, AE8/AP8 lookup, fluence and dose. */
'use strict';
importScripts('../space/lib/satellite.min.js', '../space/lib/orbit.js', '../space/lib/radiation.js');
const O = self.SpaceOrbit, R = self.SpaceRad;
let model = null, fields = {}, dose = null;

const DEG = Math.PI / 180;
const DIPOLE_POLE = { 1970: [78.6, -70.1], 2025: [80.8, -72.7] };   // IGRF geomagnetic north pole (lat, lon)

function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/** Dipole magnetic latitude (rad, >= 0) whose field ratio equals bb0. */
function dipoleLat(bb0) {
    if (!(bb0 > 1)) return 0;
    let lo = 0, hi = 0.99999;
    for (let k = 0; k < 40; k++) {
        const s = (lo + hi) / 2, c2 = 1 - s * s;
        (Math.sqrt(1 + 3 * s * s) / (c2 * c2 * c2) > bb0) ? hi = s : lo = s;
    }
    return Math.asin((lo + hi) / 2);
}
function geomagSign(lat, lon, year) {
    const [pl, pn] = DIPOLE_POLE[year] || DIPOLE_POLE[1970];
    const a = lat * DEG, b = lon * DEG, c = pl * DEG, d = pn * DEG;
    const z = Math.sin(a) * Math.sin(c) + Math.cos(a) * Math.cos(c) * Math.cos(b - d);
    return z >= 0 ? 1 : -1;
}

function runCase(job, c, post) {
    const S = job.settings;
    const satrec = O.satrecFromSource(c.source);
    const el = O.elementsOf(satrec);
    const field = fields[S.field];
    const kE = 'e_' + S.solar, kP = 'p_' + S.solar;
    const EE = model.energies.e, EP = model.energies.p;
    const nE = EE.length, nP = EP.length;
    const t0 = Date.parse(S.start), D = S.durationS;
    const warnings = [];
    if (Math.abs(t0 - el.epoch.getTime()) > 30 * 86400e3 && c.source.kind !== 'elements')
        warnings.push(`Mission start is ${Math.round(Math.abs(t0 - el.epoch.getTime()) / 86400e3)} days from the element epoch; SGP4 drag and phasing errors grow with that gap.`);
    const N = Math.round(Math.min(S.samples, Math.max(2000, D / 5)));
    const rnd = lcg(0x5eed + N);
    const sumE = new Float64Array(nE), sumP = new Float64Array(nP);
    const se = new Float64Array(nE), sp = new Float64Array(nP);
    const fl = {}, w = {};
    const LB = 60, Lhist = new Float64Array(LB);   // L from 1 to 13 in 0.2 bins
    let cumE = 0, cumP = 0, peakE = 0, peakP = 0, outside = 0, Lmax = 0, decayedAt = null, inBeltE = 0, inBeltP = 0;
    const every = Math.max(1, Math.floor(N / 360));
    const cum = { t: [0], e: [0], p: [0] };
    const dt = D / N;
    for (let k = 0; k < N; k++) {
        const ts = (k + rnd()) * dt;
        if (decayedAt == null) {
            const date = new Date(t0 + ts * 1000);
            const pv = O.stateAt(satrec, date);
            if (!pv) { decayedAt = ts; warnings.push(`SGP4 stops at ${new Date(t0 + ts * 1000).toISOString().slice(0, 16)}Z (object decays or elements become invalid); exposure after that is zero.`); }
            else {
                const g = O.geodetic(pv.position, O.gmst(date));
                field.lookup(g.lat, g.lon, g.h, fl);
                if (!fl.inside) outside++;
                else {
                    if (fl.L < 13) { Lhist[Math.min(LB - 1, Math.max(0, Math.floor((fl.L - 1) / 0.2)))] += 1; if (fl.L > Lmax) Lmax = fl.L; }
                    const ww = model.weights(fl.L, fl.bb0, w);
                    model.spectrum(kE, ww, se); model.spectrum(kP, ww, sp);
                    for (let i = 0; i < nE; i++) sumE[i] += se[i];
                    for (let i = 0; i < nP; i++) sumP[i] += sp[i];
                    const fe = R.fluxAbove(EE, se, S.eThr), fp = R.fluxAbove(EP, sp, S.pThr);
                    cumE += fe * dt; cumP += fp * dt;
                    if (fe > peakE) peakE = fe; if (fp > peakP) peakP = fp;
                    if (fe > S.eLevel) inBeltE++; if (fp > S.pLevel) inBeltP++;
                }
            }
        }
        if ((k + 1) % every === 0 || k === N - 1) { cum.t.push((k + 1) * dt / 86400); cum.e.push(cumE); cum.p.push(cumP); }
        if (k % 4000 === 0) post({ type: 'progress', id: job.id, key: c.key, frac: k / N * 0.85 });
    }
    const spectra = { e: { E: EE.slice(), J: Array.from(sumE, v => v / N) }, p: { E: EP.slice(), J: Array.from(sumP, v => v / N) } };

    // High-resolution time history over the first window (ground track, SAA passes, belt view)
    const W = Math.min(S.windowS, D);
    const step = Math.min(120, Math.max(5, W / 4000));
    const M = Math.floor(W / step) + 1;
    const hist = { t: new Float32Array(M), lat: new Float32Array(M), lon: new Float32Array(M), h: new Float32Array(M), L: new Float32Array(M), bb0: new Float32Array(M), fe: new Float32Array(M), fp: new Float32Array(M), rho: new Float32Array(M), z: new Float32Array(M) };
    let passes = 0, inPass = false, passTime = 0, n = M;
    for (let k = 0; k < M; k++) {
        const ts = k * step, date = new Date(t0 + ts * 1000);
        const pv = O.stateAt(satrec, date);
        if (!pv) { n = k; break; }
        const g = O.geodetic(pv.position, O.gmst(date));
        field.lookup(g.lat, g.lon, g.h, fl);
        const ww = fl.inside ? model.weights(fl.L, fl.bb0, w) : null;
        model.spectrum(kE, ww, se); model.spectrum(kP, ww, sp);
        const fe = R.fluxAbove(EE, se, S.eThr), fp = R.fluxAbove(EP, sp, S.pThr);
        hist.t[k] = ts; hist.lat[k] = g.lat; hist.lon[k] = g.lon; hist.h[k] = g.h;
        hist.L[k] = fl.inside ? Math.min(fl.L, 60) : NaN; hist.bb0[k] = fl.inside ? fl.bb0 : NaN; hist.fe[k] = fe; hist.fp[k] = fp;
        // dipole-equivalent position in the magnetic meridian plane, from (B, L)
        const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z) / O.RE;
        let rho, z;
        if (fl.inside && fl.L < 14) { const lam = dipoleLat(fl.bb0), rr = fl.L * Math.cos(lam) ** 2; rho = rr * Math.cos(lam); z = geomagSign(g.lat, g.lon, S.field) * rr * Math.sin(lam); }
        else { const s = geomagSign(g.lat, g.lon, S.field); rho = r; z = 0 * s; }
        hist.rho[k] = rho; hist.z[k] = z;
        const on = fp > S.pLevel;
        if (on && !inPass) passes++;
        if (on) passTime += step;
        inPass = on;
    }
    for (const key of Object.keys(hist)) hist[key] = hist[key].slice(0, n);
    post({ type: 'progress', id: job.id, key: c.key, frac: 0.92 });

    // Dose-depth over the mission
    const mm = []; for (let i = 0; i <= 40; i++) mm.push(0.05 * Math.pow(10, i * (Math.log10(50 / 0.05) / 40)));
    const curve = dose.depthCurve(spectra, mm, S.geometry, S.ef);
    const eHi = dose.depthCurve(spectra, mm, S.geometry, 'csda').e, eLo = dose.depthCurve(spectra, mm, S.geometry, 'detour').e;
    const scale = arr => arr.map(v => v * D);
    const std = [0.1, 0.5, 1, 2, 2.54, 3, 4, 5, 7.5, 10, 15, 20];
    const table = dose.depthCurve(spectra, std, S.geometry, S.ef);
    const ref = dose.depthCurve(spectra, [S.refMm], S.geometry, S.ef);
    const Wd = W / 86400;
    const live = decayedAt == null ? D : decayedAt;
    if (outside / N > 0.001) warnings.push(`${(100 * outside / N).toFixed(1)}% of the time is above 60,000 km, beyond the tabulated field; trapped flux there is taken as zero (AE8 ends at L = 11).`);
    return {
        name: c.source.name, elements: { ...el, epoch: el.epoch.toISOString() }, N, durationS: D, liveS: live, warnings,
        spectra, peak: { e: peakE, p: peakP }, frac: { e: inBeltE / N, p: inBeltP / N, outside: outside / N },
        fluence: { e: cumE, p: cumP }, cum, Lhist: { lo: 1, step: 0.2, frac: Array.from(Lhist, v => v / N) }, Lmax,
        hist, passes: { count: passes, perDay: Wd > 0 ? passes / Math.min(Wd, (n * step) / 86400) : 0, minutesPerDay: Wd > 0 ? passTime / 60 / Math.min(Wd, (n * step) / 86400) : 0, windowS: n * step },
        dose: { mm, e: scale(curve.e), p: scale(curve.p), b: scale(curve.b), total: scale(curve.total), eLo: scale(eLo), eHi: scale(eHi) },
        table: { mm: std, e: scale(table.e), p: scale(table.p), b: scale(table.b), total: scale(table.total) },
        refDose: { e: ref.e[0] * D, p: ref.p[0] * D, b: ref.b[0] * D, total: ref.total[0] * D }
    };
}

function mapGrid(msg) {
    const field = fields[msg.field], key = msg.key, E = msg.E, part = key[0];
    const en = model.energies[part], spec = new Float64Array(en.length);
    const nx = 180, ny = 90, out = new Float32Array(nx * ny), fl = {}, w = {};
    for (let j = 0; j < ny; j++) {
        const lat = 89 - j * 2;
        for (let i = 0; i < nx; i++) {
            const lon = -179 + i * 2;
            field.lookup(lat, lon, msg.h, fl);
            model.spectrum(key, fl.inside ? model.weights(fl.L, fl.bb0, w) : null, spec);
            out[j * nx + i] = R.fluxAbove(en, spec, E);
        }
    }
    return { nx, ny, data: out };
}

function beltImage(msg) {
    const key = msg.key, E = msg.E, part = key[0];
    const en = model.energies[part], spec = new Float64Array(en.length);
    const nx = msg.nx, nz = msg.nz, rmax = msg.rmax, out = new Float32Array(nx * nz), w = {};
    for (let j = 0; j < nz; j++) {
        const z = rmax * (1 - 2 * (j + 0.5) / nz) * (msg.zfrac || 0.7);
        for (let i = 0; i < nx; i++) {
            const x = rmax * (i + 0.5) / nx;
            const r = Math.hypot(x, z);
            if (r < 1) { out[j * nx + i] = NaN; continue; }
            const c = x / r, s = z / r, L = r / (c * c), bb0 = Math.sqrt(1 + 3 * s * s) / (c * c * c * c * c * c);
            model.spectrum(key, model.weights(L, bb0, w), spec);
            out[j * nx + i] = R.fluxAbove(en, spec, E);
        }
    }
    return { nx, nz, data: out };
}

self.onmessage = e => {
    const msg = e.data;
    try {
        if (msg.type === 'init') {
            model = new R.TrappedModel(msg.ae8ap8);
            for (const [year, buf] of Object.entries(msg.fields)) fields[year] = new R.FieldGrid({ ...msg.fieldMeta, year: +year }, buf);
            dose = new R.DoseModel(msg.nist);
            self.postMessage({ type: 'ready' });
        } else if (msg.type === 'field') {
            fields[msg.year] = new R.FieldGrid({ ...msg.fieldMeta, year: msg.year }, msg.buffer);
            self.postMessage({ type: 'field-ready', year: msg.year });
        } else if (msg.type === 'run') {
            for (const c of msg.cases) {
                try { self.postMessage({ type: 'case', id: msg.id, key: c.key, result: runCase(msg, c, m => self.postMessage(m)) }); }
                catch (err) { self.postMessage({ type: 'case', id: msg.id, key: c.key, error: err.message }); }
            }
            self.postMessage({ type: 'done', id: msg.id });
        } else if (msg.type === 'map') {
            const r = mapGrid(msg); self.postMessage({ type: 'map', id: msg.id, ...r }, [r.data.buffer]);
        } else if (msg.type === 'belt') {
            const r = beltImage(msg); self.postMessage({ type: 'belt', id: msg.id, ...r }, [r.data.buffer]);
        }
    } catch (err) { self.postMessage({ type: 'error', id: msg.id, error: err.message }); }
};
