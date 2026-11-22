const { test } = require('node:test');
const assert = require('node:assert/strict');
const Orbit = require('../space/lib/orbit.js');
const D = require('../rf-link/dsp.js');
const G = require('../rf-link/geometry.js');
const B = require('../rf-link/budget.js');
const { loadWorker } = require('./space-harness.cjs');

const epoch = new Date(Date.UTC(2026, 10, 21));
const sso = Orbit.satrecFromElements({ ...Orbit.PRESETS.find(p => p.id === 'sso800'), epoch });
const payload = (() => { const r = D.rng(7); return Uint8Array.from({ length: 6000 }, () => Math.floor(r() * 256)); })();

/** Static channel: constant range and Es/N0 for the whole transmission. */
function staticRun(o, esn0, extra = {}) {
    const plan = D.plan({ ...o, payloadBytes: payload.length });
    const n = 6, h = plan.seconds / (n - 2);
    const knots = { t0: 0, h, dR: Array(n).fill(0), dRdot: Array(n).fill(0), dRh: null, dRhdot: null, esn0: Array(n).fill(esn0), ...extra.knots };
    return D.simulate({ payload, seed: 5, fc: 2.2e9, carrierBnT: 0.002, searchHz: 20000, ...o, link: { knots, oscHz: 0, linewidthHz: 0, ...extra.link } });
}

test('CCSDS randomizer, CRC and Reed–Solomon match their definitions', () => {
    assert.deepEqual([...D.RANDOMIZER.slice(0, 8)], [0xFF, 0x48, 0x0E, 0xC0, 0x9A, 0x0D, 0x70, 0xBC]);
    assert.equal(D.crc16(new TextEncoder().encode('123456789')), 0x29B1);
    const r = D.rng(11);
    for (const errors of [0, 1, 8, 16, 17, 24]) {
        const data = Uint8Array.from({ length: 223 }, () => Math.floor(r() * 256)), parity = new Uint8Array(32);
        D.RS.encode(data, parity);
        const word = new Uint8Array(255); word.set(data); word.set(parity, 223);
        const sent = word.slice(), where = new Set();
        while (where.size < errors) where.add(Math.floor(r() * 255));
        for (const i of where) word[i] ^= 1 + Math.floor(r() * 255);
        const fixed = D.RS.decode(word);
        if (errors <= 16) { assert.equal(fixed, errors); assert.deepEqual(word, sent); }
        else assert.equal(fixed, -1, `${errors} errors must be reported as uncorrectable`);
    }
});

test('convolutional code decodes noiselessly and gains over uncoded BPSK', () => {
    const r = D.rng(3), bits = Uint8Array.from({ length: 20000 }, () => (r() < 0.5 ? 1 : 0));
    const coded = D.convEncode(bits);
    assert.deepEqual(D.viterbi(Float32Array.from(coded, b => 1 - 2 * b)), bits);
    // At Eb/N0 = 4 dB uncoded BPSK makes about 1.3e-2 errors; the (7, ½) code should make far fewer.
    const sigma = Math.sqrt(1 / (2 * 10 ** 0.4 * 0.5));
    const soft = Float32Array.from(coded, b => (1 - 2 * b + sigma * r.gauss()) * 2 / sigma ** 2);
    const out = D.viterbi(soft);
    let errors = 0; for (let i = 0; i < bits.length; i++) errors += out[i] ^ bits[i];
    assert(errors / bits.length < 1e-3, `decoded BER ${errors / bits.length}`);
});

test('pass geometry: range rate is the derivative of range, and SSO passes over Svalbard are frequent', () => {
    const station = G.STATIONS.find(s => s.id === 'svalbard');
    const passes = G.passes(sso, station, epoch, 1, 5);
    assert(passes.length >= 13 && passes.length <= 16, `${passes.length} passes`);
    for (const p of passes) assert(p.maxEl >= 5 && p.los > p.aos);
    const t = new Date(passes[0].aos.getTime() + 120000);
    const a = G.look(sso, station, new Date(t - 500)), b = G.look(sso, station, new Date(+t + 500)), c = G.look(sso, station, t);
    assert(Math.abs(c.rangeRate - (b.range - a.range)) < 1e-4);
    assert(Math.abs(G.look(sso, station, passes[0].aos).el - 5) < 0.05);
});

