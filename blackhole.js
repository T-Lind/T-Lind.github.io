/* Real-time Schwarzschild black hole for the homepage hero.
 *
 * Every light ray around a non-rotating black hole stays in one plane, and its
 * shape in that plane depends only on its impact parameter b. So instead of
 * integrating ~100-600 geodesic steps per pixel, the page integrates ~512
 * representative rays once at startup (in JavaScript, ~50 ms) and stores
 * u = 1/r along each one in a table. Each pixel then finds where its ray
 * crosses the disk plane analytically and reads the radius from the table:
 * a handful of texture fetches instead of a long loop. The time saved buys
 * native-resolution rendering, supersampling of the thin photon rings,
 * correct relativistic Doppler shifts, anti-aliased lensed stars, and bloom.
 *
 * Units: Schwarzschild radius RS = 1 (so M = 0.5).
 */
(() => {
  "use strict";

  const canvas = document.getElementById("gl");
  const hero = document.getElementById("hero");
  const hint = document.getElementById("hint");
  const admireBtn = document.getElementById("admire");
  const motionBtn = document.getElementById("motion");

  function showFallback() {
    document.getElementById("fallback").style.display = "grid";
    admireBtn.disabled = true;
    motionBtn.disabled = true;
    hint.hidden = true;
  }

  const gl = canvas.getContext("webgl2", {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: "high-performance", preserveDrawingBuffer: false
  });
  if (!gl) { showFallback(); return; }

  /* ================================================================
   * Geodesic table
   * Orbit equation: d²u/dψ² = -u + 1.5u², u = 1/r, ψ = in-plane angle
   * measured from the ray's incoming direction at infinity.
   * Rows: impact parameter b, densely packed near the critical value
   * b_c = 1.5·√3 where rays wind around the photon sphere. Two halves:
   * captured rays (b < b_c) and scattered rays (b > b_c).
   * Columns: t = ψ / ψ_end, so features line up across rows (periapsis at
   * t = 0.5 for scattered rays, horizon at t = 1 for captured rays).
   * ================================================================ */
  const BC = 1.5 * Math.sqrt(3);
  const NT = 513, NSIDE = 256, NROWS = 2 * NSIDE, LMIN = -16;
  const LMAX = [Math.log(BC - 0.002), Math.log(400 - BC)];

  function rowImpact(row) {
    const side = row >= NSIDE ? 1 : 0, i = row - side * NSIDE;
    const L = LMIN + (LMAX[side] - LMIN) * i / (NSIDE - 1);
    return side ? BC + Math.exp(L) : BC - Math.exp(L);
  }

  function buildTable() {
    const lut = new Float32Array(NT * NROWS);
    const psiEnd = new Float64Array(NROWS);
    const P = [], U = [], V = [];
    for (let row = 0; row < NROWS; row++) {
      const b = rowImpact(row), scatter = row >= NSIDE, ib2 = 1 / (b * b);
      let u = 0, v = 1 / b, psi = 0, end = 0;
      P.length = U.length = V.length = 0;
      P.push(0); U.push(0); V.push(v);
      for (let n = 0; n < 200000; n++) {
        const h = 0.02 / Math.max(1, Math.abs(v));
        const a1 = -u + 1.5 * u * u;
        let uu = u + 0.5 * h * v, vv = v + 0.5 * h * a1;
        const a2 = -uu + 1.5 * uu * uu, v2 = vv;
        uu = u + 0.5 * h * v2; vv = v + 0.5 * h * a2;
        const a3 = -uu + 1.5 * uu * uu, v3 = vv;
        uu = u + h * v3; vv = v + h * a3;
        const a4 = -uu + 1.5 * uu * uu, v4 = vv;
        const un = u + h / 6 * (v + 2 * v2 + 2 * v3 + v4);
        const vn = v + h / 6 * (a1 + 2 * a2 + 2 * a3 + a4);
        if (scatter && vn <= 0) {
          // Periapsis: the root of u³ - u² + 1/b² = 0 next to u.
          let up = un;
          for (let k = 0; k < 30; k++) {
            const f = up * up * up - up * up + ib2, df = 3 * up * up - 2 * up;
            if (Math.abs(df) < 1e-14) break;
            up -= f / df;
          }
          if (!(up >= u) || up > 2 / 3 + 1e-9) up = Math.max(u, un);
          end = psi + h * v / (v - vn);
          P.push(end); U.push(up); V.push(0);
          break;
        }
        if (!scatter && un >= 1) {
          end = psi + h * (1 - u) / (un - u);
          P.push(end); U.push(1); V.push(vn);
          break;
        }
        psi += h; u = un; v = vn;
        P.push(psi); U.push(u); V.push(v);
      }
      // Cubic Hermite resample onto the uniform t grid. Scattered rays are
      // symmetric about periapsis, so only the stable inbound half is used.
      const last = scatter ? (NT - 1) / 2 : NT - 1;
      let k = 0;
      for (let j = 0; j <= last; j++) {
        const x = end * j / last;
        while (k < P.length - 2 && P[k + 1] < x) k++;
        const h = P[k + 1] - P[k];
        const s = h > 0 ? Math.min(1, Math.max(0, (x - P[k]) / h)) : 0;
        const s2 = s * s, s3 = s2 * s;
        const val = (2 * s3 - 3 * s2 + 1) * U[k] + (s3 - 2 * s2 + s) * h * V[k]
                  + (-2 * s3 + 3 * s2) * U[k + 1] + (s3 - s2) * h * V[k + 1];
        lut[row * NT + j] = val;
        if (scatter) lut[row * NT + (NT - 1 - j)] = val;
      }
      psiEnd[row] = scatter ? 2 * end : end;
    }
    return { lut, psiEnd };
  }

  const table = buildTable();
  const meta = new Float32Array(NROWS * 4);
  let metaDist = -1;

  /* Where along each tabulated ray does the camera sit? Inverting the same
     table the shader reads keeps u(ψ_cam) consistent with the lookups. */
  function updateCameraRows(dist) {
    const u0 = 1 / dist;
    for (let row = 0; row < NROWS; row++) {
      const base = row * NT, scatter = row >= NSIDE;
      const last = scatter ? (NT - 1) / 2 : NT - 1;
      let t = last / (NT - 1);
      if (table.lut[base + last] > u0) {
        let lo = 0, hi = last;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table.lut[base + mid] <= u0) lo = mid; else hi = mid; }
        const a = table.lut[base + lo], c = table.lut[base + hi];
        t = (lo + (c > a ? (u0 - a) / (c - a) : 0)) / (NT - 1);
      }
      meta[row * 4] = table.psiEnd[row];
      meta[row * 4 + 1] = t * table.psiEnd[row];
    }
    metaDist = dist;
  }

  /* ================================================================
   * Shaders
   * ================================================================ */
  const VS = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const COMMON = `
uint pcg(uint v){
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint v){ return float(pcg(v)) * (1.0 / 4294967295.0); }
float hash3(vec3 p){
  uvec3 q = uvec3(ivec3(p) + 32768);
  return rnd(q.x + pcg(q.y + pcg(q.z)));
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                 mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                 mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
/* Approximate blackbody colour (linear sRGB), brightest channel = 1 so cool
   red-orange gas is genuinely dimmer than white-hot gas. */
vec3 blackbody(float T){
  T = clamp(T, 1000.0, 40000.0) * 0.01;
  vec3 c;
  c.r = T <= 66.0 ? 1.0 : 1.292936 * pow(T - 60.0, -0.1332048);
  c.g = T <= 66.0 ? 0.3900816 * log(T) - 0.6318414 : 1.129891 * pow(T - 60.0, -0.0755148);
  c.b = T >= 66.0 ? 1.0 : (T <= 19.0 ? 0.0 : 0.5432068 * log(T - 10.0) - 1.1962541);
  c = pow(clamp(c, 0.0, 1.0), vec3(2.2));
  return c / max(max(c.r, max(c.g, c.b)), 1e-3);
}`;

  const FS_SCENE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 fragColor;

