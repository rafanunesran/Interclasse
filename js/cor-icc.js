// ============================================================
// RGB → CMYK COM PERFIL ICC (artes em PNG / TIFF RGB)
// ============================================================
// O PNG só guarda RGB. Sem perfil, o site converte pela fórmula simples
// (K = 1 − máx), e a cor sai diferente da do Corel. Com o perfil CMYK que o
// Corel usa (enviado em Configurações), a conversão é feita pelo LittleCMS
// (lcms-wasm, o mesmo motor de cor de muitos programas), do sRGB — ou do
// perfil embutido no PNG — para esse CMYK.
//
// Para não chamar o lcms a cada pixel (são dezenas de milhões), monta uma
// tabela (LUT) de 52 × 52 × 52 cores (de 5 em 5 níveis, valores exatos de 8
// bits) e interpola cada pixel nela, em tetraedros — como o próprio lcms faz.
//
// O TIFF CMYK não passa por aqui: os valores dele vão para a folha como estão.

const CorIcc = (function () {
  const URL_LCMS = "https://cdn.jsdelivr.net/npm/lcms-wasm@1.0.5/dist/";
  const PASSO = 5;                 // 0, 5, 10… 255
  const N = 255 / PASSO + 1;       // 52 nós por eixo
  let promessa = null;
  const cacheLut = new Map();

  // Carrega o lcms-wasm (módulo ES + wasm do CDN), uma vez só.
  function carregar() {
    if (!promessa) {
      promessa = import(URL_LCMS + "lcms.min.js")
        .then((m) => m.instantiate({ locateFile: (nome) => URL_LCMS + nome }).then((lcms) => ({ m, lcms })))
        .catch((e) => {
          promessa = null;
          throw new Error("Não foi possível carregar o conversor de cor (sem internet?). " + (e.message || e));
        });
    }
    return promessa;
  }

  // Confere um perfil: { descricao, espaco } ou erro.
  function descreverPerfil(lib, bytes) {
    const { m, lcms } = lib;
    const p = lcms.cmsOpenProfileFromMem(bytes, bytes.byteLength);
    if (!p) throw new Error("Este arquivo não é um perfil ICC válido.");
    try {
      return {
        descricao: lcms.cmsGetProfileInfoASCII(p, m.cmsInfoDescription, "en", "US") || "",
        espaco: lcms.cmsGetColorSpaceASCII(p) || ""
      };
    } finally {
      lcms.cmsCloseProfile(p);
    }
  }

  function chaveDe(bytes) {
    // Tamanho + amostra dos bytes: basta para distinguir perfis diferentes.
    let h = bytes.length;
    for (let i = 0; i < bytes.length; i += Math.max(1, bytes.length >> 10)) h = (h * 31 + bytes[i]) >>> 0;
    return h.toString(36);
  }

  // LUT RGB → CMYK. opcoes: { intencao: "perceptual" | "relativa",
  // origem: bytes de um perfil RGB (o iCCP do PNG) ou nada (sRGB) }.
  function criarLut(lib, bytesCmyk, opcoes) {
    const o = opcoes || {};
    const intencao = o.intencao === "relativa" ? "relativa" : "perceptual";
    const chave = chaveDe(bytesCmyk) + "|" + intencao + "|" + (o.origem ? chaveDe(o.origem) : "srgb");
    if (cacheLut.has(chave)) return cacheLut.get(chave);
    const { m, lcms } = lib;
    const destino = lcms.cmsOpenProfileFromMem(bytesCmyk, bytesCmyk.byteLength);
    if (!destino) throw new Error("O perfil CMYK não pôde ser aberto.");
    let origem = 0;
    if (o.origem) {
      origem = lcms.cmsOpenProfileFromMem(o.origem, o.origem.byteLength);
      if (origem && lcms.cmsGetColorSpaceASCII(origem) !== "RGB") { lcms.cmsCloseProfile(origem); origem = 0; }
    }
    if (!origem) origem = lcms.cmsCreate_sRGBProfile();
    try {
      if (lcms.cmsGetColorSpaceASCII(destino) !== "CMYK") throw new Error("O perfil enviado não é CMYK.");
      const rel = intencao === "relativa";
      const t = lcms.cmsCreateTransform(origem, m.TYPE_RGB_8, destino, m.TYPE_CMYK_8,
        rel ? m.INTENT_RELATIVE_COLORIMETRIC : m.INTENT_PERCEPTUAL, rel ? m.cmsFLAGS_BLACKPOINTCOMPENSATION : 0);
      if (!t) throw new Error("Não foi possível montar a conversão com este perfil.");
      const ent = new Uint8Array(N * N * N * 3);
      let i = 0;
      for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) {
        ent[i++] = r * PASSO; ent[i++] = g * PASSO; ent[i++] = b * PASSO;
      }
      const dados = new Uint8Array(lcms.cmsDoTransform(t, ent, N * N * N));
      lcms.cmsDeleteTransform(t);
      const lut = { n: N, passo: PASSO, dados };
      cacheLut.set(chave, lut);
      return lut;
    } finally {
      lcms.cmsCloseProfile(destino);
      lcms.cmsCloseProfile(origem);
    }
  }

  // Um pixel pela LUT (interpolação tetraédrica). Escreve C, M, Y, K em
  // saida[k..k+3].
  function rgbParaCmyk(lut, r, g, b, saida, k) {
    const d = lut.dados, n = lut.n, p = lut.passo;
    const x0 = (r / p) | 0, y0 = (g / p) | 0, z0 = (b / p) | 0;
    const fx = (r - x0 * p) / p, fy = (g - y0 * p) / p, fz = (b - z0 * p) / p;
    const x1 = fx > 0 ? x0 + 1 : x0, y1 = fy > 0 ? y0 + 1 : y0, z1 = fz > 0 ? z0 + 1 : z0;
    const I = (x, y, z) => ((x * n + y) * n + z) * 4;
    const c000 = I(x0, y0, z0), c111 = I(x1, y1, z1);
    let a, bb, w1, w2, w3;
    // Escolhe o tetraedro pela ordem de fx, fy, fz.
    if (fx >= fy) {
      if (fy >= fz) { a = I(x1, y0, z0); bb = I(x1, y1, z0); w1 = fx - fy; w2 = fy - fz; w3 = fz; }
      else if (fx >= fz) { a = I(x1, y0, z0); bb = I(x1, y0, z1); w1 = fx - fz; w2 = fz - fy; w3 = fy; }
      else { a = I(x0, y0, z1); bb = I(x1, y0, z1); w1 = fz - fx; w2 = fx - fy; w3 = fy; }
    } else {
      if (fx >= fz) { a = I(x0, y1, z0); bb = I(x1, y1, z0); w1 = fy - fx; w2 = fx - fz; w3 = fz; }
      else if (fy >= fz) { a = I(x0, y1, z0); bb = I(x0, y1, z1); w1 = fy - fz; w2 = fz - fx; w3 = fx; }
      else { a = I(x0, y0, z1); bb = I(x0, y1, z1); w1 = fz - fy; w2 = fy - fx; w3 = fx; }
    }
    const w0 = 1 - w1 - w2 - w3;
    for (let c = 0; c < 4; c++) {
      saida[k + c] = (w0 * d[c000 + c] + w1 * d[a + c] + w2 * d[bb + c] + w3 * d[c111 + c] + 0.5) | 0;
    }
  }

  return { carregar, descreverPerfil, criarLut, rgbParaCmyk };
})();

if (typeof module !== "undefined") module.exports = CorIcc;
