/**
 * 液态玻璃 · WebGL 着色器渲染器
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ 这个渲染器服务的是**液态玻璃**主题（id `liquid-glass-wc`，材质档 `refract`），
 * **不是**「透明玻璃」（id `liquid-glass`，材质档 `liquid`，走 SVG 位移 + backdrop 模糊）。
 * 这里原来写的是「毛玻璃」，属于历史笔误；2026-10 用户要求把「毛玻璃」改名为
 * 「透明玻璃」时顺手纠正了这一处 —— 否则两个玻璃主题的说明会互相矛盾。
 * 为什么必须用着色器（而不是 CSS/SVG）：
 *
 * Liquid Glass 的内核是**逐像素的法线**：用 SDF（有向距离场）求出每个像素
 * 到边缘的距离，再求梯度得到法线；中心法线朝向屏幕外、越靠边缘越倾斜。
 * 然后用这个法线去偏移背景纹理的采样坐标，并对 R/B 通道用略微不同的
 * 偏移量，就得到「中心清晰、边缘拉伸弯曲 + 极轻色散」。
 *
 * CSS 的 backdrop-filter 做不到这些：
 *   · feDisplacementMap 只能做均匀或噪声位移，无法按法线偏移
 *   · 无法逐像素求梯度
 *   · 而且 backdrop-filter 的模糊本质上就是磨砂 —— 这正是「磨砂感太强」的根因
 *
 * 本渲染器**完全不使用 backdrop-filter**，直接采样背景纹理，
 * 因此可以做到真正的零模糊：中心完全清晰，只有边缘发生光学形变。
 *
 * ── 架构：全局共享一个 WebGL 上下文 ──────────────────────────────────
 * 浏览器对同时存在的 WebGL 上下文数量有硬上限（约 8~16 个），
 * 早期版本给每个玻璃面板各建一个上下文，结果第 3 个面板之后全部渲染失败。
 * 现在改为：
 *   · 全部面板共用**一个**离屏 WebGL 上下文，逐个渲染
 *   · 每次渲染完立即 drawImage 到该面板自己的 2D canvas 上
 *   · 因为是从同一个上下文绘制到 2D 画布，像素是复制而不是引用，
 *     所以下一次复用同一块缓冲区是安全的
 * 这样无论页面上有多少块玻璃，都只占一个 GL 上下文。
 *
 * ── 性能（安卓优先）────────────────────────────────────────────────
 *   · 一个面板 = 一次全屏三角形绘制 + 10 次纹理采样，GPU 负担极小
 *   · 比 feTurbulence 滤镜便宜得多（后者要反复重新光栅化滤镜链）
 *   · 静态场景只绘制一次，不做持续 rAF 循环；仅在尺寸/背景变化时重绘
 * ========================================================================== */

export interface GlassOptions {
  /**
   * 折射率。默认 1.46（普通玻璃）。
   * 折射量由「厚度 + 实际光程 + Snell 定律」决定，不再用手调强度 ——
   * 手调强度会让折射量不随玻璃厚度变化，物理上是错的。
   */
  ior: number;
  /**
   * 色散：R / B 通道在 IOR 上的偏移量。
   * 用不同 IOR 追踪三条光路 → 真实的光路色散，
   * 而不是事后在边缘描红蓝边。数值应远小于 IOR。
   */
  dispersionIor: number;
  /** 背景平面距玻璃的深度（设备像素），用于求交得到采样点 */
  backgroundDistance: number;
  /** 高光强度总控 */
  specular: number;
  /** 感知粗糙度（0~1）。0.32 是接近真实玻璃默认值 */
  roughness: number;
  /** 玻璃自身染色（0 = 完全透明） */
  tint: number;
  /**
   * 四点柔光阵列的整体旋转角（弧度）。
   * 0 表示固定；应用若想让它缓慢绕相机旋转，可随时间推进并触发重绘。
   */
  lightRotation: number;
  /** 外部柔和阴影强度（0 = 无）。在面板外侧形成悬浮感 */
  outerShadow: number;
  /** 倒角宽度（CSS 像素） */
  edgeWidth: number;
  /** 玻璃物理厚度（设备像素），直接影响折射位移量 */
  thickness: number;
  /** 内 / 外缘的径向偏移量（设备像素），CHAPTER 05 的 rimDisplacement */
  rimDisplacement: number;
  /** Face 的轻微放大系数：采样点向中心收，背景被略微放大 */
  faceMagnify: number;
  /** 三路采样各自的 mipmap 层级（越高越模糊） */
  lodFace: number;
  lodInner: number;
  lodOuter: number;
  /** 圆角（CSS 像素） */
  radius: number;
}

