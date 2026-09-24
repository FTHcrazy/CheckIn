/**
 * 地形 GLSL ES 1.00 shader（MapPage/map-gl）
 *
 * 兼容性红线：**必须写 GLSL ES 1.00**（Pixi 依据 fragment 是否含 `#version 300 es`
 * 选择解析路径，ES 1.00 语法被完整兼容；本机实测 WebGL1 路径可用）。
 * - 禁止 uniform 数组动态下标 → 选色用宏展开的 if 链
 * - 禁止 switch / 动态长度循环 → fbm 的 octave 次数写死
 * - 顶点属性名必须与 Pixi `MeshGeometry` 一致：**`aPosition`**（不是自定义名）。
 *   写成其它名字会被 Pixi 校验拦下（"geometry missing the ... attribute"）并在
 *   每帧重抛 —— 这正是「页面卡死」的成因，改名后消失。
 *
 * 无方块感的四条来源（按贡献排序）：
 * 1. **软覆盖度场**：CPU 侧对 one-hot 做盒式模糊（terrain-splat.buildSoftLayers），
 *    GPU 采到的是「各地形占比」的平滑场 → 等值线是**曲线**而不是贴着格子的台阶。
 *    单靠 one-hot + LINEAR 只能得到 1 纹素宽的过渡带，形状仍是栅格阶梯。
 * 2. **双尺度域扰动**：采样前把格坐标揉进两层不同频率的 fbm，格线→自然海岸线。
 *    单尺度扰动仍有「波浪形方格」感，双层（低频大弯 + 中频细碎）才像手绘。
 * 3. **特征尺度下限 ≈2.2 格**：所有程序化噪声的频率都压到 0.45 格⁻¹ 以下。
 *    频率更高的噪声会和 1 格栅格拍出摩尔纹，在均匀水面/雪原上表现为「方格地毯」。
 * 4. **逐类型程序化纹理 + 地形晕渲**：林冠团块、岩脊明暗、沙丘条带、沼泽水洼、
 *    废墟断墙 —— 替代原先逐格画小图标（逐格图标是「一格一格」观感的主要来源）；
 *    最后再叠一道 hillshade（用非水面占比的双向差分当坡向），把平坦色块变成
 *    「有起伏的地表」，这是游戏地图观感的主要来源。
 */
import { MAP_PAPER } from "../map-symbols";

/**
 * 背景色（画布留白 / GL 清屏 / 导出底共用同一份 `MAP_PAPER`）。
 * 单一事实源在 map-symbols，禁止在此另写字面量。
 */
export const GL_BACKGROUND = MAP_PAPER;

