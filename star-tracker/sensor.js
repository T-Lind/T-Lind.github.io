(function (root) {
    'use strict';

    const M = root.StarMath || require('./math.js');
    const O = root.SpaceOrbit || require('../space/lib/orbit.js');
    const { DEG, dot, cross, scale, add, sub, norm, unit, angle, clamp, rotate, direction } = M;
    const EARTH = 6378.137;
    const AU = 149597870.7;
    const FULL_WELL = 12000;
    const BIAS = 96;
    // Detected electrons per second per square meter of entrance pupil from a magnitude-zero star:
    // 8.8e9 photons over the assumed passband times 45% combined optical transmission and quantum efficiency.
    const ZERO_POINT = 8.8e9 * 0.45;
    // A 1 cm² active area behind roughly 4 mm of aluminum-equivalent shielding sets the particle hit rate.
    const DETECTOR_AREA = 1;
    const PROTON_THRESHOLD = 30;
    const sin = x => Math.sin(x * DEG);
    const cos = x => Math.cos(x * DEG);
    const ECLIPTIC_POLE = direction(270 * DEG, 66.560708 * DEG);
    const GALACTIC_POLE = direction(192.85948 * DEG, 27.12825 * DEG);
    // Centered dipole axis near the 2025 IGRF geomagnetic north pole (80.8° N, 72.6° W), in Earth-fixed axes.
    const DIPOLE = direction(-72.6 * DEG, 80.8 * DEG);

    const defaults = { width: 320, height: 240, fov: 24, aperture: 35, exposure: 90, psf: 0.9,
        distortion: -0.12, readNoise: 3, baffle: 27, seed: 12345, ra: 83, dec: -4, roll: 18, slew: 0, rollRate: 0,
        jitter: 14, mode: 'inertial', calibrated: true, aberration: true, noise: true, glare: true, glint: true,
        particles: true, faint: true };

    // IAU 1976 mean-of-date precession. TEME nutation and its small equinox correction are omitted.
    function fromDate(v, t) {
        const zeta = (2306.2181 * t + 0.30188 * t ** 2 + 0.017998 * t ** 3) * DEG / 3600;
        const z = (2306.2181 * t + 1.09468 * t ** 2 + 0.018203 * t ** 3) * DEG / 3600;
        const theta = (2004.3109 * t - 0.42665 * t ** 2 - 0.041833 * t ** 3) * DEG / 3600;
        return rotate(rotate(rotate(v, [0, 0, 1], -z), [0, 1, 0], theta), [0, 0, 1], -zeta);
    }

    function sunPosition(days) {
        const g = 357.529 + 0.98560028 * days;
        const lon = 280.459 + 0.98564736 * days + 1.915 * sin(g) + 0.020 * sin(2 * g);
        const distance = AU * (1.00014 - 0.01671 * cos(g) - 0.00014 * cos(2 * g));
        return ecliptic(lon, 0, distance, days);
    }

    function ecliptic(lon, lat, distance, days) {
        const v = rotate(direction(lon * DEG, lat * DEG), [1, 0, 0], (23.4393 - 0.00000036 * days) * DEG);
        return scale(fromDate(v, days / 36525), distance);
    }

    function moonPosition(days) {
        const t = days / 36525;
        const lon = 218.32 + 481267.881 * t + 6.29 * sin(135 + 477198.87 * t) - 1.27 * sin(259.3 - 413335.36 * t)
            + 0.66 * sin(235.7 + 890534.22 * t) + 0.21 * sin(269.9 + 954397.74 * t)
            - 0.19 * sin(357.5 + 35999.05 * t) - 0.11 * sin(186.5 + 966404.03 * t);
        const lat = 5.13 * sin(93.3 + 483202.02 * t) + 0.28 * sin(228.2 + 960400.89 * t)
            - 0.28 * sin(318.3 + 6003.15 * t) - 0.17 * sin(217.6 - 407332.21 * t);
        const parallax = 0.9508 + 0.0518 * cos(135 + 477198.87 * t) + 0.0095 * cos(259.3 - 413335.36 * t)
            + 0.0078 * cos(235.7 + 890534.22 * t) + 0.0028 * cos(269.9 + 954397.74 * t);
        return ecliptic(lon, lat, EARTH / sin(parallax), days);
    }

    function sunFraction(separation, earthRadius, sunRadius) {
        if (separation >= earthRadius + sunRadius) return 1;
        if (separation <= earthRadius - sunRadius) return 0;
        // At the small apparent solar radius, approximate the Earth limb by a line across the solar disk.
        const d = clamp((separation - earthRadius) / sunRadius, -1, 1);
        return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
    }

    function environment(satrec, time) {
        const state = O.stateAt(satrec, new Date(time));
        if (!state?.velocity) throw new Error('SGP4 could not propagate this orbit at the selected time.');
        const days = M.days(time);
        const pos = fromDate(Object.values(state.position), days / 36525);
        const velocity = fromDate(Object.values(state.velocity), days / 36525);
        const distance = norm(pos);
        if (!Number.isFinite(distance) || distance <= EARTH) throw new Error('The propagated spacecraft is inside the model Earth.');
        const nadir = scale(pos, -1 / distance);
        const sunGeo = sunPosition(days), moonGeo = moonPosition(days);
        const sunRel = sub(sunGeo, pos), moonRel = sub(moonGeo, pos);
        const sun = unit(sunRel), moon = unit(moonRel), sunLight = unit(sunGeo);
        const earthRadius = Math.asin(EARTH / distance);
        const sunRadius = Math.asin(695700 / norm(sunRel));
        const moonRadius = Math.asin(1737.4 / norm(moonRel));
        const moonPhaseAngle = angle(sub(sunGeo, moonGeo), scale(moonRel, -1));
        const moonPhase = (Math.sin(moonPhaseAngle) + (Math.PI - moonPhaseAngle) * Math.cos(moonPhaseAngle)) / Math.PI;
        const earthVelocity = scale(sub(sunPosition(days - 0.025), sunPosition(days + 0.025)), 1 / 4320);
        const beta = scale(add(earthVelocity, velocity), 1 / 299792.458);
        const gmst = O.gmst(new Date(time));
        const geo = O.geodetic(state.position, gmst);
        const magneticLatitude = Math.asin(clamp(dot(direction(geo.lon * DEG, geo.lat * DEG), DIPOLE), -1, 1));
        return { pos, velocity, distance, nadir, sun, moon, sunLight, earthRadius, sunRadius, moonRadius, moonPhase,
            moonVisible: angle(nadir, moon) > earthRadius, sunlight: sunFraction(angle(nadir, sun), earthRadius, sunRadius),
            beta, years: days / 365.25, gmst, geo, dipoleL: distance / EARTH / Math.cos(magneticLatitude) ** 2 };
    }

    // Zodiacal light follows the shape of the Leinert et al. (1998) table and diffuse galactic light rises toward
    // the Milky Way. Units are 1e-8 W m^-2 sr^-1 µm^-1 near 500 nm, where 77 is the ecliptic pole (V ≈ 23.3 mag/arcsec²).
    function skyBrightness(boresight, sun) {
        const ecliptic = Math.asin(clamp(dot(boresight, ECLIPTIC_POLE), -1, 1)) / DEG;
        const flat = v => sub(v, scale(ECLIPTIC_POLE, dot(v, ECLIPTIC_POLE)));
        const longitude = angle(flat(boresight), flat(sun)) / DEG;
        const plane = longitude < 90 ? 259 / Math.sin(Math.max(15, longitude) * DEG) ** 2.3
            : 180 + 79 * Math.cos((longitude - 90) * DEG) ** 2;
        const falloff = b => 1 / (1 + (Math.abs(b) / 22) ** 1.8);
        const zodiacal = 77 + (plane - 77) * (falloff(ecliptic) - falloff(90)) / (1 - falloff(90));
        const galactic = Math.asin(clamp(dot(boresight, GALACTIC_POLE), -1, 1)) / DEG;
        return { zodiacal, galactic: 30 + 150 * Math.exp(-Math.abs(galactic) / 10), galacticLatitude: galactic };
    }

    // Free-space cosmic rays (about 4 cm^-2 s^-1) are cut off by Störmer rigidity and shadowed by Earth.
    function cosmicRays(scene, L) {
        const cutoff = 14.9 / (L * L);
        return 4 / (1 + (cutoff / 2.5) ** 1.4) * (1 + Math.cos(scene.earthRadius)) / 2;
    }

    // Stars between the catalog limit and V = 10 follow N(<V) ∝ 10^(0.45 V), normalized to the catalog count at
    // V = 7.5 and concentrated toward the galactic plane. Each cube-map sky cell has a fixed seed, so a faint star
    // keeps its sky position from frame to frame.
    const FAINT = { limit: 10, cells: 32, count: 25700 * (10 ** (0.45 * 2.5) - 1), cache: new Map(), centers: null };
    function face(f, a, b) {
        return [[1, a, b], [-1, a, b], [a, 1, b], [a, -1, b], [a, b, 1], [a, b, -1]][f];
    }
    function faintCells() {
        if (FAINT.centers) return FAINT.centers;
        const n = FAINT.cells, size = 2 / n, centers = [];
        for (let f = 0; f < 6; f++) {
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const a = -1 + (i + 0.5) * size, b = -1 + (j + 0.5) * size;
                    centers.push({ id: (f * n + i) * n + j, f, a, b, v: unit(face(f, a, b)),
                        solid: size * size / (1 + a * a + b * b) ** 1.5 });
                }
            }
        }
        return (FAINT.centers = centers);
    }
    function faintStars(cell) {
        let stars = FAINT.cache.get(cell.id);
        if (stars) return stars;
        const rand = random(Math.imul(cell.id + 1, 0x2c1b3c6d) ^ 0x51ed27);
        const latitude = Math.asin(clamp(dot(cell.v, GALACTIC_POLE), -1, 1));
        const density = 0.5 + 2.4 * Math.exp(-Math.abs(latitude) / 0.21);
        const count = shot(cell.solid * density * FAINT.count / (4 * Math.PI), rand);
        const range = 10 ** (0.45 * (FAINT.limit - 7.5)) - 1, size = 2 / FAINT.cells;
        stars = [];
        for (let i = 0; i < count; i++) {
            const v = unit(face(cell.f, cell.a + (rand() - 0.5) * size, cell.b + (rand() - 0.5) * size));
            const mag = 7.5 + Math.log10(1 + rand() * range) / 0.45;
            const bv = clamp(0.75 + 0.35 * normal(rand), -0.3, 2);
            stars.push({ v, motion: [0, 0, 0], mag, inst: M.instrumentMag(mag, bv) });
        }
        if (FAINT.cache.size > 900) FAINT.cache.clear();
        FAINT.cache.set(cell.id, stars);
        return stars;
    }
    function faintField(boresight, radius) {
        const cut = Math.cos(radius + 2.3 * DEG), stars = [];
        for (const cell of faintCells()) if (dot(cell.v, boresight) > cut) stars.push(...faintStars(cell));
        return stars;
    }

    function pointing(scene, s, elapsed) {
        let basis = M.attitude(s.ra, s.dec, s.roll);
        if (s.mode !== 'inertial') {
            const up = scale(scene.nadir, -1);
            const along = unit(sub(scene.velocity, scale(up, dot(scene.velocity, up))));
            const forward = s.mode === 'zenith' ? up : along;
            const x = s.mode === 'zenith' ? along : up;
            const local = [x, cross(forward, x), forward];
            // Interpret RA/Dec as offsets from local forward in the same right/down convention.
            const localOffset = M.attitude(-s.ra, -s.dec, s.roll);
            basis = localOffset.map(([z, west, north]) => M.toSky(local, [-west, -north, z]));
        } else {
            if (s.slew) {
                const axis = basis[1];
                basis = basis.map(v => rotate(v, axis, M.wrap(s.slew * elapsed) * DEG));
            }
            if (s.rollRate) {
                const axis = basis[2];
                basis = basis.map(v => rotate(v, axis, M.wrap(s.rollRate * elapsed) * DEG));
            }
        }
        return basis;
    }

    function jittered(basis, arcsec, elapsed) {
        const phase = arcsec / M.ARCSEC;
        const x = phase * (0.78 * Math.sin(48.7 * elapsed) + 0.22 * Math.sin(109.1 * elapsed));
        const y = phase * (0.66 * Math.sin(36.3 * elapsed + 0.6) + 0.34 * Math.sin(82.7 * elapsed));
        return basis.map(v => rotate(rotate(v, basis[0], x), basis[1], y));
    }

    function random(seed) {
        let n = seed >>> 0;
        return () => {
            n = (n + 0x6d2b79f5) >>> 0;
            let t = Math.imul(n ^ (n >>> 15), n | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function normal(rand) {
        return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    }

    function shot(mean, rand) {
        if (mean >= 28) return Math.max(0, mean + Math.sqrt(mean) * normal(rand));
        const end = Math.exp(-mean);
        let p = rand(), n = 0;
        while (p > end) { p *= rand(); n++; }
        return n;
    }

    // Gaussian point spread integrated over each square pixel, so undersampled stars carry real pixel-phase bias.
    const columns = new Float64Array(4096), rows = new Float64Array(4096);
    function splat(image, c, x, y, flux, sigma) {
        const r = Math.ceil(sigma * 3.6 + 0.5);
        const x0 = Math.max(0, Math.round(x) - r), x1 = Math.min(c.width - 1, Math.round(x) + r, x0 + 4095);
        const y0 = Math.max(0, Math.round(y) - r), y1 = Math.min(c.height - 1, Math.round(y) + r, y0 + 4095);
        if (x0 > x1 || y0 > y1) return;
        const k = 1 / (sigma * Math.SQRT2);
        let previous = M.erf((x0 - 0.5 - x) * k);
        for (let i = x0; i <= x1; i++) {
            const next = M.erf((i + 0.5 - x) * k);
            columns[i - x0] = 0.5 * (next - previous);
            previous = next;
        }
        previous = M.erf((y0 - 0.5 - y) * k);
        for (let j = y0; j <= y1; j++) {
            const next = M.erf((j + 0.5 - y) * k);
            rows[j - y0] = 0.5 * flux * (next - previous);
            previous = next;
        }
        for (let j = y0; j <= y1; j++) {
            const row = rows[j - y0], offset = j * c.width;
            if (row === 0) continue;
            for (let i = x0; i <= x1; i++) image[offset + i] += row * columns[i - x0];
        }
    }

    function viewing(scene, basis) {
        const sun = M.toCamera(basis, scene.sun), moon = M.toCamera(basis, scene.moon), nadir = M.toCamera(basis, scene.nadir);
        const sunDeg = Math.acos(clamp(sun[2], -1, 1)) / DEG;
        const moonDeg = Math.acos(clamp(moon[2], -1, 1)) / DEG;
        const limb = Math.acos(clamp(nadir[2], -1, 1)) / DEG - scene.earthRadius / DEG;
        return { sun, moon, nadir, sunDeg, moonDeg, limb };
    }

    function background(image, c, scene, basis, view, s, elapsed, sky) {
        const exposure = s.exposure / 100;
        const aperture = (s.aperture / defaults.aperture) ** 2;
        const { sun, moon, nadir, sunDeg, moonDeg, limb } = view;
        const earthCut = Math.cos(scene.earthRadius);
        const nearEarth = limb < s.fov * 0.65 + 2;
        const sunGlare = s.glare && sunDeg < 100 ? 1050 * scene.sunlight * Math.exp((s.baffle - sunDeg) / 7) : 0;
        const moonGlare = s.glare && scene.moonVisible ? 21 * scene.moonPhase * Math.exp(Math.min(2, (9 - moonDeg) / 7)) : 0;
        const earthLit = clamp(0.5 - 0.5 * dot(scene.nadir, scene.sunLight), 0, 1);
        const earthGlare = s.glare ? 650 * earthLit * Math.exp(-Math.max(0, limb) / 5) : 0;
        const sunCut = Math.cos(scene.sunRadius), moonCut = Math.cos(scene.moonRadius);
        const sunDisk = scene.sunlight > 0 && sunDeg < s.fov * 0.7;
        const moonDisk = scene.moonVisible && moonDeg < s.fov * 0.7;
        const surfaceSun = M.toCamera(basis, scene.sunLight);
        const drift = scene.gmst;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                let level = sunGlare + moonGlare + earthGlare;
                if (nearEarth || sunGlare > 0.4 || moonGlare > 0.4 || sunDisk || moonDisk) {
                    const r = M.ray(c, x, y);
                    const e = dot(nadir, r);
                    const ss = dot(sun, r), ms = dot(moon, r);
                    level += sunGlare * 0.0028 / (0.002 + 1 - ss) + moonGlare * 0.015 / (0.006 + 1 - ms);
                    if (nearEarth && e >= earthCut) {
                        const distance = scene.distance * (e - Math.sqrt(Math.max(0, e * e - earthCut * earthCut)));
                        const normal = [
                            (distance * r[0] - scene.distance * nadir[0]) / EARTH,
                            (distance * r[1] - scene.distance * nadir[1]) / EARTH,
                            (distance * r[2] - scene.distance * nadir[2]) / EARTH
                        ];
                        const light = Math.max(0, dot(normal, surfaceSun));
                        const ground = M.toSky(basis, normal);
                        const lon = Math.atan2(ground[1], ground[0]) - drift, lat = ground[2];
                        const texture = 0.64 + 0.15 * Math.sin(29 * lat + 4 * Math.sin(7 * lon))
                            + 0.12 * Math.sin(19 * lon - 13 * lat) + 0.08 * Math.sin(77 * lat + 37 * lon);
                        level += 7 + 24500 * light * texture;
                    } else if (nearEarth && s.glare) {
                        level += 14500 * earthLit * Math.exp(-Math.max(0, earthCut - e) / 0.0035);
                    }
                    if (sunDisk && ss > sunCut && e < earthCut) level += 4e6;
                    if (moonDisk && ms > moonCut && e < earthCut) level += 32000 * scene.moonPhase;
                }
                const u = (x - c.cx) / c.focal, v = (y - c.cy) / c.focal;
                image[y * c.width + x] = (level * exposure * aperture + sky) / (1 + u * u + v * v) ** 2;
            }
        }
        if (sunGlare > 24 && sun[2] > 0.55) {
            const [x, y] = M.project(c, sun);
            splat(image, c, c.cx * 1.67 - 0.67 * x, c.cy * 1.67 - 0.67 * y, sunGlare * exposure * aperture * 600, c.width * 0.019);
        }
        // A periodic specular sweep from a rotating surface, gated by penumbra and solar aspect.
        const panelAngle = (elapsed % 31) * (2 * Math.PI / 31);
        const miss = Math.atan2(Math.sin(panelAngle), Math.cos(panelAngle));
        const glint = s.glint ? scene.sunlight * (0.2 + 0.8 * Math.abs(sun[0])) * Math.exp(-0.5 * (miss / 0.13) ** 2) : 0;
        if (glint > 0.001) {
            const x = c.cx + c.width * (0.25 + 0.34 * miss), y = c.cy - c.height * (0.27 - 0.16 * miss);
            splat(image, c, x, y, glint * exposure * aperture * 850000, c.width * 0.009);
            splat(image, c, c.cx * 1.5 - 0.5 * x, c.cy * 1.5 - 0.5 * y, glint * exposure * aperture * 180000, c.width * 0.034);
        }
        return glint;
    }

    function detector(image, c, s, time, particleRate) {
        const frameSeed = Math.imul(Math.floor(time / Math.max(40, s.exposure)), 0x9e3779b1) ^ s.seed;
        const rand = random(frameSeed), fixed = random(s.seed);
        const exposure = s.exposure / 1000;
        if (s.noise) {
            for (let i = 0; i < image.length; i++) {
                const response = 1 + 0.025 * (2 * fixed() - 1);
                image[i] = image[i] * response + exposure * 1.2;
            }
            const hotPixels = Math.floor(image.length * 0.00045);
            for (let i = 0; i < hotPixels; i++) image[Math.floor(fixed() * image.length)] += exposure * (80 + 4400 * fixed() ** 4);
        }
        let events = 0;
        if (s.particles) {
            const hits = random(frameSeed ^ 0xb1d4a8);
            events = Math.round(shot(exposure * particleRate * DETECTOR_AREA, hits));
            // The simulated format spans the assumed active area, so each simulated pixel is `pitch` µm wide.
            // An isotropic particle crosses a 10 µm sensitive layer at cos θ = √U and deposits about 80 e⁻/µm,
            // times a heavy tail for slow protons and cosmic-ray nuclei.
            const pitch = Math.sqrt(DETECTOR_AREA * 1e8 / image.length);
            for (let i = 0; i < events; i++) {
                const x = hits() * c.width, y = hits() * c.height, a = hits() * 2 * Math.PI;
                const cosine = Math.max(0.05, Math.sqrt(hits()));
                const span = Math.min(40, 10 * Math.sqrt(1 - cosine * cosine) / cosine / pitch);
                const charge = 800 / cosine * (1 + 6 * hits() ** 3), parts = Math.ceil(span) + 1;
                for (let j = 0; j < parts; j++) {
                    const t = parts > 1 ? j / (parts - 1) * span : 0;
                    splat(image, c, x + t * Math.cos(a), y + t * Math.sin(a), charge / parts, 0.45);
                }
            }
        }
        const pixels = new Uint16Array(image.length);
        let saturated = 0, total = 0;
        for (let i = 0; i < image.length; i++) {
            if (image[i] > FULL_WELL && image[i] < FULL_WELL * 25) {
                const bloom = Math.min(FULL_WELL * 0.37, (image[i] - FULL_WELL) * 0.072);
                if (i >= c.width) image[i - c.width] += bloom;
                if (i + c.width < image.length) image[i + c.width] += bloom;
            }
        }
        for (let i = 0; i < image.length; i++) {
            const charge = s.noise ? shot(image[i], rand) + s.readNoise * normal(rand) : image[i];
            const signal = clamp(Math.round(charge + BIAS), 0, FULL_WELL + BIAS);
            pixels[i] = signal;
            total += signal;
            if (signal === FULL_WELL + BIAS) saturated++;
        }
        return { pixels, events, saturated: saturated / image.length, mean: total / image.length };
    }

    // Point-source magnitude at SNR 5 for an optimally weighted Gaussian image over a uniform background.
    function limitingMag(zeroMag, sky, s) {
        const variance = sky + (s.noise ? 1.2 * s.exposure / 1000 + s.readNoise ** 2 : 0);
        const pixels = 4 * Math.PI * s.psf ** 2;
        const flux = (25 + Math.sqrt(625 + 100 * pixels * variance)) / 2;
        return -2.5 * Math.log10(flux / zeroMag);
    }

    function trueRate(scene, satrec, s, elapsed, time) {
        const h = 0.05;
        const at = dt => {
            const local = s.mode === 'inertial' ? scene : environment(satrec, time + dt * 1000);
            return pointing(local, s, elapsed + dt);
        };
        const before = at(-h), after = at(h);
        return M.toCamera(after, scale(M.rotationVector(before, after), 1 / (2 * h)));
    }

    function render(stars, satrec, s, time, epoch, options = {}) {
        const exposure = s.exposure / 1000, elapsed = (time - epoch) / 1000;
        const scene = environment(satrec, time);
        const basis = jittered(pointing(scene, s, elapsed), s.jitter, elapsed);
        const camera = M.camera(s);
        const view = viewing(scene, basis);
        const image = new Float32Array(s.width * s.height);
        const radius = s.aperture / 2000; // Entrance pupil radius in meters.
        const zeroMag = ZERO_POINT * Math.PI * radius ** 2 * exposure;
        const brightness = skyBrightness(basis[2], scene.sun);
        // Convert surface brightness to magnitude-zero stars per steradian, then to electrons in a central pixel.
        const sky = zeroMag * (brightness.zodiacal + brightness.galactic) * 0.2755 / camera.focal ** 2;
        const glint = background(image, camera, scene, basis, view, s, elapsed, sky);
        const sunCut = Math.cos(scene.sunRadius), moonCut = Math.cos(scene.moonRadius);
        const earthCut = Math.cos(scene.earthRadius);
        const corner = M.ray(camera, -6, -6)[2];
        const rollSweep = Math.abs(s.rollRate || 0) * Math.hypot(camera.cx, camera.cy);
        const minZ = corner - ((Math.abs(s.slew) + Math.abs(s.rollRate || 0)) * exposure + 0.15 + s.jitter / 3600) * DEG;
        // Subsample at least twice per pixel of smear and about six times per period of the fastest jitter term.
        const smear = exposure * (Math.abs(s.slew) * DEG * camera.focal + rollSweep * DEG);
        const steps = clamp(Math.ceil(Math.max(2 * smear, s.jitter > 0 ? exposure * 110 : 0)), 3, 31);
        const bases = Array.from({ length: steps }, (_, i) => {
            const dt = exposure * ((i + 0.5) / steps - 0.5);
            const phase = elapsed + dt;
            const at = s.mode === 'inertial' ? scene : environment(satrec, time + dt * 1000);
            return jittered(pointing(at, s, phase), s.jitter, phase);
        });
        let visible = 0;
        const beta = s.aberration ? scene.beta : undefined;
        const faint = s.faint ? faintField(basis[2], Math.acos(clamp(minZ, -1, 1))) : [];
        for (const star of stars.concat(faint)) {
            if (dot(basis[2], star.v) < minZ) continue;
            const v = M.catalogVector(star, scene.years, beta);
            if (dot(v, scene.nadir) > earthCut || dot(v, scene.moon) > moonCut || dot(v, scene.sun) > sunCut) continue;
            const flux = zeroMag * 10 ** (-0.4 * star.inst) / steps;
            if (flux * steps < 1) continue;
            let onSensor = false;
            for (const at of bases) {
                const r = M.toCamera(at, v);
                if (r[2] <= 0) continue;
                const [x, y] = M.project(camera, r);
                if (x < -5 || y < -5 || x >= s.width + 5 || y >= s.height + 5) continue;
                const edge = Math.hypot((x - camera.cx) / camera.cx, (y - camera.cy) / camera.cy);
                splat(image, camera, x, y, flux * r[2] ** 4, s.psf * (1 + 0.22 * edge ** 2));
                onSensor ||= x >= 0 && y >= 0 && x < s.width && y < s.height;
            }
            if (star.hip) visible += Number(onSensor);
        }
        const radiation = options.radiation ? options.radiation(scene.geo) : null;
        const L = radiation?.L ?? scene.dipoleL;
        const trapped = radiation ? radiation.trapped : null;
        const particleRate = cosmicRays(scene, Math.min(L, 20)) + (trapped || 0);
        const { pixels, ...stats } = detector(image, camera, s, time, particleRate);
        // A tracker measures the exposure-averaged attitude, so that is the truth its error is scored against.
        const sum = index => unit(bases.reduce((total, at) => add(total, at[index]), [0, 0, 0]));
        const forward = sum(2), right = unit(sub(sum(0), scale(forward, dot(sum(0), forward))));
        const truth = [right, cross(forward, right), forward];
        return { pixels, basis: truth, beta, stats: { ...stats, visible, glint, sunlight: scene.sunlight,
            altitude: scene.distance - EARTH, limb: view.limb, sun: view.sunDeg, moon: view.moonDeg,
            moonVisible: scene.moonVisible, moonPhase: scene.moonPhase, sky: sky, skyBrightness: brightness,
            limitMag: limitingMag(zeroMag, sky, s), plateScale: M.ARCSEC / camera.focal, geo: scene.geo, L,
            trapped, particleRate, rate: trueRate(scene, satrec, s, elapsed, time).map(v => v / DEG) } };
    }

    root.StarSensor = { defaults, environment, pointing, render, skyBrightness, cosmicRays, FULL_WELL, BIAS,
        ZERO_POINT, DETECTOR_AREA, PROTON_THRESHOLD };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarSensor;
})(typeof self !== 'undefined' ? self : globalThis);
