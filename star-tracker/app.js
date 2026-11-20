(function () {
    'use strict';

    const U = window.SpaceUI, O = window.SpaceOrbit, PGM = window.StarPGM;
    const el = id => document.getElementById(id);
    const initialTime = Date.UTC(2026, 10, 19);
    const inputs = [...document.querySelectorAll('[data-setting]')];
    const cameraInputs = inputs.filter(input => !['threshold', 'minimum', 'blind', 'format'].includes(input.id));
    const degree = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) + '°' : '—';
    const arcsec = n => Number.isFinite(n) ? n.toFixed(1) + '″' : '—';
    const rateText = v => v ? Math.hypot(...v).toFixed(3) + '°/s' : '—';
    const formatOf = (width, height) => width + 'x' + height;
    const text = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
    const frameCanvas = el('image');
    const overlayCanvas = el('overlay-canvas');
    const frameContext = frameCanvas.getContext('2d');
    const overlayContext = overlayCanvas.getContext('2d');
    let time = initialTime, epoch = time, period = 5550;
    let source = U.presetSource('iss', new Date(time));
    const handoff = U.readOrbitLink(location.hash);
    if (handoff) {
        time = epoch = handoff.time;
        source = handoff.source;
    }
    let worker, ready = false, busy = null, next = null, last = null, imported = null;
    let revision = 0, serial = 0, playing = false, playStamp = 0, lastDispatch = 0;
    let savedInertial = null;

    function status(message, state = '', stamp = '') {
        text('status', message);
        text('stamp', stamp);
        el('dot').className = 'dot ' + state;
    }

    function updateClock() {
        const elapsed = Math.max(0, Math.floor((time - epoch) / 1000));
        el('timeline').value = elapsed;
        text('elapsed', '+' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0'));
        if (document.activeElement !== el('when') || playing) el('when').value = U.toLocalInput(new Date(time));
    }

    function configureOrbit(src, elements) {
        source = src;
        period = Math.max(1, Math.round(elements.period * 60));
        el('timeline').max = period;
        if (src.kind !== 'elements') time = epoch = Math.round(elements.epoch.getTime() / 1000) * 1000;
        else epoch = time;
        updateClock();
        request({ reset: true });
    }

    const editor = new U.OrbitEditor(el('orbit-editor'), {
        presets: O.PRESETS.filter(p => p.group === 'LEO'), epoch: () => new Date(time), idPrefix: 'st-orbit',
        onChange: configureOrbit
    });
    editor.setSource(source);
    period = Math.round(editor.el_.period * 60);
    el('timeline').max = period;
    updateClock();
    U.tabs(el('tabs'));

    function updateMode() {
        const local = el('mode').value !== 'inertial';
        text('ra-label', local ? 'Yaw offset' : 'Right ascension');
        text('dec-label', local ? 'Pitch offset' : 'Declination');
        for (const field of document.querySelectorAll('[data-inertial]')) {
            field.hidden = local;
            field.querySelector('input').disabled = local;
        }
    }

    function setSettings(settings) {
        for (const input of cameraInputs) {
            if (input.type === 'checkbox') input.checked = settings[input.id];
            else {
                const value = settings[input.id];
                input.value = typeof value === 'number' ? Number(value.toFixed(5)) : value;
            }
        }
        el('format').value = formatOf(settings.width, settings.height);
        el('threshold').value = 4.5;
        el('minimum').value = 5;
        el('blind').checked = false;
        savedInertial = null;
        updateMode();
    }

    function cameraSettings() {
        const settings = {};
        for (const input of cameraInputs) {
            settings[input.id] = input.type === 'checkbox' ? input.checked
                : input.type === 'number' ? input.valueAsNumber : input.value;
        }
        const [width, height] = el('format').value.split('x').map(Number);
        settings.width = imported ? imported.width : width;
        settings.height = imported ? imported.height : height;
        if (el('mode').value !== 'inertial') settings.slew = settings.rollRate = 0;
        return settings;
    }

    function request(args = {}) {
        revision++;
        next = args;
        dispatch();
    }

    function dispatch() {
        if (!ready || busy || !next) return;
        const args = next;
        next = null;
        const id = ++serial;
        if (args.name) {
            busy = { id, revision };
            worker.postMessage({ type: 'preset', id, name: args.name, time, source });
            status('Preparing scenario…', 'busy');
            return;
        }
        const invalid = inputs.find(input => !input.validity.valid);
        if (invalid) {
            status('Check ' + invalid.closest('label').querySelector('span').textContent.trim() + ' before capturing.', 'err');
            return;
        }
        lastDispatch = performance.now();
        busy = { id, revision };
        const message = {
            type: imported ? 'import' : 'render', id, source, time: Math.round(time), epoch, settings: cameraSettings(),
            threshold: +el('threshold').value, minMatches: +el('minimum').value, blind: args.blind || el('blind').checked, reset: args.reset
        };
        if (imported) message.pixels = imported.pixels.slice();
        worker.postMessage(message, message.pixels ? [message.pixels.buffer] : []);
        if (!playing || !last) status(imported ? 'Solving imported frame…' : 'Capturing and solving…', 'busy');
    }

    function play(on) {
        playing = on;
        playStamp = 0;
        el('play').textContent = on ? 'Pause' : 'Play';
        el('play').setAttribute('aria-pressed', String(on));
        if (on) requestAnimationFrame(tick);
    }

    function tick(at) {
        if (!playing) return;
        if (playStamp) time = Math.min(epoch + period * 1000, time + (at - playStamp) * +el('rate').value);
        playStamp = at;
        updateClock();
        if (time >= epoch + period * 1000) {
            play(false);
            request();
            return;
        }
        if (!busy && at - lastDispatch > 245) {
            next = {};
            dispatch();
        }
        requestAnimationFrame(tick);
    }

    function displayPixels(frame) {
        const { width, height, pixels } = frame;
        if (frameCanvas.width !== width || frameCanvas.height !== height) {
            frameCanvas.width = width;
            frameCanvas.height = height;
        }
        el('sensor-screen').style.aspectRatio = width + ' / ' + height;
        const raster = frameContext.createImageData(width, height);
        let low = frame.imported ? 0 : 96, high = 2200;
        if (el('stretch').checked) {
            const sample = [];
            for (let i = 0; i < pixels.length; i += 13) sample.push(pixels[i]);
            sample.sort((a, b) => a - b);
            low = sample[Math.floor(sample.length * 0.5)];
            high = Math.max(low + 140, sample[Math.floor(sample.length * 0.994)]);
        }
        const span = Math.max(1, high - low);
        const lut = new Uint8Array(65536);
        const tone = 255 / Math.asinh(13);
        for (let i = low + 1; i < Math.min(high, lut.length); i++) lut[i] = Math.round(tone * Math.asinh(13 * (i - low) / span));
        lut.fill(255, Math.min(high, lut.length));
        for (let i = 0; i < pixels.length; i++) {
            const value = lut[pixels[i]];
            const out = i * 4;
            raster.data[out] = Math.min(255, value + 4);
            raster.data[out + 1] = Math.min(255, value + 6);
            raster.data[out + 2] = Math.min(255, value + 10);
            raster.data[out + 3] = 255;
        }
        frameContext.putImageData(raster, 0, 0);
    }

    function drawOverlay() {
        if (!last) return;
        const view = el('overlay').value;
        el('legend').hidden = view !== 'matches' && view !== 'residuals';
        el('legend').dataset.view = view;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = overlayCanvas.clientWidth, h = overlayCanvas.clientHeight;
        if (!w || !h) return;
        overlayCanvas.width = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
        const c = overlayContext;
        c.scale(dpr, dpr);
        if (view === 'raw') return;
        const sx = w / last.width, sy = h / last.height;
        const matched = new Map((last.solution.matches || []).map(m => [m.x, m]));
        const labels = [];
        c.lineWidth = 1;
        if (view === 'residuals') {
            // Centroid minus catalog prediction, magnified 100 times. Systematic patterns reveal distortion or roll error.
            c.lineWidth = 1.4;
            for (const m of last.solution.matches || []) {
                if (!Number.isFinite(m.px)) continue;
                const x = (m.px + 0.5) * sx, y = (m.py + 0.5) * sy;
                c.strokeStyle = m.weight < 0.5 ? '#f08a8a' : '#83e4b6';
                c.globalAlpha = 0.85;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x + (m.x - m.px) * 100 * sx, y + (m.y - m.py) * 100 * sy);
                c.stroke();
                c.beginPath();
                c.arc(x, y, 1.6, 0, Math.PI * 2);
                c.fillStyle = c.strokeStyle;
                c.fill();
            }
            c.globalAlpha = 1;
            const bar = 100 * sx;
            c.strokeStyle = c.fillStyle = '#d7dde8';
            c.font = '11px ui-monospace, monospace';
            c.beginPath();
            c.moveTo(10, h - 12);
            c.lineTo(10 + bar, h - 12);
            c.stroke();
            c.fillText('1 px', 14 + bar, h - 8);
            return;
        }
        for (const p of last.solution.detections) {
            const m = view === 'matches' ? matched.get(p.x) : null;
            const x = (p.x + 0.5) * sx, y = (p.y + 0.5) * sy;
            c.strokeStyle = m ? (m.weight < 0.5 ? '#f08a8a' : '#83e4b6') : '#e9bd7d';
            c.globalAlpha = m ? 0.72 : 0.7;
            if (m) c.strokeRect(x - 3.5, y - 3.5, 7, 7);
            else {
                c.beginPath();
                c.arc(x, y, 3.2, 0, Math.PI * 2);
                c.stroke();
            }
            if (m && m.mag < 3 && x < w - 82 && y > 13 && labels.every(p => Math.hypot(x - p.x, y - p.y) > 65)) labels.push({ x, y, name: m.name || 'HIP ' + m.hip });
        }
        c.font = '11px ui-monospace, monospace';
        c.globalAlpha = 1;
        c.lineWidth = 3;
        for (const { x, y, name } of labels) {
            c.strokeStyle = '#070b11';
            c.fillStyle = '#b0f4d4';
            c.strokeText(name, x + 7, y - 5);
            c.fillText(name, x + 7, y - 5);
        }
    }

    function metrics(frame) {
        const { estimate, truth, solution, stats, error } = frame;
        const count = solution.matches?.length || 0;
        text('frame-meta', `${frame.width} × ${frame.height} · ${frame.imported ? 'Imported PGM' : 'Simulated detector'} · ${U.utc(new Date(frame.time), true)}`);
        text('frame-summary', `${solution.detections.length} centroids · ${count} catalog matches${stats ? ' · ' + (stats.saturated * 100).toFixed(1) + '% saturated' : ''}`);
        text('lock', estimate ? 'Attitude locked' : 'No attitude solution');
        el('lock').dataset.lock = estimate ? 'yes' : 'no';
        text('solution-note', estimate ? (solution.mode === 'Tracking' ? 'Refined from the previous solution, propagated at the estimated body rate.' : 'Acquired from this frame’s catalog pattern.')
            : solution.reason + '.');
        for (const field of ['ra', 'dec', 'roll']) {
            text('fit-' + field, degree(estimate?.[field], 4));
            el('fit-' + field).title = truth ? 'Simulated truth ' + degree(truth[field], 4) : '';
        }
        text('fit-rate', rateText(estimate?.rate));
        el('fit-rate').title = stats ? 'Simulated truth ' + rateText(stats.rate) : '';
        text('fit-cross', arcsec(error?.cross));
        text('fit-roll-error', arcsec(error?.roll));
        text('sigma-cross', solution.sigma ? 'Estimated 1σ ' + arcsec(solution.sigma.cross) : '');
        text('sigma-roll', solution.sigma ? 'Estimated 1σ ' + arcsec(solution.sigma.roll) : '');
        const trusted = solution.matches?.filter(m => m.weight >= 0.5).length || 0;
        text('fit-rms', arcsec(solution.rms));
        text('fit-trusted', estimate ? `${trusted} trusted · ${count - trusted} down-weighted` : '');
        text('fit-stats', estimate ? `${count} catalog matches · total rotation error ${arcsec(error?.total)} · ${Math.round(frame.duration)} ms solve`
            : `${solution.detections.length} candidate centroids · ${Math.round(frame.duration)} ms solve`);
        const rows = solution.matches?.map(m => {
            const cells = [m.name ? `${m.name} · HIP ${m.hip}` : `HIP ${m.hip}`, m.mag.toFixed(2), m.inst.toFixed(2),
                m.x.toFixed(2), m.y.toFixed(2), m.snr.toFixed(1), m.error.toFixed(1),
                (m.weight * 100).toFixed(0) + '%' + (m.blended ? ' · blend' : '')];
            return U.h('tr', {}, cells.map(cell => U.h('td', { text: cell })));
        }) || [U.h('tr', {}, U.h('td', { colspan: 8, text: 'No identified stars in this frame.' }))];
        el('matches').replaceChildren(...rows);
        text('env-altitude', stats ? stats.altitude.toFixed(1) + ' km' : '—');
        text('env-limb', degree(stats?.limb));
        text('env-sun', degree(stats?.sun));
        text('env-light', stats ? (stats.sunlight === 0 ? 'Eclipse' : stats.sunlight === 1 ? 'Sunlit' : 'Penumbra') + ' · ' + Math.round(stats.sunlight * 100) + '%' : '—');
        text('env-moon', stats ? degree(stats.moon) + (stats.moonVisible ? '' : ' · occulted') : '—');
        text('env-glint', stats ? (stats.glint > 0.001 ? (stats.glint * 100).toFixed(1) + '% of peak' : 'None') : '—');
        text('env-saturated', stats ? (stats.saturated * 100).toFixed(2) + '%' : '—');
        text('env-particles', stats ? stats.events.toLocaleString() : '—');
        const hemisphere = (value, positive, negative) => Math.abs(value).toFixed(1) + '°' + (Math.abs(value) < 0.05 ? '' : ' ' + (value > 0 ? positive : negative));
        text('env-geo', stats ? `${hemisphere(stats.geo.lat, 'N', 'S')}, ${hemisphere(stats.geo.lon, 'E', 'W')}` : '—');
        text('env-l', stats ? stats.L.toFixed(2) + (frame.radiation === 'ready' && stats.trapped !== null ? ' · IGRF' : ' · dipole') : '—');
        text('env-flux', stats ? (stats.particleRate < 10 ? stats.particleRate.toFixed(2) : Math.round(stats.particleRate).toLocaleString()) + ' cm⁻²s⁻¹' : '—');
        text('env-scale', stats ? stats.plateScale.toFixed(1) + '″/px' : '—');
        text('env-sky', stats ? stats.sky.toFixed(1) + ' e⁻/px' : '—');
        text('env-limit', stats ? stats.limitMag.toFixed(2) + ' instr. mag' : '—');
        text('env-galactic', stats ? degree(stats.skyBrightness.galacticLatitude, 1) : '—');
        const trapped = !stats ? '' : stats.trapped === null
            ? (frame.radiation === 'loading' ? ' Trapped protons appear once the AP8 model loads.' : ' The AP8 grid does not cover this position, so only cosmic rays are counted.')
            : ` Particle flux is ${(stats.particleRate - stats.trapped).toFixed(2)} cm⁻²s⁻¹ of cosmic rays plus ${Math.round(stats.trapped).toLocaleString()} cm⁻²s⁻¹ of trapped protons above 30 MeV${stats.trapped > 1 ? ' in the South Atlantic Anomaly' : ''}.`;
        text('env-note', stats
            ? `${stats.visible.toLocaleString()} catalog sources projected onto the detector. Negative limb clearance puts the boresight over Earth.${trapped}`
            : 'Environment readouts are available for simulated frames.');
        el('export-result').disabled = !estimate;
    }

    function receive({ data }) {
        if (data.type === 'ready') {
            ready = true;
            setSettings(data.settings);
            text('catalog-count', data.count.toLocaleString());
            for (const id of ['scenario', 'play', 'step', 'timeline', 'import-frame']) el(id).disabled = false;
            request({ name: 'clear' });
            return;
        }
        if (data.type === 'error' && data.id == null) {
            fail(data.message);
            return;
        }
        if (!busy || busy.id !== data.id) return;
        const current = busy.revision === revision;
        busy = null;
        if (!current) {
            dispatch();
            return;
        }
        if (data.type === 'preset') {
            setSettings(data.settings);
            time = epoch = data.time;
            updateClock();
            request({ reset: true });
            return;
        }
        if (data.type === 'error') {
            play(false);
            if (!last) fail(data.message);
            else status(data.message, 'err');
            return;
        }
        last = data;
        el('placeholder').hidden = true;
        el('export-frame').disabled = false;
        el('reacquire').disabled = false;
        displayPixels(data);
        drawOverlay();
        metrics(data);
        status(data.estimate ? 'Attitude locked' : 'No attitude solution', data.estimate ? 'ok' : '', U.utc(new Date(data.time), true));
        dispatch();
    }

    function fail(message) {
        status(message, 'err');
        text('placeholder', message);
        el('placeholder').hidden = false;
    }

    function importMode(frame) {
        imported = frame;
        play(false);
        for (const id of ['play', 'step', 'timeline', 'format']) el(id).disabled = !!frame;
        el('resume').hidden = !frame;
        request({ reset: true });
    }

    function download(name, content, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        U.h('a', { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    for (const input of inputs) {
        input.addEventListener('change', () => {
            el('scenario').value = '';
            if (input.id === 'mode') {
                if (input.value === 'inertial') {
                    [el('ra').value, el('dec').value] = savedInertial || [83, -4];
                } else if (!savedInertial) {
                    savedInertial = [el('ra').value, el('dec').value];
                    el('ra').value = el('dec').value = 0;
                }
                if (input.value === 'inertial') savedInertial = null;
                updateMode();
            }
            request({ reset: true });
        });
    }
    el('scenario').addEventListener('change', () => {
        if (imported) {
            imported = null;
            for (const id of ['play', 'step', 'timeline', 'format']) el(id).disabled = false;
            el('resume').hidden = true;
        }
        play(false);
        request({ name: el('scenario').value });
    });
    el('play').addEventListener('click', () => {
        if (!playing && time >= epoch + period * 1000) {
            time = epoch;
            request({ reset: true });
        }
        const wasPlaying = playing;
        play(!wasPlaying);
        if (wasPlaying) request();
    });
    el('step').addEventListener('click', () => {
        play(false);
        time = Math.min(epoch + period * 1000, time + 1000);
        updateClock();
        request();
    });
    el('when').addEventListener('change', () => {
        const date = U.fromLocalInput(el('when').value);
        if (!date || !el('when').validity.valid) { status('Enter a valid observation UTC from 1950 to 2100.', 'err'); return; }
        play(false);
        time = epoch = date.getTime();
        updateClock();
        request({ reset: true });
    });
    el('timeline').addEventListener('input', () => {
        play(false);
        time = epoch + 1000 * +el('timeline').value;
        updateClock();
        request({ reset: true });
    });
    el('reacquire').addEventListener('click', () => {
        play(false);
        request({ blind: true });
    });
    el('overlay').addEventListener('change', drawOverlay);
    function inspect(event) {
        if (!last) return;
        const box = el('sensor-screen').getBoundingClientRect();
        const x = Math.floor((event.clientX - box.left) / box.width * last.width);
        const y = Math.floor((event.clientY - box.top) / box.height * last.height);
        if (x < 0 || y < 0 || x >= last.width || y >= last.height) return leave();
        let nearest = null, distance = 4;
        for (const p of last.solution.detections) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < distance) { distance = d; nearest = p; }
        }
        const match = nearest && last.solution.matches?.find(m => m.x === nearest.x);
        const star = match ? ` · ${match.name || 'HIP ' + match.hip} V ${match.mag.toFixed(2)}` : nearest ? ' · unidentified' : '';
        const centroid = nearest ? ` · centroid ${nearest.x.toFixed(2)}, ${nearest.y.toFixed(2)} SNR ${nearest.snr.toFixed(0)}` : '';
        text('pixel-readout', `(${x}, ${y}) ${last.pixels[y * last.width + x]} DN${centroid}${star}`);
        el('pixel-readout').hidden = false;
        el('frame-summary').hidden = true;
    }
    function leave() {
        el('pixel-readout').hidden = true;
        el('frame-summary').hidden = false;
    }
    el('sensor-screen').addEventListener('pointermove', inspect);
    el('sensor-screen').addEventListener('pointerleave', leave);
    el('stretch').addEventListener('change', () => { if (last) displayPixels(last); });
    new ResizeObserver(drawOverlay).observe(el('sensor-screen'));
    el('import-frame').addEventListener('click', () => el('file').click());
    el('file').addEventListener('change', async () => {
        const file = el('file').files[0];
        el('file').value = '';
        if (!file) return;
        try {
            if (file.size > 1600000) throw new Error('The selected PGM exceeds the supported image size.');
            importMode(PGM.read(await file.arrayBuffer()));
        } catch (err) {
            status(err.message, 'err');
        }
    });
    el('resume').addEventListener('click', () => importMode(null));
    el('export-frame').addEventListener('click', () => {
        if (!last) return;
        download('star-tracker-frame.pgm', PGM.write(last.pixels, last.width, last.height), 'image/x-portable-graymap');
    });
    el('export-result').addEventListener('click', () => {
        if (!last?.estimate) return;
        download('star-tracker-solution.json', JSON.stringify({
            utc: new Date(last.time).toISOString(), frame: last.imported ? 'imported' : 'simulated',
            reference: 'J2000-aligned inertial', cameraAxes: ['right', 'down', 'forward'],
            cameraToInertialWxyz: last.estimate.quaternion,
            rightAscensionDeg: last.estimate.ra, declinationDeg: last.estimate.dec, rollDeg: last.estimate.roll,
            rmsResidualArcsec: last.solution.rms, sigmaArcsec: last.solution.sigma,
            bodyRateCameraDegPerS: last.estimate.rate, truth: last.truth, attitudeErrorArcsec: last.error,
            matches: last.solution.matches
        }, null, 2), 'application/json');
    });

    try {
        worker = new Worker('worker.js');
        worker.addEventListener('message', receive);
        worker.addEventListener('error', () => {
            play(false);
            fail('The tracker worker stopped. Reload the page to retry.');
        });
        worker.postMessage({ type: 'init' });
    } catch (err) {
        fail('Could not start the tracker worker. Open this page from a web server.');
    }
})();
