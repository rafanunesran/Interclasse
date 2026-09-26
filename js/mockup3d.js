// ============================================================
// MOCKUP 3D (modelos gerados no Tripo + a arte do time)
// ============================================================
// A camiseta gola V (img/mockup3d/camiseta-v.glb) e o manequim
// (img/mockup3d/manequim.glb) vieram do Tripo e foram simplificados (ver
// tools/simplificar-glb.mjs): só a forma, sem a textura/UV do Tripo.
//
// A arte entra por PROJEÇÃO, calculada uma vez por modelo:
//   • cada triângulo da camiseta vai para uma região — frente, costas,
//     manga direita/esquerda ou gola — pela posição dele;
//   • frente e costas: projeção plana (de frente / de trás, sem espelhar);
//   • mangas: cilindro em volta do eixo do braço (a copa no ombro, a barra
//     na barra, o meio do molde na linha de fora do braço);
//   • gola: a cor média da arte da gola (como no mockup em foto).
// As peças planas são as mesmas do mockup em foto (pecasParaMockup).
//
// Na Cena a camiseta veste o manequim: do modelo só ficam as pernas (o
// arquivo já vem cortado — tools/simplificar-glb.mjs --abaixo-de 0.28); o
// pescoço é gerado aqui, e a camiseta é a mesma gola V.
//
// Coordenadas do modelo da camiseta: y para cima (barra em 0, topo da gola
// ≈ 0,98), frente para +z, direita de quem veste para −x.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BASE = new URL("../img/mockup3d/", import.meta.url).href;

// Calibração (unidades do modelo). Ajuste aqui se trocar os modelos.
const CAL = {
  camisa: {
    arquivo: "camiseta-v.glb",
    topo: 0.95,          // altura do topo do molde da frente/costas (ombro)
    meiaLargura: 0.27,   // metade da largura do molde da frente/costas
    // Mangas: eixo do ombro à barra (lado +x = manga esquerda de quem veste).
    manga: { ombro: [0.30, 0.86], barra: [0.405, 0.555] },
    // Onde começa a manga: |x| maior que isto na altura y (linear entre os
    // pontos) — a cava, do sovaco até o ombro.
    cava: [[0.50, 0.255], [0.68, 0.262], [0.80, 0.285], [0.88, 0.30], [1.0, 0.30]],
    gola: { raio: 0.17, faixa: 0.028, yMin: 0.74 }
  },
  manequim: {
    arquivo: "manequim.glb",
    // A camiseta veste o manequim com esta escala e deslocamento.
    camisa: { escala: [0.72, 0.668, 0.82], y: 0.232, z: 0.0 },
    // Do modelo ficam só as pernas (abaixo da barra). O pescoço é gerado (o
    // do modelo some por baixo da gola da camiseta que veio junto): perfil
    // torneado [raio, altura], do peito (dentro da camiseta) à tampa.
    pernasAte: 0.255,
    pescoco: { z: 0.012, perfil: [[0.066, 0.76], [0.063, 0.82], [0.059, 0.87], [0.056, 0.91], [0.055, 0.95], [0.052, 0.972], [0.044, 0.98], [0, 0.98]] }
  }
};

const MAT = { frente: 0, costas: 1, mangaDir: 2, mangaEsq: 3, gola: 4 };

let cacheModelos = null;

function carregarGlb(nome) {
  return new GLTFLoader().loadAsync(BASE + nome).then((g) => {
    let geo = null;
    g.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
    if (!geo) throw new Error("Modelo 3D sem malha: " + nome);
    return geo;
  });
}

function interpolar(tabela, y) {
  if (y <= tabela[0][0]) return tabela[0][1];
  for (let i = 1; i < tabela.length; i++) {
    if (y <= tabela[i][0]) {
      const [y0, v0] = tabela[i - 1], [y1, v1] = tabela[i];
      return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
    }
  }
  return tabela[tabela.length - 1][1];
}

