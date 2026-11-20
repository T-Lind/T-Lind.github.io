importScripts('../space/lib/satellite.min.js', '../space/lib/orbit.js', '../space/lib/radiation.js', 'math.js', 'sensor.js', 'solve.js');

const M = self.StarMath, S = self.StarSensor, T = self.StarSolve, O = self.SpaceOrbit, R = self.SpaceRad;
// `track` holds the last pixel solution and the angular rate estimated from the two most recent solutions.
let catalog, index, sourceKey, satrec, track = null, radiation = null, radiationLoad = null;

// AP8 (solar minimum) trapped protons on the IGRF 2025 L-shell grid from the Van Allen belt tool.
function loadRadiation() {
    radiationLoad ||= Promise.all([
        fetch('../space/data/field.json').then(r => r.json()),
        fetch('../space/data/field-2025.bin').then(r => r.arrayBuffer()),
        fetch('../space/data/ae8ap8.json').then(r => r.json())
    ]).then(([meta, buffer, ap8]) => {
        const model = new R.TrappedModel(ap8);
        radiation = { field: new R.FieldGrid({ ...meta, year: 2025 }, buffer), model, spectrum: new Float64Array(model.energies.p.length) };
    }).catch(() => { radiation = false; });
    return radiationLoad;
}

function trappedProtons(geo) {
    if (!radiation) return null;
    const { field, model, spectrum } = radiation;
    const at = field.lookup(geo.lat, geo.lon, geo.h);
    if (!at.inside) return null;
    model.spectrum('p_min', model.weights(at.L, at.bb0), spectrum);
    return { L: at.L, trapped: R.fluxAbove(model.energies.p, spectrum, S.PROTON_THRESHOLD) };
}

function orbit(source) {
    const key = JSON.stringify(source);
    if (key !== sourceKey) {
        const next = O.satrecFromSource(source);
        const { perigee, apogee } = O.elementsOf(next);
        if (!Number.isFinite(perigee) || !Number.isFinite(apogee) || perigee < 120 || apogee > 2010) {
            throw new Error('Use a low Earth orbit with perigee at least 120 km and apogee near or below 2,000 km.');
        }
        sourceKey = key;
        satrec = next;
        track = null;
    }
    return satrec;
}

async function preset(name, source, start) {
    const sat = orbit(source);
    const period = O.elementsOf(sat).period * 60000;
    let time = start, scene = S.environment(sat, start);
    if (name === 'saa') {
        await loadRadiation();
        if (!radiation) throw new Error('The trapped-proton model could not be loaded.');
        let peak = 0;
        for (let minute = 0; minute <= 1440; minute++) {
            const at = start + minute * 60000;
            const flux = trappedProtons(S.environment(sat, at).geo)?.trapped || 0;
            if (flux > peak) { peak = flux; time = at; }
        }
        if (peak < 1) throw new Error('This orbit does not cross the South Atlantic Anomaly within a day of the selected time.');
        scene = S.environment(sat, time);
    }
    const needMoon = name === 'moon';
    if (name !== 'clear' && name !== 'slew') {
        const clearance = { solar: 8, limb: 42, glint: 0 }[name] || 0;
        const acceptable = s => needMoon ? s.moonVisible && s.moonPhase > 0.04
            : s.sunlight > 0.999 && M.angle(s.sun, s.nadir) - s.earthRadius > clearance * M.DEG;
        for (let i = 0; i < 48 && !acceptable(scene); i++) {
            time = start + Math.round((i + 1) * period / 48 / 1000) * 1000;
            scene = S.environment(sat, time);
        }
        if (!acceptable(scene)) throw new Error(needMoon ? 'The illuminated Moon is unavailable for this orbit and date.' : 'No suitable sunlight on this orbit. Try a different date.');
    }
    const settings = { ...S.defaults, glint: ['clear', 'glint', 'slew'].includes(name) };
    if (name === 'slew') Object.assign(settings, { slew: 2, exposure: 500 });
    if (name === 'saa') Object.assign(settings, { exposure: 400, glint: false });
    if (['solar', 'moon', 'limb', 'glint'].includes(name)) {
        const axis = M.unit(M.cross(scene.nadir, scene.sun));
        const targets = {
            solar: M.rotate(scene.sun, axis, 21 * M.DEG),
            moon: scene.moon,
            limb: M.rotate(scene.nadir, axis, scene.earthRadius + 2 * M.DEG),
            glint: axis
        };
        const boresight = targets[name];
        settings.ra = M.wrap(Math.atan2(boresight[1], boresight[0]) / M.DEG);
        settings.dec = Math.asin(boresight[2]) / M.DEG;
        if (name === 'glint') settings.roll = M.angles([scene.sun, M.cross(boresight, scene.sun), boresight]).roll;
    }
    if (name === 'saa') {
        // Point away from the Sun and the Earth so radiation is the dominant disturbance.
        const away = M.unit(M.sub(M.scale(scene.sun, -1), scene.nadir));
        settings.ra = M.wrap(Math.atan2(away[1], away[0]) / M.DEG);
        settings.dec = Math.asin(away[2]) / M.DEG;
    }
    if (name === 'clear' || name === 'slew') {
        const target = M.attitude(settings.ra, settings.dec)[2];
        for (let i = 0; i < 48; i++) {
            if (M.angle(target, scene.nadir) - scene.earthRadius > 19 * M.DEG
                && (scene.sunlight < 0.01 || M.angle(target, scene.sun) > 44 * M.DEG)
                && (!scene.moonVisible || M.angle(target, scene.moon) > 18 * M.DEG)) break;
            time = start + Math.round((i + 1) * period / 48 / 1000) * 1000;
            scene = S.environment(sat, time);
        }
    }
    track = null;
    return { settings, time };
}

