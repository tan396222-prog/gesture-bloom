/**
 * Flora 引擎：把物种参数（species.js）构建为可实时绽放的 3D 花朵，
 * 并负责渲染器、灯光、环境反射、粒子与相机构图。
 */
import { THREE } from '../lib/three.js';
import { PETAL_VERTEX_PARS, PETAL_FRAGMENT_PARS, PETAL_LIGHT_FN } from './shaders.js';

const TEXELS = 14;
export const TAU = Math.PI * 2;
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

export const PETAL_DEFAULTS = {
  az: 0, r0: 0.05, y0: 0, L: 1, W: 0.4, vW: 0.6, bw: 0.15, tipN: 2.2,
  phi: [0.3, 1.2], k1: [-1.5, -0.2], k2: [0, 0.3], cup: [2.0, 1.0], wrap: [0.9, 0.0], twist: [0, 0],
  ruffle: 0.03, rfreq: 10, crinkle: 0, notch: 0,
  delay: 0, span: 0.7, seed: 0.5, layer: 0,
  aoMin: 0.5, thin: 1, jag: 0.02, budScale: 0.75,
  shingle: 0, roll: 0, shingleKeep: 0.7, aoRamp: 0.62,
  base: '#ffffff', mid: '#ffffff', tip: '#ffffff', edge: '#ffffff',
  veinAmt: 0.12, edgeAmt: 0, backPale: 0.3, flare: 0,
  beard: 0, beardW: 0.16, beardL: 0.45, spots: 0,
};

/** 球面花苞：给定花瓣基点与球心高度，求花苞状态下的起始角与曲率（使花瓣恰好贴合球面） */
export function sphereArc(r0, y0, yc, Leff, extra = 0) {
  const dr = r0, dy = y0 - yc;
  const rho = Math.max(Math.hypot(dr, dy), 0.02);
  const phi0 = Math.atan2(-dy, dr); // 切线方向（沿球面向上）与竖直方向夹角
  return { phi0: phi0 + extra, k1: -Leff / rho, rho };
}