// Camiseta: regiões (grupos de material) e UV por projeção.
function prepararCamisa(geoOrig) {
  const c = CAL.camisa;
  const geo = geoOrig.index ? geoOrig.toNonIndexed() : geoOrig.clone();
  geo.computeVertexNormals();
  const P = geo.attributes.position;
  const n = P.count;

  // Centro do pescoço (z) e contorno da gola: para cada ângulo em volta do
  // pescoço, o ponto mais alto perto dele é a borda da gola (no V, desce).
  let zSoma = 0, zN = 0;
  for (let i = 0; i < n; i++) if (P.getY(i) > 0.9) { zSoma += P.getZ(i); zN++; }
  const zc = zN ? zSoma / zN : 0;
  const BINS = 90;
  const topoGola = new Float32Array(BINS).fill(-1);
  const bin = (x, z) => Math.floor(((Math.atan2(z - zc, x) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (y < c.gola.yMin || Math.hypot(x, z - zc) > c.gola.raio) continue;
    const b = bin(x, z);
    if (y > topoGola[b]) topoGola[b] = y;
  }
  // Suaviza os buracos (ângulos sem pontos).
  for (let b = 0; b < BINS; b++) {
    if (topoGola[b] < 0) topoGola[b] = Math.max(topoGola[(b + BINS - 1) % BINS], topoGola[(b + 1) % BINS]);
  }

  // Costura lateral: em cada altura, o z dos pontos mais de fora do tronco
  // (a frente e as costas se dividem ali, e não no meio do volume).
  const FAIXAS = 60;
  const lateral = Array.from({ length: FAIXAS }, () => ({ ax: -1, z: 0, n: 0 }));
  const faixa = (y) => Math.max(0, Math.min(FAIXAS - 1, Math.floor((y / 1.0) * FAIXAS)));
  for (let i = 0; i < n; i++) {
    const x = Math.abs(P.getX(i)), y = P.getY(i);
    if (y > 0.45 && x > interpolar(c.cava, y) - 0.01) continue; // manga
    const f = lateral[faixa(y)];
    if (x > f.ax + 0.004) { f.ax = x; f.z = P.getZ(i); f.n = 1; }
    else if (x > f.ax - 0.004) { f.z += P.getZ(i); f.n++; }
  }
  const zLateral = lateral.map((f) => (f.n ? f.z / f.n : zc));
  for (let k = 0; k < FAIXAS; k++) if (!lateral[k].n) zLateral[k] = k ? zLateral[k - 1] : zc;

  const ombro = new THREE.Vector2(...c.manga.ombro), barra = new THREE.Vector2(...c.manga.barra);
  const eixo = new THREE.Vector2().subVectors(barra, ombro);
  const compr = eixo.length();
  eixo.normalize();

  const uv = new Float32Array(n * 2);
  const regiao = new Uint8Array(n / 3);
  const ctr = new THREE.Vector3();
  for (let t = 0; t < n / 3; t++) {
    ctr.set(0, 0, 0);
    for (let k = 0; k < 3; k++) ctr.add(new THREE.Vector3().fromBufferAttribute(P, t * 3 + k));
    ctr.multiplyScalar(1 / 3);
    const ax = Math.abs(ctr.x);
    let r;
    const rPesc = Math.hypot(ctr.x, ctr.z - zc);
    if (ctr.y > c.gola.yMin && rPesc < c.gola.raio + 0.01 && ctr.y > topoGola[bin(ctr.x, ctr.z)] - c.gola.faixa) r = MAT.gola;
    else if (ctr.y > 0.45 && ax > interpolar(c.cava, ctr.y)) r = ctr.x < 0 ? MAT.mangaDir : MAT.mangaEsq;
    else r = ctr.z >= zLateral[faixa(ctr.y)] ? MAT.frente : MAT.costas;
    regiao[t] = r;
  }

  const p = new THREE.Vector3();
  for (let t = 0; t < n / 3; t++) {
    const r = regiao[t];
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      p.fromBufferAttribute(P, i);
      let u, v;
      if (r === MAT.frente || r === MAT.costas || r === MAT.gola) {
        u = (p.x + c.meiaLargura) / (2 * c.meiaLargura);
        if (r !== MAT.frente) u = 1 - u; // costas vistas de trás
        v = (c.topo - p.y) / c.topo;
      } else {
        const lado = r === MAT.mangaDir ? -1 : 1;
        // No plano (|x|, y): distância ao longo do eixo do braço.
        const q = new THREE.Vector2(Math.abs(p.x), p.y).sub(ombro);
        const ao = q.dot(eixo);
        v = Math.max(0, Math.min(1, ao / compr));
        // Ângulo em volta do eixo: 0 na linha de fora; para a frente (+z) na
        // manga direita e para trás na esquerda — assim, visto de fora com a
        // copa para cima, o molde não fica espelhado.
        const fora = q.x * -eixo.y + q.y * eixo.x; // componente perpendicular (para fora)
        const ang = Math.atan2((p.z - zc) * (lado < 0 ? 1 : -1), fora);
        u = 0.5 + ang / (2 * Math.PI);
      }
      uv[i * 2] = u;
      uv[i * 2 + 1] = 1 - v;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  // Grupos contínuos por região (ordena os triângulos por região).
  const ordem = Array.from({ length: n / 3 }, (_, t) => t).sort((a, b) => regiao[a] - regiao[b]);
  const novo = new THREE.BufferGeometry();
  for (const nome of ["position", "normal", "uv"]) {
    const a = geo.attributes[nome], tam = a.itemSize;
    const arr = new Float32Array(a.array.length);
    ordem.forEach((t, j) => arr.set(a.array.subarray(t * 3 * tam, (t + 1) * 3 * tam), j * 3 * tam));
    novo.setAttribute(nome, new THREE.BufferAttribute(arr, tam));
  }
  let ini = 0;
  for (let j = 1; j <= ordem.length; j++) {
    if (j === ordem.length || regiao[ordem[j]] !== regiao[ordem[ini]]) {
      novo.addGroup(ini * 3, (j - ini) * 3, regiao[ordem[ini]]);
      ini = j;
    }
  }
  novo.computeBoundingBox();
  return novo;
}

// Manequim: só as pernas (a camiseta e o pescoço dele saem; o pescoço é
// gerado em boneco()).
function prepararManequim(geoOrig) {
  const m = CAL.manequim;
  const geo = geoOrig.index ? geoOrig.toNonIndexed() : geoOrig.clone();
  const P = geo.attributes.position;
  const fica = [];
  for (let t = 0; t < P.count / 3; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += P.getX(t * 3 + k); y += P.getY(t * 3 + k); z += P.getZ(t * 3 + k); }
    x /= 3; y /= 3; z /= 3;
    if (y < m.pernasAte) fica.push(t);
  }
  const arr = new Float32Array(fica.length * 9);
  fica.forEach((t, j) => arr.set(P.array.subarray(t * 9, t * 9 + 9), j * 9));
  const novo = new THREE.BufferGeometry();
  novo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  novo.computeVertexNormals();
  return novo;
}

async function modelos() {
  if (!cacheModelos) {
    cacheModelos = Promise.all([carregarGlb(CAL.camisa.arquivo), carregarGlb(CAL.manequim.arquivo)])
      .then(([camisa, manequim]) => ({ camisa: prepararCamisa(camisa), manequim: prepararManequim(manequim) }))
      .catch((e) => { cacheModelos = null; throw e; });
  }
  return cacheModelos;
}

// ---------------- Materiais ----------------

const CORES_DEBUG = [0x2e7dd7, 0xd7432e, 0x2ea84f, 0xe0b400, 0x8a2be2];

function texturaDe(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// pecas = { frente: { canvas }, costas, mangaEsq, mangaDir, gola: { cor } }
// (a manga que faltar usa a outra — uma arte para as duas).
function materiais(pecas, opcoes) {
  const op = opcoes || {};
  const tecido = (props) => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, ...props });
  if (op.debug) return CORES_DEBUG.map((cor) => tecido({ color: cor }));
  const p = pecas || {};
  const tex = (id) => {
    const alvo = p[id] && p[id].canvas ? p[id] : id === "mangaDir" ? p.mangaEsq : id === "mangaEsq" ? p.mangaDir : null;
    return alvo && alvo.canvas ? tecido({ map: texturaDe(alvo.canvas) }) : tecido({ color: 0xf3f3f3 });
  };
  const golaCor = (p.gola && p.gola.cor) || "#f3f3f3";
  return [tex("frente"), tex("costas"), tex("mangaDir"), tex("mangaEsq"), tecido({ color: new THREE.Color(golaCor) })];
}

function materialManequim() {
  return new THREE.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.9 });
}

