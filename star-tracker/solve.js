(function (root) {
    'use strict';

    const M = root.StarMath || require('./math.js');
    const { DEG, ARCSEC, dot, cross, scale, add, sub, norm, unit, angle, clamp, toSky } = M;
    const PAIR_BIN = 0.045;
    const MAX_SEP = 48;
    const MIN_SEP = 1.6;
    const CELL_SCALE = 24;
    const SEED_MAG = 5.55;

    function detect(pixels, camera, threshold) {
        const { width: w, height: h } = camera;
        const points = [];
        const ring = [-4 * w - 3, -4 * w + 3, -3 * w + 4, 3 * w + 4, 4 * w + 3, 4 * w - 3, 3 * w - 4, -3 * w - 4];
        for (let y = 4; y < h - 4; y++) {
            for (let x = 4; x < w - 4; x++) {
                const i = y * w + x, peak = pixels[i];
                if (peak < 12 || peak <= pixels[i - 1] || peak < pixels[i + 1] || peak <= pixels[i - w] || peak < pixels[i + w]
                    || peak < pixels[i - w - 1] || peak < pixels[i - w + 1] || peak < pixels[i + w - 1] || peak < pixels[i + w + 1]) continue;
                const ringValues = ring.map(offset => pixels[i + offset]).sort((a, b) => a - b);
                const bg = (ringValues[3] + ringValues[4]) / 2;
                const sigma = Math.max(2, (ringValues[5] - ringValues[2]) / 1.35);
                const contrast = peak - bg;
                if (contrast < Math.max(10, threshold * sigma)) continue;
                let flux = 0, cx = 0, cy = 0, xx = 0, yy = 0, xy = 0, core = 0, outer = 0;
                const cap = contrast * 0.9;
                for (let dy = -3; dy <= 3; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        const signal = Math.max(0, pixels[i + dy * w + dx] - bg - sigma);
                        const weight = Math.min(cap, signal);
                        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) core += weight;
                        if (Math.max(Math.abs(dx), Math.abs(dy)) === 3) outer += weight;
                        flux += weight;
                        cx += dx * weight;
                        cy += dy * weight;
                        xx += dx ** 2 * weight;
                        yy += dy ** 2 * weight;
                        xy += dx * dy * weight;
                    }
                }
                if (core < cap * 1.6 || outer > flux * 0.39 || flux < 27) continue;
                cx /= flux;
                cy /= flux;
                const vx = xx / flux - cx * cx, vy = yy / flux - cy * cy, cov = xy / flux - cx * cy;
                const axisRatio = Math.hypot(vx - vy, 2 * cov) / (vx + vy);
                if (vx + vy < 0.4 || axisRatio > 0.78 || Math.abs(cx) > 1.25 || Math.abs(cy) > 1.25) continue;
                const px = x + cx, py = y + cy;
                points.push({ x: px, y: py, flux, snr: contrast / sigma, ray: M.ray(camera, px, py) });
            }
        }
        points.sort((a, b) => b.flux - a.flux);
        const distinct = [];
        for (const point of points) {
            if (distinct.length >= 72) break;
            if (!distinct.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 4)) distinct.push(point);
        }
        return distinct;
    }

    const cell = v => Math.floor((v + 1) * CELL_SCALE);
    const key = (x, y, z) => (x * 64 + y) * 64 + z;

    function buildIndex(catalog, year = 26) {
        const stars = catalog.map(({ hip, mag, name, v, motion }) => ({ hip, mag, name, v, motion, ref: M.catalogVector({ v, motion }, year) }));
        const seed = stars.filter(star => star.mag <= SEED_MAG);
        const grid = new Map();
        for (const star of stars) {
            const id = key(...star.ref.map(cell));
            if (!grid.has(id)) grid.set(id, []);
            grid.get(id).push(star);
        }
        const bins = Array.from({ length: Math.ceil(MAX_SEP / PAIR_BIN) + 1 }, () => []);
        const low = Math.cos(MAX_SEP * DEG), high = Math.cos(MIN_SEP * DEG);
        for (let i = 0; i < seed.length; i++) {
            const [x, y, z] = seed[i].ref;
            for (let j = 0; j < i; j++) {
                const b = seed[j].ref;
                const d = x * b[0] + y * b[1] + z * b[2];
                if (d > low && d < high) bins[Math.floor(Math.acos(d) / DEG / PAIR_BIN)].push(i * seed.length + j);
            }
        }
        return { grid, bins: bins.map(bin => Uint32Array.from(bin)), seed, year };
    }

    function nearest(index, v, radius, limitMag, vector) {
        const [x, y, z] = v, pad = radius + 0.002;
        const loX = cell(clamp(x - pad, -1, 1)), hiX = cell(clamp(x + pad, -1, 1));
        const loY = cell(clamp(y - pad, -1, 1)), hiY = cell(clamp(y + pad, -1, 1));
        const loZ = cell(clamp(z - pad, -1, 1)), hiZ = cell(clamp(z + pad, -1, 1));
        const cutoff = 1 - pad * pad / 2;
        let best = 1 - radius * radius / 2, match = null;
        for (let i = loX; i <= hiX; i++) {
            for (let j = loY; j <= hiY; j++) {
                for (let k = loZ; k <= hiZ; k++) {
                    const bucket = index.grid.get(key(i, j, k));
                    if (!bucket) continue;
                    for (const star of bucket) {
                        if (star.mag > limitMag) break;
                        const d = dot(v, star.ref);
                        if (!vector) {
                            if (d > best) return true;
                            continue;
                        }
                        if (d < cutoff) continue;
                        const ref = vector(star), score = dot(v, ref);
                        if (score <= best) continue;
                        best = score;
                        match = { star, ref };
                    }
                }
            }
        }
        return match;
    }

    function triad(a, b) {
        const z = unit(cross(a, b));
        return [a, cross(z, a), z];
    }

    function pairRotation(camera, first, second) {
        const sky = triad(first, second);
        return [0, 1, 2].map(i => toSky(sky, camera.map(v => v[i])));
    }

    function associate(index, basis, points, radius, limitMag, vector) {
        const matches = [], used = new Set();
        for (const point of points) {
            const expected = toSky(basis, point.ray);
            const match = nearest(index, expected, radius, limitMag, vector);
            if (!match || used.has(match.star.hip)) continue;
            used.add(match.star.hip);
            matches.push({ point, ...match });
        }
        return matches;
    }

    // Solve the small-angle Wahba normal equations in the tangent space of SO(3).
    function refine(basis, matches) {
        for (let step = 0; step < 4; step++) {
            let n = 0, rhs = [0, 0, 0];
            const cols = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (const { point, ref } of matches) {
                const predicted = toSky(basis, point.ray);
                const w = clamp(Math.sqrt(point.snr / 12), 0.6, 2.5);
                rhs = add(rhs, scale(cross(predicted, ref), w));
                for (let i = 0; i < 3; i++) cols[i] = add(cols[i], scale(predicted, -w * predicted[i]));
                n += w;
            }
            for (let i = 0; i < 3; i++) cols[i][i] += n;
            const [a, b, c] = cols;
            const rows = [cross(b, c), cross(c, a), cross(a, b)];
            const determinant = dot(a, rows[0]);
            if (determinant < 1e-8) return basis;
            const delta = rows.map(row => dot(row, rhs) / determinant);
            const size = norm(delta);
            if (size < 1e-10) break;
            const axis = scale(delta, 1 / size);
            basis = basis.map(v => M.rotate(v, axis, size));
        }
        return basis;
    }

    function identify(index, points, camera, options) {
        const min = options.minMatches;
        if (points.length < min) return { reason: 'Too few usable centroids' };

        // The only attitude input is an optional previous image solution. Time and beta are optional calibration.
        const { years = index.year, beta, prior } = options;
        const vector = star => M.catalogVector(star, years, beta);
        const pixelAngle = 1 / camera.focal;
        const fine = Math.max(28 / ARCSEC, 1.0 * pixelAngle);
        const broad = Math.max(0.10 * DEG, 2.2 * pixelAngle);
        const probes = points.slice(0, 10);
        const limit = 7.5;
        const finalize = (basis, radius, mode) => {
            let matches = associate(index, basis, points, radius, limit, vector);
            if (matches.length < min) return null;
            basis = refine(basis, matches);
            matches = associate(index, basis, points, fine, limit, vector);
            if (matches.length < min) return null;
            basis = refine(basis, matches);
            matches = matches.map(({ point, star, ref }) => ({
                x: point.x, y: point.y, flux: point.flux, snr: point.snr, hip: star.hip, name: star.name, mag: star.mag,
                error: angle(toSky(basis, point.ray), ref) * ARCSEC
            })).filter(match => match.error <= fine * ARCSEC);
            if (matches.length < min) return null;
            const rms = Math.sqrt(matches.reduce((sum, match) => sum + match.error ** 2, 0) / matches.length);
            return { basis, mode, matches, rms };
        };

        if (prior) {
            const tracked = finalize(prior, broad, 'Tracking');
            if (tracked) return tracked;
        }

        const seeds = points.slice(0, 9);
        const pairs = [];
        for (let i = 0; i < seeds.length; i++) {
            for (let j = 0; j < i; j++) {
                const a = seeds[j], b = seeds[i];
                const separation = angle(a.ray, b.ray) / DEG;
                if (separation >= MIN_SEP + 0.1 && separation <= MAX_SEP - 0.1) {
                    const priority = i + j + 21 / separation;
                    pairs.push({ a, b, separation, priority, camera: triad(a.ray, b.ray) });
                }
            }
        }
        pairs.sort((a, b) => a.priority - b.priority);
        const tolerance = Math.max(0.055, 1.25 * pixelAngle / DEG);
        let best = null, alternative = null;
        const comparable = (a, b) => a.matches.length <= b.matches.length + 1 && b.rms < a.rms * 1.65 + 3;
        const stronger = (a, b) => a.matches.length > b.matches.length || (a.matches.length === b.matches.length && a.rms < b.rms);
        for (const { a, b, separation, camera: tri } of pairs.slice(0, 26)) {
            const low = Math.floor((separation - tolerance) / PAIR_BIN), high = Math.floor((separation + tolerance) / PAIR_BIN);
            const other = probes.filter(point => point !== a && point !== b);
            const fluxDelta = 2.5 * Math.log10(a.flux / b.flux);
            for (let bin = low; bin <= high; bin++) {
                for (const code of index.bins[bin] || []) {
                    const first = index.seed[Math.floor(code / index.seed.length)], second = index.seed[code % index.seed.length];
                    const magDelta = second.mag - first.mag;
                    for (const reversed of [false, true]) {
                        if (Math.abs(fluxDelta - (reversed ? -magDelta : magDelta)) > 2.8) continue;
                        const basis = pairRotation(tri, reversed ? second.ref : first.ref, reversed ? first.ref : second.ref);
                        // A third and fourth vote are required before an expensive fit.
                        let votes = 2;
                        for (let p = 0; p < other.length; p++) {
                            if (nearest(index, toSky(basis, other[p].ray), broad, 6.4, null)) votes++;
                            if (votes >= Math.min(5, min) || (p === 3 && votes === 2)) break;
                        }
                        if (votes < Math.min(5, min)) continue;
                        const result = finalize(basis, broad, 'Acquired');
                        if (!result) continue;
                        if (best && M.rotationError(best.basis, result.basis) < broad * 2) {
                            if (stronger(result, best)) best = result;
                        } else if (!best || stronger(result, best)) {
                            alternative = best;
                            best = result;
                        } else if (!alternative || stronger(result, alternative)) alternative = result;
                        if (best.matches.length >= Math.max(8, min + 3) && best.rms < fine * ARCSEC * 0.58
                            && (!alternative || best.matches.length > alternative.matches.length + 2)) return best;
                    }
                }
            }
            if (best && best.matches.length >= min + 2 && best.rms < fine * ARCSEC * 0.5
                && (!alternative || best.matches.length > alternative.matches.length + 1)) return best;
        }
        if (best && (!alternative || !comparable(best, alternative))) return best;
        return { reason: best ? 'Competing catalog solutions' : 'No consistent catalog pattern' };
    }

    function solve(index, pixels, settings, options = {}) {
        const camera = M.camera(settings, settings.calibrated);
        const detections = detect(pixels, camera, options.threshold ?? 4.5);
        const fit = identify(index, detections, camera, { minMatches: 5, ...options });
        return { ...fit, detections };
    }

    root.StarSolve = { buildIndex, detect, solve };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarSolve;
})(typeof self !== 'undefined' ? self : globalThis);
