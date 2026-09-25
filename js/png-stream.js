// ============================================================
// PNG EM FLUXO → CMYK (para as artes em 600 dpi)
// ============================================================
// Uma arte de 600 dpi do tamanho de uma frente de camiseta passa fácil de
// 14.000 × 17.000 pixels — o navegador não consegue abrir isso num <canvas>
// (e seriam GBs de memória). Aqui o PNG é lido LINHA A LINHA: descomprime,
// desfaz o filtro PNG, converte para CMYK (fórmula simples, K = 1 − máx) e
// recomprime na hora. Só algumas linhas ficam na memória por vez.
//
// Saída: os dados CMYK e a máscara de transparência já comprimidos (zlib),
// no formato que o EPS usa (FlateDecode). Ver EPS.escreverEps.
//
// Aceita PNG de 8 bits (cinza, RGB, cinza+alfa, RGBA) e com paleta
// (1/2/4/8 bits), sem entrelaçamento. Precisa do pako (inflate + deflate).

const PngStream = (function () {
  const ASSINATURA = [137, 80, 78, 71, 13, 10, 26, 10];

  function u32(b, i) {
    return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  }

  // Percorre os blocos (chunks) do PNG.
  function blocos(bytes) {
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== ASSINATURA[i]) throw new Error("O arquivo não é um PNG.");
    }
    const lista = [];
    let p = 8;
    while (p + 8 <= bytes.length) {
      const tam = u32(bytes, p);
      const tipo = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      lista.push({ tipo, ini: p + 8, fim: p + 8 + tam });
      p += 12 + tam;
      if (tipo === "IEND") break;
    }
    return lista;
  }

  // Cabeçalho: medidas, tipo de cor e resolução. Lança erro (com a
  // explicação) quando o formato não é aceito — é chamado já no envio.
  function lerCabecalho(bytes) {
    const bs = blocos(bytes);
    const ihdr = bs.find((b) => b.tipo === "IHDR");
    if (!ihdr) throw new Error("PNG sem cabeçalho (IHDR).");
    const h = bytes.subarray(ihdr.ini, ihdr.fim);
    const info = {
      largura: u32(h, 0),
      altura: u32(h, 4),
      bits: h[8],
      tipoCor: h[9],
      entrelacado: h[12] === 1,
      dpi: 0
    };
    if (info.entrelacado) {
      throw new Error("PNG entrelaçado (interlaced) não é aceito. Exporte de novo sem entrelaçamento.");
    }
    const ok = info.tipoCor === 3 ? [1, 2, 4, 8].includes(info.bits) : info.bits === 8 && [0, 2, 4, 6].includes(info.tipoCor);
    if (!ok) {
      throw new Error(info.bits === 16
        ? "PNG de 16 bits não é aceito. Exporte em 8 bits por canal (RGB/RGBA)."
        : "Tipo de PNG não aceito. Use RGB ou RGBA de 8 bits.");
    }
    const phys = bs.find((b) => b.tipo === "pHYs");
    if (phys) {
      const ppu = u32(bytes, phys.ini);
      if (bytes[phys.ini + 8] === 1 && ppu > 0) info.dpi = Math.round(ppu * 0.0254);
    }
    info.temAlfa = info.tipoCor === 4 || info.tipoCor === 6 || bs.some((b) => b.tipo === "tRNS");
    return info;
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  // Converte o PNG inteiro. opcoes:
  //   pako      — biblioteca pako (obrigatória)
  //   passo     — 1 = resolução original; 2 = metade (300 dpi a partir de 600)...
  //   nivel     — compressão (1 a 9; padrão 6)
  //   aoProgresso(fração) e `pausa` (função async) para não travar a tela
  async function converterParaCmyk(bytes, opcoes) {
    const op = opcoes || {};
    const pako = op.pako;
    const passo = Math.max(1, Math.floor(op.passo || 1));
    const info = lerCabecalho(bytes);
    const bs = blocos(bytes);
    const W = info.largura, H = info.altura;
    const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[info.tipoCor];
    const bitsPixel = canais * info.bits;
    const bytesLinha = Math.ceil((W * bitsPixel) / 8);
    const bpp = Math.max(1, bitsPixel >> 3);

    // Paleta e transparência (tRNS).
    let paleta = null, alfaPaleta = null, trnsCinza = -1, trnsRgb = null;
    const plte = bs.find((b) => b.tipo === "PLTE");
    if (plte) paleta = bytes.subarray(plte.ini, plte.fim);
    const trns = bs.find((b) => b.tipo === "tRNS");
    if (trns) {
      const t = bytes.subarray(trns.ini, trns.fim);
      if (info.tipoCor === 3) alfaPaleta = t;
      else if (info.tipoCor === 0) trnsCinza = (t[0] << 8) | t[1];
      else if (info.tipoCor === 2) trnsRgb = [(t[0] << 8) | t[1], (t[2] << 8) | t[3], (t[4] << 8) | t[5]];
    }

    const Wo = Math.ceil(W / passo), Ho = Math.ceil(H / passo);
    const bytesMascara = Math.ceil(Wo / 8);
    const nivel = op.nivel || 6;

    const cmykZ = [], mascaraZ = [];
    const defCmyk = new pako.Deflate({ level: nivel });
    defCmyk.onData = (c) => cmykZ.push(c);
    const defMasc = info.temAlfa ? new pako.Deflate({ level: 9 }) : null;
    if (defMasc) defMasc.onData = (c) => mascaraZ.push(c);
    let temTransparencia = false;

    // Linhas de saída acumuladas antes de mandar para o deflate (menos chamadas).
    const LOTE = 64;
    const saidaCmyk = new Uint8Array(Wo * 4 * LOTE);
    const saidaMasc = new Uint8Array(bytesMascara * LOTE);
    let noLote = 0;
    const despejar = (final) => {
      if (noLote > 0) {
        defCmyk.push(saidaCmyk.subarray(0, noLote * Wo * 4), false);
        if (defMasc) defMasc.push(saidaMasc.subarray(0, noLote * bytesMascara), false);
      }
      noLote = 0;
      saidaMasc.fill(0);
      if (final) {
        defCmyk.push(new Uint8Array(0), true);
        if (defMasc) defMasc.push(new Uint8Array(0), true);
      }
    };

    let anterior = new Uint8Array(bytesLinha);
    let atual = new Uint8Array(bytesLinha);
    const linhaCrua = new Uint8Array(bytesLinha + 1);
    let preenchido = 0;
    let y = 0;

    const emitirLinha = () => {
      // Desfaz o filtro PNG da linha.
      const filtro = linhaCrua[0];
      for (let i = 0; i < bytesLinha; i++) {
        const x = linhaCrua[i + 1];
        const a = i >= bpp ? atual[i - bpp] : 0;
        const b = anterior[i];
        const c = i >= bpp ? anterior[i - bpp] : 0;
        let v;
        switch (filtro) {
          case 0: v = x; break;
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: v = x + paeth(a, b, c); break;
          default: throw new Error("PNG corrompido (filtro " + filtro + ").");
        }
        atual[i] = v & 0xff;
      }

      if (y % passo === 0) {
        const oc = noLote * Wo * 4;
        const om = noLote * bytesMascara;
        for (let xo = 0; xo < Wo; xo++) {
          const x = xo * passo;
          let r, g, b, al = 255;
          if (info.tipoCor === 3) {
            const bitPos = x * info.bits;
            const idx = (atual[bitPos >> 3] >> (8 - info.bits - (bitPos & 7))) & ((1 << info.bits) - 1);
            r = paleta[idx * 3]; g = paleta[idx * 3 + 1]; b = paleta[idx * 3 + 2];
            if (alfaPaleta && idx < alfaPaleta.length) al = alfaPaleta[idx];
          } else {
            const o = x * canais;
            if (canais <= 2) {
              r = g = b = atual[o];
              if (canais === 2) al = atual[o + 1];
              else if (trnsCinza === r) al = 0;
            } else {
              r = atual[o]; g = atual[o + 1]; b = atual[o + 2];
              if (canais === 4) al = atual[o + 3];
              else if (trnsRgb && trnsRgb[0] === r && trnsRgb[1] === g && trnsRgb[2] === b) al = 0;
            }
          }
          const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
          const k = oc + xo * 4;
          if (max === 0) {
            saidaCmyk[k] = saidaCmyk[k + 1] = saidaCmyk[k + 2] = 0;
          } else {
            saidaCmyk[k] = (((max - r) * 255) / max + 0.5) | 0;
            saidaCmyk[k + 1] = (((max - g) * 255) / max + 0.5) | 0;
            saidaCmyk[k + 2] = (((max - b) * 255) / max + 0.5) | 0;
          }
          saidaCmyk[k + 3] = 255 - max;
          if (al < 128) {
            temTransparencia = true;
            saidaMasc[om + (xo >> 3)] |= 0x80 >> (xo & 7);
          }
        }
        noLote++;
        if (noLote === LOTE) despejar(false);
      }

      const t = anterior; anterior = atual; atual = t;
      y++;
    };

    const inf = new pako.Inflate();
    inf.onData = (pedaco) => {
      let p = 0;
      while (p < pedaco.length && y < H) {
        const n = Math.min(pedaco.length - p, linhaCrua.length - preenchido);
        linhaCrua.set(pedaco.subarray(p, p + n), preenchido);
        preenchido += n;
        p += n;
        if (preenchido === linhaCrua.length) {
          emitirLinha();
          preenchido = 0;
        }
      }
    };

    // Entrega os IDAT ao inflate em fatias, dando uma pausa à tela entre elas.
    const idats = bs.filter((b) => b.tipo === "IDAT");
    const total = idats.reduce((s, b) => s + (b.fim - b.ini), 0);
    const FATIA = 1 << 20;
    let feito = 0;
    for (const b of idats) {
      for (let p = b.ini; p < b.fim; p += FATIA) {
        const f = Math.min(b.fim, p + FATIA);
        inf.push(bytes.subarray(p, f), false);
        if (inf.err) throw new Error("PNG corrompido: " + inf.msg);
        feito += f - p;
        if (op.aoProgresso) op.aoProgresso(feito / total);
        if (op.pausa) await op.pausa();
      }
    }
    if (y < H) throw new Error(`PNG incompleto (${y} de ${H} linhas).`);
    despejar(true);

    return {
      largura: Wo,
      altura: Ho,
      dpi: info.dpi,
      cmykZ,
      mascaraZ: temTransparencia ? mascaraZ : null
    };
  }

  return { lerCabecalho, converterParaCmyk };
})();

if (typeof module !== "undefined") module.exports = PngStream;