// ---------------- Cena ----------------

function fundoBege() {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#efe2cc");
  grad.addColorStop(0.55, "#d9c09a");
  grad.addColorStop(1, "#c7a57a");
  g.fillStyle = grad; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function luzes(cena) {
  cena.add(new THREE.HemisphereLight(0xffffff, 0x9b8466, 1.25));
  const chave = new THREE.DirectionalLight(0xffffff, 1.9);
  chave.position.set(1.6, 2.6, 3);
  chave.castShadow = true;
  chave.shadow.mapSize.set(1024, 1024);
  chave.shadow.camera.left = -2; chave.shadow.camera.right = 2;
  chave.shadow.camera.top = 2; chave.shadow.camera.bottom = -2;
  chave.shadow.radius = 6;
  cena.add(chave);
  const recorte = new THREE.DirectionalLight(0xffffff, 0.7);
  recorte.position.set(-2.5, 1.5, -2.5);
  cena.add(recorte);
}

function chao(cena) {
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.18 }));
  plano.rotation.x = -Math.PI / 2;
  plano.receiveShadow = true;
  cena.add(plano);
}

// Uma camiseta (opcionalmente vestindo o manequim), como um grupo.
function boneco(mod, mats, comManequim) {
  const g = new THREE.Group();
  const camisa = new THREE.Mesh(mod.camisa, mats);
  camisa.castShadow = true;
  if (comManequim) {
    const m = CAL.manequim.camisa;
    camisa.scale.set(...m.escala);
    camisa.position.set(0, m.y, m.z);
    const matMan = materialManequim();
    const man = new THREE.Mesh(mod.manequim, matMan);
    man.castShadow = true;
    const pc = CAL.manequim.pescoco;
    const pesc = new THREE.Mesh(new THREE.LatheGeometry(pc.perfil.map(([r, y]) => new THREE.Vector2(r, y)), 48), matMan);
    pesc.position.z = pc.z;
    pesc.castShadow = true;
    g.add(man, pesc);
  }
  g.add(camisa);
  return g;
}