uniform vec2  uRes;
uniform vec2  uOffset;
uniform float uTanHalf;
uniform vec3  uE1;          // unit vector from hole to camera
uniform vec3  uRight, uUp, uFwd;
uniform float uCamDist, uCamLapse;
uniform float uTime;
uniform float uBeam;        // Doppler-beaming exponent
uniform float uDiskBright;
uniform float uOutScale;
uniform sampler2D uLut;     // R32F  NT x NROWS: u along each ray
uniform sampler2D uMeta;    // RGBA32F NROWS x 1: (psiEnd, psiCam)
uniform samplerCube uSky;   // baked nebula

#define PI 3.14159265
#define TAU 6.28318531
#define BC 2.59807621
#define R_IN 3.0
#define R_OUT 10.0
#define NTM1 ${NT - 1}.0
#define NSIDE ${NSIDE}
#define LMIN ${LMIN.toFixed(1)}
#define LMAX_CAP ${LMAX[0].toFixed(8)}
#define LMAX_SCAT ${LMAX[1].toFixed(8)}
${COMMON}

/* Keplerian angular velocity of circular orbits. */
float omega(float r){ return sqrt(0.5 / (r * r * r)); }

/* Periodic value noise around the azimuth, N cells per turn. */
float pnoise(float a, float N, uint seed){
  float x = a * (N / TAU);
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i, N), i1 = mod(i + 1.0, N);
  return mix(rnd(seed + uint(i0) * 7919u), rnd(seed + uint(i1) * 7919u), f);
}

/* Thin rings of gas, each orbiting rigidly at its own Keplerian rate, so the
   pattern shears realistically (inner rings overtake outer ones) without the
   texture winding up into noise over time. */
#define BAND 0.27
float diskTexture(float r, float az, out float knot){
  float x = (r - R_IN) / BAND - 0.5;
  float jn = floor(x + 0.5);
  float acc = 0.0, wsum = 0.0;
  for (int q = -1; q <= 1; q++){
    float j = jn + float(q);
    float rb = R_IN + (j + 0.5) * BAND;
    float d = (r - rb) / (0.62 * BAND);
    float w = exp(-d * d);
    uint s = uint(int(j) + 64) * 2654435761u;
    float a = az + omega(max(rb, 2.0)) * uTime + rnd(s) * TAU;
    float n = 0.55 * pnoise(a, 5.0 + floor(rnd(s + 1u) * 4.0), s + 11u)
            + 0.30 * pnoise(a, 17.0, s + 23u)
            + 0.15 * pnoise(a, 43.0, s + 37u);
    float lane = 0.55 + 0.9 * rnd(s + 3u);
    acc += w * lane * (0.25 + 1.35 * smoothstep(0.28, 0.80, n));
    wsum += w;
  }
  /* A few long, narrow hot arcs. */
  knot = 0.0;
  for (int k = 0; k < 4; k++){
    float fk = float(k);
    float rk = 3.65 + fk * 1.65;
    float a = az + omega(rk) * uTime - fk * 1.9;
    float da = atan(sin(a), cos(a));
    float dr = (r - rk) / 0.38;
    knot += exp(-dr * dr - (da / 0.38) * (da / 0.38));
  }
  knot = min(knot, 1.0);
  return acc / max(wsum, 1e-3) + 0.85 * knot;
}

