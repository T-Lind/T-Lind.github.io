(function (root) {
    'use strict';

    const isSpace = c => c === 9 || c === 10 || c === 13 || c === 32;

    function read(buffer) {
        const bytes = new Uint8Array(buffer);
        let at = 0;
        function token() {
            while (at < bytes.length) {
                if (isSpace(bytes[at])) at++;
                else if (bytes[at] === 35) {
                    while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at++;
                } else break;
            }
            const start = at;
            while (at < bytes.length && at - start < 16 && !isSpace(bytes[at])) at++;
            return String.fromCharCode(...bytes.subarray(start, at));
        }
        if (token() !== 'P5') throw new Error('Choose a binary PGM image (P5).');
        const fields = [token(), token(), token()];
        if (!fields.every(v => /^\d+$/.test(v)) || !isSpace(bytes[at])) throw new Error('This PGM header is invalid.');
        const [width, height, max] = fields.map(Number);
        if (width < 32 || width > 1024 || height < 32 || height > 768 || max < 1 || max > 65535) {
            throw new Error('PGM size must be 32–1,024 × 32–768 pixels, at 8 or 16 bits.');
        }
        at += bytes[at] === 13 && bytes[at + 1] === 10 && bytes.length - at - 1 > width * height * (max > 255 ? 2 : 1) ? 2 : 1;
        if (bytes.length - at !== width * height * (max > 255 ? 2 : 1)) throw new Error('PGM data length does not match its dimensions.');
        const pixels = new Uint16Array(width * height);
        if (max <= 255) {
            for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(bytes[at + i] * 4095 / max);
        } else {
            const view = new DataView(buffer, at);
            for (let i = 0; i < pixels.length; i++) pixels[i] = view.getUint16(i * 2);
        }
        return { pixels, width, height };
    }

    function write(pixels, width, height) {
        const header = new TextEncoder().encode(`P5\n${width} ${height}\n65535\n`);
        const buffer = new ArrayBuffer(header.length + pixels.length * 2);
        new Uint8Array(buffer).set(header);
        const data = new DataView(buffer, header.length);
        for (let i = 0; i < pixels.length; i++) data.setUint16(i * 2, pixels[i]);
        return buffer;
    }

    root.StarPGM = { read, write };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StarPGM;
})(typeof self !== 'undefined' ? self : globalThis);
