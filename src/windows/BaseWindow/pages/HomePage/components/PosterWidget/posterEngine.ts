import {
  POSTER_H,
  POSTER_W,
  TEX_RATIO,
  drawPosterBack,
  drawPosterFront,
  toPOTCanvas,
  type PosterColors,
} from "./posterArtwork";

/**
 * 海报柔性卷曲渲染引擎（原生 WebGL1，零依赖）。
 *
 * 视觉方案：
 *  - 平面网格顶点着色器做圆柱面卷绕（主卷 R + 反向副卷 R2 落回纸面模拟纸厚），
 *    折线为 45° 对角切右上角，reach 恒定
 *  - 舒展动画 = 卷角 θ 从 θmax → 0（R 反解保持 reach 不变），CPU 半隐式弹簧驱动，
 *    rAF 仅在动画期间运行、静止即停
 *  - 片元：逐顶点法线 Lambert + Blinn-Phong、gl_FrontFacing 区分纸背、
 *    折线接触阴影随卷曲淡出、SDF 圆角盒 + 值噪声毛边、整纸微拱、纸张颗粒
 *
 * 引擎不依赖 React；挂载方负责传入 canvas 与主题色板，主题切换调 setColors 重绘贴图。
 */

/** 手感参数（契约：单测锁定，防止被无声改动导致手感漂移） */
export const POSTER_TUNING = {
  /** 静置最大卷角（弧度） */
  thetaMax: 2.1,
  /** 纸瓣厚度（副卷落回纸面的高度，px） */
  zFlap: 2.2,
  /** 主折线截距：x - y = foldK（切右上角） */
  foldK: 60,
  /** 整纸微拱幅度（px） */
  bow: 2.2,
  /** 弹簧刚度 */
  springK: 110,
  /** 弹簧阻尼比（<1 欠阻尼，带一点回弹） */
  springDampRatio: 0.92,
} as const;

export interface PosterEngine {
  /** 主题切换：重绘正/背贴图并重新上传 */
  setColors(colors: PosterColors): void;
  /** 悬停舒展 */
  unfold(): void;
  /** 离开回卷 */
  fold(): void;
  /** 释放全部 GL 资源 / 事件 / 动画 */
  dispose(): void;
}

function getGL(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const opts: WebGLContextAttributes = {
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
  };
  try {
    return canvas.getContext("webgl", opts);
  } catch {
    return null;
  }
}

const VS = [
  "attribute vec2 aPos;",
  "uniform vec2 uSize;",
  "uniform float uTexRatio;",
  "uniform vec2 uDirN;",
  "uniform vec2 uDirT;",
  "uniform vec2 uFoldO;",
  "uniform float uR;",
  "uniform float uR2;",
  "uniform float uS1;",
  "uniform float uS2;",
  "uniform float uTheta1;",
  "uniform float uFlat;",
  "uniform float uBow;",
  "varying vec2 vUv;",
  "varying vec2 vLocal;",
  "varying vec3 vN;",
  "varying float vS;",
  "void main(){",
  "  vec2 rel = aPos - uFoldO;",
  "  float s = dot(rel, uDirN);",
  "  float t = dot(rel, uDirT);",
  "  float a; float z; float th;",
  "  if (uFlat > 0.5 || s <= 0.0){ a = s; z = 0.0; th = 0.0; }",
  "  else if (s < uS1){",
  "    th = s / uR;",
  "    a = uR * sin(th);",
  "    z = uR * (1.0 - cos(th));",
  "  } else {",
  "    float th2 = uTheta1 + min(s - uS1, uS2) / uR2;",
  "    th = th2;",
  "    a = uR * sin(uTheta1) + uR2 * (sin(th2) - sin(uTheta1));",
  "    z = uR * (1.0 - cos(uTheta1)) + uR2 * (cos(th2) - cos(uTheta1));",
  "  }",
  "  vec3 pos = vec3(uFoldO + uDirN * a + uDirT * t, z);",
  "  vec3 N = vec3(-sin(th) * uDirN, cos(th));",
  "  float bow = uBow * sin(3.14159265 * aPos.x / uSize.x);",
  "  float dbow = uBow * 3.14159265 / uSize.x * cos(3.14159265 * aPos.x / uSize.x);",
  "  pos.z += bow;",
  "  N = normalize(N + vec3(-dbow, 0.0, 0.0));",
  "  vN = N;",
  "  vS = s;",
  "  vUv = vec2(aPos.x / uSize.x, aPos.y / uSize.y * uTexRatio);",
  "  vLocal = aPos / uSize;",
  "  vec2 ndc = vec2(pos.x / uSize.x * 2.0 - 1.0, 1.0 - pos.y / uSize.y * 2.0);",
  "  float lift = 1.0 + pos.z * 0.0012;",
  "  gl_Position = vec4(ndc * lift, -pos.z * 0.003, 1.0);",
  "}",
].join("\n");

