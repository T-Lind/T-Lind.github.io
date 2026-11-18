/* Debris visualizer worker: SGP4 for the whole catalog, orbit tracks and conjunction screening. */
'use strict';
importScripts('../space/lib/satellite.min.js', '../space/lib/orbit.js');
const O = self.SpaceOrbit, S = self.satellite;
let recs = [];          // satrecs, index-aligned with the catalog rows (null when SGP4 cannot initialise)
let perigee, apogee;    // km, from mean elements

function ommFromRow(r, F) {
    return {
        OBJECT_NAME: r[F.name], OBJECT_ID: r[F.intl], EPOCH: r[F.epoch], MEAN_MOTION: r[F.n], ECCENTRICITY: r[F.e], INCLINATION: r[F.i],
        RA_OF_ASC_NODE: r[F.raan], ARG_OF_PERICENTER: r[F.argp], MEAN_ANOMALY: r[F.M], EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
        NORAD_CAT_ID: r[F.id], ELEMENT_SET_NO: 999, REV_AT_EPOCH: r[F.rev] || 0, BSTAR: r[F.bstar], MEAN_MOTION_DOT: r[F.ndot], MEAN_MOTION_DDOT: r[F.nddot]
    };
}

function load(rows, fields) {
    const F = Object.fromEntries(fields.map((f, i) => [f, i]));
    recs = new Array(rows.length); perigee = new Float32Array(rows.length); apogee = new Float32Array(rows.length);
    let bad = 0;
    for (let k = 0; k < rows.length; k++) {
        try {
            const s = S.json2satrec(ommFromRow(rows[k], F));
            if (s.error) throw new Error();
            recs[k] = s;
            const a = Math.pow(O.MU / (s.no / 60) ** 2, 1 / 3);
            perigee[k] = a * (1 - s.ecco) - O.RE; apogee[k] = a * (1 + s.ecco) - O.RE;
        } catch (err) { recs[k] = null; bad++; perigee[k] = apogee[k] = NaN; }
    }
    return bad;
}

function positions(timeMs) {
    const n = recs.length, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const date = new Date(timeMs);
    let fail = 0;
    for (let k = 0; k < n; k++) {
        const s = recs[k];
        const pv = s ? S.propagate(s, date) : null;
        if (!pv) { pos[3 * k] = pos[3 * k + 1] = pos[3 * k + 2] = NaN; fail++; continue; }
        pos[3 * k] = pv.position.x; pos[3 * k + 1] = pv.position.y; pos[3 * k + 2] = pv.position.z;
        vel[3 * k] = pv.velocity.x; vel[3 * k + 1] = pv.velocity.y; vel[3 * k + 2] = pv.velocity.z;
    }
    return { pos, vel, fail };
}

function trackOf(satrec, t0, periods = 1, n = 240) {
    const P = 2 * Math.PI / satrec.no * 60e3 * periods;   // ms
    const out = new Float32Array((n + 1) * 3);
    let m = 0;
    for (let k = 0; k <= n; k++) {
        const pv = S.propagate(satrec, new Date(t0 + P * k / n));
        if (!pv) break;
        out[3 * m] = pv.position.x; out[3 * m + 1] = pv.position.y; out[3 * m + 2] = pv.position.z; m++;
    }
    return out.slice(0, m * 3);
}

