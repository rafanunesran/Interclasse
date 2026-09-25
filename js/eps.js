// ============================================================
// GERADOR DE EPS CMYK (folha montada para impressão)
// ============================================================
// Monta, no próprio navegador, a folha de impressão de uma leva: cada peça de
// cada camiseta (frente, costas, manga...) com o molde do tamanho dela, as
// partes da arte (EPS vetorial e PNG em alta) e o nome/número em CURVAS, tudo
// encaixado lado a lado na largura do rolo/folha.
//
// Não é preciso "entender" os EPS enviados: um EPS pode ser embutido dentro de
// outro como está (BeginEPSF/EndEPSF), então as cores CMYK e os vetores do
// arquivo original chegam intactos. Dele só lemos o %%BoundingBox.
//
// Este arquivo não depende do painel nem do Firebase (dá para testar fora do
// navegador). As bibliotecas opentype.js (fonte) e pako (compressão) são
// recebidas prontas; quem carrega é js/artes.js.
//
// Coordenadas: tudo em MILÍMETROS, com origem no canto de CIMA à esquerda e
// y crescendo para baixo (igual à tela do editor). Só na hora de escrever o
// PostScript é que viram pontos (1/72 pol.) com a origem embaixo.

const EPS = (function () {
  const PT_POR_MM = 72 / 25.4;

  // ---------------- Leitura de EPS ----------------

  // Texto "latin1" de um trecho de bytes (os comentários DSC são ASCII).
  function textoDeBytes(bytes, ini, fim) {
    let s = "";
    const f = Math.min(fim, bytes.length);
    for (let i = ini; i < f; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, f)));
    }
    return s;
  }

  // EPS "binário" do Windows (comum em arquivos do Corel/Illustrator com
  // prévia TIFF/WMF): começa com C5 D0 D3 C6 e diz onde está o PostScript.
  // Devolve só a parte PostScript; um EPS comum volta como está.
  function extrairPostScript(bytes) {
    if (bytes.length > 30 && bytes[0] === 0xc5 && bytes[1] === 0xd0 &&
        bytes[2] === 0xd3 && bytes[3] === 0xc6) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const ini = dv.getUint32(4, true);
      const tam = dv.getUint32(8, true);
      return bytes.subarray(ini, ini + tam);
    }
    return bytes;
  }

  // Lê o tamanho do desenho no %%HiResBoundingBox (ou %%BoundingBox), em pontos.
  // Aceita "(atend)", quando o valor vem no fim do arquivo.
  function lerBoundingBox(bytes) {
    const ps = extrairPostScript(bytes);
    const achar = (texto) => {
      const hi = texto.match(/%%HiResBoundingBox:\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/);
      const bb = hi || texto.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
      if (!bb) return null;
      const [x1, y1, x2, y2] = bb.slice(1, 5).map(Number);
      if (![x1, y1, x2, y2].every(isFinite) || x2 <= x1 || y2 <= y1) return null;
      return { x1, y1, x2, y2 };
    };
    if (!/^%!PS/.test(textoDeBytes(ps, 0, 10))) {
      throw new Error("Não parece um arquivo EPS (falta o cabeçalho %!PS).");
    }
    const bbox = achar(textoDeBytes(ps, 0, 65536)) ||
      (ps.length > 65536 ? achar(textoDeBytes(ps, ps.length - 65536, ps.length)) : null);
    if (!bbox) throw new Error("O EPS não informa o tamanho (%%BoundingBox).");
    return bbox;
  }

  // Tamanho, em mm, de um EPS a partir do bbox.
  function tamanhoMmDoBbox(bbox) {
    return { w: (bbox.x2 - bbox.x1) / PT_POR_MM, h: (bbox.y2 - bbox.y1) / PT_POR_MM };
  }

  // ---------------- Imagem (PNG) → CMYK ----------------

  // Converte os pixels RGBA (ImageData) para CMYK com a fórmula simples
  // (K = 1 − max(R,G,B)). A transparência vira uma máscara de 1 bit:
  // pixel com menos da metade de opacidade não é impresso. Devolve
  // { largura, altura, cmyk, mascara } — mascara é null quando tudo é opaco.
  function cmykDeRgba(largura, altura, rgba) {
    const n = largura * altura;
    const cmyk = new Uint8Array(n * 4);
    const bytesLinha = Math.ceil(largura / 8);
    const mascara = new Uint8Array(bytesLinha * altura);
    let temTransparencia = false;

    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
      const max = Math.max(r, g, b);
      const k = 255 - max;
      const o = i * 4;
      if (max === 0) {
        cmyk[o] = cmyk[o + 1] = cmyk[o + 2] = 0;
      } else {
        cmyk[o] = Math.round(((max - r) * 255) / max);
        cmyk[o + 1] = Math.round(((max - g) * 255) / max);
        cmyk[o + 2] = Math.round(((max - b) * 255) / max);
      }
      cmyk[o + 3] = k;
      if (a < 128) {
        temTransparencia = true;
        const y = Math.floor(i / largura);
        const x = i - y * largura;
        // Bit 1 = mascarado (não pinta), com /Decode [0 1].
        mascara[y * bytesLinha + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { largura, altura, cmyk, mascara: temTransparencia ? mascara : null };
  }

  // ---------------- Texto em curvas ----------------

  // Altura das maiúsculas da fonte (em unidades da fonte): é ela que ocupa a
  // altura da caixa, para "ANA" e "JOÃO GUILHERME" saírem da mesma altura.
  function alturaMaiusculas(font) {
    const os2 = font.tables && font.tables.os2;
    if (os2 && os2.sCapHeight > 0) return os2.sCapHeight;
    const h = font.charToGlyph("H");
    const bb = h && h.getBoundingBox ? h.getBoundingBox() : null;
    if (bb && bb.y2 > 0) return bb.y2;
    return font.unitsPerEm * 0.7;
  }

  // Desenha o texto dentro de uma caixa (w × h mm) e devolve o contorno das
  // letras como comandos de caminho, em mm e relativos ao canto de cima da
  // caixa. É a MESMA função que desenha a prévia do editor e o EPS final.
  //
  // opcoes:
  //   maiusculas   — converte para maiúsculas (padrão: true)
  //   alinhamento  — "centro" (padrão), "esquerda" ou "direita"
  //   ajuste       — texto maior que a caixa: "encolher" (padrão, reduz tudo)
  //                  ou "comprimir" (só estreita as letras, mantém a altura)
  //   espacamento  — espaço extra entre letras, em fração do corpo (ex. 0.05)
  function layoutTexto(font, texto, caixa, opcoes) {
    const op = opcoes || {};
    let t = String(texto == null ? "" : texto).trim();
    if (op.maiusculas !== false) t = t.toLocaleUpperCase("pt-BR");
    if (!t || !(caixa.w > 0) || !(caixa.h > 0)) return { comandos: [], larguraMm: 0, alturaMm: 0 };

    const upm = font.unitsPerEm;
    const cap = alturaMaiusculas(font);
    const extra = (Number(op.espacamento) || 0) * upm;
    const glifos = font.stringToGlyphs(t);

    const posicoes = [];
    let x = 0;
    glifos.forEach((g, i) => {
      posicoes.push(x);
      x += g.advanceWidth || 0;
      if (i < glifos.length - 1) {
        x += (font.getKerningValue ? font.getKerningValue(g, glifos[i + 1]) : 0) + extra;
      }
    });
    const larguraU = x;
    if (!(larguraU > 0)) return { comandos: [], larguraMm: 0, alturaMm: 0 };

    let escalaY = caixa.h / cap; // mm por unidade da fonte
    let escalaX = escalaY;
    if (larguraU * escalaX > caixa.w) {
      if (op.ajuste === "comprimir") {
        escalaX = caixa.w / larguraU;
      } else {
        escalaX = escalaY = caixa.w / larguraU;
      }
    }

    const larguraMm = larguraU * escalaX;
    const alturaMm = cap * escalaY;
    let x0 = (caixa.w - larguraMm) / 2;
    if (op.alinhamento === "esquerda") x0 = 0;
    else if (op.alinhamento === "direita") x0 = caixa.w - larguraMm;
    // Linha de base: as maiúsculas centralizadas na altura da caixa.
    const base = caixa.h - (caixa.h - alturaMm) / 2;

    const comandos = [];
    glifos.forEach((g, i) => {
      // getPath(x, y, corpo) com corpo = upm devolve unidades da fonte, com y
      // para baixo e a linha de base em y = 0.
      const p = g.getPath(0, 0, upm);
      const X = (v) => x0 + (posicoes[i] + v) * escalaX;
      const Y = (v) => base + v * escalaY;
      p.commands.forEach((c) => {
        if (c.type === "M" || c.type === "L") comandos.push({ type: c.type, x: X(c.x), y: Y(c.y) });
        else if (c.type === "Q") comandos.push({ type: "Q", x1: X(c.x1), y1: Y(c.y1), x: X(c.x), y: Y(c.y) });
        else if (c.type === "C") {
          comandos.push({ type: "C", x1: X(c.x1), y1: Y(c.y1), x2: X(c.x2), y2: Y(c.y2), x: X(c.x), y: Y(c.y) });
        } else if (c.type === "Z") comandos.push({ type: "Z" });
      });
    });
    return { comandos, larguraMm, alturaMm };
  }

  // Desloca comandos de caminho (mm) para outra origem.
  function deslocarComandos(comandos, dx, dy) {
    return comandos.map((c) => {
      const n = { type: c.type };
      ["x", "x1", "x2"].forEach((k) => { if (c[k] != null) n[k] = c[k] + dx; });
      ["y", "y1", "y2"].forEach((k) => { if (c[k] != null) n[k] = c[k] + dy; });
      return n;
    });
  }

  // ---------------- Montagem da folha ----------------

  // Valor de texto de um elemento para uma camiseta.
  function textoDoCampo(el, camiseta) {
    if (el.campo === "numero") return String(camiseta.numero == null ? "" : camiseta.numero);
    if (el.campo === "nome") return camiseta.nome || "";
    // nomeCamiseta (apelido): sem apelido, usa o nome (se o elemento permitir).
    const apelido = camiseta.nomeCamiseta || "";
    if (!apelido && el.usarNomeSeVazio !== false) return camiseta.nome || "";
    return apelido;
  }

  // Caixa de um elemento no tamanho pedido: o ajuste fino daquele tamanho, se
  // houver; senão, a caixa do tamanho base escalada na proporção do molde.
  function caixaNoTamanho(el, tamanho, moldeBase, moldeTam) {
    if (el.ajustes && el.ajustes[tamanho]) return { ...el.ajustes[tamanho] };
    const c = el.caixa || { x: 0, y: 0, w: 10, h: 10 };
    if (!moldeBase || !moldeTam) return { ...c };
    const sx = moldeTam.w / moldeBase.w;
    const sy = moldeTam.h / moldeBase.h;
    return { x: c.x * sx, y: c.y * sy, w: c.w * sx, h: c.h * sy };
  }

  // Encaixa o conteúdo inteiro (w × h) dentro da caixa, sem distorcer.
  function encaixarProporcional(caixa, w, h) {
    const e = Math.min(caixa.w / w, caixa.h / h);
    const W = w * e, H = h * e;
    return { x: caixa.x + (caixa.w - W) / 2, y: caixa.y + (caixa.h - H) / 2, w: W, h: H };
  }

  // Blocos (uma peça de uma camiseta cada) → folhas. Encaixe em prateleiras:
  // os blocos vão da esquerda para a direita na ordem das camisetas (as peças
  // de uma mesma camiseta ficam juntas) e, quando não cabem mais, abrem uma
  // nova prateleira. Passando da altura máxima, abre uma nova folha.
  function empacotar(blocos, larguraMm, espacoMm, alturaMaxMm) {
    const folhas = [];
    let folha = null;
    let x = 0, y = 0, alturaPrateleira = 0;
    const novaFolha = () => {
      folha = { larguraMm, alturaMm: 0, blocos: [] };
      folhas.push(folha);
      x = espacoMm; y = espacoMm; alturaPrateleira = 0;
    };
    novaFolha();
    blocos.forEach((b) => {
      if (x > espacoMm && x + b.w + espacoMm > larguraMm) {
        x = espacoMm;
        y += alturaPrateleira + espacoMm;
        alturaPrateleira = 0;
      }
      if (alturaMaxMm > 0 && folha.blocos.length > 0 && y + b.h + espacoMm > alturaMaxMm) {
        novaFolha();
      }
      folha.blocos.push({ bloco: b, x, y });
      x += b.w + espacoMm;
      alturaPrateleira = Math.max(alturaPrateleira, b.h);
      folha.alturaMm = Math.max(folha.alturaMm, y + alturaPrateleira + espacoMm);
    });
    return folhas.filter((f) => f.blocos.length > 0);
  }

  // Monta as folhas de uma arte para uma lista de camisetas.
  //
  // arte:      documento da coleção `artes` (peças, moldes, elementos, folha)
  // camisetas: [{ nome, nomeCamiseta, numero, tamanho }]
  // rec:       recursos já carregados —
  //              fontes:  { fonteId: fonte opentype }
  //              eps:     { fileId: { bytes (PostScript), bbox } }
  //              imagens: { fileId: { largura, altura, cmyk, mascara } }
  //
  // Devolve { folhas: [{ larguraMm, alturaMm, ops }], avisos: [texto] }.
  // Cada op está em mm absolutos na folha (origem em cima à esquerda):
  //   { tipo: "eps", fileId, x, y, w, h }
  //   { tipo: "imagem", fileId, x, y, w, h }
  //   { tipo: "caminho", comandos, cmyk, contorno: { cmyk, mm } | null }
  function montarFolhas(arte, camisetas, rec) {
    const cfg = arte.folha || {};
    const larguraMm = Number(cfg.larguraCm) > 0 ? cfg.larguraCm * 10 : 1500;
    const espacoMm = Number(cfg.espacoMm) >= 0 ? Number(cfg.espacoMm) : 10;
    const alturaMaxMm = Number(cfg.alturaMaxCm) > 0 ? cfg.alturaMaxCm * 10 : 0;
    const posMolde = cfg.molde || "frente"; // "frente" | "fundo" | "nenhum"
    const etiqueta = cfg.etiqueta !== false;
    const ETIQUETA_MM = 4;

    const avisos = [];
    const avisar = (t) => { if (!avisos.includes(t)) avisos.push(t); };
    const fonteEtiqueta = Object.values(rec.fontes || {})[0] || null;

    const blocos = [];
    camisetas.forEach((cam) => {
      (arte.pecas || []).forEach((peca) => {
        const molde = peca.moldes && peca.moldes[cam.tamanho];
        if (!molde || !molde.bbox) {
          avisar(`Sem molde da peça "${peca.nome}" no tamanho ${cam.tamanho || "(vazio)"} — essa peça ficou de fora.`);
          return;
        }
        const tam = tamanhoMmDoBbox(molde.bbox);
        const base = peca.moldes[peca.tamanhoBase];
        const tamBase = base && base.bbox ? tamanhoMmDoBbox(base.bbox) : tam;

        const ops = [];
        const opMolde = { tipo: "eps", fileId: molde.epsId, x: 0, y: 0, w: tam.w, h: tam.h };
        if (posMolde === "fundo") ops.push(opMolde);

        (peca.elementos || []).forEach((el) => {
          const caixa = caixaNoTamanho(el, cam.tamanho, tamBase, tam);
          if (el.tipo === "texto") {
            const fonte = rec.fontes && rec.fontes[el.fonteId];
            if (!fonte) { avisar("Um campo de texto está sem fonte carregada."); return; }
            const valor = textoDoCampo(el, cam);
            if (!String(valor).trim()) return;
            const lay = layoutTexto(fonte, valor, caixa, el);
            if (!lay.comandos.length) return;
            ops.push({
              tipo: "caminho",
              comandos: deslocarComandos(lay.comandos, caixa.x, caixa.y),
              cmyk: el.corCmyk || [0, 0, 0, 100],
              contorno: el.contornoMm > 0 ? { cmyk: el.contornoCmyk || [0, 0, 0, 0], mm: Number(el.contornoMm) } : null
            });
          } else if (el.tipo === "eps") {
            const e = rec.eps && rec.eps[el.arquivo && el.arquivo.fileId];
            if (!e) { avisar("Uma parte vetorial (EPS) não foi carregada."); return; }
            const t = tamanhoMmDoBbox(e.bbox);
            ops.push({ tipo: "eps", fileId: el.arquivo.fileId, ...encaixarProporcional(caixa, t.w, t.h) });
          } else if (el.tipo === "png") {
            const img = rec.imagens && rec.imagens[el.arquivo && el.arquivo.fileId];
            if (!img) { avisar("Uma imagem (PNG) não foi carregada."); return; }
            ops.push({ tipo: "imagem", fileId: el.arquivo.fileId, ...encaixarProporcional(caixa, img.largura, img.altura) });
          }
        });

        if (posMolde === "frente") ops.push(opMolde);

        // Etiqueta pequena embaixo da peça, para a costura separar as peças.
        let h = tam.h;
        if (etiqueta && fonteEtiqueta) {
          const texto = [cam.nomeCamiseta || cam.nome, cam.numero, cam.tamanho, peca.nome]
            .filter((v) => String(v || "").trim()).join(" · ");
          const lay = layoutTexto(fonteEtiqueta, texto, { w: tam.w, h: ETIQUETA_MM * 0.6 },
            { maiusculas: false, alinhamento: "esquerda" });
          if (lay.comandos.length) {
            ops.push({ tipo: "caminho", comandos: deslocarComandos(lay.comandos, 0, tam.h + 1), cmyk: [0, 0, 0, 100], contorno: null });
            h = tam.h + 1 + ETIQUETA_MM * 0.6;
          }
        }
        if (tam.w + 2 * espacoMm > larguraMm) {
          avisar(`A peça "${peca.nome}" (${tam.w.toFixed(0)} mm) é mais larga que a folha (${larguraMm} mm).`);
        }
        blocos.push({ w: tam.w, h, ops });
      });
    });

    const folhas = empacotar(blocos, larguraMm, espacoMm, alturaMaxMm).map((f) => ({
      larguraMm: f.larguraMm,
      alturaMm: f.alturaMm,
      ops: f.blocos.flatMap(({ bloco, x, y }) =>
        bloco.ops.map((op) =>
          op.tipo === "caminho"
            ? { ...op, comandos: deslocarComandos(op.comandos, x, y) }
            : { ...op, x: op.x + x, y: op.y + y }
        )
      )
    }));
    return { folhas, avisos };
  }

  // ---------------- Escrita do PostScript ----------------

  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  function bytesDeTexto(s) {
    if (enc) return enc.encode(s);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  // ASCII85 (o "~>" no fim é do próprio formato), com quebra de linha a cada
  // 75 caracteres — mantém o EPS 100% texto.
  function ascii85(dados) {
    const saida = new Uint8Array(Math.ceil(dados.length / 4) * 5 + Math.ceil(dados.length / 60) + 4);
    let o = 0, coluna = 0;
    const put = (ch) => {
      saida[o++] = ch;
      if (++coluna === 75) { saida[o++] = 10; coluna = 0; }
    };
    const n = dados.length;
    for (let i = 0; i < n; i += 4) {
      const resto = Math.min(4, n - i);
      const v = (((dados[i] << 24) >>> 0) + ((resto > 1 ? dados[i + 1] : 0) << 16) +
        ((resto > 2 ? dados[i + 2] : 0) << 8) + (resto > 3 ? dados[i + 3] : 0)) >>> 0;
      if (v === 0 && resto === 4) { put(122); continue; } // "z"
      const d = [0, 0, 0, 0, 0];
      let t = v;
      for (let j = 4; j >= 0; j--) { d[j] = t % 85; t = Math.floor(t / 85); }
      for (let j = 0; j < resto + 1; j++) put(d[j] + 33);
    }
    saida[o++] = 126; saida[o++] = 62; saida[o++] = 10; // "~>\n"
    return saida.subarray(0, o);
  }

  const num = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? "0" : String(r);
  };
  const cmykPs = (c) => (c || [0, 0, 0, 100]).map((v) => num(Math.max(0, Math.min(100, Number(v) || 0)) / 100)).join(" ");

  const PROLOGO = [
    "%%BeginProlog",
    "/IcDict 40 dict def IcDict begin",
    "/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def",
    "/BeginEPSF { /b4_Inc_state save def /dict_count countdictstack def",
    "  /op_count count 1 sub def userdict begin /showpage { } def",
    "  0 setgray 0 setlinecap 1 setlinewidth 0 setlinejoin 10 setmiterlimit [ ] 0 setdash newpath",
    "  /languagelevel where { pop languagelevel 1 ne { false setstrokeadjust false setoverprint } if } if",
    "} bind def",
    "/EndEPSF { count op_count sub {pop} repeat countdictstack dict_count sub {end} repeat",
    "  b4_Inc_state restore } bind def",
    "end",
    "%%EndProlog"
  ].join("\n");

  // Escreve uma folha como EPS. Devolve uma lista de pedaços (strings e
  // Uint8Array) — é só passar para `new Blob(pedacos)`.
  //
  // rec: { eps: { fileId: { bytes, bbox } }, imagens: { fileId: {...} } }
  // deflate: função (Uint8Array) => Uint8Array no formato zlib (ex. pako.deflate)
  function escreverEps(folha, rec, deflate, titulo) {
    const W = folha.larguraMm * PT_POR_MM;
    const H = folha.alturaMm * PT_POR_MM;
    const k = PT_POR_MM;
    const pedacos = [];
    const escrever = (s) => pedacos.push(s);

    escrever(
      "%!PS-Adobe-3.0 EPSF-3.0\n" +
      `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}\n` +
      `%%HiResBoundingBox: 0 0 ${num(W)} ${num(H)}\n` +
      `%%Title: (${String(titulo || "Folha").replace(/[()\\\r\n]/g, " ")})\n` +
      "%%Creator: Interclasse - folha de producao\n" +
      "%%LanguageLevel: 3\n" +
      "%%DocumentProcessColors: Cyan Magenta Yellow Black\n" +
      "%%EndComments\n" +
      PROLOGO + "\n" +
      "%%BeginSetup\nIcDict begin\n"
    );

    // Cada imagem entra UMA vez no arquivo (fluxo reutilizável) e é
    // desenhada quantas vezes aparecer na folha — senão uma arte repetida em
    // 30 camisetas deixaria o arquivo 30 vezes maior.
    const idsImagem = [...new Set(folha.ops.filter((o) => o.tipo === "imagem").map((o) => o.fileId))];
    const nomeImg = {};
    idsImagem.forEach((id, i) => {
      const img = rec.imagens[id];
      const nome = "Img" + i;
      nomeImg[id] = nome;
      escrever(`/${nome}D currentfile /ASCII85Decode filter /ReusableStreamDecode filter\n`);
      pedacos.push(ascii85(deflate(img.cmyk)));
      escrever("def\n");
      if (img.mascara) {
        escrever(`/${nome}M currentfile /ASCII85Decode filter /ReusableStreamDecode filter\n`);
        pedacos.push(ascii85(deflate(img.mascara)));
        escrever("def\n");
      }
    });
    escrever("%%EndSetup\n");

    folha.ops.forEach((op) => {
      if (op.tipo === "caminho") {
        let s = "";
        let cx = 0, cy = 0;
        op.comandos.forEach((c) => {
          const X = (v) => num(v * k);
          const Y = (v) => num(H - v * k);
          if (c.type === "M") { s += `${X(c.x)} ${Y(c.y)} m\n`; cx = c.x; cy = c.y; }
          else if (c.type === "L") { s += `${X(c.x)} ${Y(c.y)} l\n`; cx = c.x; cy = c.y; }
          else if (c.type === "C") {
            s += `${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)} c\n`;
            cx = c.x; cy = c.y;
          } else if (c.type === "Q") {
            // Quadrática → cúbica (o PostScript só tem a cúbica).
            const c1x = cx + (2 / 3) * (c.x1 - cx), c1y = cy + (2 / 3) * (c.y1 - cy);
            const c2x = c.x + (2 / 3) * (c.x1 - c.x), c2y = c.y + (2 / 3) * (c.y1 - c.y);
            s += `${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(c.x)} ${Y(c.y)} c\n`;
            cx = c.x; cy = c.y;
          } else if (c.type === "Z") s += "h\n";
        });
        if (op.contorno) {
          // Contorno por fora: traço com o dobro da espessura por baixo do
          // preenchimento — só a metade de fora fica visível.
          escrever(`gsave newpath\n${s}${cmykPs(op.contorno.cmyk)} setcmykcolor ` +
            `${num(op.contorno.mm * 2 * k)} setlinewidth 1 setlinejoin 1 setlinecap stroke grestore\n`);
        }
        escrever(`gsave newpath\n${s}${cmykPs(op.cmyk)} setcmykcolor fill grestore\n`);
      } else if (op.tipo === "imagem") {
        const img = rec.imagens[op.fileId];
        const nome = nomeImg[op.fileId];
        const w = img.largura, h = img.altura;
        const mat = `[${w} 0 0 ${-h} 0 ${h}]`;
        let s = `gsave ${num(op.x * k)} ${num(H - (op.y + op.h) * k)} translate ` +
          `${num(op.w * k)} ${num(op.h * k)} scale /DeviceCMYK setcolorspace\n` +
          `${nome}D resetfile\n`;
        const dados = `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 ` +
          `/Decode [0 1 0 1 0 1 0 1] /ImageMatrix ${mat} /DataSource ${nome}D /FlateDecode filter >>`;
        if (img.mascara) {
          s += `${nome}M resetfile\n<< /ImageType 3 /InterleaveType 3\n/DataDict ${dados}\n` +
            `/MaskDict << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 1 /Decode [0 1] ` +
            `/ImageMatrix ${mat} /DataSource ${nome}M /FlateDecode filter >>\n>> image\n`;
        } else {
          s += `${dados} image\n`;
        }
        escrever(s + "grestore\n");
      } else if (op.tipo === "eps") {
        const e = rec.eps[op.fileId];
        if (!e) return;
        const bw = e.bbox.x2 - e.bbox.x1, bh = e.bbox.y2 - e.bbox.y1;
        escrever(
          `BeginEPSF\n${num(op.x * k)} ${num(H - (op.y + op.h) * k)} translate ` +
          `${num((op.w * k) / bw)} ${num((op.h * k) / bh)} scale ` +
          `${num(-e.bbox.x1)} ${num(-e.bbox.y1)} translate\n` +
          `${num(e.bbox.x1)} ${num(e.bbox.y1)} ${num(bw)} ${num(bh)} rectclip\n` +
          `%%BeginDocument: ${op.fileId}.eps\n`
        );
        pedacos.push(e.bytes);
        escrever("\n%%EndDocument\nEndEPSF\n");
      }
    });

    escrever("end\nshowpage\n%%Trailer\n%%EOF\n");
    return pedacos;
  }

  return {
    PT_POR_MM,
    extrairPostScript,
    lerBoundingBox,
    tamanhoMmDoBbox,
    cmykDeRgba,
    layoutTexto,
    textoDoCampo,
    caixaNoTamanho,
    empacotar,
    montarFolhas,
    ascii85,
    escreverEps
  };
})();

if (typeof module !== "undefined") module.exports = EPS;
