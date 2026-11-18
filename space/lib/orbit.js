/* Orbit input, conversion and SGP4 helpers shared by the space tools.
 * Works in a window, a Web Worker, or Node (with satellite.js loaded as `satellite`).
 * Every orbit, whether typed by hand or pasted as a TLE/OMM, becomes an SGP4
 * record, so both tools propagate all inputs the same way. */
(function (root) {
    'use strict';
    const sat = root.satellite || (typeof require === 'function' ? require('./satellite.min.js') : null);
    const MU = 398600.4418;          // km^3 s^-2
    const RE = 6378.137;             // km, WGS-84 equatorial radius
    const DEG = Math.PI / 180;
    const TWO_PI = 2 * Math.PI;
    const MIN_PER_DAY = 1440;

    const pad = (s, n, c = ' ') => { s = String(s); return s.length >= n ? s : c.repeat(n - s.length) + s; };
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const wrap360 = x => ((x % 360) + 360) % 360;

    function tleChecksum(line) {
        let sum = 0;
        for (const ch of line.slice(0, 68)) {
            if (ch >= '0' && ch <= '9') sum += +ch;
            else if (ch === '-') sum += 1;
        }
        return sum % 10;
    }

    /** Parse one or more two- or three-line element sets. Returns {sets, errors}. */
    function parseTLE(text) {
        const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
        const sets = [], errors = [];
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (l.startsWith('1 ') && lines[i + 1] && lines[i + 1].startsWith('2 ')) {
                const prev = i > 0 && !lines[i - 1].startsWith('2 ') && !lines[i - 1].startsWith('1 ') ? lines[i - 1].replace(/^0 /, '').trim() : '';
                const l1 = l, l2 = lines[i + 1];
                const set = { name: prev, line1: l1, line2: l2, warnings: [] };
                if (l1.length < 69 || l2.length < 69) set.warnings.push('A line is shorter than 69 characters.');
                else {
                    if (tleChecksum(l1) !== +l1[68]) set.warnings.push('Line 1 checksum does not match.');
                    if (tleChecksum(l2) !== +l2[68]) set.warnings.push('Line 2 checksum does not match.');
                }
                if (l1.slice(2, 7) !== l2.slice(2, 7)) set.warnings.push('Catalog numbers on lines 1 and 2 differ.');
                try {
                    set.satrec = sat.twoline2satrec(l1, l2);
                    if (set.satrec.error) throw new Error('SGP4 initialisation error ' + set.satrec.error);
                    if (!set.name) set.name = 'NORAD ' + set.satrec.satnum;
                    sets.push(set);
                } catch (err) {
                    errors.push(`Element set at line ${i + 1}: ${err.message}`);
                }
                i++;
            }
        }
        if (!sets.length && !errors.length) errors.push('No two-line element sets found. Each set needs a line starting "1 " followed by a line starting "2 ".');
        return { sets, errors };
    }

    /** Parse OMM records in JSON (CelesTrak or Space-Track FORMAT=json). */
    function parseOMM(text) {
        let doc;
        try { doc = JSON.parse(text); } catch (err) { return { sets: [], errors: ['Not valid JSON: ' + err.message] }; }
        const records = Array.isArray(doc) ? doc : Array.isArray(doc.objects) ? doc.objects : [doc];
        const sets = [], errors = [];
        records.forEach((r, k) => {
            try {
                if (r.MEAN_MOTION == null || r.EPOCH == null) throw new Error('missing EPOCH or MEAN_MOTION');
                const omm = Object.assign({ EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0 }, r);
                for (const key of ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT', 'NORAD_CAT_ID']) if (omm[key] != null) omm[key] = +omm[key];
                const satrec = sat.json2satrec(omm);
                if (satrec.error) throw new Error('SGP4 initialisation error ' + satrec.error);
                sets.push({ name: r.OBJECT_NAME || 'NORAD ' + r.NORAD_CAT_ID, omm, satrec, warnings: [] });
            } catch (err) { errors.push(`Record ${k + 1}: ${err.message}`); }
        });
        return { sets, errors };
    }

    /** Accept TLE text or OMM JSON. */
    function parseElements(text) {
        const t = String(text).trim();
        if (!t) return { sets: [], errors: ['Paste a TLE or OMM JSON first.'] };
        return t[0] === '{' || t[0] === '[' ? parseOMM(t) : parseTLE(t);
    }

    function isoNoZ(date) { return date.toISOString().replace('Z', ''); }

    /** Build an SGP4 record from classical elements. Altitudes in km, angles in degrees. */
    function satrecFromElements(el) {
        const rp = RE + el.perigee, ra = RE + el.apogee;
        if (!(rp > RE * 0.98) || !(ra >= rp)) throw new Error('Apogee must be at or above perigee, and perigee above the surface.');
        const aT = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
        if (e >= 0.98) throw new Error('Eccentricity must be below 0.98 for SGP4.');
        // SGP4 reads mean motion as Kozai and converts it to Brouwer; iterate so the SGP4
        // mean elements reproduce the typed perigee and apogee.
        let a = aT, satrec = null;
        for (let k = 0; k < 4; k++) {
            satrec = build(a);
            const aGot = Math.pow(MU / (satrec.no / 60) ** 2, 1 / 3);
            if (Math.abs(aGot - aT) < 1e-4) break;
            a *= aT / aGot;
        }
        return satrec;
        function build(a) {
        const n = 86400 / (TWO_PI * Math.sqrt(a ** 3 / MU));
        const omm = {
            OBJECT_NAME: el.name || 'MANUAL ORBIT', OBJECT_ID: '2000-000A', EPOCH: isoNoZ(el.epoch),
            MEAN_MOTION: n, ECCENTRICITY: e, INCLINATION: el.inc, RA_OF_ASC_NODE: wrap360(el.raan || 0),
            ARG_OF_PERICENTER: wrap360(el.argp || 0), MEAN_ANOMALY: wrap360(el.ma || 0), EPHEMERIS_TYPE: 0,
            CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: el.norad || 99999, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
            BSTAR: el.bstar || 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0
        };
        const s = sat.json2satrec(omm);
        if (s.error) throw new Error('SGP4 could not initialise these elements (error ' + s.error + ').');
        return s;
        }
    }

    function epochDate(satrec) {
        return new Date((satrec.jdsatepoch + (satrec.jdsatepochF || 0) - 2440587.5) * 86400000);
    }

    /** Kozai mean motion (rev/day, as written in a TLE) from SGP4's internal Brouwer value. */
    function kozaiMeanMotion(satrec) {
        const xke = 60 / Math.sqrt(6378.135 ** 3 / 398600.8), j2 = 0.001082616;   // WGS-72, as SGP4
        const c = Math.cos(satrec.inclo), b = Math.pow(1 - satrec.ecco * satrec.ecco, 1.5);
        const d1 = 0.75 * j2 * (3 * c * c - 1) / b;
        let k = satrec.no;
        for (let i = 0; i < 8; i++) {
            const a1 = Math.pow(xke / k, 2 / 3), del = d1 / (a1 * a1);
            const ao = a1 * (1 - del / 3 - del * del - 134 / 81 * del ** 3), delo = d1 / (ao * ao);
            k = satrec.no * (1 + delo);
        }
        return k * MIN_PER_DAY / TWO_PI;
    }

    /** Mean elements of an SGP4 record in familiar units. */
    function elementsOf(satrec) {
        const nRad = satrec.no;                       // rad/min (un-Kozai'd)
        const a = Math.pow(MU / (nRad / 60) ** 2, 1 / 3);
        const e = satrec.ecco;
        return {
            epoch: epochDate(satrec), n: nRad * MIN_PER_DAY / TWO_PI, nKozai: kozaiMeanMotion(satrec), a, e,
            inc: satrec.inclo / DEG, raan: satrec.nodeo / DEG, argp: satrec.argpo / DEG, ma: satrec.mo / DEG,
            period: TWO_PI / nRad, perigee: a * (1 - e) - RE, apogee: a * (1 + e) - RE, bstar: satrec.bstar,
            norad: satrec.satnum
        };
    }

    function tleExp(x) {
        if (!x) return ' 00000-0';
        const sign = x < 0 ? '-' : ' ';
        let ex = Math.floor(Math.log10(Math.abs(x))) + 1;
        let mant = Math.round(Math.abs(x) / 10 ** ex * 1e5);
        if (mant >= 1e5) { mant = Math.round(mant / 10); ex += 1; }
        return sign + pad(mant, 5, '0') + (ex < 0 ? '-' : '+') + Math.abs(ex);
    }

    /** Format elements as a valid two-line element set (for export / sharing). */
    function toTLE(el, name = 'MANUAL ORBIT', norad = 99999) {
        const d = el.epoch;
        const y = d.getUTCFullYear();
        const start = Date.UTC(y, 0, 1);
        const doy = (d.getTime() - start) / 86400000 + 1;
        const id = pad(norad % 100000, 5, '0');
        let l1 = `1 ${id}U 00000A   ${pad(y % 100, 2, '0')}${pad(doy.toFixed(8), 12, '0')}  .00000000  00000-0 ${tleExp(el.bstar || 0)} 0  999`;
        let l2 = `2 ${id} ${pad(el.inc.toFixed(4), 8)} ${pad(wrap360(el.raan).toFixed(4), 8)} ${el.e.toFixed(7).slice(2)} ${pad(wrap360(el.argp).toFixed(4), 8)} ${pad(wrap360(el.ma).toFixed(4), 8)} ${pad((el.nKozai || el.n).toFixed(8), 11)}    0`;
        l1 += tleChecksum(l1); l2 += tleChecksum(l2);
        return `${name}\n${l1}\n${l2}`;
    }

    /** TEME position/velocity (km, km/s) at a Date, or null if SGP4 fails. */
    function stateAt(satrec, date) {
        const pv = sat.propagate(satrec, date);
        return pv && pv.position ? pv : null;
    }

    function gmst(date) { return sat.gstime(date); }

    /** Geodetic latitude/longitude (deg) and height (km) of a TEME position. */
    function geodetic(r, g) {
        const gd = sat.eciToGeodetic(r, g);
        let lon = gd.longitude / DEG;
        lon = ((lon + 540) % 360) - 180;
        return { lat: gd.latitude / DEG, lon, h: gd.height };
    }

    /**
     * Orbit "sources" are plain objects that survive JSON, URLs and postMessage:
     *   {kind:'elements', name, epoch: ISO, perigee, apogee, inc, raan, argp, ma, bstar}
     *   {kind:'tle', name, line1, line2}
     *   {kind:'omm', name, omm: {...}}
     */
    function satrecFromSource(src) {
        if (src.kind === 'tle') {
            const s = sat.twoline2satrec(src.line1, src.line2);
            if (s.error) throw new Error('SGP4 could not initialise this TLE (error ' + s.error + ').');
            return s;
        }
        if (src.kind === 'omm') {
            const s = sat.json2satrec(src.omm);
            if (s.error) throw new Error('SGP4 could not initialise this OMM (error ' + s.error + ').');
            return s;
        }
        return satrecFromElements(Object.assign({}, src, { epoch: new Date(src.epoch) }));
    }

    /* Standard orbits for quick comparison. Altitudes km, angles deg. */
    const PRESETS = [
        { id: 'iss', name: 'ISS (420 km, 51.6°)', perigee: 415, apogee: 425, inc: 51.64, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'hst', name: 'Hubble (535 km, 28.5°)', perigee: 532, apogee: 538, inc: 28.47, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'starlink', name: 'Starlink shell (550 km, 53°)', perigee: 548, apogee: 552, inc: 53.05, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'sso800', name: 'Sun-synchronous 800 km', perigee: 798, apogee: 802, inc: 98.6, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'leo1200', name: 'LEO 1,200 km, 87.9° (OneWeb)', perigee: 1198, apogee: 1202, inc: 87.9, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'eq2000', name: 'Equatorial 2,000 km', perigee: 1998, apogee: 2002, inc: 0.1, raan: 0, argp: 0, ma: 0, group: 'LEO' },
        { id: 'inner', name: 'Inner-belt core 3,000 km, 10°', perigee: 2998, apogee: 3002, inc: 10, raan: 0, argp: 0, ma: 0, group: 'MEO' },
        { id: 'o3b', name: 'O3b mPOWER (8,062 km, 0°)', perigee: 8060, apogee: 8064, inc: 0.05, raan: 0, argp: 0, ma: 0, group: 'MEO' },
        { id: 'gps', name: 'GPS (20,200 km, 55°)', perigee: 20180, apogee: 20220, inc: 55, raan: 0, argp: 0, ma: 0, group: 'MEO' },
        { id: 'geo', name: 'Geostationary (35,786 km)', perigee: 35776, apogee: 35796, inc: 0.05, raan: 0, argp: 0, ma: 0, group: 'GEO' },
        { id: 'gto', name: 'GTO (250 × 35,786 km, 27°)', perigee: 250, apogee: 35786, inc: 27, raan: 0, argp: 178, ma: 0, group: 'HEO' },
        { id: 'molniya', name: 'Molniya (600 × 39,700 km, 63.4°)', perigee: 600, apogee: 39700, inc: 63.4, raan: 0, argp: 270, ma: 0, group: 'HEO' },
        { id: 'rbsp', name: 'Van Allen Probes (620 × 30,400 km, 10°)', perigee: 618, apogee: 30410, inc: 10.2, raan: 0, argp: 0, ma: 0, group: 'HEO' }
    ];

    const api = {
        MU, RE, DEG, clamp, wrap360, tleChecksum, parseTLE, parseOMM, parseElements, satrecFromElements, satrecFromSource,
        elementsOf, epochDate, toTLE, stateAt, gmst, geodetic, PRESETS, satellite: sat
    };
    root.SpaceOrbit = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