const FS = [
  "precision highp float;",
  "varying vec2 vUv;",
  "varying vec2 vLocal;",
  "varying vec3 vN;",
  "varying float vS;",
  "uniform sampler2D uTex;",
  "uniform sampler2D uBack;",
  "uniform float uCurl;",
  "uniform vec3 uLight;",
  "uniform vec2 uSize;",
  "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }",
  "float vnoise(vec2 p){",
  "  vec2 i = floor(p); vec2 f = fract(p);",
  "  vec2 u = f * f * (3.0 - 2.0 * f);",
  "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),",
  "             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);",
  "}",
  "float sdRoundBox(vec2 p, vec2 b, float r){",
  "  vec2 q = abs(p) - b + r;",
  "  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;",
  "}",
  "void main(){",
  "  vec2 px = (vLocal - 0.5) * uSize;",
  "  float d = sdRoundBox(px, uSize * 0.5 - 3.0, 14.0);",
  "  d += (vnoise(px * 0.55) - 0.5) * 2.6 + (vnoise(px * 0.16) - 0.5) * 2.2;",
  "  float edgeA = 1.0 - smoothstep(-0.75, 0.75, d);",
  "  if (edgeA < 0.5) discard;",
  "  vec4 col;",
  "  if (gl_FrontFacing){ col = texture2D(uTex, vUv); }",
  "  else { col = texture2D(uBack, vUv); }",
  "  vec3 N = normalize(vN);",
  "  if (!gl_FrontFacing) N = -N;",
  "  float diff = max(dot(N, uLight), 0.0);",
  "  float spec = pow(max(dot(normalize(uLight + vec3(0.0,0.0,1.0)), N), 0.0), 26.0) * 0.10;",
  "  vec3 lit = col.rgb * (0.60 + 0.52 * diff) + spec;",
  "  float sh = (1.0 - smoothstep(0.0, 72.0, -vS)) * 0.42 * uCurl;",
  "  lit *= 1.0 - min(sh, 0.75);",
  "  float ef = smoothstep(3.0, 0.0, abs(d));",
  "  lit *= 1.0 - ef * 0.12;",
  "  lit = mix(lit, lit * vec3(1.05, 1.01, 0.93), ef * 0.5);",
  "  float grain = (vnoise(vLocal * uSize * 0.5) - 0.5) * 0.055;",
  "  float mottle = (vnoise(vLocal * 7.0) - 0.5) * 0.05;",
  "  lit *= 1.0 + grain + mottle;",
  "  gl_FragColor = vec4(lit, 1.0);",
  "}",
].join("\n");

