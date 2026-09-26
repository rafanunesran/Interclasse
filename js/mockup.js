// ============================================================
// MOCKUP REALISTA (fotos base + arte do time)
// ============================================================
// A prévia "Mockup" do time veste a arte numa FOTO de verdade: camiseta
// branca lisa num manequim artístico (fotos em img/mockup/, geradas por IA).
// Para cada região da foto (corpo, mangas, gola):
//   1. a peça plana do time (arte + brasão + logo + nome/número) é desenhada
//      num canvas;
//   2. é DEFORMADA para a perspectiva da foto: o retângulo da peça cobre a
//      caixa da região (malha de triângulos; `gama` comprime um lado, para a
//      camiseta de 3/4 "virar" como na foto — ex.: a gola V cai no lugar);
//   3. é recortada pelo `poligono` da região E pela máscara do tecido (os
//      pixels brancos e pouco saturados da foto — assim o fundo e o manequim
//      nunca recebem arte);
//   4. entra em MULTIPLY sobre a foto: o branco da camiseta vira a arte e as
//      sombras/dobras do tecido continuam lá. Os brilhos voltam por cima.
// A gola é uma faixa: recebe a cor média da arte da gola.
//
// Coordenadas das regiões em pixels da foto (1024 × 1536). Na vista de
// frente, a manga à esquerda de quem olha é a DIREITA de quem veste.

const MOCKUP_BASE = {
  cena: {
    img: "img/mockup/cena.webp", largura: 1024, altura: 1536,
    regioes: [
      { peca: "costas", gama: 1,
        poligono: [[716, 452], [755, 420], [808, 430], [862, 420], [935, 470], [915, 600], [932, 700], [940, 950], [870, 985], [800, 982], [665, 962], [668, 800], [672, 695], [716, 690]] },
      { peca: "mangaEsq", gama: 1,
        poligono: [[716, 452], [690, 462], [676, 560], [670, 660], [716, 690]] },
      { peca: "mangaDir", gama: 1,
        poligono: [[935, 470], [965, 520], [990, 590], [1006, 652], [952, 668], [915, 640], [915, 560]] },
      { peca: "gola", tipo: "faixa", largura: 8, caminho: [[755, 422], [808, 432], [862, 421]] },
      { peca: "mangaDir", gama: 1,
        poligono: [[92, 388], [118, 460], [120, 560], [112, 672], [80, 672], [22, 644], [38, 520], [62, 422]] },
      { peca: "mangaEsq", gama: 1,
        poligono: [[603, 344], [650, 376], [682, 468], [702, 560], [720, 658], [642, 694], [560, 696], [550, 560], [562, 420]] },
      { peca: "frente", gama: 1.32,
        poligono: [[92, 388], [252, 288], [300, 390], [455, 262], [603, 344], [562, 420], [550, 560], [562, 692], [566, 900], [582, 1140], [500, 1204], [300, 1206], [106, 1168], [104, 900], [112, 672], [120, 560], [118, 460]] },
      { peca: "gola", tipo: "faixa", largura: 12, caminho: [[254, 292], [280, 345], [300, 390], [370, 325], [454, 266]] }
    ]
  },
  frente: {
    img: "img/mockup/frente.webp", largura: 1024, altura: 1536,
    regioes: [
      { peca: "mangaDir", gama: 1,
        poligono: [[200, 346], [262, 400], [290, 470], [300, 560], [303, 650], [298, 712], [252, 756], [160, 738], [62, 696], [86, 600], [108, 480], [124, 405], [160, 368]] },
      { peca: "mangaEsq", gama: 1,
        poligono: [[805, 346], [852, 380], [884, 446], [908, 556], [940, 690], [888, 728], [810, 720], [812, 600], [815, 450]] },
      { peca: "frente", gama: 0.69,
        poligono: [[200, 350], [398, 244], [590, 398], [640, 262], [805, 346], [815, 450], [812, 600], [815, 714], [818, 900], [825, 1100], [836, 1372], [700, 1414], [500, 1414], [300, 1414], [248, 1380], [252, 1200], [258, 1000], [268, 850], [292, 720], [303, 650], [300, 560], [290, 470], [262, 400]] },
      { peca: "gola", tipo: "faixa", largura: 14, caminho: [[402, 246], [470, 304], [545, 364], [590, 398], [614, 338], [636, 264]] }
    ]
  },
  costas: {
    img: "img/mockup/costas.webp", largura: 1024, altura: 1536,
    regioes: [
      { peca: "mangaEsq", gama: 1,
        poligono: [[188, 396], [213, 500], [238, 640], [256, 764], [160, 764], [56, 712], [92, 570], [136, 436]] },
      { peca: "mangaDir", gama: 1,
        poligono: [[838, 396], [810, 500], [784, 640], [770, 764], [864, 766], [966, 712], [932, 570], [888, 436]] },
      { peca: "costas", gama: 1,
        poligono: [[188, 396], [250, 342], [352, 308], [500, 328], [648, 302], [770, 342], [838, 396], [810, 500], [784, 640], [772, 760], [774, 1000], [786, 1300], [700, 1352], [500, 1360], [300, 1352], [240, 1302], [250, 1000], [254, 760], [238, 640], [213, 500]] },
      { peca: "gola", tipo: "faixa", largura: 16, caminho: [[352, 314], [420, 324], [500, 330], [580, 324], [648, 306]] }
    ]
  }
};

