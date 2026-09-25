// ============================================================
// PRODUÇÃO EM EPS — arquivos do time, layout (aba Artes) e geração
// ============================================================
// A folha de impressão de um pedido junta três coisas:
//   1. os MOLDES de corte (aba Tamanhos — js/moldes.js): um EPS por peça em
//      cada tamanho;
//   2. os ARQUIVOS DO TIME (time aberto → Arquivos de produção): a arte de cada peça em
//      PNG 600 dpi, o brasão em EPS e a fonte do nome/número;
//   3. o LAYOUT (aba Artes, este arquivo): onde ficam o brasão e as caixas-
//      limite do nome e do número em cada peça. Há um layout GERAL, e cada
//      time pode ter um ajuste próprio.
// Na aba Produção, "Folhas EPS" pergunta a largura da folha, o espaço entre
// as peças e se o fornecedor deixa girar, e monta um EPS CMYK por time
// (js/eps.js), com as peças encaixadas para aproveitar a folha.
//
// No Firestore: config/layout (layout geral) e o campo `producao` de cada
// time (arquivos + ajustes). Os arquivos em si ficam no Drive.
//
// Carregado depois de js/admin.js, js/producao.js, js/eps.js,
// js/png-stream.js, js/previa-eps.js e js/moldes.js.

// ---------------- Bibliotecas (carregadas só quando precisar) ----------------

const LIBS_PRODUCAO = {
  opentype: "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js",
  pako: "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js",
  JSZip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
};
const libsProducao = {};

function carregarLib(nome) {
  if (window[nome]) return Promise.resolve(window[nome]);
  if (!libsProducao[nome]) {
    libsProducao[nome] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIBS_PRODUCAO[nome];
      s.onload = () => (window[nome] ? resolve(window[nome]) : reject(new Error("Biblioteca " + nome + " não carregou.")));
      s.onerror = () => {
        delete libsProducao[nome];
        reject(new Error("Não foi possível carregar a biblioteca " + nome + " (sem internet?)."));
      };
      document.head.appendChild(s);
    });
  }
  return libsProducao[nome];
}

const esperarTela = () => new Promise((r) => setTimeout(r, 0));