/** 创建引擎；WebGL 不可用时返回 null（调用方自行降级） */
export function createPosterEngine(
  canvas: HTMLCanvasElement,
  colors: PosterColors,
): PosterEngine | null {
  // 注意：function 声明会提升，TS 无法把下面的空值收窄传导进闭包，
  // 因此收窄后立刻取非空别名，闭包统一引用非空类型的 gl
  const glChecked = getGL(canvas);
  if (!glChecked) return null;
  const gl: WebGLRenderingContext = glChecked;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(POSTER_W * dpr);
  canvas.height = Math.round(POSTER_H * dpr);

  function compile(type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(
        "[PosterWidget] shader compile failed:",
        gl.getShaderInfoLog(sh),
      );
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  const vs = compile(gl.VERTEX_SHADER, VS);
  const fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(
      "[PosterWidget] program link failed:",
      gl.getProgramInfoLog(prog),
    );
    gl.deleteProgram(prog);
    return null;
  }
  gl.useProgram(prog);

  const U: Record<string, WebGLUniformLocation | null> = {};
  for (const name of [
    "uSize", "uTexRatio", "uDirN", "uDirT", "uFoldO", "uR", "uR2", "uS1",
    "uS2", "uTheta1", "uFlat", "uBow", "uTex", "uBack", "uCurl", "uLight",
  ]) {
    U[name] = gl.getUniformLocation(prog, name);
  }

  /* ── 平面网格 120×164 ── */
  const GX = 120;
  const GY = 164;
  const posArr = new Float32Array((GX + 1) * (GY + 1) * 2);
  let p = 0;
  for (let j = 0; j <= GY; j++) {
    for (let i = 0; i <= GX; i++) {
      posArr[p++] = (i / GX) * POSTER_W;
      posArr[p++] = (j / GY) * POSTER_H;
    }
  }
  const idx = new Uint16Array(GX * GY * 6);
  let q = 0;
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const a = j * (GX + 1) + i;
      const b = a + 1;
      const c = a + GX + 1;
      const d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (!vbo || !ibo) {
    gl.deleteProgram(prog);
    gl.deleteBuffer(vbo);
    gl.deleteBuffer(ibo);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const locPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

  /* ── 贴图 ── */
  const texFront = gl.createTexture();
  const texBack = gl.createTexture();
  const artCanvas = document.createElement("canvas");
  artCanvas.width = 512;
  artCanvas.height = 768;
  const backCanvas = document.createElement("canvas");
  backCanvas.width = 512;
  backCanvas.height = 768;
  const artCtxRaw = artCanvas.getContext("2d");
  const backCtxRaw = backCanvas.getContext("2d");
  if (!texFront || !texBack || !artCtxRaw || !backCtxRaw) {
    gl.deleteTexture(texFront);
    gl.deleteTexture(texBack);
    gl.deleteProgram(prog);
    return null;
  }
  const artCtx: CanvasRenderingContext2D = artCtxRaw;
  const backCtx: CanvasRenderingContext2D = backCtxRaw;

  function uploadTex(tex: WebGLTexture, src: HTMLCanvasElement): void {
    const pot = toPOTCanvas(src);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pot);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function paint(colors: PosterColors): void {
    drawPosterFront(artCtx, colors);
    drawPosterBack(backCtx, colors, artCanvas);
    gl.activeTexture(gl.TEXTURE0);
    uploadTex(texFront, artCanvas);
    gl.activeTexture(gl.TEXTURE1);
    uploadTex(texBack, backCanvas);
    gl.uniform1i(U.uTex, 0);
    gl.uniform1i(U.uBack, 1);
  }
  paint(colors);

  /* ── 静态 uniform ── */
  gl.uniform2f(U.uSize, POSTER_W, POSTER_H);
  gl.uniform1f(U.uTexRatio, TEX_RATIO);
  const nLen = Math.SQRT1_2;
  const foldO: [number, number] = [POSTER_TUNING.foldK, 0];
  gl.uniform2f(U.uDirN, nLen, -nLen);
  gl.uniform2f(U.uDirT, nLen, nLen);
  gl.uniform2f(U.uFoldO, foldO[0], foldO[1]);
  gl.uniform1f(U.uBow, POSTER_TUNING.bow);
  const raw = [-0.45, -0.55, 0.74];
  const lLen = Math.hypot(raw[0], raw[1], raw[2]);
  gl.uniform3f(U.uLight, raw[0] / lLen, raw[1] / lLen, raw[2] / lLen);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);

  /* ── 卷曲弹簧动画（rAF 仅动画期间运行）── */
  const { thetaMax, zFlap, foldK, springK, springDampRatio } = POSTER_TUNING;
  const reach = (POSTER_W - foldK) / Math.SQRT2;
  const damp = 2 * Math.sqrt(springK) * springDampRatio;

  let curl = 1;
  let vel = 0;
  let target = 1;
  let raf: number | null = null;
  let lastT = 0;
  let disposed = false;

  function render(): void {
    const c = Math.max(0, Math.min(1, curl));
    const th1 = thetaMax * c;
    if (th1 < 0.03) {
      gl.uniform1f(U.uFlat, 1);
      gl.uniform1f(U.uCurl, 0);
    } else {
      const c1 = Math.cos(th1);
      const denom = th1 + (Math.PI - th1) * ((1 - c1) / (1 + c1));
      const R = (reach + ((Math.PI - th1) * zFlap) / (1 + c1)) / denom;
      const R2 = Math.max((R * (1 - c1) - zFlap) / (1 + c1), 0.6);
      gl.uniform1f(U.uFlat, 0);
      gl.uniform1f(U.uR, R);
      gl.uniform1f(U.uR2, R2);
      gl.uniform1f(U.uS1, R * th1);
      gl.uniform1f(U.uS2, R2 * (Math.PI - th1));
      gl.uniform1f(U.uTheta1, th1);
      gl.uniform1f(U.uCurl, th1 / thetaMax);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  }

  function frame(t: number): void {
    if (disposed) return;
    const dt = Math.min((t - lastT) / 1000, 1 / 30);
    lastT = t;
    vel += (-springK * (curl - target) - damp * vel) * dt;
    curl += vel * dt;
    if (Math.abs(curl - target) < 0.0008 && Math.abs(vel) < 0.02) {
      curl = target;
      vel = 0;
      render();
      raf = null;
      return;
    }
    render();
    raf = requestAnimationFrame(frame);
  }

  function kick(): void {
    if (!disposed && raf === null) {
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  const onEnter = () => { target = 0; kick(); };
  const onLeave = () => { target = 1; kick(); };
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);

  render();

  return {
    setColors(next: PosterColors): void {
      if (disposed) return;
      paint(next);
      render();
    },
    unfold(): void { target = 0; kick(); },
    fold(): void { target = 1; kick(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      gl.deleteTexture(texFront);
      gl.deleteTexture(texBack);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteProgram(prog);
      // 注意：不能调用 WEBGL_lose_context.loseContext()——
      // 同一 canvas 的 getContext 永远返回同一个上下文对象，
      // StrictMode 双执行 / HMR 会走「创建→销毁→同 canvas 重建」序列，
      // 丢失后的上下文无法恢复，重建时着色器全部编译失败（infoLog 为 null）。
      // 这里只删除 GL 资源、保留可用上下文；真实卸载时 canvas DOM 随组件
      // 移除，上下文由浏览器回收。
    },
  };
}