const Mockup = (function () {
  const fotos = {}; // vista -> Promise<{ img, tecido }>

  function carregarImagem(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível carregar " + src));
      img.src = src;
    });
  }

  // Máscara do tecido: alfa alto onde a foto é clara e pouco saturada (a
  // camiseta branca); zero no fundo bege e nas partes coloridas.
  function mascaraDoTecido(img) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dados = ctx.getImageData(0, 0, c.width, c.height);
    const p = dados.data;
    const brilho = document.createElement("canvas");
    brilho.width = c.width;
    brilho.height = c.height;
    const cb = brilho.getContext("2d");
    const dadosBrilho = cb.createImageData(c.width, c.height);
    const b = dadosBrilho.data;
    for (let i = 0; i < p.length; i += 4) {
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      const sat = mx - Math.min(p[i], p[i + 1], p[i + 2]);
      const a = Math.max(0, Math.min(1, (52 - sat) / 18)) * Math.max(0, Math.min(1, (mx - 135) / 30));
      // Brilho do tecido (para devolver o "lustro" depois do multiply).
      const lum = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
      b[i] = b[i + 1] = b[i + 2] = 255;
      b[i + 3] = Math.round(255 * a * Math.max(0, Math.min(1, (lum - 226) / 26)) * 0.55);
      p[i] = p[i + 1] = p[i + 2] = 255;
      p[i + 3] = Math.round(255 * a);
    }
    ctx.putImageData(dados, 0, 0);
    cb.putImageData(dadosBrilho, 0, 0);
    return { tecido: c, brilho };
  }

  function carregarFoto(vista) {
    const base = MOCKUP_BASE[vista];
    if (!fotos[vista]) {
      fotos[vista] = carregarImagem(base.img).then((img) => ({ img, ...mascaraDoTecido(img) }))
        .catch((e) => { delete fotos[vista]; throw e; });
    }
    return fotos[vista];
  }

  // Ponto (u, v) ∈ [0,1]² da peça → ponto na foto, dentro do quadrilátero
  // (interpolação bilinear; `gama` puxa as colunas para um dos lados).
  function mapear(quad, gama, u, v) {
    const g = Math.pow(u, gama || 1);
    const [tl, tr, br, bl] = quad;
    const topo = [tl[0] + (tr[0] - tl[0]) * g, tl[1] + (tr[1] - tl[1]) * g];
    const base = [bl[0] + (br[0] - bl[0]) * g, bl[1] + (br[1] - bl[1]) * g];
    return [topo[0] + (base[0] - topo[0]) * v, topo[1] + (base[1] - topo[1]) * v];
  }

  // Desenha o triângulo (u0,v0)(u1,v1)(u2,v2) da imagem no triângulo
  // (x0,y0)(x1,y1)(x2,y2) do destino (transformação afim + recorte).
  function triangulo(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
    // Aumenta um pouco o triângulo de destino para esconder as emendas.
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
    const cresce = (x, y) => {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return [x + (dx / d) * 0.7, y + (dy / d) * 0.7];
    };
    const den = (u0 - u2) * (v1 - v2) - (u1 - u2) * (v0 - v2);
    if (!den) return;
    const a = ((x0 - x2) * (v1 - v2) - (x1 - x2) * (v0 - v2)) / den;
    const b = ((y0 - y2) * (v1 - v2) - (y1 - y2) * (v0 - v2)) / den;
    const c = ((x1 - x2) * (u0 - u2) - (x0 - x2) * (u1 - u2)) / den;
    const d = ((y1 - y2) * (u0 - u2) - (y0 - y2) * (u1 - u2)) / den;
    const e = x2 - a * u2 - c * v2;
    const f = y2 - b * u2 - d * v2;
    ctx.save();
    ctx.beginPath();
    const [p0, p1, p2] = [cresce(x0, y0), cresce(x1, y1), cresce(x2, y2)];
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function deformar(ctx, fonte, quad, gama) {
    const N = 16;
    const W = fonte.width, H = fonte.height;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
        const p00 = mapear(quad, gama, u0, v0), p10 = mapear(quad, gama, u1, v0);
        const p01 = mapear(quad, gama, u0, v1), p11 = mapear(quad, gama, u1, v1);
        triangulo(ctx, fonte, p00[0], p00[1], p10[0], p10[1], p11[0], p11[1], u0 * W, v0 * H, u1 * W, v0 * H, u1 * W, v1 * H);
        triangulo(ctx, fonte, p00[0], p00[1], p11[0], p11[1], p01[0], p01[1], u0 * W, v0 * H, u1 * W, v1 * H, u0 * W, v1 * H);
      }
    }
  }

  // Caixa da região (com folga): é para onde a peça inteira é esticada.
  function quadDaRegiao(r) {
    const xs = r.poligono.map((p) => p[0]), ys = r.poligono.map((p) => p[1]);
    const x1 = Math.min(...xs) - 6, x2 = Math.max(...xs) + 6, y1 = Math.min(...ys) - 6, y2 = Math.max(...ys) + 6;
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  }

  function novaCamada(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // Máscara de uma região: o polígono (ou a faixa) ∩ o tecido.
  function mascaraDaRegiao(r, foto, w, h) {
    const m = novaCamada(w, h);
    const ctx = m.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    const pts = r.tipo === "faixa" ? r.caminho : r.poligono;
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (r.tipo === "faixa") {
      ctx.lineWidth = r.largura;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(foto.tecido, 0, 0);
    return m;
  }

  // Monta o mockup de uma vista. `pecas` = { pecaId: { canvas, cor } } — o
  // canvas é a peça plana; a cor (css) é usada na faixa da gola. Devolve o
  // canvas no tamanho da foto.
  async function renderizar(vista, pecas) {
    const base = MOCKUP_BASE[vista];
    const foto = await carregarFoto(vista);
    const w = base.largura, h = base.altura;
    const saida = novaCamada(w, h);
    const ctx = saida.getContext("2d");
    ctx.drawImage(foto.img, 0, 0, w, h);
    const uniao = novaCamada(w, h);
    const cu = uniao.getContext("2d");

    base.regioes.forEach((r) => {
      const p = pecas[r.peca];
      if (!p) return;
      const mascara = mascaraDaRegiao(r, foto, w, h);
      const camada = novaCamada(w, h);
      const cc = camada.getContext("2d");
      if (r.tipo === "faixa") {
        if (!p.cor) return;
        cc.fillStyle = p.cor;
        cc.fillRect(0, 0, w, h);
      } else {
        if (!p.canvas) return;
        deformar(cc, p.canvas, quadDaRegiao(r), r.gama);
      }
      cc.globalCompositeOperation = "destination-in";
      cc.drawImage(mascara, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(camada, 0, 0);
      cu.drawImage(mascara, 0, 0);
    });

    // O lustro do tecido volta por cima (só onde tem arte).
    const brilho = novaCamada(w, h);
    const cbr = brilho.getContext("2d");
    cbr.drawImage(foto.brilho, 0, 0);
    cbr.globalCompositeOperation = "destination-in";
    cbr.drawImage(uniao, 0, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(brilho, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return saida;
  }

  return { renderizar, carregarFoto, vistas: Object.keys(MOCKUP_BASE) };
})();
