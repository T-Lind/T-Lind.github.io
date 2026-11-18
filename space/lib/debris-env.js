/* Small-particle impact environment: a screening proxy for NASA ORDEM 3.1, ESA MASTER-8
 * and NASA MEM R2, ported from skyhook's hoytape/debris_environment.py.
 *
 * Spatial densities of debris larger than 1, 3.16 and 10 mm in 50 km bins from 200 to
 * 1,500 km (reference year 2016) were read from Horstmann et al. (2021), Figs. 6-8
 * (NTRS 20210011563). Cross-sectional flux is calibrated to the ORDEM 3.1 ISS-orbit flux
 * above 1 mm in the same paper (Fig. 4); sub-millimetre and large-object tails use the
 * paper's slopes. Meteoroid flux is MEM R2 at Hubble altitude (Fig. 9), scaled for Earth
 * focusing and shielding. Reading accuracy is about +/-25%; ORDEM and MASTER differ by
 * up to a factor of 100 near 1 mm, which dominates every result. */
(function (root) {
    'use strict';
    const RE = 6378.137;
    const CENTERS = []; for (let h = 225; h < 1500; h += 50) CENTERS.push(h);
    const SPATIAL = {
        ORDEM: {
            '1': [1.2e-5, 2.8e-5, 4.7e-5, 7.0e-5, 1.15e-4, 2.1e-4, 4.0e-4, 6.5e-4, 1.0e-3, 1.6e-3, 2.7e-3, 3.3e-3, 3.6e-3, 3.3e-3, 5.5e-3, 5.8e-3, 2.0e-3, 1.65e-3, 1.4e-3, 1.3e-3, 6.2e-4, 4.7e-4, 7.5e-4, 1.3e-3, 2.2e-3, 2.5e-3],
            '3': [1.6e-8, 3.2e-8, 5.5e-8, 1.0e-7, 1.6e-7, 2.9e-7, 5.0e-7, 9.0e-7, 1.4e-6, 2.2e-6, 3.0e-6, 4.0e-6, 4.8e-6, 4.2e-6, 3.2e-6, 2.2e-6, 1.6e-6, 1.25e-6, 1.0e-6, 8.3e-7, 7.0e-7, 6.8e-7, 5.8e-7, 4.8e-7, 5.6e-7, 6.2e-7],
            '10': [3.2e-9, 6.8e-9, 9.0e-9, 1.35e-8, 2.2e-8, 3.9e-8, 6.4e-8, 9.3e-8, 1.4e-7, 2.1e-7, 3.0e-7, 3.8e-7, 4.6e-7, 4.7e-7, 3.3e-7, 2.2e-7, 1.4e-7, 1.15e-7, 7.9e-8, 6.2e-8, 5.5e-8, 6.6e-8, 5.0e-8, 5.4e-8, 8.0e-8, 1.0e-7]
        },
        MASTER: {
            '1': [1.3e-8, 2.0e-7, 1.25e-6, 2.7e-6, 4.0e-6, 7.0e-6, 8.5e-6, 1.0e-5, 1.2e-5, 1.85e-5, 2.6e-5, 2.9e-5, 3.6e-5, 3.6e-5, 3.6e-5, 3.0e-5, 2.2e-5, 1.9e-5, 2.0e-5, 1.7e-5, 1.55e-5, 1.4e-5, 1.3e-5, 1.5e-5, 1.8e-5, 1.8e-5],
            '3': [9.0e-9, 1.15e-7, 2.7e-7, 5.1e-7, 5.3e-7, 8.0e-7, 1.0e-6, 1.4e-6, 2.1e-6, 3.2e-6, 3.9e-6, 5.2e-6, 5.7e-6, 5.1e-6, 3.9e-6, 3.1e-6, 2.7e-6, 2.5e-6, 2.2e-6, 2.15e-6, 2.1e-6, 1.95e-6, 1.75e-6, 1.9e-6, 2.4e-6, 2.6e-6],
            '10': [3.2e-9, 1.35e-8, 3.0e-8, 5.0e-8, 6.8e-8, 1.1e-7, 1.6e-7, 2.0e-7, 2.8e-7, 4.4e-7, 6.8e-7, 9.5e-7, 1.1e-6, 9.2e-7, 6.0e-7, 4.5e-7, 3.7e-7, 3.3e-7, 2.6e-7, 2.5e-7, 2.8e-7, 2.9e-7, 2.25e-7, 2.45e-7, 3.4e-7, 4.0e-7]
        }
    };
    const SUB_MM_SLOPE = { ORDEM: 2.4, MASTER: 3.5 };
    const BIG_SLOPES = [[0.10, 1.4], [1.0, 0.4], [30.0, 2.0]];   // cumulative slopes 1-10 cm, 10 cm-1 m, > 1 m
    const ISS_FLUX_1MM = 1.6e-2;                                // ORDEM 3.1, >1 mm, ISS orbit, /m^2/yr
    const MEM_POINTS = [[1.2e-4, 7.5], [2.6e-4, 0.8], [5.7e-4, 0.055], [1.25e-3, 3.3e-3]];
    const MEM_REF_ALT = 560;
    const H_MIN = 200, H_MAX = 1500;

    function altInterp(table, h) {
        const x = Math.min(CENTERS[CENTERS.length - 1], Math.max(CENTERS[0], h));
        let i = 1; while (i < CENTERS.length - 1 && CENTERS[i] < x) i++;
        const t = (x - CENTERS[i - 1]) / (CENTERS[i] - CENTERS[i - 1]);
        return Math.exp(Math.log(table[i - 1]) * (1 - t) + Math.log(table[i]) * t);
    }
    const CALIBRATION = ISS_FLUX_1MM / altInterp(SPATIAL.ORDEM['1'], 400);

    /** Cumulative cross-sectional debris flux above diameter d (m) at altitude h (km), /m^2/yr. */
    function debrisFlux(model, h, d) {
        const tab = SPATIAL[model];
        const n1 = altInterp(tab['1'], h), n3 = altInterp(tab['3'], h), n10 = altInterp(tab['10'], h);
        const ld = Math.log10(Math.max(d, 1e-6));
        let v;
        if (ld < -3) v = n1 * 10 ** (-SUB_MM_SLOPE[model] * (ld + 3));
        else if (ld < -2.5) { const f = (ld + 3) / 0.5; v = Math.exp(Math.log(n1) * (1 - f) + Math.log(n3) * f); }
        else if (ld < -2) { const f = (ld + 2.5) / 0.5; v = Math.exp(Math.log(n3) * (1 - f) + Math.log(n10) * f); }
        else {
            v = n10; let lo = -2;
            for (const [top, k] of BIG_SLOPES) { const t = Math.log10(top); const seg = Math.min(Math.max(ld, lo), t) - lo; v *= 10 ** (-k * seg); lo = t; }
        }
        return v * CALIBRATION;
    }
    function earthFactor(h) {
        const r = RE + h, focus = 1 + RE / r, shield = (1 + Math.sqrt(Math.max(0, 1 - ((RE + 100) / r) ** 2))) / 2;
        return focus * shield;
    }
    /** MEM R2-like cumulative meteoroid flux above d (m), /m^2/yr. */
    function meteoroidFlux(h, d) {
        const x = MEM_POINTS.map(p => Math.log10(p[0])), y = MEM_POINTS.map(p => Math.log10(p[1]));
        const ld = Math.log10(Math.max(d, 1e-6));
        let v;
        if (ld > -1.5) return 0;
        if (ld < x[0]) v = y[0] + (y[1] - y[0]) / (x[1] - x[0]) * (ld - x[0]);
        else if (ld > x[3]) v = y[3] + (y[3] - y[2]) / (x[3] - x[2]) * (ld - x[3]);
        else { let i = 1; while (x[i] < ld) i++; v = y[i - 1] + (y[i] - y[i - 1]) * (ld - x[i - 1]) / (x[i] - x[i - 1]); }
        return 10 ** v * earthFactor(h) / earthFactor(MEM_REF_ALT);
    }
    /** Mean relative impact speed over circular speed for LEO debris (51.6 deg observer proxy). */
    const VREL_OVER_VCIRC = 1.1638;

    const api = { debrisFlux, meteoroidFlux, H_MIN, H_MAX, VREL_OVER_VCIRC, source: 'Horstmann et al. 2021, NASA NTRS 20210011563 (digitized; skyhook R7 proxy)' };
    root.DebrisEnv = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