test('link budget terms: free-space loss, rain and isoflux equalisation', () => {
    const radio = { freqMHz: 437.5, txPowerW: 1, txLossDb: 0, scAnt: 'omni', scGainDbi: 0, scPointDeg: 0, gsAnt: 'yagi', gsGainDbi: 14, gsDiameterM: 3, gsEff: 0.55,
        gsPointDeg: 0, polLossDb: 0, gsLineLossDb: 0, lnaNfDb: 1, noiseEnv: 'quiet', rainRate: 0, modulation: 'bpsk', coding: 'none', symbolRateKsps: 9.6, implLossDb: 0 };
    const b = B.compute(radio, { el: 90, range: 1000, rangeRate: 0, offNadir: 0, altitude: 1000 }, { lat: 0, alt: 0 });
    assert(Math.abs(b.fspl - 145.26) < 0.02, `FSPL ${b.fspl}`);
    assert.equal(b.rain, 0);
    assert(Math.abs(b.cn0 - b.ebn0 - 10 * Math.log10(b.rb)) < 1e-9);
    // X-band rain at 20° elevation, mid-latitude: several dB at 50 mm/h, almost nothing at S band.
    assert(B.rainLoss(8.2, 50, 20, 40, 0) > 4 && B.rainLoss(8.2, 50, 20, 40, 0) < 12);
    assert(B.rainLoss(2.2, 50, 20, 40, 0) < 0.2);
    // An isoflux antenna keeps EIRP minus path loss within a fraction of a dB from nadir to its 5° edge.
    const h = 700, iso = { ...radio, scAnt: 'isoflux', scGainDbi: 6 }, levels = [];
    for (const el of [90, 60, 30, 10, 5.5]) {
        const e = el * Math.PI / 180, R = 6378.137 + h;
        const nadir = Math.asin(6378.137 * Math.cos(e) / R), range = Math.sqrt(R * R - (6378.137 * Math.cos(e)) ** 2) - 6378.137 * Math.sin(e);
        const g = B.spacecraftGain(iso, { offNadir: nadir * 180 / Math.PI, altitude: h }).gain;
        levels.push(g - 20 * Math.log10(range));
    }
    assert(Math.max(...levels) - Math.min(...levels) < 0.3, levels.join(', '));
});

test('static channel: measured Es/N0 and bit errors agree with theory, and the image arrives intact', () => {
    const res = staticRun({ modulation: 'qpsk', coding: 'concat', symbolRate: 1e5 }, 4);
    assert.equal(res.counts.failed + res.counts.missed, 0);
    assert.deepEqual(res.image, payload);
    assert(Math.abs(res.stats.esn0Measured - 4) < 0.3, `Es/N0 ${res.stats.esn0Measured}`);
    const ratio = res.stats.chanBer / res.stats.theoryBer;
    assert(ratio > 0.85 && ratio < 1.25, `BER ratio ${ratio}`);
    const psk8 = staticRun({ modulation: '8psk', coding: 'rs', symbolRate: 1e5 }, 16);
    assert.deepEqual(psk8.image, payload);
});

test('Doppler: the receiver acquires a large offset inside its search range and misses one outside it', () => {
    // A range rate of −5 km/s at 2.2 GHz is a +36.7 kHz Doppler shift, with no pre-correction.
    const plan = D.plan({ modulation: 'bpsk', coding: 'conv', symbolRate: 1e6, payloadBytes: payload.length });
    const n = 10, h = plan.seconds / (n - 3);
    const t = Array.from({ length: n }, (_, i) => i * h);
    const knots = { t0: 0, h, dR: t.map(x => -5 * x + 0.05 * x * x), dRdot: t.map(x => -5 + 0.1 * x), dRh: null, dRhdot: null, esn0: Array(n).fill(3) };
    const wide = D.simulate({ payload, seed: 9, modulation: 'bpsk', coding: 'conv', symbolRate: 1e6, fc: 2.2e9, carrierBnT: 0.002, searchHz: 60000, link: { knots } });
    assert(wide.acquisition.found);
    assert(Math.abs(wide.acquisition.hz - wide.acquisition.truthHz) < 200, `${wide.acquisition.hz} vs ${wide.acquisition.truthHz}`);
    assert.deepEqual(wide.image, payload);
    const narrow = D.simulate({ payload, seed: 9, modulation: 'bpsk', coding: 'conv', symbolRate: 1e6, fc: 2.2e9, carrierBnT: 0.002, searchHz: 20000, link: { knots } });
    assert(!narrow.acquisition.found);
    assert.equal(narrow.counts.missed, narrow.status.length);
});