function novoIdLayout(prefixo) {
  return prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// O Firestore não aceita `undefined`: a ida e volta pelo JSON limpa tudo.
function limparParaFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const arred1 = (v) => Math.round(v * 10) / 10;

// Fontes (opentype) já lidas, por arquivo.
const fontesLidas = {};
function obterFonte(ref) {
  const chave = chaveArquivoDrive(ref);
  if (!fontesLidas[chave]) {
    fontesLidas[chave] = Promise.all([carregarLib("opentype"), baixarArquivoDrive(driveScriptUrl, ref)])
      .then(([opentype, bytes]) => opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      .catch((e) => {
        delete fontesLidas[chave];
        throw e;
      });
  }
  return fontesLidas[chave];
}
// Versão síncrona para a prévia: devolve a fonte se já carregou; senão pede
// e redesenha o editor quando chegar.
const fontesProntas = {};
function fonteProntaDoTime(time) {
  const f = time && time.producao && time.producao.fonte;
  if (!f || !f.partes) return null;
  const chave = chaveArquivoDrive(f.partes);
  if (fontesProntas[chave]) return fontesProntas[chave];
  obterFonte(f.partes).then((fonte) => {
    fontesProntas[chave] = fonte;
    renderizarPalcoLayout();
    // A prévia da arte do time aberto também usa a fonte.
    if (typeof timeAbertoAdmin !== "undefined" && timeAbertoAdmin) renderizarTimesAdmin();
  }).catch((e) => console.warn("Fonte do time não carregou:", e));
  return null;
}

// ============================================================
// LAYOUT GERAL (config/layout)
// ============================================================

let layoutConfig = { pecas: {}, folha: {} };
let layoutIniciado = false;
let salvarLayoutTimer = null;

function escutarLayout() {
  if (layoutIniciado) return;
  layoutIniciado = true;
  db.collection("config").doc("layout").onSnapshot(
    (doc) => {
      // Enquanto há uma gravação pendente, a cópia local é a mais nova.
      if (salvarLayoutTimer) return;
      const d = doc.exists ? doc.data() : {};
      layoutConfig = { pecas: d.pecas || {}, folha: d.folha || {} };
      renderizarEditorLayout();
    },
    (erro) => console.error("Erro ao carregar o layout:", erro)
  );
}

function elementosDaPeca(pecaId) {
  const p = layoutConfig.pecas[pecaId] || (layoutConfig.pecas[pecaId] = { elementos: [] });
  p.elementos = p.elementos || [];
  return p.elementos;
}

function salvarLayout(imediato) {
  estadoSalvarLayout("Salvando…");
  clearTimeout(salvarLayoutTimer);
  const gravar = async () => {
    salvarLayoutTimer = null;
    try {
      await db.collection("config").doc("layout").set(limparParaFirestore(layoutConfig));
      estadoSalvarLayout("✓ Salvo");
    } catch (e) {
      console.error(e);
      estadoSalvarLayout("⚠️ Erro ao salvar");
    }
  };
  if (imediato) gravar();
  else salvarLayoutTimer = setTimeout(gravar, 700);
}

function estadoSalvarLayout(texto) {
  const el = document.getElementById("layoutEstadoSalvar");
  if (el) el.textContent = texto;
}

// ============================================================
// ARQUIVOS DE PRODUÇÃO DO TIME (time aberto → aba Arquivos de produção)
// ============================================================

const blocoProducaoAberto = {}; // timeId -> true quando o bloco está aberto
const enviandoProducao = {};    // "timeId|slot" -> texto de andamento

function producaoDoTime(time) {
  return (time && time.producao) || {};
}

// O que falta para o time poder gerar a folha.
function pendenciasProducao(time) {
  const p = producaoDoTime(time);
  const falta = [];
  const temArte = PECAS_PRODUCAO.some((x) => p.pecas && p.pecas[x.id]);
  if (!temArte) falta.push("arte das peças");
  const usaTexto = Object.values(layoutConfig.pecas || {}).some((l) =>
    (l.elementos || []).some((e) => e.tipo !== "brasao"));
  const usaBrasao = Object.values(layoutConfig.pecas || {}).some((l) =>
    (l.elementos || []).some((e) => e.tipo === "brasao"));
  if (usaTexto && !p.fonte) falta.push("fonte");
  if (usaBrasao && !p.brasao) falta.push("brasão");
  return falta;
}

async function gravarProducaoTime(timeId, producao) {
  const limpo = limparParaFirestore(producao);
  if (estadoTimes[timeId]) estadoTimes[timeId].time.producao = limpo;
  await db.collection(COL_TIMES).doc(timeId).update({ producao: limpo });
}

function criarBlocoProducaoTime(timeId, time) {
  const prod = producaoDoTime(time);
  const bloco = document.createElement("details");
  bloco.className = "producao-time";
  bloco.open = !!blocoProducaoAberto[timeId];
  bloco.addEventListener("toggle", () => (blocoProducaoAberto[timeId] = bloco.open));

  const nArtes = PECAS_PRODUCAO.filter((x) => prod.pecas && prod.pecas[x.id]).length;
  const falta = pendenciasProducao(time);
  bloco.innerHTML = `<summary>🎨 Arquivos de produção <span class="badge ${falta.length ? "pendente" : "pago"}">` +
    `${falta.length ? "falta " + escapeHtmlAdmin(falta.join(", ")) : "pronto ✓"}</span>` +
    ` <span class="pix-ajuda">${nArtes}/${PECAS_PRODUCAO.length} artes${prod.brasao ? " · brasão" : ""}${prod.fonte ? " · fonte" : ""}</span></summary>`;

  const grade = document.createElement("div");
  grade.className = "producao-grade";

  PECAS_PRODUCAO.forEach((peca) => {
    const a = prod.pecas && prod.pecas[peca.id];
    grade.appendChild(criarSlotProducao(timeId, `arte:${peca.id}`, peca.nome, a
      ? {
        previa: a.previaUrl,
        info: `${a.larguraPx} × ${a.alturaPx} px · ${a.dpi || "?"} dpi · ` +
          `${Math.round((a.larguraPx / (a.dpi || 600)) * 25.4)} × ${Math.round((a.alturaPx / (a.dpi || 600)) * 25.4)} mm`
      }
      : null, "PNG 600 dpi"));
  });
  grade.appendChild(criarSlotProducao(timeId, "brasao", "Brasão", prod.brasao
    ? { previa: prod.brasao.previaUrl, info: prod.brasao.nomeArquivo || "EPS" } : null, "EPS"));
  grade.appendChild(criarSlotProducao(timeId, "fonte", "Fonte", prod.fonte
    ? { info: prod.fonte.nome } : null, ".ttf / .otf"));
  bloco.appendChild(grade);

  const rodape = document.createElement("div");
  rodape.className = "producao-rodape";
  const btnLayout = document.createElement("button");
  btnLayout.type = "button";
  btnLayout.className = "secundario";
  btnLayout.textContent = "Ajustar layout deste time";
  btnLayout.onclick = () => abrirLayoutDoTime(timeId);
  rodape.appendChild(btnLayout);
  const nAjustes = Object.values(prod.layoutAjustes || {}).reduce((s, p) => s + Object.keys(p || {}).length, 0);
  if (nAjustes) rodape.insertAdjacentHTML("beforeend", `<span class="pix-ajuda">${nAjustes} ajuste(s) próprio(s) de posição</span>`);
  bloco.appendChild(rodape);
  return bloco;
}

function criarSlotProducao(timeId, slot, titulo, atual, formato) {
  const div = document.createElement("div");
  div.className = "producao-slot" + (atual ? " ok" : "");
  const andamento = enviandoProducao[`${timeId}|${slot}`];
  div.innerHTML = `
    <div class="producao-slot-titulo">${escapeHtmlAdmin(titulo)}</div>
    <div class="producao-slot-previa">${atual && atual.previa
      ? `<img src="${escAttr(atual.previa)}" alt="" loading="lazy" />`
      : `<span>${atual ? "✓" : escapeHtmlAdmin(formato)}</span>`}</div>
    <div class="producao-slot-info">${andamento ? escapeHtmlAdmin(andamento) : atual ? escapeHtmlAdmin(atual.info || "") : "—"}</div>`;
  const acoes = document.createElement("div");
  acoes.className = "producao-slot-acoes";
  const env = document.createElement("button");
  env.type = "button";
  env.className = "secundario";
  env.textContent = atual ? "Trocar" : "Enviar";
  env.disabled = !!andamento;
  env.onclick = () => enviarArquivoProducao(timeId, slot);
  acoes.appendChild(env);
  if (atual) {
    const rem = document.createElement("button");
    rem.type = "button";
    rem.className = "perigo";
    rem.textContent = "×";
    rem.title = "Remover";
    rem.onclick = async () => {
      if (!confirm(`Remover ${titulo.toLowerCase()} deste time?`)) return;
      const prod = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
      if (slot === "brasao") delete prod.brasao;
      else if (slot === "fonte") delete prod.fonte;
      else if (prod.pecas) delete prod.pecas[slot.slice(5)];
      await gravarProducaoTime(timeId, prod);
    };
    acoes.appendChild(rem);
  }
  div.appendChild(acoes);
  return div;
}

function marcarEnvio(timeId, slot, texto) {
  const k = `${timeId}|${slot}`;
  if (texto) enviandoProducao[k] = texto; else delete enviandoProducao[k];
  if (typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
}

// Miniatura (PNG pequeno) de uma arte enorme, sem abrir no <canvas>: lê o
// PNG em fluxo pulando pixels e desfaz a conversão CMYK para mostrar na tela.
async function miniaturaDaArte(bytes, info) {
  const pako = await carregarLib("pako");
  const passo = Math.max(1, Math.ceil(Math.max(info.largura, info.altura) / 700));
  const r = await PngStream.converterParaCmyk(bytes, { pako, passo, nivel: 1, pausa: esperarTela });
  const juntar = (lista) => {
    const tot = lista.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(tot);
    let o = 0;
    lista.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  };
  const cmyk = pako.inflate(juntar(r.cmykZ));
  const masc = r.mascaraZ ? pako.inflate(juntar(r.mascaraZ)) : null;
  const canvas = document.createElement("canvas");
  canvas.width = r.largura;
  canvas.height = r.altura;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(r.largura, r.altura);
  const bl = Math.ceil(r.largura / 8);
  for (let y = 0; y < r.altura; y++) {
    for (let x = 0; x < r.largura; x++) {
      const i = y * r.largura + x;
      const max = 255 - cmyk[i * 4 + 3];
      img.data[i * 4] = max - (cmyk[i * 4] * max) / 255;
      img.data[i * 4 + 1] = max - (cmyk[i * 4 + 1] * max) / 255;
      img.data[i * 4 + 2] = max - (cmyk[i * 4 + 2] * max) / 255;
      img.data[i * 4 + 3] = masc && (masc[y * bl + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function enviarArquivoProducao(timeId, slot) {
  if (!exigirDriveProducao()) return;
  const accept = slot === "brasao" ? ".eps,.ps,application/postscript"
    : slot === "fonte" ? ".ttf,.otf,font/ttf,font/otf" : "image/png";
  const file = await escolherArquivos(accept);
  if (!file) return;
  const pref = `${slugify(estadoTimes[timeId].time.nome) || timeId}-${slot.replace(":", "-")}`;
  try {
    let dados;
    if (slot === "brasao") {
      marcarEnvio(timeId, slot, "enviando…");
      dados = await enviarEpsComPrevia(file, pref, 600);
      if (dados.semPrevia) alert("O brasão foi enviado, mas a prévia não pôde ser desenhada. Ele aparece como uma caixa no editor.");
    } else if (slot === "fonte") {
      marcarEnvio(timeId, slot, "enviando…");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opentype = await carregarLib("opentype");
      opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); // valida
      const env = await enviarArquivoDrive(driveScriptUrl, file, pref);
      guardarArquivoDriveNoCache(env.partes, bytes);
      dados = { partes: env.partes, nome: file.name.replace(/\.(ttf|otf)$/i, "") };
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = PngStream.lerCabecalho(bytes); // valida (8 bits, sem entrelaçamento)
      if (info.dpi && info.dpi !== 600 &&
          !confirm(`Este PNG está em ${info.dpi} dpi (o esperado é 600). O tamanho real na peça é calculado pelo dpi do arquivo. Enviar mesmo assim?`)) return;
      marcarEnvio(timeId, slot, "enviando 0%…");
      const env = await enviarArquivoDrive(driveScriptUrl, file, pref,
        (f) => marcarEnvio(timeId, slot, `enviando ${Math.round(f * 100)}%…`));
      marcarEnvio(timeId, slot, "gerando miniatura…");
      let previaUrl = "";
      try {
        const mini = await miniaturaDaArte(bytes, info);
        previaUrl = (await enviarArquivoDrive(driveScriptUrl,
          new File([mini], file.name.replace(/\.png$/i, "") + "-mini.png", { type: "image/png" }), pref + "-mini")).url;
      } catch (e) {
        console.warn("Miniatura não gerada:", e);
      }
      dados = {
        partes: env.partes, nomeArquivo: file.name,
        larguraPx: info.largura, alturaPx: info.altura, dpi: info.dpi || 600, previaUrl
      };
    }
    const prod = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
    if (slot === "brasao") prod.brasao = dados;
    else if (slot === "fonte") prod.fonte = dados;
    else {
      prod.pecas = prod.pecas || {};
      prod.pecas[slot.slice(5)] = dados;
    }
    await gravarProducaoTime(timeId, prod);
  } catch (e) {
    console.error(e);
    alert(e.message || "Não foi possível enviar o arquivo.");
  } finally {
    avisoProducao("");
    marcarEnvio(timeId, slot, "");
  }
}

// ============================================================
// PRÉVIA DA ARTE DO TIME (time aberto → Arquivos de produção)
// ============================================================
// Monta, com os arquivos enviados e o layout (aba Artes), como a camiseta
// está ficando — sem gerar EPS nenhum:
//   • Arte (sem simulação): cada peça plana, no molde de corte do tamanho
//     escolhido, com o brasão e o nome/número de teste;
//   • Mockup: as peças vestidas numa camiseta (frente e costas).
// É só desenho na tela (SVG com as miniaturas do Drive); a folha de verdade
// continua saindo na aba Produção.

const previaTime = { modo: "arte", tam: "", cor: "#ffffff" };
const amostraPrevia = { nomeCamiseta: "JOÃO PEDRO", nome: "João Pedro Silva", numero: "10" };

// Tamanhos com molde em alguma peça, na ordem da tabela de tamanhos.
function tamanhosDaPrevia() {
  return TODOS_TAMANHOS.filter((t) =>
    PECAS_PRODUCAO.some((p) => moldesConfig.pecas[p.id] && moldesConfig.pecas[p.id][t]));
}

function tamanhoDaPrevia() {
  const tams = tamanhosDaPrevia();
  if (previaTime.tam && tams.includes(previaTime.tam)) return previaTime.tam;
  if (tams.includes(moldesConfig.tamanhoBase)) return moldesConfig.tamanhoBase;
  return tams[0] || "";
}

// Uma peça como SVG, em milímetros: { w, h, svg, temArte }. null quando a
// peça não tem nem molde nem arte (não há o que mostrar).
function pecaEmSvg(time, timeId, pecaId, tam, amostra, comMolde) {
  const prod = producaoDoTime(time);
  const arte = prod.pecas && prod.pecas[pecaId];
  const moldes = moldesConfig.pecas[pecaId] || {};
  const molde = tam ? moldes[tam] : null;
  const mb = moldes[moldesConfig.tamanhoBase];

  let dim;
  let base;
  if (molde && molde.bbox) {
    dim = EPS.tamanhoMmDoBbox(molde.bbox);
    base = mb && mb.bbox ? EPS.tamanhoMmDoBbox(mb.bbox) : dim;
  } else if (arte && arte.larguraPx) {
    const dpi = arte.dpi > 0 ? arte.dpi : 600;
    dim = { w: (arte.larguraPx / dpi) * 25.4, h: (arte.alturaPx / dpi) * 25.4 };
    base = dim;
  } else {
    return null;
  }

  const n = (v) => Number(v).toFixed(2);
  const partes = [];
  if (arte && arte.previaUrl) {
    const c = EPS.caixaArte(arte, base, dim);
    partes.push(`<image href="${escAttr(urlPreviaGrande(arte.previaUrl))}" x="${n(c.x)}" y="${n(c.y)}" ` +
      `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="none" />`);
  }

  const fonte = fonteProntaDoTime(time);
  const elementos = (layoutConfig.pecas[pecaId] && layoutConfig.pecas[pecaId].elementos) || [];
  elementos.forEach((el) => {
    const c = EPS.caixaEfetiva(el, tam, base, dim, ajusteDoTime(timeId, pecaId, el.id));
    if (el.tipo === "brasao") {
      if (prod.brasao && prod.brasao.previaUrl) {
        partes.push(`<image href="${escAttr(urlPreviaGrande(prod.brasao.previaUrl))}" x="${n(c.x)}" y="${n(c.y)}" ` +
          `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="xMidYMid meet" />`);
      } else if (comMolde) {
        partes.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" class="previa-caixa" />`);
      }
      return;
    }
    if (fonte) {
      const l = EPS.layoutTexto(fonte, EPS.textoDoCampo(el, amostra), { w: c.w, h: c.h }, el);
      if (!l.comandos.length) return;
      const contorno = el.contornoMm > 0
        ? ` stroke="${cmykParaCss(el.contornoCmyk)}" stroke-width="${n(el.contornoMm * 2)}" stroke-linejoin="round" paint-order="stroke"`
        : "";
      partes.push(`<path transform="translate(${n(c.x)} ${n(c.y)})" d="${caminhoSvg(l.comandos, 1)}" ` +
        `fill="${cmykParaCss(el.corCmyk)}"${contorno} />`);
    } else if (comMolde) {
      // Sem a fonte (ainda carregando ou não enviada): a caixa-limite tracejada.
      partes.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" class="previa-caixa" />`);
    }
  });

  if (comMolde && molde && molde.previaUrl) {
    partes.push(`<image href="${escAttr(urlPreviaGrande(molde.previaUrl))}" x="0" y="0" ` +
      `width="${n(dim.w)}" height="${n(dim.h)}" preserveAspectRatio="none" />`);
  }
  return { w: dim.w, h: dim.h, svg: partes.join(""), temArte: !!arte };
}

// Camiseta vetorial (frente e costas lado a lado) com as peças "vestidas":
// cada peça é escalada para a área do corpo/manga e recortada no formato.
const MOCKUP_FORMAS = {
  corpoFrente: "M190,18 Q250,82 310,18 L398,44 L398,450 Q250,458 102,450 L102,44 Z",
  corpoCostas: "M190,18 Q250,38 310,18 L398,44 L398,450 Q250,458 102,450 L102,44 Z",
  mangaEsq: "M102,44 L18,160 L76,198 L102,164 Z",
  mangaDir: "M398,44 L482,160 L424,198 L398,164 Z",
  golaFrente: "M186,15 Q250,90 314,15",
  golaCostas: "M186,15 Q250,44 314,15"
};

function mockupSvg(time, timeId, tam, amostra, cor) {
  const peca = (id) => pecaEmSvg(time, timeId, id, tam, amostra, false);
  const uid = "mk" + Math.random().toString(36).slice(2, 8);
  const n = (v) => Number(v).toFixed(2);

  // Corpo: a largura do molde ocupa a largura da camiseta, a partir do ombro.
  const vestirCorpo = (p) => {
    if (!p) return "";
    const s = 296 / p.w;
    return `<g transform="translate(102 16) scale(${n(s)})">${p.svg}</g>`;
  };
  // Manga: cobre a área da manga (a sobra é recortada pelo formato).
  const vestirManga = (p, x, y, w, h) => {
    if (!p) return "";
    const s = Math.max(w / p.w, h / p.h);
    return `<g transform="translate(${n(x + (w - p.w * s) / 2)} ${n(y + (h - p.h * s) / 2)}) scale(${n(s)})">${p.svg}</g>`;
  };

  const vista = (dx, lado) => {
    const frente = lado === "frente";
    const corpo = frente ? MOCKUP_FORMAS.corpoFrente : MOCKUP_FORMAS.corpoCostas;
    // De frente, a manga à esquerda de quem olha é a direita de quem veste.
    const mEsqTela = frente ? peca("mangaDir") : peca("mangaEsq");
    const mDirTela = frente ? peca("mangaEsq") : peca("mangaDir");
    const id = `${uid}-${lado}`;
    return `
      <g transform="translate(${dx} 0)">
        <defs>
          <clipPath id="${id}-c"><path d="${corpo}" /></clipPath>
          <clipPath id="${id}-e"><path d="${MOCKUP_FORMAS.mangaEsq}" /></clipPath>
          <clipPath id="${id}-d"><path d="${MOCKUP_FORMAS.mangaDir}" /></clipPath>
        </defs>
        <path d="${MOCKUP_FORMAS.mangaEsq}" fill="${cor}" />
        <g clip-path="url(#${id}-e)">${vestirManga(mEsqTela, 18, 44, 84, 154)}</g>
        <path d="${MOCKUP_FORMAS.mangaDir}" fill="${cor}" />
        <g clip-path="url(#${id}-d)">${vestirManga(mDirTela, 398, 44, 84, 154)}</g>
        <path d="${corpo}" fill="${cor}" />
        <g clip-path="url(#${id}-c)">${vestirCorpo(peca(frente ? "frente" : "costas"))}</g>
        <path d="${corpo}" fill="url(#${uid}-sombra)" />
        <path d="${MOCKUP_FORMAS.mangaEsq}" fill="url(#${uid}-sombra-m)" />
        <path d="${MOCKUP_FORMAS.mangaDir}" fill="url(#${uid}-sombra-m)" />
        <path d="${frente ? MOCKUP_FORMAS.golaFrente : MOCKUP_FORMAS.golaCostas}" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" />
        <path d="${frente ? MOCKUP_FORMAS.golaFrente : MOCKUP_FORMAS.golaCostas}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.2" />
        <g fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.4" stroke-linejoin="round">
          <path d="${corpo}" /><path d="${MOCKUP_FORMAS.mangaEsq}" /><path d="${MOCKUP_FORMAS.mangaDir}" />
        </g>
        <text x="250" y="486" text-anchor="middle" class="mockup-rotulo">${frente ? "Frente" : "Costas"}</text>
      </g>`;
  };

  return `<svg class="mockup-svg" viewBox="0 0 1020 500" role="img" aria-label="Mockup da camiseta de ${escAttr(time.nome)}">
    <defs>
      <linearGradient id="${uid}-sombra" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".14" />
        <stop offset=".18" stop-color="#000" stop-opacity="0" />
        <stop offset=".5" stop-color="#fff" stop-opacity=".08" />
        <stop offset=".82" stop-color="#000" stop-opacity="0" />
        <stop offset="1" stop-color="#000" stop-opacity=".14" />
      </linearGradient>
      <linearGradient id="${uid}-sombra-m" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0" />
        <stop offset="1" stop-color="#000" stop-opacity=".12" />
      </linearGradient>
    </defs>
    ${vista(0, "frente")}
    ${vista(520, "costas")}
  </svg>`;
}

// Bloco completo da prévia: controles + desenho.
function criarPreviaArteTime(timeId, time) {
  const wrap = document.createElement("div");
  wrap.className = "previa-arte";
  const tams = tamanhosDaPrevia();
  const tam = tamanhoDaPrevia();

  wrap.innerHTML = `
    <div class="previa-controles">
      <div class="segmentado" role="tablist" aria-label="Tipo de prévia">
        <button type="button" data-modo="arte" class="${previaTime.modo === "arte" ? "ativo" : ""}">Arte (sem simulação)</button>
        <button type="button" data-modo="mockup" class="${previaTime.modo === "mockup" ? "ativo" : ""}">Mockup na camiseta</button>
      </div>
      ${tams.length ? `<label>Tamanho <select data-previa="tam">${tams.map((t) =>
        `<option value="${escAttr(t)}"${t === tam ? " selected" : ""}>${escapeHtmlAdmin(t)}${t === moldesConfig.tamanhoBase ? " (base)" : ""}</option>`).join("")}</select></label>` : ""}
      <label>Apelido <input type="text" data-amostra="nomeCamiseta" value="${escAttr(amostraPrevia.nomeCamiseta)}" /></label>
      <label>Número <input type="text" data-amostra="numero" value="${escAttr(amostraPrevia.numero)}" class="input-curto" /></label>
      <label class="${previaTime.modo === "mockup" ? "" : "oculto"}" data-so-mockup>Cor da camiseta <input type="color" data-previa="cor" value="${escAttr(previaTime.cor)}" /></label>
    </div>
    <div class="previa-area"></div>
    <p class="pix-ajuda previa-nota"></p>`;

  const area = wrap.querySelector(".previa-area");
  const nota = wrap.querySelector(".previa-nota");

  const desenhar = () => {
    const tamAtual = tamanhoDaPrevia();
    const prod = producaoDoTime(time);
    const temArquivos = PECAS_PRODUCAO.some((p) => prod.pecas && prod.pecas[p.id]);
    const semFonte = prod.fonte ? "" : " Sem a fonte do time, o nome e o número aparecem só como caixas tracejadas.";

    if (previaTime.modo === "mockup") {
      if (!temArquivos && time.imagemUrl) {
        area.innerHTML = `<figure class="previa-imagem"><img src="${escAttr(time.imagemUrl)}" alt="Simulação enviada" /><figcaption>Simulação enviada (imagem da página do pedido)</figcaption></figure>`;
        nota.textContent = "Envie as artes das peças acima para ver o mockup montado com os arquivos de produção.";
        return;
      }
      area.innerHTML = mockupSvg(time, timeId, tamAtual, amostraPrevia, previaTime.cor || "#ffffff");
      nota.textContent = temArquivos
        ? `Simulação aproximada, montada com as artes${tamAtual ? " do tamanho " + tamAtual : ""}. Os detalhes da manga não entram no mockup.`
        : "Ainda sem as artes das peças: o mockup mostra só a camiseta com o nome e o número de teste.";
      return;
    }

    const pecas = PECAS_PRODUCAO
      .map((p) => ({ p, s: pecaEmSvg(time, timeId, p.id, tamAtual, amostraPrevia, true) }))
      .filter((x) => x.s);
    if (pecas.length === 0) {
      area.innerHTML = time.arteUrl
        ? `<figure class="previa-imagem"><img src="${escAttr(time.arteUrl)}" alt="Arte enviada" /><figcaption>Arte enviada (imagem da página do pedido)</figcaption></figure>`
        : '<div class="vazio-lista"><p>Nada para mostrar ainda.</p><p class="pix-ajuda">Envie as artes das peças acima (e os moldes na aba Tamanhos) para ver a prévia.</p></div>';
      nota.textContent = "";
      return;
    }
    // Mesma escala para todas as peças: a manga fica do tamanho certo perto do corpo.
    const alturaMax = Math.max(...pecas.map(({ s }) => s.h));
    const larguraTela = Math.max(280, area.clientWidth || 800);
    const k = Math.min(280 / alturaMax, (larguraTela - 40) / pecas.reduce((t, { s }) => t + s.w, 0) * 1.6);
    area.innerHTML = `<div class="previa-pecas">${pecas.map(({ p, s }) => `
      <figure class="previa-peca">
        <svg viewBox="0 0 ${s.w.toFixed(2)} ${s.h.toFixed(2)}" style="width:${(s.w * k).toFixed(0)}px;height:${(s.h * k).toFixed(0)}px" role="img" aria-label="${escAttr(p.nome)}">${s.svg}</svg>
        <figcaption>${escapeHtmlAdmin(p.nome)}${s.temArte ? "" : ' <span class="badge pendente">sem arte</span>'}</figcaption>
      </figure>`).join("")}</div>`;
    nota.textContent = (tamAtual
      ? `Peças no molde do tamanho ${tamAtual}, com o layout da aba Artes.`
      : "Sem moldes de corte: as artes aparecem no tamanho do arquivo.") + semFonte;
  };

  wrap.querySelectorAll("[data-modo]").forEach((b) => {
    b.onclick = () => {
      previaTime.modo = b.dataset.modo;
      wrap.querySelectorAll("[data-modo]").forEach((x) => x.classList.toggle("ativo", x === b));
      wrap.querySelector("[data-so-mockup]").classList.toggle("oculto", previaTime.modo !== "mockup");
      desenhar();
    };
  });
  const selTam = wrap.querySelector('[data-previa="tam"]');
  if (selTam) selTam.onchange = () => { previaTime.tam = selTam.value; desenhar(); };
  wrap.querySelector('[data-previa="cor"]').oninput = (ev) => { previaTime.cor = ev.target.value; desenhar(); };
  wrap.querySelectorAll("[data-amostra]").forEach((inp) => {
    inp.oninput = () => { amostraPrevia[inp.dataset.amostra] = inp.value; desenhar(); };
  });

  desenhar();
  return wrap;
}

// ============================================================
// EDITOR DE LAYOUT (aba Artes)
// ============================================================

const elEditorLayout = document.getElementById("editorLayout");
let layoutModo = "";        // "" = layout geral; timeId = ajuste daquele time
let layoutTimePrevia = "";  // time cuja arte/fonte aparece na prévia (modo geral)
let layoutPeca = "costas";
let layoutTam = "";
let layoutElSel = "";
let layoutArrastando = false;
const amostraLayout = { nomeCamiseta: "JOÃO PEDRO", nome: "João Pedro Silva", numero: "10" };

function abrirLayoutDoTime(timeId) {
  layoutModo = timeId;
  layoutTimePrevia = timeId;
  const aba = document.querySelector('.aba[data-aba="artes"]');
  if (aba) aba.click();
  renderizarEditorLayout();
  if (elEditorLayout) elEditorLayout.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Times que aparecem nos seletores (com o filtro de cliente do topo).
function timesParaLayout() {
  return Object.entries(estadoTimes)
    .filter(([, e]) => !clienteFiltro || timesFiltrados().some(([id]) => estadoTimes[id] === e))
    .sort((a, b) => a[1].time.nome.localeCompare(b[1].time.nome, "pt-BR"));
}

function timeDaPrevia() {
  const id = layoutModo || layoutTimePrevia;
  return id && estadoTimes[id] ? estadoTimes[id].time : null;
}

function tamanhosComMolde(pecaId) {
  const m = moldesConfig.pecas[pecaId] || {};
  return TODOS_TAMANHOS.filter((t) => m[t]);
}

function tamanhoDoEditor() {
  const tams = tamanhosComMolde(layoutPeca);
  if (layoutTam && tams.includes(layoutTam)) return layoutTam;
  if (tams.includes(moldesConfig.tamanhoBase)) return moldesConfig.tamanhoBase;
  return tams[0] || "";
}

function renderizarEditorLayout() {
  if (!elEditorLayout || layoutArrastando) return;
  const foco = document.activeElement && elEditorLayout.contains(document.activeElement) ? document.activeElement : null;
  // Não redesenha com o cursor num campo de texto (perderia o que se digita).
  if (foco && foco.tagName === "INPUT" && foco.type !== "checkbox") return;

  const times = timesParaLayout();
  if (layoutModo && !estadoTimes[layoutModo]) layoutModo = "";
  if (!layoutModo && (!layoutTimePrevia || !estadoTimes[layoutTimePrevia])) {
    const comArte = times.find(([, e]) => e.time.producao && e.time.producao.pecas);
    layoutTimePrevia = comArte ? comArte[0] : "";
  }
  const tam = tamanhoDoEditor();
  const opcTimes = (sel) => times.map(([id, e]) =>
    `<option value="${escAttr(id)}"${id === sel ? " selected" : ""}>${escapeHtmlAdmin(e.time.nome)}</option>`).join("");

  elEditorLayout.innerHTML = `
    <div class="layout-topo">
      <label>Editando
        <select data-l="modo"><option value="">Layout geral (todos os times)</option>${opcTimes(layoutModo)}</select></label>
      ${layoutModo ? "" : `<label>Prévia com a arte de
        <select data-l="previa"><option value="">(nenhum time)</option>${opcTimes(layoutTimePrevia)}</select></label>`}
      <span id="layoutEstadoSalvar" class="pix-ajuda"></span>
    </div>
    ${layoutModo ? `<p class="aviso">Ajuste próprio de <strong>${escapeHtmlAdmin(estadoTimes[layoutModo].time.nome)}</strong>: arrastar muda a posição só para este time. O estilo (cor, contorno, fonte) vem do layout geral.</p>` : ""}
    <nav class="fin-subabas layout-pecas">${PECAS_PRODUCAO.map((p) =>
      `<button type="button" class="fin-subaba${p.id === layoutPeca ? " ativa" : ""}" data-peca="${p.id}">${escapeHtmlAdmin(p.nome)}</button>`).join("")}</nav>
    <div class="arte-area">
      <div class="arte-palco-col">
        <div class="arte-barra-palco">
          <label>Tamanho <select data-l="tam">${tamanhosComMolde(layoutPeca).map((t) =>
            `<option value="${escAttr(t)}"${t === tam ? " selected" : ""}>${escapeHtmlAdmin(t)}${t === moldesConfig.tamanhoBase ? " (base)" : ""}</option>`).join("")}</select></label>
          <label>Apelido de teste <input type="text" data-amostra="nomeCamiseta" value="${escAttr(amostraLayout.nomeCamiseta)}" /></label>
          <label>Número <input type="text" data-amostra="numero" value="${escAttr(amostraLayout.numero)}" style="width:60px" /></label>
          <span class="arte-botoes-add">
            ${layoutModo ? "" : `<button type="button" class="secundario" data-add="brasao">+ Brasão</button>
            <button type="button" class="secundario" data-add="nome">+ Nome</button>
            <button type="button" class="secundario" data-add="numero">+ Número</button>`}
            <button type="button" class="secundario" data-l="teste">⬇ EPS de teste</button>
          </span>
        </div>
        <div class="arte-palco-wrap"><div id="layoutPalco" class="arte-palco"></div></div>
      </div>
      <div class="arte-painel" id="layoutPainel"></div>
    </div>`;

  const q = (s) => elEditorLayout.querySelector(s);
  q('[data-l="modo"]').onchange = (ev) => {
    layoutModo = ev.target.value;
    if (layoutModo) layoutTimePrevia = layoutModo;
    renderizarEditorLayout();
  };
  if (q('[data-l="previa"]')) q('[data-l="previa"]').onchange = (ev) => { layoutTimePrevia = ev.target.value; renderizarEditorLayout(); };
  elEditorLayout.querySelectorAll("[data-peca]").forEach((b) => {
    b.onclick = () => { layoutPeca = b.dataset.peca; layoutElSel = ""; renderizarEditorLayout(); };
  });
  const selTam = q('[data-l="tam"]');
  if (selTam) selTam.onchange = () => { layoutTam = selTam.value; renderizarPalcoLayout(); renderizarPainelLayout(); };
  elEditorLayout.querySelectorAll("[data-amostra]").forEach((inp) => {
    inp.oninput = () => { amostraLayout[inp.dataset.amostra] = inp.value; renderizarPalcoLayout(); };
  });
  elEditorLayout.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => adicionarElementoLayout(b.dataset.add)));
  q('[data-l="teste"]').onclick = baixarEpsDeTesteLayout;

  renderizarPalcoLayout();
  renderizarPainelLayout();
}

// Medidas do molde mostrado e do molde base (mm) e a escala do palco.
function medidasLayout() {
  const tam = tamanhoDoEditor();
  const moldes = moldesConfig.pecas[layoutPeca] || {};
  const molde = moldes[tam];
  if (!molde) return null;
  const dim = EPS.tamanhoMmDoBbox(molde.bbox);
  const mb = moldes[moldesConfig.tamanhoBase];
  const base = mb ? EPS.tamanhoMmDoBbox(mb.bbox) : dim;
  const palco = document.getElementById("layoutPalco");
  const larguraDisp = Math.min(620, (palco && palco.parentElement.clientWidth) || 620);
  const s = Math.min(larguraDisp / dim.w, 700 / dim.h);
  return { tam, molde, dim, base, s, ehBase: tam === moldesConfig.tamanhoBase || !mb };
}

function ajusteDoTime(timeId, pecaId, elId) {
  const t = timeId && estadoTimes[timeId] && estadoTimes[timeId].time;
  const aj = t && t.producao && t.producao.layoutAjustes;
  return aj && aj[pecaId] && aj[pecaId][elId];
}

function caixaNoEditor(el, m) {
  return EPS.caixaEfetiva(el, m.tam, m.base, m.dim, ajusteDoTime(layoutModo, layoutPeca, el.id));
}

function cmykParaCss(c) {
  const [C, M, Y, K] = (c || [0, 0, 0, 100]).map((v) => (Number(v) || 0) / 100);
  return `rgb(${Math.round(255 * (1 - C) * (1 - K))},${Math.round(255 * (1 - M) * (1 - K))},${Math.round(255 * (1 - Y) * (1 - K))})`;
}

function caminhoSvg(comandos, s) {
  const f = (v) => (v * s).toFixed(2);
  return comandos.map((c) => {
    if (c.type === "M" || c.type === "L") return `${c.type}${f(c.x)} ${f(c.y)}`;
    if (c.type === "Q") return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
    if (c.type === "C") return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
    return "Z";
  }).join("");
}

function rotuloElementoLayout(el) {
  if (el.tipo === "brasao") return "Brasão";
  if (el.tipo === "numero") return "Número";
  return el.campo === "nomeCompleto" ? "Nome completo" : "Nome na camiseta";
}

function renderizarPalcoLayout() {
  const palco = document.getElementById("layoutPalco");
  if (!palco || layoutArrastando) return;
  palco.innerHTML = "";
  const m = medidasLayout();
  if (!m) {
    palco.style.width = "";
    palco.style.height = "";
    palco.innerHTML = `<p class="arte-palco-vazio">Sem molde de corte de "${escapeHtmlAdmin(nomePecaProducao(layoutPeca))}". Envie os moldes na aba <strong>Tamanhos</strong>.</p>`;
    return;
  }
  const { dim, base, s } = m;
  palco.style.width = dim.w * s + "px";
  palco.style.height = dim.h * s + "px";
  const time = timeDaPrevia();
  const prod = producaoDoTime(time);

  // Arte do time (por baixo) e o molde por cima (a prévia do molde é
  // transparente, só as linhas).
  const arte = prod.pecas && prod.pecas[layoutPeca];
  if (arte && arte.previaUrl) {
    const c = EPS.caixaArte(arte, base, dim);
    palco.insertAdjacentHTML("beforeend",
      `<img class="layout-arte" src="${escAttr(urlPreviaGrande(arte.previaUrl))}" alt="" draggable="false"
        style="left:${c.x * s}px;top:${c.y * s}px;width:${c.w * s}px;height:${c.h * s}px" />`);
  }
  if (m.molde.previaUrl) {
    palco.insertAdjacentHTML("beforeend",
      `<img class="arte-palco-molde" src="${escAttr(urlPreviaGrande(m.molde.previaUrl))}" alt="" draggable="false" />`);
  }

  const fonte = fonteProntaDoTime(time);
  elementosDaPeca(layoutPeca).forEach((el) => {
    const c = caixaNoEditor(el, m);
    const div = document.createElement("div");
    const temAjusteTime = !!ajusteDoTime(layoutModo, layoutPeca, el.id);
    div.className = "arte-el arte-el-" + el.tipo + (el.id === layoutElSel ? " selecionado" : "") + (temAjusteTime ? " ajuste-time" : "");
    div.style.left = c.x * s + "px";
    div.style.top = c.y * s + "px";
    div.style.width = c.w * s + "px";
    div.style.height = c.h * s + "px";
    if (el.tipo === "brasao") {
      div.innerHTML = prod.brasao && prod.brasao.previaUrl
        ? `<img src="${escAttr(urlPreviaGrande(prod.brasao.previaUrl))}" alt="" draggable="false" style="object-fit:contain" />`
        : '<span class="arte-el-rotulo">Brasão</span>';
    } else if (fonte) {
      const l = EPS.layoutTexto(fonte, EPS.textoDoCampo(el, amostraLayout), { w: c.w, h: c.h }, el);
      const contorno = el.contornoMm > 0
        ? ` stroke="${cmykParaCss(el.contornoCmyk)}" stroke-width="${(el.contornoMm * 2 * s).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"`
        : "";
      div.innerHTML = `<svg class="arte-el-svg" width="${c.w * s}" height="${c.h * s}" overflow="visible">` +
        `<path d="${caminhoSvg(l.comandos, s)}" fill="${cmykParaCss(el.corCmyk)}"${contorno}/></svg>`;
    } else {
      div.innerHTML = `<span class="arte-el-rotulo">${escapeHtmlAdmin(rotuloElementoLayout(el))}${time ? "" : "<br>(escolha um time para ver a fonte)"}</span>`;
    }
    const alca = document.createElement("span");
    alca.className = "arte-el-alca";
    div.appendChild(alca);
    ligarArrasteLayout(div, alca, el);
    palco.appendChild(div);
  });
}

// Arrastar (mover) e a alça do canto (redimensionar). O brasão mantém a
// proporção; as caixas de texto são livres (são o limite do texto).
function ligarArrasteLayout(div, alca, el) {
  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const redimensionar = ev.target === alca;
    if (layoutElSel !== el.id) {
      layoutElSel = el.id;
      document.querySelectorAll("#layoutPalco .arte-el").forEach((d) => d.classList.toggle("selecionado", d === div));
      renderizarPainelLayout();
    }
    const m = medidasLayout();
    const ini = caixaNoEditor(el, m);
    const x0 = ev.clientX, y0 = ev.clientY;
    const prop = ini.w / ini.h;
    let atual = { ...ini };
    layoutArrastando = true;
    div.setPointerCapture(ev.pointerId);
    const mover = (e) => {
      const dx = (e.clientX - x0) / m.s, dy = (e.clientY - y0) / m.s;
      if (redimensionar) {
        const w = Math.max(2, ini.w + dx);
        atual = { x: ini.x, y: ini.y, w, h: el.tipo === "brasao" ? w / prop : Math.max(2, ini.h + dy) };
      } else {
        atual = { x: ini.x + dx, y: ini.y + dy, w: ini.w, h: ini.h };
      }
      div.style.left = atual.x * m.s + "px";
      div.style.top = atual.y * m.s + "px";
      div.style.width = atual.w * m.s + "px";
      div.style.height = atual.h * m.s + "px";
    };
    const soltar = () => {
      div.removeEventListener("pointermove", mover);
      div.removeEventListener("pointerup", soltar);
      div.removeEventListener("pointercancel", soltar);
      layoutArrastando = false;
      if (atual.x !== ini.x || atual.y !== ini.y || atual.w !== ini.w || atual.h !== ini.h) {
        gravarCaixaLayout(el, m, atual);
      }
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
    div.addEventListener("pointermove", mover);
    div.addEventListener("pointerup", soltar);
    div.addEventListener("pointercancel", soltar);
  });
}

// Grava a caixa onde ela deve ir: no layout geral (tamanho base = posição do
// elemento; outro tamanho = ajuste daquele tamanho) ou no ajuste do time.
function gravarCaixaLayout(el, m, caixa) {
  const c = { x: arred1(caixa.x), y: arred1(caixa.y), w: arred1(caixa.w), h: arred1(caixa.h) };
  if (layoutModo) {
    const time = estadoTimes[layoutModo].time;
    const prod = limparParaFirestore(producaoDoTime(time));
    prod.layoutAjustes = prod.layoutAjustes || {};
    const porPeca = prod.layoutAjustes[layoutPeca] = prod.layoutAjustes[layoutPeca] || {};
    const aj = porPeca[el.id] = porPeca[el.id] || {};
    if (m.ehBase) aj.base = c;
    else {
      aj.tamanhos = aj.tamanhos || {};
      aj.tamanhos[m.tam] = c;
    }
    gravarProducaoTime(layoutModo, prod).then(() => estadoSalvarLayout("✓ Salvo no time"))
      .catch((e) => { console.error(e); estadoSalvarLayout("⚠️ Erro ao salvar"); });
    return;
  }
  if (m.ehBase) el.caixa = c;
  else {
    el.ajustes = el.ajustes || {};
    el.ajustes[m.tam] = c;
  }
  salvarLayout();
}

function adicionarElementoLayout(tipo) {
  const m = medidasLayout();
  if (!m) {
    alert("Envie o molde de corte desta peça na aba Tamanhos primeiro.");
    return;
  }
  const b = m.base;
  const caixa = tipo === "numero" ? { x: b.w * 0.3, y: b.h * 0.3, w: b.w * 0.4, h: b.h * 0.28 }
    : tipo === "nome" ? { x: b.w * 0.2, y: b.h * 0.18, w: b.w * 0.6, h: b.h * 0.07 }
      : { x: b.w * 0.6, y: b.h * 0.15, w: b.w * 0.18, h: b.w * 0.2 };
  ["x", "y", "w", "h"].forEach((k) => (caixa[k] = arred1(caixa[k])));
  const el = { id: novoIdLayout("e"), tipo, caixa };
  if (tipo !== "brasao") {
    Object.assign(el, {
      campo: tipo === "nome" ? "nomeCamiseta" : "numero",
      corCmyk: [0, 0, 0, 100], contornoMm: 0, contornoCmyk: [0, 0, 0, 0],
      alinhamento: "centro", ajuste: "encolher", maiusculas: true, espacamento: 0, usarNomeSeVazio: true
    });
  }
  elementosDaPeca(layoutPeca).push(el);
  layoutElSel = el.id;
  salvarLayout(true);
  renderizarPalcoLayout();
  renderizarPainelLayout();
}

function renderizarPainelLayout() {
  const painel = document.getElementById("layoutPainel");
  if (!painel) return;
  const els = elementosDaPeca(layoutPeca);
  const el = els.find((e) => e.id === layoutElSel);
  painel.innerHTML = `
    <h4>${escapeHtmlAdmin(nomePecaProducao(layoutPeca))}</h4>
    <ul class="arte-lista-el">${els.map((e) =>
      `<li class="${e.id === layoutElSel ? "ativo" : ""}" data-id="${escAttr(e.id)}">${escapeHtmlAdmin(rotuloElementoLayout(e))}` +
      `${ajusteDoTime(layoutModo, layoutPeca, e.id) ? " <span class=\"badge aguardando\">ajuste do time</span>" : ""}</li>`).join("") ||
      `<li class="pix-ajuda">Nada nesta peça${layoutModo ? " no layout geral" : " — use + Brasão / + Nome / + Número"}. A arte do time entra sozinha, cobrindo o molde.</li>`}</ul>
    <div id="layoutPainelEl"></div>`;
  painel.querySelectorAll("li[data-id]").forEach((li) => {
    li.onclick = () => { layoutElSel = li.dataset.id; renderizarPalcoLayout(); renderizarPainelLayout(); };
  });
  const m = medidasLayout();
  if (!el || !m) return;
  const c = caixaNoEditor(el, m);
  const aj = ajusteDoTime(layoutModo, layoutPeca, el.id);
  const box = document.getElementById("layoutPainelEl");

  let html = `<p class="pix-ajuda">${layoutModo
    ? aj ? "Posição própria deste time." : "Posição do layout geral — mexer cria um ajuste só para este time."
    : m.ehBase ? `Posição no tamanho base (${escapeHtmlAdmin(m.tam)}).`
      : el.ajustes && el.ajustes[m.tam] ? `Ajuste próprio do tamanho ${escapeHtmlAdmin(m.tam)}.`
        : `Tamanho ${escapeHtmlAdmin(m.tam)}: proporcional ao base. Mexer aqui cria um ajuste só deste tamanho.`}</p>
    <div class="arte-grade arte-grade-4">
      <label>X (mm)<input type="number" step="0.5" data-cx="x" value="${c.x.toFixed(1)}" /></label>
      <label>Y (mm)<input type="number" step="0.5" data-cx="y" value="${c.y.toFixed(1)}" /></label>
      <label>Largura<input type="number" step="0.5" min="1" data-cx="w" value="${c.w.toFixed(1)}" /></label>
      <label>Altura<input type="number" step="0.5" min="1" data-cx="h" value="${c.h.toFixed(1)}" /></label>
    </div>
    <div class="arte-botoes-el">
      <button type="button" class="secundario" data-acao="centralizar">Centralizar na largura</button>
      ${layoutModo && aj ? '<button type="button" class="secundario" data-acao="voltarGeral">Voltar ao layout geral</button>' : ""}
      ${!layoutModo && !m.ehBase && el.ajustes && el.ajustes[m.tam] ? '<button type="button" class="secundario" data-acao="semAjusteTam">Voltar ao proporcional</button>' : ""}
    </div>`;

  if (!layoutModo && el.tipo !== "brasao") {
    const cmyk = (nome, v) => `<div class="arte-cmyk" data-cor="${nome}">` +
      ["C", "M", "Y", "K"].map((l, i) =>
        `<label>${l}<input type="number" min="0" max="100" step="1" data-i="${i}" value="${Number((v || [])[i]) || 0}" /></label>`).join("") +
      `<span class="arte-amostra-cor" style="background:${cmykParaCss(v)}"></span></div>`;
    html += `
      <div class="arte-grade">
        ${el.tipo === "nome" ? `<label>Texto
          <select data-p="campo"><option value="nomeCamiseta">Nome na camiseta (apelido)</option><option value="nomeCompleto">Nome completo</option></select></label>` : ""}
        <label>Alinhamento
          <select data-p="alinhamento"><option value="centro">Centro</option><option value="esquerda">Esquerda</option><option value="direita">Direita</option></select></label>
        <label>Texto maior que a caixa
          <select data-p="ajuste"><option value="encolher">Encolher tudo</option><option value="comprimir">Comprimir na largura</option></select></label>
        <label>Espaço entre letras<input type="number" step="0.01" data-p="espacamento" value="${Number(el.espacamento) || 0}" /></label>
        <label>Contorno (mm, 0 = sem)<input type="number" step="0.5" min="0" data-p="contornoMm" value="${Number(el.contornoMm) || 0}" /></label>
        <label class="checkbox-inline"><input type="checkbox" data-p="maiusculas" ${el.maiusculas !== false ? "checked" : ""} /> MAIÚSCULAS</label>
        ${el.tipo === "nome" ? `<label class="checkbox-inline"><input type="checkbox" data-p="usarNomeSeVazio" ${el.usarNomeSeVazio !== false ? "checked" : ""} /> Sem apelido, usar o nome</label>` : ""}
      </div>
      <p class="arte-rotulo-cor">Cor (CMYK %)</p>${cmyk("corCmyk", el.corCmyk)}
      <p class="arte-rotulo-cor">Cor do contorno (CMYK %)</p>${cmyk("contornoCmyk", el.contornoCmyk)}
      <p class="pix-ajuda">A caixa é o limite: nome ou número comprido encolhe (ou é comprimido) para caber — nunca sai dela.</p>`;
  }
  if (!layoutModo) {
    html += `<div class="arte-botoes-el">
      <button type="button" class="secundario" data-acao="duplicar">Duplicar</button>
      <button type="button" class="perigo" data-acao="excluir">Excluir</button></div>`;
  }
  box.innerHTML = html;

  box.querySelectorAll("[data-cx]").forEach((inp) => {
    inp.onchange = () => {
      const nova = { ...c, [inp.dataset.cx]: Number(inp.value) || 0 };
      if (el.tipo === "brasao" && (inp.dataset.cx === "w" || inp.dataset.cx === "h")) {
        const prop = c.w / c.h;
        if (inp.dataset.cx === "w") nova.h = nova.w / prop; else nova.w = nova.h * prop;
      }
      gravarCaixaLayout(el, m, nova);
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
  });
  box.querySelectorAll("[data-p]").forEach((inp) => {
    if (inp.tagName === "SELECT") inp.value = el[inp.dataset.p] || inp.options[0].value;
    inp.onchange = () => {
      const k = inp.dataset.p;
      el[k] = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? Number(inp.value) || 0 : inp.value;
      salvarLayout();
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
  });
  box.querySelectorAll("[data-cor]").forEach((grupo) => {
    grupo.querySelectorAll("input").forEach((inp) => {
      inp.onchange = () => {
        el[grupo.dataset.cor] = [0, 1, 2, 3].map((i) =>
          Math.max(0, Math.min(100, Number(grupo.querySelector(`[data-i="${i}"]`).value) || 0)));
        salvarLayout();
        renderizarPalcoLayout();
        renderizarPainelLayout();
      };
    });
  });
  box.querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.acao;
      if (a === "centralizar") {
        gravarCaixaLayout(el, m, { ...c, x: (m.dim.w - c.w) / 2 });
      } else if (a === "voltarGeral") {
        const prod = limparParaFirestore(producaoDoTime(estadoTimes[layoutModo].time));
        delete prod.layoutAjustes[layoutPeca][el.id];
        await gravarProducaoTime(layoutModo, prod);
      } else if (a === "semAjusteTam") {
        delete el.ajustes[m.tam];
        salvarLayout(true);
      } else if (a === "duplicar") {
        const copia = limparParaFirestore(el);
        copia.id = novoIdLayout("e");
        copia.caixa = { ...copia.caixa, x: copia.caixa.x + 10, y: copia.caixa.y + 10 };
        delete copia.ajustes;
        els.push(copia);
        layoutElSel = copia.id;
        salvarLayout(true);
      } else if (a === "excluir") {
        if (!confirm(`Excluir "${rotuloElementoLayout(el)}" da peça ${nomePecaProducao(layoutPeca)}? Vale para todos os times.`)) return;
        els.splice(els.indexOf(el), 1);
        layoutElSel = "";
        salvarLayout(true);
      }
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
  });
}

// ============================================================
// GERAÇÃO DA FOLHA EPS
// ============================================================

// Carrega o que o time usa: fonte, brasão, moldes dos tamanhos pedidos e as
// artes (convertidas para CMYK na resolução de saída).
async function carregarRecursosDoTime(time, tamanhos, pecasIds, dpiSaida, aviso) {
  const pako = await carregarLib("pako");
  const prod = producaoDoTime(time);
  const rec = { eps: {}, imagens: {}, fonte: null, fonteEtiqueta: null };
  if (prod.fonte && prod.fonte.partes) {
    aviso("Carregando a fonte…");
    rec.fonte = rec.fonteEtiqueta = await obterFonte(prod.fonte.partes);
  }
  const lerEps = async (ref, bbox) => {
    const bytes = await baixarArquivoDrive(driveScriptUrl, ref);
    return { bytes: EPS.extrairPostScript(bytes), bbox: bbox || EPS.lerBoundingBox(bytes) };
  };
  if (prod.brasao) {
    aviso("Carregando o brasão…");
    rec.eps.brasao = await lerEps(prod.brasao.partes || prod.brasao.epsId, prod.brasao.bbox);
  }
  for (const pecaId of pecasIds) {
    for (const t of tamanhos) {
      const m = moldeDe(pecaId, t);
      if (!m) continue;
      aviso(`Carregando o molde ${nomePecaProducao(pecaId)} ${t}…`);
      rec.eps[`molde:${pecaId}:${t}`] = await lerEps(m.partes || m.epsId, m.bbox);
    }
  }
  for (const pecaId of pecasIds) {
    const a = prod.pecas && prod.pecas[pecaId];
    if (!a) continue;
    aviso(`Baixando a arte ${nomePecaProducao(pecaId)}…`);
    const bytes = await baixarArquivoDrive(driveScriptUrl, a.partes);
    const passo = Math.max(1, Math.round((a.dpi || 600) / (dpiSaida || 600)));
    rec.imagens["arte:" + pecaId] = await PngStream.converterParaCmyk(bytes, {
      pako, passo, pausa: esperarTela,
      aoProgresso: (f) => aviso(`Convertendo a arte ${nomePecaProducao(pecaId)} para CMYK… ${Math.round(f * 100)}%`)
    });
    // O PNG original não fica guardado na memória (pode ter centenas de MB).
    delete cacheArquivosDrive[chaveArquivoDrive(a.partes)];
  }
  return rec;
}

// Peças que entram: as que o time tem arte ou o layout tem algo.
function pecasDoTime(time) {
  const prod = producaoDoTime(time);
  return PECAS_PRODUCAO.map((p) => p.id).filter((id) =>
    (prod.pecas && prod.pecas[id]) || elementosDaPeca(id).length);
}

// Time de cada linha da leva: o do pedido; para o avulso, o time com o
// mesmo modelo que tem arquivos de produção.
function timeDaLinha(item) {
  if (item.origem !== "avulso" && item.timeId && estadoTimes[item.timeId]) return item.timeId;
  const modelo = String(item.modelo || "").replace(SUFIXO_MODELO_GOLEIRO, "");
  const candidatos = Object.entries(estadoTimes).filter(([, e]) => modeloDoTime(e.time) === modelo);
  const comArte = candidatos.find(([, e]) => pecasDoTime(e.time).length && e.time.producao);
  return (comArte || candidatos[0] || [""])[0];
}

function baixarBlob(nome, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Diálogo da geração: largura, espaço, giro (depende do fornecedor)...
function perguntarOpcoesEps(resumo) {
  const f = layoutConfig.folha || {};
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.className = "modal-pix modal-eps";
    fundo.innerHTML = `
      <div class="modal-pix-conteudo modal-form-conteudo">
        <button type="button" class="modal-pix-fechar" aria-label="Fechar">×</button>
        <h3>Folha EPS (CMYK)</h3>
        <p class="pix-ajuda">${escapeHtmlAdmin(resumo)}</p>
        <form>
          <label>Largura da folha / rolo (cm)<input type="number" name="larguraCm" min="10" step="0.5" value="${escAttr(f.larguraCm || 150)}" required /></label>
          <label>Distância entre peças (mm)<input type="number" name="espacoMm" min="0" step="0.5" value="${escAttr(f.espacoMm == null ? 10 : f.espacoMm)}" required /></label>
          <label>Girar as peças para aproveitar melhor?
            <select name="rotacao">
              <option value="0">Não girar (fornecedor não permite)</option>
              <option value="90">Girar 90° quando aproveitar melhor</option>
            </select></label>
          <label>Resolução das artes
            <select name="dpi"><option value="600">600 dpi (original)</option><option value="300">300 dpi (arquivo ~4× menor)</option><option value="150">150 dpi (prova)</option></select></label>
          <label>Contorno do molde
            <select name="molde"><option value="frente">Por cima da arte (linha de corte visível)</option><option value="fundo">Por baixo da arte</option><option value="nenhum">Não incluir</option></select></label>
          <label>Altura máxima por folha (cm, 0 = sem limite)<input type="number" name="alturaMaxCm" min="0" step="1" value="${escAttr(f.alturaMaxCm || 0)}" /></label>
          <label class="checkbox-inline"><input type="checkbox" name="etiqueta" ${f.etiqueta !== false ? "checked" : ""} /> Etiqueta "nome · nº · tamanho · peça" embaixo de cada peça</label>
          <button type="submit" class="primario">Gerar</button>
        </form>
      </div>`;
    const form = fundo.querySelector("form");
    form.rotacao.value = f.rotacao || "0";
    form.dpi.value = String(f.dpi || 600);
    form.molde.value = f.molde || "frente";
    const fechar = (valor) => { fundo.remove(); resolve(valor); };
    fundo.querySelector(".modal-pix-fechar").onclick = () => fechar(null);
    fundo.addEventListener("click", (ev) => { if (ev.target === fundo) fechar(null); });
    form.onsubmit = (ev) => {
      ev.preventDefault();
      fechar({
        larguraCm: Number(form.larguraCm.value) || 150,
        espacoMm: Math.max(0, Number(form.espacoMm.value) || 0),
        rotacao: form.rotacao.value,
        dpi: Number(form.dpi.value) || 600,
        molde: form.molde.value,
        alturaMaxCm: Math.max(0, Number(form.alturaMaxCm.value) || 0),
        etiqueta: form.etiqueta.checked
      });
    };
    document.body.appendChild(fundo);
    form.larguraCm.focus();
  });
}

// Ponto de entrada da aba Produção. linhas = [{ item, atual }] (itens da
// leva). Sai um EPS por time (e um à parte para os goleiros, que vestem
// outra cor); mais de um arquivo vai num .zip.
async function gerarFolhasEps(linhas, nomeBase) {
  if (!driveScriptUrl) {
    alert("Configure a URL do Apps Script na aba Configurações (é de lá que vêm os arquivos).");
    return;
  }
  const grupos = new Map();
  const avisos = [];
  linhas.forEach(({ item, atual }) => {
    const timeId = timeDaLinha(item);
    if (!timeId) {
      avisos.push(`"${atual.nomeCamiseta || atual.nome}" (modelo ${item.modelo}): nenhum time com esse modelo — ficou de fora.`);
      return;
    }
    const chave = timeId + (atual.goleiro ? "|goleiro" : "");
    if (!grupos.has(chave)) grupos.set(chave, { timeId, goleiro: !!atual.goleiro, camisetas: [] });
    grupos.get(chave).camisetas.push(atual);
  });
  if (!grupos.size) {
    alert("Nada para gerar.\n\n" + avisos.join("\n"));
    return;
  }
  const nomesTimes = [...new Set([...grupos.values()].map((g) => estadoTimes[g.timeId].time.nome))];
  const op = await perguntarOpcoesEps(`${linhas.length} camiseta(s) de ${nomesTimes.length} time(s): ${nomesTimes.join(", ")}. Sai um arquivo por time.`);
  if (!op) return;
  layoutConfig.folha = { ...layoutConfig.folha, ...op };
  salvarLayout(true);

  const arquivos = [];
  try {
    for (const g of grupos.values()) {
      const time = estadoTimes[g.timeId].time;
      const rotuloTime = time.nome + (g.goleiro ? " (goleiros)" : "");
      const falta = pendenciasProducao(time);
      if (falta.includes("arte das peças")) {
        avisos.push(`${rotuloTime}: o time não tem arte enviada — ficou de fora.`);
        continue;
      }
      falta.forEach((x) => avisos.push(`${rotuloTime}: falta ${x}.`));
      if (g.goleiro) avisos.push(`${rotuloTime}: os goleiros saíram num arquivo à parte, com a mesma arte do time — troque a cor se for o caso.`);
      const pecasIds = pecasDoTime(time);
      const tamanhos = [...new Set(g.camisetas.map((c) => c.tamanho))];
      const rec = await carregarRecursosDoTime(time, tamanhos, pecasIds, op.dpi,
        (t) => avisoProducao(`${rotuloTime}: ${t}`));
      avisoProducao(`${rotuloTime}: montando a folha…`);
      await esperarTela();
      const { blocos, avisos: avB } = EPS.montarBlocos(moldesConfig, layoutConfig, time, g.camisetas, rec,
        { molde: op.molde, etiqueta: op.etiqueta, pecas: pecasIds, nomePeca: nomePecaProducao });
      avB.forEach((a) => avisos.push(`${rotuloTime}: ${a}`));
      const { folhas, avisos: avE } = EPS.empacotar(blocos, {
        larguraMm: op.larguraCm * 10, espacoMm: op.espacoMm, rotacao: op.rotacao, alturaMaxMm: op.alturaMaxCm * 10
      });
      avE.forEach((a) => avisos.push(`${rotuloTime}: ${a}`));
      folhas.forEach((f, i) => {
        const sufixo = (g.goleiro ? "-goleiros" : "") + (folhas.length > 1 ? `-folha${i + 1}` : "");
        const nome = `${slugify(nomeBase + "-" + time.nome) || "folha"}${sufixo}.eps`;
        const mb = EPS.estimarTamanho(f, rec) / 1e6;
        if (mb > 500) avisos.push(`${nome}: arquivo grande (~${Math.round(mb)} MB). Se o programa não abrir, gere em 300 dpi.`);
        arquivos.push({ nome, blob: new Blob(EPS.escreverEps(f, rec, `${rotuloTime}${sufixo}`), { type: "application/postscript" }) });
      });
    }
    if (!arquivos.length) {
      avisoProducao("");
      alert("Nenhuma folha gerada.\n\n• " + avisos.join("\n• "));
      return;
    }
    if (arquivos.length === 1) {
      baixarBlob(arquivos[0].nome, arquivos[0].blob);
    } else {
      avisoProducao("Compactando…");
      const JSZip = await carregarLib("JSZip");
      const zip = new JSZip();
      arquivos.forEach((a) => zip.file(a.nome, a.blob));
      // STORE: o EPS já vem comprimido por dentro; recomprimir só gasta tempo.
      baixarBlob((slugify(nomeBase) || "folhas") + "-eps.zip", await zip.generateAsync({ type: "blob", compression: "STORE" }));
    }
    avisoProducao("");
    if (avisos.length) alert(`${arquivos.length} arquivo(s) gerado(s), com avisos:\n\n• ` + avisos.join("\n• "));
  } catch (e) {
    console.error(e);
    avisoProducao("");
    alert("Não foi possível gerar a folha EPS: " + (e.message || e));
  }
}

// "⬇ EPS de teste" do editor: a peça aberta, no tamanho mostrado, com o
// apelido e o número de teste e os arquivos do time da prévia.
async function baixarEpsDeTesteLayout() {
  const time = timeDaPrevia();
  const m = medidasLayout();
  if (!m) { alert("Envie o molde de corte desta peça primeiro (aba Tamanhos)."); return; }
  if (!time) { alert("Escolha um time (com os arquivos de produção enviados) para o teste."); return; }
  if (!exigirDriveProducao()) return;
  try {
    const rec = await carregarRecursosDoTime(time, [m.tam], [layoutPeca], 150, avisoProducao);
    const { blocos, avisos } = EPS.montarBlocos(moldesConfig, layoutConfig, time,
      [{ ...amostraLayout, tamanho: m.tam }], rec, { molde: "frente", etiqueta: false, pecas: [layoutPeca], nomePeca: nomePecaProducao });
    const { folhas } = EPS.empacotar(blocos, { larguraMm: m.dim.w + 20, espacoMm: 10, rotacao: "0" });
    avisoProducao("");
    if (!folhas.length) { alert(avisos.join("\n") || "Nada para gerar."); return; }
    baixarBlob(slugify(`teste-${time.nome}-${nomePecaProducao(layoutPeca)}-${m.tam}`) + ".eps",
      new Blob(EPS.escreverEps(folhas[0], rec, "Teste"), { type: "application/postscript" }));
    if (avisos.length) alert(avisos.join("\n"));
  } catch (e) {
    console.error(e);
    avisoProducao("");
    alert("Não foi possível gerar o EPS de teste: " + (e.message || e));
  }
}
