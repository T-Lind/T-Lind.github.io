/* RF link signal processing: CCSDS telemetry coding and a sample-level PSK / GMSK modem.
 * Works in a Web Worker or in Node. Everything here is deterministic for a given seed.
 *
 * Transmit chain:  image bytes → transfer frames (+CRC) → Reed–Solomon (255,223), interleaved
 *                  → pseudo-randomizer → attached sync marker → convolutional code (7, 1/2)
 *                  → BPSK / QPSK / 8PSK with root-raised-cosine pulses, or GMSK.
 * Channel:         the one-way delay R(t)/c is applied to both the carrier and the symbol clock, so
 *                  Doppler shift, Doppler rate and symbol-rate Doppler all follow from the orbit.
 *                  The receiver's own orbit prediction is subtracted (Doppler pre-correction).
 *                  Oscillator offset, phase noise and Gaussian noise at the link-budget Es/N0 follow.
 * Receive chain:   FFT carrier acquisition → matched filter → Gardner symbol timing → decision-directed
 *                  carrier loop (or limiter-discriminator for GMSK) → soft demapping → phase-ambiguity and
 *                  frame-sync search → Viterbi → derandomizer → Reed–Solomon → CRC. */
(function (root) {
    'use strict';
    const TAU = 2 * Math.PI;
    const C_KM = 299792.458;
    const SPS = 4;                       // samples per symbol in the simulated receiver
    const ASM = 0x1ACFFC1D;              // CCSDS attached sync marker
    const DEPTH = 5;                     // Reed–Solomon interleaving depth (CCSDS I = 5)
    const FRAME_BYTES = 223 * DEPTH;     // transfer frame length, 1,115 bytes
    const HEADER = 6, FECF = 2;
    const PAYLOAD_BYTES = FRAME_BYTES - HEADER - FECF;
    const IDLE = 0xFFFF;
    const LEAD_IN = 2, TAIL = 1;         // idle frames before (receiver pull-in) and after (Viterbi flush) the image

    /* ---------------- utilities ---------------- */
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        const next = () => {
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        let spare = null;
        next.gauss = () => {
            if (spare !== null) { const s = spare; spare = null; return s; }
            let u = next(); while (u <= 1e-300) u = next();
            const r = Math.sqrt(-2 * Math.log(u)), th = TAU * next();
            spare = r * Math.sin(th);
            return r * Math.cos(th);
        };
        return next;
    }
    const parity = x => { x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1; return x & 1; };

    function erf(x) {
        const s = Math.sign(x); x = Math.abs(x);
        const t = 1 / (1 + 0.3275911 * x);
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return s * y;
    }
    /** Gaussian tail probability Q(x), accurate to about 1e-7 relative over the useful range. */
    function qfunc(x) {
        if (x < 0) return 1 - qfunc(-x);
        if (x > 8) return Math.exp(-x * x / 2) / (x * Math.sqrt(TAU)) * (1 - 1 / (x * x));
        // Complementary error function by continued-fraction-free rational fit (W. J. Cody style via erfc = 1 - erf for small x).
        if (x < 2) return 0.5 * (1 - erf(x / Math.SQRT2));
        const t = 1 / (1 + 0.5 * x / Math.SQRT2);
        const z = x / Math.SQRT2;
        const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
        return 0.5 * r;
    }

    /** In-place radix-2 complex FFT. */
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < half; k++) {
                    const a = i + k, b = a + half;
                    const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }

    /* ---------------- CCSDS TM coding ---------------- */
    /** CRC-16-CCITT (polynomial 0x1021, preset 0xFFFF), the CCSDS frame error control field. */
    function crc16(bytes, start = 0, end = bytes.length) {
        let crc = 0xFFFF;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i] << 8;
            for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        return crc;
    }

    /** CCSDS pseudo-randomizer, h(x) = x^8 + x^7 + x^5 + x^3 + 1, all-ones seed, 255-bit period. */
    const RANDOMIZER = (() => {
        const out = new Uint8Array(255);
        let s = 0xFF;
        for (let i = 0; i < 255; i++) {
            let byte = 0;
            for (let b = 0; b < 8; b++) { byte = (byte << 1) | ((s >> 7) & 1); s = ((s << 1) | parity(s & 0x95)) & 0xFF; }
            out[i] = byte;
        }
        return out;
    })();
    function randomize(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] ^= RANDOMIZER[i % 255]; return bytes; }

    /* Reed–Solomon (255,223) with the CCSDS field polynomial 0x187, first root 112 and primitive element α¹¹.
     * Symbols are in the conventional basis (the CCSDS dual-basis transform is omitted). After Phil Karn. */
    const RS = (() => {
        const NN = 255, NROOTS = 32, FCR = 112, PRIM = 11, A0 = NN;
        const alpha = new Uint8Array(256), index = new Uint16Array(256);
        let sr = 1;
        for (let i = 0; i < NN; i++) { index[sr] = i; alpha[i] = sr; sr <<= 1; if (sr & 256) sr ^= 0x187; }
        index[0] = A0; alpha[A0] = 0;
        const mod = x => { while (x >= NN) { x -= NN; x = (x >> 8) + (x & NN); } return x; };
        let iprim = 1; while (iprim % PRIM) iprim += NN; iprim /= PRIM;
        const gen = new Uint16Array(NROOTS + 1);
        gen[0] = 1;
        for (let i = 0, r = FCR * PRIM; i < NROOTS; i++, r += PRIM) {
            gen[i + 1] = 1;
            for (let j = i; j > 0; j--) gen[j] = gen[j] ? gen[j - 1] ^ alpha[mod(index[gen[j]] + r)] : gen[j - 1];
            gen[0] = alpha[mod(index[gen[0]] + r)];
        }
        for (let i = 0; i <= NROOTS; i++) gen[i] = index[gen[i]];

        /** Encode 223 data bytes (data[0..222]) into parity[0..31]. */
        function encode(data, parity) {
            parity.fill(0);
            for (let i = 0; i < NN - NROOTS; i++) {
                const fb = index[data[i] ^ parity[0]];
                if (fb !== A0) for (let j = 1; j < NROOTS; j++) parity[j] ^= alpha[mod(fb + gen[NROOTS - j])];
                parity.copyWithin(0, 1);
                parity[NROOTS - 1] = fb !== A0 ? alpha[mod(fb + gen[0])] : 0;
            }
        }

        const lambda = new Uint16Array(NROOTS + 1), s = new Uint16Array(NROOTS), b = new Uint16Array(NROOTS + 1), t = new Uint16Array(NROOTS + 1);
        const omega = new Uint16Array(NROOTS + 1), rootv = new Uint16Array(NROOTS), reg = new Uint16Array(NROOTS + 1), loc = new Uint16Array(NROOTS);
        /** Correct a 255-byte codeword in place. Returns the number of corrected symbols, or -1 if uncorrectable. */
        function decode(data) {
            for (let i = 0; i < NROOTS; i++) s[i] = data[0];
            for (let j = 1; j < NN; j++) for (let i = 0; i < NROOTS; i++) s[i] = s[i] === 0 ? data[j] : data[j] ^ alpha[mod(index[s[i]] + (FCR + i) * PRIM)];
            let syn = 0;
            for (let i = 0; i < NROOTS; i++) { syn |= s[i]; s[i] = index[s[i]]; }
            if (!syn) return 0;
            lambda.fill(0); lambda[0] = 1;
            for (let i = 0; i <= NROOTS; i++) b[i] = index[lambda[i]];
            let r = 0, el = 0;
            while (++r <= NROOTS) {
                let d = 0;
                for (let i = 0; i < r; i++) if (lambda[i] !== 0 && s[r - i - 1] !== A0) d ^= alpha[mod(index[lambda[i]] + s[r - i - 1])];
                d = index[d];
                if (d === A0) { b.copyWithin(1, 0, NROOTS); b[0] = A0; }
                else {
                    t[0] = lambda[0];
                    for (let i = 0; i < NROOTS; i++) t[i + 1] = b[i] !== A0 ? lambda[i + 1] ^ alpha[mod(d + b[i])] : lambda[i + 1];
                    if (2 * el <= r - 1) {
                        el = r - el;
                        for (let i = 0; i <= NROOTS; i++) b[i] = lambda[i] === 0 ? A0 : mod(index[lambda[i]] - d + NN);
                    } else { b.copyWithin(1, 0, NROOTS); b[0] = A0; }
                    lambda.set(t);
                }
            }
            let degL = 0;
            for (let i = 0; i <= NROOTS; i++) { lambda[i] = index[lambda[i]]; if (lambda[i] !== A0) degL = i; }
            reg.set(lambda);
            let count = 0;
            for (let i = 1, k = iprim - 1; i <= NN; i++, k = mod(k + iprim)) {
                let q = 1;
                for (let j = degL; j > 0; j--) if (reg[j] !== A0) { reg[j] = mod(reg[j] + j); q ^= alpha[reg[j]]; }
                if (q !== 0) continue;
                rootv[count] = i; loc[count] = k;
                if (++count === degL) break;
            }
            if (degL !== count) return -1;
            const degO = degL - 1;
            for (let i = 0; i <= degO; i++) {
                let tmp = 0;
                for (let j = i; j >= 0; j--) if (s[i - j] !== A0 && lambda[j] !== A0) tmp ^= alpha[mod(s[i - j] + lambda[j])];
                omega[i] = index[tmp];
            }
            for (let j = count - 1; j >= 0; j--) {
                let num1 = 0;
                for (let i = degO; i >= 0; i--) if (omega[i] !== A0) num1 ^= alpha[mod(omega[i] + i * rootv[j])];
                const num2 = alpha[mod(rootv[j] * (FCR - 1) + NN)];
                let den = 0;
                for (let i = Math.min(degL, NROOTS - 1) & ~1; i >= 0; i -= 2) if (lambda[i + 1] !== A0) den ^= alpha[mod(lambda[i + 1] + i * rootv[j])];
                if (num1 !== 0 && den !== 0) data[loc[j]] ^= alpha[mod(index[num1] + index[num2] + NN - index[den])];
            }
            return count;
        }
        return { encode, decode };
    })();

    /* Convolutional code (7, 1/2): G1 = 171₈, G2 = 133₈ with the G2 output inverted, as CCSDS specifies.
     * The register holds the newest bit in position 6. A state is the last six input bits, newest in bit 5. */
    const G1 = 0x79, G2 = 0x5B;
    const OUT = new Uint8Array(128);
    for (let s = 0; s < 64; s++) for (let b = 0; b < 2; b++) { const r = (b << 6) | s; OUT[s * 2 + b] = (parity(r & G1) << 1) | (parity(r & G2) ^ 1); }
    function convEncode(bits) {
        const out = new Uint8Array(bits.length * 2);
        let s = 0;
        for (let i = 0; i < bits.length; i++) {
            const o = OUT[s * 2 + bits[i]];
            out[2 * i] = o >> 1; out[2 * i + 1] = o & 1;
            s = (bits[i] << 5) | (s >> 1);
        }
        return out;
    }
    /** Soft-decision Viterbi decoder. `soft` holds log-likelihood ratios (positive favours bit 0), two per input bit. */
    function viterbi(soft, start = 0, end = soft.length) {
        const n = (end - start) >> 1;
        const out = new Uint8Array(n);
        if (!n) return out;
        const dec = new Uint32Array(n * 2);
        let pm = new Float64Array(64), nm = new Float64Array(64);
        const bm = new Float64Array(4);
        for (let t = 0; t < n; t++) {
            const l1 = soft[start + 2 * t], l2 = soft[start + 2 * t + 1];
            bm[0] = l1 + l2; bm[1] = l1 - l2; bm[2] = -l1 + l2; bm[3] = -l1 - l2;
            let lo = 0, hi = 0, best = -Infinity;
            for (let ns = 0; ns < 64; ns++) {
                const b = ns >> 5, m = ns & 31, p0 = m << 1, p1 = p0 | 1;
                const c0 = pm[p0] + bm[OUT[p0 * 2 + b]], c1 = pm[p1] + bm[OUT[p1 * 2 + b]];
                if (c1 > c0) { nm[ns] = c1; if (b) hi |= 1 << m; else lo |= 1 << m; } else nm[ns] = c0;
                if (nm[ns] > best) best = nm[ns];
            }
            dec[2 * t] = lo; dec[2 * t + 1] = hi;
            for (let i = 0; i < 64; i++) nm[i] -= best;
            const tmp = pm; pm = nm; nm = tmp;
        }
        let s = 0;
        for (let i = 1; i < 64; i++) if (pm[i] > pm[s]) s = i;
        for (let t = n - 1; t >= 0; t--) {
            const b = s >> 5, m = s & 31;
            out[t] = b;
            const x = (dec[2 * t + b] >>> m) & 1;
            s = (m << 1) | x;
        }
        return out;
    }

    /* ---------------- framing ---------------- */
    const CODING = {
        none: { rs: false, conv: false, label: 'Uncoded' },
        conv: { rs: false, conv: true, label: 'Convolutional (7, ½)' },
        rs: { rs: true, conv: false, label: 'Reed–Solomon (255, 223)' },
        concat: { rs: true, conv: true, label: 'Reed–Solomon + convolutional' }
    };
    const MODULATION = {
        bpsk: { bits: 1, order: 2, label: 'BPSK' },
        qpsk: { bits: 2, order: 4, label: 'QPSK' },
        '8psk': { bits: 3, order: 8, label: '8PSK' },
        gmsk: { bits: 1, order: 0, label: 'GMSK' }
    };
    const codeblockBytes = coding => CODING[coding].rs ? 255 * DEPTH : FRAME_BYTES;
    const caduBits = coding => 32 + 8 * codeblockBytes(coding);
    const channelBitsPerCadu = coding => caduBits(coding) * (CODING[coding].conv ? 2 : 1);

    /** Transfer frame: 2-byte marker, 2-byte frame index, 2-byte payload length, payload, CRC-16. */
    function makeFrame(index, payload) {
        const f = new Uint8Array(FRAME_BYTES);
        f[0] = 0x0A; f[1] = 0x5C;
        f[2] = index >> 8; f[3] = index & 255;
        f[4] = payload.length >> 8; f[5] = payload.length & 255;
        f.set(payload, HEADER);
        if (index === IDLE) for (let i = HEADER; i < FRAME_BYTES - FECF; i++) f[i] = 0x55;
        const crc = crc16(f, 0, FRAME_BYTES - FECF);
        f[FRAME_BYTES - 2] = crc >> 8; f[FRAME_BYTES - 1] = crc & 255;
        return f;
    }
    function codeblock(frame, coding) {
        const cb = new Uint8Array(codeblockBytes(coding));
        if (CODING[coding].rs) {
            const data = new Uint8Array(223), par = new Uint8Array(32);
            for (let i = 0; i < DEPTH; i++) {
                for (let m = 0; m < 223; m++) data[m] = frame[m * DEPTH + i];
                RS.encode(data, par);
                for (let m = 0; m < 223; m++) cb[m * DEPTH + i] = data[m];
                for (let m = 0; m < 32; m++) cb[(223 + m) * DEPTH + i] = par[m];
            }
        } else cb.set(frame);
        return randomize(cb);
    }
    function pushBits(out, at, value, nbits) { for (let b = nbits - 1; b >= 0; b--) out[at++] = (value >>> b) & 1; return at; }

    /** Build the transmitted bit stream for a payload. */
    function buildStream(payload, coding) {
        const imageFrames = Math.max(1, Math.ceil(payload.length / PAYLOAD_BYTES));
        const total = LEAD_IN + imageFrames + TAIL;
        const cadu = caduBits(coding);
        const bits = new Uint8Array(total * cadu);
        const frames = [];
        let at = 0;
        for (let f = 0; f < total; f++) {
            const image = f - LEAD_IN;
            const idx = image >= 0 && image < imageFrames ? image : IDLE;
            const chunk = idx === IDLE ? new Uint8Array(0) : payload.subarray(image * PAYLOAD_BYTES, Math.min(payload.length, (image + 1) * PAYLOAD_BYTES));
            const frame = makeFrame(idx, chunk);
            const cb = codeblock(frame, coding);
            at = pushBits(bits, at, ASM, 32);
            for (const byte of cb) at = pushBits(bits, at, byte, 8);
            frames.push({ index: idx, frame, codeblock: cb });
        }
        const channel = CODING[coding].conv ? convEncode(bits) : bits;
        return { bits, channel, frames, imageFrames, total };
    }

    /** Symbols, airtime and stream layout for a payload, without generating samples. */
    function plan(o) {
        const mod = MODULATION[o.modulation], perCadu = channelBitsPerCadu(o.coding);
        const imageFrames = Math.max(1, Math.ceil(o.payloadBytes / PAYLOAD_BYTES));
        const cadus = LEAD_IN + imageFrames + TAIL;
        const symbols = Math.ceil(cadus * perCadu / mod.bits);
        return { imageFrames, cadus, symbols, seconds: symbols / o.symbolRate, channelBitsPerCadu: perCadu, caduBits: caduBits(o.coding),
            frameBytes: FRAME_BYTES, payloadBytes: PAYLOAD_BYTES };
    }

    /** Ratio of channel symbol rate to transfer-frame bit rate, i.e. coding and sync overhead per modulation bit. */
    function overhead(coding) { return caduBits(coding) / (8 * FRAME_BYTES) * (CODING[coding].conv ? 2 : 1); }

    /* ---------------- constellations ---------------- */
    const GRAY8 = [0, 1, 3, 2, 6, 7, 5, 4];      // labels around the circle; neighbours differ in one bit
    function constellation(modulation) {
        const n = MODULATION[modulation].order, re = new Float64Array(n), im = new Float64Array(n);
        if (modulation === 'bpsk') { re[0] = 1; re[1] = -1; }
        else if (modulation === 'qpsk') for (let v = 0; v < 4; v++) { re[v] = (1 - 2 * (v >> 1)) / Math.SQRT2; im[v] = (1 - 2 * (v & 1)) / Math.SQRT2; }
        else for (let v = 0; v < 8; v++) {
            // Gray labels around the circle: neighbours differ in one bit.
            const k = GRAY8.indexOf(v);
            re[v] = Math.cos(TAU * k / 8); im[v] = Math.sin(TAU * k / 8);
        }
        return { re, im, n, bits: MODULATION[modulation].bits };
    }

    function mapSymbols(channel, modulation) {
        const c = constellation(modulation), m = c.bits;
        const n = Math.ceil(channel.length / m), re = new Float32Array(n), im = new Float32Array(n);
        for (let k = 0; k < n; k++) {
            let v = 0;
            for (let b = 0; b < m; b++) v = (v << 1) | (channel[k * m + b] || 0);
            re[k] = c.re[v]; im[k] = c.im[v];
        }
        return { re, im };
    }

    /* ---------------- pulses ---------------- */
    const RRC_ALPHA = 0.35, SPAN = 4, RES = 64;
    function rrc(t, a = RRC_ALPHA) {
        if (Math.abs(t) < 1e-9) return 1 - a + 4 * a / Math.PI;
        if (Math.abs(Math.abs(t) - 1 / (4 * a)) < 1e-9) return a / Math.SQRT2 * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * a)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * a)));
        return (Math.sin(Math.PI * t * (1 - a)) + 4 * a * t * Math.cos(Math.PI * t * (1 + a))) / (Math.PI * t * (1 - (4 * a * t) ** 2));
    }
    /** Root-raised-cosine table over ±SPAN symbols, scaled to unit energy when sampled at SPS per symbol. */
    const RRC_TABLE = (() => {
        const tab = new Float64Array(2 * SPAN * RES + 2);
        for (let i = 0; i < tab.length; i++) tab[i] = rrc(i / RES - SPAN);
        let e = 0;
        for (let n = -SPAN * SPS; n <= SPAN * SPS; n++) e += rrc(n / SPS) ** 2;
        const g = 1 / Math.sqrt(e);
        for (let i = 0; i < tab.length; i++) tab[i] *= g;
        return tab;
    })();
    const MF_TAPS = (() => {
        const taps = new Float64Array(2 * SPAN * SPS + 1);
        let e = 0;
        for (let n = 0; n < taps.length; n++) { taps[n] = rrc((n - SPAN * SPS) / SPS); e += taps[n] ** 2; }
        for (let n = 0; n < taps.length; n++) taps[n] /= Math.sqrt(e);
        return taps;
    })();

    /* GMSK, BT = 0.5, h = 0.5: cumulative frequency pulse over ±3 symbols. */
    const GMSK_BT = 0.5, GSPAN = 3;
    const GMSK_Q = (() => {
        const sigma = Math.sqrt(Math.log(2)) / (TAU * GMSK_BT);
        const n = 2 * GSPAN * RES + 2, q = new Float64Array(n);
        const g = t => 0.5 * (erf((t + 0.5) / (sigma * Math.SQRT2)) - erf((t - 0.5) / (sigma * Math.SQRT2)));
        let acc = 0;
        for (let i = 1; i < n; i++) { const t0 = (i - 1) / RES - GSPAN, t1 = i / RES - GSPAN; acc += 0.5 * (g(t0) + g(t1)) / RES; q[i] = acc; }
        const end = q[2 * GSPAN * RES];
        for (let i = 0; i < n; i++) q[i] = Math.min(1, q[i] / end);
        return q;
    })();

    /* ---------------- channel ---------------- */
    /** Cubic Hermite interpolation of ΔR(t) on uniform knots, with first derivatives. */
    function hermite(k) {
        const { t0, h, v, d } = k;
        const last = v.length - 1;
        return function (t) {
            let x = (t - t0) / h, i = Math.floor(x);
            if (i < 0) i = 0; else if (i >= last) i = last - 1;
            const s = x - i, s2 = s * s, s3 = s2 * s;
            return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * d[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * d[i + 1];
        };
    }
    function lerp(k, arr) {
        const last = arr.length - 1;
        return t => {
            let x = (t - k.t0) / k.h, i = Math.floor(x);
            if (i < 0) return arr[0];
            if (i >= last) return arr[last];
            return arr[i] + (x - i) * (arr[i + 1] - arr[i]);
        };
    }

    /**
     * Received complex baseband after the receiver's Doppler pre-correction.
     * link.knots: { t0, h, dR[], dRdot[], dRh[]|null, dRhdot[]|null, esn0[] } with ranges in km, rates in km/s, Es/N0 in dB.
     */
    function channel(tx, o, onProgress) {
        const { link } = o, k = link.knots;
        const Rs = o.symbolRate, Fs = Rs * SPS, fc = o.fc;
        const nSym = tx.n, total = (nSym + 2 * SPAN + 8) * SPS;
        const iq = new Float32Array(total * 2);
        const R = hermite({ t0: k.t0, h: k.h, v: k.dR, d: k.dRdot });
        const Rh = k.dRh ? hermite({ t0: k.t0, h: k.h, v: k.dRh, d: k.dRhdot }) : () => 0;
        const esn0 = lerp(k, k.esn0);
        const resid = lerp(k, k.dRdot.map((v, i) => -fc * (v - (k.dRhdot ? k.dRhdot[i] : 0)) / C_KM + (link.oscHz || 0)));
        const r = rng(o.seed ^ 0x5bd1e995);
        const pnStep = Math.sqrt(TAU * (link.linewidthHz || 0) / Fs);
        let pn = TAU * r();
        const start = SPAN + 4;                // symbols of silence before the first symbol
        const gm = tx.gmsk, prefix = tx.prefix;
        const amp = gm ? 1 / Math.sqrt(SPS) : 1;
        const outside = 0.45 * Fs;
        let sigma = 0, gate = 1, blind = 0;
        for (let n = 0; n < total; n++) {
            const t = n / Fs;
            if ((n & 1023) === 0) {
                sigma = Math.sqrt(0.5 * 10 ** (-esn0(t) / 10));
                gate = Math.abs(resid(t)) < outside ? 1 : 0;
                if (!gate) blind++;
                if (onProgress && (n & 262143) === 0) onProgress(n / total);
            }
            const dR = R(t);
            const u = (t - dR / C_KM) * Rs - start;          // symbol clock in the transmitter's time
            let sr = 0, si = 0;
            if (gate) {
                if (gm) {
                    const klo = Math.max(0, Math.ceil(u - GSPAN)), khi = Math.min(nSym - 1, Math.floor(u + GSPAN));
                    let ph = klo > 0 ? prefix[Math.min(klo, nSym)] : 0;
                    for (let kk = klo; kk <= khi; kk++) {
                        const x = (u - kk + GSPAN) * RES, i = x | 0;
                        ph += gm[kk] * (GMSK_Q[i] + (x - i) * (GMSK_Q[i + 1] - GMSK_Q[i]));
                    }
                    if (u - GSPAN > nSym - 1) ph = prefix[nSym];
                    const on = u > -GSPAN && u < nSym + GSPAN ? amp : 0;
                    sr = on * Math.cos(ph * Math.PI / 2); si = on * Math.sin(ph * Math.PI / 2);
                } else {
                    const k0 = Math.floor(u);
                    for (let kk = k0 - SPAN + 1; kk <= k0 + SPAN; kk++) {
                        if (kk < 0 || kk >= nSym) continue;
                        const x = (u - kk + SPAN) * RES, i = x | 0;
                        const p = RRC_TABLE[i] + (x - i) * (RRC_TABLE[i + 1] - RRC_TABLE[i]);
                        sr += tx.re[kk] * p; si += tx.im[kk] * p;
                    }
                }
            }
            let cyc = -fc * (dR - Rh(t)) / C_KM + (link.oscHz || 0) * t;
            cyc -= Math.floor(cyc);
            pn += pnStep * r.gauss();
            const th = TAU * cyc + pn, c = Math.cos(th), s = Math.sin(th);
            iq[2 * n] = sr * c - si * s + sigma * r.gauss();
            iq[2 * n + 1] = sr * s + si * c + sigma * r.gauss();
        }
        return { iq, Fs, start, blindFraction: blind / Math.ceil(total / 1024), resid };
    }

    /* ---------------- receiver ---------------- */
    function filterComplex(iq, taps, from = 0, to = iq.length / 2) {
        const n = to - from, L = taps.length, D = (L - 1) >> 1, out = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
            let sr = 0, si = 0;
            const c = from + i + D;
            for (let k = 0; k < L; k++) {
                const j = c - k;
                if (j < from || j >= to) continue;
                sr += taps[k] * iq[2 * j]; si += taps[k] * iq[2 * j + 1];
            }
            out[2 * i] = sr; out[2 * i + 1] = si;
        }
        return out;
    }
    function mix(iq, hz, Fs) {
        const w = TAU * hz / Fs;
        let cr = 1, ci = 0;
        const sr = Math.cos(-w), si = Math.sin(-w);
        for (let n = 0; n < iq.length / 2; n++) {
            const a = iq[2 * n], b = iq[2 * n + 1];
            iq[2 * n] = a * cr - b * ci; iq[2 * n + 1] = a * ci + b * cr;
            const nr = cr * sr - ci * si; ci = cr * si + ci * sr; cr = nr;
            if ((n & 4095) === 4095) { const m = 1 / Math.hypot(cr, ci); cr *= m; ci *= m; }
        }
    }

    /** Average periodogram (Hann window) of complex samples; returns power per bin, natural order. */
    function periodogram(iq, from, count, nfft, blocks, raise = 1) {
        const re = new Float64Array(nfft), im = new Float64Array(nfft), p = new Float64Array(nfft);
        let used = 0;
        for (let b = 0; b < blocks; b++) {
            const s = from + b * nfft;
            if (s + nfft > from + count) break;
            for (let i = 0; i < nfft; i++) {
                const w = 0.5 - 0.5 * Math.cos(TAU * i / nfft);
                let a = iq[2 * (s + i)], c = iq[2 * (s + i) + 1];
                for (let r = 1; r < raise; r++) { const na = a * iq[2 * (s + i)] - c * iq[2 * (s + i) + 1]; c = a * iq[2 * (s + i) + 1] + c * iq[2 * (s + i)]; a = na; }
                // Hard-limit to unit magnitude: amplitude ripple at the symbol rate would otherwise put
                // spurious lines at multiples of Rs/M next to the carrier line.
                if (raise > 1) { const m = Math.hypot(a, c); const g = m > 0 ? 1 / m : 0; a *= g; c *= g; }
                re[i] = a * w; im[i] = c * w;
            }
            fft(re, im);
            for (let i = 0; i < nfft; i++) p[i] += re[i] * re[i] + im[i] * im[i];
            used++;
        }
        if (used) for (let i = 0; i < nfft; i++) p[i] /= used;
        return { p, used };
    }

    /**
     * Carrier acquisition. PSK: the M-th power of the matched-filter output has a line at M times the carrier
     * offset; non-coherent averaging of 8,192-point FFTs keeps it narrow while the Doppler drifts.
     * GMSK: the centroid of the excess spectrum within the search window.
     * Only offsets within ±search Hz are examined, as in a real modem's acquisition sweep.
     */
    function acquire(iq, Fs, Rs, modulation, searchHz) {
        const nfft = 8192, total = iq.length / 2;
        // Up to 24 non-coherently averaged blocks (about 200,000 samples) when the burst is long enough.
        const blocks = Math.max(1, Math.min(24, Math.floor(Math.min(total, 24 * nfft) / nfft)));
        const span = Math.min(total, blocks * nfft);
        if (modulation === 'gmsk') {
            const { p } = periodogram(iq, 0, span, nfft, blocks);
            const sorted = Float64Array.from(p).sort();
            const floor = sorted[nfft >> 2];         // lower quartile: noise bins well outside the signal
            const halfBand = Math.min(Fs / 2, searchHz + 0.75 * Rs);
            let sw = 0, sf = 0, excess = 0, binsIn = 0;
            for (let i = 0; i < nfft; i++) {
                const f = (i < nfft / 2 ? i : i - nfft) * Fs / nfft;
                if (Math.abs(f) > halfBand) continue;
                binsIn++;
                const e = p[i] - floor;
                if (e > 0) { sw += e; sf += e * f; }
                excess += p[i] - floor;
            }
            const metric = excess / (floor * Math.sqrt(binsIn / blocks));
            const f = sw > 0 ? sf / sw : 0;
            return { found: metric > 6 && Math.abs(f) <= searchHz + 0.05 * Rs, hz: f, metric };
        }
        const M = MODULATION[modulation].order;
        const mf = filterComplex(iq, MF_TAPS, 0, span);
        const { p } = periodogram(mf, 0, span, nfft, blocks, M);
        const limit = Math.min(searchHz, Fs / (2 * M) * 0.98);
        // Filtered noise raised to the M-th power is not white, and the modulated signal's own spectrum has
        // sloped edges. Each bin is compared with the higher of its two neighbourhoods (4–48 bins either side):
        // a carrier line stands above both, while the edge of a sloped spectrum only stands above one.
        const prefix = new Float64Array(nfft * 3 + 1);
        for (let i = 0; i < nfft * 3; i++) prefix[i + 1] = prefix[i] + p[i % nfft];
        const local = i => {
            const c = i + nfft;
            return Math.max(prefix[c - 3] - prefix[c - 48], prefix[c + 49] - prefix[c + 4]) / 45;
        };
        // The M-th power also has weaker lines at ±Rs (±Rs/M after dividing by M) from the symbol clock.
        // Those sit beside the carrier line, so the carrier is the bin that collects its own level plus
        // both neighbours; a symbol-clock line only has the carrier on one side.
        const ratio = new Float64Array(nfft);
        for (let i = 0; i < nfft; i++) ratio[i] = p[i] / local(i);
        const d = nfft / SPS;
        const near = j => { let v = 0; for (let k = -2; k <= 2; k++) v = Math.max(v, ratio[((j + k) % nfft + nfft) % nfft]); return v; };
        let best = 0, bestI = 0, count = 0, bestScore = -Infinity;
        for (let i = 0; i < nfft; i++) {
            const f = (i < nfft / 2 ? i : i - nfft) * Fs / nfft / M;
            if (Math.abs(f) > limit) continue;
            count++;
            const score = ratio[i] + near(i - d) + near(i + d);
            if (score > bestScore) { bestScore = score; best = ratio[i]; bestI = i; }
        }
        // Parabolic peak refinement.
        const a = p[(bestI - 1 + nfft) % nfft], b = p[bestI], c = p[(bestI + 1) % nfft];
        const shift = (a - 2 * b + c) !== 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
        const bin = (bestI < nfft / 2 ? bestI : bestI - nfft) + Math.max(-0.5, Math.min(0.5, shift));
        // Each bin is a mean of B exponential variables (Gamma, shape B). Pick the level that noise alone
        // exceeds in fewer than 1 in 1,000 acquisitions across all searched bins.
        const threshold = gammaThreshold(blocks, 1e-3 / Math.max(1, count));
        return { found: best > threshold, hz: bin * Fs / nfft / M, metric: best, threshold };
    }

    /** x such that P(mean of k unit exponentials > x) = p. */
    function gammaThreshold(k, p) {
        const tail = x => { let term = 1, sum = 1; for (let i = 1; i < k; i++) { term *= k * x / i; sum += term; } return Math.exp(-k * x) * sum; };
        let lo = 1, hi = 60;
        for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (tail(mid) > p) lo = mid; else hi = mid; }
        return hi;
    }

    function cubic(buf, x, out, stride = 2) {
        const i = Math.floor(x), f = x - i;
        const cm = -f * (f - 1) * (f - 2) / 6, c0 = (f + 1) * (f - 1) * (f - 2) / 2, c1 = -(f + 1) * f * (f - 2) / 2, c2 = (f + 1) * f * (f - 1) / 6;
        const a = (i - 1) * stride, b = i * stride, c = (i + 1) * stride, d = (i + 2) * stride;
        out[0] = cm * buf[a] + c0 * buf[b] + c1 * buf[c] + c2 * buf[d];
        if (stride === 2) out[1] = cm * buf[a + 1] + c0 * buf[b + 1] + c1 * buf[c + 1] + c2 * buf[d + 1];
    }

    function loopGains(bnt, zeta = 0.7071, kd = 1) {
        const th = bnt / (zeta + 1 / (4 * zeta)), den = 1 + 2 * zeta * th + th * th;
        return { k1: 4 * zeta * th / den / kd, k2: 4 * th * th / den / kd };
    }

    /** Coherent PSK demodulator: Gardner timing and a decision-directed second-order carrier loop. */
    function demodPSK(y, o, track) {
        const c = constellation(o.modulation), M = c.n;
        const total = y.length / 2, maxSym = Math.floor(total / SPS) - 4;
        const zr = new Float32Array(maxSym), zi = new Float32Array(maxSym);
        // Normalise to roughly unit symbol energy before the timing loop.
        let pw = 0; const pn = Math.min(total, 65536);
        for (let i = 0; i < pn; i++) pw += y[2 * i] ** 2 + y[2 * i + 1] ** 2;
        let agc = 1 / Math.sqrt(Math.max(1e-12, pw / pn));
        // Gardner detector slope is about 1 per symbol of timing error for unit-amplitude RRC PSK (measured).
        // Gear shifting: the timing loop starts at 4× and then 2× its bandwidth for fast pull-in, then narrows.
        const tBnT = o.timingBnT || 0.0015;   // wider loops slip symbols below 0 dB Es/N0
        // Only the timing loop gear-shifts. The carrier phase is seeded feed-forward, and a wide carrier loop at
        // low SNR random-walks its frequency estimate into a false lock.
        const gears = [4, 2, 1].map(g => ({ t: loopGains(Math.min(0.02, tBnT * g), 0.7071, 1.0), c: loopGains(o.carrierBnT) }));
        let tl = gears[0].t, cl = gears[0].c;
        let mu = 2 * SPAN * SPS / 2 + 2, tInt = 0, theta = 0, omega = 0;
        const cur = [0, 0], mid = [0, 0];
        // Seed the carrier phase with a feed-forward M-th power estimate over the first 1,024 symbols, so a
        // decision-directed loop does not start near a decision boundary and hang there.
        // Only the sample phase with the most energy (nearest the symbol centres) is used: samples between
        // symbols mix neighbours and would bias the estimate.
        {
            const start = Math.round(mu), n = Math.min(1024, Math.floor((total - start - 4) / SPS));
            let bestPhase = 0, bestPower = -1;
            for (let ph = 0; ph < SPS; ph++) {
                let pw = 0;
                for (let j = 0; j < n; j++) { const i = start + ph + j * SPS; pw += y[2 * i] ** 2 + y[2 * i + 1] ** 2; }
                if (pw > bestPower) { bestPower = pw; bestPhase = ph; }
            }
            let sr = 0, si = 0;
            for (let j = 0; j < n; j++) {
                const i = start + bestPhase + j * SPS, ph = Math.atan2(y[2 * i + 1], y[2 * i]) * M;
                sr += Math.cos(ph); si += Math.sin(ph);
            }
            theta = Math.atan2(si, sr) / M;
            // The same sample phase is the feed-forward timing estimate: starting Gardner there avoids its
            // unstable point half a symbol away, where it can hang for thousands of symbols.
            mu = start + bestPhase;
        }
        let pr = 0, pi = 0, k = 0;
        let m2 = 0, m4 = 0, lockAcc = 0, blockN = 0, sSm = 0, nSm = 0;
        const block = 256;
        while (k < maxSym && mu + SPS + 3 < total) {
            if (k === 600) ({ t: tl, c: cl } = gears[1]);
            else if (k === 1500) ({ t: tl, c: cl } = gears[2]);
            cubic(y, mu, cur); cubic(y, mu - SPS / 2, mid);
            const yr = cur[0] * agc, yi = cur[1] * agc, mr = mid[0] * agc, mi = mid[1] * agc;
            // Gardner timing error (rotation invariant).
            const et = (pr - yr) * mr + (pi - yi) * mi;
            tInt += tl.k2 * et;
            mu += SPS + SPS * (tl.k1 * et + tInt);
            pr = yr; pi = yi;
            // Carrier loop.
            const cs = Math.cos(theta), sn = Math.sin(theta);
            const r = yr * cs + yi * sn, i = yi * cs - yr * sn;
            let best = 0, bd = Infinity;
            for (let v = 0; v < M; v++) { const d = (r - c.re[v]) ** 2 + (i - c.im[v]) ** 2; if (d < bd) { bd = d; best = v; } }
            const e = Math.atan2(i * c.re[best] - r * c.im[best], r * c.re[best] + i * c.im[best]);
            // The frequency integrator waits until symbol timing has settled: decisions made on badly timed
            // samples can kick it into a rotating false lock that a decision-directed loop never leaves.
            if (k >= 400) omega += cl.k2 * e;
            theta += omega + cl.k1 * e;
            if (theta > Math.PI) theta -= TAU; else if (theta < -Math.PI) theta += TAU;
            zr[k] = r; zi[k] = i;
            const p2 = r * r + i * i;
            // Lock indicator: share of symbols within half a decision sector of the nearest point, mapped so
            // a spinning (unlocked) carrier reads 0 and a clean lock reads 1.
            m2 += p2; m4 += p2 * p2; lockAcc += Math.abs(e) < Math.PI / (2 * M) ? 1 : 0; blockN++;
            if (blockN === block) {
                m2 /= block; m4 /= block;
                // M2M4 signal and noise power, smoothed across blocks because single blocks are noisy below 0 dB.
                const S = Math.sqrt(Math.max(0, 2 * m2 * m2 - m4)), N = Math.max(1e-9, m2 - S);
                const a = sSm ? 0.25 : 1;
                sSm += a * (S - sSm); nSm += a * (N - nSm);
                const sScaled = sSm, nScaled = Math.max(1e-9, nSm);
                // Slow AGC toward unit signal amplitude. Smoothed powers are rescaled so they stay comparable.
                if (sSm > 1e-6) { const g = Math.pow(1 / Math.sqrt(sSm), 0.25); agc *= g; sSm *= g * g; nSm *= g * g; }
                track.push({ symbol: k, omega, esn0: sScaled / nScaled, lock: Math.max(0, 2 * lockAcc / block - 1) });
                m2 = m4 = lockAcc = 0; blockN = 0;
            }
            k++;
        }
        return { zr: zr.subarray(0, k), zi: zi.subarray(0, k), count: k };
    }

    /** Limiter–discriminator GMSK receiver with integrate-and-dump and Gardner timing on the frequency signal. */
    function demodGMSK(x, o, track) {
        const total = x.length / 2;
        const freq = new Float32Array(total);
        for (let n = 1; n < total; n++) {
            const a = x[2 * n], b = x[2 * n + 1], c = x[2 * n - 2], d = x[2 * n - 1];
            freq[n] = Math.atan2(b * c - a * d, a * c + b * d);
        }
        // Integrate over one symbol (scaled so a full ±π/2 phase step reads ±1), then remove the slowly
        // varying offset (residual Doppler) with a long average.
        const integ = new Float32Array(total);
        let acc = 0;
        for (let n = 0; n < total; n++) { acc += freq[n] - (n >= SPS ? freq[n - SPS] : 0); integ[n] = acc * 2 / Math.PI; }
        const maxSym = Math.floor(total / SPS) - 4, soft = new Float32Array(maxSym);
        // Measured Gardner slope on the normalised discriminator output is about 0.6 per symbol.
        const gears = [4, 2, 1].map(g => loopGains((o.timingBnT || 0.0015) * g, 0.7071, 0.6));
        let tl = gears[0];
        let mu = SPS + 2, tInt = 0, prev = 0, k = 0, dc = 0;
        const dcAlpha = 1 / 2000, out = [0], midv = [0];
        let sAbs = 0, sSq = 0, blockN = 0;
        while (k < maxSym && mu + SPS + 3 < total) {
            if (k === 600) tl = gears[1]; else if (k === 1500) tl = gears[2];
            cubic(integ, mu, out, 1); cubic(integ, mu - SPS / 2, midv, 1);
            const v = out[0] - dc, m = midv[0] - dc;
            dc += dcAlpha * (out[0] - dc);
            const et = (prev - v) * m;
            tInt += tl.k2 * et;
            mu += SPS + SPS * (tl.k1 * et + tInt);
            prev = v;
            soft[k] = v;
            sAbs += Math.abs(v); sSq += v * v; blockN++;
            if (blockN === 256) {
                const mean = sAbs / 256, varr = Math.max(1e-9, sSq / 256 - mean * mean);
                track.push({ symbol: k, omega: dc * Math.PI / 2, esn0: null, lock: Math.min(1, mean), snr: mean * mean / varr });
                sAbs = sSq = 0; blockN = 0;
            }
            k++;
        }
        return { soft: soft.subarray(0, k), count: k, integ, freqSignal: freq };
    }

    /* ---------------- soft bits, ambiguity and frame sync ---------------- */
    function softBits(rx, modulation, rotation, from, to, n0) {
        if (modulation === 'gmsk') {
            const out = new Float32Array(to - from);
            const clip = rx.clip || Infinity;
            for (let k = from; k < to; k++) out[k - from] = Math.max(-clip, Math.min(clip, rx.soft[k])) * rx.llrScale;
            return out;
        }
        const c = constellation(modulation), m = c.bits, M = c.n;
        const cr = Math.cos(TAU * rotation / M), ci = Math.sin(TAU * rotation / M);
        const out = new Float32Array((to - from) * m), d = new Float64Array(M);
        for (let k = from; k < to; k++) {
            const r0 = rx.zr[k], i0 = rx.zi[k];
            const r = r0 * cr - i0 * ci, i = r0 * ci + i0 * cr;
            for (let v = 0; v < M; v++) d[v] = (r - c.re[v]) ** 2 + (i - c.im[v]) ** 2;
            for (let b = 0; b < m; b++) {
                let d0 = Infinity, d1 = Infinity;
                const mask = 1 << (m - 1 - b);
                for (let v = 0; v < M; v++) if (v & mask) { if (d[v] < d1) d1 = d[v]; } else if (d[v] < d0) d0 = d[v];
                out[(k - from) * m + b] = (d1 - d0) / n0;
            }
        }
        return out;
    }

    const ASM_BITS = Uint8Array.from({ length: 32 }, (_, i) => (ASM >>> (31 - i)) & 1);
    function asmErrors(bits, p) { let e = 0; for (let i = 0; i < 32; i++) e += bits[p + i] ^ ASM_BITS[i]; return e; }
    function findAsm(bits, from, to, maxErr) {
        for (let p = Math.max(0, from); p + 32 <= Math.min(bits.length, to); p++) if (asmErrors(bits, p) <= maxErr) return p;
        return -1;
    }

    /** Try every carrier-phase rotation (and, for coded streams, both symbol-pair alignments). */
    function searchHypothesis(rx, o, fromSym, n0) {
        const mod = MODULATION[o.modulation], conv = CODING[o.coding].conv;
        const cadu = caduBits(o.coding), chanPer = channelBitsPerCadu(o.coding);
        const syms = Math.min(rx.count - fromSym, Math.ceil(3.2 * chanPer / mod.bits));
        if (syms * mod.bits < chanPer * 1.05) return null;
        const rotations = o.modulation === 'gmsk' ? 1 : mod.order;
        let best = null;
        for (let rot = 0; rot < rotations; rot++) {
            const soft = softBits(rx, o.modulation, rot, fromSym, fromSym + syms, n0);
            for (let off = 0; off < (conv ? 2 : 1); off++) {
                const bits = conv ? viterbi(soft, off, soft.length - ((soft.length - off) & 1)) : hard(soft);
                // The first marker can fall inside the loops' pull-in, so look across two frames.
                const p = findAsm(bits, 0, Math.min(bits.length, 2 * cadu + 64), 2);
                if (p < 0) continue;
                const q = p + cadu + 32 <= bits.length ? asmErrors(bits, p + cadu) : 0;
                const score = 64 - asmErrors(bits, p) - q;
                // Both markers must match closely; a single loose match is usually a wrong phase rotation.
                if (score >= 58 && (!best || score > best.score)) best = { rot, off, p, score };
            }
        }
        return best;
    }
    function hard(soft) { const b = new Uint8Array(soft.length); for (let i = 0; i < soft.length; i++) b[i] = soft[i] < 0 ? 1 : 0; return b; }
    function bitsToBytes(bits, from, nbytes) {
        const out = new Uint8Array(nbytes);
        for (let i = 0; i < nbytes; i++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[from + 8 * i + b]; out[i] = v; }
        return out;
    }

    /** Recover frames from demodulated symbols. Re-acquires phase and sync after a loss of lock. */
    function decodeFrames(rx, o, n0) {
        const mod = MODULATION[o.modulation], conv = CODING[o.coding].conv, rs = CODING[o.coding].rs;
        const cadu = caduBits(o.coding), cbBytes = codeblockBytes(o.coding);
        const found = [];
        let fromSym = 0, attempts = 0, symbolsUsed = 0, segments = 0;
        while (fromSym < rx.count && attempts < 40) {
            attempts++;
            const hyp = searchHypothesis(rx, o, fromSym, n0);
            if (!hyp) {
                // No sync marker in this window (pull-in or a slip). Keep searching one frame later, as a
                // frame synchronizer would, until too little signal remains.
                fromSym += Math.ceil(channelBitsPerCadu(o.coding) / mod.bits);
                continue;
            }
            segments++;
            const soft = softBits(rx, o.modulation, hyp.rot, fromSym, rx.count, n0);
            const end = soft.length - ((soft.length - hyp.off) & (conv ? 1 : 0));
            const bits = conv ? viterbi(soft, hyp.off, end) : hard(soft);
            let p = hyp.p, misses = 0, lostAt = -1;
            while (p + cadu <= bits.length) {
                let at = -1;
                for (let d = 0; d <= 3 && at < 0; d++) {
                    if (asmErrors(bits, p + d) <= 6) at = p + d;
                    else if (d && p - d >= 0 && asmErrors(bits, p - d) <= 6) at = p - d;
                }
                if (at < 0) {
                    // Flywheel: after a missed marker, still read the frame where it should be and let
                    // Reed–Solomon and the CRC judge it. Three misses in a row mean sync is lost.
                    if (++misses >= 3) { found.splice(found.length - 2); lostAt = p - 2 * cadu; break; }
                    at = p;
                } else misses = 0;
                if (at + cadu > bits.length) break;
                const cb = randomize(bitsToBytes(bits, at + 32, cbBytes));
                const frame = new Uint8Array(FRAME_BYTES);
                let corrected = 0, failed = false;
                if (rs) {
                    const cw = new Uint8Array(255);
                    for (let i = 0; i < DEPTH; i++) {
                        for (let m = 0; m < 255; m++) cw[m] = cb[m * DEPTH + i];
                        const n = RS.decode(cw);
                        if (n < 0) failed = true; else corrected += n;
                        for (let m = 0; m < 223; m++) frame[m * DEPTH + i] = cw[m];
                    }
                } else frame.set(cb.subarray(0, FRAME_BYTES));
                const crcOk = crc16(frame, 0, FRAME_BYTES - FECF) === ((frame[FRAME_BYTES - 2] << 8) | frame[FRAME_BYTES - 1]);
                const chanStart = fromSym * mod.bits + hyp.off + (conv ? 2 : 1) * at;
                found.push({ chanStart, decodedBits: bits.subarray(at, at + cadu), soft, softStart: conv ? hyp.off + 2 * at : at,
                    frame, corrected, rsFailed: failed, crcOk });
                p = at + cadu;
            }
            symbolsUsed = Math.max(symbolsUsed, fromSym);
            if (lostAt < 0) break;
            fromSym += Math.floor((hyp.off + (conv ? 2 : 1) * lostAt) / mod.bits);
        }
        found.resyncs = Math.max(0, segments - 1);
        return found;
    }

    /* ---------------- theory ---------------- */
    /** Uncoded bit error probability for a channel-symbol Es/N0 (linear). GMSK returns the coherent MSK bound. */
    function theoryBer(modulation, esn0) {
        if (modulation === 'bpsk' || modulation === 'gmsk') return qfunc(Math.sqrt(2 * esn0));
        if (modulation === 'qpsk') return qfunc(Math.sqrt(esn0));
        return psk8Ber(esn0);
    }
    /* Exact Gray 8PSK bit error probability: integrate the received-phase density over each decision
     * sector and weight by the number of bits that differ (Proakis, Digital Communications, phase density of M-PSK). */
    const psk8Cache = new Map();
    function psk8Ber(g) {
        const key = Math.round(g * 1e4);
        if (psk8Cache.has(key)) return psk8Cache.get(key);
        const pdf = th => {
            const c = Math.cos(th);
            return Math.exp(-g) / TAU * (1 + Math.sqrt(4 * Math.PI * g) * c * Math.exp(g * c * c) * qfunc(-Math.sqrt(2 * g) * c));
        };
        const sector = new Float64Array(8), steps = 400;
        for (let k = 0; k < 8; k++) {
            const a = (2 * k - 1) * Math.PI / 8, h = (Math.PI / 4) / steps;
            let acc = 0;
            for (let i = 0; i <= steps; i++) acc += (i === 0 || i === steps ? 0.5 : 1) * pdf(a + i * h);
            sector[k] = acc * h;
        }
        let ber = 0;
        for (let j = 0; j < 8; j++) for (let k = 1; k < 8; k++) {
            const x = GRAY8[j] ^ GRAY8[(j + k) % 8];
            ber += sector[k] * ((x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1)) / 3 / 8;
        }
        if (psk8Cache.size > 5000) psk8Cache.clear();
        psk8Cache.set(key, ber);
        return ber;
    }

    /* ---------------- top level ---------------- */
    /**
     * Run one downlink burst.
     * o: { modulation, coding, symbolRate, fc, payload: Uint8Array, seed, carrierBnT, searchHz,
     *      link: { knots, oscHz, linewidthHz } }
     */
    function simulate(o, onProgress = () => {}) {
        const t0 = Date.now();
        const mod = MODULATION[o.modulation];
        const stream = buildStream(o.payload, o.coding);
        const ch = stream.channel;
        let tx;
        if (o.modulation === 'gmsk') {
            const gm = new Int8Array(ch.length), prefix = new Float64Array(ch.length + 1);
            for (let i = 0; i < ch.length; i++) { gm[i] = ch[i] ? -1 : 1; prefix[i + 1] = prefix[i] + gm[i]; }
            tx = { n: ch.length, gmsk: gm, prefix };
        } else {
            const s = mapSymbols(ch, o.modulation);
            tx = { n: s.re.length, re: s.re, im: s.im };
        }
        onProgress(0.02, 'Transmitting');
        const rxs = channel(tx, o, f => onProgress(0.02 + 0.38 * f, 'Transmitting'));
        const { iq, Fs } = rxs;
        const spectrum = (() => {
            const nfft = 512, count = Math.min(iq.length / 2, 512 * 64);
            const { p } = periodogram(iq, 0, count, nfft, 64);
            const out = new Float32Array(nfft);
            for (let i = 0; i < nfft; i++) out[i] = 10 * Math.log10(p[(i + nfft / 2) % nfft] / nfft + 1e-30);
            return out;
        })();
        const exportIq = iq.slice(0, Math.min(iq.length, 2 * 262144));
        onProgress(0.42, 'Acquiring carrier');
        const acq = acquire(iq, Fs, o.symbolRate, o.modulation, o.searchHz);
        const truthStart = rxs.resid(SPAN * 2 / o.symbolRate);
        const base = { Fs, spectrum, exportIq, acquisition: { ...acq, truthHz: truthStart, searchHz: o.searchHz }, plan: plan({ ...o, payloadBytes: o.payload.length }),
            blindFraction: rxs.blindFraction, symbols: tx.n, seconds: tx.n / o.symbolRate, frames: [], track: [] };
        const finish = (rx, found, n0) => summarise(base, o, stream, rx, found, n0, rxs, Date.now() - t0);
        if (!acq.found) return finish(null, [], 1);
        mix(iq, acq.hz, Fs);
        onProgress(0.5, 'Tracking');
        const track = [];
        let rx, n0 = 1;
        if (o.modulation === 'gmsk') {
            const lp = lowpassTaps(0.65 / SPS, 33);
            const x = filterComplex(iq, lp);
            const d = demodGMSK(x, o, track);
            const mean = d.soft.reduce((a, v) => a + Math.abs(v), 0) / Math.max(1, d.count);
            let v = 0; for (let k = 0; k < d.count; k++) v += (Math.abs(d.soft[k]) - mean) ** 2;
            v /= Math.max(1, d.count);
            rx = { soft: d.soft, count: d.count, llrScale: 2 * mean / Math.max(1e-9, v), integ: d.integ, clip: o.softClip ?? 0.6 };   // clipping tames discriminator "clicks"
        } else {
            const y = filterComplex(iq, MF_TAPS);
            rx = demodPSK(y, o, track);
            const settled = track.slice(Math.min(track.length - 1, 8));
            const es = settled.length ? settled.reduce((a, b) => a + b.esn0, 0) / settled.length : 1;
            n0 = 1 / Math.max(0.05, es);
        }
        base.track = track;
        onProgress(0.75, 'Decoding');
        const found = decodeFrames(rx, o, n0);
        onProgress(0.97, 'Assembling');
        return finish(rx, found, n0);
    }

    function lowpassTaps(cutoff, n) {
        const taps = new Float64Array(n), mid = (n - 1) / 2;
        let s = 0;
        for (let i = 0; i < n; i++) {
            const x = i - mid, sinc = x === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
            taps[i] = sinc * (0.54 - 0.46 * Math.cos(TAU * i / (n - 1)));
            s += taps[i];
        }
        for (let i = 0; i < n; i++) taps[i] /= s;
        return taps;
    }

    /** Compare the receiver's frames with the truth and assemble the image the ground station would see. */
    function summarise(base, o, stream, rx, found, n0, rxs, ms) {
        const mod = MODULATION[o.modulation], conv = CODING[o.coding].conv;
        const chanPer = channelBitsPerCadu(o.coding), cadu = caduBits(o.coding);
        const symDur = 1 / o.symbolRate;
        const frames = [];
        const image = new Uint8Array(o.payload.length);
        const status = new Array(stream.imageFrames).fill('missed');
        let chanErr = 0, chanBits = 0, decErr = 0, decBits = 0, theoryErr = 0;
        const esn0At = lerp(o.link.knots, o.link.knots.esn0);
        const seen = new Set();
        for (const f of found) {
            const truth = Math.round(f.chanStart / chanPer);
            if (truth < 0 || truth >= stream.total || seen.has(truth)) continue;
            seen.add(truth);
            const tf = stream.frames[truth];
            // Idle frames carry no data; the leading one also absorbs the receiver's pull-in, so it is not scored.
            if (tf.index === IDLE) continue;
            const txChan = stream.channel.subarray(truth * chanPer, (truth + 1) * chanPer);
            let ce = 0, n = 0;
            for (let i = 0; i < chanPer && f.softStart + i < f.soft.length; i++) { ce += (f.soft[f.softStart + i] < 0 ? 1 : 0) ^ txChan[i]; n++; }
            const txBits = stream.bits.subarray(truth * cadu, (truth + 1) * cadu);
            let de = 0;
            for (let i = 0; i < cadu; i++) de += f.decodedBits[i] ^ txBits[i];
            const time = (truth * chanPer / mod.bits) * symDur;
            const es = 10 ** (esn0At(time + 0.5 * chanPer / mod.bits * symDur) / 10);
            chanErr += ce; chanBits += n; decErr += de; decBits += cadu;
            theoryErr += theoryBer(o.modulation, es) * n;
            const payloadOk = f.crcOk;
            const idx = (f.frame[2] << 8) | f.frame[3];
            const imageIndex = tf.index;
            const st = !payloadOk ? 'failed' : f.corrected > 0 ? 'corrected' : 'ok';
            if (imageIndex !== IDLE) {
                status[imageIndex] = st;
                const place = payloadOk && idx !== IDLE ? idx : imageIndex;
                const len = Math.min(PAYLOAD_BYTES, o.payload.length - place * PAYLOAD_BYTES);
                if (place >= 0 && place < stream.imageFrames && len > 0) image.set(f.frame.subarray(HEADER, HEADER + len), place * PAYLOAD_BYTES);
            }
            frames.push({ index: imageIndex, status: st, corrected: f.corrected, chanErrors: ce, chanBits: n, decErrors: de, decBits: cadu,
                time, esn0: 10 * Math.log10(es), idle: imageIndex === IDLE });
        }
        for (let i = 0; i < stream.imageFrames; i++) if (status[i] === 'missed') {
            const time = ((i + LEAD_IN) * chanPer / mod.bits) * symDur;
            frames.push({ index: i, status: 'missed', time, esn0: esn0At(time), idle: false });
        }
        frames.sort((a, b) => a.time - b.time);
        // Constellation sample and eye traces from the middle of the burst.
        let points = null, eye = null;
        if (rx && rx.zr) {
            const n = Math.min(6000, rx.count), step = Math.max(1, Math.floor(rx.count / n));
            points = new Float32Array(2 * Math.floor(rx.count / step));
            for (let k = 0, j = 0; k + step <= rx.count && j < points.length / 2; k += step, j++) { points[2 * j] = rx.zr[k]; points[2 * j + 1] = rx.zi[k]; }
        } else if (rx && rx.soft) {
            const n = Math.min(3000, rx.count), step = Math.max(1, Math.floor(rx.count / n)), scale = 1;
            points = new Float32Array(Math.floor(rx.count / step));
            for (let k = 0, j = 0; j < points.length; k += step, j++) points[j] = rx.soft[k] * scale;
        }
        const track = base.track.map(b => ({
            t: b.symbol * symDur,
            hz: base.acquisition.hz + b.omega * o.symbolRate / TAU,
            truth: rxs.resid(b.symbol * symDur + SPAN * 2 * symDur),
            esn0: b.esn0 === null ? null : 10 * Math.log10(Math.max(1e-6, b.esn0)),
            lock: b.lock
        }));
        const settled = track.filter(b => b.esn0 !== null).slice(4);
        const esMeas = settled.length ? 10 * Math.log10(settled.reduce((a, b) => a + 10 ** (b.esn0 / 10), 0) / settled.length) : null;
        const esPred = 10 * Math.log10(o.link.knots.esn0.reduce((a, v) => a + 10 ** (v / 10), 0) / o.link.knots.esn0.length);
        const counts = { ok: 0, corrected: 0, failed: 0, missed: 0 };
        for (const s of status) counts[s]++;
        return { ...base, frames, image, status, counts, points, eye, track,
            stats: { chanBer: chanBits ? chanErr / chanBits : null, chanBits, chanErr, theoryBer: chanBits ? theoryErr / chanBits : null,
                decBer: decBits ? decErr / decBits : null, decBits, decErr, esn0Measured: esMeas, esn0Predicted: esPred,
                corrected: frames.reduce((a, f) => a + (f.corrected || 0), 0), computeMs: ms, n0, resyncs: found.resyncs || 0 } };
    }

    const api = {
        SPS, ASM, DEPTH, FRAME_BYTES, PAYLOAD_BYTES, CODING, MODULATION, LEAD_IN, TAIL, C_KM,
        rng, qfunc, fft, crc16, RANDOMIZER, randomize, RS, convEncode, viterbi, constellation, mapSymbols, buildStream,
        plan, overhead, theoryBer, simulate, acquire, rrc, caduBits, channelBitsPerCadu
    };
    root.RFDsp = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