// Monta a cena de uma vista: { cena, camera }.
function montar(vista, mod, mats) {
  const cena = new THREE.Scene();
  cena.background = fundoBege();
  luzes(cena);
  chao(cena);
  const camera = new THREE.PerspectiveCamera(26, 1024 / 1536, 0.05, 50);
  if (vista === "cena") {
    const frente = boneco(mod, mats, true);
    frente.rotation.y = -0.38;
    frente.position.set(-0.08, 0, 0.3);
    const tras = boneco(mod, mats, true);
    tras.rotation.y = Math.PI + 0.3;
    tras.position.set(0.6, 0, -0.85);
    cena.add(frente, tras);
    camera.position.set(0.2, 0.6, 4.1);
    camera.lookAt(0.2, 0.5, 0);
  } else {
    const camisa = boneco(mod, mats, false);
    if (vista === "costas") camisa.rotation.y = Math.PI;
    cena.add(camisa);
    camera.position.set(0, 0.52, 3.2);
    camera.lookAt(0, 0.49, 0);
  }
  return { cena, camera };
}

let rendererCompartilhado = null;
function renderer(w, h) {
  if (!rendererCompartilhado) {
    rendererCompartilhado = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    rendererCompartilhado.outputColorSpace = THREE.SRGBColorSpace;
    rendererCompartilhado.shadowMap.enabled = true;
    rendererCompartilhado.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererCompartilhado.toneMapping = THREE.ACESFilmicToneMapping;
    rendererCompartilhado.toneMappingExposure = 1.05;
  }
  rendererCompartilhado.setPixelRatio(1);
  rendererCompartilhado.setSize(w, h, false);
  return rendererCompartilhado;
}

function suportado() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) {
    return false;
  }
}

// Mesma assinatura do mockup em foto: devolve um canvas 1024 × 1536.
async function renderizar(vista, pecas, opcoes) {
  if (!suportado()) throw new Error("Sem WebGL neste navegador.");
  const mod = await modelos();
  const mats = materiais(pecas, opcoes);
  const { cena, camera } = montar(vista, mod, mats);
  const r = renderer(1024, 1536);
  r.render(cena, camera);
  const saida = document.createElement("canvas");
  saida.width = 1024; saida.height = 1536;
  saida.getContext("2d").drawImage(r.domElement, 0, 0);
  mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  return saida;
}

// Visualizador que gira (arrastar) e aproxima (roda/pinça). Devolve { destruir }.
async function visualizador(container, pecas, opcoes) {
  if (!suportado()) throw new Error("Sem WebGL neste navegador.");
  const op = opcoes || {};
  const mod = await modelos();
  const mats = materiais(pecas, op);
  const cena = new THREE.Scene();
  cena.background = fundoBege();
  luzes(cena);
  chao(cena);
  const obj = boneco(mod, mats, op.manequim !== false);
  cena.add(obj);
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(r.domElement);
  r.domElement.style.width = "100%";
  r.domElement.style.height = "100%";
  r.domElement.style.touchAction = "none";
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const alvoY = op.manequim !== false ? 0.58 : 0.49;
  camera.position.set(0, alvoY + 0.05, 2.6);
  const controles = new OrbitControls(camera, r.domElement);
  controles.target.set(0, alvoY, 0);
  controles.enablePan = false;
  controles.minDistance = 1.1;
  controles.maxDistance = 4;
  controles.minPolarAngle = 0.6;
  controles.maxPolarAngle = 1.75;
  controles.autoRotate = op.girar !== false;
  controles.autoRotateSpeed = 1.2;
  controles.addEventListener("start", () => (controles.autoRotate = false));
  let ativo = true;
  const ajustar = () => {
    const w = container.clientWidth || 400, h = container.clientHeight || 500;
    r.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  ajustar();
  const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ajustar) : null;
  if (obs) obs.observe(container);
  const quadro = () => {
    if (!ativo) return;
    controles.update();
    r.render(cena, camera);
    requestAnimationFrame(quadro);
  };
  quadro();
  return {
    destruir() {
      ativo = false;
      if (obs) obs.disconnect();
      controles.dispose();
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      r.dispose();
      r.domElement.remove();
    }
  };
}

const Mockup3D = { renderizar, visualizador, suportado, CAL };
window.Mockup3D = Mockup3D;
export default Mockup3D;