const tmpColor = new THREE.Color();
function lin(hex) {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

function packPetals(list) {
  const data = new Float32Array(TEXELS * 4 * list.length);
  list.forEach((p, i) => {
    const q = { ...PETAL_DEFAULTS, ...p };
    const o = i * TEXELS * 4;
    const set = (k, a, b, c, d) => { const j = o + k * 4; data[j] = a; data[j + 1] = b; data[j + 2] = c; data[j + 3] = d; };
    set(0, q.az, q.r0, q.y0, q.L);
    set(1, q.W, q.vW, q.bw, q.tipN);
    set(2, q.phi[0], q.phi[1], q.k1[0], q.k1[1]);
    set(3, q.k2[0], q.k2[1], q.cup[0], q.cup[1]);
    set(4, q.wrap[0], q.wrap[1], q.twist[0], q.twist[1]);
    set(5, q.ruffle, q.rfreq, q.crinkle, q.notch);
    set(6, q.delay, q.span, q.seed, q.layer);
    set(7, q.aoMin, q.thin, q.jag, q.budScale);
    set(8, ...lin(q.base), q.veinAmt);
    set(9, ...lin(q.mid), q.edgeAmt);
    set(10, ...lin(q.tip), q.backPale);
    set(11, ...lin(q.edge), q.flare);
    set(12, q.shingle, q.roll, q.shingleKeep, q.aoRamp);
    set(13, q.beard, q.beardW, q.beardL, q.spots);
  });
  const tex = new THREE.DataTexture(data, TEXELS, list.length, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const geometryCache = new Map();
function petalGeometry(segU, segV) {
  const key = segU + 'x' + segV;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const nu = segU + 1, nv = segV + 1;
  const uv = new Float32Array(nu * nv * 2);
  const pos = new Float32Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    // 靠近基部与尖端加密
    const v = j / segV;
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      uv[k * 2] = i / segU;
      uv[k * 2 + 1] = Math.min(v, 0.999);
      pos[k * 3] = i / segU; pos[k * 3 + 1] = v; pos[k * 3 + 2] = 0;
    }
  }
  const idx = [];
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  geometryCache.set(key, g);
  return g;
}

let SHADOW_VERTEX_FLIPPED = null;
function shadowVertexChunk() {
  if (!SHADOW_VERTEX_FLIPPED) {
    SHADOW_VERTEX_FLIPPED = THREE.ShaderChunk.shadowmap_vertex.replace(
      'vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );',
      'vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );\n\tshadowWorldNormal *= ( dot( shadowWorldNormal, uKeyDirW ) >= 0.0 ? 1.0 : -1.0 );'
    );
  }
  return SHADOW_VERTEX_FLIPPED;
}

const AO_FRAGMENT = /* glsl */ `
  float pAO = vPUv.w;
  reflectedLight.indirectDiffuse *= pAO;
  reflectedLight.indirectSpecular *= mix(1.0, pAO, 0.85);
  reflectedLight.directDiffuse *= mix(1.0, pAO, uDirectAO);
  reflectedLight.directSpecular *= mix(1.0, pAO, uDirectAO);
`;

function createPetalMaterials(look, shared, tex) {
  const L = {
    roughness: 0.55, sheen: 0.7, sheenRoughness: 0.42, specular: 0.4, env: 0.6,
    veinFreq: 9, veinSharp: 0.25, sheenAmt: 0.55, trans: 1.0, transTint: '#ffffff',
    wrap: 0.35, bump: 1.0, directAO: 0.35, sat: 1.0, budTint: '#ffffff', beardColor: '#f2b33d', ...look,
  };
  const uniforms = {
    uPetalTex: { value: tex },
    uBloom: shared.uBloom,
    uTime: shared.uTime,
    uKeyDirW: shared.uKeyDirW,
    uVeinFreq: { value: L.veinFreq },
    uVeinSharp: { value: L.veinSharp },
    uSheenAmt: { value: L.sheenAmt },
    uTransStrength: { value: L.trans },
    uTransTint: { value: new THREE.Color(L.transTint) },
    uWrapLight: { value: L.wrap },
    uBumpStrength: { value: L.bump },
    uDirectAO: { value: L.directAO },
    uSatBoost: { value: L.sat },
    uBudTint: { value: new THREE.Color(L.budTint) },
    uBeardColor: { value: new THREE.Color(L.beardColor) },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: L.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    sheen: L.sheen,
    sheenRoughness: L.sheenRoughness,
    sheenColor: new THREE.Color(1, 1, 1),
    specularIntensity: L.specular,
    envMapIntensity: L.env,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + PETAL_VERTEX_PARS)
      .replace('#include <beginnormal_vertex>', 'vec3 petalP; vec3 petalN; petalCompute(uv, petalP, petalN);\nvec3 objectNormal = petalN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = petalP;')
      .replace('#include <shadowmap_vertex>', shadowVertexChunk());
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PETAL_FRAGMENT_PARS)
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + PETAL_LIGHT_FN)
      .replace('#include <color_fragment>', '#include <color_fragment>\npetalShade();\ndiffuseColor.rgb = gPetalAlbedo;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = petalBump(-vViewPosition, normal, gPetalHeight * uBumpStrength * 0.004, faceDirection);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor = mix(vec3(1.0), gPetalAlbedo * 1.6, 0.85) * uSheenAmt;\n#endif')
      .replace('#include <aomap_fragment>', AO_FRAGMENT);
  };
  mat.customProgramCacheKey = () => 'flora-petal-v5';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uPetalTex = uniforms.uPetalTex;
    shader.uniforms.uBloom = uniforms.uBloom;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uKeyDirW = uniforms.uKeyDirW;
    shader.vertexShader = '#define PETAL_DEPTH\n' + shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + PETAL_VERTEX_PARS)
      .replace('#include <begin_vertex>', 'vec3 petalP; vec3 petalN; petalCompute(uv, petalP, petalN);\nvec3 transformed = petalP;');
  };
  depth.customProgramCacheKey = () => 'flora-petal-depth-v5';
  return { mat, depth, uniforms };
}

