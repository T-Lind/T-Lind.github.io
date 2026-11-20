const { test } = require('node:test');
const assert = require('node:assert/strict');
const Orbit = require('../space/lib/orbit.js');
const M = require('../star-tracker/math.js');
const Sensor = require('../star-tracker/sensor.js');
const Tracker = require('../star-tracker/solve.js');
const PGM = require('../star-tracker/pgm.js');
const data = require('../space/data/stars.json');

const epoch = Date.UTC(2026, 10, 19);
const sat = Orbit.satrecFromElements({ ...Orbit.PRESETS[0], epoch: new Date(epoch) });
const catalog = M.loadCatalog(data.stars);
const index = Tracker.buildIndex(catalog);

test('camera projections and orientation conventions round-trip', () => {
    const basis = M.attitude(83, -4, 18);
    const inverse = M.angles(basis);
    assert(Math.abs(inverse.ra - 83) < 1e-8 && Math.abs(inverse.dec + 4) < 1e-8 && Math.abs(inverse.roll - 18) < 1e-8);
    const [w, ...q] = M.quaternion(basis);
    const forward = [0, 0, 1];
    const a = M.cross(q, forward);
    const rotated = M.add(forward, M.scale(M.add(M.scale(a, w), M.cross(q, a)), 2));
    assert(M.angle(rotated, basis[2]) < 1e-12);
    const camera = M.camera({ width: 640, height: 480, fov: 36, distortion: -0.55 });
    const ray = M.ray(camera, 15.2, 400.75);
    const pixel = M.project(camera, ray);
    assert(Math.hypot(pixel[0] - 15.2, pixel[1] - 400.75) < 1e-8);
});

test('blind acquisition works on a raw PGM and later frames track from pixels', () => {
    const settings = { ...Sensor.defaults };
    const initial = Sensor.render(catalog, sat, settings, epoch, epoch);
    const pgm = PGM.write(initial.pixels, settings.width, settings.height);
    const { pixels, width, height } = PGM.read(pgm);
    assert.deepEqual([width, height], [320, 240]);
    assert.deepEqual(pixels, initial.pixels);
    const fix = Tracker.solve(index, pixels, settings, { years: M.days(epoch) / 365.25 });
    assert.equal(fix.mode, 'Acquired');
    assert(fix.matches.length > 25 && fix.matches.some(star => star.name === 'Rigel'));
    assert(M.rotationError(fix.basis, initial.basis) * M.ARCSEC < 60);

    const time = epoch + 1000;
    const next = Sensor.render(catalog, sat, settings, time, epoch);
    const tracked = Tracker.solve(index, next.pixels, settings, { years: M.days(time) / 365.25, prior: fix.basis });
    assert.equal(tracked.mode, 'Tracking');
    assert(M.rotationError(tracked.basis, next.basis) * M.ARCSEC < 60);
});

test('LEO propagation changes eclipse and glint, and Earth occults a nadir frame', () => {
    const dark = Sensor.environment(sat, epoch);
    const sunlitTime = epoch + 40 * 60000;
    const lit = Sensor.environment(sat, sunlitTime);
    assert.equal(dark.sunlight, 0);
    assert.equal(lit.sunlight, 1);
    assert(lit.distance > 6750 && lit.distance < 6850);
    const bore = M.unit(M.cross(lit.nadir, lit.sun));
    const aim = M.angles([lit.sun, M.cross(bore, lit.sun), bore]);
    const glint = Sensor.render(catalog, sat, { ...Sensor.defaults, ...aim }, sunlitTime, sunlitTime);
    assert(glint.stats.glint > 0.9);
    const noGlint = Sensor.render(catalog, sat, { ...Sensor.defaults, ...aim, glint: false }, sunlitTime, sunlitTime);
    assert.equal(noGlint.stats.glint, 0);
    assert(glint.stats.mean > noGlint.stats.mean + 5);

    const nadir = { ra: Math.atan2(dark.nadir[1], dark.nadir[0]) / M.DEG, dec: Math.asin(dark.nadir[2]) / M.DEG };
    const blocked = Sensor.render(catalog, sat, { ...Sensor.defaults, ...nadir, noise: false, particles: false }, epoch, epoch);
    assert.equal(blocked.stats.visible, 0);
    assert(blocked.stats.limb < -65);
    assert.equal(Tracker.solve(index, blocked.pixels, Sensor.defaults).basis, undefined);
});

