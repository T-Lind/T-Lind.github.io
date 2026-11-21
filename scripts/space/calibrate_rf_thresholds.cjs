#!/usr/bin/env node
/* Required Eb/N0 for the RF link simulator, measured with its own receiver.
 *
 * For each modulation and coding, the full transmit → channel → receive chain runs on a static channel
 * (no Doppler, no phase noise) at increasing Eb/N0 in 0.25 dB steps. The threshold is the lowest level at
 * which at most 1% of 1,115-byte transfer frames are lost (CRC failure or no sync) over at least 200 frames.
 * Eb is the energy per transfer-frame bit, so sync-marker and coding overhead count against the link.
 *
 * Usage: node scripts/space/calibrate_rf_thresholds.cjs [modulation ...]
 * Prints a JSON object to paste into rf-link/budget.js (REQUIRED_EBN0). Takes several minutes. */
'use strict';
const D = require('../../rf-link/dsp.js');

const GUESS = {
    bpsk: { none: 11.5, conv: 4.5, rs: 6.25, concat: 2.5 },
    qpsk: { none: 11, conv: 4.5, rs: 6.25, concat: 2.75 },
    '8psk': { none: 14, conv: 7, rs: 9.25, concat: 6.25 },
    gmsk: { none: 15.75, conv: 11, rs: 10.75, concat: 9.25 }
};
const payload = (() => { const r = D.rng(42); return Uint8Array.from({ length: 128 * 72 * 3 }, () => Math.floor(r() * 256)); })();

function frameLoss(modulation, coding, ebn0, runs) {
    const m = D.MODULATION[modulation].bits;
    const esn0 = ebn0 - 10 * Math.log10(D.overhead(coding) / m);
    let lost = 0, total = 0;
    for (let i = 0; i < runs; i++) {
        const plan = D.plan({ modulation, coding, symbolRate: 1e5, payloadBytes: payload.length });
        const n = 6, h = plan.seconds / (n - 2);
        const knots = { t0: 0, h, dR: Array(n).fill(0), dRdot: Array(n).fill(0), dRh: null, dRhdot: null, esn0: Array(n).fill(esn0) };
        const res = D.simulate({ payload, seed: 1000 + i * 7919, modulation, coding, symbolRate: 1e5, fc: 2e9, carrierBnT: 0.002, searchHz: 5000, link: { knots } });
        lost += res.counts.failed + res.counts.missed;
        total += plan.imageFrames;
    }
    return { lost, total };
}

const only = process.argv.slice(2);
const out = {};
for (const modulation of Object.keys(GUESS)) {
    if (only.length && !only.includes(modulation)) continue;
    out[modulation] = {};
    for (const coding of Object.keys(GUESS[modulation])) {
        let x = GUESS[modulation][coding] - 1.5, found = null;
        for (let step = 0; step < 40 && found === null; step++, x += 0.25) {
            const quick = frameLoss(modulation, coding, x, 2);
            if (quick.lost > 1) continue;                 // clearly above 1%; keep climbing
            const full = frameLoss(modulation, coding, x, 8);
            if (full.lost / full.total <= 0.01) found = x;
            process.stderr.write(`${modulation} ${coding} ${x.toFixed(2)} dB: ${full.lost}/${full.total} lost\n`);
        }
        out[modulation][coding] = found;
        process.stderr.write(`→ ${modulation} ${coding}: ${found} dB\n`);
    }
}
console.log(JSON.stringify(out, null, 1));
