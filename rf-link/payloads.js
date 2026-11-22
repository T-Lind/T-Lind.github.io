/* Payloads for the RF link simulator: built-in images, orbit-driven housekeeping telemetry, and files
 * the user supplies. Every payload is plain bytes plus enough description to display it again after
 * reception. Runs in a window (image decoding needs a canvas) or in Node for the telemetry and file parts. */
(function (root) {
    'use strict';
    const O = root.SpaceOrbit || (typeof require === 'function' ? require('../space/lib/orbit.js') : null);
    const G = root.RFGeometry || (typeof require === 'function' ? require('./geometry.js') : null);
    const LIMIT = 48 * 1024;

    const PRESETS = {
        earth: { label: 'Earth camera image', kind: 'image', src: '../public/projects/debris-visualizer.jpg', width: 128, height: 72, channels: 3, name: 'earth-camera.rgb' },
        stars: { label: 'Star tracker frame', kind: 'image', src: '../public/projects/star-tracker.jpg', width: 160, height: 120, channels: 1, name: 'star-tracker.gray' }
    };

    /** Decode an image URL into raw pixels (RGB or grayscale) at a fixed size. Browser only. */
    function image(preset) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const { width, height, channels } = preset;
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const c = canvas.getContext('2d');
                c.imageSmoothingQuality = 'high';
                // Cover the target, cropping the longer side, so the aspect ratio is kept.
                const s = Math.max(width / img.naturalWidth, height / img.naturalHeight);
                const w = img.naturalWidth * s, h = img.naturalHeight * s;
                c.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
                const px = c.getImageData(0, 0, width, height).data, out = new Uint8Array(width * height * channels);
                for (let i = 0; i < width * height; i++) {
                    if (channels === 1) out[i] = Math.round(0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]);
                    else { out[3 * i] = px[4 * i]; out[3 * i + 1] = px[4 * i + 1]; out[3 * i + 2] = px[4 * i + 2]; }
                }
                resolve({ kind: 'image', width, height, channels, bytes: out, name: preset.name, label: preset.label });
            };
            img.onerror = () => reject(new Error(`Could not load ${preset.label.toLowerCase()}.`));
            img.src = preset.src;
        });
    }

    /**
     * Housekeeping telemetry recorded on board since the previous contact, as CSV. Position comes from
     * SGP4 and sunlight from a cylindrical shadow, so battery charge and temperatures follow the real
     * eclipses of the selected orbit. The electrical and thermal models are simple and illustrative.
     */
    function telemetry(satrec, end, minutes = 95, step = 20) {
        const rows = ['# Spacecraft housekeeping telemetry (synthetic), recorded before this contact',
            '# Orbit and eclipse from SGP4; battery and thermal values from a simple illustrative model',
            'utc,lat_deg,lon_deg,alt_km,sunlit,solar_a,load_a,battery_v,soc_pct,obc_c,panel_c,mode'];
        let soc = 0.78, obc = 18, panel = 10, seed = 12345;
        const noise = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed / 4294967296 - 0.5); };
        const start = end - minutes * 60000;
        for (let t = start; t <= end; t += step * 1000) {
            const date = new Date(t), pv = O.stateAt(satrec, date);
            if (!pv) continue;
            const r = [pv.position.x, pv.position.y, pv.position.z];
            const geo = O.geodetic(pv.position, O.gmst(date));
            const lit = G.sunlit(r, G.sunDirection(date));
            const phase = (t - start) / 60000;
            const solar = lit ? 1.55 + 0.12 * Math.sin(phase / 7) + 0.02 * noise() : 0.003;
            const mode = soc < 0.35 ? 'SAFE' : lit ? 'NOMINAL' : 'ECLIPSE';
            const load = (mode === 'SAFE' ? 0.55 : 0.92) + 0.03 * noise();
            soc = Math.min(1, Math.max(0, soc + (solar - load) * step / (5.2 * 3600)));
            obc += (step / 900) * ((lit ? 26 : 13) - obc);
            panel += (step / 420) * ((lit ? 58 : -38) - panel);
            const volts = 6.4 + 1.9 * soc - 0.08 * load + (lit ? 0.12 : 0);
            rows.push([date.toISOString().slice(0, 19) + 'Z', geo.lat.toFixed(3), geo.lon.toFixed(3), geo.h.toFixed(1), lit ? 1 : 0,
                solar.toFixed(3), load.toFixed(3), volts.toFixed(3), (soc * 100).toFixed(1), (obc + 0.2 * noise()).toFixed(2),
                (panel + 0.4 * noise()).toFixed(2), mode].join(','));
        }
        const bytes = new TextEncoder().encode(rows.join('\n') + '\n');
        return { kind: 'text', bytes, name: 'housekeeping.csv', mime: 'text/csv', label: 'Housekeeping telemetry' };
    }

    const MAGIC = [
        { mime: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
        { mime: 'image/jpeg', test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
        { mime: 'image/gif', test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
        { mime: 'image/webp', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 }
    ];

    /** Mostly printable UTF-8 counts as text; image formats are recognised by their first bytes. */
    function classify(bytes) {
        for (const m of MAGIC) if (bytes.length > 12 && m.test(bytes)) return { kind: 'file', mime: m.mime, image: true };
        let printable = 0;
        const n = Math.min(bytes.length, 8192);
        for (let i = 0; i < n; i++) { const b = bytes[i]; if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0xC2) printable++; }
        if (n && printable / n > 0.95) {
            try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, n)); return { kind: 'text', mime: 'text/plain' }; } catch (err) { /* not UTF-8 */ }
        }
        return { kind: 'file', mime: 'application/octet-stream', image: false };
    }

    /** Wrap user-supplied bytes. Throws if the file is empty or larger than the limit. */
    function fromBytes(bytes, name) {
        if (!bytes.length) throw new Error('That file is empty.');
        if (bytes.length > LIMIT) throw new Error(`Files up to ${LIMIT / 1024} kB fit in one simulated transmission; this one is ${(bytes.length / 1024).toFixed(1)} kB.`);
        const c = classify(bytes);
        return { kind: c.kind, bytes, name, mime: c.mime, image: !!c.image, label: name };
    }

    const api = { LIMIT, PRESETS, image, telemetry, classify, fromBytes };
    root.RFPayloads = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