test('PGM parsing handles 8-bit input, comments, and invalid payloads', () => {
    const header = new TextEncoder().encode('P5\n# generated example\n32 32\n255\n');
    const bytes = new Uint8Array(header.length + 1024);
    bytes.set(header);
    bytes[header.length] = 10; // Whitespace-valued raster samples are still data.
    bytes[header.length + 1] = 255;
    const picture = PGM.read(bytes.buffer);
    assert.equal(picture.pixels[0], 161);
    assert.equal(picture.pixels[1], 4095);
    assert.throws(() => PGM.read(bytes.buffer.slice(0, -1)), /data length/);
});

test('instrument magnitudes brighten red stars and the sky model follows the zodiacal and galactic shape', () => {
    const betelgeuse = catalog.find(star => star.name === 'Betelgeuse');
    const vega = catalog.find(star => star.name === 'Vega');
    assert(betelgeuse.mag - betelgeuse.inst > 0.35 && Math.abs(vega.mag - vega.inst) < 0.05);
    for (let i = 1; i < catalog.length; i++) assert(catalog[i].inst >= catalog[i - 1].inst);
    const sun = M.direction(0, 0);
    const pole = Sensor.skyBrightness(M.direction(270 * M.DEG, 66.56 * M.DEG), sun);
    const ecliptic = Sensor.skyBrightness(M.direction(90 * M.DEG, 23.44 * M.DEG), sun);
    assert(Math.abs(pole.zodiacal - 77) < 1 && ecliptic.zodiacal > 2.5 * pole.zodiacal);
    const scene = Sensor.environment(sat, epoch);
    assert(Sensor.cosmicRays(scene, 4) > 5 * Sensor.cosmicRays(scene, 1));
});

test('tracking estimates the body rate and propagates the previous solution through a slew', () => {
    const settings = { ...Sensor.defaults, slew: 0.5, exposure: 200 };
    const first = Sensor.render(catalog, sat, settings, epoch, epoch);
    const years = M.days(epoch) / 365.25;
    const fix = Tracker.solve(index, first.pixels, settings, { years });
    assert(fix.basis && fix.sigma.cross < fix.sigma.roll);
    const time = epoch + 2000;
    const next = Sensor.render(catalog, sat, settings, time, epoch);
    const rate = M.scale(M.rotationVector(fix.basis, Tracker.solve(index, next.pixels, settings, { years }).basis), 1 / 2);
    assert(Math.abs(M.norm(rate) / M.DEG - 0.5) < 0.01);
    const later = Sensor.render(catalog, sat, settings, time + 2000, epoch);
    const tracked = Tracker.solve(index, later.pixels, settings, { years, prior: M.spin(fix.basis, M.scale(rate, 4)) });
    assert.equal(tracked.mode, 'Tracking');
    assert(M.rotationError(tracked.basis, later.basis) * M.ARCSEC < 60);
});

test('streak centroids keep fast-slew frames accurate', () => {
    const settings = { ...Sensor.defaults, slew: 2, exposure: 500 };
    const frame = Sensor.render(catalog, sat, settings, epoch, epoch);
    const fix = Tracker.solve(index, frame.pixels, settings, { years: M.days(epoch) / 365.25 });
    assert(fix.detections.filter(point => point.streak).length > 20);
    const [x, y] = M.toCamera(frame.basis, M.rotationVector(frame.basis, fix.basis)).map(v => v * M.ARCSEC);
    assert(Math.hypot(x, y) < 120);
});

test('random point sources do not produce a false attitude lock', () => {
    const settings = { ...Sensor.defaults };
    let state = 7;
    const rand = () => (state = state * 16807 % 2147483647) / 2147483647;
    for (let trial = 0; trial < 3; trial++) {
        const image = new Float32Array(320 * 240).fill(130);
        for (let n = 0; n < 90; n++) {
            const x = 6 + rand() * 308, y = 6 + rand() * 228, flux = 300 * 10 ** (2 * rand());
            for (let j = Math.floor(y) - 4; j <= Math.ceil(y) + 4; j++) {
                for (let i = Math.floor(x) - 4; i <= Math.ceil(x) + 4; i++) {
                    image[j * 320 + i] += flux / (2 * Math.PI * 0.81) * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / 1.62);
                }
            }
        }
        const pixels = Uint16Array.from(image, v => Math.round(v + 3 * Math.sqrt(v) * (rand() - 0.5)));
        assert.equal(Tracker.solve(index, pixels, settings, { years: 26 }).basis, undefined);
    }
});
