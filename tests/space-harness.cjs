// Runs van-allen/worker.js in a Node VM sandbox, exactly as a browser Worker would load it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadWorker(rel) {
    const file = path.join(root, rel);
    const dir = path.dirname(file);
    const out = [];
    const ctx = { console, Math, Date, Float32Array, Float64Array, Int16Array, Uint16Array, Array, Object, JSON, Error, Set, Map, isFinite, isNaN, Number, String };
    ctx.self = ctx; ctx.globalThis = ctx;
    ctx.postMessage = (m) => out.push(m);
    ctx.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.resolve(dir, f), 'utf8'), ctx, { filename: f }); };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
    return { send: (msg) => { ctx.onmessage({ data: msg }); return out.splice(0); }, ctx };
}

function vanAllen() {
    const data = (f) => path.join(root, 'space/data', f);
    const w = loadWorker('van-allen/worker.js');
    const bin = (f) => { const b = fs.readFileSync(data(f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
    const res = w.send({ type: 'init', ae8ap8: JSON.parse(fs.readFileSync(data('ae8ap8.json'))), fieldMeta: JSON.parse(fs.readFileSync(data('field.json'))),
        fields: { 1970: bin('field-1970.bin'), 2025: bin('field-2025.bin') }, nist: JSON.parse(fs.readFileSync(data('nist.json'))) });
    if (!res.some(m => m.type === 'ready')) throw new Error('worker did not initialise: ' + JSON.stringify(res));
    return (cases, settings) => {
        const msgs = w.send({ type: 'run', id: 1, cases, settings: Object.assign({ start: '2026-01-01T00:00:00Z', durationS: 365.25 * 86400, solar: 'max', field: '1970', eThr: 1, pThr: 10, samples: 60000, windowS: 86400, geometry: 'sphere', ef: 1, refMm: 2.54, eLevel: 1e3, pLevel: 1 }, settings) });
        const out = {};
        for (const m of msgs) if (m.type === 'case') { if (m.error) throw new Error(m.error); out[m.key] = m.result; }
        return out;
    };
}
module.exports = { loadWorker, vanAllen, root };
