/**
 * 花瓣着色器片段（注入到 three.js 的 MeshPhysicalMaterial / MeshDepthMaterial）。
 * 每片花瓣都是一张参数化曲面：在 GPU 上根据 uBloom 实时计算形态，
 * 因此花朵的绽放 / 闭合是连续、逐瓣、真实的物理形变，而非图片切换。
 */

export const PETAL_VERTEX_PARS = /* glsl */ `
uniform highp sampler2D uPetalTex;
uniform float uBloom;
uniform float uTime;
uniform vec3 uKeyDirW;

#ifndef PETAL_DEPTH
flat varying vec4 vPC0;
flat varying vec4 vPC1;
flat varying vec4 vPC2;
flat varying vec4 vPC3;
flat varying vec4 vPC4;
flat varying vec4 vPInfo;
varying vec4 vPUv;
#endif

struct Petal {
  float az; float r0; float y0; float L;
  float W; float vW; float bw; float tipN;
  float phi0; float k1; float k2; float cup;
  float wrap; float twist; float ruf; float rfreq;
  float crinkle; float notch; float seed; float layer;
  float b; float jag; float roll; float pad;
  float aoRamp;
};

vec4 pf(int k) { return texelFetch(uPetalTex, ivec2(k, gl_InstanceID), 0); }

float pHash(float n) { return fract(sin(n) * 43758.5453123); }
float pNoise(float x) {
  float i = floor(x); float f = fract(x);
  return mix(pHash(i), pHash(i + 1.0), f * f * (3.0 - 2.0 * f));
}
float pNoise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pHash(dot(i, vec2(127.1, 311.7)));
  float b = pHash(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)));
  float c = pHash(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)));
  float d = pHash(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

Petal loadPetal(out float thin, out float aoMin) {
  vec4 t0 = pf(0); vec4 t1 = pf(1); vec4 t2 = pf(2); vec4 t3 = pf(3);
  vec4 t4 = pf(4); vec4 t5 = pf(5); vec4 t6 = pf(6); vec4 t7 = pf(7);
  Petal P;
  float b = clamp((uBloom - t6.x) / max(t6.y, 1e-3), 0.0, 1.0);
  b = b * b * (3.0 - 2.0 * b);
  P.b = b;
  float sz = mix(t7.w, 1.0, b);
  P.az = t0.x; P.r0 = t0.y * mix(sz, 1.0, 0.4); P.y0 = t0.z; P.L = t0.w * sz;
  P.W = t1.x * sz; P.vW = t1.y; P.bw = t1.z; P.tipN = t1.w;
  float sway = sin(uTime * 0.8 + t6.z * 6.2831) * 0.010 + sin(uTime * 1.73 + t6.z * 11.0) * 0.005;
  P.aoRamp = 0.62;
  P.phi0 = mix(t2.x, t2.y, b) + sway * (0.25 + b);
  P.k1 = mix(t2.z, t2.w, b);
  P.k2 = mix(t3.x, t3.y, b);
  P.cup = mix(t3.z, t3.w, b);
  P.wrap = mix(t4.x, t4.y, b);
  P.twist = mix(t4.z, t4.w, b);
  P.ruf = t5.x; P.rfreq = t5.y; P.crinkle = t5.z; P.notch = t5.w;
  P.seed = t6.z; P.layer = t6.w;
  P.jag = t7.z;
  vec4 t12 = pf(12);
  P.roll = t12.y * b; P.pad = t12.x * (1.0 - b * t12.z); P.aoRamp = max(t12.w, 0.05);
  thin = t7.y; aoMin = t7.x;
  return P;
}

float petalHalfWidth(in Petal P, float s) {
  if (s < P.vW) {
    float t = s / max(P.vW, 1e-3);
    float k = sin(t * 1.5707963);
    return P.W * mix(P.bw, 1.0, pow(k, 0.9));
  }
  float t = clamp((s - P.vW) / max(1.0 - P.vW, 1e-3), 0.0, 1.0);
  return P.W * pow(max(1.0 - pow(t, P.tipN), 0.0), 1.0 / P.tipN);
}

// 花瓣中脉（脊线）在 (径向 r, 高度 y) 平面内的积分：phi 为与竖直方向的夹角
vec2 petalSpine(in Petal P, float s, out float phiS) {
  const int N = 10;
  float ds = s / float(N);
  vec2 acc = vec2(0.0);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * ds;
    float ph = P.phi0 + P.k1 * t + P.k2 * t * t;
    acc += vec2(sin(ph), cos(ph));
  }
  phiS = P.phi0 + P.k1 * s + P.k2 * s * s;
  return acc * ds * P.L;
}

vec3 petalPoint(in Petal P, float u, float v, out float rho) {
  float xN = u * 2.0 - 1.0;
  float sMax = 1.0 - P.notch * pow(1.0 - abs(xN), 3.0) - P.jag * (pNoise(u * 3.0 + P.seed * 31.0) * 0.75 + pNoise(u * 6.5 + P.seed * 17.0) * 0.25);
  float s = v * sMax;
  float phiS;
  vec2 sp = petalSpine(P, s, phiS);
  float w = max(petalHalfWidth(P, s), 0.0015);
  float x = xN * w;
  float cph = cos(phiS); float sph = sin(phiS);
  vec3 R = vec3(cos(P.az), 0.0, sin(P.az));
  vec3 T = vec3(-sin(P.az), 0.0, cos(P.az));
  vec3 nIn = -R * cph + vec3(0.0, 1.0, 0.0) * sph;
  float rax = P.r0 + sp.x;
  float rs = rax >= 0.0 ? max(rax, 0.035) : min(rax, -0.035);
  float cw = cph / rs;
  float cc = mix(P.cup, cw, P.wrap);
  float lim = 2.7 / w;
  cc = clamp(cc, -lim, lim);
  float tw = P.twist * s;
  vec3 lat = T * cos(tw) + nIn * sin(tw);
  vec3 nor = nIn * cos(tw) - T * sin(tw);
  float ax = cc * x;
  float latOff; float norOff;
  if (abs(cc) < 1e-3) { latOff = x; norOff = 0.5 * cc * x * x; }
  else { latOff = sin(ax) / cc; norOff = (1.0 - cos(ax)) / cc; }

  // 到花瓣轮廓的归一化距离（0 = 中心，1 = 边缘）
  float dSide = (1.0 - abs(xN)) * w;
  float dTip = (sMax - s) * P.L;
  rho = 1.0 - clamp(min(dSide, dTip) / (0.45 * P.W), 0.0, 1.0);

  // 边缘波浪褶皱 + 整体细皱
  float ang = atan(xN * 1.3, v - 0.25);
  float wave = sin(ang * P.rfreq + P.seed * 17.0) * 0.74 + sin(ang * P.rfreq * 1.93 + P.seed * 31.0) * 0.26;
  float edgeMask = rho * rho * smoothstep(0.06, 0.35, v);
  float disp = P.ruf * P.L * wave * edgeMask * mix(0.35, 1.0, P.b);
  // 覆瓦状叠放（花苞中每瓣一侧压住相邻瓣）与边缘外卷（玫瑰）
  disp -= P.pad * xN;
  float rollM = smoothstep(0.45, 1.0, abs(xN)); 
  disp -= P.roll * P.L * rollM * rollM * smoothstep(0.25, 0.95, v);
  disp += P.crinkle * P.L * (pNoise2(vec2(xN * 2.6 + P.seed * 5.0, v * 4.2)) - 0.5) * smoothstep(0.12, 0.6, v);

  vec3 base = R * P.r0 + vec3(0.0, P.y0, 0.0);
  return base + R * sp.x + vec3(0.0, sp.y, 0.0) + lat * latOff + nor * (norOff + disp);
}

void petalCompute(vec2 uvIn, out vec3 pos, out vec3 nrm) {
  float thin; float aoMin;
  Petal P = loadPetal(thin, aoMin);
  float rho;
  pos = petalPoint(P, uvIn.x, uvIn.y, rho);
  nrm = vec3(0.0, 1.0, 0.0);
#ifndef PETAL_DEPTH
  float tmp;
  float eu = uvIn.x < 0.5 ? 0.012 : -0.012;
  float ev = uvIn.y < 0.5 ? 0.012 : -0.012;
  vec3 pu = petalPoint(P, uvIn.x + eu, uvIn.y, tmp);
  vec3 pv = petalPoint(P, uvIn.x, uvIn.y + ev, tmp);
  vec3 du = (pu - pos) * sign(eu);
  vec3 dv = (pv - pos) * sign(ev);
  vec3 n = cross(du, dv);
  nrm = length(n) > 1e-12 ? normalize(n) : vec3(0.0, 1.0, 0.0);

  float aoV = mix(aoMin, 1.0, smoothstep(0.0, P.aoRamp, uvIn.y));
  float aoL = 1.0 - P.layer * (0.55 - 0.22 * P.b);
  vPC0 = pf(8); vPC1 = pf(9); vPC2 = pf(10); vPC3 = pf(11); vPC4 = pf(13);
  vPInfo = vec4(P.seed, P.layer, P.b, thin);
  vPUv = vec4(uvIn.x * 2.0 - 1.0, uvIn.y, rho, aoV * aoL);
#endif
}
`;

