(function (root) {
    'use strict';

    const M = root.StarMath || require('./math.js');
    const { DEG, ARCSEC, dot, cross, scale, add, sub, norm, unit, angle, clamp, toSky } = M;
    const PAIR_BIN = 0.045;
    const MAX_SEP = 48;
    const MIN_SEP = 1.6;
    const CELL_SCALE = 24;
    const SEED_MAG = 5.55;

    // Iteratively Gaussian-weighted centroid. It starts from the thresholded moment and converges to the window
    // position where the weighted first moment vanishes, which removes most threshold bias for faint or broad stars.
    function windowed(pixels, w, h, x, y, bg, gx, gy, width) {
        const k = -0.5 / (width * width), x0 = Math.round(x), y0 = Math.round(y);
        let cx = x, cy = y;
        for (let step = 0; step < 6; step++) {
            const ix = Math.round(cx), iy = Math.round(cy);
            if (ix < 3 || iy < 3 || ix > w - 4 || iy > h - 4) return [x, y];
            let sum = 0, mx = 0, my = 0;
            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const ox = ix + dx - cx, oy = iy + dy - cy;
                    const sky = bg + gx * (ix + dx - x0) + gy * (iy + dy - y0);
                    const value = (pixels[(iy + dy) * w + ix + dx] - sky) * Math.exp((ox * ox + oy * oy) * k);
                    sum += value;
                    mx += ox * value;
                    my += oy * value;
                }
            }
            if (!(sum > 0)) return [x, y];
            const shiftX = 2 * mx / sum, shiftY = 2 * my / sum;
            cx += shiftX;
            cy += shiftY;
            if (Math.hypot(cx - x, cy - y) > 1.5) return [x, y];
            if (Math.abs(shiftX) + Math.abs(shiftY) < 1e-4) break;
        }
        return [cx, cy];
    }

    // Largest share of a star's 5 × 5 flux that can fall in one pixel: a pixel-integrated Gaussian centered on a pixel.
    function sharpest(psf) {
        const core = M.erf(0.5 / (psf * Math.SQRT2)), box = M.erf(2.5 / (psf * Math.SQRT2));
        return (core * core) / (box * box);
    }

    // Flood-fill the connected pixels above `cut` around a peak and return their flux-weighted centroid and shape.
    // A slewing camera smears stars into streaks longer than the 7 × 7 window, and only the whole region locates them.
    function region(pixels, w, h, start, bg, gx, gy, cut, label, id) {
        const x0 = start % w, y0 = (start - x0) / w, stack = [start];
        let n = 0, flux = 0, mx = 0, my = 0, xx = 0, yy = 0, xy = 0;
        label[start] = id;
        while (stack.length) {
            const i = stack.pop(), x = i % w, y = (i - x) / w, dx = x - x0, dy = y - y0;
            const v = pixels[i] - bg - gx * dx - gy * dy;
            n++;
            flux += v;
            mx += v * dx;
            my += v * dy;
            xx += v * dx * dx;
            yy += v * dy * dy;
            xy += v * dx * dy;
            if (n > 1500) return null;
            for (const [j, jx, jy] of [[i - 1, x - 1, y], [i + 1, x + 1, y], [i - w, x, y - 1], [i + w, x, y + 1]]) {
                if (jx < 1 || jy < 1 || jx >= w - 1 || jy >= h - 1 || label[j] === id) continue;
                if (Math.abs(jx - x0) > 48 || Math.abs(jy - y0) > 48) return null;
                if (pixels[j] - bg - gx * (jx - x0) - gy * (jy - y0) > cut) {
                    label[j] = id;
                    stack.push(j);
                }
            }
        }
        const cx = mx / flux, cy = my / flux;
        const vx = xx / flux - cx * cx, vy = yy / flux - cy * cy, cov = xy / flux - cx * cy;
        const mean = (vx + vy) / 2, spread = Math.hypot((vx - vy) / 2, cov);
        return { x: x0 + cx, y: y0 + cy, flux, major: mean + spread, minor: mean - spread,
            angle: 0.5 * Math.atan2(2 * cov, vx - vy), length: Math.sqrt(12 * (mean + spread)) };
    }

    function detect(pixels, camera, threshold, psf) {
        const { width: w, height: h } = camera;
        const points = [], streaks = [], label = new Int32Array(w * h);
        let regions = 0;
        // Particle hits deposit charge in one or a few pixels and look sharper than the optics allow.
        const sharpLimit = psf ? 1.25 * sharpest(psf) + 0.03 : Infinity;
        const minWidth = psf ? 0.3 * psf * psf : 0.2;
        const ring = [-4 * w - 3, -4 * w + 3, -3 * w + 4, 3 * w + 4, 4 * w + 3, 4 * w - 3, 3 * w - 4, -3 * w - 4];
        const grow = peak => region(pixels, w, h, peak.i, peak.bg, peak.gx, peak.gy,
            Math.max(2.5 * peak.sigma, 0.25 * peak.contrast), label, ++regions);
        for (let y = 4; y < h - 4; y++) {
            for (let x = 4; x < w - 4; x++) {
                const i = y * w + x, peak = pixels[i];
                if (peak < 12 || peak <= pixels[i - 1] || peak < pixels[i + 1] || peak <= pixels[i - w] || peak < pixels[i + w]
                    || peak < pixels[i - w - 1] || peak < pixels[i - w + 1] || peak < pixels[i + w - 1] || peak < pixels[i + w + 1]) continue;
                const raw = ring.map(offset => pixels[i + offset]);
                // Opposite ring pixels give a least-squares background slope; stray light and glints are not flat.
                const gx = ((raw[1] - raw[5]) * 6 + (raw[2] - raw[6]) * 8 + (raw[3] - raw[7]) * 8 - (raw[0] - raw[4]) * 6) / 200;
                const gy = ((raw[3] - raw[7]) * 6 - (raw[2] - raw[6]) * 6 + (raw[4] - raw[0]) * 8 + (raw[5] - raw[1]) * 8) / 200;
                const ringValues = raw.slice().sort((a, b) => a - b);
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
                if (flux < 27) continue;
                cx /= flux;
                cy /= flux;
                const vx = xx / flux - cx * cx, vy = yy / flux - cy * cy, cov = xy / flux - cx * cy;
                const axisRatio = Math.hypot(vx - vy, 2 * cov) / (vx + vy);
                const seed = { i, bg, gx, gy, sigma, contrast, snr: contrast / sigma };
                if (axisRatio > 0.78 || outer > flux * 0.39) {
                    // Elongated or extended: measure the whole connected region as a possible streak.
                    if (label[i]) continue;
                    const shape = grow(seed);
                    if (shape && shape.major > 1.5 && shape.minor > minWidth) streaks.push({ ...seed, ...shape, id: regions });
                    continue;
                }
                if (core < cap * 1.6 || vx + vy < 0.4 || Math.abs(cx) > 1.25 || Math.abs(cy) > 1.25) continue;
                if (sharpLimit < 1) {
                    let total = 0;
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) total += pixels[i + dy * w + dx] - bg - gx * dx - gy * dy;
                    }
                    if (contrast > sharpLimit * total) continue;
                }
                const [px, py] = windowed(pixels, w, h, x + cx, y + cy, bg, gx, gy, Math.sqrt(clamp((vx + vy) / 2 + 0.15, 0.64, 4)));
                points.push({ ...seed, x: px, y: py, flux });
            }
        }

        // A slew smears every star the same way. Treat the frame as smeared only when at least three elongated
        // regions share one direction; isolated elongated sources are particle tracks, glints or blends.
        let smear = null;
        if (streaks.length >= 3) {
            let c = 0, s = 0, total = 0;
            for (const streak of streaks) {
                c += streak.flux * Math.cos(2 * streak.angle);
                s += streak.flux * Math.sin(2 * streak.angle);
                total += streak.flux;
            }
            const lengths = streaks.map(streak => streak.length).sort((a, b) => a - b);
            if (Math.hypot(c, s) > 0.6 * total) smear = { angle: 0.5 * Math.atan2(s, c), length: lengths[lengths.length >> 1] };
        }
        const along = shape => {
            const turn = Math.abs(Math.atan2(Math.sin(2 * (shape.angle - smear.angle)), Math.cos(2 * (shape.angle - smear.angle)))) / 2;
            return turn < 14 * DEG && shape.length > smear.length / 2 && shape.length < smear.length * 2;
        };
        let sources = points;
        if (smear) {
            // Bright smeared stars saturate into plateaus whose ends can pass as compact peaks. Re-grow every
            // compact detection, replace those that belong to a streak with the streak centroid, and merge duplicates.
            const accepted = new Set(), merged = [];
            for (const streak of streaks) {
                if (along(streak)) {
                    accepted.add(streak.id);
                    merged.push(streak);
                }
            }
            for (const point of points) {
                if (accepted.has(label[point.i])) continue;
                const shape = grow(point);
                if (shape && along(shape)) {
                    accepted.add(regions);
                    merged.push({ ...point, ...shape });
                } else merged.push(point);
            }
            sources = merged;
        }
        sources.sort((a, b) => b.flux - a.flux);
        const distinct = [];
        for (const point of sources) {
            if (distinct.length >= 96) break;
            if (!distinct.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 4)) {
                distinct.push({ x: point.x, y: point.y, flux: point.flux, snr: point.snr, streak: !!point.length,
                    ray: M.ray(camera, point.x, point.y) });
            }
        }
        return distinct;
    }

    const cell = v => Math.floor((v + 1) * CELL_SCALE);
    const key = (x, y, z) => (x * 64 + y) * 64 + z;

    function buildIndex(catalog, year = 26) {
        const stars = catalog.map(({ hip, mag, inst = mag, bv, name, v, motion }) => ({ hip, mag, inst, bv, name, v, motion,
            ref: M.catalogVector({ v, motion }, year) })).sort((a, b) => a.inst - b.inst);
        const seed = stars.filter(star => star.inst <= SEED_MAG);
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
                        if (star.inst > limitMag) break;
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

    // Brightest other catalog star within radius, used to flag centroids that blend with a neighbor.
    function neighbor(index, star, radius) {
        const [x, y, z] = star.ref, cut = Math.cos(radius);
        let brightest = Infinity;
        for (let i = cell(clamp(x - radius, -1, 1)); i <= cell(clamp(x + radius, -1, 1)); i++) {
            for (let j = cell(clamp(y - radius, -1, 1)); j <= cell(clamp(y + radius, -1, 1)); j++) {
                for (let k = cell(clamp(z - radius, -1, 1)); k <= cell(clamp(z + radius, -1, 1)); k++) {
                    for (const other of index.grid.get(key(i, j, k)) || []) {
                        if (other.inst >= brightest) break;
                        if (other !== star && dot(star.ref, other.ref) > cut) brightest = other.inst;
                    }
                }
            }
        }
        return brightest;
    }

    // Catalog stars down to `limit` that project inside the frame for this attitude.
    function inFrame(index, basis, camera, limit) {
        const bore = basis[2], radius = Math.acos(M.ray(camera, 0, 0)[2]), cut = Math.cos(radius);
        const span = 2 * Math.sin(radius / 2) + 0.002;
        let count = 0;
        for (let i = cell(clamp(bore[0] - span, -1, 1)); i <= cell(clamp(bore[0] + span, -1, 1)); i++) {
            for (let j = cell(clamp(bore[1] - span, -1, 1)); j <= cell(clamp(bore[1] + span, -1, 1)); j++) {
                for (let k = cell(clamp(bore[2] - span, -1, 1)); k <= cell(clamp(bore[2] + span, -1, 1)); k++) {
                    for (const star of index.grid.get(key(i, j, k)) || []) {
                        if (star.inst > limit) break;
                        if (dot(star.ref, bore) < cut) continue;
                        const [x, y] = M.project(camera, M.toCamera(basis, star.ref));
                        if (x >= 0 && y >= 0 && x < camera.width && y < camera.height) count++;
                    }
                }
            }
        }
        return count;
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

    function inverse([a, b, c]) {
        const rows = [cross(b, c), cross(c, a), cross(a, b)];
        const determinant = dot(a, rows[0]);
        return determinant > 0 ? rows.map(row => scale(row, 1 / determinant)) : null;
    }

    // Weighted Gauss-Newton on the small-angle Wahba problem in the tangent space of SO(3). Each centroid carries
    // a noise model from its SNR; Cauchy reweighting then suppresses blends, faint neighbors and false matches.
    // Returns the rotation and its covariance in camera axes (rad²), scaled by the a posteriori residual variance.
    function refine(basis, matches, pixelAngle, robust = true) {
        const prior = matches.map(({ point, blended }) => {
            const sigma = Math.hypot(0.04, 1.3 / Math.max(point.snr, 1)) * pixelAngle;
            return (blended ? 0.05 : 1) / (sigma * sigma);
        });
        let weights = prior.slice(), robustness = prior.map(() => 1), normal = null;
        for (let step = 0; step < 8; step++) {
            let rhs = [0, 0, 0];
            const cols = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            matches.forEach(({ point, ref }, m) => {
                const predicted = toSky(basis, point.ray), w = weights[m];
                rhs = add(rhs, scale(cross(predicted, ref), w));
                for (let i = 0; i < 3; i++) cols[i] = add(cols[i], scale(predicted, -w * predicted[i]));
                cols[0][0] += w;
                cols[1][1] += w;
                cols[2][2] += w;
            });
            normal = cols;
            const inv = inverse(cols);
            if (!inv) return { basis };
            const delta = inv.map(row => dot(row, rhs));
            basis = M.spin(basis, delta);
            if (robust && matches.length > 4) {
                const errors = matches.map(({ point, ref }) => angle(toSky(basis, point.ray), ref));
                const sorted = errors.slice().sort((a, b) => a - b);
                // Median of a two-axis Gaussian error norm is 1.1774 σ.
                const spread = Math.max(0.03 * pixelAngle, sorted[sorted.length >> 1] / 1.1774);
                robustness = errors.map(error => 1 / (1 + (error / (2.5 * spread)) ** 2));
                weights = prior.map((w, m) => w * robustness[m]);
            }
            if (norm(delta) < 1e-10 && step > 1) break;
        }
        let chi = 0;
        matches.forEach(({ point, ref }, m) => { chi += weights[m] * angle(toSky(basis, point.ray), ref) ** 2; });
        const dof = Math.max(1, 2 * matches.length - 3);
        const inv = inverse(normal);
        const trust = matches.map(({ blended }, m) => robustness[m] * (blended ? 0.05 : 1));
        if (!inv) return { basis, trust };
        // Rotate the inertial covariance into camera axes: C_cam = Bᵀ C B.
        const cov = basis.map(u => basis.map(v => dot(u, inv.map(row => dot(row, v))))).map(row => row.map(v => v * chi / dof));
        return { basis, cov, trust };
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
        const blendRadius = 2.5 * pixelAngle;
        const finalize = (basis, radius, mode) => {
            let matches = associate(index, basis, points, radius, limit, vector);
            if (matches.length < min) return null;
            basis = refine(basis, matches, pixelAngle).basis;
            matches = associate(index, basis, points, fine, limit, vector);
            if (matches.length < min) return null;
            for (const match of matches) match.blended = neighbor(index, match.star, blendRadius) < match.star.inst + 2.5;
            const fit = refine(basis, matches, pixelAngle);
            basis = fit.basis;
            matches = matches.map(({ point, star, ref, blended }, m) => {
                const local = M.toCamera(basis, ref);
                const [px, py] = local[2] > 0 ? M.project(camera, local) : [NaN, NaN];
                return { x: point.x, y: point.y, px, py, flux: point.flux, snr: point.snr, hip: star.hip, name: star.name,
                    mag: star.mag, inst: star.inst, bv: star.bv, blended, weight: fit.trust?.[m] ?? 1,
                    error: angle(toSky(basis, point.ray), ref) * ARCSEC };
            }).filter(match => match.error <= fine * ARCSEC);
            if (matches.length < min) return null;
            // Residual RMS over the stars the robust fit trusts; blends and outliers are reported separately.
            const core = matches.filter(match => match.weight >= 0.5);
            const rms = Math.sqrt((core.length ? core : matches).reduce((sum, match) => sum + match.error ** 2, 0) / (core.length || matches.length));
            // Reject chance alignments. A random centroid lands within the match radius of some catalog star with
            // probability p = N·πr²/A, so chance matches are Poisson with mean λ = n·p. The search tries many
            // hypotheses and refines the best, so the trusted matches must clear λ by a wide margin.
            const expected = inFrame(index, basis, camera, limit);
            const chance = points.length * expected * Math.PI * (fine / pixelAngle) ** 2 / (camera.width * camera.height);
            if (core.length < Math.max(min, chance + 6 * Math.sqrt(chance) + 3)) return null;
            const sigma = fit.cov ? { cross: Math.sqrt(fit.cov[0][0] + fit.cov[1][1]) * ARCSEC, roll: Math.sqrt(fit.cov[2][2]) * ARCSEC } : null;
            return { basis, mode, matches, rms, sigma, expected, chance };
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
                    const magDelta = second.inst - first.inst;
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
        const detections = detect(pixels, camera, options.threshold ?? 4.5, settings.psf);
        const fit = identify(index, detections, camera, { minMatches: 5, ...options });
        return { ...fit, detections };
    }

    root.StarSolve = { buildIndex, detect, solve };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarSolve;
})(typeof self !== 'undefined' ? self : globalThis);