/* ---------------------------------------------------------------- conjunction screening */
function hermite(p0, v0, p1, v1, h, s, out) {
    const s2 = s * s, s3 = s2 * s;
    const a = 2 * s3 - 3 * s2 + 1, b = s3 - 2 * s2 + s, c = -2 * s3 + 3 * s2, d = s3 - s2;
    for (let i = 0; i < 3; i++) out[i] = a * p0[i] + b * h * v0[i] + c * p1[i] + d * h * v1[i];
    return out;
}
function nodes(satrec, times, count) {
    const P = new Float64Array(count * 3), V = new Float64Array(count * 3);
    let valid = count;
    for (let k = 0; k < count; k++) {
        const pv = S.sgp4(satrec, (times[k] - satrec.jdsatepoch) * 1440);
        if (!pv) { valid = k; break; }
        P[3 * k] = pv.position.x; P[3 * k + 1] = pv.position.y; P[3 * k + 2] = pv.position.z;
        V[3 * k] = pv.velocity.x; V[3 * k + 1] = pv.velocity.y; V[3 * k + 2] = pv.velocity.z;
    }
    return { P, V, valid };
}
function exactDistance(a, b, tMs) {
    const d = new Date(tMs), pa = S.propagate(a, d), pb = S.propagate(b, d);
    if (!pa || !pb) return null;
    const dr = [pb.position.x - pa.position.x, pb.position.y - pa.position.y, pb.position.z - pa.position.z];
    const dv = [pb.velocity.x - pa.velocity.x, pb.velocity.y - pa.velocity.y, pb.velocity.z - pa.velocity.z];
    return { d: Math.hypot(...dr), dr, dv, pa, pb };
}
function refine(a, b, t0, t1) {
    // golden-section on exact SGP4 distance
    const g = 0.6180339887;
    let x0 = t0, x3 = t1, x1 = x3 - g * (x3 - x0), x2 = x0 + g * (x3 - x0);
    let f1 = exactDistance(a, b, x1), f2 = exactDistance(a, b, x2);
    if (!f1 || !f2) return null;
    for (let k = 0; k < 40 && x3 - x0 > 2; k++) {
        if (f1.d < f2.d) { x3 = x2; x2 = x1; f2 = f1; x1 = x3 - g * (x3 - x0); f1 = exactDistance(a, b, x1); }
        else { x0 = x1; x1 = x2; f1 = f2; x2 = x0 + g * (x3 - x0); f2 = exactDistance(a, b, x2); }
        if (!f1 || !f2) return null;
    }
    const t = f1.d < f2.d ? x1 : x2, r = f1.d < f2.d ? f1 : f2;
    return { t, ...r };
}
function ric(pa, dr) {
    const r = [pa.position.x, pa.position.y, pa.position.z], v = [pa.velocity.x, pa.velocity.y, pa.velocity.z];
    const nr = Math.hypot(...r), R = r.map(x => x / nr);
    const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], nh = Math.hypot(...h), C = h.map(x => x / nh);
    const I = [C[1] * R[2] - C[2] * R[1], C[2] * R[0] - C[0] * R[2], C[0] * R[1] - C[1] * R[0]];
    const dotp = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    return { r: dotp(dr, R), i: dotp(dr, I), c: dotp(dr, C) };
}

