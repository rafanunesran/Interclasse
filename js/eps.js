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

  // ---------------- Layout: onde cada coisa fica em cada tamanho ----------------

  // Valor de texto de um elemento para uma camiseta.
  function textoDoCampo(el, camiseta) {
    if (el.tipo === "numero" || el.campo === "numero") return String(camiseta.numero == null ? "" : camiseta.numero);
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

  // Encaixa o conteúdo inteiro (w × h) dentro da caixa, sem distorcer.
  function encaixarProporcional(caixa, w, h) {
    const e = Math.min(caixa.w / w, caixa.h / h);
    const W = w * e, H = h * e;
    return { x: caixa.x + (caixa.w - W) / 2, y: caixa.y + (caixa.h - H) / 2, w: W, h: H };
  }

  // Onde a ARTE (PNG) da peça fica no molde de um tamanho. A arte é feita
  // para o molde BASE, no tamanho real (pixels ÷ dpi) e centralizada nele.
  // Nos outros tamanhos ela cresce/diminui na proporção do molde (a maior
  // das duas, para continuar cobrindo a peça inteira), também centralizada.
  function caixaArte(arte, moldeBase, moldeTam) {
    const dpi = arte.dpi > 0 ? arte.dpi : 600;
    let w = (arte.larguraPx / dpi) * MM_POR_POL;
    let h = (arte.alturaPx / dpi) * MM_POR_POL;
    const base = moldeBase || moldeTam;
    const esc = Math.max(moldeTam.w / base.w, moldeTam.h / base.h);
    w *= esc;
    h *= esc;
    return { x: (moldeTam.w - w) / 2, y: (moldeTam.h - h) / 2, w, h };
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
      if (b.w + 2 * espaco > larguraMm && (!gira90 || b.h + 2 * espaco > larguraMm)) {
        avisos.push(`Uma peça (${b.rotulo || ""}, ${b.w.toFixed(0)} mm) é mais larga que a folha (${larguraMm} mm).`);
      }
      const opcoesRot = [{ rot: 0, w: b.w, h: b.h }];
      if (gira90) opcoesRot.push({ rot: 90, w: b.h, h: b.w });
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
          escolha = { m: { x: espaco, y: espaco, W: b.w + espaco, H: b.h + espaco }, o: opcoesRot[0] };
        }
        if (escolha) {
          const { m, o } = escolha;
          ocupar(f, m.x, m.y, m.W, m.H);
          f.blocos.push({ bloco: b, x: m.x, y: m.y, w: o.w, h: o.h, rot: o.rot });
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
  // 1 mm da base da peça, centralizado. Na gola, que é uma faixa, vai na
  // lateral esquerda, na vertical (lendo de baixo para cima), também a 1 mm
  // da borda e com 4 mm.
  const MARCADOR_ALTURA_MM = 4;
  // Espessura da linha de corte desenhada por cima (a partir do contorno).
  const LINHA_CORTE_MM = 0.3;
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

  // Comandos (mm, relativos ao canto de cima da peça) do marcador.
  function marcadorDaPeca(fonte, texto, pecaW, pecaH, vertical) {
    const A = MARCADOR_ALTURA_MM, M = MARCADOR_MARGEM_MM;
    const comprimento = (vertical ? pecaH : pecaW) - 2 * M;
    if (!texto || comprimento <= 0) return [];
    const l = layoutTexto(fonte, texto, { w: comprimento, h: A }, { maiusculas: false, alinhamento: "centro" });
    if (!l.comandos.length) return [];
    // A tinta (incluindo as pernas do g, p, q...) fica a exatamente 1 mm da borda.
    const cx = caixaDosComandos(l.comandos);
    if (!vertical) return deslocarComandos(l.comandos, M, pecaH - M - cx.y2);
    // Gira 90° (de baixo para cima): o "chão" das letras vira o lado direito.
    const gira = (x, y) => [y, pecaH - M - x];
    const deslocX = M - cx.y1; // a parte de cima das letras encosta a 1 mm da esquerda
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
  function montarBlocos(moldes, layout, time, camisetas, rec, opcoes) {
    const op = opcoes || {};
    const posMolde = op.molde || "frente";
    const avisos = [];
    const avisar = (t) => { if (!avisos.includes(t)) avisos.push(t); };
    const prod = (time && time.producao) || {};
    const ajustes = prod.layoutAjustes || {};
    const pecasIds = op.pecas || Object.keys((layout && layout.pecas) || {});

    const blocos = [];
    camisetas.forEach((cam) => {
      pecasIds.forEach((pecaId) => {
        const moldesPeca = (moldes.pecas || {})[pecaId] || {};
        const molde = moldesPeca[cam.tamanho];
        const ad = arteDaPeca(prod, pecaId);
        const arte = ad && ad.arte;
        const lay = ((layout && layout.pecas) || {})[pecaId] || {};
        if (!arte && !(lay.elementos || []).length) return; // peça sem nada deste time
        if (!molde || !molde.bbox) {
          avisar(`Sem molde de corte de "${op.nomePeca ? op.nomePeca(pecaId) : pecaId}" no tamanho ${cam.tamanho || "(vazio)"} — essa peça ficou de fora.`);
          return;
        }
        const tam = tamanhoMmDoBbox(molde.bbox);
        const mb = moldesPeca[moldes.tamanhoBase];
        const tamBase = mb && mb.bbox ? tamanhoMmDoBbox(mb.bbox) : tam;

        const ops = [];
        const opMolde = { tipo: "eps", chave: "molde:" + pecaId + ":" + cam.tamanho, x: 0, y: 0, w: tam.w, h: tam.h };
        if (posMolde === "fundo") ops.push(opMolde);

        // Tudo o que é arte (imagem, brasão, logo, textos) é recortado no
        // formato do molde, quando o contorno dele é conhecido.
        const recortar = !!molde.contorno;
        if (!recortar) {
          avisar(`O molde de "${op.nomePeca ? op.nomePeca(pecaId) : pecaId}" ${cam.tamanho} está sem contorno — a arte dessa peça saiu retangular (aba Tamanhos → Ler contornos).`);
        }
        if (arte && arte.larguraPx) {
          ops.push({ tipo: "imagem", chave: ad.chave, recortar, ...caixaArte(arte, tamBase, tam) });
        }

        (lay.elementos || []).forEach((el) => {
          const caixa = caixaEfetiva(el, cam.tamanho, tamBase, tam, (ajustes[pecaId] || {})[el.id]);
          if (el.tipo === "detalhe") {
            const d = detalheDaPeca(prod, pecaId);
            const img = d && rec.imagens && rec.imagens[d.chave];
            if (!img) { avisar("O time não tem o detalhe da manga (PNG) — a caixa do detalhe ficou vazia."); return; }
            ops.push({ tipo: "imagem", chave: d.chave, recortar, ...encaixarProporcional(caixa, img.largura, img.altura) });
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
            ops.push({ tipo: "eps", chave: el.tipo, recortar, ...encaixarProporcional(caixa, t.w, t.h) });
            return;
          }
          if (!rec.fonte) { avisar("O time não tem fonte — nome e número ficaram de fora."); return; }
          const valor = textoDoCampo(el, cam);
          if (!String(valor).trim()) return;
          const l = layoutTexto(rec.fonte, valor, caixa, el);
          if (!l.comandos.length) return;
          ops.push({
            tipo: "caminho",
            recortar,
            comandos: deslocarComandos(l.comandos, caixa.x, caixa.y),
            cmyk: el.corCmyk || [0, 0, 0, 100],
            contorno: el.contornoMm > 0 ? { cmyk: el.contornoCmyk || [0, 0, 0, 0], mm: Number(el.contornoMm) } : null
          });
        });

        // Marcador para a costureira, DENTRO da área de impressão:
        // "Time-Tamanho-Peça" (ex.: 7B-P-Frente), ver marcadorDaPeca().
        if (op.etiqueta !== false && rec.fonteEtiqueta) {
          const texto = textoDoMarcador(op.nomeTime, cam.tamanho, op.nomePeca ? op.nomePeca(pecaId) : pecaId);
          const cmds = marcadorDaPeca(rec.fonteEtiqueta, texto, tam.w, tam.h, pecaId === "gola");
          if (cmds.length) {
            ops.push({ tipo: "caminho", recortar, comandos: cmds, cmyk: [0, 0, 0, 100], contorno: { cmyk: [0, 0, 0, 0], mm: 0.25 } });
          }
        }

        // Linha de corte por cima: com o contorno conhecido, ela é desenhada a
        // partir dele (linha fina preta) — o EPS do molde costuma trazer um
        // fundo branco preenchido (Corel) que taparia a arte inteira.
        if (posMolde === "frente") {
          if (molde.contorno) {
            ops.push({ tipo: "linha", comandos: comandosDoContorno(molde.contorno), cmyk: [0, 0, 0, 100], mm: LINHA_CORTE_MM });
          } else {
            ops.push(opMolde);
          }
        }
        const h = tam.h;
        const contorno = recortar
          ? contornoComSangria(comandosDoContorno(molde.contorno), tam.w, tam.h, op.sangriaMm == null ? 2 : Number(op.sangriaMm))
          : null;
        blocos.push({ w: tam.w, h, ops, contorno, rotulo: `${op.nomePeca ? op.nomePeca(pecaId) : pecaId} ${cam.tamanho}` });
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
  function estimarTamanho(folha, rec) {
    let t = 4096;
    const imgs = new Set();
    folha.blocos.forEach(({ bloco }) => bloco.ops.forEach((op) => {
      if (op.tipo === "imagem") imgs.add(op.chave);
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
  function escreverEps(folha, rec, titulo) {
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
        if (op.tipo === "linha") {
          escrever(`gsave newpath\n${caminho(op.comandos)}${cmykPs(op.cmyk)} setcmykcolor ` +
            `${num(op.mm * k)} setlinewidth 1 setlinejoin stroke grestore\n`);
        } else if (op.tipo === "caminho") {
          const s = caminho(op.comandos);
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
          const nome = nomeImg[op.chave];
          const w = img.largura, h = img.altura;
          const mat = `[${w} 0 0 ${-h} 0 ${h}]`;
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
          escrever(s + "grestore\n");
        } else if (op.tipo === "eps") {
          const e = rec.eps[op.chave];
          if (!e) return;
          const bw = e.bbox.x2 - e.bbox.x1, bh = e.bbox.y2 - e.bbox.y1;
          escrever(
            `BeginEPSF\n${X(op.x)} ${Y(op.y + op.h)} translate ` +
            `${num((op.w * k) / bw)} ${num((op.h * k) / bh)} scale ` +
            `${num(-e.bbox.x1)} ${num(-e.bbox.y1)} translate\n` +
            `${num(e.bbox.x1)} ${num(e.bbox.y1)} ${num(bw)} ${num(bh)} rectclip\n` +
            `%%BeginDocument: ${String(op.chave).replace(/[^\w:.-]/g, "_")}.eps\n`
          );
          pedacos.push(e.bytes);
          escrever("\n%%EndDocument\nEndEPSF\n");
        }
      });
      if (recortando) escrever("grestore\n");
      escrever("grestore\n");
    });

    escrever("end\nshowpage\n%%Trailer\n%%EOF\n");
    return pedacos;
  }

  return {
    PT_POR_MM,
    extrairPostScript,
    lerBoundingBox,
    tamanhoMmDoBbox,
    layoutTexto,
    textoDoCampo,
    caixaEfetiva,
    caixaArte,
    encaixarProporcional,
    empacotar,
    montarBlocos,
    arteDaPeca,
    detalheDaPeca,
    textoDoMarcador,
    marcadorDaPeca,
    contornoDePdf,
    comandosDoContorno,
    contornoComSangria,
    estimarTamanho,
    ascii85,
    escreverEps
  };
})();

if (typeof module !== "undefined") module.exports = EPS;
