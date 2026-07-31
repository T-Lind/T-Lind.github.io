/* Kalman Filter Flight Demo — simulation + filter engine.
   Classic script: attaches window.KalmanDemo. No modules, no dependencies. */
(function (global) {
  'use strict';

  var HISTORY_CAP = 6000;
  var DEG = Math.PI / 180;

  // ---- rng -----------------------------------------------------------------

  var spare = null;
  function gauss() {
    if (spare !== null) { var s = spare; spare = null; return s; }
    var u, v, r;
    do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; r = u * u + v * v; }
    while (r === 0 || r >= 1);
    var f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return u * f;
  }

  // ---- small dense matrix helpers -----------------------------------------

  function zeros(n, m) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) { a[i] = new Array(m); for (var j = 0; j < m; j++) a[i][j] = 0; }
    return a;
  }
  function eye(n) { var a = zeros(n, n); for (var i = 0; i < n; i++) a[i][i] = 1; return a; }
  function clone(A) { var a = new Array(A.length); for (var i = 0; i < A.length; i++) a[i] = A[i].slice(); return a; }
  function transpose(A) {
    var n = A.length, m = A[0].length, B = zeros(m, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) B[j][i] = A[i][j];
    return B;
  }
  function matMul(A, B) {
    var n = A.length, k = B.length, m = B[0].length, C = zeros(n, m);
    for (var i = 0; i < n; i++) for (var p = 0; p < k; p++) {
      var a = A[i][p];
      if (a === 0) continue;
      for (var j = 0; j < m; j++) C[i][j] += a * B[p][j];
    }
    return C;
  }
  function matAdd(A, B) {
    var n = A.length, m = A[0].length, C = zeros(n, m);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) C[i][j] = A[i][j] + B[i][j];
    return C;
  }
  function matSub(A, B) {
    var n = A.length, m = A[0].length, C = zeros(n, m);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) C[i][j] = A[i][j] - B[i][j];
    return C;
  }
  function matVec(A, v) {
    var n = A.length, m = v.length, r = new Array(n);
    for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < m; j++) s += A[i][j] * v[j]; r[i] = s; }
    return r;
  }
  function inv2(A) {
    var det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    if (!isFinite(det) || Math.abs(det) < 1e-300) det = det >= 0 ? 1e-300 : -1e-300;
    return [[A[1][1] / det, -A[0][1] / det], [-A[1][0] / det, A[0][0] / det]];
  }
  function symmetrize(A) {
    for (var i = 0; i < A.length; i++) for (var j = i + 1; j < A.length; j++) {
      var m = 0.5 * (A[i][j] + A[j][i]);
      A[i][j] = m; A[j][i] = m;
    }
    return A;
  }

  // ---- config --------------------------------------------------------------

  function defaultConfig() {
    return {
      dt: 0.01,
      thrustAccel: 35,
      burnTime: 14,
      pitchOverStart: 2,
      pitchOverRate: 3.5,
      dragCoeff: 0.004,
      gravity: 9.81,
      windGustStd: 1.5,
      windGustTau: 3,
      imuNoiseStd: 0.6,
      imuBias: [0.25, -0.18],
      gpsNoiseStd: 18,
      gpsRate: 4,
      gpsEnabled: true,
      qAccel: 1.2,
      rGps: 18
    };
  }

  // Fields that may change mid-flight; mission/vehicle fields need a reset.
  var LIVE_FIELDS = ['windGustStd', 'windGustTau', 'imuNoiseStd', 'imuBias',
    'gpsNoiseStd', 'gpsRate', 'gpsEnabled', 'qAccel', 'rGps'];

  function mergeConfig(base, patch, keys) {
    if (!patch) return base;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (patch[k] === undefined || patch[k] === null) continue;
      base[k] = (k === 'imuBias') ? [Number(patch[k][0]) || 0, Number(patch[k][1]) || 0]
        : (k === 'gpsEnabled') ? !!patch[k] : Number(patch[k]);
    }
    return base;
  }

  function fullConfig(patch) {
    var c = defaultConfig();
    return mergeConfig(c, patch, Object.keys(c));
  }

  // ---- covariance ellipse --------------------------------------------------

  // 1σ ellipse of the position block: eigen-decomposition of a symmetric 2x2.
  function covEllipse(cov) {
    var a = cov[0][0], b = 0.5 * (cov[0][1] + cov[1][0]), c = cov[1][1];
    var tr = 0.5 * (a + c);
    var d = Math.sqrt(Math.max(0, 0.25 * (a - c) * (a - c) + b * b));
    var l1 = Math.max(0, tr + d), l2 = Math.max(0, tr - d);
    var angle = (Math.abs(b) < 1e-12 && Math.abs(a - c) < 1e-12) ? 0 : 0.5 * Math.atan2(2 * b, a - c);
    return { a: Math.sqrt(l1), b: Math.sqrt(l2), angle: angle };
  }

  // ---- simulation ----------------------------------------------------------

  function Simulation(config) {
    this.cfg = fullConfig(config);
    this.history = null;
    this.reset(this.cfg);
  }

  Simulation.prototype.reset = function (config) {
    if (config) this.cfg = fullConfig(config);
    var c = this.cfg;

    this.t = 0;
    this.phase = 'boost';
    this.gust = 0;
    this.gpsPeriod = 1 / Math.max(0.01, c.gpsRate);
    this.nextGpsT = this.gpsPeriod;
    this.apogee = 0;

    this.truth = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0 };

    // Filter: state [x, y, vx, vy]; launch pose is known to a few metres.
    this.xh = [0, 0, 0, 0];
    this.P = [[9, 0, 0, 0], [0, 9, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    this.H = [[1, 0, 0, 0], [0, 1, 0, 0]];
    this.Ht = transpose(this.H);
    this.I4 = eye(4);
    this._buildF(c.dt);

    this.history = {
      t: [], truthX: [], truthY: [], estX: [], estY: [],
      gpsX: [], gpsY: [], gpsT: [], errPos: [], sigmaPos: []
    };

    this.state = {
      truth: { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0 },
      imu: { ax: 0, ay: 0 },
      gps: null,
      gpsFresh: false,
      est: { x: 0, y: 0, vx: 0, vy: 0 },
      cov: clone(this.P),
      err: { x: 0, y: 0, pos: 0 },
      sigmaPos: Math.sqrt(this.P[0][0] + this.P[1][1])
    };
    this._sync(false);
    return this;
  };

  Simulation.prototype.setConfig = function (patch) {
    mergeConfig(this.cfg, patch, LIVE_FIELDS);
    var p = 1 / Math.max(0.01, this.cfg.gpsRate);
    if (p !== this.gpsPeriod) {
      this.gpsPeriod = p;
      this.nextGpsT = this.t + p;
    }
    return this;
  };

  Simulation.prototype._buildF = function (dt) {
    this.F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
    this.Ft = transpose(this.F);
    this.B = [[0.5 * dt * dt, 0], [0, 0.5 * dt * dt], [dt, 0], [0, dt]];
  };

  // Q: white-noise-acceleration discretization, per-axis [[dt^3/3, dt^2/2],[dt^2/2, dt]] * qAccel^2.
  // qAccel is treated as a noise *density* (m/s^2/sqrt(Hz)) so Q is invariant to the predict rate;
  // the per-step piecewise form would collapse to near-zero at dt = 0.01 and make P wildly optimistic.
  Simulation.prototype._Q = function (dt) {
    var q = this.cfg.qAccel * this.cfg.qAccel;
    var p = q * dt * dt * dt / 3, pv = q * dt * dt / 2, v = q * dt;
    return [[p, 0, pv, 0], [0, p, 0, pv], [pv, 0, v, 0], [0, pv, 0, v]];
  };

  Simulation.prototype._truthAccel = function () {
    var c = this.cfg, tr = this.truth;
    var ax = 0, ay = -c.gravity;
    if (this.t < c.burnTime) {
      var tilt = Math.min(89, Math.max(0, (this.t - c.pitchOverStart) * c.pitchOverRate)) * DEG;
      ax += c.thrustAccel * Math.sin(tilt);
      ay += c.thrustAccel * Math.cos(tilt);
    }
    var sp = Math.sqrt(tr.vx * tr.vx + tr.vy * tr.vy);
    ax -= c.dragCoeff * sp * tr.vx;
    ay -= c.dragCoeff * sp * tr.vy;
    ax += this.gust;
    return [ax, ay];
  };

  Simulation.prototype.step = function () {
    var c = this.cfg, dt = c.dt, tr = this.truth;
    if (dt !== this.F[0][2]) this._buildF(dt);

    // Ornstein-Uhlenbeck horizontal gust, stationary std = windGustStd.
    var tau = Math.max(1e-3, c.windGustTau);
    this.gust += -this.gust / tau * dt + c.windGustStd * Math.sqrt(2 * dt / tau) * gauss();

    var a;
    if (this.phase === 'landed') {
      a = [0, 0];
      tr.vx = 0; tr.vy = 0; tr.y = 0;
    } else {
      a = this._truthAccel();
      // semi-implicit Euler
      tr.vx += a[0] * dt; tr.vy += a[1] * dt;
      tr.x += tr.vx * dt; tr.y += tr.vy * dt;
      if (tr.y > this.apogee) this.apogee = tr.y;
      if (tr.y <= 0 && this.t > 1) {
        tr.y = 0; tr.vx = 0; tr.vy = 0; a = [0, 0];
        this.phase = 'landed';
      }
    }
    tr.ax = a[0]; tr.ay = a[1];
    this.t += dt;
    if (this.phase !== 'landed') this.phase = (this.t < c.burnTime) ? 'boost' : 'coast';

    // IMU: true specific force, gravity-compensated, plus constant bias and white noise.
    var ux = a[0] + c.imuBias[0] + c.imuNoiseStd * gauss();
    var uy = a[1] + c.imuBias[1] + c.imuNoiseStd * gauss();
    this.state.imu.ax = ux; this.state.imu.ay = uy;

    // Predict: x = F x + B u ; P = F P F' + Q
    var Fx = matVec(this.F, this.xh), Bu = matVec(this.B, [ux, uy]);
    this.xh = [Fx[0] + Bu[0], Fx[1] + Bu[1], Fx[2] + Bu[2], Fx[3] + Bu[3]];
    this.P = symmetrize(matAdd(matMul(matMul(this.F, this.P), this.Ft), this._Q(dt)));

    // Update on GPS fix.
    var fresh = false;
    if (this.t + 1e-9 >= this.nextGpsT) {
      if (c.gpsEnabled) {
        var z = [tr.x + c.gpsNoiseStd * gauss(), tr.y + c.gpsNoiseStd * gauss()];
        this._update(z);
        this.state.gps = { x: z[0], y: z[1], t: this.t };
        fresh = true;
      }
      this.nextGpsT += this.gpsPeriod;
      if (this.nextGpsT < this.t) this.nextGpsT = this.t + this.gpsPeriod;
    }

    this._sync(fresh);
    return this.state;
  };

  Simulation.prototype._update = function (z) {
    var r = this.cfg.rGps * this.cfg.rGps;
    var R = [[r, 0], [0, r]];
    var PHt = matMul(this.P, this.Ht);
    var S = matAdd(matMul(this.H, PHt), R);
    var K = matMul(PHt, inv2(S));
    var y = [z[0] - this.xh[0], z[1] - this.xh[1]];
    var Ky = matVec(K, y);
    for (var i = 0; i < 4; i++) this.xh[i] += Ky[i];
    // Joseph form
    var IKH = matSub(this.I4, matMul(K, this.H));
    var P1 = matMul(matMul(IKH, this.P), transpose(IKH));
    var P2 = matMul(matMul(K, R), transpose(K));
    this.P = symmetrize(matAdd(P1, P2));
  };

  Simulation.prototype._sync = function (fresh) {
    var s = this.state, tr = this.truth, h = this.history;
    s.truth.x = tr.x; s.truth.y = tr.y; s.truth.vx = tr.vx; s.truth.vy = tr.vy;
    s.truth.ax = tr.ax; s.truth.ay = tr.ay;
    s.est.x = this.xh[0]; s.est.y = this.xh[1]; s.est.vx = this.xh[2]; s.est.vy = this.xh[3];
    s.cov = clone(this.P);
    var ex = this.xh[0] - tr.x, ey = this.xh[1] - tr.y;
    s.err.x = ex; s.err.y = ey; s.err.pos = Math.sqrt(ex * ex + ey * ey);
    s.sigmaPos = Math.sqrt(Math.max(0, this.P[0][0] + this.P[1][1]));
    s.gpsFresh = !!fresh;

    push(h.t, this.t); push(h.truthX, tr.x); push(h.truthY, tr.y);
    push(h.estX, this.xh[0]); push(h.estY, this.xh[1]);
    push(h.errPos, s.err.pos); push(h.sigmaPos, s.sigmaPos);
    if (fresh && s.gps) { push(h.gpsX, s.gps.x); push(h.gpsY, s.gps.y); push(h.gpsT, s.gps.t); }
  };

  function push(arr, v) { arr.push(v); if (arr.length > HISTORY_CAP) arr.shift(); }

  // ---- namespace -----------------------------------------------------------

  global.KalmanDemo = {
    defaultConfig: defaultConfig,
    Simulation: Simulation,
    covEllipse: covEllipse,
    gauss: gauss
  };

  // ---- self-check (only on #selftest) --------------------------------------

  function selftest() {
    var log = function () { console.log.apply(console, arguments); };
    log('[KalmanDemo selftest] start');

    var sim = new Simulation();
    var n = 0, bad5 = 0, sumErr = 0, sumSig = 0, sawBoost = false, sawCoast = false, sawLanded = false;
    var symOk = true, diagOk = true;
    var settledErr = 0, settledSig = 0, settled = 0;

    for (var i = 0; i < 3000; i++) {           // 30 s
      var s = sim.step();
      n++;
      if (sim.phase === 'boost') sawBoost = true;
      if (sim.phase === 'coast') sawCoast = true;
      for (var r = 0; r < 4; r++) {
        if (s.cov[r][r] <= 0) diagOk = false;
        for (var c2 = 0; c2 < 4; c2++) if (Math.abs(s.cov[r][c2] - s.cov[c2][r]) > 1e-9) symOk = false;
      }
      if (s.err.pos > 5 * s.sigmaPos) bad5++;
      sumErr += s.err.pos; sumSig += s.sigmaPos;
      if (sim.t > 5) { settledErr += s.err.pos; settledSig += s.sigmaPos; settled++; }
    }
    var alt = sim.state.truth.y;
    console.assert(symOk, 'P must stay symmetric');
    console.assert(diagOk, 'P diagonal must stay positive');
    console.assert(bad5 / n < 0.01, 'error must stay within 5 sigma on >99% of ticks (got ' + bad5 + '/' + n + ')');
    console.assert(sawBoost && sawCoast, 'boost and coast phases must occur');
    console.assert(alt > 100, 'rocket must gain altitude');
    log('  30 s: alt=' + alt.toFixed(1) + ' m, mean |err|=' + (settledErr / settled).toFixed(2) +
      ' m, mean sigmaPos=' + (settledSig / settled).toFixed(2) + ' m, 5-sigma breaches=' + bad5 + '/' + n +
      ', final |err|=' + sim.state.err.pos.toFixed(2) + ' m');

    for (var j = 0; j < 12000 && sim.phase !== 'landed'; j++) sim.step();
    sawLanded = sim.phase === 'landed';
    console.assert(sawLanded, 'rocket must reach landed phase');
    log('  landed at t=' + sim.t.toFixed(2) + ' s, apogee=' + sim.apogee.toFixed(1) + ' m');

    // Outage: covariance must grow without GPS and shrink once it returns.
    var sim2 = new Simulation();
    for (var k = 0; k < 1000; k++) sim2.step();
    var sigA = sim2.state.sigmaPos;
    sim2.setConfig({ gpsEnabled: false });
    for (var k2 = 0; k2 < 1000; k2++) sim2.step();
    var sigB = sim2.state.sigmaPos, errB = sim2.state.err.pos;
    sim2.setConfig({ gpsEnabled: true });
    for (var k3 = 0; k3 < 300; k3++) sim2.step();
    var sigC = sim2.state.sigmaPos;
    console.assert(sigB > sigA * 2, 'sigma must grow during GPS outage');
    console.assert(sigC < sigB, 'sigma must shrink after GPS returns');
    log('  outage: sigmaPos ' + sigA.toFixed(2) + ' -> ' + sigB.toFixed(2) + ' -> ' + sigC.toFixed(2) +
      ' m (|err| at outage end ' + errB.toFixed(2) + ' m)');
    log('[KalmanDemo selftest] done');
  }

  global.KalmanDemo.selftest = selftest;
  if (typeof location !== 'undefined' && location && location.hash === '#selftest') {
    if (typeof global.addEventListener === 'function') global.addEventListener('load', selftest);
    else selftest();
  }
})(typeof window !== 'undefined' ? window : this);