// Sunlight, latitude and trapped-proton flux every 10 s across one orbit, for the timeline strip and jump points.
function profile(source, epoch, period) {
    const sat = orbit(source), samples = [];
    for (let t = 0; t <= period; t += 10) {
        const scene = S.environment(sat, epoch + t * 1000);
        samples.push([t, scene.sunlight, scene.geo.lat, radiation ? trappedProtons(scene.geo)?.trapped ?? 0 : null]);
    }
    return { samples, radiation: radiation === null ? 'loading' : radiation ? 'ready' : 'failed' };
}

async function init() {
    const response = await fetch('../space/data/stars.json');
    if (!response.ok) throw new Error('Could not load the HYG star catalog.');
    const data = await response.json();
    catalog = M.loadCatalog(data.stars);
    index = T.buildIndex(catalog);
    loadRadiation();
    return catalog.length;
}

self.onmessage = async ({ data }) => {
    const { type, id, time, epoch, settings, source } = data;
    try {
        if (type === 'init') {
            self.postMessage({ type: 'ready', count: await init(), settings: S.defaults });
            return;
        }
        if (type === 'profile') {
            // A bad orbit is reported by the frame request; the strip just stays empty.
            try { self.postMessage({ type, key: data.key, ...profile(source, epoch, data.period) }); } catch { /* ignored */ }
            return;
        }
        if (type === 'preset') {
            self.postMessage({ type, id, ...(await preset(data.name, source, time)) });
            return;
        }
        const imported = type === 'import';
        const sat = !imported || settings.aberration ? orbit(source) : null;
        if (data.reset || data.blind || imported) track = null;
        const image = imported ? { pixels: data.pixels } : S.render(catalog, sat, { ...settings, aberration: true }, time, epoch,
            { radiation: trappedProtons });
        const beta = settings.aberration && sat ? S.environment(sat, time).beta : undefined;
        // Propagate the last solution with the estimated body rate, as a gyro-free tracker would.
        const dt = track ? (time - track.time) / 1000 : 0;
        const prior = track && Math.abs(dt) <= 60 ? (track.rate ? M.spin(track.basis, M.scale(track.rate, dt)) : track.basis) : null;
        const started = performance.now();
        const solution = T.solve(index, image.pixels, settings, {
            threshold: data.threshold, minMatches: data.minMatches, years: M.days(time) / 365.25, beta, prior
        });
        let rate = null;
        if (solution.basis && !imported) {
            if (track && dt > 0 && dt <= 60) rate = M.scale(M.rotationVector(track.basis, solution.basis), 1 / dt);
            track = { basis: solution.basis, time, rate };
        } else track = null;
        const { stats, basis, pixels } = image;
        const estimate = solution.basis ? { ...M.angles(solution.basis), quaternion: M.quaternion(solution.basis),
            rate: rate && M.toCamera(solution.basis, rate).map(v => v / M.DEG) } : null;
        const truth = basis ? M.angles(basis) : null;
        let error = null;
        if (basis && solution.basis) {
            const [x, y, z] = M.toCamera(basis, M.rotationVector(basis, solution.basis)).map(v => v * M.ARCSEC);
            error = { total: M.rotationError(solution.basis, basis) * M.ARCSEC, cross: Math.hypot(x, y), roll: Math.abs(z) };
        }
        self.postMessage({ type: 'frame', id, time, imported, stats, truth, estimate, error, radiation: radiation === null ? 'loading' : radiation ? 'ready' : 'failed',
            solution, pixels, width: settings.width, height: settings.height, duration: performance.now() - started }, [pixels.buffer]);
    } catch (err) {
        track = null;
        self.postMessage({ type: 'error', id, message: err.message });
    }
};
