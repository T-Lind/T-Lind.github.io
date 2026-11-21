/* RF link worker: builds the orbit-driven channel for one image transmission and runs the modem. */
importScripts('../space/lib/satellite.min.js', '../space/lib/orbit.js', 'geometry.js', 'dsp.js', 'budget.js');

const O = self.SpaceOrbit, G = self.RFGeometry, D = self.RFDsp, B = self.RFBudget;
let payload = null, sourceKey = '', satrec = null;

function orbit(source) {
    const key = JSON.stringify(source);
    if (key !== sourceKey) { satrec = O.satrecFromSource(source); sourceKey = key; }
    return satrec;
}

/**
 * Range, range rate and Es/N0 knots across the transmission. The true orbit sets the delay; the receiver's
 * prediction is the same orbit shifted along track by the prediction error.
 */
function knots(sat, station, radio, start, seconds) {
    const tail = 64 / (radio.symbolRateKsps * 1e3);                   // filter and guard symbols after the burst
    const span = seconds + tail;
    const n = Math.max(5, Math.min(600, Math.ceil(span / 1) + 3));
    const h = span / (n - 3);
    const k = { t0: 0, h, dR: [], dRdot: [], dRh: radio.precorrect ? [] : null, dRhdot: radio.precorrect ? [] : null, esn0: [] };
    let R0 = null, Rh0 = null, lead = 0, belowHorizon = 0;
    for (let i = 0; i < n; i++) {
        const t = new Date(start + i * h * 1000);
        const geo = G.look(sat, station, t);
        if (!geo) throw new Error('SGP4 could not propagate this orbit at the selected time.');
        if (R0 === null) { R0 = geo.range; lead = radio.predErrorKm / geo.speed; }
        k.dR.push(geo.range - R0);
        k.dRdot.push(geo.rangeRate);
        if (geo.el < 0) belowHorizon++;
        k.esn0.push(geo.el < 0 ? -60 : B.compute(radio, geo, station).esn0);
        if (radio.precorrect) {
            const p = G.look(sat, station, new Date(t.getTime() + lead * 1000));
            if (Rh0 === null) Rh0 = p.range;
            k.dRh.push(p.range - Rh0);
            k.dRhdot.push(p.rangeRate);
        }
    }
    return { knots: k, belowHorizon: belowHorizon / n };
}

self.onmessage = ({ data }) => {
    const { type, id } = data;
    if (type === 'payload') { payload = new Uint8Array(data.buffer); self.postMessage({ type: 'ready' }); return; }
    if (type !== 'capture') return;
    try {
        if (!payload) throw new Error('The payload image has not loaded.');
        const { radio, station, time, seed } = data;
        const sat = orbit(data.source);
        const Rs = radio.symbolRateKsps * 1e3;
        const plan = D.plan({ modulation: radio.modulation, coding: radio.coding, symbolRate: Rs, payloadBytes: payload.length });
        const samples = plan.symbols * D.SPS;
        if (samples > 4.2e6) throw new Error('This transmission would need more than 4 million samples. Use fewer bits per frame or a higher-order modulation.');
        const link = knots(sat, station, radio, time, plan.seconds);
        const fc = radio.freqMHz * 1e6;
        const res = D.simulate({
            modulation: radio.modulation, coding: radio.coding, symbolRate: Rs, fc, payload, seed,
            carrierBnT: Math.max(1e-5, Math.min(0.05, radio.loopHz / Rs)), searchHz: radio.searchKHz * 1e3,
            link: { knots: link.knots, oscHz: radio.oscPpm * 1e-6 * fc, linewidthHz: B.linewidth(radio.phaseNoiseDbc) }
        }, (fraction, stage) => self.postMessage({ type: 'progress', id, fraction, stage }));
        res.belowHorizon = link.belowHorizon;
        const transfer = [res.image.buffer, res.spectrum.buffer, res.exportIq.buffer];
        if (res.points) transfer.push(res.points.buffer);
        self.postMessage({ type: 'capture', id, time, result: res }, transfer);
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err.message });
    }
};