/* Emission and opacity where a ray pierces the disk.
   g = ν_obs/ν_emit for a circular-orbit emitter seen by a static camera:
   g = sqrt(1 - 3M/r) / (1 - Ω λ) / sqrt(1 - RS/r_cam), with λ the photon's
   angular momentum about the disk axis. It sets both colour and beaming. */
vec4 shadeDisk(vec3 p, float r, float lambdaY){
  float az = atan(p.z, p.x);
  float knot;
  float tex = diskTexture(r, az, knot);

  float edgeIn  = smoothstep(R_IN, R_IN + 1.2, r);
  float edgeOut = 1.0 - smoothstep(R_OUT - 3.5, R_OUT, r);
  float rim = exp(-((r - R_IN) / 1.3) * ((r - R_IN) / 1.3));
  float prof = edgeIn * edgeOut * (0.55 + 0.80 * pow(R_IN / r, 1.3) + 0.55 * rim);
  float dens = prof * (0.22 + 1.15 * tex);

  float g = sqrt(1.0 - 1.5 / r) / (1.0 + omega(r) * lambdaY) / uCamLapse;
  g = clamp(g, 0.15, 4.0);
  float T = 4700.0 * pow(R_IN / r, 0.78) * (1.0 + 0.3 * knot);
  vec3 col = blackbody(T * g);
  float beam = pow(g, uBeam);

  float alpha = clamp(dens * 0.26, 0.0, 0.85);
  return vec4(col * dens * beam * uDiskBright, alpha);
}

struct Hit { vec3 col; float trans; float esc; vec3 dir; float b; };

/* One camera ray: up to five disk-plane crossings, then the escape direction. */
Hit trace(vec2 uv){
  vec3 rd = normalize(uFwd + uTanHalf * (uv.x * uRight + uv.y * uUp));
  float c = dot(rd, uE1);
  vec3 perp = rd - uE1 * c;
  float pl = length(perp);
  vec3 e2 = pl > 1e-7 ? perp / pl : normalize(cross(uE1, vec3(0.0, 0.0, 1.0)));
  float b = uCamDist * pl / uCamLapse;   // conserved impact parameter

  bool cap = b < BC;
  float L = log(max(abs(b - BC), 1e-30));
  float fr = clamp((L - LMIN) / ((cap ? LMAX_CAP : LMAX_SCAT) - LMIN), 0.0, 1.0) * float(NSIDE - 1);
  fr = min(fr, float(NSIDE - 1) - 0.001);
  int row = (cap ? 0 : NSIDE) + int(fr);
  float fy = fract(fr);
  vec2 m0 = texelFetch(uMeta, ivec2(row, 0), 0).xy;
  vec2 m1 = texelFetch(uMeta, ivec2(row + 1, 0), 0).xy;
  float psiEnd = mix(m0.x, m1.x, fy);
  float psiCam = mix(m0.y, m1.y, fy);

  // Rays leaving the camera outward run the table backwards (captured
  // branch) or start on its outbound half (scattered branch).
  float dirSign = 1.0;
  if (c > 0.0){ if (cap) dirSign = -1.0; else psiCam = psiEnd - psiCam; }
  float esc = (cap && c <= 0.0) ? 0.0 : 1.0;
  float phiEsc = dirSign > 0.0 ? psiEnd - psiCam : psiCam;

  Hit h;
  h.b = b;
  h.esc = esc;
  h.dir = cos(phiEsc) * uE1 + sin(phiEsc) * e2;
  h.col = vec3(0.0);
  h.trans = 1.0;

  // The orbit plane meets the disk plane (y = 0) at fixed angles phi0 + kπ.
  float phi0 = mod(atan(e2.y, uE1.y) + 0.5 * PI, PI);
  float lambdaY = b * cross(uE1, e2).y;
  for (int k = 0; k < 5; k++){
    float phi = phi0 + float(k) * PI;
    float psi = psiCam + dirSign * phi;
    if (psi < 0.0 || psi > psiEnd) break;
    float x = clamp(psi / psiEnd, 0.0, 1.0) * NTM1;
    int ix = min(int(x), int(NTM1) - 1);
    float fx = x - float(ix);
    float u = mix(mix(texelFetch(uLut, ivec2(ix, row), 0).r,     texelFetch(uLut, ivec2(ix + 1, row), 0).r, fx),
                  mix(texelFetch(uLut, ivec2(ix, row + 1), 0).r, texelFetch(uLut, ivec2(ix + 1, row + 1), 0).r, fx), fy);
    float r = 1.0 / max(u, 1e-5);
    if (r > R_IN && r < R_OUT){
      vec3 p = r * (cos(phi) * uE1 + sin(phi) * e2);
      vec4 d = shadeDisk(p, r, lambdaY);
      h.col += h.trans * d.rgb;
      h.trans *= 1.0 - d.a;
      if (h.trans < 0.02) break;
    }
  }
  return h;
}

/* Stars on a cube-face grid, one candidate per cell. Each star is a tiny
   Gaussian in sky coordinates, convolved with the pixel's footprint mapped
   back through the lens (the screen-space Jacobian). Lensed stars therefore
   stretch into arcs, and demagnified regions fade to their mean brightness
   instead of sparkling. */
