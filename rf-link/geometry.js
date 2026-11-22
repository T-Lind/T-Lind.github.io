/* Ground-station geometry for the RF link simulator: look angles, range and range rate, the
 * spacecraft's off-nadir angle toward the station, and pass prediction. Uses the shared SGP4 helpers
 * (SpaceOrbit), so it runs in a window, a Worker or Node. Frames: TEME for the spacecraft, with the
 * station rotated by Greenwich mean sidereal time, as SGP4 intends. Polar motion is ignored. */
(function (root) {
    'use strict';
    const O = root.SpaceOrbit || (typeof require === 'function' ? require('../space/lib/orbit.js') : null);
    const DEG = Math.PI / 180;
    const WGS_A = 6378.137, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
    const OMEGA_E = 7.2921150e-5;     // rad/s

    /* Ground stations at well-known high-, mid- and low-latitude sites. Coordinates are approximate. */
    const STATIONS = [
        { id: 'svalbard', name: 'Svalbard, Norway', lat: 78.23, lon: 15.39, alt: 0.5 },
        { id: 'kiruna', name: 'Kiruna, Sweden', lat: 67.86, lon: 20.96, alt: 0.4 },
        { id: 'fairbanks', name: 'Fairbanks, Alaska', lat: 64.86, lon: -147.85, alt: 0.2 },
        { id: 'wallops', name: 'Wallops Island, Virginia', lat: 37.94, lon: -75.46, alt: 0.0 },
        { id: 'hartrao', name: 'Hartebeesthoek, South Africa', lat: -25.89, lon: 27.69, alt: 1.4 },
        { id: 'singapore', name: 'Singapore', lat: 1.35, lon: 103.82, alt: 0.05 }
    ];

    /** Earth-fixed position (km) of a geodetic latitude/longitude (deg) and height (km). */
    function ecef(lat, lon, alt) {
        const p = lat * DEG, l = lon * DEG, sp = Math.sin(p);
        const N = WGS_A / Math.sqrt(1 - WGS_E2 * sp * sp);
        return [(N + alt) * Math.cos(p) * Math.cos(l), (N + alt) * Math.cos(p) * Math.sin(l), (N * (1 - WGS_E2) + alt) * sp];
    }

    /** Look geometry from a station to a spacecraft at a Date. Returns null if SGP4 fails. */
    function look(satrec, station, date) {
        const pv = O.stateAt(satrec, date);
        if (!pv) return null;
        const r = pv.position, v = pv.velocity;
        const g = O.gmst(date), cg = Math.cos(g), sg = Math.sin(g);
        const e = station.ecef || (station.ecef = ecef(station.lat, station.lon, station.alt));
        const gs = [e[0] * cg - e[1] * sg, e[0] * sg + e[1] * cg, e[2]];
        const gv = [-OMEGA_E * gs[1], OMEGA_E * gs[0], 0];
        const rho = [r.x - gs[0], r.y - gs[1], r.z - gs[2]];
        const range = Math.hypot(rho[0], rho[1], rho[2]);
        const dv = [v.x - gv[0], v.y - gv[1], v.z - gv[2]];
        const rangeRate = (rho[0] * dv[0] + rho[1] * dv[1] + rho[2] * dv[2]) / range;
        const th = station.lon * DEG + g, p = station.lat * DEG;
        const up = [Math.cos(p) * Math.cos(th), Math.cos(p) * Math.sin(th), Math.sin(p)];
        const east = [-Math.sin(th), Math.cos(th), 0];
        const north = [-Math.sin(p) * Math.cos(th), -Math.sin(p) * Math.sin(th), Math.cos(p)];
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const el = Math.asin(Math.max(-1, Math.min(1, dot(rho, up) / range))) / DEG;
        let az = Math.atan2(dot(rho, east), dot(rho, north)) / DEG;
        if (az < 0) az += 360;
        const rs = Math.hypot(r.x, r.y, r.z);
        const offNadir = Math.acos(Math.max(-1, Math.min(1, (rho[0] * r.x + rho[1] * r.y + rho[2] * r.z) / (range * rs)))) / DEG;
        const geo = O.geodetic(r, g);
        return { el, az, range, rangeRate, offNadir, altitude: geo.h, lat: geo.lat, lon: geo.lon, radius: rs, speed: Math.hypot(v.x, v.y, v.z) };
    }

    /** Range rate derivative (km/s²) by central difference, for Doppler rate. */
    function rangeAccel(satrec, station, date, dt = 0.5) {
        const a = look(satrec, station, new Date(date.getTime() - dt * 1000)), b = look(satrec, station, new Date(date.getTime() + dt * 1000));
        return a && b ? (b.rangeRate - a.rangeRate) / (2 * dt) : 0;
    }

    /**
     * Passes above an elevation mask between start and start + days. Each pass:
     * { aos, los, tca, maxEl, aosAz, losAz, clippedStart, clippedEnd } with Dates.
     */
    function passes(satrec, station, start, days, mask = 5, limit = 200) {
        const t0 = start.getTime(), t1 = t0 + days * 86400000;
        const el = t => { const l = look(satrec, station, new Date(t)); return l ? l.el - mask : -90; };
        const { period } = O.elementsOf(satrec);
        const step = Math.max(5, Math.min(60, period * 60 / 120)) * 1000;
        const out = [];
        const edge = (a, b, fa) => {
            for (let i = 0; i < 40 && b - a > 200; i++) { const m = (a + b) / 2, fm = el(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; }
            return Math.round((a + b) / 2 / 1000) * 1000;
        };
        let prev = el(t0), tPrev = t0, aos = prev > 0 ? t0 : null;
        for (let t = t0 + step; t <= t1 + step && out.length < limit; t += step) {
            const tt = Math.min(t, t1), cur = el(tt);
            if (prev <= 0 && cur > 0) aos = edge(tPrev, tt, prev);
            if (prev > 0 && cur <= 0 && aos !== null) { out.push(finish(aos, edge(tPrev, tt, prev), aos === t0, false)); aos = null; }
            prev = cur; tPrev = tt;
            if (tt === t1) break;
        }
        if (aos !== null && out.length < limit) out.push(finish(aos, t1, aos === t0, true));
        return out;

        function finish(a, b, clippedStart, clippedEnd) {
            // Golden-section search for maximum elevation.
            let lo = a, hi = b;
            const gr = (Math.sqrt(5) - 1) / 2;
            let c = hi - gr * (hi - lo), d = lo + gr * (hi - lo), fc = el(c), fd = el(d);
            for (let i = 0; i < 50 && hi - lo > 500; i++) {
                if (fc > fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = el(c); }
                else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = el(d); }
            }
            const tca = Math.round((lo + hi) / 2 / 1000) * 1000;
            const A = look(satrec, station, new Date(a)), B = look(satrec, station, new Date(b)), T = look(satrec, station, new Date(tca));
            return { aos: new Date(a), los: new Date(b), tca: new Date(tca), maxEl: T ? T.el : NaN, aosAz: A ? A.az : NaN, losAz: B ? B.az : NaN,
                clippedStart, clippedEnd, duration: (b - a) / 1000 };
        }
    }

    /** Look geometry sampled every `step` seconds from a to b (Dates). */
    function profile(satrec, station, a, b, step) {
        const out = [];
        const t0 = a.getTime(), span = b.getTime() - t0;
        for (let s = 0; s <= span / 1000 + 1e-9; s += step) {
            const l = look(satrec, station, new Date(t0 + s * 1000));
            if (l) out.push({ t: s, ...l });
        }
        return out;
    }

    /** Unit vector toward the Sun in an Earth-centred inertial frame (USNO low-precision formula, ~0.01°). */
    function sunDirection(date) {
        const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
        const g = (357.529 + 0.98560028 * d) * DEG, q = 280.459 + 0.98564736 * d;
        const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG, e = (23.439 - 0.00000036 * d) * DEG;
        return [Math.cos(L), Math.cos(e) * Math.sin(L), Math.sin(e) * Math.sin(L)];
    }

    /** Rotate an inertial (TEME) vector into the Earth-fixed frame at sidereal angle g. */
    function toFixed(v, g) {
        const c = Math.cos(g), s = Math.sin(g);
        return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
    }

    /** True when a position (km, inertial) is in sunlight, using a cylindrical Earth shadow. */
    function sunlit(r, sun) {
        const along = r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2];
        if (along >= 0) return true;
        const px = r[0] - along * sun[0], py = r[1] - along * sun[1], pz = r[2] - along * sun[2];
        return Math.hypot(px, py, pz) > 6378.137;
    }

    const api = { STATIONS, ecef, look, rangeAccel, passes, profile, sunDirection, toFixed, sunlit, OMEGA_E };
    root.RFGeometry = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
