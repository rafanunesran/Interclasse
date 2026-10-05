// ============================================================
// GERADOR DE EPS CMYK (folha montada para impressão)
// ============================================================
// Monta, no próprio navegador, a folha de impressão de um pedido: cada peça
// de cada camiseta (frente, costas, mangas...) com o MOLDE de corte do
// tamanho dela, a ARTE do time (PNG 600 dpi, adaptada ao tamanho), o BRASÃO
// (EPS) e o nome/número em CURVAS, tudo encaixado para aproveitar a folha.
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
  const MM_POR_POL = 25.4;

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
  // caixa. A caixa é o LIMITE: texto comprido encolhe (ou é comprimido na
  // largura) e nunca sai dela. É a MESMA função da prévia do editor.
  //
  // opcoes:
  //   maiusculas   — converte para maiúsculas (padrão: true)
  //   alinhamento  — "centro" (padrão), "esquerda" ou "direita"
  //   ajuste       — texto maior que a caixa: "encolher" (padrão, reduz tudo)
  //                  ou "comprimir" (só estreita as letras, mantém a altura);
  //                  "esticar" preenche a caixa inteira, largura e altura cada
  //                  uma no seu (distorce as letras)
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
    if (op.ajuste === "esticar") {
      escalaX = caixa.w / larguraU;
    } else if (larguraU * escalaX > caixa.w) {
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

  // ---------------- Efeitos e transformações ----------------
  // Tudo em mm, no sistema da caixa (y para baixo). O giro é em graus, no
  // sentido horário (como na tela), em volta do centro da caixa.

  // Aplica `f(x, y) -> [x, y]` a todos os pontos (inclusive os de controle).
  function transformarComandos(comandos, f) {
    return comandos.map((c) => {
      const n = { type: c.type };
      ["", "1", "2"].forEach((s) => {
        if (c["x" + s] == null) return;
        const [x, y] = f(c["x" + s], c["y" + s]);
        n["x" + s] = x;
        n["y" + s] = y;
      });
      return n;
    });
  }

  // Giro e espelho de um elemento, em volta do centro (cx, cy).
  function transformacaoDoElemento(el, cx, cy) {
    const rot = ((Number(el.rotacao) || 0) * Math.PI) / 180;
    const fh = el.espelharH ? -1 : 1, fv = el.espelharV ? -1 : 1;
    if (!rot && fh === 1 && fv === 1) return null;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return (x, y) => {
      const dx = (x - cx) * fh, dy = (y - cy) * fv;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
  }

  // Texto de um elemento pronto para desenhar: layoutTexto + itálico (inclinação),
  // arco e, se pedido, giro/espelho. Com itálico ou arco o texto é reencaixado
  // na caixa (continua nunca saindo dela). Devolve { comandos } em mm,
  // relativos ao canto de cima da caixa.
  //   opcoes.semGiro — sem o giro/espelho (o editor gira a caixa inteira).
  function textoDoElemento(font, texto, caixaEl, el, opcoes) {
    // Número com tamanho próprio para a quantidade de dígitos: desenha numa
    // caixa menor dentro da do elemento (e, se pedido, esticado nela).
    const sub = caixaPorDigitos(el, texto, caixaEl);
    const caixa = sub ? { w: sub.w, h: sub.h } : caixaEl;
    if (sub && sub.esticar) el = { ...el, ajuste: "esticar" };
    const l = layoutTexto(font, texto, caixa, el);
    let cmds = l.comandos;
    if (!cmds.length) return { comandos: [] };
    const incl = Math.max(-45, Math.min(45, Number(el.inclinacao) || 0));
    const arco = Math.max(-300, Math.min(300, Number(el.arco) || 0));
    if (incl || Math.abs(arco) >= 1) {
      const bb = caixaDosComandos(cmds);
      const base = bb.y2;
      if (incl) {
        const t = Math.tan((incl * Math.PI) / 180);
        cmds = transformarComandos(cmds, (x, y) => [x + (base - y) * t, y]);
      }
      if (Math.abs(arco) >= 1) {
        const b2 = caixaDosComandos(cmds);
        const larg = b2.x2 - b2.x1;
        const R = larg / ((Math.abs(arco) * Math.PI) / 180);
        const cx = (b2.x1 + b2.x2) / 2;
        cmds = transformarComandos(cmds, arco > 0
          // Arco para cima (∩): centro embaixo do texto.
          ? (x, y) => { const th = (x - cx) / R, r = R + (base - y); return [cx + r * Math.sin(th), base + R - r * Math.cos(th)]; }
          // Arco para baixo (∪): centro em cima do texto.
          : (x, y) => { const th = (x - cx) / R, r = R - (base - y); return [cx + r * Math.sin(th), base - R + r * Math.cos(th)]; });
      }
      // Reencaixa na caixa: encolhe se passou e alinha como o texto reto.
      const b3 = caixaDosComandos(cmds);
      const w = b3.x2 - b3.x1, h = b3.y2 - b3.y1;
      const e = Math.min(1, caixa.w / w, caixa.h / h);
      const W = w * e, H = h * e;
      let x0 = (caixa.w - W) / 2;
      if (el.alinhamento === "esquerda") x0 = 0;
      else if (el.alinhamento === "direita") x0 = caixa.w - W;
      const y0 = (caixa.h - H) / 2;
      cmds = transformarComandos(cmds, (x, y) => [x0 + (x - b3.x1) * e, y0 + (y - b3.y1) * e]);
    }
    if (sub) cmds = deslocarComandos(cmds, sub.x, sub.y);
    if (!(opcoes && opcoes.semGiro)) {
      const f = transformacaoDoElemento(el, caixaEl.w / 2, caixaEl.h / 2);
      if (f) cmds = transformarComandos(cmds, f);
    }
    return { comandos: cmds };
  }

  // Elemento de número? (o número nas costas, ou um texto com o campo número)
  function ehElementoNumero(el) {
    return el.tipo === "numero" || el.campo === "numero";
  }

  // Quantos dígitos (1, 2 ou 3 — 3 vale para 3 ou mais) tem o número.
  function digitosDoNumero(texto) {
    const n = String(texto == null ? "" : texto).trim().length;
    return n ? Math.min(3, n) : 0;
  }

  // Tamanho do número conforme a quantidade de dígitos: el.porDigitos =
  // { "1": { w, h, esticar }, "2": ..., "3": ... }, com w e h em % da caixa
  // do elemento (vale em todos os tamanhos de camiseta). Devolve a caixa
  // menor (mm, relativa à do elemento: centrada na altura e alinhada como o
  // texto) ou null quando não há tamanho próprio para esse número.
  function caixaPorDigitos(el, texto, caixa) {
    if (!el || !el.porDigitos || !ehElementoNumero(el)) return null;
    const d = el.porDigitos[digitosDoNumero(texto)];
    if (!d) return null;
    const pw = Number(d.w), ph = Number(d.h);
    if (!(pw > 0) && !(ph > 0)) return null;
    const w = caixa.w * Math.min(100, pw > 0 ? pw : 100) / 100;
    const h = caixa.h * Math.min(100, ph > 0 ? ph : 100) / 100;
    let x = (caixa.w - w) / 2;
    if (el.alinhamento === "esquerda") x = 0;
    else if (el.alinhamento === "direita") x = caixa.w - w;
    return { x, y: (caixa.h - h) / 2, w, h, esticar: d.esticar !== false };
  }

  // Sombra do texto ligada? (deslocamento em mm e cor)
  function sombraDoElemento(el) {
    if (!el.sombra) return null;
    return {
      dx: Number(el.sombraDx == null ? 1.5 : el.sombraDx) || 0,
      dy: Number(el.sombraDy == null ? 1.5 : el.sombraDy) || 0,
      cmyk: el.sombraCmyk || [0, 0, 0, 60]
    };
  }

  // ---------------- Layout: onde cada coisa fica em cada tamanho ----------------

  // Valor de texto de um elemento para uma camiseta.
  function textoDoCampo(el, camiseta) {
    if (el.tipo === "numero" || el.campo === "numero") return String(camiseta.numero == null ? "" : camiseta.numero);
    if (el.campo === "tamanho") return camiseta.tamanho || "";
    if (el.campo === "time") return camiseta.nomeTime || "";
    if (el.campo === "fixo") return el.texto || "";
    if (el.campo === "nomeCompleto") return camiseta.nome || "";
    // Nome na camiseta (apelido): sem apelido, usa o nome (se permitido).
    const apelido = camiseta.nomeCamiseta || "";
    if (!apelido && el.usarNomeSeVazio !== false) return camiseta.nome || "";
    return apelido;
  }

  function escalarCaixa(c, moldeBase, moldeTam) {
    if (!moldeBase || !moldeTam) return { ...c };
    const sx = moldeTam.w / moldeBase.w;
    const sy = moldeTam.h / moldeBase.h;
    return { x: c.x * sx, y: c.y * sy, w: c.w * sx, h: c.h * sy };
  }

  // Caixa de um elemento do layout num tamanho, com o ajuste do time.
  // Ordem: ajuste do time naquele tamanho → caixa do time (proporcional) →
  // ajuste geral daquele tamanho → caixa geral (proporcional ao molde).
  //   ajusteTime: { base: caixa, tamanhos: { tam: caixa } } | undefined
  function caixaEfetiva(el, tamanho, moldeBase, moldeTam, ajusteTime) {
    const aj = ajusteTime || {};
    if (aj.tamanhos && aj.tamanhos[tamanho]) return { ...aj.tamanhos[tamanho] };
    if (aj.base) return escalarCaixa(aj.base, moldeBase, moldeTam);
    if (el.ajustes && el.ajustes[tamanho]) return { ...el.ajustes[tamanho] };
    return escalarCaixa(el.caixa || { x: 0, y: 0, w: 10, h: 10 }, moldeBase, moldeTam);
  }

  // O elemento como fica num time: o estilo próprio do time (aba "Editar
  // arte" do pedido) por cima do layout geral. null = oculto neste time.
  function elementoDoTime(el, ajusteTime) {
    const aj = ajusteTime || {};
    // `el.oculto`: escondido num nível de cima (a arte do cliente); o time
    // pode mostrar de novo com oculto: false no ajuste dele.
    if ("oculto" in aj ? aj.oculto : el.oculto) return null;
    return aj.estilo ? { ...el, ...aj.estilo } : el;
  }

  // Imagem esticada na caixa (largura e altura independentes)? O detalhe da
  // manga estica por padrão (a arte se adapta à caixa); brasão e logo mantêm
  // a proporção, a não ser que "Manter proporção" seja desmarcado.
  function imagemLivre(el) {
    return el.livre != null ? !!el.livre : el.tipo === "detalhe";
  }

  // Encaixa o conteúdo inteiro (w × h) dentro da caixa, sem distorcer.
  function encaixarProporcional(caixa, w, h) {
    const e = Math.min(caixa.w / w, caixa.h / h);
    const W = w * e, H = h * e;
    return { x: caixa.x + (caixa.w - W) / 2, y: caixa.y + (caixa.h - H) / 2, w: W, h: H };
  }

  // Onde a ARTE (PNG) da peça fica no molde de um tamanho: ela é ESTICADA
  // para cobrir o molde inteiro — largura e altura, cada uma no seu — mais a
  // sangria para fora da linha de corte, para não sobrar nenhuma fresta
  // branca em tamanho nenhum. Quem dá o formato é o recorte no contorno.
  function caixaArte(arte, moldeBase, moldeTam, sangriaMm) {
    const s = Number(sangriaMm) > 0 ? Number(sangriaMm) : 0;
    return { x: -s, y: -s, w: moldeTam.w + 2 * s, h: moldeTam.h + 2 * s };
  }

  // ---------------- Encaixe na folha (MaxRects) ----------------
  // Cada bloco (uma peça de uma camiseta) procura o espaço livre em que sobra
  // menos (melhor encaixe pela menor sobra de lado), olhando também a versão
  // girada 90° quando o fornecedor permite girar. A folha tem largura fixa e a
  // altura cresce conforme precisa; com altura máxima, abre outra folha.

  function empacotar(blocos, opcoes) {
    const larguraMm = opcoes.larguraMm;
    const espaco = Math.max(0, opcoes.espacoMm || 0);
    const alturaMax = opcoes.alturaMaxMm > 0 ? opcoes.alturaMaxMm : 1e7;
    const gira90 = opcoes.rotacao === "90";

    // Os maiores primeiro (encaixam melhor); a ordem original desempata,
    // para as peças de uma mesma camiseta ficarem perto.
    const ordem = blocos.map((b, i) => ({ b, i }))
      .sort((a, z) => (z.b.w * z.b.h) - (a.b.w * a.b.h) || a.i - z.i);

    const folhas = [];
    const novaFolha = () => {
      const f = {
        larguraMm,
        alturaMm: 0,
        blocos: [],
        // Retângulos livres (a área útil tem a margem = espaço entre peças).
        livres: [{ x: espaco, y: espaco, w: larguraMm - espaco, h: alturaMax - espaco }]
      };
      folhas.push(f);
      return f;
    };

    const tentar = (f, w, h) => {
      // w/h já incluem a borda (faca) dos dois lados.
      // Cada bloco "ocupa" w+espaço × h+espaço (o espaço fica à direita e embaixo).
      const W = w + espaco, H = h + espaco;
      let melhor = null;
      f.livres.forEach((r) => {
        if (W <= r.w + 1e-6 && H <= r.h + 1e-6) {
          // Prioriza o que fica mais em cima (folha mais curta) e depois a menor sobra.
          const pont = [r.y + H, Math.min(r.w - W, r.h - H)];
          if (!melhor || pont[0] < melhor.pont[0] - 1e-6 ||
              (Math.abs(pont[0] - melhor.pont[0]) < 1e-6 && pont[1] < melhor.pont[1])) {
            melhor = { x: r.x, y: r.y, W, H, pont };
          }
        }
      });
      return melhor;
    };

    const ocupar = (f, x, y, W, H) => {
      const novos = [];
      f.livres.forEach((r) => {
        if (x >= r.x + r.w || x + W <= r.x || y >= r.y + r.h || y + H <= r.y) {
          novos.push(r);
          return;
        }
        if (x > r.x) novos.push({ x: r.x, y: r.y, w: x - r.x, h: r.h });
        if (x + W < r.x + r.w) novos.push({ x: x + W, y: r.y, w: r.x + r.w - x - W, h: r.h });
        if (y > r.y) novos.push({ x: r.x, y: r.y, w: r.w, h: y - r.y });
        if (y + H < r.y + r.h) novos.push({ x: r.x, y: y + H, w: r.w, h: r.y + r.h - y - H });
      });
      // Remove os livres contidos em outro.
      f.livres = novos.filter((a, i) => !novos.some((b, j) => j !== i &&
        a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6 &&
        (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
    };

    const avisos = [];
    ordem.forEach(({ b }) => {
      // `borda`: folga em volta da peça (a faca de 3 mm fica por fora dela).
      const bd = Math.max(0, b.borda || 0);
      const bw = b.w + 2 * bd, bh = b.h + 2 * bd;
      if (bw + 2 * espaco > larguraMm && (!gira90 || bh + 2 * espaco > larguraMm)) {
        avisos.push(`Uma peça (${b.rotulo || ""}, ${b.w.toFixed(0)} mm) é mais larga que a folha (${larguraMm} mm).`);
      }
      const opcoesRot = [{ rot: 0, w: bw, h: bh }];
      if (gira90) opcoesRot.push({ rot: 90, w: bh, h: bw });
      let feito = false;
      for (let fi = 0; fi <= folhas.length && !feito; fi++) {
        const f = folhas[fi] || novaFolha();
        let escolha = null;
        opcoesRot.forEach((o) => {
          const m = tentar(f, o.w, o.h);
          if (m && (!escolha || m.pont[0] < escolha.m.pont[0] - 1e-6 ||
              (Math.abs(m.pont[0] - escolha.m.pont[0]) < 1e-6 && m.pont[1] < escolha.m.pont[1]))) {
            escolha = { m, o };
          }
        });
        if (!escolha && f.blocos.length === 0) {
          // Não cabe nem numa folha vazia: vai assim mesmo (com aviso acima).
          escolha = { m: { x: espaco, y: espaco, W: bw + espaco, H: bh + espaco }, o: opcoesRot[0] };
        }
        if (escolha) {
          const { m, o } = escolha;
          ocupar(f, m.x, m.y, m.W, m.H);
          f.blocos.push({ bloco: b, x: m.x + bd, y: m.y + bd, w: o.w - 2 * bd, h: o.h - 2 * bd, rot: o.rot });
          f.alturaMm = Math.max(f.alturaMm, m.y + m.H);
          feito = true;
        }
      }
    });
    folhas.forEach((f) => delete f.livres);
    return { folhas: folhas.filter((f) => f.blocos.length), avisos };
  }

  // ---------------- Contorno do molde ----------------
  // O EPS do molde (Corel, Illustrator...) passa pelo Ghostscript e vira um
  // PDF sem compressão: aí os desenhos chegam com os operadores simples do
  // PDF (m, l, c, v, y, re, h, cm, q/Q), seja qual for o programa de origem.
  // O contorno da peça é o maior caminho do arquivo (a linha de corte); os
  // piquetes e marcas pequenas ficam de fora.
  //
  // Devolve o contorno como texto "M x y L x y C x1 y1 x2 y2 x y ... Z", em
  // mm, com origem no canto de CIMA à esquerda do molde (y para baixo) — ou
  // null quando não acha nada que pareça a peça.
  //
  // `inflar` (opcional, ex. pako.inflate) descomprime os fluxos que o
  // Ghostscript comprimir mesmo assim (formulários/XObjects).
  function contornoDePdf(bytes, inflar) {
    const texto = textoDeBytes(bytes, 0, bytes.length);
    const mb = texto.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
    if (!mb) return null;
    const [mx1, my1, mx2, my2] = mb.slice(1, 5).map(Number);
    const larg = mx2 - mx1, alt = my2 - my1;

    const subcaminhos = [];
    const re = /<<((?:(?!>>)[\s\S])*)>>\s*stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(texto))) {
      const dic = m[1];
      if (/\/Subtype\s*\/(?!Form\b)|\/Type\s*\/(XRef|ObjStm|Metadata)|\/Length1|\/FontFile/.test(dic)) continue;
      let fluxo = m[2];
      if (/\/Filter/.test(dic)) {
        if (!inflar || !/\/FlateDecode/.test(dic) || /\/DecodeParms|\[\s*\/\w+\s+\//.test(dic)) continue;
        try {
          const b = new Uint8Array(fluxo.length);
          for (let i = 0; i < fluxo.length; i++) b[i] = fluxo.charCodeAt(i) & 0xff;
          fluxo = textoDeBytes(inflar(b), 0, Infinity);
        } catch (e) {
          continue;
        }
      }
      lerConteudoPdf(fluxo, subcaminhos);
    }
    if (!subcaminhos.length) return null;

    const area = (s) => (s.x2 - s.x1) * (s.y2 - s.y1);
    // Fundo: preenchimento do tamanho da página inteira (o Corel costuma pôr
    // um retângulo branco atrás de tudo) — não é a peça.
    const ehFundo = (s) => s.modo === "fill" && area(s) >= 0.97 * larg * alt;
    // A linha de corte é um TRAÇO; só sem traço nenhum vale um preenchimento.
    const tracos = subcaminhos.filter((s) => s.modo === "traco");
    const candidatos = tracos.length ? tracos : subcaminhos.filter((s) => !ehFundo(s));
    if (!candidatos.length) return null;
    const maior = candidatos.reduce((a, b) => (area(b) > area(a) ? b : a));
    // Tem que ocupar boa parte do molde, senão não é o contorno.
    if (area(maior) < 0.4 * larg * alt) return null;

    const f = (v) => String(Math.round(v * 100) / 100);
    const X = (v) => f((v - mx1) / PT_POR_MM);
    const Y = (v) => f((my2 - v) / PT_POR_MM);
    return maior.cmds.map((c) => {
      if (c[0] === "M" || c[0] === "L") return `${c[0]} ${X(c[1])} ${Y(c[2])}`;
      if (c[0] === "C") return `C ${X(c[1])} ${Y(c[2])} ${X(c[3])} ${Y(c[4])} ${X(c[5])} ${Y(c[6])}`;
      return "Z";
    }).join(" ");
  }

  // Lê um fluxo de conteúdo de PDF e junta os subcaminhos desenhados (já na
  // coordenada da página), cada um com a sua caixa.
  function lerConteudoPdf(fluxo, saida) {
    const tokens = fluxo.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/\[\]()<>]+|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z'"*]+\*?/g) || [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const pilha = [];
    let pilhaNum = [];
    let atual = null;
    let caminho = [];
    let px = 0, py = 0;
    const tp = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const novo = () => {
      atual = { cmds: [], x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      caminho.push(atual);
    };
    const ponto = (x, y) => {
      const [X, Y] = tp(x, y);
      if (X < atual.x1) atual.x1 = X;
      if (X > atual.x2) atual.x2 = X;
      if (Y < atual.y1) atual.y1 = Y;
      if (Y > atual.y2) atual.y2 = Y;
      return [X, Y];
    };
    // `modo`: "traco" (S/s/B/b — a linha de corte), "fill" (f/F) ou null
    // (n: caminho de RECORTE, não é desenho — fica de fora).
    const pintar = (modo) => {
      if (modo) caminho.forEach((s) => { if (s.cmds.length > 1) { s.modo = modo; saida.push(s); } });
      caminho = [];
      atual = null;
    };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const n = Number(t);
      if (t !== "" && !isNaN(n) && /^[-+.\d]/.test(t)) { pilhaNum.push(n); continue; }
      const a = pilhaNum;
      pilhaNum = [];
      switch (t) {
        case "q": pilha.push(ctm.slice()); break;
        case "Q": ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]; break;
        case "cm": {
          if (a.length < 6) break;
          const [A, B, C, D, E, F] = a.slice(-6);
          const c = ctm;
          ctm = [A * c[0] + B * c[2], A * c[1] + B * c[3], C * c[0] + D * c[2], C * c[1] + D * c[3],
            E * c[0] + F * c[2] + c[4], E * c[1] + F * c[3] + c[5]];
          break;
        }
        case "m": novo(); px = a[0]; py = a[1]; atual.cmds.push(["M", ...ponto(px, py)]); break;
        case "l": if (!atual) novo(); px = a[0]; py = a[1]; atual.cmds.push(["L", ...ponto(px, py)]); break;
        case "c":
          if (!atual) novo();
          atual.cmds.push(["C", ...ponto(a[0], a[1]), ...ponto(a[2], a[3]), ...ponto(a[4], a[5])]);
          px = a[4]; py = a[5];
          break;
        case "v":
          if (!atual) novo();
          atual.cmds.push(["C", ...ponto(px, py), ...ponto(a[0], a[1]), ...ponto(a[2], a[3])]);
          px = a[2]; py = a[3];
          break;
        case "y":
          if (!atual) novo();
          atual.cmds.push(["C", ...ponto(a[0], a[1]), ...ponto(a[2], a[3]), ...ponto(a[2], a[3])]);
          px = a[2]; py = a[3];
          break;
        case "re": {
          const [x, y, w, h] = a.slice(-4);
          novo();
          atual.cmds.push(["M", ...ponto(x, y)], ["L", ...ponto(x + w, y)], ["L", ...ponto(x + w, y + h)], ["L", ...ponto(x, y + h)], ["Z"]);
          break;
        }
        case "h": if (atual) atual.cmds.push(["Z"]); break;
        case "S": case "s": case "B": case "B*": case "b": case "b*":
          pintar("traco");
          break;
        case "f": case "F": case "f*":
          pintar("fill");
          break;
        case "n":
          pintar(null);
          break;
        case "BI": // imagem embutida: pula até o EI
          while (i < tokens.length && tokens[i] !== "EI") i++;
          break;
        default: break;
      }
    }
  }

  // Texto do contorno ("M x y L ... Z") → comandos { type, x, y, x1... }.
  function comandosDoContorno(str) {
    const t = String(str || "").trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < t.length;) {
      const op = t[i++];
      const n = () => Number(t[i++]);
      if (op === "M" || op === "L") out.push({ type: op, x: n(), y: n() });
      else if (op === "C") out.push({ type: "C", x1: n(), y1: n(), x2: n(), y2: n(), x: n(), y: n() });
      else if (op === "Z") out.push({ type: "Z" });
      else break;
    }
    return out;
  }

  // Sangria: o contorno um pouco maior (escala a partir do centro, `mm` para
  // cada lado). Numa peça de 500 mm, 2 mm de sangria erram menos de um
  // décimo de mm nas curvas fechadas — suficiente para não sobrar branco.
  function contornoComSangria(cmds, w, h, mm) {
    if (!(mm > 0)) return cmds;
    const sx = (w + 2 * mm) / w, sy = (h + 2 * mm) / h;
    const cx = w / 2, cy = h / 2;
    return cmds.map((c) => {
      const n = { type: c.type };
      ["x", "x1", "x2"].forEach((k) => { if (c[k] != null) n[k] = cx + (c[k] - cx) * sx; });
      ["y", "y1", "y2"].forEach((k) => { if (c[k] != null) n[k] = cy + (c[k] - cy) * sy; });
      return n;
    });
  }

  // ---------------- Arquivos do time por peça ----------------
  // Uma arte só serve para as DUAS mangas (menos arquivo no Drive): a manga
  // direita usa a da esquerda, a não ser que o time tenha ativado "manga
  // direita com arte diferente" e enviado a dela. O mesmo vale para o
  // detalhe da manga. `chave` identifica a imagem na folha — a mesma arte
  // nas duas mangas entra uma vez só no arquivo.
  function arteDaPeca(prod, pecaId) {
    const pecas = (prod && prod.pecas) || {};
    if (pecaId === "mangaDir" && !(prod.mangaDirDiferente && pecas.mangaDir)) {
      return pecas.mangaEsq ? { arte: pecas.mangaEsq, chave: "arte:mangaEsq" } : null;
    }
    return pecas[pecaId] ? { arte: pecas[pecaId], chave: "arte:" + pecaId } : null;
  }

  // Chave (em rec.eps / rec.imagens) do arquivo de um elemento de imagem.
  function chaveDoElemento(el) {
    return "elem:" + el.id;
  }

  function detalheDaPeca(prod, pecaId) {
    if (!prod) return null;
    if (pecaId === "mangaDir" && prod.detalheDirDiferente && prod.detalheMangaDir) {
      return { img: prod.detalheMangaDir, chave: "detalhe:dir" };
    }
    return prod.detalheManga ? { img: prod.detalheManga, chave: "detalhe" } : null;
  }

  // ---------------- Marcador da costureira ----------------
  // Cada peça leva, dentro da área de impressão, "Time-Tamanho-Peça"
  // (ex.: 7B-P-Frente), com 4 mm de altura (a altura das maiúsculas) e a
  // 1 mm da borda de baixo do MOLDE (o contorno; sem contorno, a caixa),
  // centralizado. Na gola, que é uma faixa, vai na lateral esquerda, na
  // vertical (lendo de baixo para cima), também a 1 mm da borda e com 4 mm.
  const MARCADOR_ALTURA_MM = 4;
  // Faca (linha de corte) desenhada a partir do contorno: 3 mm de espessura,
  // toda para FORA do molde — não cobre a arte nem o marcador.
  const LINHA_CORTE_MM = 3;
  const MARCADOR_MARGEM_MM = 1;

  function textoDoMarcador(nomeTime, tamanho, nomePeca) {
    return [nomeTime, tamanho, nomePeca].map((v) => String(v || "").trim()).filter(Boolean).join("-");
  }

  function caixaDosComandos(cmds) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    cmds.forEach((c) => {
      ["", "1", "2"].forEach((s) => {
        const x = c["x" + s], y = c["y" + s];
        if (x == null) return;
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      });
    });
    return { x1, y1, x2, y2 };
  }

  // Contorno achatado em polígonos (as curvas viram segmentos).
  function poligonosDoContorno(cmds) {
    const polis = [];
    let atual = null, cx = 0, cy = 0;
    (cmds || []).forEach((c) => {
      if (c.type === "M") { atual = [[c.x, c.y]]; polis.push(atual); cx = c.x; cy = c.y; }
      else if (c.type === "L") { if (atual) atual.push([c.x, c.y]); cx = c.x; cy = c.y; }
      else if (c.type === "C") {
        if (!atual) return;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          atual.push([
            u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y
          ]);
        }
        cx = c.x; cy = c.y;
      }
    });
    return polis.filter((p) => p.length > 2);
  }

  // Contorno deslocado `d` mm para FORA (cada polígono do contorno, com as
  // curvas achatadas). A faca é um traço de 3 mm sobre o contorno deslocado
  // 1,5 mm: fica inteira por fora do molde sem depender de recorte (o
  // importador do Corel ignora o recorte de traços).
  function deslocarContorno(cmds, d) {
    const dentroPoli = (p, x, y) => {
      let c = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const saida = [];
    poligonosDoContorno(cmds).forEach((orig) => {
      // Sem pontos repetidos (nem o último igual ao primeiro).
      const p = [];
      orig.forEach((q) => {
        const u = p[p.length - 1];
        if (!u || Math.hypot(q[0] - u[0], q[1] - u[1]) > 1e-6) p.push(q);
      });
      while (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) p.pop();
      if (p.length < 3) return;
      const n = p.length;
      const normal = (i) => {
        const a = p[i], b = p[(i + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return [dy / l, -dx / l];
      };
      // Lado de fora: testa a maior aresta.
      let maior = 0, lmax = 0;
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > lmax) { lmax = l; maior = i; }
      }
      const nm = normal(maior), a = p[maior], b = p[(maior + 1) % n];
      const mx = (a[0] + b[0]) / 2 + nm[0] * 0.01, my = (a[1] + b[1]) / 2 + nm[1] * 0.01;
      const sinal = dentroPoli(p, mx, my) ? -1 : 1;
      const pts = p.map((q, i) => {
        const n1 = normal((i - 1 + n) % n), n2 = normal(i);
        let bx = n1[0] + n2[0], by = n1[1] + n2[1];
        const lb = Math.hypot(bx, by);
        if (lb < 1e-9) { bx = n2[0]; by = n2[1]; } else { bx /= lb; by /= lb; }
        const cos = bx * n2[0] + by * n2[1];
        const k = Math.min(3 * d, d / Math.max(cos, 1e-3));
        return [q[0] + sinal * bx * k, q[1] + sinal * by * k];
      });
      pts.forEach((q, i) => saida.push({ type: i ? "L" : "M", x: q[0], y: q[1] }));
      saida.push({ type: "Z" });
    });
    return saida;
  }

  // Onde uma reta (x = v, ou y = v com `horizontal`) cruza o contorno.
  function cortes(polis, v, horizontal) {
    const out = [];
    polis.forEach((p) => {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const [a0, a1] = horizontal ? [a[1], a[0]] : [a[0], a[1]];
        const [b0, b1] = horizontal ? [b[1], b[0]] : [b[0], b[1]];
        if ((a0 <= v && b0 > v) || (b0 <= v && a0 > v)) out.push(a1 + ((v - a0) * (b1 - a1)) / (b0 - a0));
      }
    });
    return out.sort((x, y) => x - y);
  }

  // Comandos (mm, relativos ao canto de cima da peça) do marcador. Com o
  // `contorno` do molde (comandos), o marcador fica a 1 mm da borda REAL da
  // peça — barra curva, manga que afina... —, sempre dentro da área de
  // impressão (a faca de 3 mm fica toda por fora do contorno).
  function marcadorDaPeca(fonte, texto, pecaW, pecaH, vertical, contorno) {
    const A = MARCADOR_ALTURA_MM, M = MARCADOR_MARGEM_MM;
    const polis = poligonosDoContorno(contorno);
    if (!texto) return [];
    if (vertical) return marcadorVertical(fonte, texto, pecaW, pecaH, polis);

    let comprimento = pecaW - 2 * M, centro = pecaW / 2;
    let res = [];
    for (let tentativa = 0; tentativa < 8 && comprimento > 2; tentativa++) {
      const l = layoutTexto(fonte, texto, { w: comprimento, h: A }, { maiusculas: false, alinhamento: "centro" });
      if (!l.comandos.length) return [];
      const cx = caixaDosComandos(l.comandos);
      const larg = cx.x2 - cx.x1, alt = cx.y2 - cx.y1;
      const x0 = centro - larg / 2, x1 = x0 + larg;
      // Sem contorno: a 1 mm da base da caixa (a tinta, com as pernas do g, p...).
      let base = pecaH - M;
      if (polis.length) {
        // A borda de baixo do contorno em cada x do texto; a mais alta manda.
        let borda = Infinity;
        for (let k = 0; k <= 20; k++) {
          const ys = cortes(polis, x0 + ((x1 - x0) * k) / 20, false);
          if (ys.length) borda = Math.min(borda, ys[ys.length - 1]);
        }
        if (borda < Infinity) base = borda - M;
      }
      res = deslocarComandos(l.comandos, x0 - cx.x1, base - cx.y2);
      if (!polis.length) return res;
      // Cabe na largura do contorno nessa altura (com 1 mm de cada lado)?
      let esq = -Infinity, dir = Infinity;
      for (let k = 0; k <= 6; k++) {
        const y = base - (alt * k) / 6;
        const xs = cortes(polis, y, true);
        let l0 = null, r0 = null;
        for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i] <= centro && xs[i + 1] >= centro) { l0 = xs[i]; r0 = xs[i + 1]; }
        if (l0 == null) { l0 = xs[0]; r0 = xs[xs.length - 1]; }
        if (l0 != null) { esq = Math.max(esq, l0); dir = Math.min(dir, r0); }
      }
      if (!(dir > esq) || (esq + M <= x0 + 0.05 && dir - M >= x1 - 0.05)) return res;
      // Não cabe: centraliza no que há e encolhe.
      centro = (esq + dir) / 2;
      comprimento = Math.min(comprimento, dir - esq - 2 * M) - 0.2;
    }
    return res;
  }

  // Gola: na lateral esquerda, na vertical (lendo de baixo para cima), a
  // 1 mm da borda esquerda do contorno.
  function marcadorVertical(fonte, texto, pecaW, pecaH, polis) {
    const A = MARCADOR_ALTURA_MM, M = MARCADOR_MARGEM_MM;
    const comprimento = pecaH - 2 * M;
    if (comprimento <= 0) return [];
    const l = layoutTexto(fonte, texto, { w: comprimento, h: A }, { maiusculas: false, alinhamento: "centro" });
    if (!l.comandos.length) return [];
    const cx = caixaDosComandos(l.comandos);
    // Gira 90° (de baixo para cima): o "chão" das letras vira o lado direito.
    const gira = (x, y) => [y, pecaH - M - x];
    let deslocX = M - cx.y1; // a parte de cima das letras a 1 mm da esquerda
    if (polis.length) {
      // Faixa de y ocupada pelo texto girado e a borda esquerda do contorno nela.
      const yA = pecaH - M - cx.x2, yB = pecaH - M - cx.x1;
      let borda = -Infinity;
      for (let k = 0; k <= 20; k++) {
        const xs = cortes(polis, yA + ((yB - yA) * k) / 20, true);
        if (xs.length) borda = Math.max(borda, xs[0]);
      }
      if (borda > -Infinity) deslocX = borda + M - cx.y1;
    }
    return l.comandos.map((c) => {
      const n = { type: c.type };
      ["", "1", "2"].forEach((s) => {
        if (c["x" + s] == null) return;
        const [x, y] = gira(c["x" + s], c["y" + s]);
        n["x" + s] = x + deslocX;
        n["y" + s] = y;
      });
      return n;
    });
  }

  // ---------------- Montagem das peças ----------------

  // Monta os blocos (uma peça de uma camiseta cada) de UM time.
  //
  // moldes:    config/moldes ({ tamanhoBase, pecas: { pecaId: { tam: { epsId, bbox } } } })
  // layout:    config/layout ({ pecas: { pecaId: { elementos: [...] } } })
  // time:      { producao: { pecas: { pecaId: { larguraPx, alturaPx, dpi } }, brasao: {...}, layoutAjustes } }
  // camisetas: [{ nome, nomeCamiseta, numero, tamanho }]
  // rec:       recursos carregados — { fonte, eps: { chave: { bytes, bbox } } }
  //            (as imagens são referenciadas por "arte:<pecaId>")
  // opcoes:    { molde: "frente"|"fundo"|"nenhum", etiqueta: bool, pecas: [pecaIds] }
  //
  // Devolve { blocos, avisos }. As ops de cada bloco estão em mm, relativas
  // ao canto de cima do bloco (sem rotação):
  //   { tipo: "eps", chave, x, y, w, h }
  //   { tipo: "imagem", chave, x, y, w, h }
  //   { tipo: "caminho", comandos, cmyk, contorno: { cmyk, mm } | null }
  // Elementos de uma peça num time: os do layout geral e, por cima, os que
  // só esse time tem (producao.elementosExtras[pecaId]).
  function elementosDaPecaNoTime(layout, prod, pecaId) {
    const gerais = ((((layout && layout.pecas) || {})[pecaId] || {}).elementos) || [];
    const extras = ((prod && prod.elementosExtras) || {})[pecaId] || [];
    return extras.length ? gerais.concat(extras) : gerais;
  }

  // ---------------- Peças virtuais (sem molde EPS) ----------------
  // Retângulos que vão na folha junto das peças de cada camiseta:
  //   • reforcoOmbro — retalho de reforço de ombro, 25 mm de largura e o
  //     comprimento do tamanho (moldes.reforcoOmbro[tam], aba Tamanhos), em
  //     cor sólida;
  //   • etiquetaTam — etiqueta de tamanho, com o tamanho definido na aba
  //     Etiqueta do editor (layout.pecas.etiquetaTam) e os elementos dela.
  const REFORCO_LARGURA_MM = 25;
  const PECAS_VIRTUAIS = { reforcoOmbro: "Reforço de ombro", etiquetaTam: "Etiqueta" };

  function medidasEtiqueta(layout) {
    const e = ((layout && layout.pecas) || {}).etiquetaTam || {};
    return { w: Number(e.larguraMm) > 0 ? Number(e.larguraMm) : 50, h: Number(e.alturaMm) > 0 ? Number(e.alturaMm) : 30 };
  }

  // Comprimento automático do reforço (mm): a borda de cima do molde das
  // COSTAS, de uma cava à outra (ombro, gola, ombro), + folga de costura.
  // A borda é seguida do meio para fora pela parte mais alta do contorno;
  // termina onde a linha começa a descer forte (a cava, inclinação > 45°).
  const REFORCO_FOLGA_MM = 20;
  const cacheReforco = {};
  function bordaDeOmbroAOmbro(contorno) {
    if (!contorno) return 0;
    if (cacheReforco[contorno] != null) return cacheReforco[contorno];
    const polis = poligonosDoContorno(comandosDoContorno(contorno));
    if (!polis.length) return (cacheReforco[contorno] = 0);
    const p = polis.reduce((a, b) => (b.length > a.length ? b : a));
    let x0 = Infinity, x1 = -Infinity;
    p.forEach((q) => { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; });
    const topo = (x) => {
      let m = null;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
          const y = a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
          if (m == null || y < m) m = y;
        }
      }
      return m;
    };
    const xc = (x0 + x1) / 2, passo = 1;
    const lado = (dir) => {
      let x = xc, y = topo(x), L = 0;
      if (y == null) return 0;
      for (;;) {
        const nx = x + dir * passo;
        if (nx <= x0 || nx >= x1) break;
        const ny = topo(nx);
        if (ny == null || (ny - y) / passo > 1) break; // começou a cava
        L += Math.hypot(passo, ny - y);
        x = nx; y = ny;
      }
      return L;
    };
    return (cacheReforco[contorno] = Math.round(lado(-1) + lado(1)));
  }

  // Comprimento do reforço num tamanho: o da aba Tamanhos ou, sem ele, o
  // automático pelo molde das costas. { mm, auto } ou null.
  function comprimentoReforco(moldes, tam) {
    const manual = Number(((moldes && moldes.reforcoOmbro) || {})[tam]);
    if (manual > 0) return { mm: manual, auto: false };
    const m = (((moldes && moldes.pecas) || {}).costas || {})[tam];
    const b = m && m.contorno ? bordaDeOmbroAOmbro(m.contorno) : 0;
    return b > 0 ? { mm: b + REFORCO_FOLGA_MM, auto: true } : null;
  }

  // { bbox (pt), contorno (retângulo, mm), virtual } ou null (sem medida).
  function moldeVirtual(moldes, layout, pecaId, tam) {
    let d = null;
    if (pecaId === "reforcoOmbro") {
      const c = comprimentoReforco(moldes, tam);
      if (c) d = { w: c.mm, h: REFORCO_LARGURA_MM };
    } else if (pecaId === "etiquetaTam") {
      d = medidasEtiqueta(layout);
    }
    if (!d) return null;
    const r = (v) => Math.round(v * 100) / 100;
    return {
      virtual: true,
      bbox: { x1: 0, y1: 0, x2: d.w * PT_POR_MM, y2: d.h * PT_POR_MM },
      contorno: `M 0 0 L ${r(d.w)} 0 L ${r(d.w)} ${r(d.h)} L 0 ${r(d.h)} Z`
    };
  }

  // Cor de fundo de uma peça virtual (null = sem fundo).
  function fundoVirtual(moldes, layout, prod, pecaId) {
    if (pecaId === "reforcoOmbro") return (prod && prod.reforcoCmyk) || (moldes && moldes.reforcoCmyk) || [0, 0, 0, 0];
    if (pecaId === "etiquetaTam") return (((layout && layout.pecas) || {}).etiquetaTam || {}).fundoCmyk || [0, 0, 0, 0];
    return null;
  }

  // Giro/espelho que vai na op de imagem ou EPS (o escritor aplica).
  function giroDaOp(el) {
    const o = {};
    if (Number(el.rotacao)) o.rot = Number(el.rotacao);
    if (el.espelharH) o.flipH = true;
    if (el.espelharV) o.flipV = true;
    return o;
  }

  function montarBlocos(moldes, layout, time, camisetas, rec, opcoes) {
    const op = opcoes || {};
    const posMolde = op.molde || "frente";
    const avisos = [];
    const avisar = (t) => { if (!avisos.includes(t)) avisos.push(t); };
    const prod = (time && time.producao) || {};
    const ajustes = prod.layoutAjustes || {};
    const pecasIds = op.pecas || Object.keys((layout && layout.pecas) || {});

    const blocos = [];
    camisetas.forEach((camOrig) => {
      // O nome do time serve aos textos da etiqueta (campo "time").
      const cam = { ...camOrig, nomeTime: op.nomeTime || "" };
      pecasIds.forEach((pecaId) => {
        const virtual = !!PECAS_VIRTUAIS[pecaId];
        const moldesPeca = (moldes.pecas || {})[pecaId] || {};
        const molde = virtual ? moldeVirtual(moldes, layout, pecaId, cam.tamanho) : moldesPeca[cam.tamanho];
        const ad = virtual ? null : arteDaPeca(prod, pecaId);
        const arte = ad && ad.arte;
        const elementos = elementosDaPecaNoTime(layout, prod, pecaId);
        if (!virtual && !arte && !elementos.length) return; // peça sem nada deste time
        if (!molde || !molde.bbox) {
          avisar(pecaId === "reforcoOmbro"
            ? `Sem o comprimento do reforço de ombro para o tamanho ${cam.tamanho || "(vazio)"} (sem molde das costas com contorno nesse tamanho e sem valor na aba Tamanhos) — o reforço ficou de fora.`
            : `Sem molde de corte de "${op.nomePeca ? op.nomePeca(pecaId) : pecaId}" no tamanho ${cam.tamanho || "(vazio)"} — essa peça ficou de fora.`);
          return;
        }
        const tam = tamanhoMmDoBbox(molde.bbox);
        const mb = virtual ? null : moldesPeca[moldes.tamanhoBase];
        const tamBase = mb && mb.bbox ? tamanhoMmDoBbox(mb.bbox) : tam;

        const ops = [];
        // Peça virtual: fundo de cor sólida (reforço, fundo da etiqueta).
        const fundo = virtual ? fundoVirtual(moldes, layout, prod, pecaId) : null;
        if (fundo && fundo.some((v) => Number(v) > 0)) {
          ops.push({ tipo: "caminho", recortar: true, cmyk: fundo,
            comandos: [{ type: "M", x: -5, y: -5 }, { type: "L", x: tam.w + 5, y: -5 }, { type: "L", x: tam.w + 5, y: tam.h + 5 }, { type: "L", x: -5, y: tam.h + 5 }, { type: "Z" }] });
        }
        const opMolde = { tipo: "eps", chave: "molde:" + pecaId + ":" + cam.tamanho, x: 0, y: 0, w: tam.w, h: tam.h };
        // Faca a partir do contorno (3 mm por fora); sem contorno lido, vai o
        // EPS do molde como veio (com a espessura de linha do arquivo).
        const faca = molde.contorno
          ? { tipo: "linha", comandos: deslocarContorno(comandosDoContorno(molde.contorno), LINHA_CORTE_MM / 2), cmyk: [0, 0, 0, 100], mm: LINHA_CORTE_MM }
          : opMolde;
        if (posMolde === "fundo") ops.push(faca);

        // Tudo o que é arte (imagem, brasão, logo, textos) é recortado no
        // formato do molde, quando o contorno dele é conhecido.
        const recortar = !!molde.contorno;
        if (!recortar) {
          avisar(`O molde de "${op.nomePeca ? op.nomePeca(pecaId) : pecaId}" ${cam.tamanho} está sem contorno — a arte dessa peça saiu retangular (aba Tamanhos → Ler contornos).`);
        }
        if (arte && arte.larguraPx) {
          ops.push({ tipo: "imagem", chave: ad.chave, recortar, arteDaPeca: true, ...caixaArte(arte, tamBase, tam, op.sangriaMm == null ? 2 : op.sangriaMm) });
        }

        elementos.forEach((elGeral) => {
          const ajTime = (ajustes[pecaId] || {})[elGeral.id];
          const el = elementoDoTime(elGeral, ajTime);
          if (!el) return; // oculto neste time
          const caixa = caixaEfetiva(el, cam.tamanho, tamBase, tam, ajTime);
          if (el.tipo === "detalhe") {
            const d = detalheDaPeca(prod, pecaId);
            const img = d && rec.imagens && rec.imagens[d.chave];
            if (!img) { avisar("O time não tem o detalhe da manga (PNG) — a caixa do detalhe ficou vazia."); return; }
            // `livre`: a imagem estica na caixa (largura e altura independentes).
            ops.push({ tipo: "imagem", chave: d.chave, recortar, ...giroDaOp(el), ...(imagemLivre(el) ? caixa : encaixarProporcional(caixa, img.largura, img.altura)) });
            return;
          }
          // Imagem própria (acrescentada no layout): PNG (convertido para
          // CMYK) ou EPS.
          if (el.tipo === "imagem") {
            const chave = chaveDoElemento(el);
            const a = el.arquivo || {};
            const nome = a.nomeArquivo || "imagem";
            if (a.formato === "eps") {
              const e = rec.eps && rec.eps[chave];
              if (!e) { avisar(`A imagem "${nome}" não carregou — ficou de fora.`); return; }
              const t = tamanhoMmDoBbox(e.bbox);
              ops.push({ tipo: "eps", chave, recortar, ...giroDaOp(el), ...(imagemLivre(el) ? caixa : encaixarProporcional(caixa, t.w, t.h)) });
            } else {
              const img = rec.imagens && rec.imagens[chave];
              if (!img) { avisar(`A imagem "${nome}" não carregou — ficou de fora.`); return; }
              ops.push({ tipo: "imagem", chave, recortar, ...giroDaOp(el), ...(imagemLivre(el) ? caixa : encaixarProporcional(caixa, img.largura, img.altura)) });
            }
            return;
          }
          if (el.tipo === "brasao" || el.tipo === "logo") {
            const e = rec.eps && rec.eps[el.tipo];
            if (!e) {
              avisar(el.tipo === "logo"
                ? "Sem logo da empresa (Configurações) — a caixa do logo ficou vazia."
                : "O time não tem brasão (EPS) — a caixa do brasão ficou vazia.");
              return;
            }
            const t = tamanhoMmDoBbox(e.bbox);
            ops.push({ tipo: "eps", chave: el.tipo, recortar, ...giroDaOp(el), ...(imagemLivre(el) ? caixa : encaixarProporcional(caixa, t.w, t.h)) });
            return;
          }
          if (!rec.fonte) { avisar("O time não tem fonte — nome e número ficaram de fora."); return; }
          const valor = textoDoCampo(el, cam);
          if (!String(valor).trim()) return;
          const l = textoDoElemento(rec.fonte, valor, caixa, el);
          if (!l.comandos.length) return;
          const c1 = Number(el.contornoMm) || 0, c2 = Number(el.contorno2Mm) || 0;
          const sombra = sombraDoElemento(el);
          if (sombra) {
            // A sombra tem o tamanho da letra com os contornos, na cor da sombra.
            ops.push({
              tipo: "caminho", recortar,
              comandos: deslocarComandos(l.comandos, caixa.x + sombra.dx, caixa.y + sombra.dy),
              cmyk: sombra.cmyk,
              contorno: c1 + c2 > 0 ? { cmyk: sombra.cmyk, mm: c1 + c2 } : null
            });
          }
          ops.push({
            tipo: "caminho",
            recortar,
            comandos: deslocarComandos(l.comandos, caixa.x, caixa.y),
            cmyk: el.corCmyk || [0, 0, 0, 100],
            contorno: c1 > 0 ? { cmyk: el.contornoCmyk || [0, 0, 0, 0], mm: c1 } : null,
            contorno2: c2 > 0 ? { cmyk: el.contorno2Cmyk || [0, 0, 0, 100], mm: c1 + c2 } : null
          });
        });

        // Marcador para a costureira, DENTRO da área de impressão:
        // "Time-Tamanho-Peça" (ex.: 7B-P-Frente), ver marcadorDaPeca().
        if (op.etiqueta !== false && !rec.fonteEtiqueta && pecaId !== "etiquetaTam") {
          avisar("Sem a fonte do marcador — as peças saíram sem a marcação da costureira.");
        }
        if (op.etiqueta !== false && rec.fonteEtiqueta && pecaId !== "etiquetaTam") {
          const texto = textoDoMarcador(op.nomeTime, cam.tamanho, op.nomePeca ? op.nomePeca(pecaId) : pecaId);
          const cmds = marcadorDaPeca(rec.fonteEtiqueta, texto, tam.w, tam.h, pecaId === "gola",
            molde.contorno ? comandosDoContorno(molde.contorno) : null);
          if (cmds.length) {
            ops.push({ tipo: "caminho", recortar, comandos: cmds, cmyk: [0, 0, 0, 100], contorno: { cmyk: [0, 0, 0, 0], mm: 0.25 } });
          }
        }

        // Faca por cima: com o contorno conhecido, ela é desenhada a partir
        // dele — o EPS do molde costuma trazer um fundo branco preenchido
        // (Corel) que taparia a arte inteira.
        if (posMolde === "frente") ops.push(faca);
        if (posMolde !== "nenhum" && !molde.contorno) {
          avisar(`O molde de "${op.nomePeca ? op.nomePeca(pecaId) : pecaId}" ${cam.tamanho} está sem contorno — a faca saiu com a espessura do próprio arquivo, não com 3 mm (aba Tamanhos → Reler contornos).`);
        }
        const h = tam.h;
        const contorno = recortar
          ? contornoComSangria(comandosDoContorno(molde.contorno), tam.w, tam.h, op.sangriaMm == null ? 2 : Number(op.sangriaMm))
          : null;
        // `borda`: a faca passa do molde; o encaixe reserva essa folga em volta.
        const borda = posMolde !== "nenhum" && molde.contorno ? LINHA_CORTE_MM : 0;
        blocos.push({ w: tam.w, h, ops, contorno, borda, rotulo: `${op.nomePeca ? op.nomePeca(pecaId) : pecaId} ${cam.tamanho}` });
      });
    });
    return { blocos, avisos };
  }

  // ---------------- Escrita do PostScript ----------------

  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

  // ASCII85 em fluxo sobre uma lista de pedaços (o "~>" no fim é do próprio
  // formato), com quebra de linha a cada 75 caracteres — mantém o EPS 100%
  // texto. Devolve uma lista de pedaços (Uint8Array).
  function ascii85(pedacos) {
    const lista = pedacos instanceof Uint8Array ? [pedacos] : pedacos;
    const saidas = [];
    let buf = new Uint8Array(65536 + 16);
    let o = 0, coluna = 0;
    const put = (ch) => {
      buf[o++] = ch;
      if (++coluna === 75) { buf[o++] = 10; coluna = 0; }
      if (o >= 65536) { saidas.push(buf.slice(0, o)); o = 0; }
    };
    const grupo = [0, 0, 0, 0];
    let ng = 0;
    const d = [0, 0, 0, 0, 0];
    const emitir = (n) => {
      const v = (((grupo[0] << 24) >>> 0) + (grupo[1] << 16) + (grupo[2] << 8) + grupo[3]) >>> 0;
      if (v === 0 && n === 4) { put(122); return; } // "z"
      let t = v;
      for (let j = 4; j >= 0; j--) { d[j] = t % 85; t = Math.floor(t / 85); }
      for (let j = 0; j < n + 1; j++) put(d[j] + 33);
    };
    lista.forEach((p) => {
      for (let i = 0; i < p.length; i++) {
        grupo[ng++] = p[i];
        if (ng === 4) { emitir(4); ng = 0; }
      }
    });
    if (ng > 0) {
      for (let j = ng; j < 4; j++) grupo[j] = 0;
      emitir(ng);
    }
    buf[o++] = 126; buf[o++] = 62; buf[o++] = 10; // "~>\n"
    saidas.push(buf.slice(0, o));
    return saidas;
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

  // Estimativa do tamanho do arquivo (bytes), para avisar antes de gerar.
  // `op.corel`: cada uso da imagem entra no arquivo (ver escreverEps).
  function estimarTamanho(folha, rec, opcoes) {
    let t = 4096;
    const corel = !!(opcoes && opcoes.corel);
    const imgs = corel ? [] : new Set();
    folha.blocos.forEach(({ bloco }) => bloco.ops.forEach((op) => {
      if (op.tipo === "imagem") { if (corel) imgs.push(op.chave); else imgs.add(op.chave); }
      else if (op.tipo === "eps" && rec.eps[op.chave]) t += rec.eps[op.chave].bytes.length + 300;
      else if (op.tipo === "caminho") t += op.comandos.length * 40;
    }));
    imgs.forEach((k) => {
      const img = rec.imagens[k];
      if (!img) return;
      const soma = (l) => (l || []).reduce((s, p) => s + p.length, 0);
      t += (soma(img.cmykZ) + soma(img.mascaraZ)) * 1.25;
    });
    return t;
  }

  // Escreve uma folha como EPS. Devolve uma lista de pedaços (strings e
  // Uint8Array) — é só passar para `new Blob(pedacos)`.
  //
  // folha: { larguraMm, alturaMm, blocos: [{ bloco: { w, h, ops }, x, y, w, h, rot }] }
  // rec:   { eps: { chave: { bytes, bbox } },
  //          imagens: { chave: { largura, altura, cmykZ: [..], mascaraZ: [..] | null } } }
  // Máscara de transparência (bits, 1 = transparente) → retângulos das
  // partes opacas, em coordenadas da imagem (0–1, y para cima), para usar
  // como recorte no lugar da imagem com máscara (ImageType 3), que o
  // importador do Corel não aceita bem. Calculada numa grade de até ~1500 px.
  function recorteDaMascara(img, inflar) {
    const juntar = (l) => { const n = l.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; l.forEach((p) => { o.set(p, i); i += p.length; }); return o; };
    const m = inflar(juntar(img.mascaraZ));
    const w = img.largura, h = img.altura, bl = Math.ceil(w / 8);
    const f = Math.max(1, Math.ceil(Math.max(w, h) / 1500));
    const wr = Math.ceil(w / f), hr = Math.ceil(h / f);
    const opaco = (x, y) => !((m[y * bl + (x >> 3)] >> (7 - (x & 7))) & 1);
    const faixas = []; // { y0, y1, runs: "x0-x1,..." }
    for (let yr = 0; yr < hr; yr++) {
      const y = Math.min(h - 1, yr * f + (f >> 1));
      const runs = [];
      let ini = -1;
      for (let xr = 0; xr <= wr; xr++) {
        const op = xr < wr && opaco(Math.min(w - 1, xr * f + (f >> 1)), y);
        if (op && ini < 0) ini = xr;
        if (!op && ini >= 0) { runs.push([ini, xr]); ini = -1; }
      }
      const chave = runs.map((r) => r.join("-")).join(",");
      const ult = faixas[faixas.length - 1];
      if (ult && ult.chave === chave) ult.y1 = yr + 1;
      else faixas.push({ y0: yr, y1: yr + 1, runs, chave });
    }
    const n = (v) => Math.round(v * 1e5) / 1e5;
    let s = "";
    faixas.forEach((fx) => fx.runs.forEach(([x0, x1]) => {
      const X0 = n(Math.min(1, (x0 * f) / w)), X1 = n(Math.min(1, (x1 * f) / w));
      const Ytopo = n(1 - Math.min(1, (fx.y0 * f) / h)), Ybase = n(1 - Math.min(1, (fx.y1 * f) / h));
      s += `${X0} ${Ybase} m ${X1} ${Ybase} l ${X1} ${Ytopo} l ${X0} ${Ytopo} l h\n`;
    }));
    return s || "0 0 m 0 0 l h\n";
  }

  // opcoes.corel: EPS "simples" para o importador do Corel — cada imagem vai
  // inteira no ponto em que é desenhada (sem fluxo reaproveitável nem
  // resetfile) e a transparência vira recorte vetorial (sem ImageType 3).
  // O arquivo fica maior quando a mesma arte se repete.
  function escreverEps(folha, rec, titulo, opcoes) {
    const corel = !!(opcoes && opcoes.corel);
    const HS = folha.alturaMm * PT_POR_MM;
    const WS = folha.larguraMm * PT_POR_MM;
    const k = PT_POR_MM;
    const pedacos = [];
    const escrever = (s) => pedacos.push(enc ? enc.encode(s) : s);

    escrever(
      "%!PS-Adobe-3.0 EPSF-3.0\n" +
      `%%BoundingBox: 0 0 ${Math.ceil(WS)} ${Math.ceil(HS)}\n` +
      `%%HiResBoundingBox: 0 0 ${num(WS)} ${num(HS)}\n` +
      `%%Title: (${String(titulo || "Folha").replace(/[^\x20-\x7e]/g, "_").replace(/[()\\]/g, " ")})\n` +
      "%%Creator: Interclasse - folha de producao\n" +
      "%%LanguageLevel: 3\n" +
      "%%DocumentProcessColors: Cyan Magenta Yellow Black\n" +
      "%%EndComments\n" +
      PROLOGO + "\n" +
      "%%BeginSetup\nIcDict begin\n"
    );

    // Cada imagem entra UMA vez no arquivo (fluxo reutilizável) e é
    // desenhada quantas vezes aparecer na folha — senão a mesma arte em 30
    // camisetas deixaria o arquivo 30 vezes maior.
    const chavesImg = [];
    folha.blocos.forEach(({ bloco }) => bloco.ops.forEach((op) => {
      if (op.tipo === "imagem" && rec.imagens[op.chave] && !chavesImg.includes(op.chave)) chavesImg.push(op.chave);
    }));
    const nomeImg = {};
    const a85 = {}, recortes = {};
    if (corel) chavesImg.length = 0; // nada no setup: tudo vai junto de cada imagem
    chavesImg.forEach((chave, i) => {
      const img = rec.imagens[chave];
      const nome = "Img" + i;
      nomeImg[chave] = nome;
      escrever(`/${nome}D currentfile /ASCII85Decode filter /ReusableStreamDecode filter\n`);
      ascii85(img.cmykZ).forEach((p) => pedacos.push(p));
      escrever("def\n");
      if (img.mascaraZ) {
        escrever(`/${nome}M currentfile /ASCII85Decode filter /ReusableStreamDecode filter\n`);
        ascii85(img.mascaraZ).forEach((p) => pedacos.push(p));
        escrever("def\n");
      }
    });
    escrever("%%EndSetup\n");

    folha.blocos.forEach((pos) => {
      const b = pos.bloco;
      const hb = b.h;
      // Origem local = canto de baixo à esquerda do bloco (sem rotação).
      let transf;
      if (pos.rot === 90) {
        transf = `${num((pos.x + pos.w) * k)} ${num(HS - (pos.y + pos.h) * k)} translate 90 rotate`;
      } else if (pos.rot === 180) {
        transf = `${num((pos.x + pos.w) * k)} ${num(HS - pos.y * k)} translate 180 rotate`;
      } else {
        transf = `${num(pos.x * k)} ${num(HS - (pos.y + pos.h) * k)} translate`;
      }
      escrever(`gsave ${transf}\n`);
      const X = (v) => num(v * k);
      const Y = (v) => num((hb - v) * k);
      const caminho = (comandos) => {
        let s = "";
        let cx = 0, cy = 0;
        comandos.forEach((c) => {
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
        return s;
      };

      // Giro/espelho de imagem e EPS em volta do centro da caixa. No
      // PostScript o y sobe, então o giro horário da tela é negativo.
      const giro = (op) => {
        if (!op.rot && !op.flipH && !op.flipV) return ["", ""];
        const cx = (op.x + op.w / 2) * k, cy = (hb - (op.y + op.h / 2)) * k;
        return [`gsave ${num(cx)} ${num(cy)} translate ${num(-(op.rot || 0))} rotate ` +
          `${op.flipH ? -1 : 1} ${op.flipV ? -1 : 1} scale ${num(-cx)} ${num(-cy)} translate\n`, "grestore\n"];
      };

      // Recorte no formato do molde: as ops marcadas `recortar` (arte,
      // brasão, logo, textos) ficam dentro de um clip com o contorno.
      let recortando = false;
      b.ops.forEach((op) => {
        const querRecorte = !!(op.recortar && b.contorno && b.contorno.length);
        if (querRecorte && !recortando) {
          escrever(`gsave newpath\n${caminho(b.contorno)}clip newpath\n`);
          recortando = true;
        } else if (!querRecorte && recortando) {
          escrever("grestore\n");
          recortando = false;
        }
        if (op.tipo === "linha" && op.fora) {
          // Faca só por fora: recorta o lado de fora do contorno (retângulo
          // grande + contorno, eoclip) e traça com o dobro da espessura.
          const m = op.mm + 1;
          const fora = `${X(-m)} ${Y(-m)} m ${X(b.w + m)} ${Y(-m)} l ${X(b.w + m)} ${Y(hb + m)} l ${X(-m)} ${Y(hb + m)} l h\n`;
          escrever(`gsave newpath\n${fora}${caminho(op.comandos)}eoclip newpath\n${caminho(op.comandos)}` +
            `${cmykPs(op.cmyk)} setcmykcolor ${num(op.mm * 2 * k)} setlinewidth 1 setlinejoin stroke grestore\n`);
        } else if (op.tipo === "linha") {
          escrever(`gsave newpath\n${caminho(op.comandos)}${cmykPs(op.cmyk)} setcmykcolor ` +
            `${num(op.mm * k)} setlinewidth 1 setlinejoin stroke grestore\n`);
        } else if (op.tipo === "caminho") {
          const s = caminho(op.comandos);
          if (op.contorno2) {
            // Segundo contorno: por fora do primeiro (mm já é o total).
            escrever(`gsave newpath\n${s}${cmykPs(op.contorno2.cmyk)} setcmykcolor ` +
              `${num(op.contorno2.mm * 2 * k)} setlinewidth 1 setlinejoin 1 setlinecap stroke grestore\n`);
          }
          if (op.contorno) {
            // Contorno por fora: traço com o dobro da espessura por baixo do
            // preenchimento — só a metade de fora fica visível.
            escrever(`gsave newpath\n${s}${cmykPs(op.contorno.cmyk)} setcmykcolor ` +
              `${num(op.contorno.mm * 2 * k)} setlinewidth 1 setlinejoin 1 setlinecap stroke grestore\n`);
          }
          escrever(`gsave newpath\n${s}${cmykPs(op.cmyk)} setcmykcolor fill grestore\n`);
        } else if (op.tipo === "imagem") {
          const img = rec.imagens[op.chave];
          if (!img) return;
          const [giraIni, giraFim] = giro(op);
          escrever(giraIni);
          const nome = nomeImg[op.chave];
          const w = img.largura, h = img.altura;
          const mat = `[${w} 0 0 ${-h} 0 ${h}]`;
          if (corel) {
            let s = `gsave ${X(op.x)} ${Y(op.y + op.h)} translate ` +
              `${num(op.w * k)} ${num(op.h * k)} scale /DeviceCMYK setcolorspace\n`;
            // A arte da peça já é recortada no molde: a máscara dela não faz
            // falta. No detalhe/imagem própria, a transparência vira recorte.
            if (img.mascaraZ && !op.arteDaPeca && rec.inflar) {
              if (!recortes[op.chave]) recortes[op.chave] = recorteDaMascara(img, rec.inflar);
              s += `newpath\n${recortes[op.chave]}clip newpath\n`;
            }
            s += `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1 0 1] ` +
              `/ImageMatrix ${mat} /DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image\n`;
            escrever(s);
            if (!a85[op.chave]) a85[op.chave] = ascii85(img.cmykZ);
            a85[op.chave].forEach((p) => pedacos.push(p));
            escrever("grestore\n" + giraFim);
            return;
          }
          let s = `gsave ${X(op.x)} ${Y(op.y + op.h)} translate ` +
            `${num(op.w * k)} ${num(op.h * k)} scale /DeviceCMYK setcolorspace\n` +
            `${nome}D resetfile\n`;
          const dados = `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 ` +
            `/Decode [0 1 0 1 0 1 0 1] /ImageMatrix ${mat} /DataSource ${nome}D /FlateDecode filter >>`;
          if (img.mascaraZ) {
            s += `${nome}M resetfile\n<< /ImageType 3 /InterleaveType 3\n/DataDict ${dados}\n` +
              `/MaskDict << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 1 /Decode [0 1] ` +
              `/ImageMatrix ${mat} /DataSource ${nome}M /FlateDecode filter >>\n>> image\n`;
          } else {
            s += `${dados} image\n`;
          }
          escrever(s + "grestore\n" + giraFim);
        } else if (op.tipo === "eps") {
          const e = rec.eps[op.chave];
          if (!e) return;
          const [giraIni, giraFim] = giro(op);
          escrever(giraIni);
          const bw = e.bbox.x2 - e.bbox.x1, bh = e.bbox.y2 - e.bbox.y1;
          escrever(
            `BeginEPSF\n${X(op.x)} ${Y(op.y + op.h)} translate ` +
            `${num((op.w * k) / bw)} ${num((op.h * k) / bh)} scale ` +
            `${num(-e.bbox.x1)} ${num(-e.bbox.y1)} translate\n` +
            `${num(e.bbox.x1)} ${num(e.bbox.y1)} ${num(bw)} ${num(bh)} rectclip\n` +
            `%%BeginDocument: ${String(op.chave).replace(/[^\w:.-]/g, "_")}.eps\n`
          );
          pedacos.push(e.bytes);
          escrever("\n%%EndDocument\nEndEPSF\n" + giraFim);
        }
      });
      if (recortando) escrever("grestore\n");
      escrever("grestore\n");
    });

    escrever("end\nshowpage\n%%Trailer\n%%EOF\n");
    return pedacos;
  }

  // ---------------- Folha em PDF ----------------
  // O Corel abre PDF muito melhor que EPS (e de lá se salva em CDR). Mesmos
  // blocos e a mesma ordem de desenho do escreverEps, em operadores de PDF.
  // Cada imagem entra UMA vez (XObject) e é usada quantas vezes aparecer; os
  // dados CMYK já comprimidos (zlib) vão direto para o arquivo. Os EPS
  // (brasão, logo, molde) entram como forma vetorial: o site os converte para
  // PDF (Ghostscript, rec.pdfs[chave]) e a página vira um Form XObject.

  // Página de PDF: no máximo 200 polegadas (limite do formato, ~5,08 m).
  const PDF_ALTURA_MAX_MM = 5000;
  // EPS: o CorelDRAW não abre página maior que ~45 m (1800 polegadas).
  const ALTURA_MAX_COREL_MM = 45000;

  const latin1 = (u8, a, b) => {
    let s = "";
    for (let i = a; i < b; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 8192)));
    return s;
  };

  // Lê o PDF (simples, de uma página, como o que o Ghostscript gera): os
  // objetos pela tabela xref. Devolve { obj(n) → { dict, stream } , pagina }.
  function lerPdfSimples(bytes) {
    const fim = latin1(bytes, Math.max(0, bytes.length - 2048), bytes.length);
    const sx = fim.lastIndexOf("startxref");
    if (sx < 0) throw new Error("PDF sem startxref.");
    const xrefPos = parseInt(fim.slice(sx + 9).trim(), 10);
    const cab = latin1(bytes, xrefPos, Math.min(bytes.length, xrefPos + 64));
    if (!/^xref/.test(cab)) throw new Error("PDF com xref compactada (não suportado).");
    const offs = {};
    let p = xrefPos + 4;
    const linha = () => {
      while (p < bytes.length && (bytes[p] === 10 || bytes[p] === 13 || bytes[p] === 32)) p++;
      let q = p;
      while (q < bytes.length && bytes[q] !== 10 && bytes[q] !== 13) q++;
      const t = latin1(bytes, p, q);
      p = q;
      return t.trim();
    };
    let t;
    while ((t = linha()) && !/^trailer/.test(t)) {
      const [ini, n] = t.split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const e = linha().split(/\s+/);
        if (e[2] === "n") offs[ini + i] = Number(e[0]);
      }
    }
    const trailer = latin1(bytes, p, Math.min(bytes.length, p + 2048));
    const cache = {};
    // Fim de um dicionário << … >> a partir de i (aninhado).
    const fimDict = (s, i) => {
      let nivel = 0;
      for (let j = i; j < s.length - 1; j++) {
        if (s[j] === "<" && s[j + 1] === "<") { nivel++; j++; }
        else if (s[j] === ">" && s[j + 1] === ">") { nivel--; j++; if (nivel === 0) return j + 1; }
        else if (s[j] === "(") { // string literal: pula
          let d = 1; j++;
          for (; j < s.length && d > 0; j++) { if (s[j] === "\\") j++; else if (s[j] === "(") d++; else if (s[j] === ")") d--; }
          j--;
        }
      }
      return -1;
    };
    const obj = (n) => {
      if (cache[n]) return cache[n];
      const o = offs[n];
      if (o == null) throw new Error("PDF: objeto " + n + " não encontrado.");
      const cabeca = latin1(bytes, o, Math.min(bytes.length, o + 65536));
      const m = /^\s*\d+\s+\d+\s+obj\s*/.exec(cabeca);
      let corpo = cabeca.slice(m[0].length);
      let r;
      if (corpo.startsWith("<<")) {
        const f = fimDict(corpo, 0);
        const dict = corpo.slice(0, f);
        const resto = corpo.slice(f);
        const ms = /^\s*stream\r?\n/.exec(resto);
        if (ms) {
          let len = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
          len = len ? Number(obj(Number(len[1])).valor) : Number(/\/Length\s+(\d+)/.exec(dict)[1]);
          const ini = o + m[0].length + f + ms[0].length;
          r = { dict, stream: bytes.subarray(ini, ini + len) };
        } else r = { dict };
      } else {
        r = { valor: corpo.slice(0, corpo.indexOf("endobj")).trim() };
      }
      cache[n] = r;
      return r;
    };
    const raiz = Number(/\/Root\s+(\d+)\s+\d+\s+R/.exec(trailer)[1]);
    const pags = Number(/\/Pages\s+(\d+)\s+\d+\s+R/.exec(obj(raiz).dict)[1]);
    let pagina = obj(pags).dict;
    // Desce na árvore de páginas até a primeira página.
    for (let i = 0; i < 10 && /\/Kids/.test(pagina); i++) {
      pagina = obj(Number(/\/Kids\s*\[\s*(\d+)\s+\d+\s+R/.exec(pagina)[1])).dict;
    }
    return { obj, pagina, fimDict };
  }

  // Valor de uma chave num dicionário (texto): número, nome, array, dict ou ref.
  function valorDaChave(dict, chave, fimDict) {
    const m = new RegExp("/" + chave + "(?=[\\s/<\\[(])\\s*").exec(dict);
    if (!m) return null;
    const i = m.index + m[0].length;
    const s = dict.slice(i);
    if (s.startsWith("<<")) return s.slice(0, fimDict(s, 0));
    if (s.startsWith("[")) return s.slice(0, s.indexOf("]") + 1);
    const ref = /^(\d+)\s+(\d+)\s+R/.exec(s);
    if (ref) return ref[0];
    return /^[^\s/<>\[\]]+|^\/[^\s/<>\[\]()]+/.exec(s)[0];
  }

  // A primeira página do PDF como Form XObject. `novoNum()` dá os números
  // dos objetos no arquivo final. Devolve { num, objetos: [{ num, partes }],
  // largura, altura } (pt).
  function pdfComoForm(bytes, novoNum, inflar, deflar) {
    const { obj, pagina, fimDict } = lerPdfSimples(bytes);
    const mb = valorDaChave(pagina, "MediaBox", fimDict);
    const [x1, y1, x2, y2] = mb.replace(/[\[\]]/g, " ").trim().split(/\s+/).map(Number);
    let recursos = valorDaChave(pagina, "Resources", fimDict) || "<<>>";
    const mapa = {};
    const fila = [];
    const renum = (texto) => texto.replace(/(\d+)\s+(\d+)\s+R\b/g, (_, n) => {
      if (!mapa[n]) { mapa[n] = novoNum(); fila.push(Number(n)); }
      return mapa[n] + " 0 R";
    });
    // Conteúdo da página: um stream ou uma lista deles.
    const cont = valorDaChave(pagina, "Contents", fimDict);
    const refs = [...cont.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
    let dados, filtro = "";
    if (refs.length === 1) {
      const c = obj(refs[0]);
      dados = c.stream;
      const f = valorDaChave(c.dict, "Filter", fimDict);
      if (f && f !== "/FlateDecode") throw new Error("Conteúdo do PDF com filtro não suportado: " + f);
      filtro = f ? "/Filter /FlateDecode " : "";
    } else {
      const partes = refs.map((n) => {
        const c = obj(n);
        return /FlateDecode/.test(c.dict) ? inflar(c.stream) : c.stream;
      });
      const tot = partes.reduce((s, x) => s + x.length + 1, 0);
      dados = new Uint8Array(tot);
      let o = 0;
      partes.forEach((x) => { dados.set(x, o); o += x.length; dados[o++] = 10; });
      if (deflar) { dados = deflar(dados); filtro = "/Filter /FlateDecode "; }
    }
    const num = novoNum();
    recursos = renum(recursos);
    const objetos = [{
      num,
      partes: [`${num} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [${x1} ${y1} ${x2} ${y2}] /Resources ${recursos} ${filtro}/Length ${dados.length} >>\nstream\n`,
        dados, "\nendstream\nendobj\n"]
    }];
    // Copia os objetos referenciados (fontes, imagens, gráficos…).
    while (fila.length) {
      const n = fila.shift();
      const o = obj(n);
      const novo = mapa[n];
      if (o.stream) {
        const dict = renum(o.dict.replace(/\/Length\s+\d+\s+\d+\s+R/, "/Length " + o.stream.length));
        objetos.push({ num: novo, partes: [`${novo} 0 obj\n${dict}\nstream\n`, o.stream, "\nendstream\nendobj\n"] });
      } else {
        objetos.push({ num: novo, partes: [`${novo} 0 obj\n${renum(o.dict || o.valor)}\nendobj\n`] });
      }
    }
    return { num, objetos, x1, y1, largura: x2 - x1, altura: y2 - y1 };
  }

  // Escreve a folha como PDF. Mesmo contrato do escreverEps (lista de
  // pedaços). rec.pdfs[chave]: o PDF de cada EPS (brasão, logo, molde);
  // rec.inflar/rec.deflar: pako (opcionais).
  // `folhas`: uma folha ou uma lista — cada folha vira uma PÁGINA do mesmo
  // arquivo (o PDF limita a página a 200 pol ≈ 5,08 m; folhas mais altas que
  // isso o Corel acusa como arquivo corrompido — ver PDF_ALTURA_MAX_MM).
  function escreverPdf(folhas, rec, titulo) {
    const lista = Array.isArray(folhas) ? folhas : [folhas];
    const k = PT_POR_MM;
    let ultimo = 3; // 1 catálogo, 2 páginas, 3 info
    const novoNum = () => ++ultimo;
    const paginas = lista.map(() => ({ num: novoNum(), conteudo: novoNum() }));

    // Imagens e formas usadas nas folhas (cada uma entra uma vez no arquivo).
    const imgs = {}, forms = {};
    lista.forEach((folha) => folha.blocos.forEach(({ bloco }) => bloco.ops.forEach((op) => {
      if (op.tipo === "imagem" && rec.imagens[op.chave] && !imgs[op.chave]) {
        const img = rec.imagens[op.chave];
        imgs[op.chave] = { nome: "Im" + Object.keys(imgs).length, num: novoNum(), mascara: img.mascaraZ ? novoNum() : 0 };
      }
      if (op.tipo === "eps" && rec.pdfs && rec.pdfs[op.chave] && !forms[op.chave]) {
        const f = pdfComoForm(rec.pdfs[op.chave], novoNum, rec.inflar, rec.deflar);
        forms[op.chave] = { nome: "Fm" + Object.keys(forms).length, ...f };
      }
    })));

    const conteudoDaFolha = (folha) => {
    const HS = folha.alturaMm * PT_POR_MM;
    const c = []; // conteúdo da página (texto)
    const w = (s) => c.push(s);
    const cmykPdf = (v) => cmykPs(v);
    const mat = (a, b, cc, d, e, f) => `${num(a)} ${num(b)} ${num(cc)} ${num(d)} ${num(e)} ${num(f)} cm\n`;

    folha.blocos.forEach((pos) => {
      const b = pos.bloco;
      const hb = b.h;
      if (pos.rot === 90) w("q " + mat(0, 1, -1, 0, (pos.x + pos.w) * k, HS - (pos.y + pos.h) * k));
      else if (pos.rot === 180) w("q " + mat(-1, 0, 0, -1, (pos.x + pos.w) * k, HS - pos.y * k));
      else w("q " + mat(1, 0, 0, 1, pos.x * k, HS - (pos.y + pos.h) * k));
      const X = (v) => num(v * k);
      const Y = (v) => num((hb - v) * k);
      const caminho = (comandos) => {
        let s = "";
        let cx = 0, cy = 0;
        comandos.forEach((cm) => {
          if (cm.type === "M") { s += `${X(cm.x)} ${Y(cm.y)} m\n`; cx = cm.x; cy = cm.y; }
          else if (cm.type === "L") { s += `${X(cm.x)} ${Y(cm.y)} l\n`; cx = cm.x; cy = cm.y; }
          else if (cm.type === "C") {
            s += `${X(cm.x1)} ${Y(cm.y1)} ${X(cm.x2)} ${Y(cm.y2)} ${X(cm.x)} ${Y(cm.y)} c\n`;
            cx = cm.x; cy = cm.y;
          } else if (cm.type === "Q") {
            const c1x = cx + (2 / 3) * (cm.x1 - cx), c1y = cy + (2 / 3) * (cm.y1 - cy);
            const c2x = cm.x + (2 / 3) * (cm.x1 - cm.x), c2y = cm.y + (2 / 3) * (cm.y1 - cm.y);
            s += `${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(cm.x)} ${Y(cm.y)} c\n`;
            cx = cm.x; cy = cm.y;
          } else if (cm.type === "Z") s += "h\n";
        });
        return s;
      };
      // Giro/espelho em volta do centro da caixa (y para cima: giro negativo).
      const giro = (op) => {
        if (!op.rot && !op.flipH && !op.flipV) return ["", ""];
        const cx = (op.x + op.w / 2) * k, cy = (hb - (op.y + op.h / 2)) * k;
        const a = (-(op.rot || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
        const sx = op.flipH ? -1 : 1, sy = op.flipV ? -1 : 1;
        return ["q " + mat(1, 0, 0, 1, cx, cy) + mat(co, si, -si, co, 0, 0) + mat(sx, 0, 0, sy, 0, 0) + mat(1, 0, 0, 1, -cx, -cy), "Q\n"];
      };
      let recortando = false;
      b.ops.forEach((op) => {
        const querRecorte = !!(op.recortar && b.contorno && b.contorno.length);
        if (querRecorte && !recortando) { w(`q\n${caminho(b.contorno)}W n\n`); recortando = true; }
        else if (!querRecorte && recortando) { w("Q\n"); recortando = false; }
        if (op.tipo === "linha" && op.fora) {
          const m = op.mm + 1;
          const fora = `${X(-m)} ${Y(-m)} m ${X(b.w + m)} ${Y(-m)} l ${X(b.w + m)} ${Y(hb + m)} l ${X(-m)} ${Y(hb + m)} l h\n`;
          w(`q\n${fora}${caminho(op.comandos)}W* n\n${caminho(op.comandos)}${cmykPdf(op.cmyk)} K ${num(op.mm * 2 * k)} w 1 j S Q\n`);
        } else if (op.tipo === "linha") {
          w(`q\n${caminho(op.comandos)}${cmykPdf(op.cmyk)} K ${num(op.mm * k)} w 1 j S Q\n`);
        } else if (op.tipo === "caminho") {
          const s = caminho(op.comandos);
          if (op.contorno2) w(`q\n${s}${cmykPdf(op.contorno2.cmyk)} K ${num(op.contorno2.mm * 2 * k)} w 1 j 1 J S Q\n`);
          if (op.contorno) w(`q\n${s}${cmykPdf(op.contorno.cmyk)} K ${num(op.contorno.mm * 2 * k)} w 1 j 1 J S Q\n`);
          w(`q\n${s}${cmykPdf(op.cmyk)} k f Q\n`);
        } else if (op.tipo === "imagem") {
          const im = imgs[op.chave];
          if (!im) return;
          const [gi, gf] = giro(op);
          w(gi + "q " + mat(op.w * k, 0, 0, op.h * k, op.x * k, (hb - op.y - op.h) * k) + `/${im.nome} Do Q\n` + gf);
        } else if (op.tipo === "eps") {
          const f = forms[op.chave];
          if (!f) return;
          const [gi, gf] = giro(op);
          const sx = (op.w * k) / f.largura, sy = (op.h * k) / f.altura;
          w(gi + "q " + mat(sx, 0, 0, sy, op.x * k - f.x1 * sx, (hb - op.y - op.h) * k - f.y1 * sy) + `/${f.nome} Do Q\n` + gf);
        }
      });
      if (recortando) w("Q\n");
      w("Q\n");
    });
    return c.join("");
    };

    // Monta o arquivo, contando os bytes de cada objeto para a xref.
    const pedacos = [];
    const offsets = {};
    let pos = 0;
    // Texto do PDF = bytes latin-1 (1 caractere = 1 byte; os objetos copiados
    // do Ghostscript podem ter bytes acima de 127).
    const L1 = (t) => { const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i) & 255; return u; };
    const tam = (p) => p.length;
    const por = (p) => { pedacos.push(typeof p === "string" ? L1(p) : p); pos += tam(p); };
    por("%PDF-1.4\n");
    por(new Uint8Array([37, 226, 227, 207, 211, 10])); // %âãÏÓ (arquivo binário)
    const objeto = (n, partes) => { offsets[n] = pos; partes.forEach(por); };

    const recursosXo = Object.values(imgs).map((im) => `/${im.nome} ${im.num} 0 R`)
      .concat(Object.values(forms).map((f) => `/${f.nome} ${f.num} 0 R`)).join(" ");
    const tituloPdf = String(titulo || "Folha").replace(/[^\x20-\x7e]/g, "_").replace(/[()\\]/g, " ");
    objeto(1, ["1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"]);
    objeto(2, [`2 0 obj\n<< /Type /Pages /Kids [${paginas.map((p) => p.num + " 0 R").join(" ")}] /Count ${paginas.length} >>\nendobj\n`]);
    objeto(3, [`3 0 obj\n<< /Title (${tituloPdf}) /Producer (Interclasse) /Creator (Interclasse - folha de producao) >>\nendobj\n`]);
    lista.forEach((folha, i) => {
      const pg = paginas[i];
      objeto(pg.num, [`${pg.num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(folha.larguraMm * k)} ${num(folha.alturaMm * k)}] ` +
        `/Resources << /XObject << ${recursosXo} >> >> /Contents ${pg.conteudo} 0 R >>\nendobj\n`]);
      let dadosC = L1(conteudoDaFolha(folha));
      let filtroC = "";
      if (rec.deflar) { dadosC = rec.deflar(dadosC); filtroC = "/Filter /FlateDecode "; }
      objeto(pg.conteudo, [`${pg.conteudo} 0 obj\n<< ${filtroC}/Length ${tam(dadosC)} >>\nstream\n`, dadosC, "\nendstream\nendobj\n"]);
    });

    const somaZ = (l) => (l || []).reduce((s, x) => s + x.length, 0);
    Object.keys(imgs).forEach((chave) => {
      const im = imgs[chave], img = rec.imagens[chave];
      objeto(im.num, [`${im.num} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ` +
        `/ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length ${somaZ(img.cmykZ)}` +
        (im.mascara ? ` /Mask ${im.mascara} 0 R` : "") + " >>\nstream\n", ...img.cmykZ, "\nendstream\nendobj\n"]);
      if (im.mascara) {
        // Máscara de 1 bit: 1 = transparente (como no EPS).
        objeto(im.mascara, [`${im.mascara} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ` +
          `/ImageMask true /BitsPerComponent 1 /Filter /FlateDecode /Length ${somaZ(img.mascaraZ)} >>\nstream\n`,
          ...img.mascaraZ, "\nendstream\nendobj\n"]);
      }
    });
    Object.values(forms).forEach((f) => f.objetos.forEach((o) => objeto(o.num, o.partes)));

    const xref = pos;
    let x = `xref\n0 ${ultimo + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= ultimo; n++) {
      x += offsets[n] != null ? String(offsets[n]).padStart(10, "0") + " 00000 n \n" : "0000000000 65535 f \n";
    }
    por(x + `trailer\n<< /Size ${ultimo + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return pedacos;
  }

  return {
    PT_POR_MM,
    extrairPostScript,
    lerBoundingBox,
    tamanhoMmDoBbox,
    layoutTexto,
    elementosDaPecaNoTime,
    textoDoElemento,
    caixaPorDigitos,
    digitosDoNumero,
    ehElementoNumero,
    transformarComandos,
    transformacaoDoElemento,
    sombraDoElemento,
    textoDoCampo,
    caixaEfetiva,
    caixaArte,
    encaixarProporcional,
    empacotar,
    elementoDoTime,
    chaveDoElemento,
    imagemLivre,
    montarBlocos,
    moldeVirtual,
    medidasEtiqueta,
    PECAS_VIRTUAIS,
    REFORCO_LARGURA_MM,
    arteDaPeca,
    detalheDaPeca,
    textoDoMarcador,
    marcadorDaPeca,
    contornoDePdf,
    comandosDoContorno,
    poligonosDoContorno,
    contornoComSangria,
    estimarTamanho,
    ascii85,
    escreverEps,
    escreverPdf,
    pdfComoForm,
    deslocarContorno,
    comprimentoReforco,
    bordaDeOmbroAOmbro,
    REFORCO_FOLGA_MM,
    PDF_ALTURA_MAX_MM,
    ALTURA_MAX_COREL_MM
  };
})();

if (typeof module !== "undefined") module.exports = EPS;
