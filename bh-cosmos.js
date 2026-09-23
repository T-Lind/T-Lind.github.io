/* Interactive procedural astronomical objects.
   Usage: <canvas data-cosmos="star|wormhole|neutron|quasar" aria-hidden="true"></canvas>
   Objects glow toward the cursor and react to clicks; all fade out before the
   canvas edge so there is never a visible square boundary.
   Falls back to a CSS gradient if WebGL is unavailable. */
(function () {
    "use strict";

    var COMMON = [
        "precision highp float;",
        "uniform vec2 uRes;",
        "uniform float uTime;",
        "uniform vec2 uMouse;",
        "uniform vec2 uClickPos;",
        "uniform float uClickTime;",
        "float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }",
        "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
        "  float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));",
        "  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }",
        "float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }",
        "float clickPulse(){ return uClickTime>0.0 ? exp(-max(0.0,uTime-uClickTime)*2.2) : 0.0; }",
        "float clickAge(){ return uClickTime>0.0 ? max(0.0,uTime-uClickTime) : 100.0; }",
        "float tonemap(float x){ return x/(1.0+x*0.28); }"
    ].join("\n");

    var STAR = COMMON + [
        "void main(){",
        "  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/min(uRes.x,uRes.y);",
        "  float r=length(uv), ang=atan(uv.y,uv.x), R=0.55;",
        "  float g1=fbm(uv*6.0+vec2(uTime*0.05,uTime*0.03));",
        "  float g2=fbm(uv*15.0-vec2(uTime*0.09,0.0));",
        "  float gran=0.55+0.55*g1+0.28*g2;",
        "  float mu=sqrt(max(0.0,1.0-pow(min(r/R,1.0),2.0)));",
        "  vec3 core=mix(vec3(1.0,0.42,0.08),vec3(1.0,0.98,0.92),pow(mu,0.7));",
        "  vec3 surf=core*gran*(0.32+0.72*mu)*(1.0-0.5*smoothstep(0.66,0.98,fbm(uv*3.0+21.0)));",
        "  float rim=exp(-pow((r-R)/0.016,2.0));",
        "  vec3 rimCol=vec3(1.0,0.78,0.45)*(1.2+0.6*fbm(vec2(cos(ang),sin(ang))*8.0+uTime*0.3));",
        "  float d=max(r-R,0.0), glow=exp(-d*5.0);",
        "  float rayN=fbm(vec2(cos(ang),sin(ang))*2.5+uTime*0.08);",
        "  float rays=pow(max(0.0,sin(ang*12.0+rayN*7.0)),8.0)*exp(-d*4.0);",
        "  float flare=pow(max(0.0,sin(ang*3.0+1.3)),4.0)*exp(-d*2.4);",
        "  vec3 tint=mix(vec3(1.0,0.55,0.18),vec3(1.0,0.9,0.7),rayN);",
        "  float inside=step(r,R);",
        "  vec3 col=surf*inside; float alpha=inside;",
        "  col+=rimCol*rim*1.1; alpha+=rim*1.1;",
        "  col+=tint*(glow*(0.7+0.5*rayN)+rays*0.9+flare*0.55);",
        "  alpha+=clamp(glow*(0.75+0.5*rayN)+rays*0.8+flare*0.5,0.0,1.0);",
        "  float halo=exp(-d*1.6)*0.35; col+=vec3(1.0,0.6,0.25)*halo; alpha+=halo;",
        "  float mInf=exp(-length(uv-uMouse)*2.6);",
        "  col+=vec3(1.0,0.85,0.55)*mInf*0.5; alpha+=mInf*0.32;",
        "  float ct=clickAge(), pulse=clickPulse(), cd=length(uv-uClickPos);",
        "  float ring=exp(-pow((cd-ct*0.7)/0.05,2.0))*pulse;",
        "  float cc=exp(-cd*12.0)*pulse;",
        "  col+=vec3(1.0,0.9,0.7)*(ring*1.6+cc*2.0); alpha+=clamp(ring+cc,0.0,1.0);",
        "  float edge=smoothstep(1.0,0.88,r); col*=edge; alpha*=edge;",
        "  col=vec3(tonemap(col.r),tonemap(col.g),tonemap(col.b));",
        "  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0));",
        "}"
    ].join("\n");

    var WORMHOLE = COMMON + [
        "float starField(vec3 d){",
        "  vec2 s=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.0,1.0)));",
        "  float n=noise(s*46.0);",
        "  float star=smoothstep(0.83,0.995,n);",
        "  star+=0.5*smoothstep(0.90,1.0,noise(s*95.0+7.0));",
        "  return star;",
        "}",
        "void main(){",
        "  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/min(uRes.x,uRes.y);",
        "  float r=length(uv), ang=atan(uv.y,uv.x);",
        "  float mouth=0.62;",
        "  float rr=clamp(r/mouth,0.0,1.0);",
        "  float warp=pow(rr,3.0);",
        "  float sw=ang+warp*2.6+uMouse.x*0.25;",
        "  vec2 q=vec2(cos(sw),sin(sw))*rr;",
        "  float z=sqrt(max(0.0,1.0-rr*rr));",
        "  vec3 ndir=normalize(vec3(q,z));",
        "  ndir.xy+=uMouse*0.05;",
        "  vec3 sky=vec3(0.015,0.02,0.045);",
        "  sky+=vec3(0.15,0.2,0.42)*fbm(ndir.xy*2.2+ndir.z*1.5+uTime*0.02)*0.6;",
        "  sky+=vec3(0.95,0.97,1.0)*starField(ndir)*1.7;",
        "  vec3 pd=normalize(vec3(0.55,-0.22,0.76));",
        "  float pa=acos(clamp(dot(ndir,pd),-1.0,1.0));",
        "  float planet=smoothstep(0.17,0.165,pa);",
        "  vec3 lightDir=normalize(vec3(0.55,0.75,0.35));",
        "  float lam=clamp(dot(ndir,lightDir),0.0,1.0);",
        "  vec3 planetCol=mix(vec3(0.05,0.07,0.13),vec3(0.55,0.72,0.98),pow(lam,0.7));",
        "  planetCol+=vec3(0.3,0.5,0.9)*smoothstep(0.16,0.17,pa)*0.4;",
        "  sky=mix(sky,planetCol,planet*0.97);",
        "  float inside=smoothstep(mouth,mouth-0.012,r);",
        "  vec3 col=sky*inside; float alpha=inside;",
        "  float ring=exp(-pow((r-mouth)/0.05,2.0));",
        "  float dust=0.55+0.6*fbm(vec2(ang*3.0,r*10.0-uTime*0.6));",
        "  vec3 ringCol=mix(vec3(0.3,0.6,1.0),vec3(1.0,0.75,0.4),dust);",
        "  col+=ringCol*ring*dust*1.3; alpha+=clamp(ring*dust*1.3,0.0,1.0);",
        "  float glow=exp(-max(r-mouth,0.0)*4.0)*0.45;",
        "  col+=vec3(0.4,0.6,1.0)*glow; alpha+=glow;",
        "  float ct=clickAge(), pulse=clickPulse();",
        "  float cd=length(uv-uClickPos);",
        "  float wring=exp(-pow((cd-(1.1-ct*0.8))/0.06,2.0))*pulse;",
        "  col+=vec3(0.8,0.95,1.0)*wring*1.7; alpha+=clamp(wring,0.0,1.0);",
        "  float mInf=exp(-length(uv-uMouse)*2.0);",
        "  col+=vec3(0.5,0.8,1.0)*mInf*0.25; alpha+=mInf*0.25;",
        "  float edge=smoothstep(1.0,0.78,r); col*=edge; alpha*=edge;",
        "  col=vec3(tonemap(col.r),tonemap(col.g),tonemap(col.b));",
        "  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0));",
        "}"
    ].join("\n");

    var NEUTRON = COMMON + [
        "void main(){",
        "  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/min(uRes.x,uRes.y);",
        "  float rl=length(uv);",
        "  float tilt=0.7*sin(uMouse.x*1.3);",
        "  vec2 ax=vec2(sin(tilt),cos(tilt));",
        "  float a=dot(uv,ax);",
        "  vec2 pv=uv-a*ax; float perp=length(pv);",
        "  float R=0.10;",
        "  float spin=uTime*2.0+uMouse.x*1.4;",
        "  vec2 beam=vec2(cos(spin),sin(spin));",
        "  float sweep=pow(max(0.0,dot(normalize(pv+1e-5),beam)),6.0);",
        "  float cone=0.03+0.14*abs(a);",
        "  float jet=exp(-pow(perp/cone,2.0))*smoothstep(R,R+0.05,abs(a))*(1.0-smoothstep(0.9,1.15,abs(a)));",
        "  float pulse=clickPulse();",
        "  jet*=1.0+pulse*2.5;",
        "  vec3 jetCol=mix(vec3(0.35,0.75,1.0),vec3(0.8,0.95,1.0),sweep);",
        "  vec3 col=jetCol*jet*1.6;",
        "  float body=smoothstep(R,R-0.015,rl);",
        "  col+=vec3(0.85,0.92,1.0)*(0.7+0.6*body)*body;",
        "  float bloom=exp(-rl*9.0);",
        "  col+=vec3(0.6,0.85,1.0)*bloom*1.6;",
        "  float eq=exp(-pow(a/0.03,2.0))*exp(-pow((perp-0.28)/0.05,2.0));",
        "  col+=vec3(0.4,0.7,1.0)*eq*0.8;",
        "  col+=vec3(0.55,0.85,1.0)*sweep*exp(-rl*4.0)*(0.6+pulse*1.5);",
        "  float mInf=exp(-length(uv-uMouse)*2.4);",
        "  col+=vec3(0.6,0.85,1.0)*mInf*0.35;",
        "  float ct=clickAge(); float cd=length(uv-uClickPos);",
        "  float ring=exp(-pow((cd-ct*0.8)/0.05,2.0))*pulse;",
        "  col+=vec3(0.8,0.95,1.0)*ring*1.4;",
        "  float edge=smoothstep(1.0,0.72,rl); col*=edge;",
        "  col=vec3(tonemap(col.r),tonemap(col.g),tonemap(col.b));",
        "  float alpha=clamp(body+jet+bloom+mInf*0.35+ring,0.0,1.0)*edge;",
        "  gl_FragColor=vec4(col,alpha);",
        "}"
    ].join("\n");

    var QUASAR = COMMON + [
        "void main(){",
        "  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/min(uRes.x,uRes.y);",
        "  float r=length(uv);",
        "  float tilt=0.42;",
        "  float ca=cos(tilt), sa=sin(tilt);",
        "  vec2 q=vec2(ca*uv.x-sa*uv.y, sa*uv.x+ca*uv.y);",
        "  float disk=exp(-pow(abs(q.y)/0.05,2.0))*exp(-pow(abs(q.x)/0.6,2.0))*smoothstep(0.06,0.11,length(q));",
        "  vec3 diskCol=mix(vec3(1.0,0.55,0.15),vec3(1.0,0.96,0.85),1.0-smoothstep(0.0,0.55,abs(q.x)));",
        "  vec3 col=diskCol*disk*1.8;",
        "  float jet=exp(-pow(abs(uv.x)/0.035,2.0))*smoothstep(0.1,0.18,abs(uv.y))*(1.0-smoothstep(0.8,1.05,abs(uv.y)));",
        "  col+=mix(vec3(0.45,0.75,1.0),vec3(0.9,0.95,1.0),clickPulse())*jet*1.3;",
        "  float core=exp(-r*14.0);",
        "  col+=vec3(1.0,0.98,0.92)*core*(2.0+clickPulse()*3.0);",
        "  float halo=exp(-r*2.4)*0.35; col+=vec3(1.0,0.7,0.4)*halo;",
        "  float mInf=exp(-length(uv-uMouse)*2.2);",
        "  col+=vec3(1.0,0.85,0.6)*mInf*0.3;",
        "  float ct=clickAge(), pulse=clickPulse(); float cd=length(uv-uClickPos);",
        "  float ring=exp(-pow((cd-ct*0.8)/0.05,2.0))*pulse;",
        "  col+=vec3(1.0,0.9,0.7)*ring*1.4;",
        "  float edge=smoothstep(1.0,0.72,r); col*=edge;",
        "  col=vec3(tonemap(col.r),tonemap(col.g),tonemap(col.b));",
        "  float alpha=clamp(core+disk+jet+halo+mInf*0.25+ring,0.0,1.0)*edge;",
        "  gl_FragColor=vec4(col,alpha);",
        "}"
    ].join("\n");

    var FRAGS = { star: STAR, wormhole: WORMHOLE, neutron: NEUTRON, quasar: QUASAR };
    var FALLBACK = {
        star: "radial-gradient(circle at 50% 50%, #fff 0%, #ffe6ad 16%, #ffb347 30%, rgba(255,140,50,.5) 46%, transparent 70%)",
        wormhole: "radial-gradient(circle at 50% 50%, #0b1230 0%, #16306e 40%, #3f7bd6 62%, #ffb066 74%, transparent 86%)",
        neutron: "radial-gradient(circle at 50% 50%, #fff 0%, #cfe8ff 18%, #5aa0ff 42%, transparent 68%)",
        quasar: "radial-gradient(circle at 50% 50%, #fff 0%, #ffe1b0 14%, #ff8a2a 38%, rgba(80,120,255,.3) 60%, transparent 74%)"
    };

    var VS = "attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }";

    function compile(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
        return s;
    }

    function initCanvas(canvas) {
        var kind = canvas.getAttribute("data-cosmos");
        if (!FRAGS[kind]) return;
        var gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true, depth: false })
              || canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
        if (!gl) {
            canvas.style.background = FALLBACK[kind];
            canvas.style.filter = "blur(2px) drop-shadow(0 0 60px rgba(120,160,255,.5))";
            canvas.style.borderRadius = "50%";
            return;
        }
        var vs = compile(gl, gl.VERTEX_SHADER, VS);
        var fs = compile(gl, gl.FRAGMENT_SHADER, FRAGS[kind]);
        if (!vs || !fs) return;
        var prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
        gl.useProgram(prog);

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        var U = function (n) { return gl.getUniformLocation(prog, n); };
        var uRes = U("uRes"), uTime = U("uTime"), uMouse = U("uMouse"), uClickPos = U("uClickPos"), uClickTime = U("uClickTime");

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        var state = { mx: 0, my: 0, cx: 0, cy: 0, ct: 0 };
        function toUV(clientX, clientY) {
            var rect = canvas.getBoundingClientRect();
            var w = Math.min(rect.width, rect.height) || 1;
            return [(clientX - (rect.left + rect.width / 2)) / (w / 2),
                    ((rect.top + rect.height / 2) - clientY) / (w / 2)];
        }
        window.addEventListener("pointermove", function (e) {
            var v = toUV(e.clientX, e.clientY); state.mx = v[0]; state.my = v[1];
        }, { passive: true });
        function resize() {
            var s = Math.min(canvas.clientWidth, canvas.clientHeight) || 420;
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            var w = Math.max(2, Math.floor(s * dpr));
            if (canvas.width !== w) { canvas.width = w; canvas.height = w; gl.viewport(0, 0, w, w); }
        }
        window.addEventListener("resize", resize);
        resize();

        function frame(now) {
            if (canvas.clientWidth > 0) {
                resize();
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.uniform2f(uRes, canvas.width, canvas.height);
                gl.uniform1f(uTime, now / 1000);
                gl.uniform2f(uMouse, state.mx, state.my);
                gl.uniform2f(uClickPos, state.cx, state.cy);
                gl.uniform1f(uClickTime, state.ct);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    var nodes = document.querySelectorAll("canvas[data-cosmos]");
    for (var i = 0; i < nodes.length; i++) initCanvas(nodes[i]);
})();
