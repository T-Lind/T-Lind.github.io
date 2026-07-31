/* Kalman Filter Flight Demo — rendering, controls, main loop.
   Consumes window.KalmanDemo (engine.js). No filter or physics math lives here. */
(function () {
    'use strict';

    var KD = window.KalmanDemo;
    var fatal = document.getElementById('fatal');

    if (!KD || typeof KD.Simulation !== 'function' || typeof KD.defaultConfig !== 'function') {
        fatal.hidden = false;
        fatal.textContent = 'engine.js did not load — the simulation core (window.KalmanDemo) is unavailable.';
        return;
    }

    /* ---------------- config plumbing ---------------- */

    // Fields sim.setConfig() may adopt without a restart.
    var LIVE_KEYS = ['imuNoiseStd', 'imuBias', 'gpsNoiseStd', 'gpsRate', 'gpsEnabled',
        'qAccel', 'rGps', 'windGustStd', 'windGustTau'];

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    var uiCfg = KD.defaultConfig();       // what the panel shows
    var activeCfg = clone(uiCfg);         // what the simulation is running
    var sim = new KD.Simulation(clone(activeCfg));

    var layers = { truth: true, meas: true, est: true, cov: true };
    var speed = 1;
    var paused = false;
    var pendingRestart = false;
    var landedAt = -1;

    /* ---------------- DOM ---------------- */

    var worldCv = document.getElementById('world');
    var chartCv = document.getElementById('chart');
    var wctx = worldCv.getContext('2d');
    var cctx = chartCv.getContext('2d');

    var el = {
        t: document.getElementById('hud-t'),
        phase: document.getElementById('hud-phase'),
        alt: document.getElementById('hud-alt'),
        vel: document.getElementById('hud-vel'),
        err: document.getElementById('hud-err'),
        sigma: document.getElementById('hud-sigma'),
        gps: document.getElementById('hud-gps'),
        gpsChip: document.getElementById('hud-gps-chip'),
        gpsState: document.getElementById('gps-state'),
        pause: document.getElementById('btn-pause'),
        restart: document.getElementById('btn-restart'),
        hint: document.getElementById('restart-hint'),
        veil: document.getElementById('paused-veil'),
        speedVal: document.getElementById('speed-val')
    };

    /* ---------------- controls ---------------- */

    function readCfg(key) {
        if (key === 'biasX') return (uiCfg.imuBias || [0, 0])[0];
        if (key === 'biasY') return (uiCfg.imuBias || [0, 0])[1];
        return uiCfg[key];
    }

    function writeCfg(key, v) {
        if (key === 'biasX' || key === 'biasY') {
            if (!Array.isArray(uiCfg.imuBias)) uiCfg.imuBias = [0, 0];
            uiCfg.imuBias = [key === 'biasX' ? v : uiCfg.imuBias[0],
            key === 'biasY' ? v : uiCfg.imuBias[1]];
            return;
        }
        uiCfg[key] = v;
    }

    function fmt(n, dec) {
        var s = Number(n).toFixed(dec);
        if (s === '-' + (0).toFixed(dec)) s = (0).toFixed(dec);
        return s;
    }

    function applyLive() {
        for (var i = 0; i < LIVE_KEYS.length; i++) {
            var k = LIVE_KEYS[i];
            if (uiCfg[k] !== undefined) {
                activeCfg[k] = Array.isArray(uiCfg[k]) ? uiCfg[k].slice() : uiCfg[k];
            }
        }
        if (typeof sim.setConfig === 'function') sim.setConfig(activeCfg);
    }

    var bound = [];

    Array.prototype.forEach.call(document.querySelectorAll('[data-key]'), function (input) {
        var key = input.dataset.key;
        var isBool = input.dataset.type === 'bool';
        var dec = parseInt(input.dataset.dec || '2', 10);
        var unit = input.dataset.unit ? ' ' + input.dataset.unit : '';
        var out = document.getElementById(input.id + '-val');
        var live = input.dataset.apply === 'live';

        var v = readCfg(key);
        if (isBool) {
            input.checked = v === undefined ? true : !!v;
        } else {
            if (v !== undefined && isFinite(v)) input.value = String(v);
            else writeCfg(key, parseFloat(input.value));
        }

        function refresh() {
            if (out) out.innerHTML = fmt(readCfg(key), dec) + unit;
        }
        refresh();
        bound.push(refresh);

        input.addEventListener('input', function () {
            writeCfg(key, isBool ? input.checked : parseFloat(input.value));
            refresh();
            if (live) {
                applyLive();
            } else {
                pendingRestart = true;
                el.hint.hidden = false;
                el.restart.classList.add('attention');
            }
            if (key === 'gpsEnabled') syncGpsUi();
        });
    });

    function syncGpsUi() {
        var on = !!uiCfg.gpsEnabled;
        document.body.classList.toggle('outage', !on);
        if (el.gpsState) el.gpsState.textContent = on ? 'on' : 'off';
    }
    syncGpsUi();

    Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (cb) {
        layers[cb.dataset.layer] = cb.checked;
        cb.addEventListener('change', function () { layers[cb.dataset.layer] = cb.checked; });
    });

    var speedInput = document.getElementById('speed');
    speedInput.addEventListener('input', function () {
        speed = parseFloat(speedInput.value);
        el.speedVal.textContent = fmt(speed, 1) + '×';
    });
    el.speedVal.textContent = fmt(speed, 1) + '×';

    function setPaused(p) {
        paused = p;
        el.pause.textContent = paused ? 'Resume' : 'Pause';
        el.veil.hidden = !paused;
    }

    function restart() {
        activeCfg = clone(uiCfg);
        sim.reset(clone(activeCfg));
        pendingRestart = false;
        landedAt = -1;
        el.hint.hidden = true;
        el.restart.classList.remove('attention');
        cam.ready = false;
        resetEnvelope();
    }

    el.pause.addEventListener('click', function () { setPaused(!paused); });
    el.restart.addEventListener('click', restart);

    document.addEventListener('keydown', function (e) {
        if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName)) return;
        if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
        else if (e.key === 'r' || e.key === 'R') restart();
        else if (e.key === 'g' || e.key === 'G') {
            var box = document.getElementById('gpsEnabled');
            box.checked = !box.checked;
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    /* ---------------- canvas sizing ---------------- */

    var dpr = 1;
    function fit(cv, ctx) {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return false;
        var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
    }

    /* ---------------- camera ---------------- */

    var cam = { x: 0, y: 60, scale: 6, ready: false };
    // envelope of everything flown so far, so the whole path stays framed
    var env = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    function resetEnvelope() { env = { minX: 0, maxX: 0, minY: 0, maxY: 0 }; }

    function updateCamera(w, h, st) {
        function inc(x, y) {
            if (x < env.minX) env.minX = x; if (x > env.maxX) env.maxX = x;
            if (y < env.minY) env.minY = y; if (y > env.maxY) env.maxY = y;
        }
        inc(st.truth.x, st.truth.y);
        inc(st.est.x, st.est.y);

        var minX = env.minX, maxX = env.maxX, minY = env.minY, maxY = env.maxY;
        var r = 0;
        if (layers.cov && st.cov) {
            var e = ellipseOf(st.cov);
            if (e) r = Math.min(3 * Math.max(e.a, e.b), 6000);
        }
        minX = Math.min(minX, st.est.x - r); maxX = Math.max(maxX, st.est.x + r);
        minY = Math.min(minY, st.est.y - r); maxY = Math.max(maxY, st.est.y + r);

        var hudPad = 54; // keep the HUD pills clear of the flight path
        var hEff = Math.max(80, h - hudPad);
        var spanX = Math.max((maxX - minX) * 1.3 + 60, 150);
        var spanY = Math.max((maxY - minY) * 1.3 + 50, 110);
        var target = Math.min(w / spanX, hEff / spanY);
        target = Math.max(0.004, Math.min(target, 9));

        var cx = (minX + maxX) / 2;
        var cy = (minY + maxY) / 2 - (hudPad / 2) / target;

        if (!cam.ready) { cam.x = cx; cam.y = cy; cam.scale = target; cam.ready = true; return; }
        cam.x += (cx - cam.x) * 0.07;
        cam.y += (cy - cam.y) * 0.07;
        cam.scale *= Math.pow(target / cam.scale, 0.06);
    }

    var W = 0, H = 0;
    function sx(x) { return W / 2 + (x - cam.x) * cam.scale; }
    function sy(y) { return H / 2 - (y - cam.y) * cam.scale; }

    function ellipseOf(cov) {
        try {
            var e = KD.covEllipse(cov);
            if (!e || !isFinite(e.a) || !isFinite(e.b)) return null;
            return e;
        } catch (err) { return null; }
    }

    /* ---------------- world painting ---------------- */

    var CLOUDS = [];
    (function () {
        var seed = 7;
        function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
        for (var i = 0; i < 9; i++) {
            CLOUDS.push({ x: rnd() * 2000, y: 40 + rnd() * 380, s: 0.55 + rnd() * 0.9, o: 0.30 + rnd() * 0.30 });
        }
    })();

    var SKY_TOP = Math.log10(1 + 25000 / 40);
    function skyColor(alt) {
        // log ramp so the gradient reads at 200 m and still has somewhere to go at 20 km
        var k = Math.log10(1 + Math.max(0, alt) / 40) / SKY_TOP;
        k = Math.max(0, Math.min(1, k));
        var c0 = [255, 217, 196], c1 = [201, 214, 255], c2 = [131, 141, 202];
        var a, b, m;
        if (k < 0.55) { a = c0; b = c1; m = k / 0.55; } else { a = c1; b = c2; m = (k - 0.55) / 0.45; }
        return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * m) + ',' +
            Math.round(a[1] + (b[1] - a[1]) * m) + ',' +
            Math.round(a[2] + (b[2] - a[2]) * m) + ')';
    }

    function drawSky() {
        var g = wctx.createLinearGradient(0, 0, 0, H);
        for (var i = 0; i <= 8; i++) {
            var f = i / 8;
            var alt = cam.y + (H / 2 - f * H) / cam.scale;
            g.addColorStop(f, skyColor(alt));
        }
        wctx.fillStyle = g;
        wctx.fillRect(0, 0, W, H);
    }

    function blob(x, y, s, alpha) {
        wctx.fillStyle = 'rgba(255,252,250,' + alpha + ')';
        wctx.beginPath();
        wctx.ellipse(x, y, 54 * s, 20 * s, 0, 0, Math.PI * 2);
        wctx.ellipse(x - 30 * s, y + 6 * s, 30 * s, 14 * s, 0, 0, Math.PI * 2);
        wctx.ellipse(x + 34 * s, y + 5 * s, 26 * s, 13 * s, 0, 0, Math.PI * 2);
        wctx.ellipse(x + 6 * s, y - 13 * s, 30 * s, 17 * s, 0, 0, Math.PI * 2);
        wctx.fill();
    }

    function drawClouds() {
        var px = -cam.x * cam.scale * 0.06;
        var py = cam.y * cam.scale * 0.05;
        var span = 2000;
        for (var i = 0; i < CLOUDS.length; i++) {
            var c = CLOUDS[i];
            var x = ((c.x + px) % span + span) % span - 200;
            var y = c.y + py * (0.4 + i / CLOUDS.length);
            if (y < -80 || y > H + 80) continue;
            blob(x, y, c.s, c.o);
        }
    }

    function drawGround() {
        var gy = sy(0);
        if (gy > H + 260) return;

        var hillOff = -cam.x * cam.scale * 0.35;
        // far hills
        wctx.fillStyle = '#a9d9b4';
        wctx.beginPath();
        wctx.moveTo(-10, gy + 2);
        for (var x = -10; x <= W + 10; x += 8) {
            var t = (x - hillOff * 0.6) * 0.006;
            wctx.lineTo(x, gy - 26 - 16 * Math.sin(t) - 9 * Math.sin(t * 2.3 + 1.1));
        }
        wctx.lineTo(W + 10, H + 10); wctx.lineTo(-10, H + 10);
        wctx.closePath(); wctx.fill();

        // near hills
        wctx.fillStyle = '#bfe6c3';
        wctx.beginPath();
        wctx.moveTo(-10, gy);
        for (var x2 = -10; x2 <= W + 10; x2 += 8) {
            var t2 = (x2 - hillOff) * 0.01;
            wctx.lineTo(x2, gy - 7 - 7 * Math.sin(t2) - 4 * Math.sin(t2 * 3.1 + 0.6));
        }
        wctx.lineTo(W + 10, H + 10); wctx.lineTo(-10, H + 10);
        wctx.closePath(); wctx.fill();

        var g = wctx.createLinearGradient(0, gy, 0, H);
        g.addColorStop(0, 'rgba(151, 205, 165, .35)');
        g.addColorStop(1, 'rgba(120, 180, 140, .55)');
        wctx.fillStyle = g;
        wctx.fillRect(0, gy, W, Math.max(0, H - gy));

        // launch pad
        var px = sx(0);
        if (px > -40 && px < W + 40) {
            wctx.fillStyle = 'rgba(120, 150, 130, .55)';
            wctx.fillRect(px - 9, gy - 4, 18, 5);
        }
    }

    function polyline(xs, ys, color, width, alpha) {
        var n = Math.min(xs.length, ys.length);
        if (n < 2) return;
        wctx.save();
        wctx.globalAlpha = alpha === undefined ? 1 : alpha;
        wctx.strokeStyle = color;
        wctx.lineWidth = width;
        wctx.lineJoin = 'round';
        wctx.lineCap = 'round';
        wctx.beginPath();
        var step = n > 2400 ? Math.ceil(n / 2400) : 1;
        wctx.moveTo(sx(xs[0]), sy(ys[0]));
        for (var i = step; i < n; i += step) wctx.lineTo(sx(xs[i]), sy(ys[i]));
        wctx.lineTo(sx(xs[n - 1]), sy(ys[n - 1]));
        wctx.stroke();
        wctx.restore();
    }

    function drawGps(hist, tNow) {
        var gx = hist.gpsX || [], gy = hist.gpsY || [], gt = hist.gpsT || [];
        var n = Math.min(gx.length, gy.length);
        for (var i = Math.max(0, n - 400); i < n; i++) {
            var age = gt.length > i ? tNow - gt[i] : 0;
            // fade out over the same window the trajectory ring buffer holds, so no ghost trail outlives it
            var a = 1 - age / 55;
            if (a <= 0.06) continue;
            var x = sx(gx[i]), y = sy(gy[i]);
            if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
            wctx.fillStyle = 'rgba(255, 224, 138,' + (a * 0.85) + ')';
            wctx.beginPath();
            wctx.arc(x, y, 3.1, 0, Math.PI * 2);
            wctx.fill();
            wctx.strokeStyle = 'rgba(214, 168, 62,' + (a * 0.5) + ')';
            wctx.lineWidth = 1;
            wctx.stroke();
        }
    }

    function drawEllipses(st) {
        var e = ellipseOf(st.cov);
        if (!e) return;
        var x = sx(st.est.x), y = sy(st.est.y);
        var alphas = [0.25, 0.15, 0.08];
        for (var k = 3; k >= 1; k--) {
            var ra = Math.max(e.a * k * cam.scale, 0.6);
            var rb = Math.max(e.b * k * cam.scale, 0.6);
            wctx.fillStyle = 'rgba(185, 167, 230,' + alphas[k - 1] + ')';
            wctx.beginPath();
            wctx.ellipse(x, y, ra, rb, -(e.angle || 0), 0, Math.PI * 2);
            wctx.fill();
            if (k === 1) {
                wctx.strokeStyle = 'rgba(150, 124, 208, .55)';
                wctx.lineWidth = 1.2;
                wctx.stroke();
            }
        }
    }

    function drawRocket(st, boosting) {
        var x = sx(st.truth.x), y = sy(st.truth.y);
        var sp = Math.hypot(st.truth.vx, st.truth.vy);
        var ang = sp > 1 ? Math.atan2(st.truth.vx, st.truth.vy) : 0; // 0 = nose up
        var L = Math.max(14, Math.min(32, cam.scale * 7));
        var w = L * 0.36;

        wctx.save();
        wctx.translate(x, y);
        wctx.rotate(ang);

        if (boosting) {
            var f = L * (1.1 + 0.45 * Math.sin(Date.now() / 45));
            var g = wctx.createLinearGradient(0, w * 0.9, 0, w * 0.9 + f);
            g.addColorStop(0, 'rgba(255, 214, 140, .95)');
            g.addColorStop(0.5, 'rgba(255, 168, 150, .75)');
            g.addColorStop(1, 'rgba(255, 190, 200, 0)');
            wctx.fillStyle = g;
            wctx.beginPath();
            wctx.moveTo(-w * 0.5, w * 0.7);
            wctx.quadraticCurveTo(0, w * 0.9 + f, w * 0.5, w * 0.7);
            wctx.closePath();
            wctx.fill();
        }

        // fins
        wctx.fillStyle = '#ffb0b0';
        wctx.beginPath();
        wctx.moveTo(-w * 0.5, w * 0.4); wctx.lineTo(-w * 1.15, w * 1.0); wctx.lineTo(-w * 0.5, w * 0.95);
        wctx.closePath(); wctx.fill();
        wctx.beginPath();
        wctx.moveTo(w * 0.5, w * 0.4); wctx.lineTo(w * 1.15, w * 1.0); wctx.lineTo(w * 0.5, w * 0.95);
        wctx.closePath(); wctx.fill();

        // body
        wctx.fillStyle = '#fffaf7';
        wctx.strokeStyle = 'rgba(140, 120, 140, .5)';
        wctx.lineWidth = 1;
        wctx.beginPath();
        wctx.moveTo(0, -L * 0.95);
        wctx.quadraticCurveTo(w * 0.95, -L * 0.25, w * 0.62, w * 0.95);
        wctx.lineTo(-w * 0.62, w * 0.95);
        wctx.quadraticCurveTo(-w * 0.95, -L * 0.25, 0, -L * 0.95);
        wctx.closePath();
        wctx.fill(); wctx.stroke();

        // nose + porthole
        wctx.fillStyle = '#ff9e9e';
        wctx.beginPath();
        wctx.moveTo(0, -L * 0.95);
        wctx.quadraticCurveTo(w * 0.9, -L * 0.32, w * 0.34, -L * 0.28);
        wctx.lineTo(-w * 0.34, -L * 0.28);
        wctx.quadraticCurveTo(-w * 0.9, -L * 0.32, 0, -L * 0.95);
        wctx.closePath(); wctx.fill();

        wctx.fillStyle = '#c9d6ff';
        wctx.beginPath();
        wctx.arc(0, L * 0.02, Math.max(1.6, w * 0.3), 0, Math.PI * 2);
        wctx.fill();
        wctx.restore();
    }

    function drawEstMarker(st) {
        var x = sx(st.est.x), y = sy(st.est.y);
        wctx.strokeStyle = '#8f74c9';
        wctx.lineWidth = 2;
        wctx.beginPath(); wctx.arc(x, y, 6, 0, Math.PI * 2); wctx.stroke();
        wctx.fillStyle = 'rgba(255,255,255,.85)';
        wctx.beginPath(); wctx.arc(x, y, 2.2, 0, Math.PI * 2); wctx.fill();
    }

    function niceLen(px) {
        var meters = px / cam.scale;
        var pow = Math.pow(10, Math.floor(Math.log10(meters)));
        var cands = [1, 2, 5, 10];
        var best = pow;
        for (var i = 0; i < cands.length; i++) {
            var v = cands[i] * pow;
            if (v <= meters) best = v;
        }
        return best;
    }

    function drawScaleBar() {
        var m = niceLen(120);
        var px = m * cam.scale;
        var x0 = 16, y0 = H - 20;
        wctx.save();
        wctx.strokeStyle = 'rgba(90, 85, 96, .55)';
        wctx.fillStyle = 'rgba(90, 85, 96, .8)';
        wctx.lineWidth = 2;
        wctx.beginPath();
        wctx.moveTo(x0, y0 - 5); wctx.lineTo(x0, y0); wctx.lineTo(x0 + px, y0); wctx.lineTo(x0 + px, y0 - 5);
        wctx.stroke();
        wctx.font = '600 11px system-ui, sans-serif';
        wctx.textBaseline = 'bottom';
        var label = m >= 1000 ? (m / 1000) + ' km' : m + ' m';
        wctx.fillText(label, x0, y0 - 7);
        wctx.restore();
    }

    function drawWorld(st) {
        drawSky();
        drawClouds();
        drawGround();

        var hist = sim.history || {};
        if (layers.truth) polyline(hist.truthX || [], hist.truthY || [], '#ff9e9e', 2.4, 0.95);
        if (layers.meas) drawGps(hist, sim.t);
        if (layers.est) polyline(hist.estX || [], hist.estY || [], '#a78bda', 2, 0.95);
        if (layers.cov) drawEllipses(st);
        if (layers.est) drawEstMarker(st);
        if (layers.truth) drawRocket(st, sim.phase === 'boost');

        drawScaleBar();

        if (!activeCfg.gpsEnabled) {
            wctx.fillStyle = 'rgba(247, 184, 196, .13)';
            wctx.fillRect(0, 0, W, H);
        }
    }

    /* ---------------- error chart ---------------- */

    function drawChart() {
        var w = chartCv.clientWidth, h = chartCv.clientHeight;
        cctx.clearRect(0, 0, w, h);

        var padL = 56, padR = 14, padT = 10, padB = 18;
        var pw = Math.max(10, w - padL - padR), ph = Math.max(10, h - padT - padB);

        var hist = sim.history || {};
        var T = hist.t || [], E = hist.errPos || [], S = hist.sigmaPos || [];
        var tNow = sim.t || 0;
        var tEnd = Math.max(tNow, 20);
        var tStart = Math.max(0, tEnd - 60);

        var i0 = 0;
        for (var i = T.length - 1; i >= 0; i--) { if (T[i] < tStart) { i0 = i; break; } }

        var yMax = 1;
        for (var j = i0; j < T.length; j++) {
            if (E[j] > yMax) yMax = E[j];
            if (S[j] * 3 > yMax) yMax = S[j] * 3;
        }
        yMax = yMax * 1.18;

        function cx(t) { return padL + (t - tStart) / (tEnd - tStart) * pw; }
        function cy(v) { return padT + ph - Math.max(0, Math.min(1, v / yMax)) * ph; }

        // frame + grid
        cctx.strokeStyle = '#ece2e6';
        cctx.lineWidth = 1;
        cctx.font = '10px system-ui, sans-serif';
        cctx.fillStyle = '#a49dab';
        cctx.textAlign = 'right';
        cctx.textBaseline = 'middle';
        for (var g = 0; g <= 3; g++) {
            var v = yMax * g / 3;
            var y = Math.round(cy(v)) + 0.5;
            cctx.beginPath(); cctx.moveTo(padL, y); cctx.lineTo(padL + pw, y); cctx.stroke();
            cctx.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), padL - 6, y);
        }
        cctx.textAlign = 'center';
        cctx.textBaseline = 'top';
        var tickStep = 10;
        var firstTick = Math.ceil(tStart / tickStep) * tickStep;
        for (var tk = firstTick; tk <= tEnd + 0.001; tk += tickStep) {
            var x = Math.round(cx(tk)) + 0.5;
            cctx.strokeStyle = '#f2eaee';
            cctx.beginPath(); cctx.moveTo(x, padT); cctx.lineTo(x, padT + ph); cctx.stroke();
            cctx.fillText(tk.toFixed(0) + 's', x, padT + ph + 4);
        }
        cctx.save();
        cctx.translate(12, padT + ph / 2);
        cctx.rotate(-Math.PI / 2);
        cctx.textAlign = 'center';
        cctx.textBaseline = 'middle';
        cctx.fillText('error (m)', 0, 0);
        cctx.restore();

        if (T.length < 2) return;

        // 3-sigma band
        cctx.fillStyle = 'rgba(185, 167, 230, .30)';
        cctx.beginPath();
        cctx.moveTo(cx(T[i0]), cy(0));
        for (var k = i0; k < T.length; k++) cctx.lineTo(cx(T[k]), cy(3 * (S[k] || 0)));
        cctx.lineTo(cx(T[T.length - 1]), cy(0));
        cctx.closePath();
        cctx.fill();

        cctx.strokeStyle = 'rgba(150, 124, 208, .7)';
        cctx.lineWidth = 1.2;
        cctx.beginPath();
        for (var k2 = i0; k2 < T.length; k2++) {
            var X = cx(T[k2]), Y = cy(3 * (S[k2] || 0));
            if (k2 === i0) cctx.moveTo(X, Y); else cctx.lineTo(X, Y);
        }
        cctx.stroke();

        // error line
        cctx.strokeStyle = '#ef7f88';
        cctx.lineWidth = 1.8;
        cctx.lineJoin = 'round';
        cctx.beginPath();
        for (var k3 = i0; k3 < T.length; k3++) {
            var X2 = cx(T[k3]), Y2 = cy(E[k3] || 0);
            if (k3 === i0) cctx.moveTo(X2, Y2); else cctx.lineTo(X2, Y2);
        }
        cctx.stroke();
    }

    /* ---------------- HUD ---------------- */

    function fmtM(v) {
        if (!isFinite(v)) return '—';
        if (Math.abs(v) >= 10000) return (v / 1000).toFixed(2) + ' km';
        if (Math.abs(v) >= 1000) return (v / 1000).toFixed(2) + ' km';
        return v.toFixed(Math.abs(v) < 100 ? 1 : 0) + ' m';
    }

    function updateHud(st) {
        el.t.textContent = (sim.t || 0).toFixed(2) + ' s';
        el.phase.textContent = sim.phase || '—';
        el.alt.textContent = fmtM(st.truth.y);
        el.vel.textContent = Math.hypot(st.truth.vx, st.truth.vy).toFixed(0) + ' m/s';
        el.err.textContent = (st.err && isFinite(st.err.pos) ? st.err.pos.toFixed(1) : '0.0') + ' m';
        el.sigma.textContent = (isFinite(st.sigmaPos) ? st.sigmaPos.toFixed(1) : '0.0') + ' m';

        var on = !!activeCfg.gpsEnabled;
        var age = st.gps ? (sim.t - st.gps.t) : Infinity;
        el.gps.textContent = !on ? 'outage' : (isFinite(age) ? 'lock · ' + age.toFixed(1) + ' s' : 'acquiring');
        el.gpsChip.classList.toggle('out', !on);
    }

    /* ---------------- main loop ---------------- */

    var last = 0, carry = 0;

    function frame(now) {
        requestAnimationFrame(frame);
        var frameDt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;

        var okW = fit(worldCv, wctx);
        fit(chartCv, cctx);
        if (!okW) return;
        W = worldCv.clientWidth; H = worldCv.clientHeight;

        var dt = activeCfg.dt || 0.01;
        if (!paused) {
            carry += frameDt * speed / dt;
            var steps = Math.min(Math.floor(carry), 200);
            carry -= steps;
            for (var i = 0; i < steps; i++) sim.step();

            if (sim.phase === 'landed') {
                if (landedAt < 0) landedAt = now;
                else if (now - landedAt > 4500) restart();
            } else {
                landedAt = -1;
            }
        }

        var st = sim.state;
        if (!st || !st.truth || !st.est) return;

        updateCamera(W, H, st);
        drawWorld(st);
        drawChart();
        updateHud(st);
    }

    requestAnimationFrame(frame);
})();
