/* Simulated weather for the RF link simulator: a deterministic, global field of moving cloud and rain
 * cells. It is not a forecast. It aims to be plausible: broad frontal rain shields on the mid-latitude
 * storm tracks and the tropical rain belt, short-lived thunderstorm cores that are most common in the
 * tropics, all drifting with the prevailing winds and growing and decaying over their lifetimes.
 *
 * Each cell "slot" repeats with its own period. Its instance at any time is derived from a hash of the
 * slot and the repeat number, so the field can be sampled at any time without stepping a simulation. */
(function (root) {
    'use strict';
    const DEG = Math.PI / 180, KM_PER_DEG = 111.195;
    const LEVELS = { calm: 0.45, typical: 1, stormy: 1.8, severe: 2.8 };

    function hash(a, b, c) {
        let h = (a * 0x9E3779B1) ^ (b * 0x85EBCA77) ^ (c * 0xC2B2AE3D);
        h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
        h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
        return (h ^ (h >>> 16)) >>> 0;
    }
    const uniform = (h, k) => hash(h, k, 0x51ED) / 4294967296;

    /** Prevailing wind (m/s, east and north) by latitude: trades, westerlies and polar easterlies. */
    function wind(lat) {
        const a = Math.abs(lat);
        const u = a < 25 ? -6 + 3 * (a / 25) : a < 65 ? 12 * Math.sin((a - 25) / 40 * Math.PI) + 3 : -3;
        return { u, v: 0 };
    }

    /** Climatological surface wet refractivity N_wet (ppm): humid tropics, dry poles. */
    function climateNwet(lat) { return 15 + 105 * Math.exp(-((lat / 28) ** 2)); }

    function slotLatitude(kind, h) {
        const r = uniform(h, 1), s = uniform(h, 2) < 0.5 ? -1 : 1, x = uniform(h, 3);
        if (kind === 'front') return r < 0.72 ? s * (38 + 30 * x) : r < 0.92 ? (x - 0.5) * 24 : s * (25 + 13 * x);
        if (kind === 'deck') return r < 0.55 ? s * (35 + 40 * x) : (x - 0.5) * 120;
        return r < 0.62 ? (x - 0.5) * 46 : r < 0.94 ? s * (25 + 32 * x) : s * (57 + 13 * x);
    }

    class Field {
        constructor({ seed = 1, storminess = 'typical', target = null } = {}) {
            this.seed = seed >>> 0;
            this.level = LEVELS[storminess] ?? 1;
            this.target = target;
            // Frontal rain shields, convective systems (heavy cores in lighter rain) and non-raining cloud decks.
            const counts = { front: Math.round(46 * Math.sqrt(this.level)), storm: Math.round(900 * this.level), deck: Math.round(150 * Math.sqrt(this.level)) };
            const LIFE = { front: [30, 42, 0, 24], storm: [1, 3, 0.5, 5], deck: [12, 36, 0, 12] };   // life: base + span; gap: base + span (hours)
            this.slots = [];
            for (const [kind, n] of Object.entries(counts)) for (let j = 0; j < n; j++) {
                const i = this.slots.length, h = hash(this.seed, i, 17), [l0, l1, g0, g1] = LIFE[kind];
                const life = l0 + l1 * uniform(h, 4), gap = g0 + g1 * uniform(h, 5);
                this.slots.push({ kind, h, life, period: life + gap, phase: (life + gap) * uniform(h, 6) });
            }
            this.cacheKey = null;
        }

        /** Active cells at time t (ms), with their current centres, bucketed by 6° of latitude and longitude. */
        prepare(t) {
            const key = Math.round(t / 10000);
            if (key === this.cacheKey) return;
            this.cacheKey = key;
            const hours = t / 3600000, cells = [];
            for (let i = 0; i < this.slots.length; i++) {
                const sl = this.slots[i], n = Math.floor((hours + sl.phase) / sl.period);
                const age = hours + sl.phase - n * sl.period;
                if (age > sl.life) continue;
                const h = hash(sl.h, n, 29);
                const lat0 = slotLatitude(sl.kind, h), lon0 = 360 * uniform(h, 7) - 180;
                cells.push(...this.cell(sl.kind, h, lat0, lon0, age, sl.life));
            }
            if (this.target) cells.push(...this.targetCells(t));
            this.cells = cells.filter(Boolean);
            this.buckets = new Map();
            for (const c of this.cells) {
                const reach = c.reach / KM_PER_DEG, cosl = Math.max(0.15, Math.cos(c.lat * DEG));
                for (let la = Math.floor((c.lat - reach) / 6); la <= Math.floor((c.lat + reach) / 6); la++) {
                    const span = Math.min(30, Math.ceil(reach / cosl / 6) + 1);
                    for (let k = -span; k <= span; k++) {
                        const lo = ((Math.floor(c.lon / 6) + k) % 60 + 60) % 60, id = la * 100 + lo;
                        if (!this.buckets.has(id)) this.buckets.set(id, []);
                        this.buckets.get(id).push(c);
                    }
                }
            }
        }

        cell(kind, h, lat0, lon0, age, life) {
            const w = wind(lat0), du = (uniform(h, 8) - 0.5) * 8, dv = (uniform(h, 9) - 0.5) * 4;
            const s = age * 3600;
            const lat = Math.max(-84, Math.min(84, lat0 + (w.v + dv) * s / 1000 / KM_PER_DEG));
            const lon = lon0 + (w.u + du) * s / 1000 / (KM_PER_DEG * Math.max(0.2, Math.cos(lat0 * DEG)));
            const env = Math.pow(Math.sin(Math.PI * Math.min(1, age / life)), 0.7);
            const L = this.level, tropics = Math.abs(lat0) < 25;
            const angle = Math.PI * uniform(h, 12), at = { lat, lon: wrap(lon), angle };
            if (kind === 'front') {
                const r = 140 + 320 * uniform(h, 10);
                return [{ ...at, r, rc: r * 2.4, elong: 1.5 + 1.7 * uniform(h, 11),
                    rain: env * (0.8 + 3.6 * uniform(h, 13)) * Math.sqrt(L) * (tropics ? 1.5 : 1), cloud: env * (0.3 + 0.7 * uniform(h, 14)),
                    texture: [2 * Math.PI / (60 + 90 * uniform(h, 15)), 2 * Math.PI * uniform(h, 16)], reach: r * 3.5 }];
            }
            if (kind === 'deck') {
                const r = 300 + 700 * uniform(h, 10);
                return [{ ...at, r, rc: r, elong: 1.2 + 1.5 * uniform(h, 11), rain: 0, cloud: env * (0.08 + 0.3 * uniform(h, 14)), texture: null, reach: r * 2.2 }];
            }
            // A convective system: a heavy core inside a broader area of lighter rain, under a wide anvil.
            const core = 6 + 12 * uniform(h, 10), wide = 30 + 70 * uniform(h, 15);
            const peak = (18 + 82 * uniform(h, 13) ** 1.2) * (0.65 + 0.35 * L) * (tropics ? 1.25 : 0.8);
            return [
                { ...at, r: core, rc: core * 3, elong: 1 + 0.6 * uniform(h, 11), rain: env * peak, cloud: env * (0.6 + 1.0 * uniform(h, 14)), texture: null, reach: core * 6 },
                { ...at, r: wide, rc: wide * 2.2, elong: 1.2 + 1.2 * uniform(h, 16), rain: env * (1 + 4 * uniform(h, 17)) * (tropics ? 1.3 : 1),
                    cloud: env * (0.3 + 0.5 * uniform(h, 18)), texture: [2 * Math.PI / (25 + 30 * uniform(h, 19)), 2 * Math.PI * uniform(h, 20)], reach: wide * 3 }
            ];
        }

        // An optional thunderstorm, with a stratiform skirt, timed to sit over a target point at time target.t.
        targetCells(t) {
            const { lat, lon, t: t0 } = this.target, dt = (t - t0) / 1000;
            // Drift with the prevailing wind but at least 8 m/s, so the storm crosses the station during a pass.
            const u0 = wind(lat).u, w = { u: (u0 < 0 ? -1 : 1) * Math.max(8, Math.abs(u0)) };
            // Thunderstorms are strongest in the tropics; at high latitude the same option gives a heavy shower.
            const peak = 30 + 60 * Math.exp(-(((Math.abs(lat) - 15) / 30) ** 2));
            const hours = Math.abs(t - t0) / 3600000;
            if (hours > 3) return [];
            const env = hours < 1.2 ? 1 : Math.cos((hours - 1.2) / 1.8 * Math.PI / 2);
            // With an azimuth, the cell sits offsetKm from the station in that direction (where the pass sets).
            const [lat1, lon1] = this.target.az === undefined ? [lat, lon] : travel(lat, lon, this.target.az, this.target.offsetKm || 18);
            const clat = lat1, clon = wrap(lon1 + w.u * dt / 1000 / (KM_PER_DEG * Math.max(0.2, Math.cos(lat1 * DEG))));
            return [
                { lat: clat, lon: clon, r: 10, rc: 55, elong: 1.3, angle: 0.4, rain: peak * env, cloud: 2.2 * env, texture: null, reach: 160 },
                { lat: clat, lon: clon, r: 120, rc: 190, elong: 1.8, angle: 0.4, rain: 4 * env, cloud: 0.9 * env, texture: [2 * Math.PI / 70, 1.3], reach: 400 }
            ];
        }

        /** Rain rate (mm/h) and columnar cloud liquid water (kg/m²) at a point and time. */
        sample(lat, lon, t) {
            this.prepare(t);
            const list = this.buckets.get(Math.floor(lat / 6) * 100 + ((Math.floor(lon / 6) % 60) + 60) % 60);
            let rain = 0, cloud = 0;
            if (list) for (const c of list) {
                let dx = (lon - c.lon); dx -= 360 * Math.round(dx / 360);
                dx *= KM_PER_DEG * Math.cos(lat * DEG);
                const dy = (lat - c.lat) * KM_PER_DEG;
                const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
                const x = (dx * ca + dy * sa) / c.elong, y = -dx * sa + dy * ca, d2 = x * x + y * y;
                if (d2 > c.reach * c.reach) continue;
                // Rain has a soft edge at about 1.4 radii; cloud extends further with a plain Gaussian.
                let rr = c.rain * Math.max(0, Math.exp(-d2 / (c.r * c.r)) - 0.14) / 0.86;
                if (c.texture) rr *= 0.55 + 0.45 * Math.sin(c.texture[0] * x + c.texture[1]) * Math.sin(c.texture[0] * 0.7 * y + 2 * c.texture[1]);
                rain += Math.max(0, rr);
                cloud += c.cloud * Math.exp(-d2 / (c.rc * c.rc));
            }
            return { rain: Math.min(rain, 150), cloud: Math.min(cloud, 4) };
        }
    }
    function wrap(lon) { return ((lon + 540) % 360) - 180; }

    // One field per weather setting, shared by every caller on the page or in the worker.
    const fields = new Map();
    function fieldFor(r) {
        const t = r.wxTarget;
        const key = [r.wxSeed, r.storminess, t ? [t.lat, t.lon, t.t].join(',') : ''].join('|');
        if (!fields.has(key)) { if (fields.size > 8) fields.clear(); fields.set(key, new Field({ seed: r.wxSeed, storminess: r.storminess, target: t })); }
        return fields.get(key);
    }

    /** Point at distance d (km) along azimuth az (deg) from lat, lon (deg), on a sphere. */
    function travel(lat, lon, az, d) {
        const p = lat * DEG, l = lon * DEG, a = az * DEG, k = d / 6371;
        const p2 = Math.asin(Math.sin(p) * Math.cos(k) + Math.cos(p) * Math.sin(k) * Math.cos(a));
        const l2 = l + Math.atan2(Math.sin(a) * Math.sin(k) * Math.cos(p), Math.cos(k) - Math.sin(p) * Math.sin(p2));
        return [p2 / DEG, wrap(l2 / DEG)];
    }

    function describeRain(r) {
        return r < 0.1 ? 'no rain' : r < 2.5 ? 'light rain' : r < 10 ? 'moderate rain' : r < 50 ? 'heavy rain' : 'violent rain';
    }

    const api = { Field, fieldFor, wind, climateNwet, travel, describeRain, LEVELS };
    root.RFWeather = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