export const DEFAULT_GLASS: GlassOptions = {
  ior: 1.46,
  // 三通道 IOR 只差 0.018 —— 真实玻璃的色散本来就很轻微
  dispersionIor: 0.018,
  backgroundDistance: 70,
  specular: 0.85,
  // 感知粗糙度 0.32 —— 玻璃的默认观感
  roughness: 0.32,
  tint: 0.04,
  lightRotation: 0.35,
  outerShadow: 0.35,
  edgeWidth: 15,
  // 物理厚度。折射位移 ≈ 厚度 × (tanθ₁ - tanθ₂)，
  // 18px 厚在倒角最陡处产生约 8~10px 的横向位移。
  thickness: 18,
  rimDisplacement: 6,
  // 略小于 1：采样点向中心收 → 背景被轻微放大，产生镜头感
  faceMagnify: 0.975,
  // Face 稍柔、Inner 最锐（负责压缩拉伸）、Outer 最模糊（柔和翻卷）
  lodFace: 0.9,
  lodInner: 0,
  lodOuter: 1.7,
  radius: 20,
};

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_bg;
uniform vec2  u_panelPx;
uniform vec2  u_texSize;
uniform vec2  u_panelOrigin;
uniform float u_radius;
uniform float u_ior;              // 折射率
uniform float u_dispersionIor;    // 三通道 IOR 偏移量
uniform float u_bgDistance;       // 背景平面深度
uniform float u_specular;
uniform float u_roughness;        // 感知粗糙度（0~1）
uniform float u_tint;
uniform float u_lightRotation;    // 四点光阵旋转角
uniform float u_outerShadow;      // 外部柔和阴影
uniform float u_normalTransition; // 倒角宽度（设备像素）
uniform float u_glassThickness;   // 玻璃物理厚度（设备像素）
uniform float u_rimDisplacement;  // 内/外缘的径向偏移量（设备像素）
uniform float u_faceMagnify;      // Face 的轻微放大系数（<1 表示采样点向中心收）
uniform float u_lodFace;          // Face 的 mipmap 层级（较高 = 更柔）
uniform float u_lodInner;         // Inner 的层级（较低 = 保持锐利）
uniform float u_lodOuter;         // Outer 的层级（更高 = 柔和翻卷）

const float PI = 3.14159265359;

// ══ 造型层：有向距离场（SDF）════════════════════════════════════
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdCircle(vec2 p, float r) { return length(p) - r; }