export const PETAL_FRAGMENT_PARS = /* glsl */ `
uniform float uVeinFreq;
uniform float uVeinSharp;
uniform float uSheenAmt;
uniform float uTransStrength;
uniform vec3 uTransTint;
uniform float uWrapLight;
uniform float uBumpStrength;
uniform float uDirectAO;
uniform float uSatBoost;
uniform vec3 uBudTint;
uniform vec3 uBeardColor;

flat varying vec4 vPC0;
flat varying vec4 vPC1;
flat varying vec4 vPC2;
flat varying vec4 vPC3;
flat varying vec4 vPC4;
flat varying vec4 vPInfo;
varying vec4 vPUv;

vec3 gPetalAlbedo;
float gPetalHeight;
float gPetalThin;

float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float fNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), u.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fFbm(vec2 p) {
  float a = 0.5; float s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * fNoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}

void petalShade() {
  float xN = vPUv.x; float s = vPUv.y; float rho = vPUv.z;
  float seed = vPInfo.x;
  vec3 cBase = vPC0.rgb; vec3 cMid = vPC1.rgb; vec3 cTip = vPC2.rgb; vec3 cEdge = vPC3.rgb;
  float veinAmt = vPC0.a; float edgeAmt = vPC1.a; float backPale = vPC2.a; float flare = vPC3.a;

  // 颜色梯度：基部 → 中段 → 瓣尖，再叠加边缘色
  float wob = (fFbm(vec2(xN * 1.7 + seed * 3.0, s * 2.2)) - 0.5) * 0.22;
  vec3 col = mix(cBase, cMid, smoothstep(0.0, 0.42 + wob, s));
  col = mix(col, cTip, smoothstep(0.38 + wob, 1.0, s));
  col = mix(col, cEdge, smoothstep(0.35, 1.0, rho + wob * 0.6) * edgeAmt);

  // 叶脉：沿等 xN 线从基部扇形展开，再细分支
  float wig = (fNoise(vec2(xN * 3.0 + seed, s * 5.0)) - 0.5) * 0.9;
  float q1 = xN * uVeinFreq + wig;
  float fw1 = fwidth(q1);
  float l1 = 1.0 - smoothstep(0.0, uVeinSharp + fw1 * 1.5, abs(fract(q1) - 0.5) * 2.0);
  float q2 = xN * uVeinFreq * 2.0 + wig * 1.7 + 0.5;
  float fw2 = fwidth(q2);
  float l2 = 1.0 - smoothstep(0.0, uVeinSharp + fw2 * 1.5, abs(fract(q2) - 0.5) * 2.0);
  // 屏幕空间频率过高时淡出叶脉，避免摩尔纹
  l1 *= 1.0 - smoothstep(0.18, 0.48, fw1);
  l2 *= 1.0 - smoothstep(0.18, 0.48, fw2);
  float veins = l1 * 0.75 + l2 * 0.4 * smoothstep(0.25, 0.7, s);
  veins *= smoothstep(0.0, 0.12, s) * (1.0 - 0.6 * smoothstep(0.6, 1.0, rho));
  veins *= 0.6 + 0.4 * fNoise(vec2(xN * 7.0, s * 3.0) + seed * 2.0);
  vec3 cVein = cMid * cMid * 0.85;
  col = mix(col, cVein, clamp(veins * veinAmt, 0.0, 1.0));

  // 基部斑（如牡丹的紫斑），flare>0 时生效
  col = mix(col, cBase * 0.55, flare * (1.0 - smoothstep(0.02, 0.22 + wob * 0.3, s)) * smoothstep(1.0, 0.2, abs(xN)));

  // 绒质细胞纹理与色斑
  float mott = fFbm(vec2(xN * 3.0, s * 6.0) + seed * 4.0);
  col *= 0.9 + 0.2 * mott;
  vec2 cq = vec2(xN * 55.0, s * 90.0);
  float cfade = 1.0 - smoothstep(0.35, 0.9, max(fwidth(cq.x), fwidth(cq.y)));
  float cells = mix(0.5, fNoise(cq + seed * 13.0), cfade);
  col *= 0.965 + 0.07 * cells;

  // 背面更浅
  if (!gl_FrontFacing) {
    if (backPale >= 0.0) col = mix(col, mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.6 + col * 0.6 + 0.05, 0.6), backPale);
    else col = mix(col, col * col * 1.35, -backPale);
  }
  // 花苞时颜色更浓（色素集中）
  col *= mix(uBudTint, vec3(1.0), smoothstep(0.0, 0.85, vPInfo.z));
  // 饱和度微调
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(lum), col, uSatBoost), 0.0);

  // 鸢尾“须毛”：沿中脉的绒毛带
  float beardH = 0.0;
  if (vPC4.x > 0.0) {
    float hair = fNoise(vec2(xN * 46.0, s * 70.0) + seed * 7.0);
    float bm = (1.0 - smoothstep(vPC4.y * 0.45, vPC4.y, abs(xN) + (hair - 0.5) * 0.06))
             * (1.0 - smoothstep(vPC4.z * 0.65, vPC4.z, s)) * smoothstep(0.02, 0.1, s);
    col = mix(col, uBeardColor * (0.7 + 0.6 * hair), bm * vPC4.x);
    beardH = bm * hair * 3.0;
  }
  // 斑点（vPC4.w）：基部细密色斑
  if (vPC4.w > 0.0) {
    float sp = smoothstep(0.62, 0.75, fNoise(vec2(xN * 14.0, s * 22.0) + seed * 9.0)) * (1.0 - smoothstep(0.15, 0.5, s));
    col = mix(col, cBase * 0.5, sp * vPC4.w);
  }

  gPetalAlbedo = col;
  gPetalHeight = veins * 0.6 + mott * 0.4 + cells * 0.05 + beardH;
  gPetalThin = vPInfo.w * mix(0.65, 1.15, rho) * mix(0.75, 1.0, smoothstep(0.0, 0.5, s));
}

vec3 petalBump(vec3 surfPos, vec3 surfNorm, float h, float faceDir) {
  vec3 sx = dFdx(surfPos); vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  vec3 n = normalize(abs(det) * surfNorm - grad);
  return (abs(det) > 1e-12) ? n : surfNorm;
}
`;

// 自定义直射光：包裹漫反射 + 透光（逆光时花瓣发亮）
export const PETAL_LIGHT_FN = /* glsl */ `
void RE_Direct_Petal( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float NdL = dot( geometryNormal, directLight.direction );
  float dotNL = saturate( NdL );
  float wrapD = saturate( ( NdL + uWrapLight ) / ( 1.0 + uWrapLight ) );
  vec3 irradiance = dotNL * directLight.color;
  #ifdef USE_SHEEN
    sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
  #endif
  reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
  reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseColor );
  float back = saturate( -NdL );
  float fwd = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 2.5 );
  vec3 dc = material.diffuseColor;
  vec3 tcol = ( dc * dc * 2.4 + dc * 0.25 ) * uTransTint;
  reflectedLight.directDiffuse += directLight.color * tcol * gPetalThin * uTransStrength * RECIPROCAL_PI * ( back * 0.7 + fwd * ( 0.25 + back ) * 0.6 );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Petal
`;