function createPetalMesh(set, shared, quality) {
  const tex = packPetals(set.petals);
  const seg = quality.petalSeg;
  const segU = set.segU ?? seg[0];
  const segV = set.segV ?? seg[1];
  const src = petalGeometry(segU, segV);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = src.index;
  geo.attributes = src.attributes;
  geo.boundingSphere = src.boundingSphere;
  geo.instanceCount = set.petals.length;
  const { mat, depth } = createPetalMaterials(set.look || {}, shared, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.dispose = () => { tex.dispose(); mat.dispose(); depth.dispose(); };
  return mesh;
}

/** 雄蕊簇：细丝 + 花药（InstancedMesh，CPU 每帧根据绽放程度更新矩阵） */
class StamenCluster {
  constructor(spec, rng, quality) {
    const S = {
      count: 120, r: [0.02, 0.12], y0: 0.02, len: [0.12, 0.2], tilt: [[0.05, 0.15], [0.5, 1.2]],
      thick: 0.0045, anther: [0.012, 0.024, 0.012], filament: '#f3e3a0', antherColor: '#f2b51d',
      delay: 0.3, span: 0.6, curl: 0.0, budLen: 0.55, jitter: 0.15, ...spec,
    };
    this.S = S;
    const n = Math.round(S.count * (quality.stamenScale ?? 1));
    this.n = n;
    const fil = new THREE.CylinderGeometry(1, 1.15, 1, 5, 1, true);
    fil.translate(0, 0.5, 0);
    const ant = new THREE.SphereGeometry(1, 10, 7);
    this.filMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0, envMapIntensity: 0.4 });
    this.antMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
    this.fil = new THREE.InstancedMesh(fil, this.filMat, n);
    this.ant = new THREE.InstancedMesh(ant, this.antMat, n);
    for (const m of [this.fil, this.ant]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    this.items = [];
    const cF = new THREE.Color(), cA = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = Math.sqrt((i + 0.5) / n);
      const it = {
        az: i * GOLDEN + rng() * 0.3,
        r: lerp(S.r[0], S.r[1], t) * (1 + (rng() - 0.5) * 0.2),
        len: lerp(S.len[0], S.len[1], rng()) ,
        tb: lerp(S.tilt[0][0], S.tilt[0][1], t),
        to: lerp(S.tilt[1][0], S.tilt[1][1], t) + (rng() - 0.5) * S.jitter,
        sw: (rng() - 0.5) * 0.25,
        d: S.delay + rng() * 0.08,
        a: 0.85 + rng() * 0.3,
      };
      this.items.push(it);
      cF.set(S.filament).offsetHSL(0, 0, (rng() - 0.5) * 0.06);
      cA.set(S.antherColor).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.08);
      this.fil.setColorAt(i, cF);
      this.ant.setColorAt(i, cA);
    }
    this.group = new THREE.Group();
    this.group.add(this.fil, this.ant);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.last = -1;
  }
  update(bloom, time) {
    const S = this.S;
    const { _m, _q, _p, _s, _d, _up } = this;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      const b = smooth((bloom - it.d) / S.span);
      const tilt = lerp(it.tb, it.to, b) + Math.sin(time * 0.9 + i) * 0.01 * b;
      const az = it.az + it.sw * b;
      const len = it.len * lerp(S.budLen, 1, b);
      _d.set(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
      _q.setFromUnitVectors(_up, _d);
      _p.set(it.r * Math.cos(az), S.y0, it.r * Math.sin(az));
      _s.set(S.thick, len, S.thick);
      _m.compose(_p, _q, _s);
      this.fil.setMatrixAt(i, _m);
      _p.addScaledVector(_d, len);
      const a = it.a * lerp(0.75, 1, b);
      _s.set(S.anther[0] * a, S.anther[1] * a, S.anther[2] * a);
      _m.compose(_p, _q, _s);
      this.ant.setMatrixAt(i, _m);
    }
    this.fil.instanceMatrix.needsUpdate = true;
    this.ant.instanceMatrix.needsUpdate = true;
    if (this.fil.instanceColor) this.fil.instanceColor.needsUpdate = this.last < 0;
    if (this.ant.instanceColor) this.ant.instanceColor.needsUpdate = this.last < 0;
    this.last = bloom;
  }
  dispose() {
    this.fil.geometry.dispose(); this.ant.geometry.dispose(); this.filMat.dispose(); this.antMat.dispose();
    this.fil.dispose?.(); this.ant.dispose?.();
  }
}

