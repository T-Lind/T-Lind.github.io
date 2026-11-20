(function (root) {
    'use strict';

    const M = root.StarMath || require('./math.js');
    const O = root.SpaceOrbit || require('../space/lib/orbit.js');
    const { DEG, dot, cross, scale, add, sub, norm, unit, angle, clamp, rotate, direction } = M;
    const EARTH = 6378.137;
    const AU = 149597870.7;
    const FULL_WELL = 12000;
    const BIAS = 96;
    const sin = x => Math.sin(x * DEG);
    const cos = x => Math.cos(x * DEG);

    const defaults = { width: 320, height: 240, fov: 24, aperture: 35, exposure: 90, psf: 0.9,
        distortion: -0.12, readNoise: 3, baffle: 27, seed: 12345, ra: 83, dec: -4, roll: 18, slew: 0,
        jitter: 14, mode: 'inertial', calibrated: true, aberration: true, noise: true, glare: true, glint: true, particles: true };

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
        return { pos, velocity, distance, nadir, sun, moon, sunLight, earthRadius, sunRadius, moonRadius, moonPhase,
            moonVisible: angle(nadir, moon) > earthRadius, sunlight: sunFraction(angle(nadir, sun), earthRadius, sunRadius),
            beta, years: days / 365.25, gmst: O.gmst(new Date(time)) };
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
        } else if (s.slew) {
            const axis = basis[1];
            basis = basis.map(v => rotate(v, axis, M.wrap(s.slew * elapsed) * DEG));
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

    function splat(image, c, x, y, flux, sigma) {
        const r = Math.ceil(sigma * 3.6);
        const x0 = Math.max(0, Math.ceil(x - r)), x1 = Math.min(c.width - 1, Math.floor(x + r));
        const y0 = Math.max(0, Math.ceil(y - r)), y1 = Math.min(c.height - 1, Math.floor(y + r));
        const k = -0.5 / (sigma * sigma), level = flux / (2 * Math.PI * sigma * sigma);
        for (let j = y0; j <= y1; j++) {
            const row = level * Math.exp((j - y) ** 2 * k);
            for (let i = x0; i <= x1; i++) image[j * c.width + i] += row * Math.exp((i - x) ** 2 * k);
        }
    }

    function viewing(scene, basis) {
        const sun = M.toCamera(basis, scene.sun), moon = M.toCamera(basis, scene.moon), nadir = M.toCamera(basis, scene.nadir);
        const sunDeg = Math.acos(clamp(sun[2], -1, 1)) / DEG;
        const moonDeg = Math.acos(clamp(moon[2], -1, 1)) / DEG;
        const limb = Math.acos(clamp(nadir[2], -1, 1)) / DEG - scene.earthRadius / DEG;
        return { sun, moon, nadir, sunDeg, moonDeg, limb };
    }

    function background(image, c, scene, basis, view, s, elapsed) {
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
                // Subtracting the global pedestal happens in the detector, after photon statistics.
                let level = 1.8 + sunGlare + moonGlare + earthGlare;
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
                image[y * c.width + x] = level * exposure * aperture / (1 + u * u + v * v) ** 2;
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

    function detector(image, c, s, time) {
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
            events = shot(exposure * 4 * image.length / 76800, hits);
            for (let i = 0; i < events; i++) {
                const x = hits() * c.width, y = hits() * c.height, a = hits() * 2 * Math.PI;
                const length = 1 + hits() * 10, energy = 250 + hits() * 9000;
                for (let j = 0; j <= length; j++) splat(image, c, x + j * Math.cos(a), y + j * Math.sin(a), energy, 0.45);
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

    function render(stars, satrec, s, time, epoch) {
        const exposure = s.exposure / 1000, elapsed = (time - epoch) / 1000;
        const scene = environment(satrec, time);
        const basis = jittered(pointing(scene, s, elapsed), s.jitter, elapsed);
        const camera = M.camera(s);
        const view = viewing(scene, basis);
        const image = new Float32Array(s.width * s.height);
        const glint = background(image, camera, scene, basis, view, s, elapsed);
        const sunCut = Math.cos(scene.sunRadius), moonCut = Math.cos(scene.moonRadius);
        const earthCut = Math.cos(scene.earthRadius);
        const minZ = M.ray(camera, -6, -6)[2] - (Math.abs(s.slew) * exposure + 0.15) * DEG;
        const radius = s.aperture / 2000; // Entrance pupil radius in meters.
        const zeroMag = 8.8e9 * Math.PI * radius ** 2 * 0.45 * exposure;
        const steps = clamp(Math.ceil(exposure * (Math.abs(s.slew) * DEG * camera.focal + s.jitter / M.ARCSEC * camera.focal * 75)), 3, 21);
        const bases = Array.from({ length: steps }, (_, i) => {
            const dt = exposure * ((i + 0.5) / steps - 0.5);
            const phase = elapsed + dt;
            const at = s.mode === 'inertial' ? scene : environment(satrec, time + dt * 1000);
            return jittered(pointing(at, s, phase), s.jitter, phase);
        });
        let visible = 0;
        const beta = s.aberration ? scene.beta : undefined;
        for (const star of stars) {
            if (dot(basis[2], star.v) < minZ) continue;
            const v = M.catalogVector(star, scene.years, beta);
            if (dot(v, scene.nadir) > earthCut || dot(v, scene.moon) > moonCut || dot(v, scene.sun) > sunCut) continue;
            const flux = zeroMag * 10 ** (-0.4 * star.mag) / steps;
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
            visible += Number(onSensor);
        }
        const { pixels, ...stats } = detector(image, camera, s, time);
        return { pixels, basis, beta, stats: { ...stats, visible, glint, sunlight: scene.sunlight,
            altitude: scene.distance - EARTH, limb: view.limb, sun: view.sunDeg, moon: view.moonDeg,
            moonVisible: scene.moonVisible, moonPhase: scene.moonPhase } };
    }

    root.StarSensor = { defaults, environment, pointing, render, FULL_WELL, BIAS };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarSensor;
})(typeof self !== 'undefined' ? self : globalThis);