/** 顶点着色器：一个覆盖世界矩形的 quad + 自建视口 uniform → 屏幕裁剪坐标 */
export const VERT_SRC = `
precision highp float;

attribute vec2 aPosition;     // 世界像素坐标（Pixi MeshGeometry 固定属性名）
uniform vec2 uViewOffset;     // 视口平移（世界原点在屏幕上的位置，与 2D 层 ctx.translate 同义）
uniform float uViewScale;     // 视口缩放（无上限即为无级缩放）
uniform vec2 uCanvasSize;     // 画布 CSS 像素尺寸（避开 Pixi 全局 uResolution）

varying vec2 vWorld;

void main() {
  vWorld = aPosition;
  // ⚠️ 必须与 Canvas2D 层完全同构：2D 用 ctx.translate(tx,ty) + ctx.scale(s,s)，即
  //    screen = world * s + t
  //    早先写成 (world - t) * s，两层约定相反 ⇒ 一旦平移/缩放，GL 地形就与
  //    河流 ribbon、地点钉、区域框**反向错位**（tx=0 时两者恰好重合，所以早期没暴露）。
  vec2 screen = aPosition * uViewScale + uViewOffset;
  vec2 clip = screen / uCanvasSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

/**
 * 片元着色器：软分类取地形色 + 逐地貌特效
 *
 * uniform 约定：
 * - uSplat0/1/2：one-hot 地形占比贴图（RGBA8 / LINEAR / 尺寸 = cols×rows）
 *   通道映射：s0.rgba → 地形 0-3，s1.rgba → 地形 4-7，s2.rgba → 地形 8-11
 * - uColorN：地形 N 底色（单一事实源 = map-symbols.TERRAIN_COLORS）
 * - uAnim = 0 时完全静止（对齐「常驻动画默认暂停」）
 */
export const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vWorld;

uniform vec2 uCell2;          // (cell, cell) 每格世界像素
uniform vec2 uGridSize;       // (cols, rows)
uniform float uTime;
uniform float uAnim;          // 0 = 静止 / 1 = 流动
uniform float uWarp;          // 大尺度域扰动幅度（单位：格）
uniform float uWarp2;         // 子格域扰动幅度（打碎栅格台阶的关键）
uniform float uWarp2Freq;     // 子格扰动频率（格⁻¹）
uniform float uSeed;          // 确定性噪声偏移
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uSplat2;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec3 uColor5;
uniform vec3 uColor6;
uniform vec3 uColor7;
uniform vec3 uColor8;
uniform vec3 uColor9;
uniform vec3 uColor10;
uniform vec3 uColor11;
uniform vec3 uBorder0;
uniform vec3 uBorder1;
uniform vec3 uBorder2;
uniform vec3 uBorder3;
uniform vec3 uBorder4;
uniform vec3 uBorder5;
uniform vec3 uBorder6;
uniform vec3 uBorder7;
uniform vec3 uBorder8;
uniform vec3 uBorder9;
uniform vec3 uBorder10;
uniform vec3 uBorder11;
uniform vec3 uCoastSand;      // 海岸沙带色（设计稿 #e8d9ad）
uniform vec3 uCoastLine;      // 深岸线色（设计稿 #456a85）

// 主导 / 次大占比的一次性比较：顺带同步 base / domId / secondId
#define CMP(w, col, id)                              \\
  if ((w) > best) {                                  \\
    second = best; secondId = domId;                 \\
    best = (w); base = (col); domId = (id);          \\
  } else if ((w) > second) {                         \\
    second = (w); secondId = (id);                   \\
  }

// ── value noise / fbm（内置，零素材，守住「无外部贴图」红线）──
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** 2 阶 fbm：域扰动用（够平滑，成本只有 3 阶的 2/3） */
float fbm2(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  v += amp * vnoise(p); p *= 2.07; amp *= 0.5;
  v += amp * vnoise(p);
  return v;
}

/** 3 阶 fbm：流动 / 熔岩用（需要更细的涡旋） */
float fbm3(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  v += amp * vnoise(p); p *= 2.03; amp *= 0.5;
  v += amp * vnoise(p); p *= 2.03; amp *= 0.5;
  v += amp * vnoise(p);
  return v;
}

/** 双层错相位流动：相位 0→1→0 往返、两层互补，只有涌动没有单向漂移 */
float flowField(vec2 p, float t, float speed) {
  float tri = abs(fract(t * speed) * 2.0 - 1.0);
  float a = fbm2(p + vec2(t * speed * 0.35, 0.0));
  float b = fbm2(p * 1.07 - vec2(t * speed * 0.35, 0.0) + vec2(19.7, 7.3));
  return mix(a, b, tri);
}

void main() {
  vec2 cell = vWorld / uCell2;

  // ① 双尺度域扰动：低频大弯（海陆轮廓）+ 中频细节（打碎直线段）
  //    ⚠️ **尺度分工是实测调出来的，不要随手改频率**：
  //    - 低频 fbm2 的两个八度必须都 ≥6 格（0.075 与 0.155 格⁻¹）。早先用 0.185 时
  //      第二八度落在 0.383 格⁻¹（波长 2.6 格），一旦调大 uWarp 就会被一起放大成
  //      **栅格尺度抖动** —— 表现为毛刺而非手绘，实测反而把 45° 阶梯的
  //      「轴对齐占比」从 3.7% 推高到 22.9%。
  //    - 中频只给 0.2~0.3 格幅度：它是用来打断长直线的，不是用来加噪声的。
  //    - **明暗调制**（见 ⑤）另有一套更低的频率，必须 ≥2.2 格，否则与 1 格栅格
  //      拍出摩尔纹「方格地毯」。
  //    ⚠️ uv 不能加半纹素偏移：纹素中心在 (i+0.5)/cols，而格坐标 s=i+0.5 正是格中心，
  //    故 uv = cell/cols 天然把格中心对到纹素中心。实测加 0.5 会让等值线**偏移半格**
  //    （8 世界像素，与 2D 层错位）。改这里必须用「等值线中点应落在 16c」的剖面验证。
  //    ✋ 另注：本文件是 TS 模板字符串，注释里**绝对不能出现反引号**，否则截断字符串。
  vec2 wLow = vec2(
    fbm2(cell * 0.075),
    fbm2(cell * 0.075 + vec2(37.1, 11.9))
  ) - 0.5;
  vec2 wMid = vec2(
    vnoise(cell * uWarp2Freq + vec2(5.3, 23.7)),
    vnoise(cell * uWarp2Freq + vec2(61.3, 3.9))
  ) - 0.5;
  vec2 uv = (cell + wLow * uWarp * 1.6 + wMid * uWarp2 * 2.0) / uGridSize;

  // ② 采样三张**软覆盖度**贴图 → 各地形占比（已模糊，等值线是曲线而非栅格台阶）
  vec4 s0 = texture2D(uSplat0, uv);
  vec4 s1 = texture2D(uSplat1, uv);
  vec4 s2 = texture2D(uSplat2, uv);

  // ③ 选主导地形 + 记录次大占比/颜色/编号（宏展开，规避 ES 1.00 动态下标限制）
  float best = -1.0;
  float second = -1.0;
  float domId = 0.0;
  float secondId = 0.0;
  vec3 base = uColor0;

  CMP(s0.r, uColor0, 0.0)
  CMP(s0.g, uColor1, 1.0)
  CMP(s0.b, uColor2, 2.0)
  CMP(s0.a, uColor3, 3.0)
  CMP(s1.r, uColor4, 4.0)
  CMP(s1.g, uColor5, 5.0)
  CMP(s1.b, uColor6, 6.0)
  CMP(s1.a, uColor7, 7.0)
  CMP(s2.r, uColor8, 8.0)
  CMP(s2.g, uColor9, 9.0)
  CMP(s2.b, uColor10, 10.0)
  CMP(s2.a, uColor11, 11.0)

  // ⑤ 逐地貌特效（所有噪声特征尺度 ≥2.2 格，避免 1 格级摩尔纹）
  float t = uTime * uAnim;
  float mottle = vnoise(cell * 0.31 + vec2(13.1, 7.7));
  float fine = vnoise(cell * 0.72 + vec2(41.3, 9.9));

  if (domId < 0.5) {
    // 0 大海：大尺度涌浪
    float w = flowField(cell * 0.13, t, 0.10);
    base *= 0.90 + 0.20 * w;
    base += vec3(0.10, 0.12, 0.13) * smoothstep(0.62, 0.86, w);
  } else if (domId < 1.5) {
    // 1 湖泊：细密涟漪（比海更静、频率更高）
    float w = flowField(cell * 0.20, t, 0.16);
    base *= 0.95 + 0.10 * w;
  } else if (domId < 2.5) {
    // 2 河流：⚠️ 正常情况下**这里不会命中** —— 河流已改为由 2D 层按 pts 单独绘制，
    //    喂给 splat 的是「抹掉河流的地表底质」（map-terrain.fillRiverBase），
    //    河格在软场里已经被两岸地形顶掉。此分支只在有人直接用含河格的 cells
    //    构建 splat 时（历史数据 / 诊断脚本）兜底，保留是为了不改变 12 通道索引约定。
    float w = flowField(cell * 0.26, t, 0.22);
    base *= 0.93 + 0.14 * w;
    base += vec3(0.06, 0.08, 0.09) * smoothstep(0.66, 0.9, w);
  } else if (domId < 3.5) {
    // 3 沙漠：定向沙丘条纹（周期 ≈4 格）+ 风纹细层
    float dune = sin((cell.x + cell.y * 0.32) * 1.5 + mottle * 3.1);
    base *= 0.95 + 0.08 * dune + 0.05 * mottle;
    base += vec3(0.04, 0.03, 0.0) * smoothstep(0.68, 0.92, fine);
  } else if (domId < 4.5) {
    // 4 草原：细草叶打碎大片纯色（高频只做 ±3% 幅度，不构成摩尔纹）
    base *= 0.97 + 0.07 * mottle + 0.035 * fine;
  } else if (domId < 5.5) {
    // 5 森林：林冠团块（两层尺度 → 「树冠挤在一起」的观感）
    float canopy = vnoise(cell * 0.42 + vec2(3.3, 17.9));
    float clump = smoothstep(0.42, 0.78, canopy);
    float leaf = vnoise(cell * 0.86 + vec2(63.1, 21.7));
    base *= 0.84 + 0.24 * clump;
    base *= 0.94 + 0.12 * step(0.52, leaf);
    base += vec3(-0.02, 0.04, -0.02) * (1.0 - clump);
  } else if (domId < 6.5) {
    // 6 山地：岩脊明暗（沿低频噪声做脊线）+ 岩屑细纹
    float ridge = abs(vnoise(cell * 0.36 + vec2(29.3, 5.1)) * 2.0 - 1.0);
    base *= 0.90 + 0.18 * smoothstep(0.15, 0.85, ridge);
    base += vec3(0.05, 0.04, 0.03) * (1.0 - ridge) * 0.5;
    base *= 0.97 + 0.06 * fine;
  } else if (domId < 7.5) {
    // 7 雪山：岩脊 + 雪线提亮（高处更白）
    float ridge = abs(vnoise(cell * 0.40 + vec2(11.7, 41.3)) * 2.0 - 1.0);
    base *= 0.92 + 0.12 * ridge;
    base = mix(base, vec3(0.97, 0.98, 1.0), smoothstep(0.62, 0.92, ridge) * 0.5);
  } else if (domId < 8.5) {
    // 8 雪原：极轻的冰原起伏 + 细雪粒
    base *= 0.985 + 0.03 * mottle;
    base += vec3(0.02, 0.03, 0.05) * step(0.86, fine);
  } else if (domId < 9.5) {
    // 9 熔岩：domain warping 出龟裂缝 + 自发光岩浆
    vec2 q = vec2(
      fbm3(cell * 0.28 + t * 0.02),
      fbm3(cell * 0.28 + vec2(3.7, 1.1) - t * 0.015)
    );
    float n = fbm3(cell * 0.44 + q * 2.1);
    float crack = smoothstep(0.50, 0.74, n);
    vec3 magma = mix(vec3(0.85, 0.28, 0.06), vec3(1.0, 0.72, 0.20), crack);
    base = mix(base, magma, crack);
    base += vec3(0.35, 0.13, 0.02) * crack * (0.7 + 0.3 * sin(t * 1.7));
  } else if (domId < 10.5) {
    // 10 沼泽：苔甸斑块 + 水洼高光（会随动态轻微涌动，与水体一致）
    float bog = vnoise(cell * 0.48 + vec2(77.3, 13.1));
    float pool = smoothstep(0.60, 0.80, bog);
    float w = flowField(cell * 0.24, t, 0.12);
    base *= 0.90 + 0.16 * bog;
    base = mix(base, base * 0.72 + vec3(0.02, 0.06, 0.05), pool * 0.55);
    base += vec3(0.03, 0.08, 0.07) * smoothstep(0.68, 0.9, w) * pool;
  } else {
    // 11 废墟：碎石斑驳 + 断墙直线（直线是「人造物」的关键提示）
    float rubble = vnoise(cell * 0.82 + vec2(19.7, 51.3));
    base *= 0.90 + 0.16 * rubble;
    float wall = step(0.5, fract(cell.y * 0.24 + vnoise(cell * 0.11 + vec2(7.7, 3.3)) * 2.0));
    base = mix(base, base * 0.74, wall * smoothstep(0.55, 0.75, rubble) * 0.7);
    base += vec3(0.05, 0.05, 0.04) * (1.0 - rubble);
  }

  // ④ 地形晕渲（hillshade）：用「非水面占比」在 x/y 两个方向的差分当作坡向，
  //    一律按左上受光提亮/压暗。**放在地貌调制之后、墨线之前**：
  //    - 它负责把「一片平的色块」变成「有起伏的地表」，是游戏地图观感的主要来源
  //    - 墨线必须最后画，否则会被光照明暗泡软、边界重新糊掉
  //    ⚠️ 偏移用世界格坐标（uGridSize 归一），故缩放时晕渲随地形固定、不会漂移。
  float landC = 1.0 - (s0.r + s0.g + s0.b);
  vec2 hstep = vec2(1.6, 0.0) / uGridSize;
  vec4 hx4 = texture2D(uSplat0, uv + hstep);
  vec4 hy4 = texture2D(uSplat0, uv + vec2(0.0, 1.6) / uGridSize);
  float landX = 1.0 - (hx4.r + hx4.g + hx4.b);
  float landY = 1.0 - (hy4.r + hy4.g + hy4.b);
  float shade = clamp(1.0 + ((landX - landC) + (landY - landC)) * 1.15, 0.84, 1.16);
  base *= shade;

  // ④ 边界装饰（对齐设计稿 outlineLayer）。**放在地貌调制之后**是刻意的：
  //    墨线与海岸带必须是静止的，若先画再被水面的 flow 调制，岸线会随波浪一起脉动。
  //    bw = 主导与次大的占比差，是「到等值线距离」的单调代理（0 = 正落在边界上）。
  float bw = best - second;

  // ④a 地形墨线：每个地形区块有自己的深色描边（相邻底色接近时唯一的可读性来源）。
  //     必须写成「外层 > 0.5 + 内层升序」：若与 ⑤ 一样只写升序 else-if，
  //     domId=0（海）会被第一个 else 分支误判成 river。
  vec3 border = uBorder0;
  if (domId > 0.5) {
    if (domId < 1.5) border = uBorder1;
    else if (domId < 2.5) border = uBorder2;
    else if (domId < 3.5) border = uBorder3;
    else if (domId < 4.5) border = uBorder4;
    else if (domId < 5.5) border = uBorder5;
    else if (domId < 6.5) border = uBorder6;
    else if (domId < 7.5) border = uBorder7;
    else if (domId < 8.5) border = uBorder8;
    else if (domId < 9.5) border = uBorder9;
    else if (domId < 10.5) border = uBorder10;
    else border = uBorder11;
  }

  // ④b 海岸：仅「陆地↔水体」交界（湖/河之间不算）。两笔画 = 宽沙带 + 窄深岸线。
  //    ⚠️ 必须用 second > 0.06 守卫：区块**内部**其余通道全为 0，比较宏会把
  //    地形 0（海）记成次大，若不守卫则整片草地都会被判成海岸、糊上沙色。
  //    bw < 0.07 约合 ±1.4 世界像素，与设计稿 1.7px 岸线同量级。
  float waterEdge =
    second > 0.06 ? abs(step(domId, 2.5) - step(secondId, 2.5)) : 0.0;
  float lineN = 1.0 - smoothstep(0.0, 0.07, bw);
  float sandN = 1.0 - smoothstep(0.0, 0.22, bw);
  vec3 lineCol = mix(border, uCoastLine, waterEdge);
  base = mix(base, uCoastSand, sandN * waterEdge * 0.9);
  // 强度对齐设计稿：stroke-width 1.15 + stroke-opacity .72 ⇒ 混合系数 ≈0.7
  base = mix(base, lineCol, lineN * mix(0.7, 0.9, waterEdge));

  gl_FragColor = vec4(base, 1.0);
}
`;
