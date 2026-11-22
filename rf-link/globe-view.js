/* Pass geometry on a globe for the RF link simulator, drawn with the debris visualizer's WebGL Globe.
 * Everything is placed in the Earth-fixed frame, so stations stay put and the ground track has its true
 * shape. The margin footprint evaluates the link budget for a hypothetical station at each point of a
 * grid under the spacecraft. */
(function (root) {
    'use strict';
    const O = root.SpaceOrbit, G = root.RFGeometry, B = root.RFBudget;
    const RE = 6378.137, DEG = Math.PI / 180;
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    /** Small circle of angular radius `radius` (rad) around unit vector c, at distance R (km). */
    function ring(c, radius, R, n = 120) {
        const ref = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const u = unit(cross(c, ref)), v = cross(c, u), out = new Float32Array(3 * n);
        for (let i = 0; i < n; i++) {
            const a = i / n * 2 * Math.PI, cr = Math.cos(radius), sr = Math.sin(radius);
            for (let k = 0; k < 3; k++) out[3 * i + k] = R * (cr * c[k] + sr * (Math.cos(a) * u[k] + Math.sin(a) * v[k]));
        }
        return out;
    }

    function fixedState(satrec, date) {
        const pv = O.stateAt(satrec, date);
        if (!pv) return null;
        const g = O.gmst(date);
        return { r: G.toFixed([pv.position.x, pv.position.y, pv.position.z], g), g };
    }

    // Footprint colours: green at ≥ 3 dB, amber between 0 and 3 dB, red fading out to −6 dB.
    function marginColor(m, out, o) {
        if (!(m > -6)) { out[o + 3] = 0; return; }
        // Above 3 dB the green brightens with margin up to +27 dB, so the antenna pattern and range falloff
        // stay visible even when the whole footprint closes.
        if (m >= 3) { const t = Math.min(1, (m - 3) / 24); out[o] = 0.15 + 0.44 * t; out[o + 1] = 0.47 + 0.49 * t; out[o + 2] = 0.32 + 0.5 * t; out[o + 3] = 0.6 + 0.25 * t; }
        else if (m >= 0) { out[o] = 0.95; out[o + 1] = 0.74; out[o + 2] = 0.38; out[o + 3] = 0.55; }
        else { out[o] = 0.94; out[o + 1] = 0.42; out[o + 2] = 0.42; out[o + 3] = 0.5 * (1 + m / 6) + 0.05; }
    }

    class LinkGlobe {
        constructor(canvas, tags) {
            this.globe = new root.Globe(canvas, { dist: 3.4 });
            this.globe.frame = 'inertial';
            this.globe.gmst = 0;          // inputs are already Earth-fixed
            this.globe.pointSize = 5;
            this.globe.markersDepth = true;
            this.tags = tags;
            this.follow = false;
            this.trackKey = '';
            this.globe.onchange = () => this.placeTags();
        }
        setLand(land) { this.globe.setCoast(land); }
        center(lat, lon, dist) {
            this.globe.cam.az = lon * DEG; this.globe.cam.el = lat * DEG;
            if (dist) this.globe.cam.dist = dist;
            this.globe.draw();
        }

        /**
         * s: { satrec, time (ms), station, stations, radio, mask, pass, period (min), footprint, lit, name }
         * Returns a summary for the caption.
         */
        update(s) {
            const date = new Date(s.time), here = fixedState(s.satrec, date);
            if (!here) return null;
            const sat = here.r, R = Math.hypot(sat[0], sat[1], sat[2]), alt = R - RE, nadir = unit(sat);
            this.globe.sun = G.toFixed(G.sunDirection(date), here.g);
            this.globe.lit = s.lit ? 1 : 0;

            // Ground track ±half an orbit, the selected pass, and the orbit itself, rebuilt only when they change.
            const key = [s.trackKey, Math.round(s.time / 60000)].join('|');
            if (key !== this.trackKey) {
                this.trackKey = key;
                const half = s.period * 30000, step = s.period * 60000 / 240, track = [], orbit = [];
                for (let t = s.time - half; t <= s.time + half; t += step) {
                    const f = fixedState(s.satrec, new Date(t));
                    if (!f) continue;
                    track.push(...scale(unit(f.r), RE * 1.002));
                    orbit.push(...f.r);
                }
                const passPts = [];
                if (s.pass) {
                    const n = 80, a = s.pass.aos.getTime(), b = s.pass.los.getTime();
                    for (let i = 0; i <= n; i++) { const f = fixedState(s.satrec, new Date(a + (b - a) * i / n)); if (f) passPts.push(...scale(unit(f.r), RE * 1.003)); }
                }
                this.static = { track: new Float32Array(track), orbit: new Float32Array(orbit), pass: new Float32Array(passPts) };
            }
            const st = s.station, stPos = G.ecef(st.lat, st.lon, st.alt);
            const look = G.look(s.satrec, st, date);
            const visible = look && look.el >= 0;
            const budget = look ? B.compute(s.radio, look, st) : null;
            // Ground points from which the spacecraft is above the mask: the station's reach at this altitude.
            const mask = s.mask * DEG, reach = Math.acos(Math.min(1, RE * Math.cos(mask) / R)) - mask;
            const tracks = [
                { points: this.static.orbit, color: [0.75, 0.8, 0.9, 0.18] },
                { points: this.static.track, color: [0.75, 0.82, 0.95, 0.45] },
                { points: this.static.pass, color: [0.51, 0.89, 0.71, 0.95] },
                { points: ring(unit(stPos), reach, RE * 1.003), color: [0.91, 0.74, 0.49, 0.85], loop: true },
                { points: ring(nadir, Math.acos(RE / R), RE * 1.002), color: [1, 1, 1, 0.25], loop: true }
            ];
            if (visible) {
                const m = budget.margin, color = m >= 3 ? [0.51, 0.89, 0.71, 0.95] : m >= 0 ? [0.91, 0.74, 0.49, 0.95] : [0.94, 0.54, 0.54, 0.95];
                tracks.push({ points: new Float32Array([...stPos, ...sat]), color });
            }
            this.globe.setTracks(tracks);

            // Margin footprint on a polar grid around the sub-spacecraft point.
            if (s.footprint) this.footprint(s, sat, R, alt, nadir);
            else this.globe.setPoints(new Float32Array(0), new Float32Array(0));

            let inView = 0;
            for (const other of s.stations) { const l = G.look(s.satrec, other, date); if (l && l.el >= s.mask) inView++; }
            const lift = p => scale(p, 1.004);
            const markers = s.stations.filter(o => o.id !== st.id).map(o => ({ pos: lift(G.ecef(o.lat, o.lon, o.alt)), color: [0.62, 0.64, 0.7, 0.7] }));
            markers.push({ pos: lift(stPos), color: [0.96, 0.96, 0.97, 1] });
            markers.push({ pos: sat, color: [1, 0.86, 0.45, 1] });
            this.globe.setMarkers(markers);
            if (this.follow) { this.globe.cam.az = Math.atan2(nadir[1], nadir[0]); this.globe.cam.el = Math.asin(nadir[2]); }
            this.labels = [{ pos: sat, text: s.name, cls: 'sat' }, { pos: stPos, text: st.name, cls: 'station' }];
            this.globe.draw();
            const geo = O.geodetic({ x: sat[0], y: sat[1], z: sat[2] }, 0);
            return { lat: geo.lat, lon: geo.lon, alt, inView, visible, el: look ? look.el : NaN, margin: budget ? budget.margin : NaN };
        }

        footprint(s, sat, R, alt, nadir) {
            const horizon = Math.acos(RE / R), rings = 34, stepAng = horizon / rings;
            const pos = [], col = [];
            const clear = { ...s.radio, rainRate: 0 };
            const ref = Math.abs(nadir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const u = unit(cross(nadir, ref)), v = cross(nadir, u);
            const c = [0, 0, 0, 0];
            for (let i = 0; i < rings; i++) {
                const d = (i + 0.5) * stepAng, n = Math.max(6, Math.round(2 * Math.PI * Math.sin(d) / stepAng));
                for (let j = 0; j < n; j++) {
                    const a = (j + (i % 2) * 0.5) / n * 2 * Math.PI;
                    const p = [0, 1, 2].map(k => Math.cos(d) * nadir[k] + Math.sin(d) * (Math.cos(a) * u[k] + Math.sin(a) * v[k]));
                    const P = scale(p, RE), rho = [sat[0] - P[0], sat[1] - P[1], sat[2] - P[2]], range = Math.hypot(rho[0], rho[1], rho[2]);
                    const el = Math.asin((rho[0] * p[0] + rho[1] * p[1] + rho[2] * p[2]) / range) / DEG;
                    if (el < s.mask) continue;
                    const offNadir = Math.acos(Math.max(-1, Math.min(1, (rho[0] * sat[0] + rho[1] * sat[1] + rho[2] * sat[2]) / (range * R)))) / DEG;
                    const lat = Math.asin(p[2]) / DEG;
                    const m = B.compute(clear, { el, range, rangeRate: 0, offNadir, altitude: alt }, { lat, alt: 0 }).margin;
                    marginColor(m, c, 0);
                    if (!c[3]) continue;
                    pos.push(...scale(p, RE * 1.001)); col.push(...c);
                }
            }
            this.globe.pointSize = Math.max(3, Math.min(9, 2.2 / this.globe.cam.dist * 9));
            this.globe.setPoints(new Float32Array(pos), new Float32Array(col));
        }

        placeTags() {
            if (!this.labels || !this.tags) return;
            const M = this.globe.matrices();
            this.tags.replaceChildren(...this.labels.map(l => {
                const p = this.globe.project(l.pos, M);
                const tag = document.createElement('span');
                tag.className = 'globe-tag ' + l.cls;
                tag.textContent = l.text;
                if (!p || p.hidden) tag.hidden = true;
                else { tag.style.left = p.x + 'px'; tag.style.top = p.y + 'px'; }
                return tag;
            }));
        }
    }

    root.RFLinkGlobe = LinkGlobe;
})(typeof self !== 'undefined' ? self : globalThis);