function fadeStemMaterial(color, fadeFrom, fadeTo) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, transparent: true, envMapIntensity: 0.5 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFade = { value: new THREE.Vector2(fadeFrom, fadeTo) };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWY; uniform vec2 uFade;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= smoothstep(uFade.x, uFade.y, vWY);');
  };
  m.customProgramCacheKey = () => 'flora-stem-v1';
  return m;
}

function buildStem(spec) {
  const S = { color: '#3c6a2a', radius: 0.05, length: 3.2, bend: [0.12, 0.25], y0: -0.04, calyx: '#4c7a34', calyxSize: [0.11, 0.08], ...spec };
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector3(0, S.y0 + 0.02, 0),
    new THREE.Vector3(S.bend[0] * 0.15, S.y0 - S.length * 0.25, S.bend[1] * 0.1),
    new THREE.Vector3(S.bend[0] * 0.55, S.y0 - S.length * 0.6, S.bend[1] * 0.5),
    new THREE.Vector3(S.bend[0], S.y0 - S.length, S.bend[1]),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 40, S.radius, 10, false);
  const mat = fadeStemMaterial(S.color, -S.length * 0.75, -S.length * 0.2);
  const stem = new THREE.Mesh(tube, mat);
  stem.castShadow = true; stem.receiveShadow = true;
  g.add(stem);
  if (S.calyxSize) {
    const cal = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: S.calyx, roughness: 0.55, envMapIntensity: 0.5 }));
    cal.scale.set(S.calyxSize[0], S.calyxSize[1], S.calyxSize[0]);
    cal.position.y = S.y0 - S.calyxSize[1] * 0.35;
    cal.castShadow = true; cal.receiveShadow = true;
    g.add(cal);
  }
  g.userData.dispose = () => { tube.dispose(); mat.dispose(); };
  return g;
}

/** 构建一朵花 */
export function buildFlower(spec, shared, quality) {
  const rng = makeRng(spec.seed ?? 11);
  const parts = spec.build({ rng, THREE, lerp, smooth, TAU, GOLDEN, sphereArc });
  const group = new THREE.Group();
  const updaters = [];
  const disposers = [];
  for (const set of parts.petalSets) {
    const mesh = createPetalMesh(set, shared, quality);
    group.add(mesh);
    disposers.push(mesh.userData.dispose);
  }
  for (const st of parts.stamens || []) {
    const c = new StamenCluster(st, rng, quality);
    group.add(c.group);
    updaters.push((b, t) => c.update(b, t));
    disposers.push(() => c.dispose());
  }
  for (const ex of parts.extras || []) {
    const obj = ex({ THREE, rng, lerp, smooth, TAU, GOLDEN });
    group.add(obj);
    if (obj.userData.update) updaters.push(obj.userData.update);
    disposers.push(() => obj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }));
  }
  if (parts.stem !== false) {
    const stem = buildStem(parts.stem || {});
    group.add(stem);
    disposers.push(stem.userData.dispose);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow ?? true; } });
  return {
    group,
    spec,
    update(bloom, time) { for (const u of updaters) u(bloom, time); },
    dispose() { for (const d of disposers) d && d(); },
  };
}

