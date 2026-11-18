// Space tools: model accuracy, dose validation, orbit input and debris screening.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { vanAllen, loadWorker, root } = require('./space-harness.cjs');
const R = require('../space/lib/radiation.js');
const O = require('../space/lib/orbit.js');
const D = require('../space/lib/debris-env.js');
require('../space/lib/ui.js');
const U = globalThis.SpaceUI;

const data = f => path.join(root, 'space/data', f);
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };

test('field grid and AE8/AP8 tables reproduce direct radbelt calls', () => {
    const meta = JSON.parse(fs.readFileSync(data('field.json')));
    const buf = fs.readFileSync(data('field-1970.bin'));
    const field = new R.FieldGrid({ ...meta, year: 1970 }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const model = new R.TrappedModel(JSON.parse(fs.readFileSync(data('ae8ap8.json'))));
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/radiation-reference.json'), 'utf8'));
    const errL = [], errF = [];
    for (const p of fx.points) {
        const f = field.lookup(p.lat, p.lon, p.h);
        if (p.L < 12) errL.push(Math.abs(f.L / p.L - 1));
        const w = model.weights(f.L, f.bb0, {});
        for (const key of Object.keys(p.flux)) {
            const part = key[0], spec = model.spectrum(key, w, new Float64Array(model.energies[part].length));
            fx.energies[part].forEach((E, j) => {
                const ref = p.flux[key][j], got = R.fluxAbove(model.energies[part], spec, E);
                if (ref > 100) { assert(got > 0, `${key} ${E} MeV flux missing at L=${p.L.toFixed(2)}`); errF.push(Math.abs(Math.log10(got / ref))); }
            });
        }
    }
    assert(quantile(errL, 0.5) < 0.003, 'median L error');
    assert(quantile(errF, 0.5) < 0.012, `median flux error ${quantile(errF, 0.5)}`);
    assert(quantile(errF, 0.9) < 0.06, `90th percentile flux error ${quantile(errF, 0.9)}`);
});

test('orbit analysis reproduces CREME96 proton dose and stays physically consistent', () => {
    const run = vanAllen();
    const el = (key, hp, ha, inc) => ({ key, source: { kind: 'elements', name: key, epoch: '2026-01-01T00:00:00Z', perigee: hp, apogee: ha, inc, raan: 0, argp: 0, ma: 0, bstar: 0 } });
    const res = run([el('ref', 1000, 1000, 35), el('gto', 250, 35786, 27)], { solar: 'min', samples: 40000 });
    const dose = new R.DoseModel(JSON.parse(fs.readFileSync(data('nist.json'))));
    const yr = 365.25 * 86400;
    const p = dose.depthCurve(res.ref.spectra, [82, 232, 457].map(m => m * 0.0254), 'sphere', 'csda').p.map(v => v * yr);
    [3746, 2576, 1950].forEach((creme, i) => assert(Math.abs(p[i] / creme - 1) < 0.08, `CREME96 ${creme} rad/yr vs ${p[i].toFixed(0)}`));
    for (const r of Object.values(res)) {
        for (let i = 1; i < r.dose.total.length; i++) assert(r.dose.total[i] <= r.dose.total[i - 1] * 1.0001, 'dose falls with shielding');
        for (let i = 1; i < r.cum.e.length; i++) assert(r.cum.e[i] >= r.cum.e[i - 1] && r.cum.p[i] >= r.cum.p[i - 1], 'fluence accumulates');
        for (let i = 0; i < r.dose.e.length; i++) assert(r.dose.eLo[i] <= r.dose.e[i] * 1.0001 && r.dose.e[i] <= r.dose.eHi[i] * 1.0001, 'nominal electron dose lies in its band');
    }
    assert(res.gto.fluence.e > 100 * res.ref.fluence.e, 'GTO crosses the outer electron belt');
});

test('typed elements and TLE text round-trip through SGP4', () => {
    const el = { name: 'TEST', epoch: new Date('2026-11-18T06:00:00Z'), perigee: 550, apogee: 900, inc: 63.4, raan: 120, argp: 270, ma: 10, bstar: 1.5e-4 };
    const a = O.elementsOf(O.satrecFromElements(el));
    assert(Math.abs(a.perigee - 550) < 0.5 && Math.abs(a.apogee - 900) < 0.5 && Math.abs(a.inc - 63.4) < 1e-6);
    const tle = O.toTLE(a, 'TEST');
    const { sets, errors } = O.parseTLE(tle);
    assert.equal(errors.length, 0); assert.equal(sets.length, 1); assert.deepEqual(sets[0].warnings, []);
    const b = O.elementsOf(sets[0].satrec);
    assert(Math.abs(b.a - a.a) < 0.01 && Math.abs(b.e - a.e) < 1e-6 && Math.abs(b.raan - a.raan) < 1e-3);
    const bad = O.parseTLE(tle.replace(/\d$/, d => String((+d + 1) % 10)));
    assert(bad.sets[0].warnings.some(w => /checksum/.test(w)), 'checksum errors are reported');
});

test('orbit handoffs preserve original elements and an independent analysis time', () => {
    const epoch = new Date('2026-10-23T00:00:00Z');
    const time = Date.parse('2026-10-24T12:34:56.789Z');
    const elements = { ...U.presetSource('gto', epoch), name: 'Orbíte de transfert' };
    const [name, line1, line2] = O.toTLE(O.elementsOf(O.satrecFromSource(elements)), 'GTO').split('\n');
    const tle = { kind: 'tle', name, line1, line2 };
    const omm = {
        kind: 'omm', name: 'GTO',
        omm: { EPOCH: epoch.toISOString(), MEAN_MOTION: 2.28, ECCENTRICITY: 0.72, INCLINATION: 27,
            RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 178, MEAN_ANOMALY: 0, NORAD_CAT_ID: 99999 }
    };
    for (const source of [elements, tle, omm]) {
        const href = new URL(U.orbitLink('../van-allen/', source, time), 'https://example.com/debris/');
        assert.deepEqual(U.readOrbitLink(href.hash), { source, time });
    }

    const example = U.readOrbitLink('#preset=gto&time=2026-10-23T00:00:00Z');
    assert.deepEqual(example, { source: U.presetSource('gto', epoch), time: epoch.getTime() });
    for (const hash of ['#orbit=invalid&time=2026-10-23T00:00:00Z', '#preset=unknown&time=2026-10-23T00:00:00Z', '#preset=gto']) {
        assert.equal(U.readOrbitLink(hash), null);
    }

    // Existing radiation analysis links used UTF-8 JSON with unpadded URL-safe Base64.
    const savedAnalysis = { v: 1, s: { start: epoch.toISOString() }, c: [elements, tle] };
    const oldHash = Buffer.from(JSON.stringify(savedAnalysis)).toString('base64url');
    assert.equal(U.encodeLink(savedAnalysis), oldHash);
    assert.deepEqual(U.decodeLink(oldHash), savedAnalysis);
});

test('small-debris proxy keeps its ORDEM calibration and size ordering', () => {
    assert(Math.abs(D.debrisFlux('ORDEM', 400, 1e-3) / 1.6e-2 - 1) < 1e-9);
    for (const m of ['ORDEM', 'MASTER']) for (const h of [300, 800, 1400]) {
        let prev = Infinity;
        for (const d of [1e-4, 1e-3, 3e-3, 1e-2, 0.1, 1]) { const f = D.debrisFlux(m, h, d); assert(f > 0 && f < prev); prev = f; }
    }
});

test('catalog snapshot is complete and conjunction screening finds a planted approach', () => {
    const cat = JSON.parse(fs.readFileSync(data('catalog.json')));
    assert.equal(cat.rows.length, cat.metadata.count);
    assert(cat.rows.every(r => r.length === cat.fields.length));
    const F = Object.fromEntries(cat.fields.map((f, i) => [f, i]));
    const iss = cat.rows.find(r => r[F.id] === 25544);
    // a twin trailing the ISS by 0.01 deg of mean anomaly (about 1.2 km)
    const twin = iss.slice(); twin[F.id] = 99001; twin[F.name] = 'TWIN'; twin[F.M] = iss[F.M] - 0.01;
    const far = cat.rows.find(r => r[F.n] < 2);  // a high orbit, filtered out by perigee/apogee
    const w = loadWorker('debris/worker.js');
    const loaded = w.send({ type: 'load', rows: [iss, twin, far], fields: cat.fields });
    assert.equal(loaded[0].bad, 0);
    const omm = { OBJECT_NAME: 'ISS', OBJECT_ID: iss[F.intl], EPOCH: iss[F.epoch], MEAN_MOTION: iss[F.n], ECCENTRICITY: iss[F.e], INCLINATION: iss[F.i], RA_OF_ASC_NODE: iss[F.raan], ARG_OF_PERICENTER: iss[F.argp], MEAN_ANOMALY: iss[F.M], EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0, BSTAR: iss[F.bstar], MEAN_MOTION_DOT: iss[F.ndot], MEAN_MOTION_DDOT: iss[F.nddot] };
    const out = w.send({ type: 'screen', id: 1, source: { kind: 'omm', name: 'ISS', omm }, start: Date.parse(iss[F.epoch] + 'Z'), hours: 3, threshold: 5, exclude: [25544] });
    const res = out.find(m => m.type === 'screen');
    assert(res, JSON.stringify(out.find(m => m.type === 'error')));
    assert.equal(res.candidates, 1);
    assert(res.events.length >= 1 && res.events[0].norad === 99001);
    assert(res.events[0].miss > 0.5 && res.events[0].miss < 2.5, `miss ${res.events[0].miss}`);
    assert(Math.abs(res.events[0].ric.i) > Math.abs(res.events[0].ric.c), 'trailing twin separates mostly in-track');
});