vec3 starLayer(vec2 uv, vec2 dux, vec2 duy, float face, float D, float density, float fluxScale, uint layer){
  vec2 g = uv * D;
  vec2 cell = floor(g);
  uint s = pcg(uint(int(cell.x) + 4096) + pcg(uint(int(cell.y) + 4096) + pcg(uint(face) * 4u + layer)));
  float meanFlux = density * fluxScale * 0.16;
  // Footprint size in cells (Frobenius norm: no cancellation when the lens
  // Jacobian explodes at the shadow edge).
  float spread = D * sqrt(0.5 * (dot(dux, dux) + dot(duy, duy)));
  if (!(spread < 0.6)) return vec3(meanFlux);
  float toMean = smoothstep(0.08, 0.6, spread);
  if (rnd(s) > density) return vec3(meanFlux * toMean);
  mat2 J = mat2(dux * D, duy * D);
  mat2 C = J * transpose(J) * 0.30 + mat2(0.0009, 0.0, 0.0, 0.0009);
  float detC = max(determinant(C), 0.0009 * 0.0009);
  vec2 pos = 0.15 + 0.7 * vec2(rnd(s + 1u), rnd(s + 2u));
  vec2 d = (g - cell) - pos;
  float e = dot(d, vec2(C[1][1] * d.x - C[1][0] * d.y, C[0][0] * d.y - C[0][1] * d.x)) / detC;
  float flux = fluxScale * (0.04 + pow(rnd(s + 3u), 7.0));
  float val = flux / (TAU * sqrt(detC)) * exp(-0.5 * clamp(e, 0.0, 60.0));
  vec3 tint = blackbody(mix(3200.0, 11000.0, pow(rnd(s + 4u), 1.6)));
  return mix(tint * val, vec3(meanFlux), toMean);
}