/** 渲染舞台 */
export class FloraStage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.quality = { petalSeg: [18, 30], stamenScale: 1, shadowSize: 2048, ...(opts.quality || {}) };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 80);
    this.shared = { uBloom: { value: 0 }, uTime: { value: 0 }, uKeyDirW: { value: new THREE.Vector3(0, 1, 0) } };

    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.key = new THREE.DirectionalLight(0xfff1e6, 3.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    const sc = this.key.shadow.camera;
    sc.left = -1.9; sc.right = 1.9; sc.top = 1.9; sc.bottom = -1.9; sc.near = 0.5; sc.far = 14;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.012;
    this.key.shadow.radius = 3;
    this.rim = new THREE.DirectionalLight(0xffd6e4, 2.4);
    this.fill = new THREE.DirectionalLight(0xa9b8ff, 0.55);
    this.rig.add(this.key, this.key.target, this.rim, this.rim.target, this.fill, this.fill.target);

    this.scene.environment = this.buildEnvironment();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.particles = this.buildParticles(opts.particles ?? 260);
    this.scene.add(this.particles);

    this.flower = null;
    this.cache = new Map();
    this.spin = 0;
    this.userYaw = 0;
    this.view = { elev: 0.55, dist: 5, targetY: 0.25, worldRadius: 1.25, focus: { cx: 0.5, cy: 0.5, radius: 200 }, w: 1, h: 1 };
    this.setLights({});
  }

  buildEnvironment() {
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(20, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.16,0.15,0.22); vec3 mid = vec3(0.05,0.045,0.08); vec3 bot = vec3(0.012,0.012,0.02); vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bot, pow(-h, 0.5)); gl_FragColor = vec4(c, 1.0); }',
      })
    );
    envScene.add(sky);
    const box = (w, h, color, k, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    };
    box(7, 5, '#fff4ea', 3.2, -6, 8, 6);
    box(4, 9, '#ffd2e2', 1.4, 9, 3, -5);
    box(10, 3, '#8c9dff', 0.55, 0, -8, 5);
    box(3, 3, '#ffffff', 1.2, 4, 6, 8);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    envScene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    return rt.texture;
  }

  buildParticles(n) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), s = new Float32Array(n * 2);
    const rng = makeRng(99);
    for (let i = 0; i < n; i++) {
      const r = 0.9 + Math.pow(rng(), 0.7) * 2.6;
      const a = rng() * TAU;
      p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = -1.6 + rng() * 3.8; p[i * 3 + 2] = Math.sin(a) * r;
      s[i * 2] = rng(); s[i * 2 + 1] = 0.4 + rng() * 1.6;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 2));
    this.particleUniforms = { uTime: this.shared.uTime, uBloom: this.shared.uBloom, uColor: { value: new THREE.Color('#ffd9b0') }, uAccent: { value: new THREE.Color('#ff8fb0') }, uPR: { value: 1 }, uScale: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.particleUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec2 aSeed; uniform float uTime; uniform float uBloom; uniform float uPR; uniform float uScale;
        varying float vA; varying float vMix;
        void main(){
          vec3 p = position;
          float t = uTime * (0.05 + aSeed.x * 0.06);
          float ang = t * 0.6 + aSeed.x * 6.2831;
          float c = cos(ang * 0.15), s = sin(ang * 0.15);
          p.xz = mat2(c, -s, s, c) * p.xz;
          p.y = mod(p.y + uTime * (0.04 + aSeed.x * 0.05) + 1.6, 3.8) - 1.6;
          p.x += sin(uTime * 0.3 + aSeed.x * 20.0) * 0.08;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float edge = smoothstep(-1.6, -1.0, p.y) * (1.0 - smoothstep(1.7, 2.2, p.y));
          vA = edge * (0.25 + 0.75 * uBloom) * (0.45 + 0.55 * sin(uTime * (0.6 + aSeed.x) + aSeed.x * 40.0) * 0.5 + 0.275);
          vMix = fract(aSeed.x * 7.0);
          gl_PointSize = aSeed.y * uPR * uScale * (26.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform vec3 uAccent; varying float vA; varying float vMix;
        void main(){
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          float a = smoothstep(0.5, 0.0, r); a = a * a;
          vec3 c = mix(uColor, uAccent, step(0.62, vMix));
          gl_FragColor = vec4(c * a * vA * 0.9, a * vA);
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    return pts;
  }

  setLights(L) {
    const C = {
      key: ['#fff1e6', 3.0, [-2.2, 4.4, 2.8]],
      rim: ['#ffd6e4', 2.4, [2.0, 2.0, -3.4]],
      fill: ['#a9b8ff', 0.55, [2.6, -0.8, 2.6]],
      exposure: 1.0,
      ...L,
    };
    const apply = (light, [c, i, p]) => { light.color.set(c); light.intensity = i; light.position.set(p[0], p[1], p[2]); };
    apply(this.key, C.key); apply(this.rim, C.rim); apply(this.fill, C.fill);
    this.renderer.toneMappingExposure = C.exposure;
    this.lightsCfg = C;
  }

  /** 切换花种（已构建的花会被缓存，切换瞬时完成） */
  setFlower(spec) {
    if (this.flower) this.root.remove(this.flower.group);
    let f = this.cache.get(spec.id);
    if (!f) {
      f = buildFlower(spec, this.shared, this.quality);
      this.cache.set(spec.id, f);
    }
    this.flower = f;
    this.root.add(f.group);
    const v = spec.view || {};
    this.view.elev = v.elev ?? 0.55;
    this.view.targetY = v.targetY ?? [0.32, 0.22];
    this.view.worldRadius = v.radius ?? 1.25;
    this.view.tilt = v.tilt ?? 0;
    this.setLights(spec.lights || {});
    if (spec.accent) this.particleUniforms.uAccent.value.set(spec.accent);
    if (spec.pollen) this.particleUniforms.uColor.value.set(spec.pollen);
    this.flower.update(this.shared.uBloom.value, this.shared.uTime.value);
    this.layout();
  }

  /** 空闲时预构建并预编译其余花种，避免切换时卡顿 */
  async prewarm(specs) {
    for (const spec of specs) {
      if (this.cache.has(spec.id)) continue;
      const f = buildFlower(spec, this.shared, this.quality);
      this.cache.set(spec.id, f);
      f.update(this.shared.uBloom.value, 0);
      try {
        if (this.renderer.compileAsync) await this.renderer.compileAsync(f.group, this.camera, this.scene);
      } catch (e) { /* 忽略：首次显示时再编译 */ }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  setBloom(b) { this.shared.uBloom.value = b; }

  resize(w, h, focus, pixelRatio) {
    this.view.w = w; this.view.h = h;
    if (focus) this.view.focus = focus;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.particleUniforms.uPR.value = pixelRatio;
    this.particleUniforms.uScale.value = h / 800;
    this.layout();
  }

  layout() {
    const { w, h, focus } = this.view;
    const cam = this.camera;
    cam.aspect = w / h;
    const half = Math.tan((cam.fov * Math.PI) / 360);
    const dist = (this.view.worldRadius * (h / 2)) / (Math.max(focus.radius, 40) * half);
    this.view.dist = dist;
    cam.setViewOffset(w, h, w / 2 - focus.cx, h / 2 - focus.cy, w, h);
    cam.near = Math.max(0.05, dist - 6); cam.far = dist + 12;
    cam.updateProjectionMatrix();
    this.placeCamera();
  }

  placeCamera() {
    const v = this.view;
    const b = this.shared.uBloom.value;
    const ty = Array.isArray(v.targetY) ? lerp(v.targetY[0], v.targetY[1], b) : v.targetY;
    const e = v.elev;
    this.camera.position.set(0, ty + Math.sin(e) * v.dist, Math.cos(e) * v.dist);
    this.camera.lookAt(0, ty, 0);
    // 灯光跟随相机方位（影棚布光）
    this.rig.position.set(0, 0, 0);
    this.key.target.position.set(0, 0.2, 0);
    this.rim.target.position.set(0, 0.2, 0);
    this.fill.target.position.set(0, 0.2, 0);
    this.shared.uKeyDirW.value.copy(this.key.position).sub(this.key.target.position).normalize();
  }

  render(dt, time) {
    this.shared.uTime.value = time;
    this.spin += dt * 0.07;
    if (this.flower) {
      this.flower.group.rotation.y = this.spin + this.userYaw;
      this.flower.group.rotation.x = this.view.tilt || 0;
      this.flower.update(this.shared.uBloom.value, time);
    }
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.key.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
}