test('worker: a real UHF pass decodes, and a stale orbit prediction defeats a narrow acquisition search', () => {
    const w = loadWorker('rf-link/worker.js');
    Object.assign(w.ctx, { performance: { now: () => Date.now() }, Int8Array, Uint8Array, Uint32Array });
    const image = new Uint8Array(128 * 72 * 3).map((_, i) => (i * 31) & 255);
    assert(w.send({ type: 'payload', buffer: image.buffer }).some(m => m.type === 'ready'));
    const source = { kind: 'elements', name: 'SSO', epoch: epoch.toISOString(), perigee: 798, apogee: 802, inc: 98.6, raan: 0, argp: 0, ma: 0, bstar: 0 };
    const station = { ...G.STATIONS.find(s => s.id === 'svalbard') };
    const pass = G.passes(sso, station, epoch, 1, 5).find(p => p.maxEl > 45);
    const radio = { freqMHz: 437.5, txPowerW: 1, txLossDb: 1, scAnt: 'omni', scGainDbi: 0, scPointDeg: 0, oscPpm: 0.5, phaseNoiseDbc: -90, modulation: 'bpsk', symbolRateKsps: 4.8, coding: 'conv',
        gsAnt: 'yagi', gsGainDbi: 14, gsDiameterM: 3, gsEff: 0.55, gsPointDeg: 2, polLossDb: 3, gsLineLossDb: 0.5, lnaNfDb: 0.8, noiseEnv: 'rural', rainRate: 0, implLossDb: 1,
        precorrect: true, predErrorKm: 0, searchKHz: 1, loopHz: 30 };
    const run = r => w.send({ type: 'capture', id: 1, source, station, radio: r, time: pass.tca.getTime() - 50000, seed: 1 }).find(m => m.type === 'capture').result;
    const good = run(radio);
    assert.equal(good.counts.ok + good.counts.corrected, good.status.length);
    const stale = run({ ...radio, predErrorKm: 120 });
    assert(!stale.acquisition.found && Math.abs(stale.acquisition.truthHz) > 1000);
});

test('payloads: orbit-driven telemetry follows eclipses, and files are classified and size-limited', () => {
    const P = require('../rf-link/payloads.js');
    // Sun direction: near the March equinox the Sun sits close to +x; at the June solstice declination is ~23.4°.
    const march = G.sunDirection(new Date(Date.UTC(2026, 2, 20, 12)));
    assert(march[0] > 0.999, `equinox sun ${march}`);
    const june = G.sunDirection(new Date(Date.UTC(2026, 5, 21, 12)));
    assert(Math.abs(Math.asin(june[2]) * 180 / Math.PI - 23.44) < 0.1);
    assert.equal(G.sunlit([7000, 0, 0], [1, 0, 0]), true);
    assert.equal(G.sunlit([-7000, 0, 0], [1, 0, 0]), false);
    assert.equal(G.sunlit([-7000, 7000, 0], [1, 0, 0]), true);

    const t = P.telemetry(sso, Date.UTC(2026, 10, 21, 8, 46));
    assert.equal(t.kind, 'text');
    assert(t.bytes.length < P.LIMIT);
    const rows = new TextDecoder().decode(t.bytes).trim().split('\n').filter(l => !l.startsWith('#')).slice(1).map(l => l.split(','));
    const lit = rows.map(r => r[4] === '1');
    assert(lit.includes(true) && lit.includes(false), 'one orbit of telemetry should include sunlight and eclipse');
    // Batteries charge in sunlight and discharge in eclipse; panels are hotter in sunlight.
    const soc = rows.map(r => +r[8]), panel = rows.map(r => +r[10]);
    const lastDark = lit.lastIndexOf(false);
    assert(soc[lastDark] < soc[lit.indexOf(false) - 1], 'charge falls through eclipse');
    assert(panel[lastDark] < panel[rows.length - 1]);

    assert.equal(P.classify(new TextEncoder().encode('time,value\n1,2\n')).kind, 'text');
    assert.equal(P.classify(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1, 1])).mime, 'image/jpeg');
    assert.equal(P.classify(Uint8Array.from({ length: 300 }, (_, i) => (i * 97) & 255)).kind, 'file');
    assert.throws(() => P.fromBytes(new Uint8Array(P.LIMIT + 1), 'big.bin'), /kB/);
    assert.throws(() => P.fromBytes(new Uint8Array(0), 'empty.bin'), /empty/);
});
