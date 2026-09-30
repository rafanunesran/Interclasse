// ============================================================
// TIFF EM FLUXO → CMYK (artes em 600 dpi com a cor exata)
// ============================================================
// O PNG não guarda CMYK (o Corel/Photoshop exportam em RGB, e aí a conversão
// para CMYK do site é só uma fórmula simples). O TIFF guarda: uma arte em
// TIFF CMYK entra na folha com os MESMOS valores de tinta do arquivo, sem
// nenhuma conversão.
//
// Mesmo contrato do PngStream: lê faixa por faixa (ou fileira de ladrilhos),
// e devolve o CMYK e a máscara de transparência já comprimidos (zlib), no
// formato que o EPS usa. Só um pedaço do arquivo descomprimido fica na
// memória por vez.
//
// Aceita: TIFF clássico (II/MM), 8 ou 16 bits por canal, CMYK (Photometric
// 5), RGB (2) ou cinza (0/1), com canal alfa extra; faixas ou ladrilhos;
// canais intercalados ou em planos; sem compressão, LZW, Deflate ou
// PackBits; Predictor 2. Precisa do pako.

const TiffStream = (function () {
  const TIPOS = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function ehTiff(bytes) {
    return bytes && bytes.length > 8 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0) ||
       (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42));
  }

  // Lê o primeiro IFD: { tag: [valores] }.
  function lerIfd(bytes) {
    if (bytes.length > 8 && ((bytes[0] === 0x49 && bytes[2] === 43) || (bytes[0] === 0x4d && bytes[3] === 43))) {
      throw new Error("TIFF grande (BigTIFF) não é aceito. Exporte como TIFF comum (menos de 4 GB), com compressão LZW.");
    }
    if (!ehTiff(bytes)) throw new Error("O arquivo não é um TIFF.");
    const le = bytes[0] === 0x49;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (p) => dv.getUint16(p, le);
    const u32 = (p) => dv.getUint32(p, le);
    const ifd = u32(4);
    if (ifd + 2 > bytes.length) throw new Error("TIFF corrompido (IFD fora do arquivo).");
    const n = u16(ifd);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e), tipo = u16(e + 2), cont = u32(e + 4);
      const tam = TIPOS[tipo];
      if (!tam) continue;
      const p = tam * cont <= 4 ? e + 8 : u32(e + 8);
      if (p + tam * cont > bytes.length) continue;
      const v = [];
      for (let k = 0; k < cont; k++) {
        const q = p + k * tam;
        if (tipo === 3) v.push(u16(q));
        else if (tipo === 4) v.push(u32(q));
        else if (tipo === 5) { const d = u32(q + 4); v.push(d ? u32(q) / d : 0); }
        else if (tipo === 1 || tipo === 2 || tipo === 7) v.push(bytes[q]);
        else if (tipo === 8) v.push(dv.getInt16(q, le));
        else if (tipo === 9) v.push(dv.getInt32(q, le));
        else if (tipo === 11) v.push(dv.getFloat32(q, le));
        else if (tipo === 12) v.push(dv.getFloat64(q, le));
        else v.push(bytes[q]);
      }
      tags[tag] = v;
    }
    return { tags, le };
  }

  // Cabeçalho: medidas, cor e resolução. Lança erro (com a explicação)
  // quando o formato não é aceito — é chamado já no envio.
  function lerCabecalho(bytes) {
    const { tags, le } = lerIfd(bytes);
    const t = (k, pad) => (tags[k] ? tags[k][0] : pad);
    const largura = t(256, 0), altura = t(257, 0);
    if (!largura || !altura) throw new Error("TIFF sem as medidas da imagem.");
    const spp = t(277, 1);
    const bits = tags[258] ? tags[258][0] : 1;
    if ((tags[258] || [bits]).some((b) => b !== bits) || (bits !== 8 && bits !== 16)) {
      throw new Error(`TIFF de ${bits} bits por canal não é aceito. Exporte em 8 bits por canal.`);
    }
    if (t(339, 1) !== 1) throw new Error("TIFF com números decimais (float) não é aceito. Exporte em 8 bits por canal.");
    const foto = t(262, -1);
    const base = foto === 5 ? 4 : foto === 2 ? 3 : foto === 0 || foto === 1 ? 1 : 0;
    if (!base) {
      throw new Error(foto === 3
        ? "TIFF com paleta de cores não é aceito. Exporte em CMYK (ou RGB), 8 bits."
        : foto === 8 || foto === 9 || foto === 10
          ? "TIFF em Lab não é aceito. Exporte em CMYK, 8 bits."
          : "Tipo de cor do TIFF não aceito. Exporte em CMYK, 8 bits.");
    }
    if (foto === 5 && t(332, 1) !== 1) throw new Error("TIFF separado em tintas especiais não é aceito. Exporte em CMYK.");
    if (spp < base) throw new Error("TIFF com menos canais do que o esperado.");
    const comp = t(259, 1);
    if (![1, 5, 8, 32946, 32773].includes(comp)) {
      throw new Error(comp === 7
        ? "TIFF com compressão JPEG não é aceito. Exporte com compressão LZW (ou sem compressão)."
        : `Compressão do TIFF não aceita (${comp}). Exporte com compressão LZW (ou sem compressão).`);
    }
    const pred = t(317, 1);
    if (pred !== 1 && pred !== 2) throw new Error("TIFF com predictor de ponto flutuante não é aceito. Exporte com LZW comum.");
    const ladrilhos = !!tags[322];
    if (!(ladrilhos ? tags[324] && tags[325] : tags[273] && tags[279])) throw new Error("TIFF sem os dados da imagem.");
    // Canal alfa: o 1º canal extra marcado como alfa (1 = associado, 2 = não associado).
    const extras = tags[338] || [];
    const alfa = spp > base && (extras[0] === 1 || extras[0] === 2) ? base : -1;
    let dpi = 0;
    const xr = t(282, 0), un = t(296, 2);
    if (xr > 0) dpi = un === 3 ? Math.round(xr * 2.54) : un === 2 ? Math.round(xr) : 0;
    return {
      largura, altura, bits, spp, base, alfa, foto, comp, pred, le, ladrilhos,
      planar: t(284, 1), cmyk: foto === 5, temAlfa: alfa >= 0, dpi, tags
    };
  }

  // ---------------- Descompressão ----------------

  // LZW do TIFF (códigos de 9 a 12 bits, do bit mais significativo, com a
  // troca de largura um código antes — "early change").
  function lzwTiff(dados, tamSaida) {
    const out = new Uint8Array(tamSaida);
    let o = 0;
    const prefixo = new Int16Array(4096), sufixo = new Uint8Array(4096);
    const comp = new Uint16Array(4096), primeiro = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) { prefixo[i] = -1; sufixo[i] = i; comp[i] = 1; primeiro[i] = i; }
    let prox = 258, largura = 9, ant = -1, bit = 0;
    const totalBits = dados.length * 8;
    const emitir = (cod) => {
      const n = comp[cod];
      let p = o + n - 1, c = cod;
      while (c >= 0) {
        if (p < tamSaida) out[p] = sufixo[c];
        p--;
        c = prefixo[c];
      }
      o += n;
    };
    const juntar = (pai, ch) => {
      if (prox >= 4096) return;
      prefixo[prox] = pai; sufixo[prox] = ch; comp[prox] = comp[pai] + 1; primeiro[prox] = primeiro[pai];
      prox++;
    };
    while (bit + largura <= totalBits && o < tamSaida) {
      const b = bit >> 3, s = bit & 7;
      const v = (dados[b] << 16) | ((dados[b + 1] || 0) << 8) | (dados[b + 2] || 0);
      const cod = (v >> (24 - s - largura)) & ((1 << largura) - 1);
      bit += largura;
      if (cod === 257) break;
      if (cod === 256) { prox = 258; largura = 9; ant = -1; continue; }
      if (ant < 0) {
        if (cod > 255) throw new Error("TIFF LZW corrompido.");
        emitir(cod);
      } else if (cod < prox) {
        emitir(cod);
        juntar(ant, primeiro[cod]);
      } else if (cod === prox) {
        juntar(ant, primeiro[ant]);
        emitir(cod);
      } else {
        throw new Error("TIFF LZW corrompido.");
      }
      ant = cod;
      if (prox + 1 >= (1 << largura) && largura < 12) largura++;
    }
    return out;
  }

  function packBits(dados, tamSaida) {
    const out = new Uint8Array(tamSaida);
    let i = 0, o = 0;
    while (i < dados.length && o < tamSaida) {
      const n = (dados[i] << 24) >> 24;
      i++;
      if (n >= 0) {
        const q = Math.min(n + 1, tamSaida - o);
        out.set(dados.subarray(i, i + q), o);
        i += n + 1; o += q;
      } else if (n !== -128) {
        const q = Math.min(1 - n, tamSaida - o);
        out.fill(dados[i], o, o + q);
        i++; o += q;
      }
    }
    return out;
  }

  // Converte o TIFF inteiro. opcoes: pako, passo, nivel, aoProgresso, pausa
  // (as mesmas do PngStream).
  async function converterParaCmyk(bytes, opcoes) {
    const op = opcoes || {};
    const pako = op.pako;
    const passo = Math.max(1, Math.floor(op.passo || 1));
    const lut = op.lut || null; // perfil ICC para TIFF RGB/cinza (js/cor-icc.js)
    const info = lerCabecalho(bytes);
    const { tags } = info;
    const W = info.largura, H = info.altura, spp = info.spp;
    const bps = info.bits >> 3;                  // bytes por amostra
    const planar = info.planar === 2;
    const sppSeg = planar ? 1 : spp;             // amostras por pixel dentro de um pedaço

    // Pedaços (faixas ou ladrilhos) e a geometria deles.
    const lad = info.ladrilhos;
    const tw = lad ? tags[322][0] : W;
    const th = lad ? tags[323][0] : Math.min(H, (tags[278] || [H])[0] || H);
    const offs = lad ? tags[324] : tags[273];
    const conts = lad ? tags[325] : tags[279];
    const porLinha = Math.ceil(W / tw);          // pedaços por fileira
    const fileiras = Math.ceil(H / th);
    const porPlano = porLinha * fileiras;

    const Wo = Math.ceil(W / passo), Ho = Math.ceil(H / passo);
    const bytesMascara = Math.ceil(Wo / 8);
    const nivel = op.nivel || 6;
    const cmykZ = [], mascaraZ = [];
    const defCmyk = new pako.Deflate({ level: nivel });
    defCmyk.onData = (c) => cmykZ.push(c);
    const defMasc = info.temAlfa ? new pako.Deflate({ level: 9 }) : null;
    if (defMasc) defMasc.onData = (c) => mascaraZ.push(c);
    let temTransparencia = false;

    // Descomprime um pedaço (índice no arquivo) para `linhas` × `larg` pixels.
    const bytesLinhaSeg = tw * sppSeg * bps;
    const descomprimir = (idx, linhas) => {
      const ini = offs[idx], fim = ini + conts[idx];
      if (ini == null || fim > bytes.length) throw new Error("TIFF incompleto (dados fora do arquivo).");
      const cru = bytes.subarray(ini, fim);
      const tam = bytesLinhaSeg * linhas;
      let d;
      if (info.comp === 1) d = cru.length >= tam ? cru : (() => { const x = new Uint8Array(tam); x.set(cru); return x; })();
      else if (info.comp === 8 || info.comp === 32946) d = pako.inflate(cru);
      else if (info.comp === 5) d = lzwTiff(cru, tam);
      else d = packBits(cru, tam);
      if (info.pred === 2) {
        d = d === cru ? d.slice() : d;
        for (let y = 0; y < linhas; y++) {
          const o = y * bytesLinhaSeg;
          if (bps === 1) {
            for (let i = sppSeg; i < tw * sppSeg; i++) d[o + i] = (d[o + i] + d[o + i - sppSeg]) & 255;
          } else {
            const le = info.le;
            for (let i = sppSeg; i < tw * sppSeg; i++) {
              const p = o + i * 2, q = o + (i - sppSeg) * 2;
              const v = ((le ? d[p] | (d[p + 1] << 8) : (d[p] << 8) | d[p + 1]) + (le ? d[q] | (d[q + 1] << 8) : (d[q] << 8) | d[q + 1])) & 0xffff;
              if (le) { d[p] = v & 255; d[p + 1] = v >> 8; } else { d[p] = v >> 8; d[p + 1] = v & 255; }
            }
          }
        }
      }
      return d;
    };

    // Uma fileira de pedaços vira linhas de largura inteira, 8 bits, canais
    // intercalados: `buf` (th × W × spp).
    const buf = new Uint8Array(th * W * spp);
    const alto = bps === 2 ? (info.le ? 1 : 0) : 0; // byte alto da amostra de 16 bits

    const saidaCmyk = new Uint8Array(Wo * 4);
    const saidaMasc = new Uint8Array(bytesMascara);
    const base = info.base, alfa = info.alfa, foto = info.foto;
    let yGlobal = 0, feitos = 0, ultimaPausa = Date.now();
    const total = fileiras;

    for (let f = 0; f < fileiras; f++) {
      const linhas = Math.min(th, H - f * th);
      const linhasSeg = lad ? th : linhas; // ladrilho tem sempre th linhas (com sobra)
      for (let c = 0; c < porLinha; c++) {
        const larg = Math.min(tw, W - c * tw);
        for (let pl = 0; pl < (planar ? spp : 1); pl++) {
          const idx = pl * porPlano + f * porLinha + c;
          const d = descomprimir(idx, linhasSeg);
          for (let y = 0; y < linhas; y++) {
            const oSeg = y * bytesLinhaSeg;
            const oBuf = (y * W + c * tw) * spp;
            if (!planar && bps === 1) {
              buf.set(d.subarray(oSeg, oSeg + larg * spp), oBuf);
            } else {
              for (let x = 0; x < larg; x++) {
                for (let s = 0; s < sppSeg; s++) {
                  const ch = planar ? pl : s;
                  buf[oBuf + x * spp + ch] = d[oSeg + (x * sppSeg + s) * bps + alto];
                }
              }
            }
          }
        }
      }
      // Linhas da fileira → CMYK (pulando `passo`).
      for (let y = 0; y < linhas; y++, yGlobal++) {
        if (yGlobal % passo !== 0) continue;
        saidaMasc.fill(0);
        const oL = y * W * spp;
        for (let xo = 0; xo < Wo; xo++) {
          const p = oL + xo * passo * spp;
          const k = xo * 4;
          if (foto === 5) {
            saidaCmyk[k] = buf[p]; saidaCmyk[k + 1] = buf[p + 1]; saidaCmyk[k + 2] = buf[p + 2]; saidaCmyk[k + 3] = buf[p + 3];
          } else if (foto === 2 && lut) {
            CorIcc.rgbParaCmyk(lut, buf[p], buf[p + 1], buf[p + 2], saidaCmyk, k);
          } else if (foto !== 5 && foto !== 2 && lut) {
            const v = foto === 0 ? 255 - buf[p] : buf[p];
            CorIcc.rgbParaCmyk(lut, v, v, v, saidaCmyk, k);
          } else if (foto === 2) {
            const r = buf[p], g = buf[p + 1], b = buf[p + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
            if (max === 0) saidaCmyk[k] = saidaCmyk[k + 1] = saidaCmyk[k + 2] = 0;
            else {
              saidaCmyk[k] = (((max - r) * 255) / max + 0.5) | 0;
              saidaCmyk[k + 1] = (((max - g) * 255) / max + 0.5) | 0;
              saidaCmyk[k + 2] = (((max - b) * 255) / max + 0.5) | 0;
            }
            saidaCmyk[k + 3] = 255 - max;
          } else {
            saidaCmyk[k] = saidaCmyk[k + 1] = saidaCmyk[k + 2] = 0;
            saidaCmyk[k + 3] = foto === 0 ? buf[p] : 255 - buf[p];
          }
          if (alfa >= 0 && buf[p + alfa] < 128) {
            temTransparencia = true;
            saidaMasc[xo >> 3] |= 0x80 >> (xo & 7);
          }
        }
        defCmyk.push(saidaCmyk, false);
        if (defMasc) defMasc.push(saidaMasc, false);
      }
      feitos++;
      // Faixas podem ter uma linha só (milhares delas): a tela respira a
      // cada ~50 ms, não a cada faixa.
      if (Date.now() - ultimaPausa > 50) {
        if (op.aoProgresso) op.aoProgresso(feitos / total);
        if (op.pausa) await op.pausa();
        ultimaPausa = Date.now();
      }
    }
    if (yGlobal < H) throw new Error(`TIFF incompleto (${yGlobal} de ${H} linhas).`);
    defCmyk.push(new Uint8Array(0), true);
    if (defMasc) defMasc.push(new Uint8Array(0), true);
    return {
      largura: Wo,
      altura: Ho,
      dpi: info.dpi,
      cmykZ,
      mascaraZ: temTransparencia ? mascaraZ : null
    };
  }

  return { ehTiff, lerCabecalho, converterParaCmyk };
})();

if (typeof module !== "undefined") module.exports = TiffStream;
