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
