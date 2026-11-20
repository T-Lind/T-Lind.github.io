(function (root) {
    'use strict';

    const DEG = Math.PI / 180;
    const ARCSEC = 3600 / DEG;
    const J2000 = Date.UTC(2000, 0, 1, 12);
    const days = time => (time - J2000) / 86400000;
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const wrap = x => (x % 360 + 360) % 360;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const scale = (v, f) => [v[0] * f, v[1] * f, v[2] * f];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = v => Math.hypot(v[0], v[1], v[2]);
    const unit = v => scale(v, 1 / norm(v));
    const angle = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b));
    const direction = (a, d) => [Math.cos(a) * Math.cos(d), Math.sin(a) * Math.cos(d), Math.sin(d)];

    // Right-handed camera basis: x right, y down, z forward.
    function attitude(ra, dec, roll = 0) {
        const a = ra * DEG, d = dec * DEG, r = roll * DEG;
        const z = direction(a, d);
        const west = [Math.sin(a), -Math.cos(a), 0];
        const south = cross(z, west);
        const x = add(scale(west, Math.cos(r)), scale(south, Math.sin(r)));
        return [x, cross(z, x), z];
    }

    function angles(basis) {
        const [x, , z] = basis;
        const ra = wrap(Math.atan2(z[1], z[0]) / DEG);
        const dec = Math.atan2(z[2], Math.hypot(z[0], z[1])) / DEG;
        const [west, south] = attitude(ra, dec);
        return { ra, dec, roll: Math.atan2(dot(x, south), dot(x, west)) / DEG };
    }

    const toCamera = (basis, v) => [dot(basis[0], v), dot(basis[1], v), dot(basis[2], v)];
    function toSky([x, y, z], [a, b, c]) {
        return [x[0] * a + y[0] * b + z[0] * c, x[1] * a + y[1] * b + z[1] * c, x[2] * a + y[2] * b + z[2] * c];
    }

    function rotate(v, axis, r) {
        const c = Math.cos(r), s = Math.sin(r);
        return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
    }

    function rotationError(a, b) {
        const v = add(add(cross(a[0], b[0]), cross(a[1], b[1])), cross(a[2], b[2]));
        return Math.atan2(norm(v), dot(a[0], b[0]) + dot(a[1], b[1]) + dot(a[2], b[2]) - 1);
    }

    function quaternion([x, y, z]) {
        const m = [x[0], y[1], z[2]];
        const diag = [1 + m[0] + m[1] + m[2], 1 + m[0] - m[1] - m[2], 1 - m[0] + m[1] - m[2], 1 - m[0] - m[1] + m[2]];
        const i = diag.indexOf(Math.max(...diag));
        const q = [
            [diag[0], y[2] - z[1], z[0] - x[2], x[1] - y[0]],
            [y[2] - z[1], diag[1], x[1] + y[0], x[2] + z[0]],
            [z[0] - x[2], x[1] + y[0], diag[2], y[2] + z[1]],
            [x[1] - y[0], x[2] + z[0], y[2] + z[1], diag[3]]
        ][i];
        return q.map(v => v * (q[0] < 0 ? -0.5 : 0.5) / Math.sqrt(diag[i]));
    }

    function camera(settings, calibrated = true) {
        const { width, height, fov, distortion } = settings;
        return { width, height, cx: (width - 1) / 2, cy: (height - 1) / 2,
            focal: width / (2 * Math.tan(fov * DEG / 2)), k: calibrated ? distortion : 0 };
    }

    function project(c, [x, y, z]) {
        const u = x / z, v = y / z, k = 1 + c.k * (u * u + v * v);
        return [c.cx + u * k * c.focal, c.cy + v * k * c.focal];
    }

    function ray(c, x, y) {
        const u = (x - c.cx) / c.focal, v = (y - c.cy) / c.focal;
        const kr2 = c.k * (u * u + v * v);
        let s = 1;
        for (let i = 0; i < 4; i++) s -= (s + kr2 * s * s * s - 1) / (1 + 3 * kr2 * s * s);
        return unit([s * u, s * v, 1]);
    }

    function loadCatalog(rows) {
        return rows.map(([hip, ra, dec, mag, pmra, pmdec, name]) => {
            const a = ra * DEG, d = dec * DEG, v = direction(a, d);
            const east = [-Math.sin(a), Math.cos(a), 0];
            const motion = scale(add(scale(east, pmra), scale(cross(v, east), pmdec)), DEG / 3600000);
            return { hip, mag, name, v, motion };
        });
    }

    function catalogVector(star, years, beta = [0, 0, 0]) {
        const v = add(star.v, scale(star.motion, years));
        return unit(add(v, sub(beta, scale(v, dot(v, beta)))));
    }

    root.StarMath = { DEG, ARCSEC, J2000, days, clamp, wrap, dot, cross, scale, add, sub, norm, unit, angle,
        direction, attitude, angles, toCamera, toSky, rotate, rotationError, quaternion, camera, project, ray,
        loadCatalog, catalogVector };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarMath;
})(typeof self !== 'undefined' ? self : globalThis);