function screen(msg, post) {
    const primary = O.satrecFromSource(msg.source);
    const t0 = msg.start, hours = msg.hours, thr = msg.threshold, step = 120, sub = 12;
    const count = Math.floor(hours * 3600 / step) + 1;
    const times = Float64Array.from({ length: count }, (_, k) => S.jday(new Date(t0 + k * step * 1000)));
    const prim = nodes(primary, times, count);
    if (prim.valid < 2) throw new Error('The primary orbit cannot be propagated over this window.');
    const el = O.elementsOf(primary), pad = thr + 25;
    const skip = new Set(msg.exclude || []);
    const cand = [];
    for (let k = 0; k < recs.length; k++) {
        if (!recs[k] || skip.has(+recs[k].satnum)) continue;
        if (perigee[k] - pad > el.apogee || apogee[k] + pad < el.perigee) continue;
        cand.push(k);
    }
    post({ type: 'screen-progress', id: msg.id, frac: 0, candidates: cand.length });
    const events = [];
    const a = [0, 0, 0], b = [0, 0, 0], pa0 = [0, 0, 0], va0 = [0, 0, 0], pa1 = [0, 0, 0], va1 = [0, 0, 0], pb0 = [0, 0, 0], vb0 = [0, 0, 0], pb1 = [0, 0, 0], vb1 = [0, 0, 0];
    const period = 2 * Math.PI / primary.no * 60;   // s
    const gateSq = (thr + 15 * step / sub) ** 2;      // max relative motion between sub-samples
    const rejectSq = (thr + 16 * step * 1.05 + 50) ** 2;
    for (let c = 0; c < cand.length; c++) {
        const k = cand[c], s = recs[k];
        const sec = nodes(s, times, prim.valid);
        const n = Math.min(prim.valid, sec.valid);
        let best = null;
        const found = [];
        for (let j = 0; j < n - 1; j++) {
            // cheap reject: both node distances large and cannot close within one step
            const dx0 = sec.P[3 * j] - prim.P[3 * j], dy0 = sec.P[3 * j + 1] - prim.P[3 * j + 1], dz0 = sec.P[3 * j + 2] - prim.P[3 * j + 2];
            if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > rejectSq) {
                const dx1 = sec.P[3 * j + 3] - prim.P[3 * j + 3], dy1 = sec.P[3 * j + 4] - prim.P[3 * j + 4], dz1 = sec.P[3 * j + 5] - prim.P[3 * j + 5];
                if (dx1 * dx1 + dy1 * dy1 + dz1 * dz1 > rejectSq) continue;
            }
            for (let i = 0; i < 3; i++) { pa0[i] = prim.P[3 * j + i]; va0[i] = prim.V[3 * j + i]; pa1[i] = prim.P[3 * j + 3 + i]; va1[i] = prim.V[3 * j + 3 + i]; pb0[i] = sec.P[3 * j + i]; vb0[i] = sec.V[3 * j + i]; pb1[i] = sec.P[3 * j + 3 + i]; vb1[i] = sec.V[3 * j + 3 + i]; }
            let md = Infinity, ms = 0;
            for (let q = 0; q <= sub; q++) {
                const sq = q / sub;
                hermite(pa0, va0, pa1, va1, step, sq, a); hermite(pb0, vb0, pb1, vb1, step, sq, b);
                const d = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2;
                if (d < md) { md = d; ms = sq; }
            }
            if (md < gateSq) {
                const tc = t0 + (j + ms) * step * 1000, half = step / sub * 1000;
                const r = refine(primary, s, Math.max(t0, tc - half), Math.min(t0 + hours * 3600e3, tc + half));
                if (r && r.d <= thr) found.push(r);
            }
        }
        // keep separate encounters (more than a quarter period apart), closest first
        found.sort((x, y) => x.d - y.d);
        const kept = [];
        for (const f of found) if (!kept.some(g => Math.abs(g.t - f.t) < period * 250)) kept.push(f);
        for (const f of kept) events.push({ index: k, norad: +s.satnum, tca: f.t, miss: f.d, vrel: Math.hypot(...f.dv), ric: ric(f.pa, f.dr) });
        if (c % 200 === 0) post({ type: 'screen-progress', id: msg.id, frac: c / cand.length, candidates: cand.length });
    }
    events.sort((x, y) => x.miss - y.miss);
    return { events: events.slice(0, 500), candidates: cand.length, windowEnd: t0 + (prim.valid - 1) * step * 1000, truncated: prim.valid < count };
}

self.onmessage = e => {
    const m = e.data;
    try {
        if (m.type === 'load') {
            const bad = load(m.rows, m.fields);
            self.postMessage({ type: 'loaded', bad, perigee, apogee });
        } else if (m.type === 'positions') {
            const r = positions(m.time);
            self.postMessage({ type: 'positions', time: m.time, pos: r.pos, vel: r.vel, fail: r.fail }, [r.pos.buffer, r.vel.buffer]);
        } else if (m.type === 'track') {
            const s = m.source ? O.satrecFromSource(m.source) : recs[m.index];
            if (!s) throw new Error('No elements for this object.');
            const pts = trackOf(s, m.time, m.periods || 1, m.n || 240);
            self.postMessage({ type: 'track', id: m.id, points: pts }, [pts.buffer]);
        } else if (m.type === 'tracks') {
            const out = [];
            for (const k of m.indices) { const s = recs[k]; if (s) out.push(trackOf(s, m.time, 1, 120)); }
            self.postMessage({ type: 'tracks', id: m.id, tracks: out }, out.map(t => t.buffer));
        } else if (m.type === 'state') {
            const s = m.source ? O.satrecFromSource(m.source) : recs[m.index];
            const pv = s ? S.propagate(s, new Date(m.time)) : null;
            self.postMessage({ type: 'state', id: m.id, pv: pv ? { position: pv.position, velocity: pv.velocity } : null });
        } else if (m.type === 'screen') {
            const r = screen(m, x => self.postMessage(x));
            self.postMessage({ type: 'screen', id: m.id, ...r });
        }
    } catch (err) { self.postMessage({ type: 'error', id: m.id, what: m.type, error: err.message }); }
};
