/* Trapped-radiation model for the Van Allen belt tool.
 *
 *  1. Field:  geodetic (lat, lon, h) -> McIlwain L and B/B0, trilinear interpolation of a
 *             grid tabulated from IGRF/DGRF with radbelt (SHELLG).
 *  2. Flux:   (L, B/B0, E) -> NASA AE8/AP8 omnidirectional integral flux, bilinear in
 *             (L, log B/B0) of log10 flux on node tables tabulated with radbelt.
 *  3. Dose:   orbit-averaged spectra -> dose in silicon behind aluminium, straight-ahead
 *             continuous-slowing-down approximation (CSDA) with NIST PSTAR/ESTAR, plus an
 *             approximate thick-target bremsstrahlung term reported separately.
 *
 * Runs in a page, a Web Worker, or Node. No network access of its own. */
(function (root) {
    'use strict';
    const MEV_PER_G_TO_RAD = 1.602176634e-8;   // 1 MeV/g = 1.602e-10 Gy = 1.602e-8 rad
    const RHO_AL = 2.699;                       // g/cm^3
    const ZERO_LOG = -400;                      // log10(flux)*100 used for "no flux" nodes
    const MIN_FLUX = 1e-2;                      // below this the interpolated flux is reported as zero

    /* ------------------------------------------------------------ geomagnetic grid */
    function FieldGrid(meta, buffer) {
        const u = new Uint16Array(buffer);
        this.year = meta.year;
        this.lat0 = meta.lats[0]; this.dlat = meta.lats[1] - meta.lats[0]; this.nlat = meta.lats.length;
        this.lon0 = meta.lons[0]; this.dlon = meta.lons[1] - meta.lons[0]; this.nlon = meta.lons.length;
        this.alts = Float64Array.from(meta.alts_km); this.nalt = this.alts.length;
        const N = this.nalt * this.nlat * this.nlon;
        if (u.length !== 2 * N) throw new Error('Field grid size does not match its axes.');
        this.L = u.subarray(0, N); this.B = u.subarray(N, 2 * N);
        this.hmin = this.alts[0]; this.hmax = this.alts[this.nalt - 1];
    }
    /** Returns {L, bb0, inside}; outside the tabulated heights `inside` is false. */
    FieldGrid.prototype.lookup = function (lat, lon, h, out) {
        out = out || {};
        const alts = this.alts;
        if (!(h <= this.hmax)) { out.L = 99; out.bb0 = 1e6; out.inside = false; return out; }
        let hh = h < this.hmin ? this.hmin : h;
        let lo = 0, hi = this.nalt - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (alts[m] <= hh) lo = m; else hi = m; }
        const ta = (hh - alts[lo]) / (alts[hi] - alts[lo]);
        let fy = (lat - this.lat0) / this.dlat;
        if (fy < 0) fy = 0; if (fy > this.nlat - 1.000001) fy = this.nlat - 1.000001;
        const iy = Math.floor(fy), ty = fy - iy;
        let fx = (lon - this.lon0) / this.dlon;
        fx = ((fx % this.nlon) + this.nlon) % this.nlon;
        const ix = Math.floor(fx), tx = fx - ix, ix2 = (ix + 1) % this.nlon;
        const nl = this.nlon, plane = this.nlat * nl;
        const L = this.L, B = this.B;
        let sL = 0, sB = 0;
        for (let k = 0; k < 2; k++) {
            const wa = k ? ta : 1 - ta, base = (k ? hi : lo) * plane;
            const r0 = base + iy * nl, r1 = r0 + nl;
            const w00 = wa * (1 - ty) * (1 - tx), w01 = wa * (1 - ty) * tx, w10 = wa * ty * (1 - tx), w11 = wa * ty * tx;
            sL += w00 * L[r0 + ix] + w01 * L[r0 + ix2] + w10 * L[r1 + ix] + w11 * L[r1 + ix2];
            sB += w00 * B[r0 + ix] + w01 * B[r0 + ix2] + w10 * B[r1 + ix] + w11 * B[r1 + ix2];
        }
        out.L = sL / 1000; out.bb0 = Math.pow(10, sB / 10000); out.inside = true;
        return out;
    };

    /* ------------------------------------------------------------ AE8 / AP8 tables
     * For each energy E and L node the table holds the cutoff log10(B/B0) where trapped
     * flux ends, and log10 flux on normalised nodes u = log(B/B0)/log(cutoff) in [0, 1].
     * Interpolating at fixed u between L nodes follows the cutoff as it moves with L
     * (the approach of the models' own TRARA routine). */
    function TrappedModel(doc) {
        this.Lnodes = Float64Array.from(doc.L);
        this.nL = this.Lnodes.length;
        this.nU = doc.u.length;
        this.energies = { e: doc.energies.e.slice(), p: doc.energies.p.slice() };
        this.source = doc.source;
        this.tables = {}; this.cuts = {};
        for (const key of Object.keys(doc.models)) {
            const part = key[0], nE = this.energies[part].length, m = doc.models[key];
            const t = new Int16Array(nE * this.nL * this.nU).fill(ZERO_LOG);
            for (let r = 0; r < m.rows.length; r++) {
                const row = m.rows[r], off = r * this.nU;
                for (let j = 0; j < row.length; j++) t[off + j] = Math.max(row[j], ZERO_LOG);
            }
            this.tables[key] = t;
            this.cuts[key] = Float32Array.from(m.cut, v => v / 10000);
        }
    }
    /** Interpolation weights for (L, B/B0), or null where AE8/AP8 hold no trapped flux. */
    TrappedModel.prototype.weights = function (L, bb0, w) {
        const n = this.Lnodes;
        if (!(L >= n[0]) || L > n[this.nL - 1] || !(bb0 >= 1)) return null;
        let lo = 0, hi = this.nL - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (n[m] <= L) lo = m; else hi = m; }
        w = w || {};
        w.iL = lo; w.tL = (L - n[lo]) / (n[hi] - n[lo]); w.lb = Math.log10(bb0);
        return w;
    };
    /** Integral flux above every tabulated energy for `key` ('e_min', 'p_max', ...), written to out. */
    TrappedModel.prototype.spectrum = function (key, w, out) {
        const t = this.tables[key], cut = this.cuts[key], nE = this.energies[key[0]].length, nL = this.nL, nU = this.nU;
        if (!w) { for (let e = 0; e < nE; e++) out[e] = 0; return out; }
        const iL = w.iL, tL = w.tL, lb = w.lb;
        for (let e = 0; e < nE; e++) {
            const r0 = e * nL + iL, c0 = cut[r0], c1 = cut[r0 + 1];
            const lbc = (1 - tL) * c0 + tL * c1;
            if (!(lbc > 0) || lb > lbc) { out[e] = 0; continue; }
            const u = lb / lbc;
            let f = (1 - Math.sqrt(1 - u)) * (nU - 1);
            if (f > nU - 1.000001) f = nU - 1.000001;
            const j = Math.floor(f), tu = f - j;
            const a = r0 * nU + j, b = a + nU;
            const v0 = c0 > 0 ? t[a] + (t[a + 1] - t[a]) * tu : ZERO_LOG;
            const v1 = c1 > 0 ? t[b] + (t[b + 1] - t[b]) * tu : ZERO_LOG;
            const flux = Math.pow(10, ((1 - tL) * v0 + tL * v1) / 100);
            out[e] = flux < MIN_FLUX ? 0 : flux;
        }
        return out;
    };
    /** Integral flux above an arbitrary energy. Like AE8/AP8 themselves, log10(flux) is
     *  interpolated linearly in energy between tabulated energies. */
    function fluxAbove(energies, spec, E) {
        if (E <= energies[0]) return spec[0];
        const n = energies.length;
        if (E > energies[n - 1]) return 0;
        let i = 1; while (energies[i] < E) i++;
        const f0 = spec[i - 1], f1 = spec[i];
        if (f0 <= 0) return 0;
        const t = (E - energies[i - 1]) / (energies[i] - energies[i - 1]);
        if (f1 <= 0) return f0 * Math.pow(1 - t, 4);
        return f0 * Math.pow(f1 / f0, t);
    }

    /* ------------------------------------------------------------ dose */
    function LogTable(x, y) {
        this.lx = Float64Array.from(x, Math.log); this.ly = Float64Array.from(y, v => Math.log(Math.max(v, 1e-300)));
    }
    LogTable.prototype.at = function (v) {
        const lx = this.lx, ly = this.ly, n = lx.length, l = Math.log(v);
        if (l <= lx[0]) return Math.exp(ly[0] + (ly[1] - ly[0]) / (lx[1] - lx[0]) * (l - lx[0]));
        if (l >= lx[n - 1]) return Math.exp(ly[n - 1]);
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lx[m] <= l) lo = m; else hi = m; }
        return Math.exp(ly[lo] + (ly[hi] - ly[lo]) * (l - lx[lo]) / (lx[hi] - lx[lo]));
    };

    /* Photon mass attenuation and energy-absorption coefficients (cm^2/g), Hubbell & Seltzer
     * (NIST X-ray attenuation tables), used only for the approximate bremsstrahlung term. */
    const PHOTON = {
        E: [0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8],
        muAl: [26.23, 7.955, 3.441, 1.128, 0.5685, 0.3681, 0.2778, 0.2018, 0.1704, 0.1378, 0.1223, 0.1042, 0.09276, 0.08445, 0.07802, 0.06841, 0.06146, 0.05496, 0.05006, 0.04324, 0.03541, 0.03106, 0.02836, 0.02655, 0.02437],
        muenSi: [33.29, 9.794, 4.076, 1.164, 0.4782, 0.243, 0.1434, 0.06896, 0.04513, 0.03086, 0.02905, 0.02932, 0.02968, 0.02971, 0.02951, 0.02875, 0.02792, 0.02681, 0.0259, 0.02425, 0.02223, 0.02113, 0.02057, 0.02036, 0.02029]
    };

    function DoseModel(nist) {
        const mk = (m, part) => ({ R: new LogTable(m[part].E, m[part].R), ER: new LogTable(m[part].R, m[part].E), S: new LogTable(m[part].E, m[part].S) });
        this.Al = { p: mk(nist.Al, 'p'), e: mk(nist.Al, 'e') };
        this.Si = { p: mk(nist.Si, 'p'), e: mk(nist.Si, 'e') };
        // Practical (extrapolated) electron range in aluminium, Katz & Penfold (1952):
        // Rp = 0.412 E^(1.265 - 0.0954 ln E) g/cm^2 for E <= 2.5 MeV, 0.530 E - 0.106 above.
        // Used as an effective range-energy relation for the nominal electron transport.
        const Ek = [], Rk = [], Sk = [];
        const rp = E => E <= 2.5 ? 0.412 * Math.pow(E, 1.265 - 0.0954 * Math.log(E)) : 0.530 * E - 0.106;
        for (let i = 0; i <= 160; i++) { const E = 0.01 * Math.pow(1000, i / 160); Ek.push(E); Rk.push(rp(E)); Sk.push(E * 1e-4 / (rp(E * 1.00005) - rp(E * 0.99995))); }
        this.AlPractical = { R: new LogTable(Ek, Rk), ER: new LogTable(Rk, Ek), S: new LogTable(Ek, Sk) };
        this.yieldAl = new LogTable(nist.Al.e.E, nist.Al.e.Y);
        this.muAl = new LogTable(PHOTON.E, PHOTON.muAl);
        this.muenSi = new LogTable(PHOTON.E, PHOTON.muenSi);
    }
    /** Piecewise power-law integral spectrum -> particles/cm^2/s in log-spaced bins (+ tail at top). */
    DoseModel.prototype.bins = function (energies, J, n) {
        n = n || 240;
        const E0 = energies[0], E1 = energies[energies.length - 1];
        const Eg = new Float64Array(n), Jg = new Float64Array(n);
        for (let i = 0; i < n; i++) { Eg[i] = E0 * Math.pow(E1 / E0, i / (n - 1)); Jg[i] = fluxAbove(energies, J, Eg[i]); }
        const E = new Float64Array(n), w = new Float64Array(n);
        for (let i = 0; i < n - 1; i++) { E[i] = Math.sqrt(Eg[i] * Eg[i + 1]); w[i] = Math.max(0, Jg[i] - Jg[i + 1]); }
        E[n - 1] = E1; w[n - 1] = Jg[n - 1];
        return { E, w };
    };
    DoseModel.prototype.residual = function (part, E, t, table) {
        const T = table || this.Al[part];
        const R = T.R.at(E) - t;
        return R > 0 ? T.ER.at(R) : 0;
    };
    /** Differential flux -dJ/dE (cm^-2 s^-1 MeV^-1) of the interpolated integral spectrum. */
    function differential(energies, J, E) {
        const n = energies.length;
        if (E < energies[0] || E > energies[n - 1]) return 0;
        let i = 1; while (i < n - 1 && energies[i] < E) i++;
        const E0 = energies[i - 1], E1 = energies[i], f0 = J[i - 1], f1 = J[i], dE = E1 - E0;
        if (f0 <= 0) return 0;
        const s = (E - E0) / dE;
        if (f1 <= 0) return 4 * f0 * Math.pow(1 - s, 3) / dE;
        const f = f0 * Math.pow(f1 / f0, s);
        return Math.max(0, -f * Math.log(f1 / f0) / dE);
    }
    const NG = 160;
    /**
     * Dose rate (MeV/g/s in Si) along one areal path t (g/cm^2 Al), full 4-pi weight.
     * Integrates over residual energy Er at the target: with R(E0) = R(Er) + t,
     * dE0 = S_Al(E0)/S_Al(Er) dEr, which keeps the Bragg region smooth at every depth.
     * Particles above the top tabulated energy are carried as a lump at that energy.
     */
    DoseModel.prototype.kernel = function (spec, part, t, table) {
        const Al = table || this.Al[part], Si = this.Si[part].S, E = spec.E, J = spec.J;
        const Emin = E[0], Emax = E[E.length - 1], Jtop = J[J.length - 1];
        const lower = part === 'p' ? 1e-3 : 1e-2;
        let sum = 0;
        const ErTop = t > 0 ? this.residual(part, Emax, t, Al) : Emax;
        if (ErTop > 0 && Jtop > 0) sum += Jtop * Si.at(ErTop);
        if (!(ErTop > lower)) return sum;
        const r0 = Math.log(lower), r1 = Math.log(ErTop), dl = (r1 - r0) / NG;
        let prev = 0;
        for (let k = 0; k <= NG; k++) {
            const Er = Math.exp(r0 + k * dl);
            const E0 = t > 0 ? Al.ER.at(Al.R.at(Er) + t) : Er;
            let g = 0;
            if (E0 >= Emin) {
                const phi = differential(E, J, Math.min(E0, Emax));
                g = phi * Si.at(Er) * (t > 0 ? Al.S.at(E0) / Al.S.at(Er) : 1) * Er;
            }
            if (k) sum += 0.5 * (g + prev) * dl;
            prev = g;
        }
        return sum;
    };
    /** Approximate bremsstrahlung dose rate (MeV/g/s in Si) from electrons stopping in t g/cm^2 Al. */
    DoseModel.prototype.brems = function (bins, t) {
        if (t <= 0) return 0;
        const NK = 10;
        let sum = 0;
        for (let i = 0; i < bins.E.length; i++) {
            const w = bins.w[i]; if (!w) continue;
            const E = bins.E[i];
            const Er = this.residual('e', E, t);
            const radiated = this.yieldAl.at(E) * E - (Er > 0 ? this.yieldAl.at(Er) * Er : 0);
            if (radiated <= 0) continue;
            const depth = Math.min(this.Al.e.R.at(E), t) / 2;      // mean emission depth
            const path = Math.max(t - depth, 0);
            // thick-target (Kramers) spectrum dI/dk = c (E - k), normalised to the radiated energy;
            // half of it is emitted toward the interior.
            for (let k = 0; k < NK; k++) {
                const kk = E * (k + 0.5) / NK;
                if (kk < 0.01) continue;
                const frac = 2 * (E - kk) / (E * E) * (E / NK);
                const mu = this.muAl.at(Math.min(kk, 8)), mut = mu * path;
                sum += 0.5 * w * radiated * frac * Math.exp(-mut) * (1 + mut) * this.muenSi.at(Math.min(kk, 8));
            }
        }
        return sum;
    };
    const GL = (function () {   // 16-point Gauss-Legendre on [0, 1]
        const x = [-0.989400934991650, -0.944575023073233, -0.865631202387832, -0.755404408355003, -0.617876244402644, -0.458016777657227, -0.281603550779259, -0.095012509837637];
        const w = [0.027152459411754, 0.062253523938648, 0.095158511682493, 0.124628971255534, 0.149595988816577, 0.169156519395003, 0.182603415044924, 0.189450610455068];
        const mu = [], wt = [];
        for (let i = 0; i < 8; i++) { mu.push(0.5 * (x[i] + 1), 0.5 * (1 - x[i])); wt.push(0.5 * w[i], 0.5 * w[i]); }
        return { mu, wt };
    })();
    /**
     * Dose-depth curve. spectra = {e:{E,J}, p:{E,J}} orbit-averaged integral spectra (cm^-2 s^-1).
     * thicknessMm: aluminium thicknesses. geometry 'sphere' (centre of solid sphere) or 'slab'
     * (one face of a semi-infinite slab, back hemisphere fully shielded). transport selects the
     * electron range model. Returns rad(Si)/s.
     */
    DoseModel.prototype.depthCurve = function (spectra, thicknessMm, geometry, transport) {
        const be = this.bins(spectra.e.E, spectra.e.J);
        // electron transport: 'practical' (nominal), 'csda' (upper bound), 'detour' (CSDA path x 1.6)
        transport = transport || 'practical';
        const ef = typeof transport === 'number' ? transport : transport === 'detour' ? 1.6 : 1;
        const eTable = transport === 'practical' ? this.AlPractical : null;
        const out = { mm: thicknessMm.slice(), e: [], p: [], b: [], total: [] };
        for (const mm of thicknessMm) {
            const t = mm * 0.1 * RHO_AL;
            let e = 0, p = 0, b = 0;
            if (geometry === 'slab') {
                for (let k = 0; k < GL.mu.length; k++) {
                    const path = t / GL.mu[k], wk = 0.5 * GL.wt[k];
                    e += wk * this.kernel(spectra.e, 'e', path * ef, eTable);
                    p += wk * this.kernel(spectra.p, 'p', path);
                    b += wk * this.brems(be, path);
                }
            } else {
                e = this.kernel(spectra.e, 'e', t * ef, eTable); p = this.kernel(spectra.p, 'p', t); b = this.brems(be, t);
            }
            out.e.push(e * MEV_PER_G_TO_RAD); out.p.push(p * MEV_PER_G_TO_RAD); out.b.push(b * MEV_PER_G_TO_RAD);
            out.total.push((e + p + b) * MEV_PER_G_TO_RAD);
        }
        return out;
    };

    const api = { FieldGrid, TrappedModel, DoseModel, fluxAbove, RHO_AL, MEV_PER_G_TO_RAD, PHOTON };
    root.SpaceRad = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