vec3 stars(vec3 d, vec3 dx, vec3 dy){
  vec3 a = abs(d), q, qx, qy;
  float face;
  if (a.x >= a.y && a.x >= a.z){ q = d.yzx; qx = dx.yzx; qy = dy.yzx; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z)        { q = d.zxy; qx = dx.zxy; qy = dy.zxy; face = d.y > 0.0 ? 2.0 : 3.0; }
  else                        { q = d.xyz; qx = dx.xyz; qy = dy.xyz; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 uv = q.xy / q.z;
  vec2 dux = (qx.xy * q.z - q.xy * qx.z) / (q.z * q.z);
  vec2 duy = (qy.xy * q.z - q.xy * qy.z) / (q.z * q.z);
  return starLayer(uv, dux, duy, face, 150.0, 0.55, 0.020, 0u)
       + starLayer(uv, dux, duy, face, 38.0, 0.45, 0.060, 1u);
}

void main(){
  float px = 2.0 / uRes.y;
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y - uOffset;

  Hit h = trace(uv);
  vec3 dirDx = dFdx(h.dir), dirDy = dFdy(h.dir);
  float bw = fwidth(h.b);

  vec3 col = h.col;
  float skyVis = h.trans * h.esc;
  if (skyVis > 0.004){   // skip the sky inside the shadow and behind thick disk
    vec3 sky = textureGrad(uSky, h.dir, dirDx, dirDy).rgb * 0.125 + stars(h.dir, dirDx, dirDy);
    col += skyVis * sky;
  }

  /* The shadow edge and the higher-order photon rings are far thinner than
     a pixel; supersample only the thin annulus where they live. */
  if (abs(h.b - BC) < max(0.05, 4.0 * bw)){
    vec2 o[4] = vec2[4](vec2(0.125, 0.375), vec2(-0.375, 0.125), vec2(-0.125, -0.375), vec2(0.375, -0.125));
    for (int i = 0; i < 4; i++){
      Hit s = trace(uv + o[i] * px);
      vec3 sk = textureLod(uSky, s.dir, 0.0).rgb * 0.125;
      col += s.col + s.trans * s.esc * sk;
    }
    col *= 0.2;
  }

  /* Faint warm glow on the critical curve: light that orbited the photon
     sphere several times, too thin to resolve individually. */
  float ringW = max(0.02, bw * 0.85);
  float ringD = (h.b - BC) / ringW;
  col += vec3(1.0, 0.80, 0.52) * exp(-ringD * ringD) * 0.28 * uDiskBright;

  // Half floats overflow above 65504; one Inf would smear through the bloom.
  fragColor = vec4(min(col, vec3(2000.0)) * uOutScale, 1.0);
}`;

  /* Nebula and galactic band, baked once into a small cube map: smooth
     content, so 256² per face is plenty and sampling it is one fetch. */
  const FS_SKY = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
uniform int uFace;
uniform float uSize;
${COMMON}
float fbm(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * vnoise3(p); n += a;
    p = p * 2.03 + vec3(17.1, 3.7, 9.3);
    a *= 0.5;
  }
  return s / n;
}
void main(){
  vec2 f = (gl_FragCoord.xy / uSize) * 2.0 - 1.0;
  vec3 d;
  if (uFace == 0) d = vec3(1.0, -f.y, -f.x);
  else if (uFace == 1) d = vec3(-1.0, -f.y, f.x);
  else if (uFace == 2) d = vec3(f.x, 1.0, f.y);
  else if (uFace == 3) d = vec3(f.x, -1.0, -f.y);
  else if (uFace == 4) d = vec3(f.x, -f.y, 1.0);
  else d = vec3(-f.x, -f.y, -1.0);
  d = normalize(d);

  vec3 ng = normalize(vec3(0.32, 1.0, -0.28));       // galactic pole
  vec3 gc = normalize(cross(ng, vec3(0.0, 0.0, 1.0))); // galactic centre
  float lat = dot(d, ng);
  float band = exp(-lat * lat / 0.045);
  float core = exp(-pow(1.0 - dot(d, gc), 2.0) * 3.0);

  float neb = fbm(d * 2.4 + 11.0, 4);
  float cloud = fbm(d * 5.3 - 3.0, 4);
  float dust = fbm(d * 9.0 + 5.0, 4);

  vec3 col = mix(vec3(0.010, 0.013, 0.030), vec3(0.030, 0.012, 0.028), neb);
  col *= 0.45 + 0.55 * cloud;
  float lanes = smoothstep(0.42, 0.68, dust);
  vec3 glow = mix(vec3(0.050, 0.045, 0.090), vec3(0.120, 0.080, 0.060), core);
  col += glow * band * (0.35 + 0.9 * cloud) * (1.0 - 0.75 * lanes);
  col += vec3(0.012, 0.010, 0.022) * smoothstep(0.55, 0.9, neb);
  fragColor = vec4(col * 8.0, 1.0);
}`;

  /* Bloom: 4-tap bilinear downsample chain, then 9-tap tent upsample. */
  const FS_DOWN = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;     // source texel size
uniform float uPrefilter;
uniform float uInScale;
vec3 pre(vec3 c){
  c *= uInScale;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - 0.12, 0.0);
  k = k * k / (k + 0.35);
  c *= k / max(l, 1e-4);
  return c / (1.0 + max(c.r, max(c.g, c.b)) * 0.25);   // tame fireflies
}
void main(){
  vec2 uv = gl_FragCoord.xy * 2.0 * uTexel;
  vec3 a = texture(uSrc, uv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uSrc, uv + uTexel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture(uSrc, uv + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture(uSrc, uv + uTexel * vec2( 1.0,  1.0)).rgb;
  if (uPrefilter > 0.5){ a = pre(a); b = pre(b); c = pre(c); d = pre(d); }
  fragColor = vec4((a + b + c + d) * 0.25, 1.0);
}`;

  const FS_UP = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uSrc;   // coarser level (already accumulated)
uniform sampler2D uBase;  // this level's downsample
uniform vec2 uTexel;      // coarser texel size
uniform vec2 uDst;        // this level's size
void main(){
  vec2 uv = gl_FragCoord.xy / uDst;
  vec3 s = texture(uSrc, uv).rgb * 4.0;
  s += (texture(uSrc, uv + uTexel * vec2(1.0, 0.0)).rgb + texture(uSrc, uv - uTexel * vec2(1.0, 0.0)).rgb
      + texture(uSrc, uv + uTexel * vec2(0.0, 1.0)).rgb + texture(uSrc, uv - uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  s += texture(uSrc, uv + uTexel).rgb + texture(uSrc, uv - uTexel).rgb
     + texture(uSrc, uv + uTexel * vec2(1.0, -1.0)).rgb + texture(uSrc, uv + uTexel * vec2(-1.0, 1.0)).rgb;
  fragColor = vec4(s / 16.0 + texture(uBase, uv).rgb, 1.0);
}`;

  const FS_COMPOSITE = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2  uRes;
uniform float uInScale;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uGrain;
uniform float uVignette;
${COMMON}
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 ca = c * r2 * 0.005;
  vec3 col;
  col.r = texture(uScene, uv + ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - ca).b;
  col *= uInScale;
  col += texture(uBloom, uv).rgb * uBloomStrength;

  col *= uExposure;
  col = aces(col);
  col *= mix(1.0, 1.0 - smoothstep(0.30, 1.15, length(c) * 1.5), uVignette);
  col = pow(col, vec3(1.0 / 2.2));
  /* Static grain doubles as dither against banding in the dark sky. */
  col += (rnd(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y))) - 0.5) * uGrain;
  fragColor = vec4(col, 1.0);
}`;

  /* ================================================================
   * GL resources (rebuilt after a lost context)
   * ================================================================ */
  let R = null; // all GL objects live here

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.error(gl.getShaderInfoLog(s));
      throw new Error("shader compile failed");
    }
    return s;
  }
  function program(fsSrc, names) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      console.error(gl.getProgramInfoLog(p));
      throw new Error("program link failed");
    }
    const u = {};
    for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  function makeTex(w, h, internal, format, type, filter, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeTarget(w, h) {
    const tex = makeTex(w, h, R.fmt.internal, gl.RGBA, R.fmt.type, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

  function setupGL() {
    R = { w: 0, h: 0, scene: null, down: [], up: [] };
    // HDR targets when float rendering is available; otherwise store the
    // scene scaled down in 8 bits and scale it back up when compositing.
    const floatOk = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    R.fmt = floatOk
      ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT, scale: 1.0 }
      : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, scale: 0.5 };
    if (floatOk) {
      // Some drivers expose the extension but refuse RGBA16F attachments.
      const probe = makeTex(4, 4, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probe, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        R.fmt = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, scale: 0.5 };
      }
      gl.deleteFramebuffer(fb); gl.deleteTexture(probe);
    }

    R.scene = program(FS_SCENE, ["uRes", "uOffset", "uTanHalf", "uE1", "uRight", "uUp", "uFwd", "uCamDist",
      "uCamLapse", "uTime", "uBeam", "uDiskBright", "uOutScale", "uLut", "uMeta", "uSky"]);
    R.dProg = program(FS_DOWN, ["uSrc", "uTexel", "uPrefilter", "uInScale"]);
    R.upP = program(FS_UP, ["uSrc", "uBase", "uTexel", "uDst"]);
    R.comp = program(FS_COMPOSITE, ["uScene", "uBloom", "uRes", "uInScale", "uExposure", "uBloomStrength", "uGrain", "uVignette"]);
    const sky = program(FS_SKY, ["uFace", "uSize"]);

    R.vao = gl.createVertexArray();
    gl.bindVertexArray(R.vao);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    R.lut = makeTex(NT, NROWS, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, table.lut);
    R.meta = makeTex(NROWS, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, meta);
    metaDist = -1;

    // Bake the sky cube map.
    const SKY = 256;
    R.sky = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, R.sky);
    for (let f = 0; f < 6; f++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, R.fmt.internal, SKY, SKY, 0, gl.RGBA, R.fmt.type, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, SKY, SKY);
    gl.useProgram(sky.p);
    gl.uniform1f(sky.u.uSize, SKY);
    for (let f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, R.sky, 0);
      gl.uniform1i(sky.u.uFace, f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(sky.p);
  }

  function allocTargets(w, h) {
    freeTarget(R.scene_t);
    R.down.forEach(freeTarget); R.up.forEach(freeTarget);
    R.scene_t = makeTarget(w, h);
    R.down = []; R.up = [];
    let lw = w, lh = h;
    for (let i = 0; i < 6; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      R.down.push(makeTarget(lw, lh));
      if (lw <= 8 || lh <= 8) break;
    }
    // Upsample targets for every level but the coarsest, which is used as is.
    for (let i = 0; i < R.down.length - 1; i++) R.up.push(makeTarget(R.down[i].w, R.down[i].h));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    R.w = w; R.h = h;
  }

  try { setupGL(); } catch (e) { console.error(e); showFallback(); return; }

  /* ================================================================
   * Camera state + interaction
   * ================================================================ */
  const PRESET = { az: 0.55, el: 0.16, dist: 11.5, offX: 0.52, offY: 0.22 };
  const state = {
    az: PRESET.az, el: PRESET.el, dist: PRESET.dist,
    tAz: PRESET.az, tEl: PRESET.el, tDist: PRESET.dist,
    offX: PRESET.offX, offY: PRESET.offY, tOffX: PRESET.offX, tOffY: PRESET.offY,
    dragging: false, panning: false, px: 0, py: 0, lastInput: performance.now()
  };
  const MIN_DIST = 9.0, MAX_DIST = 26.0;
  let immersive = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionPaused = reducedMotion.matches;
  let simulationTime = 0;
  let heroVisible = true;
  let contextLost = false;
  let frameId = 0;
  let last = performance.now();
  let lastRender = 0;
  let cssW = 1, cssH = 1;

  function requestFrame() {
    if (frameId || document.hidden || !heroVisible || contextLost) return;
    if (!lastRender) last = performance.now();
    frameId = requestAnimationFrame(frame);
  }
  function stopFrame() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastRender = 0;
  }
  function setFraming() {
    // CSS positions the title; the camera uses the same anchor, including
    // mobile media queries and any difference between svh and canvas height.
    const layout = window.getComputedStyle(hero);
    const heroRect = hero.getBoundingClientRect();
    const x = (parseFloat(layout.getPropertyValue("--hero-x")) || 76) / 100;
    const y = (parseFloat(layout.getPropertyValue("--hero-y")) || 39) / 100;
    state.tOffX = immersive ? 0.0 : 2 * x * heroRect.width / cssW - 1;
    state.tOffY = immersive ? 0.0 : 1 - 2 * y * heroRect.height / cssH;
    state.tDist = immersive ? 16.0 : parseFloat(layout.getPropertyValue("--hero-distance")) || PRESET.dist;
    requestFrame();
  }
  const onUI = (e) => e.target && e.target.closest && e.target.closest("#ui, #site-nav, .site-search-dialog");

  /* Pointer input: one pointer orbits (or pans with shift / right button),
     two touch pointers pinch to zoom. */
  const pointers = new Map();
  let pinchDist = 0;
  function pinchSpan() {
    const p = [...pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  function touched() { state.lastInput = performance.now(); requestFrame(); }

  window.addEventListener("pointerdown", (e) => {
    if (!immersive || onUI(e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { pinchDist = pinchSpan(); state.dragging = false; }
    else if (pointers.size === 1) {
      state.dragging = true;
      state.panning = (e.button === 2) || e.shiftKey;
      state.px = e.clientX; state.py = e.clientY;
    }
    touched();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  window.addEventListener("pointermove", (e) => {
    if (!immersive || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const span = pinchSpan();
      if (pinchDist > 0 && span > 0) {
        state.tDist = Math.max(MIN_DIST, Math.min(MAX_DIST, state.tDist * pinchDist / span));
      }
      pinchDist = span;
      touched();
      return;
    }
    if (!state.dragging) return;
    const dx = e.clientX - state.px, dy = e.clientY - state.py;
    state.px = e.clientX; state.py = e.clientY;
    if (state.panning) {
      state.tOffX = Math.max(-2.4, Math.min(2.4, state.tOffX + dx * 0.0016));
      state.tOffY = Math.max(-1.4, Math.min(1.4, state.tOffY - dy * 0.0016));
    } else {
      state.tAz -= dx * 0.005;
      state.tEl = Math.max(-1.35, Math.min(1.35, state.tEl + dy * 0.004));
    }
    touched();
  });
  const endDrag = (e) => {
    if (e && e.pointerId !== undefined) pointers.delete(e.pointerId); else pointers.clear();
    pinchDist = 0;
    state.dragging = false; state.panning = false;
    if (e && pointers.size === 1) {
      // Lifting one finger of a pinch continues as an orbit, without a jump.
      const p = [...pointers.values()][0];
      state.dragging = true; state.px = p.x; state.py = p.y;
    }
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("wheel", (e) => {
    if (!immersive || onUI(e)) return;
    e.preventDefault();
    state.tDist = Math.max(MIN_DIST, Math.min(MAX_DIST, state.tDist * Math.exp(e.deltaY * 0.0011)));
    touched();
  }, { passive: false });
  window.addEventListener("contextmenu", (e) => { if (immersive) e.preventDefault(); });

  /* ================================================================
   * Adaptive resolution
   * Render at up to 2x device pixels, within a pixel budget that adapts to
   * the measured frame rate. Ceilings remember levels that proved too slow,
   * so the resolution settles instead of oscillating.
   * ================================================================ */
  const DPR_CAP = Math.min(window.devicePixelRatio || 1, 2);
  const MIN_BUDGET = 0.25e6;
  let budget = 1.3e6;       // render pixels; starts modest, grows if the GPU keeps up
  let ceiling = Infinity;
  let ceilingSince = 0;
  let renderScale = 1;
  let winFrames = 0, winTime = 0, fastWindows = 0, skipWindow = true;

  function targetSize() {
    const maxPx = cssW * cssH * DPR_CAP * DPR_CAP;
    const px = Math.max(MIN_BUDGET, Math.min(budget, maxPx));
    const s = Math.sqrt(px / (cssW * cssH));
    return [Math.max(2, Math.round(cssW * s)), Math.max(2, Math.round(cssH * s))];
  }
  function resize(force) {
    const [w, h] = targetSize();
    // Ignore changes under ~4% so small budget tweaks don't reallocate.
    if (!force && R.w && Math.abs(w - R.w) / R.w < 0.04 && Math.abs(h - R.h) / R.h < 0.04 &&
        canvas.width === R.w) return;
    if (w === R.w && h === R.h && !force) return;
    canvas.width = w; canvas.height = h;
    allocTargets(w, h);
    renderScale = w / cssW;
  }
  function adapt(interval, now) {
    // Intervals only span consecutive rendered frames (pauses reset the
    // clock), so long ones are real slowness. Slow devices close a window
    // after ~1.5 s instead of waiting for 24 frames.
    winFrames++; winTime += Math.min(interval, 1000);
    if (winFrames < 24 && !(winFrames >= 3 && winTime > 1500)) return;
    const avg = winTime / winFrames;
    winFrames = 0; winTime = 0;
    if (skipWindow) { skipWindow = false; return; }
    if (now - ceilingSince > 30000) ceiling = Infinity; // retry occasionally
    if (avg > 24) {
      ceiling = budget * 0.92; ceilingSince = now;
      budget = Math.max(MIN_BUDGET, budget * (avg > 40 ? 0.6 : 0.78));
      fastWindows = 0;
    } else if (avg < 18.5) {
      if (++fastWindows >= 2 && budget * 1.2 < ceiling) {
        budget *= 1.2;
        fastWindows = 0;
      }
    } else {
      fastWindows = 0;
    }
  }

  function measure() {
    const r = canvas.getBoundingClientRect();
    cssW = r.width || window.innerWidth;
    cssH = r.height || window.innerHeight;
    if (!contextLost) resize(true);
    if (!immersive) setFraming();
    requestFrame();
  }
  window.addEventListener("resize", measure);
  measure();

  /* ================================================================
   * UI wiring
   * ================================================================ */
  function updateMotion() {
    motionBtn.innerHTML = motionPaused ? "&#9654; PLAY" : "&#10074;&#10074; PAUSE";
    motionBtn.setAttribute("aria-label", motionPaused ? "Play black hole animation" : "Pause black hole animation");
    requestFrame();
  }
  motionBtn.addEventListener("click", () => { motionPaused = !motionPaused; updateMotion(); });
  reducedMotion.addEventListener("change", () => { motionPaused = reducedMotion.matches; updateMotion(); });
  updateMotion();
  setTimeout(() => { if (!immersive) hint.classList.add("dim"); }, 8000);

  const onScroll = () => document.body.classList.toggle("scrolled", window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  window.addEventListener("load", () => {
    if (!location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) setTimeout(() => el.scrollIntoView(), 60);
  });

  const coarse = window.matchMedia("(pointer: coarse)");
  function setImmersive(on) {
    immersive = on;
    document.body.classList.toggle("immersive", on);
    if (on) window.scrollTo(0, 0);
    admireBtn.innerHTML = on ? "&#10005; EXIT" : "&#9673; ADMIRE";
    admireBtn.setAttribute("aria-pressed", String(on));
    document.dispatchEvent(new CustomEvent("admirechange", { detail: { active: on } }));
    state.tAz = PRESET.az; state.tEl = PRESET.el;
    endDrag();
    setFraming();
    state.lastInput = on ? performance.now() : 0;
    hint.textContent = !on ? "CLICK ◉ ADMIRE TO EXPLORE"
      : coarse.matches ? "[ DRAG ORBIT · PINCH ZOOM ]"
      : "[ DRAG ORBIT · SHIFT/RIGHT-DRAG PAN · SCROLL ZOOM · ESC EXIT ]";
    hint.classList.remove("dim");
    setTimeout(() => { if (!immersive) hint.classList.add("dim"); }, 5000);
  }
  admireBtn.addEventListener("click", () => setImmersive(!immersive));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && immersive) { setImmersive(false); admireBtn.focus(); }
  });

  // Stop rendering when the hero is covered or the tab is hidden.
  const heroObserver = new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    if (heroVisible) { skipWindow = true; requestFrame(); } else stopFrame();
  });
  heroObserver.observe(hero);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopFrame(); else { skipWindow = true; requestFrame(); }
  });

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    stopFrame();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try { setupGL(); } catch (err) { console.error(err); showFallback(); return; }
    contextLost = false;
    resize(true);
    requestFrame();
  });

  setFraming();
  state.offX = state.tOffX; state.offY = state.tOffY; state.dist = state.tDist;

  /* ================================================================
   * Render loop
   * ================================================================ */
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function draw(target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bindTex(unit, tex, kind) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(kind || gl.TEXTURE_2D, tex);
  }

  function render() {
    resize(false);
    const W = R.w, H = R.h;

    if (Math.abs(state.dist - metaDist) > 1e-5) {
      updateCameraRows(state.dist);
      gl.bindTexture(gl.TEXTURE_2D, R.meta);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NROWS, 1, gl.RGBA, gl.FLOAT, meta);
    }

    // Camera basis on the CPU instead of per pixel.
    const ce = Math.cos(state.el), se = Math.sin(state.el);
    const e1 = [ce * Math.sin(state.az), se, ce * Math.cos(state.az)];
    const fwd = [-e1[0], -e1[1], -e1[2]];
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const portraitScale = Math.max(1.0, cssH / cssW * 0.8);
    const tanHalf = Math.tan(23.5 * Math.PI / 360) * portraitScale;

    /* scene */
    const S = R.scene;
    gl.useProgram(S.p);
    gl.uniform2f(S.u.uRes, W, H);
    gl.uniform2f(S.u.uOffset, state.offX * (W / H), state.offY);
    gl.uniform1f(S.u.uTanHalf, tanHalf);
    gl.uniform3fv(S.u.uE1, e1);
    gl.uniform3fv(S.u.uRight, right);
    gl.uniform3fv(S.u.uUp, up);
    gl.uniform3fv(S.u.uFwd, fwd);
    gl.uniform1f(S.u.uCamDist, state.dist);
    gl.uniform1f(S.u.uCamLapse, Math.sqrt(1 - 1 / state.dist));
    gl.uniform1f(S.u.uTime, simulationTime * 3.6);
    gl.uniform1f(S.u.uBeam, 2.4);
    gl.uniform1f(S.u.uDiskBright, 1.05);
    gl.uniform1f(S.u.uOutScale, R.fmt.scale);
    bindTex(0, R.lut); gl.uniform1i(S.u.uLut, 0);
    bindTex(1, R.meta); gl.uniform1i(S.u.uMeta, 1);
    bindTex(2, R.sky, gl.TEXTURE_CUBE_MAP); gl.uniform1i(S.u.uSky, 2);
    draw(R.scene_t, W, H);

    /* bloom chain */
    const D = R.down;
    gl.useProgram(R.dProg.p);
    let src = R.scene_t;
    for (let i = 0; i < D.length; i++) {
      bindTex(0, src.tex);
      gl.uniform1i(R.dProg.u.uSrc, 0);
      gl.uniform2f(R.dProg.u.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform1f(R.dProg.u.uPrefilter, i === 0 ? 1 : 0);
      gl.uniform1f(R.dProg.u.uInScale, 1 / R.fmt.scale);
      draw(D[i], D[i].w, D[i].h);
      src = D[i];
    }
    gl.useProgram(R.upP.p);
    let coarser = D[D.length - 1];
    for (let i = D.length - 2; i >= 0; i--) {
      bindTex(0, coarser.tex); gl.uniform1i(R.upP.u.uSrc, 0);
      bindTex(1, D[i].tex); gl.uniform1i(R.upP.u.uBase, 1);
      gl.uniform2f(R.upP.u.uTexel, 1 / coarser.w, 1 / coarser.h);
      gl.uniform2f(R.upP.u.uDst, R.up[i].w, R.up[i].h);
      draw(R.up[i], R.up[i].w, R.up[i].h);
      coarser = R.up[i];
    }

    /* composite */
    const C = R.comp;
    gl.useProgram(C.p);
    bindTex(0, R.scene_t.tex); gl.uniform1i(C.u.uScene, 0);
    bindTex(1, coarser.tex); gl.uniform1i(C.u.uBloom, 1);
    gl.uniform2f(C.u.uRes, W, H);
    gl.uniform1f(C.u.uInScale, 1 / R.fmt.scale);
    gl.uniform1f(C.u.uExposure, 0.8);
    gl.uniform1f(C.u.uBloomStrength, 0.55 / D.length);
    gl.uniform1f(C.u.uGrain, 0.016);
    gl.uniform1f(C.u.uVignette, 0.85);
    draw(null, W, H);
  }

  function frame(now) {
    frameId = 0;
    const animating = !motionPaused;
    // Cap at ~60 fps on high-refresh displays: a background hero does not
    // need 120-144 Hz, and it halves the power draw there.
    if (lastRender && now - lastRender < 12.5) { frameId = requestAnimationFrame(frame); return; }
    const interval = lastRender ? now - lastRender : 16.7;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
    last = now;
    if (animating) simulationTime += dt;

    /* idle auto-orbit keeps the rim alive */
    if (immersive && animating && !state.dragging && now - state.lastInput > 2500) {
      state.tAz += dt * 0.03;
    }
    const k = Math.min(1, dt * 6);
    state.az += (state.tAz - state.az) * k;
    state.el += (state.tEl - state.el) * k;
    state.dist += (state.tDist - state.dist) * k;
    state.offX += (state.tOffX - state.offX) * k;
    state.offY += (state.tOffY - state.offY) * k;

    const settling = Math.abs(state.tAz - state.az) + Math.abs(state.tEl - state.el)
                   + Math.abs(state.tDist - state.dist) + Math.abs(state.tOffX - state.offX)
                   + Math.abs(state.tOffY - state.offY) > 0.001;
    if ((animating || settling) && lastRender) adapt(interval, now);
    lastRender = now;

    render();

    if ((animating || settling) && heroVisible && !document.hidden) {
      frameId = requestAnimationFrame(frame);
    } else {
      lastRender = 0; // the next frame after a pause starts a fresh interval
    }
  }
  last = performance.now();
  requestFrame();
})();
