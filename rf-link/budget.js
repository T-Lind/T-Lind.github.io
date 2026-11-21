/* Link budget for the RF link simulator: spacecraft and ground antennas, free-space loss, atmospheric
 * gases, rain, sky and man-made noise, receiver noise, C/N0, Eb/N0 and margin. Runs in a window, a
 * Worker or Node. All screening-level models; the Method tab lists their sources and limits. */
(function (root) {
    'use strict';
    const D = root.RFDsp || (typeof require === 'function' ? require('./dsp.js') : null);
    const DEG = Math.PI / 180, RE = 6378.137, BOLTZ = -228.6, T0 = 290;
    const C = 299792.458;

    /* Required Eb/N0 (dB) for at most 1% lost 1,115-byte frames on a static channel, measured with this
     * tool's own receiver by scripts/space/calibrate_rf_thresholds.cjs. Eb is per transfer-frame bit.
     * Each value comes from 200 frames per 0.25 dB step, so neighbouring entries carry about ±0.5 dB of
     * statistical uncertainty (BPSK and QPSK are identical in theory). Coded 8PSK is limited by blind carrier
     * acquisition and tracking near 7.5 dB Es/N0, so Reed–Solomon adds little to it. */
    const REQUIRED_EBN0 = {
        bpsk: { none: 11.75, conv: 4.25, rs: 6.25, concat: 2.75 },
        qpsk: { none: 10.5, conv: 4.5, rs: 6.25, concat: 2.5 },
        '8psk': { none: 14.5, conv: 6.5, rs: 9.5, concat: 6.75 },
        gmsk: { none: 16, conv: 11.25, rs: 10.75, concat: 9 }
    };

    /* ITU-R P.838-3 rain coefficients (horizontal and vertical) at 1–12 GHz. */
    const RAIN = [
        [1, 0.0000259, 0.9691, 0.0000308, 0.8592],
        [2, 0.0000847, 1.0664, 0.0000998, 0.9490],
        [4, 0.0001071, 1.6009, 0.0002461, 1.2476],
        [6, 0.0007056, 1.5900, 0.0004878, 1.5728],
        [7, 0.001915, 1.4810, 0.001425, 1.4745],
        [8, 0.004115, 1.3905, 0.003450, 1.3797],
        [10, 0.01217, 1.2571, 0.01129, 1.2156],
        [12, 0.02386, 1.1825, 0.02455, 1.1216]
    ];
    /** Circular-polarisation k and α at f GHz, log-interpolated in frequency. */
    function rainCoefficients(f) {
        const fc = Math.max(1, Math.min(12, f));
        let i = 0;
        while (i < RAIN.length - 2 && RAIN[i + 1][0] < fc) i++;
        const [f0, kh0, ah0, kv0, av0] = RAIN[i], [f1, kh1, ah1, kv1, av1] = RAIN[i + 1];
        const w = (Math.log(fc) - Math.log(f0)) / (Math.log(f1) - Math.log(f0));
        const li = (a, b) => Math.exp(Math.log(a) + w * (Math.log(b) - Math.log(a)));
        const kh = li(kh0, kh1), kv = li(kv0, kv1), ah = ah0 + w * (ah1 - ah0), av = av0 + w * (av1 - av0);
        const k = (kh + kv) / 2, a = (kh * ah + kv * av) / (2 * k);
        // Below 1 GHz rain attenuation is negligible; scale k with f² so it fades smoothly.
        return { k: f < 1 ? k * f * f : k, alpha: a };
    }

    /** Rain attenuation (dB) on the slant path, after the simplified ITU-R P.618 method. */
    function rainLoss(fGHz, rate, elDeg, lat, hs) {
        if (!(rate > 0) || elDeg <= 0) return 0;
        const { k, alpha } = rainCoefficients(fGHz);
        const gamma = k * rate ** alpha;
        const hr = (Math.abs(lat) <= 23 ? 5 : Math.max(0, 5 - 0.075 * (Math.abs(lat) - 23))) + 0.36;
        if (hr <= hs) return 0;
        const s = Math.sin(Math.max(elDeg, 0.5) * DEG);
        const Ls = elDeg >= 5 ? (hr - hs) / s : 2 * (hr - hs) / (Math.sqrt(s * s + 2 * (hr - hs) / 8500) + s);
        const Lg = Ls * Math.cos(elDeg * DEG), L0 = 35 * Math.exp(-0.015 * rate);
        return gamma * Ls / (1 + Lg / L0);
    }

    /** Clear-air gaseous absorption (dB): zenith value scaled by the Kasten–Young air mass. */
    function gasLoss(fGHz, elDeg) {
        const zenith = 0.033 + 0.0045 * Math.min(fGHz, 15);
        const e = Math.max(0, elDeg);
        const airmass = 1 / (Math.sin(e * DEG) + 0.50572 * (e + 6.07995) ** -1.6364);
        return zenith * airmass;
    }

    /* ITU-R P.372 median man-made noise: Fa = c − d log10(f MHz). */
    const NOISE_ENV = {
        quiet: { label: 'Quiet rural', c: 53.6, d: 28.6 },
        rural: { label: 'Rural', c: 67.2, d: 27.7 },
        residential: { label: 'Residential', c: 72.5, d: 27.7 },
        city: { label: 'City', c: 76.8, d: 27.7 }
    };
    function manMadeK(fMHz, env) {
        const e = NOISE_ENV[env] || NOISE_ENV.quiet;
        return T0 * 10 ** ((e.c - e.d * Math.log10(fMHz)) / 10);
    }
    /** Cold-sky galactic background brightness temperature (K), from the 408 MHz survey level. */
    const galacticK = fMHz => 20 * (fMHz / 408) ** -2.75;

    /** Slant range (km) from altitude h to the Earth's surface at off-nadir angle θ, or NaN past the limb. */
    function slant(h, theta) {
        const R = RE + h, s = Math.sin(theta), d = RE * RE - R * R * s * s;
        return d < 0 ? NaN : R * Math.cos(theta) - Math.sqrt(d);
    }

    /* Spacecraft antennas. θ is the angle from the antenna boresight in degrees. */
    const SC_ANTENNAS = {
        omni: { label: 'Omnidirectional (dipole / turnstile)' },
        patch: { label: 'Patch, nadir-facing' },
        isoflux: { label: 'Isoflux, nadir-facing' },
        steered: { label: 'Steered dish or horn' }
    };
    function spacecraftGain(r, geo) {
        const g0 = r.scGainDbi;
        if (r.scAnt === 'omni') return { gain: g0, theta: geo.offNadir, pointing: 0 };
        if (r.scAnt === 'patch') {
            // cos^q pattern with directivity 2(q + 1) matching the peak gain.
            const q = Math.max(0, 10 ** (g0 / 10) / 2 - 1), c = Math.cos(geo.offNadir * DEG);
            return { gain: c > 0.01 ? g0 + 10 * q * Math.log10(c) : g0 - 25, theta: geo.offNadir, pointing: 0 };
        }
        if (r.scAnt === 'isoflux') {
            // Shaped beam: gain rises toward the edge of coverage (5° ground elevation) to offset the longer
            // slant range, so received power stays nearly constant over the pass. It rolls off past the edge.
            const R = RE + geo.altitude, th = geo.offNadir * DEG;
            const edge = Math.asin(RE * Math.cos(5 * DEG) / R);
            if (th <= edge) return { gain: g0 - 20 * Math.log10(slant(geo.altitude, edge) / slant(geo.altitude, Math.max(th, 1e-4))), theta: geo.offNadir, pointing: 0 };
            return { gain: g0 - 12 * ((th - edge) / (2 * DEG)) ** 2, theta: geo.offNadir, pointing: 0 };
        }
        const bw = Math.sqrt(29000 / 10 ** (g0 / 10));
        const pointing = 12 * (r.scPointDeg / bw) ** 2;
        return { gain: g0, theta: 0, pointing, beamwidth: bw };
    }
    function groundGain(r, lambda) {
        if (r.gsAnt === 'dish') {
            const g = 10 * Math.log10(r.gsEff * (Math.PI * r.gsDiameterM / lambda) ** 2);
            const bw = 70 * lambda / r.gsDiameterM;
            return { gain: g, beamwidth: bw, pointing: 12 * (r.gsPointDeg / bw) ** 2, spill: 10 };
        }
        const g = r.gsGainDbi, bw = Math.sqrt(29000 / 10 ** (g / 10));
        return { gain: g, beamwidth: bw, pointing: 12 * (r.gsPointDeg / bw) ** 2, spill: 40 };
    }

    /** Channel symbol rate (symbols/s) → transfer-frame (information) bit rate, after sync and coding overhead. */
    function infoRate(r) { return r.symbolRateKsps * 1e3 * D.MODULATION[r.modulation].bits / D.overhead(r.coding); }
    function required(r) { return REQUIRED_EBN0[r.modulation][r.coding]; }

    /**
     * Full budget at one instant. geo: { el, range, rangeRate, offNadir, altitude } from RFGeometry.look.
     * station: { lat, alt }. Returns every term in dB unless noted.
     */
    function compute(r, geo, station) {
        const f = r.freqMHz * 1e6, fGHz = r.freqMHz / 1000, lambda = C * 1e3 / f;
        const sc = spacecraftGain(r, geo);
        const txDbw = 10 * Math.log10(r.txPowerW);
        const eirp = txDbw - r.txLossDb + sc.gain - sc.pointing;
        const fspl = 20 * Math.log10(4 * Math.PI * geo.range * 1e3 / lambda);
        const gas = gasLoss(fGHz, geo.el);
        const rain = rainLoss(fGHz, r.rainRate, geo.el, station.lat, station.alt);
        const gs = groundGain(r, lambda);
        const atten = 10 ** (-(gas + rain) / 10);
        const skyK = (2.7 + galacticK(r.freqMHz)) * atten + 275 * (1 - atten);
        const manK = manMadeK(r.freqMHz, r.noiseEnv);
        const antK = skyK + manK + gs.spill;
        const L = 10 ** (r.gsLineLossDb / 10), lnaK = T0 * (10 ** (r.lnaNfDb / 10) - 1);
        const sysK = antK / L + T0 * (1 - 1 / L) + lnaK;
        const gt = gs.gain - r.gsLineLossDb - 10 * Math.log10(sysK);
        const cn0 = eirp - fspl - gas - rain - r.polLossDb - gs.pointing + gt - BOLTZ;
        const rs = r.symbolRateKsps * 1e3, rb = infoRate(r);
        const ebn0 = cn0 - 10 * Math.log10(rb), esn0 = cn0 - 10 * Math.log10(rs);
        const req = required(r);
        return {
            txDbw, eirp, scGain: sc.gain, scTheta: sc.theta, scPointing: sc.pointing, fspl, gas, rain, pol: r.polLossDb,
            gsGain: gs.gain, gsBeamwidth: gs.beamwidth, gsPointing: gs.pointing, skyK, manK, spillK: gs.spill, antK, lnaK, sysK, gt,
            cn0, rb, rs, ebn0, esn0, required: req, impl: r.implLossDb, margin: ebn0 - req - r.implLossDb,
            doppler: -f * geo.rangeRate / C, delayMs: geo.range / C * 1e3, lambda
        };
    }

    /** Linewidth (Hz) of a Wiener phase-noise process with the given level at 1 kHz offset. */
    function linewidth(dbcAt1k) { return Math.PI * 1e6 * 10 ** (dbcAt1k / 10); }

    const api = { REQUIRED_EBN0, NOISE_ENV, SC_ANTENNAS, compute, infoRate, required, rainLoss, gasLoss, rainCoefficients, manMadeK, galacticK, linewidth, spacecraftGain, groundGain, C };
    root.RFBudget = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
