importScripts('../space/lib/satellite.min.js', '../space/lib/orbit.js', 'math.js', 'sensor.js', 'solve.js');

const M = self.StarMath, S = self.StarSensor, T = self.StarSolve, O = self.SpaceOrbit;
let catalog, index, sourceKey, satrec, prior;

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
        prior = null;
    }
    return satrec;
}

function preset(name, source, start) {
    const sat = orbit(source);
    const period = O.elementsOf(sat).period * 60000;
    let time = start, scene = S.environment(sat, start);
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
    prior = null;
    return { settings, time };
}

async function init() {
    const response = await fetch('../space/data/stars.json');
    if (!response.ok) throw new Error('Could not load the HYG star catalog.');
    const data = await response.json();
    catalog = M.loadCatalog(data.stars);
    index = T.buildIndex(catalog);
    return catalog.length;
}

self.onmessage = async ({ data }) => {
    const { type, id, time, epoch, settings, source } = data;
    try {
        if (type === 'init') {
            self.postMessage({ type: 'ready', count: await init(), settings: S.defaults });
            return;
        }
        if (type === 'preset') {
            self.postMessage({ type, id, ...preset(data.name, source, time) });
            return;
        }
        const imported = type === 'import';
        const sat = !imported || settings.aberration ? orbit(source) : null;
        const image = imported ? { pixels: data.pixels } : S.render(catalog, sat, { ...settings, aberration: true }, time, epoch);
        const beta = settings.aberration && sat ? S.environment(sat, time).beta : undefined;
        const started = performance.now();
        const solution = T.solve(index, image.pixels, settings, {
            threshold: data.threshold, minMatches: data.minMatches, years: M.days(time) / 365.25,
            beta, prior: data.blind || data.reset || imported ? null : prior
        });
        prior = imported ? null : (solution.basis || null);
        const { stats, basis, pixels } = image;
        const estimate = solution.basis ? { ...M.angles(solution.basis), quaternion: M.quaternion(solution.basis) } : null;
        const truth = basis ? M.angles(basis) : null;
        const error = basis && solution.basis ? M.rotationError(solution.basis, basis) * M.ARCSEC : null;
        self.postMessage({ type: 'frame', id, time, imported, stats, truth, estimate, error,
            solution, pixels, width: settings.width, height: settings.height, duration: performance.now() - started }, [pixels.buffer]);
    } catch (err) {
        prior = null;
        self.postMessage({ type: 'error', id, message: err.message });
    }
};
