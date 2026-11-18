/* Globe: a small WebGL renderer for the debris visualizer.
 * Units are Earth radii. Positions arrive in TEME (inertial); the Earth turns under them
 * by GMST. In the Earth-fixed frame everything is rotated by -GMST instead. */
(function (root) {
    'use strict';
    const RE = 6378.137;

    function mat4Perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
        return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }
    function mat4LookAt(eye, up) {
        const z = norm([eye[0], eye[1], eye[2]]), x = norm(cross(up, z)), y = cross(z, x);
        return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
            -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    }
    function mat4Mul(a, b) {
        const o = new Float32Array(16);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
        return o;
    }
    function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

    function compile(gl, vs, fs) {
        const p = gl.createProgram();
        for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
            const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const loc = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); loc[a.name] = gl.getAttribLocation(p, a.name); }
        return { p, loc };
    }

    const EARTH_VS = `attribute vec3 aPos; uniform mat4 uVP; uniform mat4 uModel; varying vec3 vN;
        void main(){ vec4 w = uModel * vec4(aPos,1.0); vN = w.xyz; gl_Position = uVP * w; }`;
    const EARTH_FS = `precision mediump float; varying vec3 vN; uniform vec3 uSun; uniform float uLit;
        void main(){ vec3 n = normalize(vN); float d = dot(n, uSun);
            float day = mix(1.0, smoothstep(-0.12, 0.3, d), uLit);
            vec3 c = mix(vec3(0.028,0.04,0.062), vec3(0.075,0.12,0.18), day);
            gl_FragColor = vec4(c, 1.0); }`;
    const LINE_VS = `attribute vec3 aPos; uniform mat4 uVP; uniform mat4 uModel; void main(){ gl_Position = uVP * uModel * vec4(aPos,1.0); }`;
    const LINE_FS = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;
    const PT_VS = `attribute vec3 aPos; attribute vec4 aCol; uniform mat4 uVP; uniform mat4 uModel; uniform float uSize; varying vec4 vC;
        void main(){ vC = aCol; gl_Position = uVP * uModel * vec4(aPos,1.0); gl_PointSize = uSize * (0.6 + 0.4 * aCol.a); if (aCol.a <= 0.0) gl_PointSize = 0.0; }`;
    const PT_FS = `precision mediump float; varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - smoothstep(0.12, 0.25, r) * 0.6)); }`;

    class Globe {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
            if (!gl) throw new Error('WebGL is not available in this browser.');
            this.gl = gl;
            this.earth = compile(gl, EARTH_VS, EARTH_FS);
            this.line = compile(gl, LINE_VS, LINE_FS);
            this.pts = compile(gl, PT_VS, PT_FS);
            this.cam = { az: opts.az ?? -0.6, el: opts.el ?? 0.35, dist: opts.dist ?? 4.2 };
            this.frame = 'inertial'; this.gmst = 0; this.sun = [1, 0, 0]; this.pointSize = 3;
            this.tracks = []; this.n = 0; this.lit = 1;
            this._sphere(); this._buffers();
            this._controls();
            this.onchange = null;
        }
        _sphere() {
            const gl = this.gl, pos = [], idx = [], NL = 64, NM = 128;
            for (let i = 0; i <= NL; i++) {
                const lat = Math.PI / 2 - i * Math.PI / NL;
                for (let j = 0; j <= NM; j++) { const lon = j * 2 * Math.PI / NM; pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)); }
            }
            for (let i = 0; i < NL; i++) for (let j = 0; j < NM; j++) { const a = i * (NM + 1) + j, b = a + NM + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
            this.sphere = { pos: gl.createBuffer(), idx: gl.createBuffer(), n: idx.length };
            gl.bindBuffer(gl.ARRAY_BUFFER, this.sphere.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphere.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
            // graticule
            const g = [], R = 1.0015, ll = (lat, lon) => [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
            for (let lat = -75; lat <= 75; lat += 15) for (let lon = 0; lon < 360; lon += 2) g.push(...ll(lat * Math.PI / 180, lon * Math.PI / 180), ...ll(lat * Math.PI / 180, (lon + 2) * Math.PI / 180));
            for (let lon = 0; lon < 360; lon += 15) for (let lat = -88; lat < 88; lat += 2) g.push(...ll(lat * Math.PI / 180, lon * Math.PI / 180), ...ll((lat + 2) * Math.PI / 180, lon * Math.PI / 180));
            this.grat = { buf: gl.createBuffer(), n: g.length / 3 };
            gl.bindBuffer(gl.ARRAY_BUFFER, this.grat.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g), gl.STATIC_DRAW);
            const eq = []; for (let lon = 0; lon < 360; lon += 1) eq.push(...ll(0, lon * Math.PI / 180), ...ll(0, (lon + 1) * Math.PI / 180));
            this.equator = { buf: gl.createBuffer(), n: eq.length / 3 };
            gl.bindBuffer(gl.ARRAY_BUFFER, this.equator.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(eq), gl.STATIC_DRAW);
        }
        setCoast(land) {
            const gl = this.gl, seg = [], R = 1.002, sc = land.scale || 20;
            const ll = (lon, lat) => { lon *= Math.PI / 180; lat *= Math.PI / 180; return [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)]; };
            for (const ring of land.rings) for (let i = 2; i < ring.length; i += 2) {
                const lo0 = ring[i - 2] / sc, la0 = ring[i - 1] / sc, lo1 = ring[i] / sc, la1 = ring[i + 1] / sc;
                if (Math.abs(lo1 - lo0) > 180) continue;
                seg.push(...ll(lo0, la0), ...ll(lo1, la1));
            }
            this.coast = { buf: gl.createBuffer(), n: seg.length / 3 };
            gl.bindBuffer(gl.ARRAY_BUFFER, this.coast.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seg), gl.STATIC_DRAW);
            this.draw();
        }
        _buffers() { const gl = this.gl; this.pBuf = gl.createBuffer(); this.cBuf = gl.createBuffer(); this.tBuf = gl.createBuffer(); this.mBuf = gl.createBuffer(); this.mcBuf = gl.createBuffer(); }
        /** positions: Float32Array xyz in km (TEME); colors: Float32Array rgba (alpha 0 hides). */
        setPoints(positions, colors) {
            const gl = this.gl;
            this.n = positions.length / 3;
            if (!this.scaled || this.scaled.length !== positions.length) this.scaled = new Float32Array(positions.length);
            for (let i = 0; i < positions.length; i++) this.scaled[i] = positions[i] / RE;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.bufferData(gl.ARRAY_BUFFER, this.scaled, gl.DYNAMIC_DRAW);
            if (colors) { this.colors = colors; gl.bindBuffer(gl.ARRAY_BUFFER, this.cBuf); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW); }
        }
        setColors(colors) { const gl = this.gl; this.colors = colors; gl.bindBuffer(gl.ARRAY_BUFFER, this.cBuf); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW); }
        /** Extra highlighted markers: [{pos:[x,y,z] km, color:[r,g,b,a], size}] */
        setMarkers(markers) { this.markers = markers; }
        /** tracks: [{points: Float32Array xyz km, color: [r,g,b,a], fixed: bool (Earth-fixed coordinates)}] */
        setTracks(tracks) {
            const gl = this.gl;
            this.tracks = tracks.map(t => { const b = gl.createBuffer(); const s = new Float32Array(t.points.length); for (let i = 0; i < s.length; i++) s[i] = t.points[i] / RE; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, s, gl.STATIC_DRAW); return { buf: b, n: s.length / 3, color: t.color, loop: t.loop }; });
            (this._oldTracks || []).forEach(t => gl.deleteBuffer(t.buf)); this._oldTracks = this.tracks;
        }
        matrices() {
            const c = this.cam, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
            const eye = [c.dist * Math.cos(c.el) * Math.cos(c.az), c.dist * Math.cos(c.el) * Math.sin(c.az), c.dist * Math.sin(c.el)];
            const proj = mat4Perspective(35 * Math.PI / 180, w / Math.max(1, h), 0.02, 400);
            const view = mat4LookAt(eye, [0, 0, 1]);
            const vp = mat4Mul(proj, view);
            const earthModel = this.frame === 'inertial' ? rotZ(this.gmst) : rotZ(0);
            const objModel = this.frame === 'inertial' ? rotZ(0) : rotZ(-this.gmst);
            return { vp, earthModel, objModel, eye };
        }
        resize() {
            const dpr = Math.min(2, root.devicePixelRatio || 1), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
            if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
            this.dpr = dpr;
        }
        draw() {
            const gl = this.gl; this.resize();
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clearColor(0.02, 0.02, 0.027, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
            const M = this.matrices();
            // Earth
            let P = this.earth; gl.useProgram(P.p);
            gl.uniformMatrix4fv(P.loc.uVP, false, M.vp); gl.uniformMatrix4fv(P.loc.uModel, false, M.earthModel);
            const sun = this.frame === 'inertial' ? this.sun : (() => { const c = Math.cos(-this.gmst), s = Math.sin(-this.gmst); return [c * this.sun[0] - s * this.sun[1], s * this.sun[0] + c * this.sun[1], this.sun[2]]; })();
            gl.uniform3fv(P.loc.uSun, new Float32Array(sun)); gl.uniform1f(P.loc.uLit, this.lit);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.sphere.pos); gl.enableVertexAttribArray(P.loc.aPos); gl.vertexAttribPointer(P.loc.aPos, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphere.idx); gl.drawElements(gl.TRIANGLES, this.sphere.n, gl.UNSIGNED_SHORT, 0);
            // lines on the Earth
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            P = this.line; gl.useProgram(P.p); gl.uniformMatrix4fv(P.loc.uVP, false, M.vp);
            const lines = (buf, n, color, model, mode = gl.LINES) => { gl.uniformMatrix4fv(P.loc.uModel, false, model); gl.uniform4fv(P.loc.uColor, new Float32Array(color)); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(P.loc.aPos); gl.vertexAttribPointer(P.loc.aPos, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(mode, 0, n); };
            if (this.showGrid !== false) { lines(this.grat.buf, this.grat.n, [1, 1, 1, 0.07], M.earthModel); lines(this.equator.buf, this.equator.n, [1, 1, 1, 0.16], M.earthModel); }
            if (this.coast) lines(this.coast.buf, this.coast.n, [0.86, 0.88, 0.92, 0.62], M.earthModel);
            for (const t of this.tracks) lines(t.buf, t.n, t.color, M.objModel, t.loop ? gl.LINE_LOOP : gl.LINE_STRIP);
            // points
            P = this.pts; gl.useProgram(P.p);
            gl.uniformMatrix4fv(P.loc.uVP, false, M.vp); gl.uniformMatrix4fv(P.loc.uModel, false, M.objModel);
            if (this.n) {
                gl.uniform1f(P.loc.uSize, this.pointSize * this.dpr);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.enableVertexAttribArray(P.loc.aPos); gl.vertexAttribPointer(P.loc.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.cBuf); gl.enableVertexAttribArray(P.loc.aCol); gl.vertexAttribPointer(P.loc.aCol, 4, gl.FLOAT, false, 0, 0);
                gl.drawArrays(gl.POINTS, 0, this.n);
            }
            if (this.markers && this.markers.length) {
                const pos = new Float32Array(this.markers.flatMap(m => m.pos.map(v => v / RE))), col = new Float32Array(this.markers.flatMap(m => m.color));
                gl.bindBuffer(gl.ARRAY_BUFFER, this.mBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(P.loc.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.mcBuf); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(P.loc.aCol, 4, gl.FLOAT, false, 0, 0);
                gl.uniform1f(P.loc.uSize, 9 * this.dpr); gl.disable(gl.DEPTH_TEST);
                gl.drawArrays(gl.POINTS, 0, this.markers.length); gl.enable(gl.DEPTH_TEST);
            }
            gl.disable(gl.BLEND);
            this.onchange && this.onchange();
        }
        /** Screen position (CSS px) of a TEME point in km, with visibility (not behind Earth). */
        project(p, M) {
            M = M || this.matrices();
            const m = M.objModel, x = p[0] / RE, y = p[1] / RE, z = p[2] / RE;
            const wx = m[0] * x + m[4] * y + m[8] * z, wy = m[1] * x + m[5] * y + m[9] * z, wz = m[2] * x + m[6] * y + m[10] * z;
            const v = M.vp, cx = v[0] * wx + v[4] * wy + v[8] * wz + v[12], cy = v[1] * wx + v[5] * wy + v[9] * wz + v[13], cw = v[3] * wx + v[7] * wy + v[11] * wz + v[15];
            if (cw <= 0) return null;
            const sx = (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth, sy = (0.5 - cy / cw * 0.5) * this.canvas.clientHeight;
            // occlusion: segment eye -> point intersects unit sphere before the point?
            const e = M.eye, d = [wx - e[0], wy - e[1], wz - e[2]], L = Math.hypot(d[0], d[1], d[2]);
            const u = [d[0] / L, d[1] / L, d[2] / L], b = dot(e, u), c = dot(e, e) - 1, disc = b * b - c;
            let hidden = false;
            if (disc > 0) { const t = -b - Math.sqrt(disc); hidden = t > 0 && t < L; }
            return { x: sx, y: sy, hidden };
        }
        /** Index of the nearest visible point to a CSS pixel, or -1. */
        pick(px, py, visible, radius = 9) {
            const M = this.matrices(); let best = -1, bd = radius * radius;
            const pos = this.scaled; if (!pos) return -1;
            const tmp = [0, 0, 0];
            for (let i = 0; i < this.n; i++) {
                if (visible && !visible(i)) continue;
                tmp[0] = pos[3 * i] * RE; tmp[1] = pos[3 * i + 1] * RE; tmp[2] = pos[3 * i + 2] * RE;
                if (!isFinite(tmp[0])) continue;
                const s = this.project(tmp, M); if (!s || s.hidden) continue;
                const d = (s.x - px) ** 2 + (s.y - py) ** 2;
                if (d < bd) { bd = d; best = i; }
            }
            return best;
        }
        _controls() {
            const c = this.canvas; let drag = null, moved = false; const pointers = new Map();
            c.addEventListener('pointerdown', e => { pointers.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, az: this.cam.az, el: this.cam.el }; moved = false; c.setPointerCapture(e.pointerId); });
            c.addEventListener('pointermove', e => {
                if (!pointers.has(e.pointerId)) return;
                const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
                if (pointers.size === 2) {
                    const [a, b] = [...pointers.values()];
                    const others = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
                    const d0 = Math.hypot(prev[0] - others[0], prev[1] - others[1]), d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
                    if (d0 > 0) this.zoom(d0 / d1); moved = true; return;
                }
                if (!drag) return;
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
                const k = 0.005 * Math.min(1, this.cam.dist / 4);
                this.cam.az = drag.az - dx * k * 1.3; this.cam.el = Math.max(-1.5, Math.min(1.5, drag.el + dy * k * 1.3));
                this.draw();
            });
            const end = e => { pointers.delete(e.pointerId); if (!pointers.size) { if (!moved && drag && this.onclick) this.onclick(e); drag = null; } };
            c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
            c.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
        }
        zoom(f) { this.cam.dist = Math.max(1.15, Math.min(80, this.cam.dist * f)); this.draw(); }
    }
    root.Globe = Globe;
})(typeof self !== 'undefined' ? self : globalThis);