// ══ 高度场 ══════════════════════════════════════════════════════
//
// 五次平滑插值。比 smoothstep 的三次插值高一阶，
// 它的一阶导与二阶导在两端都为 0，因此倒角与中央平面的交接处
// 不会出现可见的折痕或"内方框"。
float quintic(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/**
 * 玻璃的高度剖面 —— 这是「中间平、边缘倒角」的核心。
 *
 * 做法：先取 interior = max(-sdf, 0)（离边缘的向内距离），
 * 让它在倒角宽度 bevel 内归一化为 t，再用 quintic 平滑升到满高度；
 * **t 到达 1 之后高度保持常量**，于是中央区域成为完全平坦的台面。
 *
 * 为什么不能直接对原始 SDF 求梯度：
 * SDF 的梯度在整块面板的直边附近始终是单位向量，
 * 处处求梯度会让法线在整个表面上都倾斜 —— 结果是「圆顶」，
 * 而不是「一块中间平、边缘有倒角的厚玻璃」。
 */
float heightAt(vec2 p, vec2 halfSize, float r) {
  float d = sdRoundRect(p, halfSize, r);
  float interior = max(-d, 0.0);
  float bevel = max(u_normalTransition * 0.82, 1.0);
  float t = clamp(interior / bevel, 0.0, 1.0);
  return u_glassThickness * quintic(t);
}

/** 归一化的倒角位置：0 = 贴边，1 = 已进入中央平面 */
float bevelT(float sdf) {
  float interior = max(-sdf, 0.0);
  float bevel = max(u_normalTransition * 0.82, 1.0);
  return clamp(interior / bevel, 0.0, 1.0);
}

/**
 * 双界面折射：追踪一条光线 AIR → 玻璃 → AIR → 背景平面。
 *
 * 为什么不用「法线 × 强度」近似：
 * 那种近似下折射量是一个手调常数，不随玻璃厚度变化，物理上不成立；
 * 而且位移方向只跟法线有关，无法体现光线在玻璃内部实际走了多远。
 * 这里改成真正的光路追踪，位移自然由厚度与实际光程决定。
 *
 * @param local  入射点的局部坐标（设备像素，中心为原点）
 * @param h      入射点处的玻璃表面高度（设备像素）
 * @param normal 前表面法线（中心为 (0,0,1)）
 * @param ior    该波长的折射率
 * @return       背景平面上的采样点（局部 xy，设备像素）
 */
vec2 traceGlassRay(vec2 local, float h, vec3 normal, float ior) {
  // ① ENTER：空气 → 玻璃。视线方向朝屏幕内
  vec3 incident = vec3(0.0, 0.0, -1.0);
  vec3 insideRay = refract(incident, normal, 1.0 / ior);
  // 全反射或退化时 refract 返回零向量，回退到入射方向保证稳定
  if (dot(insideRay, insideRay) < 0.25) insideRay = incident;

  // ② TRAVEL：从高度为 h 的前表面，沿内射线推进到平坦背面（z = 0）
  //    光程由高度与实际方向决定，不是常数
  float glassPath = h / max(-insideRay.z, 0.025);
  vec3 exitPos = vec3(local, h) + insideRay * glassPath;
  exitPos.z = 0.0; // 背面是平的

  // ③ EXIT：玻璃 → 空气。背面法线是平坦的 (0,0,1)
  vec3 backNormal = vec3(0.0, 0.0, 1.0);
  vec3 outRay = refract(insideRay, backNormal, ior);
  if (dot(outRay, outRay) < 0.25) outRay = insideRay;

  // 与背景平面 z = -u_bgDistance 求交
  float zDir = min(outRay.z, -0.001);
  float travel = (-u_bgDistance - exitPos.z) / zDir;
  vec3 bgPos = exitPos + outRay * travel;

  return bgPos.xy;
}

void main() {
  vec2 halfSize = u_panelPx * 0.5;
  // local：以面板中心为原点、单位为设备像素、y 轴向上。
  // 使用设备像素等价于提示词里的宽高比校正，
  // 竖屏画幅下四条边的曲率自然一致。
  vec2 local = (v_uv - 0.5) * u_panelPx;
  local.y = -local.y;

  float dist = sdRoundRect(local, halfSize, u_radius);
  float sdf = sdRoundRect(local, halfSize, u_radius);

  // 抗锯齿：用 fwidth 得到与像素密度无关的过渡宽度
  float aa = max(fwidth(dist), 0.0001);
  float mask = 1.0 - smoothstep(-aa, aa, dist);
  if (mask <= 0.002) { discard; }

  // ── 法线：对**高度场**做中心差分，而不是对 SDF 求导 ────────────
  // 步长按倒角宽度取，并夹在 1~3 像素，避免采样跨越整个倒角导致法线糊掉。
  float step = clamp(u_normalTransition * 0.13, 1.0, 3.0);
  float hL = heightAt(local - vec2(step, 0.0), halfSize, u_radius);
  float hR = heightAt(local + vec2(step, 0.0), halfSize, u_radius);
  float hD = heightAt(local - vec2(0.0, step), halfSize, u_radius);
  float hU = heightAt(local + vec2(0.0, step), halfSize, u_radius);

  vec2 gradient = vec2(hR - hL, hU - hD) / (2.0 * step);
  // 中央平面处 gradient 恒为 0 → 法线稳定为 (0,0,1)，不会出现内框或隆起
  vec3 N = normalize(vec3(-gradient, 1.0));

  float t = bevelT(sdf);
  // 倒角权重：贴边为 1，进入中央平面后为 0
  float bevelW = 1.0 - t;
  // 高光与反射只用**倒角外半段**，否则中央平面上会出现凸起的内方框
  float outerHalf = 1.0 - smoothstep(0.0, 0.5, t);
  // 贴边极窄的一圈，用于外沿暗线
  float lip = 1.0 - smoothstep(0.0, max(aa * 3.0, 2.5), -sdf);
  // 折射过渡带：完全落在倒角内，中央平面不参与折射
  float bandIn = smoothstep(0.0, max(aa * 5.0, 3.5), -sdf);

  // ── 三路光学采样：FACE / INNER RIM / OUTER RIM ──────────────
  //
  // 三个区域各有不同的光学行为，不能只用一次采样糊过去：
  //   FACE  中央平面：轻微放大 + 较高 LOD（柔）＋ 完全无色散
  //   INNER 内缘：沿法线向内偏移，负责主要的压缩与拉伸，低 LOD 保持锐利
  //   OUTER 外缘：沿法线向外偏移 ×1.28（方向与 Inner 相反），高 LOD 形成柔和翻卷
  //
  // RGB 光路差（CHAPTER 04 的三条追踪光线）只注入 Inner / Outer，
  // Face 保持稳定 —— 这样中心清晰、边缘有镜头感。
  vec2 uvBase = (u_panelOrigin + v_uv * u_panelPx) / u_texSize;
  vec2 px2uv = 1.0 / u_texSize;
  vec2 opticalCenter = (u_panelOrigin + u_panelPx * 0.5) / u_texSize;

  float h = heightAt(local, halfSize, u_radius);

  // 三条物理光路（R / G / B 各自折射率不同）
  vec2 hitR = traceGlassRay(local, h, N, max(u_ior - u_dispersionIor, 1.0));
  vec2 hitG = traceGlassRay(local, h, N, u_ior);
  vec2 hitB = traceGlassRay(local, h, N, max(u_ior + u_dispersionIor, 1.0));

  vec2 uvR = uvBase + vec2(hitR.x, -hitR.y) * px2uv;
  vec2 uvG = uvBase + vec2(hitG.x, -hitG.y) * px2uv;
  vec2 uvB = uvBase + vec2(hitB.x, -hitB.y) * px2uv;

  // rim 方向：由平滑高度场的法线得到（指向玻璃外侧）
  vec2 rimDir = normalize(vec2(N.x, -N.y) + vec2(1e-6));
  // rim 位移强度：在倒角带中部最强（t=0 贴边、t=1 已进入平面）
  float rimBump = 1.0 - abs(t * 2.0 - 1.0);
  // 注意 px2uv 是 vec2，所以 rimDisp 也必须是 vec2，否则维度不匹配
  vec2 rimDisp = vec2(u_rimDisplacement * rimBump) * px2uv;

  // ① FACE：轻微放大（采样点向中心收），与绿色光路少量混合，无通道分离
  vec2 faceUV = opticalCenter + (uvBase - opticalCenter) * u_faceMagnify;
  faceUV = mix(faceUV, uvG, 0.35);
  vec3 faceC = textureLod(u_bg, faceUV, u_lodFace).rgb;

  // ② INNER：向内偏移，低 LOD 保持边缘锐利；负责压缩与拉伸
  vec2 innerR = uvR - rimDir * rimDisp;
  vec2 innerG = uvG - rimDir * rimDisp;
  vec2 innerB = uvB - rimDir * rimDisp;
  vec3 innerC = vec3(
    textureLod(u_bg, innerR, u_lodInner).r,
    textureLod(u_bg, innerG, u_lodInner).g,
    textureLod(u_bg, innerB, u_lodInner).b
  );

  // ③ OUTER：向外偏移 ×1.28（方向与 Inner 相反），高 LOD 形成柔和翻卷；
  //    允许读到玻璃边界之外的背景，产生 Bleed
  vec2 outerR = uvR + rimDir * rimDisp * 1.28;
  vec2 outerG = uvG + rimDir * rimDisp * 1.28;
  vec2 outerB = uvB + rimDir * rimDisp * 1.28;
  vec3 outerC = vec3(
    textureLod(u_bg, outerR, u_lodOuter).r,
    textureLod(u_bg, outerG, u_lodOuter).g,
    textureLod(u_bg, outerB, u_lodOuter).b
  );

  // ── 由 SDF 倒角带生成三路权重并归一化 ───────────────────────
  // t: 0 = 贴边，1 = 已进入中央平面
  float faceWeight = smoothstep(0.42, 0.98, t);
  float innerWeight = smoothstep(0.02, 0.28, t) * (1.0 - smoothstep(0.45, 0.9, t));
  float outerWeight = 1.0 - smoothstep(0.0, 0.32, t);
  float wsum = max(faceWeight + innerWeight + outerWeight, 1e-4);

  vec3 color = (faceC * faceWeight + innerC * innerWeight + outerC * outerWeight) / wsum;

  color = mix(color, vec3(1.0), u_tint);

  // ══ BRDF 光照层次 ═══════════════════════════════════════════
  //
  // 01 ORDER：折射背景已完成，白色染色已完成，现在才算镜面反射。
  //    顺序不能反 —— 先覆盖半透明白层或先画整圈白边，材质就会像塑料。
  //
  // 02 BRDF：介质高光用 GGX 法线分布 + Smith **height-correlated** 可见性
  //    + Schlick 菲涅尔；F0 由折射率算出，而不是硬编码。
  vec3 V = vec3(0.0, 0.0, 1.0);

  // F0 = ((IOR - 1) / (IOR + 1))²
  float f0 = (u_ior - 1.0) / (u_ior + 1.0);
  f0 = f0 * f0;

  // 感知粗糙度 → GGX alpha。alpha = roughness² 是标准的感知到线性映射。
  float alpha = clamp(u_roughness * u_roughness, 0.002, 0.5);
  float a2 = alpha * alpha;

  // 04 SUPPORT：曲率权重 —— 平面处为 0，倒角处升高。
  //    用它把直接高光与环境菲涅尔限制在倒角外半段，
  //    避免 BRDF 在平坦的中央平面上制造"中心突起"。
  float curvature = clamp(length(gradient) * 2.2, 0.0, 1.0);
  float support = outerHalf * mix(0.55, 1.0, curvature);

  // 03 LIGHTS：四点掠射柔光阵列。
  //    xy 分量在 0.9~0.96（掠射角），z 在 0.28~0.42；
  //    带轻微冷暖差，使大部分边缘都有反射但强弱不同 ——
  //    单一光源做不到这种环绕感。
  vec3 lightDirs[4];
  vec3 lightTints[4];
  lightDirs[0] = vec3( 0.94,  0.30, 0.38);
  lightDirs[1] = vec3(-0.32,  0.92, 0.42);
  lightDirs[2] = vec3(-0.90, -0.36, 0.30);
  lightDirs[3] = vec3( 0.38, -0.88, 0.34);
  lightTints[0] = vec3(1.00, 0.975, 0.94); // 暖
  lightTints[1] = vec3(0.93, 0.975, 1.00); // 冷
  lightTints[2] = vec3(0.975, 0.955, 1.00); // 淡紫
  lightTints[3] = vec3(0.945, 1.00, 0.985); // 淡青

  // 整体绕视线缓慢旋转（u_lightRotation 由应用驱动；0 即固定）
  float cr = cos(u_lightRotation);
  float sr = sin(u_lightRotation);

  float NdotV = max(dot(N, V), 1e-4);
  vec3 specular = vec3(0.0);
  float fresnelAcc = 0.0;

  for (int i = 0; i < 4; i++) {
    vec3 Ld = lightDirs[i];
    // 绕 z 轴（视线轴）旋转
    vec3 L = normalize(vec3(Ld.x * cr - Ld.y * sr, Ld.x * sr + Ld.y * cr, Ld.z));
    vec3 H = normalize(L + V);

    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);

    // GGX 法线分布
    float dggx = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / max(PI * dggx * dggx, 1e-5);

    // Smith height-correlated 可见性（比简单的 k 式更接近真实）
    float lambdaV = NdotL * sqrt(max(NdotV * NdotV * (1.0 - a2) + a2, 1e-6));
    float lambdaL = NdotV * sqrt(max(NdotL * NdotL * (1.0 - a2) + a2, 1e-6));
    float Vis = 0.5 / max(lambdaV + lambdaL, 1e-5);

    // Schlick 菲涅尔
    float Fc = f0 + (1.0 - f0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);

    specular += lightTints[i] * (D * Vis * Fc) * NdotL;
    fresnelAcc += Fc;
  }

  // 四点光阵总能量归一化；乘以 support 把高光限制在倒角外半段
  specular = specular * 0.25 * u_specular * support;

  // 环境菲涅尔：掠射方向反射更多，这是边缘起亮边的物理来源
  float envFresnel = (f0 + (1.0 - f0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0)) * 0.5;
  envFresnel *= support;

  color += specular + vec3(envFresnel) * vec3(0.96, 0.98, 1.0);

  // 外部柔和阴影：贴着轮廓内侧压暗一圈，让玻璃与外背景分离、产生悬浮感。
  // 放在最后是因为它属于「阴影」层，必须压在折射与高光之上才不会被冲淡。
  float outerShade = smoothstep(0.0, max(aa * 6.0, 4.0), -sdf) * (1.0 - smoothstep(6.0, 16.0, -sdf));
  color *= 1.0 - outerShade * u_outerShadow * 0.28;

  // 外沿极细暗线
  color *= 1.0 - lip * 0.12;

  outColor = vec4(color * mask, mask);
}`;

interface PanelEntry {
  canvas: HTMLCanvasElement;
  options: GlassOptions;
}

export interface GlassRenderer {
  ok: boolean;
  renderer: string | null;
  /** 背景或布局变化后重绘全部面板 */
  refresh: () => void;
  dispose: () => void;
}

interface GLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  name: string;
}

let state: GLState | null = null;
let stateFailed = false;

function initShared(): GLState | null {
  if (state) return state;
  if (stateFailed) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true, // drawImage 读取需要保留下上一帧内容
    powerPreference: 'low-power',
  });

  if (!gl) {
    stateFailed = true;
    return null;
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const name = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));

  const program = buildProgram(gl, VERT, FRAG);
  if (!program) {
    stateFailed = true;
    return null;
  }

  const uniforms = {
    bg: gl.getUniformLocation(program, 'u_bg'),
    panelPx: gl.getUniformLocation(program, 'u_panelPx'),
    texSize: gl.getUniformLocation(program, 'u_texSize'),
    panelOrigin: gl.getUniformLocation(program, 'u_panelOrigin'),
    radius: gl.getUniformLocation(program, 'u_radius'),
    ior: gl.getUniformLocation(program, 'u_ior'),
    dispersionIor: gl.getUniformLocation(program, 'u_dispersionIor'),
    bgDistance: gl.getUniformLocation(program, 'u_bgDistance'),
    specular: gl.getUniformLocation(program, 'u_specular'),
    roughness: gl.getUniformLocation(program, 'u_roughness'),
    lightRotation: gl.getUniformLocation(program, 'u_lightRotation'),
    outerShadow: gl.getUniformLocation(program, 'u_outerShadow'),
    tint: gl.getUniformLocation(program, 'u_tint'),
    edgeWidth: gl.getUniformLocation(program, 'u_normalTransition'),
    thickness: gl.getUniformLocation(program, 'u_glassThickness'),
    rimDisplacement: gl.getUniformLocation(program, 'u_rimDisplacement'),
    faceMagnify: gl.getUniformLocation(program, 'u_faceMagnify'),
    lodFace: gl.getUniformLocation(program, 'u_lodFace'),
    lodInner: gl.getUniformLocation(program, 'u_lodInner'),
    lodOuter: gl.getUniformLocation(program, 'u_lodOuter'),
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // 一个覆盖整个裁剪空间的大三角形，比两个三角形更省
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // CHAPTER 05 的三路采样为 Face / Inner / Outer 指定了不同的 LOD：
  // Face 用较高 LOD（更模糊）、Inner 用较低 LOD（保持锐利）、
  // Outer 用更高 LOD（柔和翻卷）。这要求纹理带 mipmap。
  // WebGL2 允许非 2 的幂纹理生成 mipmap，所以不需要补齐尺寸。
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  state = { gl, program, uniforms, vao, buffer, texture, name };
  return state;
}

/**
 * 创建玻璃渲染器。
 * @param source 提供背景像素的画布
 * @param panels 需要渲染玻璃效果的面板（每个面板的父元素决定位置与尺寸）
 */
export function createGlassRenderer(
  source: HTMLCanvasElement,
  panels: Array<{ canvas: HTMLCanvasElement; options?: Partial<GlassOptions> }>,
): GlassRenderer {
  const s = initShared();
  if (!s) {
    return { ok: false, renderer: null, refresh: () => {}, dispose: () => {} };
  }
  const { gl } = s;

  const entries: PanelEntry[] = panels.map((p) => ({
    canvas: p.canvas,
    options: { ...DEFAULT_GLASS, ...p.options },
  }));

  // 每个面板确保拿到 2D 上下文（用于接收 WebGL 的绘制结果）
  const contexts = new Map<HTMLCanvasElement, CanvasRenderingContext2D | null>();
  for (const e of entries) {
    if (!contexts.has(e.canvas)) {
      contexts.set(e.canvas, e.canvas.getContext('2d', { alpha: true }));
    }
  }

  let disposed = false;

  const refresh = () => {
    if (disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    // 上传背景纹理（每次 refresh 只做一次）
    gl.bindTexture(gl.TEXTURE_2D, s.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    // 三路采样需要不同 LOD，必须生成 mipmap
    gl.generateMipmap(gl.TEXTURE_2D);

    for (const entry of entries) {
      const parent = entry.canvas.parentElement;
      if (!parent) continue;
      const r = parent.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // 视口外的面板直接跳过，省掉一次绘制
      if (r.bottom < -100 || r.top > window.innerHeight + 100) continue;

      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));

      // WebGL 画布尺寸对齐到面板尺寸，然后直接把结果 drawImage 过去
      if (gl.canvas.width !== w || gl.canvas.height !== h) {
        gl.canvas.width = w;
        gl.canvas.height = h;
      }

      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      gl.useProgram(s.program);
      gl.bindVertexArray(s.vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      gl.uniform1i(s.uniforms.bg ?? null, 0);

      const o = entry.options;
      gl.uniform2f(s.uniforms.panelPx ?? null, w, h);
      gl.uniform2f(s.uniforms.texSize ?? null, source.width, source.height);
      gl.uniform2f(s.uniforms.panelOrigin ?? null, r.left * dpr, r.top * dpr);
      gl.uniform1f(s.uniforms.radius ?? null, o.radius * dpr);
      // 像素偏移乘以 DPR，保证在高分屏上折射的物理尺度一致
      gl.uniform1f(s.uniforms.ior ?? null, o.ior);
      gl.uniform1f(s.uniforms.dispersionIor ?? null, o.dispersionIor);
      gl.uniform1f(s.uniforms.bgDistance ?? null, o.backgroundDistance * dpr);
      gl.uniform1f(s.uniforms.specular ?? null, o.specular);
      gl.uniform1f(s.uniforms.roughness ?? null, o.roughness);
      gl.uniform1f(s.uniforms.lightRotation ?? null, o.lightRotation);
      gl.uniform1f(s.uniforms.outerShadow ?? null, o.outerShadow);
      gl.uniform1f(s.uniforms.tint ?? null, o.tint);
      gl.uniform1f(s.uniforms.edgeWidth ?? null, o.edgeWidth * dpr);
      gl.uniform1f(s.uniforms.thickness ?? null, o.thickness);
      gl.uniform1f(s.uniforms.rimDisplacement ?? null, o.rimDisplacement * dpr);
      gl.uniform1f(s.uniforms.faceMagnify ?? null, o.faceMagnify);
      gl.uniform1f(s.uniforms.lodFace ?? null, o.lodFace);
      gl.uniform1f(s.uniforms.lodInner ?? null, o.lodInner);
      gl.uniform1f(s.uniforms.lodOuter ?? null, o.lodOuter);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      // 复制到面板自己的 2D 画布
      if (entry.canvas.width !== w || entry.canvas.height !== h) {
        entry.canvas.width = w;
        entry.canvas.height = h;
      }
      const ctx = contexts.get(entry.canvas);
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(gl.canvas, 0, 0);
      }
    }
  };

  refresh();

  return {
    ok: true,
    renderer: s.name,
    refresh,
    dispose: () => {
      disposed = true;
      contexts.clear();
    },
  };
}

function buildProgram(
  gl: WebGL2RenderingContext,
  vert: string,
  frag: string,
): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[glass] program link failed:', gl.getProgramInfoLog(p));
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    // 打印出错行本身，避免只能看到行号却要手工数
    const lines = src.split('\n');
    const detail = log
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const m = /ERROR:\s*\d+:(\d+)/.exec(l);
        const n = m ? Number(m[1]) : NaN;
        const context = Number.isFinite(n)
          ? `\n        ${String(n).padStart(4)} | ${lines[n - 1] ?? ''}`
          : '';
        return `  ${l}${context}`;
      })
      .join('\n');
    console.error(`[glass] shader compile failed (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}):\n${detail}`);
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}
