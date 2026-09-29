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

// Sangria usada nas prévias (a mesma da última geração; padrão 2 mm).
function sangriaDaPrevia() {
  const s = layoutConfig && layoutConfig.folha && layoutConfig.folha.sangriaMm;
  return s == null ? 2 : Number(s) || 0;
}

// Brasão (do time) e logo (da empresa) são caixas de imagem: mantêm a
// proporção e não têm estilo de texto.
function ehCaixaImagem(el) {
  return el.tipo === "brasao" || el.tipo === "logo" || el.tipo === "detalhe";
}

// Miniatura (url) de uma caixa de imagem para um time e uma peça.
function imagemDaCaixa(el, prod, pecaId) {
  if (el.tipo === "logo") return logoEmpresa && logoEmpresa.previaUrl;
  if (el.tipo === "detalhe") {
    const d = EPS.detalheDaPeca(prod, pecaId);
    return d && d.img.previaUrl;
  }
  return prod.brasao && prod.brasao.previaUrl;
}

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
  escutarLogoEmpresa();
  db.collection("config").doc("layout").onSnapshot(
    (doc) => {
      // Enquanto há uma gravação pendente, a cópia local é a mais nova.
      if (salvarLayoutTimer) return;
      const d = doc.exists ? doc.data() : {};
      layoutConfig = { pecas: d.pecas || {}, folha: d.folha || {} };
      ultimoLayoutSalvo = JSON.stringify(layoutConfig);
      renderizarEditorLayout();
      if (typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
    },
    (erro) => console.error("Erro ao carregar o layout:", erro)
  );
}

function elementosDaPeca(pecaId) {
  const p = layoutConfig.pecas[pecaId] || (layoutConfig.pecas[pecaId] = { elementos: [] });
  p.elementos = p.elementos || [];
  return p.elementos;
}

// ---------------- Desfazer / refazer ----------------
// Cada mudança do editor guarda o "antes" e o "depois": do layout geral
// (config/layout) ou da produção do time (ajustes próprios).
const historicoEditor = { desfazer: [], refazer: [] };
let ultimoLayoutSalvo = "";   // layout geral como estava na última gravação
let aplicandoHistorico = false;

function registrarHistorico(entrada) {
  if (aplicandoHistorico || entrada.antes === entrada.depois) return;
  historicoEditor.desfazer.push(entrada);
  if (historicoEditor.desfazer.length > 100) historicoEditor.desfazer.shift();
  historicoEditor.refazer = [];
  atualizarBotoesHistorico();
}

function atualizarBotoesHistorico() {
  const b1 = document.querySelector('[data-historico="desfazer"]');
  const b2 = document.querySelector('[data-historico="refazer"]');
  if (b1) b1.disabled = !historicoEditor.desfazer.length;
  if (b2) b2.disabled = !historicoEditor.refazer.length;
}

async function aplicarHistorico(de, para, lado) {
  const e = historicoEditor[de].pop();
  if (!e) return;
  historicoEditor[para].push(e);
  const valor = e[lado];
  aplicandoHistorico = true;
  try {
    if (e.tipo === "geral") {
      layoutConfig = JSON.parse(valor);
      ultimoLayoutSalvo = valor;
      salvarLayout(true);
    } else if (estadoTimes[e.timeId]) {
      await gravarProducaoTime(e.timeId, JSON.parse(valor));
    }
  } finally {
    aplicandoHistorico = false;
  }
  estadoSalvarLayout(de === "desfazer" ? "↶ Desfeito" : "↷ Refeito");
  renderizarPalcoLayout();
  renderizarPainelLayout();
  atualizarBotoesHistorico();
}

const desfazerEditor = () => aplicarHistorico("desfazer", "refazer", "antes");
const refazerEditor = () => aplicarHistorico("refazer", "desfazer", "depois");

function salvarLayout(imediato) {
  const agora = JSON.stringify(layoutConfig);
  if (ultimoLayoutSalvo) registrarHistorico({ tipo: "geral", antes: ultimoLayoutSalvo, depois: agora });
  ultimoLayoutSalvo = agora;
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
// LOGO DA EMPRESA (Configurações)
// ============================================================
// Um EPS só, o mesmo para todos os times, usado como detalhe das camisetas
// (ex.: a assinatura no peito ou na manga). Fica em config/geral.logoEmpresa
// e entra no layout como uma caixa, igual ao brasão ("+ Logo" na aba Artes).

let logoEmpresa = null;

function escutarLogoEmpresa() {
  db.collection("config").doc("geral").onSnapshot(
    (doc) => {
      const antes = JSON.stringify(logoEmpresa);
      logoEmpresa = (doc.exists && doc.data().logoEmpresa) || null;
      renderizarLogoEmpresa();
      renderizarEditorLayout();
      if (antes !== JSON.stringify(logoEmpresa) && typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
    },
    (erro) => console.error("Erro ao carregar o logo da empresa:", erro)
  );
}

// Caixa inicial do logo: pequena, no peito à esquerda, na proporção do EPS.
function caixaLogoInicial(b) {
  const w = b.w * 0.14;
  const dim = logoEmpresa && logoEmpresa.bbox ? EPS.tamanhoMmDoBbox(logoEmpresa.bbox) : { w: 1, h: 1 };
  return { x: b.w * 0.18, y: b.h * 0.2, w, h: (w * dim.h) / dim.w };
}

// Caixa inicial do detalhe da manga: no meio da manga, perto da barra, na
// proporção do PNG do time mostrado na prévia (ou quadrada).
function caixaDetalheInicial(b) {
  const d = EPS.detalheDaPeca(producaoDoTime(timeDaPrevia()), layoutPeca);
  const prop = d && d.img.larguraPx ? d.img.alturaPx / d.img.larguraPx : 1;
  const w = b.w * 0.3;
  return { x: (b.w - w) / 2, y: b.h * 0.55, w, h: w * prop };
}

function renderizarLogoEmpresa() {
  const el = document.getElementById("logoEmpresaBloco");
  if (!el) return;
  const l = logoEmpresa;
  const dim = l && l.bbox ? EPS.tamanhoMmDoBbox(l.bbox) : null;
  el.innerHTML = `
    <div class="logo-empresa">
      <div class="logo-empresa-previa">${l && l.previaUrl
        ? `<img src="${escAttr(l.previaUrl)}" alt="Logo da empresa" />`
        : `<span>${l ? "EPS enviado (sem prévia)" : "Nenhum logo"}</span>`}</div>
      <div>
        ${l ? `<p><strong>${escapeHtmlAdmin(l.nomeArquivo || "logo.eps")}</strong>${dim ? ` · ${dim.w.toFixed(0)} × ${dim.h.toFixed(0)} mm` : ""}</p>` : ""}
        <button type="button" class="secundario" data-logo="enviar">${l ? "Trocar logo" : "Enviar logo (EPS)"}</button>
        ${l ? '<button type="button" class="perigo" data-logo="remover">Remover</button>' : ""}
      </div>
    </div>`;
  el.querySelector('[data-logo="enviar"]').onclick = async () => {
    if (!exigirDriveProducao()) return;
    const file = await escolherArquivos(".eps,.ps,application/postscript");
    if (!file) return;
    try {
      const dados = await enviarEpsComPrevia(file, "logo-empresa", 600);
      await db.collection("config").doc("geral").set({ logoEmpresa: limparParaFirestore(dados) }, { merge: true });
      if (dados.semPrevia) alert("O logo foi enviado, mas a prévia não pôde ser desenhada. Ele aparece como uma caixa no editor.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Não foi possível enviar o logo.");
    } finally {
      avisoProducao("");
    }
  };
  const rem = el.querySelector('[data-logo="remover"]');
  if (rem) {
    rem.onclick = async () => {
      if (!confirm("Remover o logo da empresa? As caixas de logo do layout ficam vazias até enviar outro.")) return;
      await db.collection("config").doc("geral").update({ logoEmpresa: firebase.firestore.FieldValue.delete() });
    };
  }
}

// ============================================================
// ARQUIVOS DE PRODUÇÃO DO TIME (time aberto → aba Arquivos de produção)
// ============================================================

const blocoProducaoAberto = {}; // timeId -> true quando o bloco está aberto
const enviandoProducao = {};    // "timeId|slot" -> texto de andamento

function producaoDoTime(time) {
  return (time && time.producao) || {};
}

// ---------------- Variante goleiro ----------------
// O goleiro veste outra camiseta: o time pode enviar artes, brasão, detalhe
// e fonte próprios dele e ajustar a arte à parte (producao.goleiro, com o
// mesmo formato). O que o goleiro não tiver usa o da camiseta comum.
// Nas abas "Arquivos de produção" e "Editar arte" um seletor escolhe qual
// variante está sendo mexida (o mesmo nas duas abas).
const varianteGoleiroTime = {}; // timeId -> true quando mostra a do goleiro

function editandoGoleiro(timeId) {
  return !!varianteGoleiroTime[timeId];
}

function producaoGoleiroPropria(prod) {
  return (prod && prod.goleiro) || {};
}

// O goleiro tem algum arquivo ou ajuste próprio?
function temVarianteGoleiro(time) {
  const g = producaoGoleiroPropria(producaoDoTime(time));
  return !!(Object.keys(g.pecas || {}).length || g.brasao || g.fonte || g.detalheManga || g.detalheMangaDir ||
    Object.keys(g.layoutAjustes || {}).length || Object.keys(g.elementosExtras || {}).length);
}

// Ajuste do goleiro por cima do da comum: a posição vem inteira de um ou do
// outro; o estilo mistura (o do goleiro ganha); "oculto" do goleiro ganha.
function mesclarAjusteGoleiro(comum, gol) {
  if (!gol) return comum;
  const m = { ...(comum || {}) };
  if (gol.base || gol.tamanhos) {
    delete m.base;
    delete m.tamanhos;
    if (gol.base) m.base = gol.base;
    if (gol.tamanhos) m.tamanhos = gol.tamanhos;
  }
  if (gol.estilo) m.estilo = { ...(m.estilo || {}), ...gol.estilo };
  if ("oculto" in gol) m.oculto = gol.oculto;
  return m;
}

// Os arquivos e ajustes que valem para a camiseta do goleiro.
function producaoDoGoleiro(prod) {
  const p = prod || {};
  const g = producaoGoleiroPropria(p);
  const saida = { ...p, pecas: { ...(p.pecas || {}), ...(g.pecas || {}) } };
  delete saida.goleiro;
  ["brasao", "fonte", "detalheManga", "detalheMangaDir"].forEach((k) => { if (g[k]) saida[k] = g[k]; });
  // Elementos só do time: o goleiro pode ter a lista própria de uma peça.
  if (p.elementosExtras || g.elementosExtras) saida.elementosExtras = { ...(p.elementosExtras || {}), ...(g.elementosExtras || {}) };
  const ajustes = {};
  const pecasAj = new Set([...Object.keys(p.layoutAjustes || {}), ...Object.keys(g.layoutAjustes || {})]);
  pecasAj.forEach((pecaId) => {
    const c = (p.layoutAjustes || {})[pecaId] || {};
    const gl = (g.layoutAjustes || {})[pecaId] || {};
    const porPeca = {};
    new Set([...Object.keys(c), ...Object.keys(gl)]).forEach((elId) => {
      porPeca[elId] = mesclarAjusteGoleiro(c[elId], gl[elId]);
    });
    ajustes[pecaId] = porPeca;
  });
  saida.layoutAjustes = ajustes;
  return saida;
}

// O time "vestido" de goleiro (ou o próprio time), para a prévia, o editor e
// a folha EPS — que leem tudo de time.producao.
function timeNaVariante(time, goleiro) {
  if (!time || !goleiro) return time;
  return { ...time, producao: producaoDoGoleiro(producaoDoTime(time)) };
}

// Seletor "Camiseta comum | Goleiro" das abas do pedido.
function criarSeletorVariante(timeId) {
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  const gol = editandoGoleiro(timeId);
  const wrap = document.createElement("div");
  wrap.className = "seletor-variante";
  wrap.innerHTML = `
    <div class="segmentado" role="tablist" aria-label="Variante da camiseta">
      <button type="button" data-variante="" class="${gol ? "" : "ativo"}" aria-selected="${!gol}">Camiseta comum</button>
      <button type="button" data-variante="goleiro" class="${gol ? "ativo" : ""}" aria-selected="${gol}">${icone("hand")} Goleiro${temVarianteGoleiro(time) ? " ●" : ""}</button>
    </div>
    <span class="pix-ajuda">${gol
      ? "Arquivos e ajustes só da camiseta do goleiro. O que não for enviado ou mudado aqui usa o da camiseta comum."
      : "Arquivos e ajustes da camiseta de todos. Troque para “Goleiro” para enviar artes diferentes para ele."}</span>`;
  wrap.querySelectorAll("[data-variante]").forEach((b) => {
    b.onclick = () => {
      varianteGoleiroTime[timeId] = !!b.dataset.variante;
      layoutElSel = "";
      if (typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
    };
  });
  return wrap;
}

// Algum elemento (do layout geral ou só deste time) passa no teste?
function usaNoTime(prod, teste) {
  return PECAS_EDITOR.some((pc) => EPS.elementosDaPecaNoTime(layoutConfig, prod, pc.id).some(teste));
}

// O checklist dos arquivos de produção: cada item diz se o layout usa aquilo
// (necessário) e se o time já enviou (tem).
function requisitosProducao(time) {
  const p = producaoDoTime(time);
  const usa = (teste) => usaNoTime(p, teste);
  const nArtes = PECAS_PRODUCAO.filter((x) => p.pecas && p.pecas[x.id]).length;
  return [
    { id: "artes", rotulo: "Artes das peças", necessario: true, tem: nArtes > 0, detalhe: `${nArtes} enviada(s)` },
    { id: "fonte", rotulo: "Fonte", necessario: usa((e) => !ehCaixaImagem(e)), tem: !!p.fonte },
    { id: "brasao", rotulo: "Brasão", necessario: usa((e) => e.tipo === "brasao"), tem: !!p.brasao },
    { id: "detalhe", rotulo: "Detalhe da manga", necessario: usa((e) => e.tipo === "detalhe"), tem: !!p.detalheManga }
  ];
}

// O que falta para o time poder gerar a folha (na variante do goleiro, passe
// timeNaVariante(time, true)).
function pendenciasProducao(time) {
  const p = producaoDoTime(time);
  const falta = [];
  const temArte = PECAS_PRODUCAO.some((x) => p.pecas && p.pecas[x.id]);
  if (!temArte) falta.push("arte das peças");
  const usaTexto = usaNoTime(p, (e) => !ehCaixaImagem(e));
  const usaBrasao = usaNoTime(p, (e) => e.tipo === "brasao");
  if (usaTexto && !p.fonte) falta.push("fonte");
  if (usaBrasao && !p.brasao) falta.push("brasão");
  const usaDetalhe = usaNoTime(p, (e) => e.tipo === "detalhe");
  if (usaDetalhe && !p.detalheManga) falta.push("detalhe da manga");
  return falta;
}

async function gravarProducaoTime(timeId, producao) {
  const limpo = limparParaFirestore(producao);
  if (estadoTimes[timeId]) estadoTimes[timeId].time.producao = limpo;
  await db.collection(COL_TIMES).doc(timeId).update({ producao: limpo });
  agendarPreviaCliente(timeId); // prévia do cliente, se o time não tem imagens postadas
}

function criarBlocoProducaoTime(timeId, time) {
  const gol = editandoGoleiro(timeId);
  const comum = producaoDoTime(time);
  const propria = gol ? producaoGoleiroPropria(comum) : comum;
  const prod = gol ? producaoDoGoleiro(comum) : comum;
  const bloco = document.createElement("details");
  bloco.className = "producao-time" + (gol ? " variante-goleiro" : "");
  bloco.open = !!blocoProducaoAberto[timeId];
  bloco.addEventListener("toggle", () => (blocoProducaoAberto[timeId] = bloco.open));

  // Checklist: o que o layout usa e o que já foi enviado.
  const reqs = requisitosProducao(gol ? timeNaVariante(time, true) : time);
  const falta = reqs.filter((r) => r.necessario && !r.tem);
  const nProprios = gol ? Object.keys(propria.pecas || {}).length +
    ["brasao", "fonte", "detalheManga", "detalheMangaDir"].filter((k) => propria[k]).length : 0;
  bloco.innerHTML = `<summary class="producao-resumo">
      <span class="producao-estado ${falta.length ? "falta" : "pronto"}">${falta.length
        ? `Falta ${escapeHtmlAdmin(falta.map((r) => r.rotulo.toLowerCase()).join(", "))}`
        : "✓ Pronto para gerar a folha"}</span>
      <span class="producao-checklist">${reqs.filter((r) => r.necessario || r.tem).map((r) =>
        `<span class="check-item ${r.tem ? "ok" : "falta"}">${r.tem ? "✓" : "○"} ${escapeHtmlAdmin(r.rotulo)}${r.detalhe && r.tem ? ` <small>${escapeHtmlAdmin(r.detalhe)}</small>` : ""}</span>`).join("")}</span>
      ${gol ? `<span class="pix-ajuda">${icone("hand")} ${nProprios} arquivo(s) próprio(s) do goleiro — o resto usa o da camiseta comum</span>` : ""}
    </summary>`;

  const infoPng = (a) => a ? {
    previa: a.previaUrl,
    nome: a.nomeArquivo || "",
    info: `${Math.round((a.larguraPx / (a.dpi || 600)) * 25.4)} × ${Math.round((a.alturaPx / (a.dpi || 600)) * 25.4)} mm · ${a.dpi || "?"} dpi`
  } : null;
  const infoBrasao = (b) => b ? { previa: b.previaUrl, nome: b.nomeArquivo || "", info: "EPS vetorial" } : null;
  const infoFonte = (f) => f ? { nome: f.nome, info: "Fonte do nome e do número", fonte: true } : null;

  const grupo = (titulo, ajuda) => {
    const sec = document.createElement("section");
    sec.className = "producao-grupo";
    sec.innerHTML = `<h4 class="producao-grupo-titulo">${escapeHtmlAdmin(titulo)}</h4>${ajuda ? `<p class="pix-ajuda">${ajuda}</p>` : ""}`;
    const grade = document.createElement("div");
    grade.className = "producao-grade";
    sec.appendChild(grade);
    bloco.appendChild(sec);
    return grade;
  };
  // Na variante do goleiro, um espaço sem arquivo próprio mostra (apagado) o
  // da camiseta comum, que é o que vai ser usado.
  const slot = (grade, id, titulo, proprio, daComum, formato) => {
    const herdado = gol && !proprio && daComum ? daComum : null;
    grade.appendChild(criarSlotProducao(timeId, id, titulo, proprio, formato, herdado));
  };

  const gradePecas = grupo("Peças da camiseta", "PNG 600 dpi, feito para o molde do tamanho base. Nos outros tamanhos a arte acompanha o molde.");
  // Uma arte serve para as duas mangas; a da direita só aparece quando o
  // time ativa "manga direita com arte diferente".
  PECAS_PRODUCAO.forEach((peca) => {
    if (peca.id === "mangaDir" && !comum.mangaDirDiferente) return;
    const titulo = peca.id === "mangaEsq" && !comum.mangaDirDiferente ? "Mangas (as duas)" : peca.nome;
    slot(gradePecas, `arte:${peca.id}`, titulo, infoPng(propria.pecas && propria.pecas[peca.id]),
      infoPng(comum.pecas && comum.pecas[peca.id]), "PNG 600 dpi");
  });

  const gradeExtras = grupo("Brasão, detalhe e fonte", "");
  slot(gradeExtras, "brasao", "Brasão", infoBrasao(propria.brasao), infoBrasao(comum.brasao), "EPS");
  slot(gradeExtras, "detalhe", comum.detalheDirDiferente ? "Detalhe da manga esquerda" : "Detalhe da manga",
    infoPng(propria.detalheManga), infoPng(comum.detalheManga), "PNG 600 dpi");
  if (comum.detalheDirDiferente) {
    slot(gradeExtras, "detalhe:dir", "Detalhe da manga direita", infoPng(propria.detalheMangaDir), infoPng(comum.detalheMangaDir), "PNG 600 dpi");
  }
  slot(gradeExtras, "fonte", "Fonte", infoFonte(propria.fonte), infoFonte(comum.fonte), ".ttf / .otf");

  // Mangas e detalhe diferentes em cada lado (padrão: um arquivo para as duas).
  // Valem para as duas variantes.
  const opcoes = document.createElement("div");
  opcoes.className = "producao-opcoes";
  opcoes.innerHTML = `
    <label class="interruptor"><input type="checkbox" data-op="mangaDirDiferente" ${comum.mangaDirDiferente ? "checked" : ""} /> <span>Manga direita com arte diferente</span></label>
    <label class="interruptor"><input type="checkbox" data-op="detalheDirDiferente" ${comum.detalheDirDiferente ? "checked" : ""} /> <span>Detalhe diferente na manga direita</span></label>
    ${gol ? '<span class="pix-ajuda">(vale para a camiseta comum e a do goleiro)</span>' : ""}`;
  opcoes.querySelectorAll("[data-op]").forEach((inp) => {
    inp.onchange = async () => {
      const p = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
      p[inp.dataset.op] = inp.checked;
      await gravarProducaoTime(timeId, p);
    };
  });
  bloco.appendChild(opcoes);

  // Cor do reforço de ombro deste time (vazio = a cor padrão da aba Tamanhos).
  if (Object.values(moldesConfig.reforcoOmbro || {}).some((v) => Number(v) > 0)) {
    const cor = comum.reforcoCmyk || moldesConfig.reforcoCmyk || [0, 0, 0, 0];
    const ref = document.createElement("div");
    ref.className = "producao-opcoes producao-reforco";
    ref.innerHTML = `<span>Cor do reforço de ombro (CMYK %)</span>
      <span class="arte-amostra-cor" style="background:${cmykParaCss(cor)}"></span>
      ${["C", "M", "Y", "K"].map((l, i) =>
        `<label>${l}<input type="number" min="0" max="100" step="1" class="input-curto" data-reforco-time="${i}" value="${Number(cor[i]) || 0}" /></label>`).join("")}
      <span class="pix-ajuda">${comum.reforcoCmyk ? "Cor própria deste time" : "Cor padrão (aba Tamanhos)"}</span>
      ${comum.reforcoCmyk ? '<button type="button" class="secundario" data-reforco-padrao>Usar a padrão</button>' : ""}`;
    ref.querySelectorAll("[data-reforco-time]").forEach((inp) => {
      inp.onchange = async () => {
        const p = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
        const c = (p.reforcoCmyk || moldesConfig.reforcoCmyk || [0, 0, 0, 0]).slice();
        c[Number(inp.dataset.reforcoTime)] = Math.max(0, Math.min(100, Number(inp.value) || 0));
        p.reforcoCmyk = c;
        await gravarProducaoTime(timeId, p);
      };
    });
    const bPadrao = ref.querySelector("[data-reforco-padrao]");
    if (bPadrao) bPadrao.onclick = async () => {
      const p = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
      delete p.reforcoCmyk;
      await gravarProducaoTime(timeId, p);
    };
    bloco.appendChild(ref);
  }

  const rodape = document.createElement("div");
  rodape.className = "producao-rodape";
  const btnLayout = document.createElement("button");
  btnLayout.type = "button";
  btnLayout.className = "primario";
  btnLayout.innerHTML = icone("pencil") + (gol ? " Editar arte do goleiro" : " Editar arte deste time");
  btnLayout.onclick = () => abrirLayoutDoTime(timeId);
  rodape.appendChild(btnLayout);
  const nAjustes = Object.values(propria.layoutAjustes || {}).reduce((s, p) => s + Object.keys(p || {}).length, 0);
  rodape.insertAdjacentHTML("beforeend", `<span class="pix-ajuda">${nAjustes
    ? `${nAjustes} ajuste(s) próprio(s)${gol ? " do goleiro" : ""} de posição, letra ou cor`
    : "Posição do nome, número e brasão: segue o layout geral (aba Artes)"}</span>`);
  bloco.appendChild(rodape);
  return bloco;
}

// Amostra da fonte do time ("AaBb 0123"), desenhada com a própria fonte.
function amostraDaFonteHtml(time) {
  const fonte = fonteProntaDoTime(time);
  if (!fonte) return '<span class="producao-fonte-carregando">Aa 123</span>';
  const l = EPS.layoutTexto(fonte, "AaBb 0123", { w: 120, h: 22 }, { maiusculas: false });
  return `<svg viewBox="0 0 120 22" class="producao-fonte-amostra" role="img" aria-label="Amostra da fonte"><path d="${caminhoSvg(l.comandos, 1)}" fill="#111827"/></svg>`;
}

// `herdado`: na variante do goleiro, o arquivo da comum que vale no lugar.
function criarSlotProducao(timeId, slot, titulo, atual, formato, herdado) {
  const gol = editandoGoleiro(timeId);
  const div = document.createElement("div");
  div.className = "producao-slot" + (atual ? " ok" : " vazio") + (herdado ? " herdado" : "");
  const andamento = enviandoProducao[chaveEnvio(timeId, slot, gol)];
  if (andamento) div.classList.add("enviando");
  const mostrar = atual || herdado;
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  const previa = mostrar && mostrar.fonte
    ? amostraDaFonteHtml(timeNaVariante(time, gol))
    : mostrar && mostrar.previa
      ? `<img src="${escAttr(mostrar.previa)}" alt="" loading="lazy" />`
      : mostrar ? '<span class="producao-slot-ok">✓</span>'
        : `<span class="producao-slot-soltar"><span class="producao-slot-seta">${icone("file-up")}</span>Clique ou arraste<br><small>${escapeHtmlAdmin(formato)}</small></span>`;
  div.innerHTML = `
    <div class="producao-slot-titulo"><span>${escapeHtmlAdmin(titulo)}</span>${atual ? '<span class="producao-slot-selo">✓</span>' : herdado ? '<span class="producao-slot-selo herdado" title="Usa o da camiseta comum">comum</span>' : ""}</div>
    <div class="producao-slot-previa">${previa}</div>
    <div class="producao-slot-info">${andamento
      ? `<span class="producao-slot-andamento">${escapeHtmlAdmin(andamento)}</span>`
      : atual ? `${atual.nome ? `<span class="producao-slot-nome" title="${escAttr(atual.nome)}">${escapeHtmlAdmin(atual.nome)}</span>` : ""}<span>${escapeHtmlAdmin(atual.info || "")}</span>`
        : herdado ? "Usa o da camiseta comum" : "Nenhum arquivo"}</div>`;
  const acoes = document.createElement("div");
  acoes.className = "producao-slot-acoes";
  const env = document.createElement("button");
  env.type = "button";
  env.className = atual ? "secundario" : "primario";
  env.textContent = atual ? "Trocar" : "Enviar";
  env.disabled = !!andamento;
  env.onclick = (ev) => { ev.stopPropagation(); enviarArquivoProducao(timeId, slot, gol); };
  acoes.appendChild(env);
  if (atual) {
    const rem = document.createElement("button");
    rem.type = "button";
    rem.className = "secundario botao-remover";
    rem.textContent = "Remover";
    rem.title = gol ? "Remover (volta a usar o da camiseta comum)" : "Remover";
    rem.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(gol
        ? `Remover ${titulo.toLowerCase()} do goleiro? Ele volta a usar o da camiseta comum.`
        : `Remover ${titulo.toLowerCase()} deste time?`)) return;
      const prod = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
      const alvo = gol ? (prod.goleiro = prod.goleiro || {}) : prod;
      if (slot === "brasao") delete alvo.brasao;
      else if (slot === "fonte") delete alvo.fonte;
      else if (slot === "detalhe") delete alvo.detalheManga;
      else if (slot === "detalhe:dir") delete alvo.detalheMangaDir;
      else if (alvo.pecas) delete alvo.pecas[slot.slice(5)];
      limparGoleiroVazio(prod);
      await gravarProducaoTime(timeId, prod);
    };
    acoes.appendChild(rem);
  }
  div.appendChild(acoes);

  // Espaço vazio: clicar em qualquer lugar abre o seletor de arquivo.
  if (!atual && !andamento) {
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `Enviar ${titulo}`);
    div.onclick = () => enviarArquivoProducao(timeId, slot, gol);
    div.onkeydown = (ev) => { if (ev.target === div && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); div.click(); } };
  }
  // Arrastar e soltar o arquivo em cima do espaço.
  if (!andamento) {
    div.addEventListener("dragover", (ev) => { ev.preventDefault(); div.classList.add("arrastando"); });
    div.addEventListener("dragleave", () => div.classList.remove("arrastando"));
    div.addEventListener("drop", (ev) => {
      ev.preventDefault();
      div.classList.remove("arrastando");
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) enviarArquivoProducao(timeId, slot, gol, file);
    });
  }
  return div;
}

function chaveEnvio(timeId, slot, goleiro) {
  return `${timeId}|${goleiro ? "goleiro:" : ""}${slot}`;
}

// Tira o que ficou vazio em producao.goleiro (para não sobrar lixo no banco).
function limparGoleiroVazio(prod) {
  const g = prod.goleiro;
  if (!g) return;
  if (g.pecas && !Object.keys(g.pecas).length) delete g.pecas;
  if (g.layoutAjustes && !Object.keys(g.layoutAjustes).length) delete g.layoutAjustes;
  if (g.elementosExtras && !Object.keys(g.elementosExtras).length) delete g.elementosExtras;
  if (!Object.keys(g).length) delete prod.goleiro;
}

function marcarEnvio(timeId, slot, texto, goleiro) {
  const k = chaveEnvio(timeId, slot, goleiro);
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

// `arquivo`: já escolhido (arrastar e soltar); sem ele, abre o seletor.
async function enviarArquivoProducao(timeId, slot, goleiro, arquivo) {
  if (!exigirDriveProducao()) return;
  const accept = slot === "brasao" ? ".eps,.ps,application/postscript"
    : slot === "fonte" ? ".ttf,.otf,font/ttf,font/otf" : "image/png";
  const file = arquivo || await escolherArquivos(accept);
  if (!file) return;
  // Arquivo solto do tipo errado: avisa antes de tentar enviar.
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
  const esperado = slot === "brasao" ? ["eps", "ps"] : slot === "fonte" ? ["ttf", "otf"] : ["png"];
  if (!esperado.includes(ext.toLowerCase())) {
    alert(`Este espaço aceita ${esperado.map((e) => "." + e).join(" ou ")} — o arquivo "${file.name}" não é desse tipo.`);
    return;
  }
  const pref = `${slugify(estadoTimes[timeId].time.nome) || timeId}${goleiro ? "-goleiro" : ""}-${slot.replace(":", "-")}`;
  const marcar = (texto) => marcarEnvio(timeId, slot, texto, goleiro);
  try {
    let dados;
    if (slot === "brasao") {
      marcar("enviando…");
      dados = await enviarEpsComPrevia(file, pref, 600);
      if (dados.semPrevia) alert("O brasão foi enviado, mas a prévia não pôde ser desenhada. Ele aparece como uma caixa no editor.");
    } else if (slot === "fonte") {
      marcar("enviando…");
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
      marcar("enviando 0%…");
      const env = await enviarArquivoDrive(driveScriptUrl, file, pref,
        (f) => marcar(`enviando ${Math.round(f * 100)}%…`));
      marcar("gerando miniatura…");
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
    const alvo = goleiro ? (prod.goleiro = prod.goleiro || {}) : prod;
    if (slot === "brasao") alvo.brasao = dados;
    else if (slot === "fonte") alvo.fonte = dados;
    else if (slot === "detalhe") alvo.detalheManga = dados;
    else if (slot === "detalhe:dir") alvo.detalheMangaDir = dados;
    else {
      alvo.pecas = alvo.pecas || {};
      alvo.pecas[slot.slice(5)] = dados;
    }
    await gravarProducaoTime(timeId, prod);
  } catch (e) {
    console.error(e);
    alert(e.message || "Não foi possível enviar o arquivo.");
  } finally {
    avisoProducao("");
    marcar("");
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

const previaTime = { modo: "arte", tam: "", vista: "cena" };
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
// `semRecorte`: sem o recorte no formato do molde (o mockup usa a peça
// inteira; quem dá o formato é a foto). `soArte`: só a arte, sem brasão,
// logo, detalhe, nome e número (fundo das bordas no mockup); "elementos":
// só eles, sem a arte (a caixa própria das regiões do mockup).
// Espessura da faca (linha de corte), toda por fora do molde — igual à folha.
const FACA_MM = 3;

function pecaEmSvg(time, timeId, pecaId, tam, amostra, comMolde, semRecorte, soArte) {
  const prod = producaoDoTime(time);
  const virtual = !!EPS.PECAS_VIRTUAIS[pecaId];
  const ad = virtual ? null : EPS.arteDaPeca(prod, pecaId);
  const arte = ad && ad.arte;
  const moldes = virtual ? {} : moldesConfig.pecas[pecaId] || {};
  const molde = tam ? moldeDaPecaNoTam(pecaId, tam) : null;
  const mb = moldes[moldesConfig.tamanhoBase];
  amostra = amostraComTam(amostra, tam, time);

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
  // Recorte no formato do molde (a arte, o brasão, o logo e os textos).
  const idClip = "pc" + Math.random().toString(36).slice(2, 8);
  const recorte = !semRecorte && molde && molde.contorno ? molde.contorno : "";
  // Reforço de ombro e etiqueta: fundo de cor sólida.
  if (virtual) {
    const fundo = pecaId === "reforcoOmbro"
      ? prod.reforcoCmyk || moldesConfig.reforcoCmyk || [0, 0, 0, 0]
      : (layoutConfig.pecas.etiquetaTam || {}).fundoCmyk || [0, 0, 0, 0];
    partes.push(`<rect x="0" y="0" width="${n(dim.w)}" height="${n(dim.h)}" fill="${cmykParaCss(fundo)}" />`);
  }
  if (arte && arte.previaUrl && soArte !== "elementos") {
    const c = EPS.caixaArte(arte, base, dim, sangriaDaPrevia());
    partes.push(`<image href="${escAttr(urlPreviaGrande(arte.previaUrl))}" x="${n(c.x)}" y="${n(c.y)}" ` +
      `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="none" />`);
  }

  const fonte = fonteProntaDoTime(time);
  const elementos = EPS.elementosDaPecaNoTime(layoutConfig, prod, pecaId);
  (soArte === true ? [] : elementos).forEach((elGeral) => {
    const ajTime = ajusteDaProducao(prod, pecaId, elGeral.id);
    const el = EPS.elementoDoTime(elGeral, ajTime);
    if (!el) return; // oculto neste time
    const c = EPS.caixaEfetiva(el, tam, base, dim, ajTime);
    if (ehCaixaImagem(el)) {
      const url = imagemDaCaixa(el, prod, pecaId);
      if (url) {
        partes.push(`<image href="${escAttr(urlPreviaGrande(url))}" x="${n(c.x)}" y="${n(c.y)}" ` +
          `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="${EPS.imagemLivre(el) ? "none" : "xMidYMid meet"}"${transformSvgDoElemento(el, c)} />`);
      } else if (comMolde) {
        partes.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" class="previa-caixa" />`);
      }
      return;
    }
    if (fonte) {
      const l = EPS.textoDoElemento(fonte, EPS.textoDoCampo(el, amostra), { w: c.w, h: c.h }, el);
      if (!l.comandos.length) return;
      partes.push(`<g transform="translate(${n(c.x)} ${n(c.y)})">${svgDoTexto(l.comandos, el, 1)}</g>`);
    } else if (comMolde) {
      // Sem a fonte (ainda carregando ou não enviada): a caixa-limite tracejada.
      partes.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" class="previa-caixa" />`);
    }
  });

  // Marcador da costureira (só na prévia "Arte", como vai sair na folha).
  if (comMolde && fonte && tam && molde && pecaId !== "etiquetaTam") {
    const cmds = EPS.marcadorDaPeca(fonte, EPS.textoDoMarcador(time.nome, tam, nomePecaProducao(pecaId)), dim.w, dim.h, pecaId === "gola",
      molde.contorno ? EPS.comandosDoContorno(molde.contorno) : null);
    if (cmds.length) {
      partes.push(`<path d="${caminhoSvg(cmds, 1)}" fill="#000" stroke="#fff" stroke-width="0.5" stroke-linejoin="round" paint-order="stroke" />`);
    }
  }
  let svg = recorte
    ? `<clipPath id="${idClip}"><path d="${escAttr(recorte)}" /></clipPath><g clip-path="url(#${idClip})">${partes.join("")}</g>`
    : partes.join("");
  // Linha de corte por cima: do contorno (a prévia do EPS pode ter fundo
  // branco e taparia a arte); sem contorno, a prévia do molde.
  // A faca tem 3 mm, toda por fora do contorno (como na folha EPS): traço
  // com o dobro da espessura e máscara que esconde a metade de dentro.
  let margem = 0;
  if (comMolde && molde && molde.contorno) {
    margem = FACA_MM;
    const idMasc = "fm" + Math.random().toString(36).slice(2, 8);
    svg += `<mask id="${idMasc}" maskUnits="userSpaceOnUse" x="${-margem - 1}" y="${-margem - 1}" ` +
      `width="${n(dim.w + 2 * margem + 2)}" height="${n(dim.h + 2 * margem + 2)}">` +
      `<rect x="${-margem - 1}" y="${-margem - 1}" width="${n(dim.w + 2 * margem + 2)}" height="${n(dim.h + 2 * margem + 2)}" fill="#fff" />` +
      `<path d="${escAttr(molde.contorno)}" fill="#000" /></mask>` +
      `<path d="${escAttr(molde.contorno)}" fill="none" stroke="#111" stroke-width="${2 * FACA_MM}" stroke-linejoin="round" mask="url(#${idMasc})" />`;
  } else if (comMolde && molde && molde.previaUrl) {
    svg += `<image href="${escAttr(urlPreviaGrande(molde.previaUrl))}" x="0" y="0" ` +
      `width="${n(dim.w)}" height="${n(dim.h)}" preserveAspectRatio="none" />`;
  }
  return { w: dim.w, h: dim.h, svg, contorno: recorte, temArte: !!arte || virtual, margem };
}

// ---------------- Mockup nas fotos base (js/mockup.js) ----------------

// As miniaturas do Drive entram na peça como data: URL — o navegador não
// carrega imagens de fora dentro de um SVG desenhado no canvas, e assim o
// mockup pode ser baixado em PNG.
const dataUrlsDrive = {};
function dataUrlDoDrive(url) {
  const m = /[?&]id=([^&"]+)/.exec(url);
  if (!m || !driveScriptUrl) return Promise.resolve(url);
  const id = m[1];
  if (!dataUrlsDrive[id]) {
    dataUrlsDrive[id] = baixarArquivoDrive(driveScriptUrl, id).then((bytes) => {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      return "data:image/png;base64," + btoa(bin);
    }).catch((e) => {
      delete dataUrlsDrive[id];
      throw e;
    });
  }
  return dataUrlsDrive[id];
}

async function embutirImagens(svg) {
  const hrefs = [...new Set([...svg.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
  let saida = svg;
  for (const h of hrefs) {
    const url = h.replace(/&amp;/g, "&");
    const dados = await dataUrlDoDrive(url).catch(() => url);
    saida = saida.split(`href="${h}"`).join(`href="${dados}"`);
  }
  return saida;
}

// Peça plana (SVG em mm) → canvas com `pxMax` no lado maior.
async function pecaEmCanvas(p, pxMax) {
  const k = pxMax / Math.max(p.w, p.h);
  const W = Math.max(1, Math.round(p.w * k)), H = Math.max(1, Math.round(p.h * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${p.w.toFixed(2)} ${p.h.toFixed(2)}" preserveAspectRatio="none">${await embutirImagens(p.svg)}</svg>`;
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d").drawImage(img, 0, 0, W, H);
  return c;
}

// Cor média (css) do que está desenhado no canvas — para a faixa da gola.
function corMedia(canvas) {
  try {
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 128) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : "";
  } catch (e) {
    return "";
  }
}

// Todas as peças do time prontas para o mockup: { pecaId: { canvas, cor } }.
async function pecasParaMockup(time, timeId, tam, amostra) {
  const saida = {};
  // Nome e número precisam da fonte do time já carregada.
  const f = producaoDoTime(time).fonte;
  if (f && f.partes) {
    const fonte = await obterFonte(f.partes).catch(() => null);
    if (fonte) fontesProntas[chaveArquivoDrive(f.partes)] = fonte;
  }
  for (const id of ["frente", "costas", "mangaEsq", "mangaDir", "gola"]) {
    const p = pecaEmSvg(time, timeId, id, tam, amostra, false, true);
    if (!p || !p.svg) continue;
    const px = id === "frente" || id === "costas" ? 900 : 520;
    const canvas = await pecaEmCanvas(p, px);
    // Só a arte (sem nome/número/brasão), para preencher as bordas das
    // regiões com caixa própria no mockup sem duplicar os textos.
    const soArte = id === "gola" ? null : pecaEmSvg(time, timeId, id, tam, amostra, false, true, true);
    const fundo = soArte && soArte.svg ? await pecaEmCanvas(soArte, px) : null;
    // Só os elementos (fundo transparente), para as regiões com caixa própria.
    const soElem = id === "frente" || id === "costas" ? pecaEmSvg(time, timeId, id, tam, amostra, false, true, "elementos") : null;
    const elementos = soElem && soElem.svg ? await pecaEmCanvas(soElem, px) : null;
    saida[id] = { canvas, fundo, elementos, cor: id === "gola" ? corMedia(canvas) : "" };
  }
  return saida;
}

// ---------------- Prévia para o cliente ----------------
// Quando o time não tem simulação/arte postadas à mão (imagemUrl/arteUrl),
// a página do pedido mostra imagens montadas daqui: mockups Cena, Frente e
// Costas + a arte plana, com "NOME" e "00" de amostra. São PNGs no Drive,
// gravados em time.previaCliente — o cliente só vê as imagens prontas.

const AMOSTRA_CLIENTE = { nomeCamiseta: "NOME", nome: "NOME", numero: "00" };
const previaClienteEstado = {}; // timeId → { gerando, deNovo, erro, timer }

function timeTemImagemPostada(time) {
  return !!(time && (time.imagemUrl || time.arteUrl));
}

function timeTemArteDeProducao(time) {
  const pecas = producaoDoTime(time).pecas || {};
  return !!(pecas.frente || pecas.costas);
}

// Arte plana (sem simulação): as peças recortadas no molde, arrumadas como
// na prévia "Arte" (gola, mangas, frente e costas), em fundo branco.
async function arteDoClienteEmCanvas(time, timeId, tam) {
  const linhas = [["gola"], ["mangaEsq", "mangaDir"], ["frente", "costas"]]
    .map((ids) => ids.map((id) => pecaEmSvg(time, timeId, id, tam, AMOSTRA_CLIENTE, false, false)).filter((p) => p && p.svg))
    .filter((l) => l.length);
  if (!linhas.length) return null;
  const GAP = 20; // mm
  const larguraMm = Math.max(...linhas.map((l) => l.reduce((t, p) => t + p.w, 0) + GAP * (l.length + 1)));
  const alturaMm = linhas.reduce((t, l) => t + Math.max(...l.map((p) => p.h)), 0) + GAP * (linhas.length + 1);
  const k = Math.min(3, 2000 / larguraMm); // px por mm
  const c = document.createElement("canvas");
  c.width = Math.round(larguraMm * k);
  c.height = Math.round(alturaMm * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  let y = GAP;
  for (const l of linhas) {
    const alt = Math.max(...l.map((p) => p.h));
    const larg = l.reduce((t, p) => t + p.w, 0) + GAP * (l.length - 1);
    let x = (larguraMm - larg) / 2;
    for (const p of l) {
      const pc = await pecaEmCanvas(p, Math.max(p.w, p.h) * k);
      ctx.drawImage(pc, x * k, (y + (alt - p.h) / 2) * k, p.w * k, p.h * k);
      x += p.w + GAP;
    }
    y += alt + GAP;
  }
  return c;
}

// ---------------- Mockup 3D (js/mockup3d.js) ----------------
// Carregado só quando é usado (three.js ~600 KB + os modelos). Sem WebGL
// ou com erro, o mockup em foto (js/mockup.js) continua valendo.
const VERSAO_MOCKUP3D = "20261016c";
let promessaMockup3D = null;
function obterMockup3D() {
  if (window.Mockup3D) return Promise.resolve(window.Mockup3D);
  if (!promessaMockup3D) {
    promessaMockup3D = import(new URL("js/mockup3d.js?v=" + VERSAO_MOCKUP3D, document.baseURI).href)
      .then((m) => m.default)
      .catch((e) => { promessaMockup3D = null; throw e; });
  }
  return promessaMockup3D;
}

async function renderizarMockup(vista, pecas) {
  try {
    const M = await obterMockup3D();
    if (M.suportado()) return await M.renderizar(vista, pecas);
  } catch (e) {
    console.warn("Mockup 3D indisponível; usando o mockup em foto.", e);
  }
  return Mockup.renderizar(vista, pecas);
}

function canvasEmJpeg(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), "image/jpeg", 0.88));
}

function canvasEmPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), "image/png"));
}

// Monta e publica a prévia do cliente. Uma geração por time de cada vez; um
// pedido no meio faz rodar de novo no fim (com os dados mais novos).
// Etiqueta "GOLEIRO" gravada na imagem (canto de cima, à esquerda).
function carimbarGoleiro(canvas) {
  const ctx = canvas.getContext("2d");
  const esc = canvas.width / 1024;
  const txt = "GOLEIRO";
  ctx.save();
  ctx.font = `800 ${Math.round(38 * esc)}px "Segoe UI", Arial, sans-serif`;
  const w = ctx.measureText(txt).width + 44 * esc, h = 62 * esc, x = 28 * esc, y = 28 * esc, r = 14 * esc;
  ctx.fillStyle = "rgba(20, 83, 45, 0.92)";
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x + 22 * esc, y + h / 2 + 2 * esc);
  ctx.restore();
  return canvas;
}

// Imagens (Cena, Frente, Costas, Arte) e texturas 3D de uma variante do
// time (a comum ou a do goleiro), enviadas ao Drive.
async function gerarPreviaVariante(timeV, timeId, tam, pref, goleiro) {
  const pecas = await pecasParaMockup(timeV, timeId, tam, AMOSTRA_CLIENTE);
  const saida = {};
  const imagens = ["cena", "frente", "costas"].map((vista) => async () => [vista, await renderizarMockup(vista, pecas)]);
  imagens.push(async () => ["arte", await arteDoClienteEmCanvas(timeV, timeId, tam)]);
  for (const gerar of imagens) {
    const [chave, canvas] = await gerar();
    if (!canvas) continue;
    if (goleiro) carimbarGoleiro(canvas);
    const env = await enviarArquivoDrive(driveScriptUrl, new File([await canvasEmPng(canvas)], chave + ".png", { type: "image/png" }), pref);
    saida[chave] = urlPreviaGrande(env.url);
  }
  // Texturas das peças para o "Ver em 3D" da página do cliente.
  const texturas = { gola: (pecas.gola && pecas.gola.cor) || "" };
  for (const id of ["frente", "costas", "mangaEsq", "mangaDir"]) {
    if (!pecas[id] || !pecas[id].canvas) continue;
    const blob = await canvasEmJpeg(pecas[id].canvas);
    texturas[id] = (await enviarArquivoDrive(driveScriptUrl, new File([blob], "textura-" + id + ".jpg", { type: "image/jpeg" }), pref)).fileId;
  }
  saida.texturas = texturas;
  return saida;
}

async function publicarPreviaCliente(timeId, opcoes) {
  const auto = !!(opcoes && opcoes.automatico);
  const est = previaClienteEstado[timeId] = previaClienteEstado[timeId] || {};
  if (est.gerando) { est.deNovo = true; return; }
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  if (!time) return;
  if (!driveScriptUrl) {
    if (!auto) exigirDriveProducao();
    return;
  }
  if (!timeTemArteDeProducao(time)) {
    if (!auto) alert("Envie ao menos a arte da frente ou das costas do time para montar a prévia.");
    return;
  }
  est.gerando = true;
  est.erro = "";
  atualizarStatusPreviaCliente(timeId);
  try {
    const tam = moldesConfig.tamanhoBase || tamanhoDaPrevia();
    const pref = `${slugify(time.nome) || timeId}-previa-cliente`;
    const previa = { geradaEmMs: Date.now(), ...(await gerarPreviaVariante(time, timeId, tam, pref, false)) };
    // Variante do goleiro (arquivos/ajustes próprios): as mesmas imagens e o
    // 3D, marcados "GOLEIRO".
    if (temVarianteGoleiro(time)) {
      previa.goleiro = await gerarPreviaVariante(timeNaVariante(time, true), timeId, tam, pref + "-goleiro", true);
    }
    await db.collection(COL_TIMES).doc(timeId).update({ previaCliente: previa });
    if (estadoTimes[timeId]) estadoTimes[timeId].time.previaCliente = previa;
  } catch (e) {
    console.error("Prévia do cliente:", e);
    est.erro = e.message || String(e);
    if (!auto) alert("Não foi possível publicar a prévia do cliente: " + est.erro);
  } finally {
    est.gerando = false;
    atualizarStatusPreviaCliente(timeId);
    if (est.deNovo) {
      est.deNovo = false;
      publicarPreviaCliente(timeId, { automatico: true });
    }
  }
}

// Automático: depois de mudar os arquivos/ajustes do time, se ele não tem
// imagens postadas à mão. Espera alguns segundos para juntar vários envios.
function agendarPreviaCliente(timeId) {
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  if (!time || timeTemImagemPostada(time) || !timeTemArteDeProducao(time) || !driveScriptUrl) return;
  const est = previaClienteEstado[timeId] = previaClienteEstado[timeId] || {};
  clearTimeout(est.timer);
  est.timer = setTimeout(() => publicarPreviaCliente(timeId, { automatico: true }), 5000);
}

function textoStatusPreviaCliente(timeId) {
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  const est = previaClienteEstado[timeId] || {};
  if (est.gerando) return "Gerando a prévia do cliente…";
  if (est.erro) return "A última prévia do cliente falhou: " + est.erro;
  const pc = time && time.previaCliente;
  const quando = pc && pc.geradaEmMs
    ? new Date(pc.geradaEmMs).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
  if (timeTemImagemPostada(time)) {
    return "A página do cliente mostra a simulação/arte postadas" + (quando ? ` (a prévia montada de ${quando} fica guardada).` : ".");
  }
  return quando ? `Prévia do cliente publicada em ${quando}${pc.goleiro ? " (com a camiseta do goleiro)" : ""}.` : "A página do cliente ainda não tem prévia.";
}

function atualizarStatusPreviaCliente(timeId) {
  document.querySelectorAll(`[data-previa-cliente-status="${CSS.escape(timeId)}"]`).forEach((el) => {
    el.textContent = textoStatusPreviaCliente(timeId);
  });
  document.querySelectorAll(`[data-publicar-previa="${CSS.escape(timeId)}"]`).forEach((b) => {
    b.disabled = !!(previaClienteEstado[timeId] || {}).gerando;
  });
}

// Bloco completo da prévia: controles + desenho.
function criarPreviaArteTime(timeId, timeComum) {
  // Com o seletor em "Goleiro", a prévia mostra a camiseta do goleiro.
  const time = timeNaVariante(timeComum, editandoGoleiro(timeId));
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
      <div class="segmentado ${previaTime.modo === "mockup" ? "" : "oculto"}" data-so-mockup role="tablist" aria-label="Vista do mockup">
        <button type="button" data-vista="cena" class="${previaTime.vista === "cena" ? "ativo" : ""}">Cena</button>
        <button type="button" data-vista="frente" class="${previaTime.vista === "frente" ? "ativo" : ""}">Frente</button>
        <button type="button" data-vista="costas" class="${previaTime.vista === "costas" ? "ativo" : ""}">Costas</button>
      </div>
      <button type="button" class="secundario ${previaTime.modo === "mockup" ? "" : "oculto"}" data-so-mockup data-girar-3d>${icone("rotate-3d")} Girar 3D</button>
      <button type="button" class="secundario ${previaTime.modo === "mockup" ? "" : "oculto"}" data-so-mockup data-baixar-mockup>${icone("download")} Baixar PNG</button>
    </div>
    <div class="previa-area"></div>
    <p class="pix-ajuda previa-nota"></p>
    <div class="previa-cliente">
      <button type="button" class="secundario" data-publicar-previa="${escAttr(timeId)}">${icone("send")} Publicar prévia para o cliente</button>
      <span class="pix-ajuda" data-previa-cliente-status="${escAttr(timeId)}"></span>
    </div>
    <p class="pix-ajuda">Sem simulação/arte postadas, a página do pedido mostra os mockups (Cena, Frente, Costas) e a arte montados daqui, com "NOME" e "00" — atualizados sozinhos quando os arquivos do time mudam.</p>`;
  const btPublicar = wrap.querySelector("[data-publicar-previa]");
  btPublicar.onclick = () => publicarPreviaCliente(timeId);
  btPublicar.disabled = !!(previaClienteEstado[timeId] || {}).gerando;
  wrap.querySelector("[data-previa-cliente-status]").textContent = textoStatusPreviaCliente(timeId);

  const area = wrap.querySelector(".previa-area");
  const nota = wrap.querySelector(".previa-nota");
  let desenhoMockup = 0;   // descarta desenhos antigos quando algo muda no meio
  let ultimoMockup = null;
  let vivo3d = null;       // visualizador 3D aberto (girar)

  let esperandoFonte = false;
  const desenhar = () => {
    if (vivo3d) { vivo3d.destruir(); vivo3d = null; }
    const tamAtual = tamanhoDaPrevia();
    const prod = producaoDoTime(time);
    // A fonte do time ainda não chegou: desenha de novo quando chegar.
    if (prod.fonte && prod.fonte.partes && !fonteProntaDoTime(time) && !esperandoFonte) {
      esperandoFonte = true;
      obterFonte(prod.fonte.partes).then(() => setTimeout(() => { esperandoFonte = false; desenhar(); }, 0))
        .catch(() => { esperandoFonte = false; });
    }
    const temArquivos = PECAS_PRODUCAO.some((p) => prod.pecas && prod.pecas[p.id]);
    const semFonte = prod.fonte ? "" : " Sem a fonte do time, o nome e o número aparecem só como caixas tracejadas.";

    if (previaTime.modo === "mockup") {
      if (!temArquivos && time.imagemUrl) {
        area.innerHTML = `<figure class="previa-imagem"><img src="${escAttr(time.imagemUrl)}" alt="Simulação enviada" /><figcaption>Simulação enviada (imagem da página do pedido)</figcaption></figure>`;
        nota.textContent = "Envie as artes das peças acima para ver o mockup montado com os arquivos de produção.";
        return;
      }
      const vez = ++desenhoMockup;
      area.innerHTML = '<div class="mockup-carregando">Montando o mockup…</div>';
      nota.textContent = "";
      pecasParaMockup(time, timeId, tamAtual, amostraPrevia)
        .then((pecas) => renderizarMockup(previaTime.vista, pecas))
        .then((canvas) => {
          if (vez !== desenhoMockup) return;
          canvas.className = "mockup-canvas";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Mockup da camiseta de ${time.nome}`);
          area.innerHTML = "";
          area.appendChild(canvas);
          ultimoMockup = canvas;
          nota.textContent = temArquivos
            ? `Simulação em 3D, montada com as artes${tamAtual ? " do tamanho " + tamAtual : ""}. Use "Girar 3D" para ver de todos os lados.`
            : "Ainda sem as artes das peças: o mockup mostra só o nome e o número de teste.";
        })
        .catch((e) => {
          console.error(e);
          if (vez !== desenhoMockup) return;
          area.innerHTML = '<div class="vazio-lista"><p>Não foi possível montar o mockup.</p></div>';
          nota.textContent = e.message || "";
        });
      return;
    }

    const pecas = PECAS_PRODUCAO.concat(pecasVirtuaisDoTime(time).map((id) => ({ id, nome: nomePecaProducao(id) })))
      .map((p) => ({ p, s: pecaEmSvg(time, timeId, p.id, tamAtual, amostraPrevia, true) }))
      .filter((x) => x.s);
    if (pecas.length === 0) {
      area.innerHTML = time.arteUrl
        ? `<figure class="previa-imagem"><img src="${escAttr(time.arteUrl)}" alt="Arte enviada" /><figcaption>Arte enviada (imagem da página do pedido)</figcaption></figure>`
        : '<div class="vazio-lista"><p>Nada para mostrar ainda.</p><p class="pix-ajuda">Envie as artes das peças acima (e os moldes na aba Tamanhos) para ver a prévia.</p></div>';
      nota.textContent = "";
      return;
    }
    // Como a folha do molde: gola em cima, mangas no meio, frente e costas
    // embaixo — todas na MESMA escala (a manga do tamanho certo perto do corpo).
    const linhas = [["gola"], ["mangaEsq", "mangaDir", "detalheMangaEsq", "detalheMangaDir"], ["frente", "costas"], ["reforcoOmbro", "etiquetaTam"]]
      .map((ids) => pecas.filter(({ p }) => ids.includes(p.id)))
      .filter((l) => l.length);
    const larguraTela = Math.max(280, area.clientWidth || 800);
    const larguraLinha = Math.max(...linhas.map((l) => l.reduce((t, { s }) => t + s.w + 2 * s.margem, 0)));
    const alturaTotal = linhas.reduce((t, l) => t + Math.max(...l.map(({ s }) => s.h + 2 * s.margem)), 0);
    const k = Math.min((larguraTela - 60) / larguraLinha, 640 / alturaTotal);
    area.innerHTML = `<div class="previa-pecas previa-pecas-folha">${linhas.map((l) => `<div class="previa-linha">${l.map(({ p, s }) => `
      <figure class="previa-peca">
        <svg viewBox="${-s.margem} ${-s.margem} ${(s.w + 2 * s.margem).toFixed(2)} ${(s.h + 2 * s.margem).toFixed(2)}" style="width:${((s.w + 2 * s.margem) * k).toFixed(0)}px;height:${((s.h + 2 * s.margem) * k).toFixed(0)}px" role="img" aria-label="${escAttr(p.nome)}">${s.svg}</svg>
        <figcaption>${escapeHtmlAdmin(p.nome)}${s.temArte ? "" : ' <span class="badge pendente">sem arte</span>'}</figcaption>
      </figure>`).join("")}</div>`).join("")}</div>`;
    nota.textContent = (tamAtual
      ? `Peças no molde do tamanho ${tamAtual}, com o layout da aba Artes.`
      : "Sem moldes de corte: as artes aparecem no tamanho do arquivo.") + semFonte;
  };

  wrap.querySelectorAll("[data-modo]").forEach((b) => {
    b.onclick = () => {
      previaTime.modo = b.dataset.modo;
      wrap.querySelectorAll("[data-modo]").forEach((x) => x.classList.toggle("ativo", x === b));
      wrap.querySelectorAll("[data-so-mockup]").forEach((x) => x.classList.toggle("oculto", previaTime.modo !== "mockup"));
      desenhar();
    };
  });
  const selTam = wrap.querySelector('[data-previa="tam"]');
  if (selTam) selTam.onchange = () => { previaTime.tam = selTam.value; desenhar(); };
  wrap.querySelectorAll("[data-vista]").forEach((b) => {
    b.onclick = () => {
      previaTime.vista = b.dataset.vista;
      wrap.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("ativo", x === b));
      desenhar();
    };
  });
  wrap.querySelector("[data-girar-3d]").onclick = async () => {
    const vez = ++desenhoMockup;
    if (vivo3d) { vivo3d.destruir(); vivo3d = null; }
    area.innerHTML = '<div class="mockup-carregando">Montando o 3D…</div>';
    try {
      const [M, pecas] = await Promise.all([obterMockup3D(), pecasParaMockup(time, timeId, tamanhoDaPrevia(), amostraPrevia)]);
      if (vez !== desenhoMockup) return;
      if (!M.suportado()) throw new Error("Este navegador não tem WebGL.");
      area.innerHTML = '<div class="mockup-3d-vivo"></div>';
      vivo3d = await M.visualizador(area.firstChild, pecas);
      nota.textContent = "Arraste para girar; use a roda do mouse (ou dois dedos) para aproximar.";
    } catch (e) {
      console.error(e);
      area.innerHTML = '<div class="vazio-lista"><p>Não foi possível abrir o 3D.</p></div>';
      nota.textContent = e.message || "";
    }
  };
  wrap.querySelector("[data-baixar-mockup]").onclick = () => {
    if (!ultimoMockup) return;
    try {
      ultimoMockup.toBlob((blob) => {
        if (blob) baixarBlob(`mockup-${slugify(time.nome) || "time"}-${previaTime.vista}.png`, blob);
      }, "image/png");
    } catch (e) {
      alert("Não foi possível baixar o mockup: " + (e.message || e));
    }
  };
  wrap.querySelectorAll("[data-amostra]").forEach((inp) => {
    inp.oninput = () => { amostraPrevia[inp.dataset.amostra] = inp.value; desenhar(); };
  });

  desenhar();
  return wrap;
}

// ============================================================
// EDITOR DE LAYOUT (aba Artes)
// ============================================================

// O mesmo editor serve à aba Artes (#editorLayout, layout geral ou um time)
// e à aba "Editar arte" do pedido (travado naquele time). Só um desenha por
// vez: o do pedido quando está visível, senão o da aba Artes.
let elEditorLayout = document.getElementById("editorLayout");
let editorPedido = null;    // { container, timeId } da aba "Editar arte"
let editorTravado = false;  // desenhando no pedido?
let layoutModoArtes = "";   // o que a aba Artes estava editando
let layoutModo = "";        // "" = layout geral; timeId = ajuste daquele time
let layoutGoleiro = false;  // no pedido: editando a variante do goleiro?
let layoutTimePrevia = "";  // time cuja arte/fonte aparece na prévia (modo geral)
let layoutPeca = "costas";
let layoutTam = "";
let layoutElSel = "";
let layoutArrastando = false;
let layoutZoom = 1;         // zoom do palco (1 = a peça inteira cabendo)
const amostraLayout = { nomeCamiseta: "JOÃO PEDRO", nome: "João Pedro Silva", numero: "10" };
// Abas do editor: as peças da camiseta e a etiqueta de tamanho (que não tem
// molde EPS: é um retângulo do tamanho definido na própria aba).
const PECAS_EDITOR = PECAS_PRODUCAO.concat([{ id: "etiquetaTam", nome: "Etiqueta" }]);

// Molde de uma peça num tamanho: o EPS da aba Tamanhos ou, no reforço de
// ombro e na etiqueta, o retângulo "virtual".
function moldeDaPecaNoTam(pecaId, tam) {
  if (EPS.PECAS_VIRTUAIS[pecaId]) return EPS.moldeVirtual(moldesConfig, layoutConfig, pecaId, tam);
  return (moldesConfig.pecas[pecaId] || {})[tam] || null;
}

// A amostra do editor com o tamanho e o nome do time (textos da etiqueta).
function amostraComTam(amostra, tam, time) {
  return { ...amostra, tamanho: tam || "", nomeTime: time ? time.nome : "TIME" };
}

// "Ajustar layout deste time": abre a aba "Editar arte" do pedido.
function abrirLayoutDoTime(timeId) {
  if (typeof abrirTimeAdmin === "function") abrirTimeAdmin(timeId, "editarArte");
}

// Chamado pela aba "Editar arte" do pedido: desenha o editor ali.
function montarEditorLayout(container, timeId) {
  container.dataset.editorLayout = "1";
  editorPedido = { container, timeId };
  renderizarEditorLayout();
}

function editorNoPedidoVisivel() {
  const c = editorPedido && editorPedido.container;
  return !!(c && c.isConnected && !c.closest(".oculto") && estadoTimes[editorPedido.timeId]);
}

// Escolhe onde o editor desenha (pedido ou aba Artes) e limpa o outro, para
// não haver dois palcos com os mesmos ids na página.
function escolherAlvoDoEditor() {
  const noPedido = editorNoPedidoVisivel();
  const alvo = noPedido ? editorPedido.container : document.getElementById("editorLayout");
  if (alvo !== elEditorLayout) {
    if (elEditorLayout && elEditorLayout.isConnected) elEditorLayout.innerHTML = "";
    elEditorLayout = alvo;
  }
  if (noPedido) {
    if (!editorTravado) layoutModoArtes = layoutModo;
    layoutModo = editorPedido.timeId;
    layoutTimePrevia = editorPedido.timeId;
    layoutGoleiro = editandoGoleiro(editorPedido.timeId);
  } else {
    if (editorTravado) layoutModo = layoutModoArtes;
    layoutGoleiro = false;
  }
  editorTravado = noPedido;
}

// Trocar de aba principal muda onde o editor aparece (aba Artes ou o
// pedido aberto): redesenha no lugar certo.
document.querySelectorAll(".aba").forEach((aba) =>
  aba.addEventListener("click", () => setTimeout(renderizarEditorLayout, 0)));

// Times que aparecem nos seletores (com o filtro de cliente do topo).
function timesParaLayout() {
  return Object.entries(estadoTimes)
    .filter(([, e]) => !clienteFiltro || timesFiltrados().some(([id]) => estadoTimes[id] === e))
    .sort((a, b) => a[1].time.nome.localeCompare(b[1].time.nome, "pt-BR"));
}

function timeDaPrevia() {
  const id = layoutModo || layoutTimePrevia;
  return id && estadoTimes[id] ? timeNaVariante(estadoTimes[id].time, layoutModo && layoutGoleiro) : null;
}

function tamanhosComMolde(pecaId) {
  if (pecaId === "etiquetaTam") return TODOS_TAMANHOS.slice();
  if (EPS.PECAS_VIRTUAIS[pecaId]) return TODOS_TAMANHOS.filter((t) => moldeDaPecaNoTam(pecaId, t));
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
  if (layoutArrastando) return;
  escolherAlvoDoEditor();
  if (!elEditorLayout) return;
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

  const qtdNaPeca = (id) => ((layoutConfig.pecas[id] && layoutConfig.pecas[id].elementos) || []).length + extrasNoEditor(id).length;
  const nomeTime = layoutModo && estadoTimes[layoutModo] ? escapeHtmlAdmin(estadoTimes[layoutModo].time.nome) : "";
  const ferramenta = (tipo, ic, titulo) =>
    `<button type="button" class="ferramenta" data-add="${tipo}" title="${escAttr(titulo)}" aria-label="${escAttr(titulo)}">${icone(ic)}</button>`;
  elEditorLayout.innerHTML = `
    <div class="estudio">
      <header class="estudio-topo">
        <span class="estudio-titulo">${icone("palette")} ${layoutModo ? nomeTime : "Layout geral"}</span>
        ${editorTravado ? "" : `<label class="campo-inline">Editando
          <select data-l="modo"><option value="">Layout geral (todos os times)</option>${opcTimes(layoutModo)}</select></label>`}
        ${layoutModo ? "" : `<label class="campo-inline">Prévia com a arte de
          <select data-l="previa"><option value="">(nenhum time)</option>${opcTimes(layoutTimePrevia)}</select></label>`}
        <label class="campo-inline">Apelido de teste <input type="text" data-amostra="nomeCamiseta" value="${escAttr(amostraLayout.nomeCamiseta)}" /></label>
        <label class="campo-inline">Nº <input type="text" data-amostra="numero" value="${escAttr(amostraLayout.numero)}" class="input-curto" /></label>
        <span class="estudio-espaco"></span>
        <span class="estudio-historico">
          <button type="button" data-historico="desfazer" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">${icone("undo-2")}</button>
          <button type="button" data-historico="refazer" title="Refazer (Ctrl+Y)" aria-label="Refazer">${icone("redo-2")}</button>
        </span>
        <span id="layoutEstadoSalvar" class="estudio-salvo" aria-live="polite"></span>
        <button type="button" class="botao-acento" data-l="teste" title="Baixa esta peça em EPS com o apelido e o número de teste">${icone("download")} EPS de teste</button>
      </header>
      ${!layoutModo ? "" : `<p class="estudio-aviso${layoutGoleiro ? " goleiro" : ""}">${layoutGoleiro
        ? `${icone("hand")} Editando a camiseta do <strong>goleiro</strong> de <strong>${nomeTime}</strong>. O que não mudar aqui segue a camiseta comum do time.`
        : `${icone("pencil")} Editando <strong>${nomeTime}</strong>: o que mudar ou adicionar aqui vale só para este time. O resto segue o layout geral (aba Artes).`}</p>`}
      <div class="estudio-corpo">
        <div class="estudio-canvas">
          ${`<div class="estudio-ferramentas" role="toolbar" aria-label="${layoutModo ? "Adicionar só neste time" : "Adicionar à peça"}">
            ${layoutPeca === "etiquetaTam" ? `
            ${ferramenta("tamanho", "shirt", "Adicionar o tamanho da camiseta")}
            ${ferramenta("time", "users", "Adicionar o nome do time")}
            ${ferramenta("nome", "type", "Adicionar nome / apelido")}
            ${ferramenta("fixo", "case-upper", "Adicionar texto fixo")}
            ${ferramenta("logo", "tag", "Adicionar logo da empresa")}
            ${ferramenta("brasao", "shield", "Adicionar brasão do time")}` : `
            ${ferramenta("nome", "type", "Adicionar nome")}
            ${ferramenta("numero", "hash", "Adicionar número")}
            ${ferramenta("brasao", "shield", "Adicionar brasão do time")}
            ${ferramenta("logo", "tag", "Adicionar logo da empresa")}
            ${ferramenta("detalhe", "waves", "Adicionar detalhe da manga")}`}
          </div>`}
          <p class="estudio-peca-rotulo">${escapeHtmlAdmin(nomePecaProducao(layoutPeca))}${tam ? ` · ${escapeHtmlAdmin(tam)}${tam === moldesConfig.tamanhoBase ? " (base)" : ""}` : ""}</p>
          <div class="arte-palco-wrap estudio-palco-fundo"><div class="palco-reguas"><svg class="regua regua-h" aria-hidden="true"></svg><svg class="regua regua-v" aria-hidden="true"></svg><div id="layoutPalco" class="arte-palco"></div></div></div>
          <div class="estudio-rodape">
            <nav class="estudio-pecas" role="tablist" aria-label="Peça da camiseta">${PECAS_EDITOR.map((p) =>
              `<button type="button" role="tab" aria-selected="${p.id === layoutPeca}" class="estudio-peca${p.id === layoutPeca ? " ativa" : ""}" data-peca="${p.id}">${escapeHtmlAdmin(p.nome)}${qtdNaPeca(p.id) ? ` <span class="estudio-peca-qtd">${qtdNaPeca(p.id)}</span>` : ""}</button>`).join("")}</nav>
            <span class="estudio-divisor"></span>
            <label class="campo-inline campo-rodape">${icone("ruler")}<select data-l="tam" aria-label="Tamanho">${tamanhosComMolde(layoutPeca).map((t) =>
              `<option value="${escAttr(t)}"${t === tam ? " selected" : ""}>${escapeHtmlAdmin(t)}${t === moldesConfig.tamanhoBase ? " (base)" : ""}</option>`).join("")}</select></label>
            <span class="estudio-zoom">
              <button type="button" data-zoom="-1" title="Diminuir" aria-label="Diminuir">${icone("minus")}</button>
              <button type="button" data-zoom="0" class="estudio-zoom-valor" title="Ajustar à tela">${Math.round(layoutZoom * 100)}%</button>
              <button type="button" data-zoom="1" title="Aumentar" aria-label="Aumentar">${icone("plus")}</button>
            </span>
          </div>
        </div>
        <aside class="arte-painel estudio-painel" id="layoutPainel"></aside>
      </div>
      <p class="estudio-dica">Arraste para mover · alça do canto para redimensionar · <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> movem 1 mm (<kbd>Shift</kbd>: 10 mm) · <kbd>Esc</kbd> solta a seleção</p>
    </div>`;

  elEditorLayout.querySelector('[data-historico="desfazer"]').onclick = desfazerEditor;
  elEditorLayout.querySelector('[data-historico="refazer"]').onclick = refazerEditor;
  atualizarBotoesHistorico();
  if (contaGotasAlvo) elEditorLayout.querySelector(".estudio-palco-fundo").classList.add("modo-conta-gotas");

  // Zoom do palco (100% = a peça inteira cabendo na tela).
  elEditorLayout.querySelectorAll("[data-zoom]").forEach((b) => {
    b.onclick = () => {
      const d = Number(b.dataset.zoom);
      layoutZoom = d === 0 ? 1 : Math.min(3, Math.max(0.5, Math.round((layoutZoom + d * 0.25) * 100) / 100));
      b.closest(".estudio-zoom").querySelector(".estudio-zoom-valor").textContent = Math.round(layoutZoom * 100) + "%";
      renderizarPalcoLayout();
    };
  });
  // Clique no fundo do palco solta a seleção.
  const palcoFundo = elEditorLayout.querySelector(".estudio-palco-fundo");
  // Conta-gotas: lupa com o pixel embaixo do mouse.
  palcoFundo.addEventListener("pointermove", mostrarLupaContaGotas);
  palcoFundo.addEventListener("pointerleave", () => {
    const lupa = document.querySelector(".lupa-conta-gotas");
    if (lupa) lupa.remove();
  });

  palcoFundo.addEventListener("pointerdown", async (ev) => {
    if (contaGotasAlvo) {
      ev.preventDefault();
      const pt = mmDoPonteiro(ev);
      if (!pt) return;
      const chave = contaGotasAlvo;
      estadoSalvarLayout("Lendo a cor…");
      try {
        const hex = await corNoPontoDaPeca(pt.x, pt.y);
        sairContaGotas();
        gravarEstiloElemento(layoutElSel, chave, hexParaCmyk(hex));
        estadoSalvarLayout(`Cor ${hex.toUpperCase()} aplicada`);
      } catch (e) {
        console.warn(e);
        estadoSalvarLayout(e.message || "Não foi possível ler a cor");
      }
      return;
    }
    if (ev.target.closest(".arte-el") || !layoutElSel) return;
    layoutElSel = "";
    renderizarPalcoLayout();
    renderizarPainelLayout();
  });

  const q = (s) => elEditorLayout.querySelector(s);
  if (q('[data-l="modo"]')) q('[data-l="modo"]').onchange = (ev) => {
    layoutModo = ev.target.value;
    layoutModoArtes = layoutModo;
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
  const virtual = !!EPS.PECAS_VIRTUAIS[layoutPeca];
  const moldes = virtual ? {} : moldesConfig.pecas[layoutPeca] || {};
  const molde = moldeDaPecaNoTam(layoutPeca, tam);
  if (!molde) return null;
  const dim = EPS.tamanhoMmDoBbox(molde.bbox);
  // Peça virtual: a mesma caixa em todos os tamanhos (sem base).
  const mb = moldes[moldesConfig.tamanhoBase];
  const base = mb ? EPS.tamanhoMmDoBbox(mb.bbox) : dim;
  const palco = document.getElementById("layoutPalco");
  // O palco fica dentro de uma moldura com 16 px de respiro de cada lado.
  const disp = palco ? palco.parentElement.clientWidth : 0;
  const larguraDisp = Math.min(820, disp > 120 ? disp - 48 : 620);
  const s = Math.min(larguraDisp / dim.w, 620 / dim.h) * layoutZoom;
  return { tam, molde, dim, base, s, ehBase: tam === moldesConfig.tamanhoBase || !mb };
}

function ajusteDaProducao(prod, pecaId, elId) {
  const aj = prod && prod.layoutAjustes;
  return aj && aj[pecaId] && aj[pecaId][elId];
}

// Ajuste que vale no time (na variante do goleiro: o dele por cima do da comum).
function ajusteDoTime(timeId, pecaId, elId, goleiro) {
  const t = timeId && estadoTimes[timeId] && estadoTimes[timeId].time;
  if (!t) return undefined;
  const prod = producaoDoTime(t);
  return ajusteDaProducao(goleiro ? producaoDoGoleiro(prod) : prod, pecaId, elId);
}

// O que vale no editor (time e variante abertos).
function ajusteNoEditor(pecaId, elId) {
  return ajusteDoTime(layoutModo, pecaId, elId, layoutGoleiro);
}

// Só o ajuste próprio do goleiro (sem o da comum), no editor.
function ajusteProprioGoleiro(pecaId, elId) {
  const t = layoutModo && estadoTimes[layoutModo] && estadoTimes[layoutModo].time;
  return layoutGoleiro && t ? ajusteDaProducao(producaoGoleiroPropria(producaoDoTime(t)), pecaId, elId) : undefined;
}

function caixaNoEditor(el, m) {
  return EPS.caixaEfetiva(el, m.tam, m.base, m.dim, ajusteNoEditor(layoutPeca, el.id));
}

function cmykParaCss(c) {
  const [C, M, Y, K] = (c || [0, 0, 0, 100]).map((v) => (Number(v) || 0) / 100);
  return `rgb(${Math.round(255 * (1 - C) * (1 - K))},${Math.round(255 * (1 - M) * (1 - K))},${Math.round(255 * (1 - Y) * (1 - K))})`;
}

// Cor da tela (hex) para CMYK em % — a conta inversa de cmykParaCss, a mesma
// conversão simples usada nas artes (K = 1 − máx(R, G, B)).
function hexParaCmyk(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (x) => Math.round(((1 - x - k) / (1 - k)) * 100);
  return [c(r), c(g), c(b), Math.round(k * 100)];
}

function cmykParaHex(v) {
  const [C, M, Y, K] = (v || [0, 0, 0, 100]).map((x) => (Number(x) || 0) / 100);
  const h = (x) => Math.round(255 * (1 - x) * (1 - K)).toString(16).padStart(2, "0");
  return "#" + h(C) + h(M) + h(Y);
}

// Giro/espelho de uma imagem (brasão, logo, detalhe) no SVG, em volta do
// centro da caixa c (mm) — o mesmo que a folha EPS faz.
function transformSvgDoElemento(el, c, s) {
  const k = s || 1;
  const rot = Number(el.rotacao) || 0;
  if (!rot && !el.espelharH && !el.espelharV) return "";
  const cx = (c.x + c.w / 2) * k, cy = (c.y + c.h / 2) * k;
  return ` transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${rot}) scale(${el.espelharH ? -1 : 1} ${el.espelharV ? -1 : 1}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})"`;
}

// O texto (comandos já prontos) em SVG: sombra, segundo contorno, contorno e
// preenchimento, na mesma ordem da folha EPS. `s` = px por mm.
function svgDoTexto(comandos, el, s) {
  const d = caminhoSvg(comandos, s);
  const c1 = Number(el.contornoMm) || 0, c2 = Number(el.contorno2Mm) || 0;
  let out = "";
  const sombra = EPS.sombraDoElemento(el);
  if (sombra) {
    const cor = cmykParaCss(sombra.cmyk);
    out += `<path transform="translate(${(sombra.dx * s).toFixed(2)} ${(sombra.dy * s).toFixed(2)})" d="${d}" fill="${cor}"` +
      (c1 + c2 > 0 ? ` stroke="${cor}" stroke-width="${((c1 + c2) * 2 * s).toFixed(2)}" stroke-linejoin="round"` : "") + " />";
  }
  if (c2 > 0) out += `<path d="${d}" fill="none" stroke="${cmykParaCss(el.contorno2Cmyk || [0, 0, 0, 100])}" stroke-width="${((c1 + c2) * 2 * s).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" />`;
  if (c1 > 0) out += `<path d="${d}" fill="none" stroke="${cmykParaCss(el.contornoCmyk)}" stroke-width="${(c1 * 2 * s).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" />`;
  return out + `<path d="${d}" fill="${cmykParaCss(el.corCmyk)}" />`;
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

function iconeElementoLayout(el) {
  if (el.tipo === "brasao") return icone("shield");
  if (el.tipo === "logo") return icone("tag");
  if (el.tipo === "detalhe") return icone("waves");
  if (el.tipo === "numero") return icone("hash");
  if (el.campo === "tamanho") return icone("shirt");
  if (el.campo === "time") return icone("users");
  if (el.campo === "fixo") return icone("case-upper");
  return icone("type");
}

function rotuloElementoLayout(el) {
  if (el.tipo === "brasao") return "Brasão";
  if (el.tipo === "logo") return "Logo da empresa";
  if (el.tipo === "detalhe") return "Detalhe da manga";
  if (el.tipo === "numero") return "Número";
  if (el.campo === "tamanho") return "Tamanho";
  if (el.campo === "time") return "Nome do time";
  if (el.campo === "fixo") return "Texto: " + (el.texto || "(vazio)");
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
  desenharReguas(palco, dim, s);
  const time = timeDaPrevia();
  const prod = producaoDoTime(time);

  // Arte do time (por baixo) e o molde por cima (a prévia do molde é
  // transparente, só as linhas).
  if (m.molde.virtual) {
    const fundo = ((layoutConfig.pecas.etiquetaTam || {}).fundoCmyk) || [0, 0, 0, 0];
    palco.insertAdjacentHTML("beforeend",
      `<div class="layout-fundo-etiqueta" style="position:absolute;inset:0;background:${cmykParaCss(fundo)}"></div>`);
  }
  const adEd = m.molde.virtual ? null : EPS.arteDaPeca(prod, layoutPeca);
  const arte = adEd && adEd.arte;
  if (arte && arte.previaUrl) {
    const c = EPS.caixaArte(arte, base, dim, sangriaDaPrevia());
    // Recortada no formato do molde, como vai sair na folha.
    const idClip = "lc" + Math.random().toString(36).slice(2, 8);
    const clip = m.molde.contorno ? `<clipPath id="${idClip}"><path d="${escAttr(m.molde.contorno)}" /></clipPath>` : "";
    palco.insertAdjacentHTML("beforeend",
      `<svg class="layout-arte" viewBox="0 0 ${dim.w.toFixed(2)} ${dim.h.toFixed(2)}" preserveAspectRatio="none"
        style="left:0;top:0;width:${dim.w * s}px;height:${dim.h * s}px">${clip}
        <image href="${escAttr(urlPreviaGrande(arte.previaUrl))}" x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}"
          width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" preserveAspectRatio="none"${clip ? ` clip-path="url(#${idClip})"` : ""} /></svg>`);
  }
  if (m.molde.contorno) {
    palco.insertAdjacentHTML("beforeend",
      `<svg class="arte-palco-molde" viewBox="0 0 ${dim.w.toFixed(2)} ${dim.h.toFixed(2)}" preserveAspectRatio="none">` +
      `<path d="${escAttr(m.molde.contorno)}" fill="none" stroke="#111" stroke-width="${(1.2 / s).toFixed(2)}" stroke-linejoin="round" /></svg>`);
  } else if (m.molde.previaUrl) {
    palco.insertAdjacentHTML("beforeend",
      `<img class="arte-palco-molde" src="${escAttr(urlPreviaGrande(m.molde.previaUrl))}" alt="" draggable="false" />`);
  }

  const fonte = fonteProntaDoTime(time);
  elementosNoEditor().forEach((elGeral) => {
    const ajTime = ehExtra(elGeral.id) ? undefined : ajusteNoEditor(layoutPeca, elGeral.id);
    // Oculto neste time: aparece apagado (dá para selecionar e mostrar de novo).
    const el = EPS.elementoDoTime(elGeral, ajTime) || elGeral;
    const oculto = !!(ajTime && ajTime.oculto);
    const c = caixaNoEditor(el, m);
    const div = document.createElement("div");
    const temAjusteTime = !!ajTime;
    div.className = "arte-el arte-el-" + el.tipo + (el.id === layoutElSel ? " selecionado" : "") +
      (temAjusteTime ? " ajuste-time" : "") + (oculto ? " oculto-time" : "");
    div.dataset.id = elGeral.id;
    div.dataset.rotulo = rotuloElementoLayout(el) + (oculto ? " (oculto)" : "");
    div.style.left = c.x * s + "px";
    div.style.top = c.y * s + "px";
    div.style.width = c.w * s + "px";
    div.style.height = c.h * s + "px";
    if (ehCaixaImagem(el)) {
      const url = imagemDaCaixa(el, prod, layoutPeca);
      div.innerHTML = url
        ? `<img src="${escAttr(urlPreviaGrande(url))}" alt="" draggable="false" style="object-fit:${EPS.imagemLivre(el) ? "fill" : "contain"}" />`
        : `<span class="arte-el-rotulo">${el.tipo === "logo" ? "Logo<br>(envie em Configurações)" : el.tipo === "detalhe" ? "Detalhe da manga" : "Brasão"}</span>`;
    } else if (fonte) {
      // Sem o giro: quem gira é a caixa inteira (a div), com a seleção junto.
      const l = EPS.textoDoElemento(fonte, EPS.textoDoCampo(el, amostraComTam(amostraLayout, m.tam, time)), { w: c.w, h: c.h }, el, { semGiro: true });
      div.innerHTML = `<svg class="arte-el-svg" width="${c.w * s}" height="${c.h * s}" overflow="visible">` +
        `${svgDoTexto(l.comandos, el, s)}</svg>`;
    } else {
      div.innerHTML = `<span class="arte-el-rotulo">${escapeHtmlAdmin(rotuloElementoLayout(el))}${time ? "" : "<br>(escolha um time para ver a fonte)"}</span>`;
    }
    // Giro e espelho: a caixa inteira gira (texto, imagem e seleção).
    const rot = Number(el.rotacao) || 0;
    if (rot || el.espelharH || el.espelharV) {
      div.style.transform = `rotate(${rot}deg)`;
      const alvoEsp = div.querySelector("svg, img");
      if (alvoEsp && (el.espelharH || el.espelharV)) alvoEsp.style.transform = `scale(${el.espelharH ? -1 : 1}, ${el.espelharV ? -1 : 1})`;
    }
    if (el.travado) div.classList.add("travado");
    const alca = document.createElement("span");
    alca.className = "arte-el-alca";
    div.appendChild(alca);
    const alcaGiro = document.createElement("span");
    alcaGiro.className = "arte-el-giro";
    alcaGiro.title = "Girar (Shift: de 15 em 15°)";
    div.appendChild(alcaGiro);
    ligarArrasteLayout(div, alca, elGeral, alcaGiro);
    palco.appendChild(div);
  });
}

// Setas do teclado: movem o elemento selecionado 1 mm (Shift: 10 mm). O
// desenho acompanha na hora; grava uma vez só, quando as teclas param.
let empurraoLayout = null; // { elId, m, caixa, timer }

function editorLayoutVisivel() {
  return !!(elEditorLayout && elEditorLayout.isConnected && !elEditorLayout.closest(".oculto") &&
    elEditorLayout.querySelector("#layoutPalco"));
}

function empurrarSelecionado(dx, dy) {
  const el = elementosNoEditor().find((e) => e.id === layoutElSel);
  const m = medidasLayout();
  if (!el || !m) return;
  if (!empurraoLayout || empurraoLayout.elId !== el.id) {
    empurraoLayout = { elId: el.id, m, caixa: caixaNoEditor(el, m) };
  }
  const e = empurraoLayout;
  e.caixa = { ...e.caixa, x: e.caixa.x + dx, y: e.caixa.y + dy };
  const div = elEditorLayout.querySelector(`.arte-el[data-id="${CSS.escape(el.id)}"]`);
  if (div) {
    div.style.left = e.caixa.x * m.s + "px";
    div.style.top = e.caixa.y * m.s + "px";
  }
  const campoX = elEditorLayout.querySelector('[data-cx="x"]');
  const campoY = elEditorLayout.querySelector('[data-cx="y"]');
  if (campoX) campoX.value = e.caixa.x.toFixed(1);
  if (campoY) campoY.value = e.caixa.y.toFixed(1);
  clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    empurraoLayout = null;
    gravarCaixaLayout(el, e.m, e.caixa);
    renderizarPalcoLayout();
    renderizarPainelLayout();
  }, 450);
}

// ---------------- Operações de elemento (atalhos e botões) ----------------
let elementoCopiado = null; // Ctrl+C (só no layout geral)

// ---------------- Elementos só do time (no "Editar arte" do pedido) ----------------
// Além de ajustar os do layout geral, o pedido pode ter elementos próprios:
// producao.elementosExtras[pecaId] (no goleiro, producao.goleiro.elementosExtras,
// que substitui a lista da camiseta comum naquela peça).

// Os extras que valem no editor (time e variante abertos), só leitura.
function extrasNoEditor(pecaId) {
  if (!layoutModo) return [];
  const t = timeDaPrevia();
  return ((producaoDoTime(t).elementosExtras) || {})[pecaId || layoutPeca] || [];
}

function ehExtra(elId) {
  return extrasNoEditor().some((e) => e.id === elId);
}

// Todos os elementos da peça aberta no editor: os gerais e, no pedido, os do time.
function elementosNoEditor() {
  return elementosDaPeca(layoutPeca).concat(extrasNoEditor());
}

// Muda a lista de extras da peça aberta e grava no time (com desfazer).
function mudarExtrasTime(mudar) {
  const time = estadoTimes[layoutModo] && estadoTimes[layoutModo].time;
  if (!time) return Promise.resolve();
  const antes = JSON.stringify(producaoDoTime(time));
  const prod = limparParaFirestore(producaoDoTime(time));
  const alvo = layoutGoleiro ? (prod.goleiro = prod.goleiro || {}) : prod;
  alvo.elementosExtras = alvo.elementosExtras || {};
  if (!alvo.elementosExtras[layoutPeca]) {
    // Goleiro mexendo pela primeira vez: parte da lista da camiseta comum.
    alvo.elementosExtras[layoutPeca] = layoutGoleiro
      ? limparParaFirestore(((prod.elementosExtras || {})[layoutPeca]) || []) : [];
  }
  mudar(alvo.elementosExtras[layoutPeca]);
  if (!alvo.elementosExtras[layoutPeca].length && !layoutGoleiro) delete alvo.elementosExtras[layoutPeca];
  if (!Object.keys(alvo.elementosExtras).length) delete alvo.elementosExtras;
  if (layoutGoleiro) limparGoleiroVazio(prod);
  registrarHistorico({ tipo: "time", timeId: layoutModo, antes, depois: JSON.stringify(prod) });
  return gravarProducaoTime(layoutModo, prod)
    .then(() => estadoSalvarLayout(layoutGoleiro ? "✓ Salvo no goleiro" : "✓ Salvo no time"))
    .catch((e) => { console.error(e); estadoSalvarLayout("⚠️ Erro ao salvar"); });
}

// Muda um extra (pelo id) e grava.
function mudarExtra(elId, mudar) {
  return mudarExtrasTime((lista) => {
    const e = lista.find((x) => x.id === elId);
    if (e) mudar(e);
  });
}

function elementoSelecionado() {
  return elementosNoEditor().find((e) => e.id === layoutElSel) || null;
}

function duplicarElementoLayout(el, deslocar) {
  // No pedido, a cópia leva o que vale no time (posição e estilo próprios).
  const base = layoutModo && !ehExtra(el.id) ? elementoNoEditor(el) : el;
  const copia = limparParaFirestore(base);
  copia.id = novoIdLayout("e");
  const d = deslocar == null ? 10 : deslocar;
  const m = medidasLayout();
  const caixaBase = layoutModo && m && !ehExtra(el.id)
    ? caixaNoEditor(el, { ...m, tam: moldesConfig.tamanhoBase || m.tam, dim: m.base })
    : copia.caixa;
  copia.caixa = { ...caixaBase, x: arred1(caixaBase.x + d), y: arred1(caixaBase.y + d) };
  delete copia.ajustes;
  delete copia.travado;
  layoutElSel = copia.id;
  if (layoutModo) {
    mudarExtrasTime((lista) => lista.push(copia)).then(() => renderizarEditorLayout());
    return;
  }
  elementosDaPeca(layoutPeca).push(copia);
  salvarLayout(true);
  renderizarEditorLayout();
}

function excluirElementoLayout(el) {
  if (layoutModo) {
    if (ehExtra(el.id)) {
      layoutElSel = "";
      mudarExtrasTime((lista) => lista.splice(lista.findIndex((x) => x.id === el.id), 1))
        .then(() => { estadoSalvarLayout("Excluído — Ctrl+Z desfaz"); renderizarEditorLayout(); });
    } else {
      // Do layout geral não se apaga no pedido: oculta só neste time.
      gravarAjusteTime(el.id, (a) => { a.oculto = true; }).then(() => { renderizarPalcoLayout(); renderizarPainelLayout(); });
      estadoSalvarLayout("Oculto neste time — Ctrl+Z desfaz");
    }
    return;
  }
  const els = elementosDaPeca(layoutPeca);
  const i = els.indexOf(el);
  if (i < 0) return;
  els.splice(i, 1);
  layoutElSel = "";
  salvarLayout(true);
  estadoSalvarLayout("Excluído — Ctrl+Z desfaz");
  renderizarEditorLayout();
}

// Ordem das camadas: o fim da lista fica por cima. `para`: "frente",
// "tras", "topo" ou "fundo".
function moverCamadaLayout(el, para) {
  const mover = (els, i) => {
    const [item] = els.splice(i, 1);
    const j = para === "topo" ? els.length : para === "fundo" ? 0
      : para === "frente" ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
    els.splice(j, 0, item);
  };
  if (layoutModo) {
    // No pedido, a ordem é entre os elementos do time (que ficam por cima).
    if (ehExtra(el.id)) {
      mudarExtrasTime((lista) => mover(lista, lista.findIndex((x) => x.id === el.id)))
        .then(() => { renderizarPalcoLayout(); renderizarPainelLayout(); });
    }
    return;
  }
  const els = elementosDaPeca(layoutPeca);
  const i = els.indexOf(el);
  if (i < 0) return;
  mover(els, i);
  salvarLayout(true);
  renderizarPalcoLayout();
  renderizarPainelLayout();
}

document.addEventListener("keydown", (ev) => {
  if (!editorLayoutVisivel() || ev.altKey) return;
  const alvo = ev.target;
  if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "SELECT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
  if (document.querySelector(".modal-pix:not(.oculto), .lightbox:not(.oculto)")) return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  const tecla = ev.key.toLowerCase();
  const el = elementoSelecionado();

  if (ctrl && tecla === "z") { ev.preventDefault(); (ev.shiftKey ? refazerEditor : desfazerEditor)(); return; }
  if (ctrl && tecla === "y") { ev.preventDefault(); refazerEditor(); return; }
  if (ctrl && tecla === "c" && el) {
    elementoCopiado = limparParaFirestore(layoutModo ? elementoNoEditor(el) : el);
    estadoSalvarLayout("Copiado — Ctrl+V cola");
    return;
  }
  if (ctrl && tecla === "v" && elementoCopiado) { ev.preventDefault(); duplicarElementoLayout(elementoCopiado); return; }
  if (ctrl && tecla === "d" && el) { ev.preventDefault(); duplicarElementoLayout(el); return; }
  if (ctrl) return;

  if (ev.key === "Escape") {
    if (contaGotasAlvo) { sairContaGotas(); return; }
    if (layoutElSel) { layoutElSel = ""; renderizarPalcoLayout(); renderizarPainelLayout(); }
    return;
  }
  if ((ev.key === "Delete" || ev.key === "Backspace") && el) {
    ev.preventDefault();
    excluirElementoLayout(el);
    return;
  }
  const passos = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!passos[ev.key] || !el) return;
  ev.preventDefault();
  if (elementoNoEditor(el).travado) { estadoSalvarLayout("Elemento travado"); return; }
  const k = ev.shiftKey ? 10 : 1;
  empurrarSelecionado(passos[ev.key][0] * k, passos[ev.key][1] * k);
});

// ---------------- Conta-gotas: pega a cor de um ponto da arte ----------------
// Clique no conta-gotas e depois num ponto do desenho: a cor daquele ponto
// (arte, brasão, logo ou texto, como aparece na prévia) vai para o campo.
let contaGotasAlvo = ""; // estilo que vai receber a cor ("corCmyk", ...)

let contaGotasDesenho = null; // Promise do canvas da peça (alta resolução)

function entrarContaGotas(chave) {
  contaGotasAlvo = chave;
  contaGotasDesenho = desenharPecaParaContaGotas();
  contaGotasDesenho.catch(() => {});
  const fundo = elEditorLayout && elEditorLayout.querySelector(".estudio-palco-fundo");
  if (fundo) fundo.classList.add("modo-conta-gotas");
  document.querySelectorAll("[data-conta-gotas]").forEach((b) => b.classList.toggle("ativo", b.dataset.contaGotas === chave));
  estadoSalvarLayout("Conta-gotas: passe o mouse na arte e clique no pixel (Esc cancela)");
}

function sairContaGotas() {
  contaGotasAlvo = "";
  contaGotasDesenho = null;
  const fundo = elEditorLayout && elEditorLayout.querySelector(".estudio-palco-fundo");
  if (fundo) fundo.classList.remove("modo-conta-gotas");
  const lupa = document.querySelector(".lupa-conta-gotas");
  if (lupa) lupa.remove();
  document.querySelectorAll("[data-conta-gotas]").forEach((b) => b.classList.remove("ativo"));
  estadoSalvarLayout("");
}

// A peça como aparece no palco (arte recortada no molde, brasão, logo e
// textos), desenhada num canvas grande: cada pixel da tela cai num pixel
// próprio do desenho, sem misturar com os vizinhos.
async function desenharPecaParaContaGotas() {
  const m = medidasLayout();
  const time = timeDaPrevia();
  const p = time && m && pecaEmSvg(time, layoutModo || layoutTimePrevia, layoutPeca, m.tam, amostraLayout, false, false);
  if (!p) throw new Error("Escolha um time com arte (\"Prévia com a arte de\") para pegar a cor da arte.");
  const canvas = await pecaEmCanvas(p, 3000);
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }), k: canvas.width / p.w };
}

// Pixel (hex e alfa) do desenho num ponto da peça, em mm.
function pixelDoDesenho(d, xMm, yMm) {
  const px = Math.min(d.canvas.width - 1, Math.max(0, Math.floor(xMm * d.k)));
  const py = Math.min(d.canvas.height - 1, Math.max(0, Math.floor(yMm * d.k)));
  const v = d.ctx.getImageData(px, py, 1, 1).data;
  return { px, py, alfa: v[3], hex: "#" + [v[0], v[1], v[2]].map((c) => c.toString(16).padStart(2, "0")).join("") };
}

// Ponto do mouse → mm da peça.
function mmDoPonteiro(ev) {
  const palco = document.getElementById("layoutPalco");
  const m = medidasLayout();
  if (!palco || !m) return null;
  const r = palco.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / m.s, y: (ev.clientY - r.top) / m.s };
}

async function corNoPontoDaPeca(xMm, yMm) {
  const d = await (contaGotasDesenho || desenharPecaParaContaGotas());
  const px = pixelDoDesenho(d, xMm, yMm);
  if (px.alfa < 10) throw new Error("Nesse ponto não há arte (é o fundo). Clique em cima do desenho.");
  return px.hex;
}

// Lupa que acompanha o mouse: mostra os pixels em volta, ampliados, com o
// pixel que vai ser pego marcado no meio, e o código da cor.
async function mostrarLupaContaGotas(ev) {
  if (!contaGotasAlvo || !contaGotasDesenho) return;
  const pt = mmDoPonteiro(ev);
  let lupa = document.querySelector(".lupa-conta-gotas");
  if (!lupa) {
    lupa = document.createElement("div");
    lupa.className = "lupa-conta-gotas";
    lupa.innerHTML = '<canvas width="99" height="99"></canvas><span class="lupa-cor"><i></i><b></b></span>';
    document.body.appendChild(lupa);
  }
  lupa.style.left = ev.clientX + 18 + "px";
  lupa.style.top = ev.clientY + 18 + "px";
  let d;
  try { d = await contaGotasDesenho; } catch (e) { lupa.remove(); estadoSalvarLayout(e.message); return; }
  if (!pt || !contaGotasAlvo) return;
  const px = pixelDoDesenho(d, pt.x, pt.y);
  const c = lupa.querySelector("canvas").getContext("2d");
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, 99, 99);
  // 11 × 11 pixels, cada um com 9 × 9 na lupa.
  c.drawImage(d.canvas, px.px - 5, px.py - 5, 11, 11, 0, 0, 99, 99);
  c.strokeStyle = "#ff5b22";
  c.lineWidth = 2;
  c.strokeRect(45, 45, 9, 9);
  lupa.querySelector("i").style.background = px.alfa < 10 ? "transparent" : px.hex;
  lupa.querySelector("b").textContent = px.alfa < 10 ? "sem arte" : px.hex.toUpperCase();
}

// Réguas em mm em cima e à esquerda do palco (traço a cada 10 mm, número a cada 50).
function desenharReguas(palco, dim, s) {
  const caixa = palco.parentElement;
  const rh = caixa && caixa.querySelector(".regua-h");
  const rv = caixa && caixa.querySelector(".regua-v");
  if (!rh || !rv) return;
  const passo = s * 10 < 6 ? 50 : 10;
  const marcas = (total, vertical) => {
    let out = "";
    for (let v = 0; v <= total + 0.01; v += passo) {
      const p = (v * s).toFixed(1), grande = v % 50 === 0;
      const t = grande ? 9 : 5;
      out += vertical
        ? `<line x1="${16 - t}" y1="${p}" x2="16" y2="${p}" />` + (grande && v ? `<text x="2" y="${p}" transform="rotate(-90 7 ${p})">${v}</text>` : "")
        : `<line x1="${p}" y1="${16 - t}" x2="${p}" y2="16" />` + (grande && v ? `<text x="${Number(p) + 2}" y="8">${v}</text>` : "");
    }
    return out;
  };
  rh.setAttribute("width", (dim.w * s).toFixed(0));
  rh.setAttribute("height", "16");
  rh.innerHTML = marcas(dim.w, false);
  rv.setAttribute("width", "16");
  rv.setAttribute("height", (dim.h * s).toFixed(0));
  rv.innerHTML = marcas(dim.h, true);
}

// Arrastar (mover) e a alça do canto (redimensionar). O brasão mantém a
// proporção; as caixas de texto são livres (são o limite do texto).
function ligarArrasteLayout(div, alca, el, alcaGiro) {
  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || contaGotasAlvo) return; // conta-gotas: quem trata é o palco
    ev.preventDefault();
    ev.stopPropagation();
    if (layoutElSel !== el.id) {
      layoutElSel = el.id;
      document.querySelectorAll("#layoutPalco .arte-el").forEach((d) => d.classList.toggle("selecionado", d === div));
      renderizarPainelLayout();
    }
    const elT = elementoNoEditor(el);
    if (elT.travado) {
      estadoSalvarLayout("Elemento travado — destrave no cadeado para mexer");
      return;
    }
    const m = medidasLayout();
    const ini = caixaNoEditor(el, m);
    const x0 = ev.clientX, y0 = ev.clientY;
    const prop = ini.w / ini.h;
    let atual = { ...ini };
    layoutArrastando = true;
    div.setPointerCapture(ev.pointerId);

    // Girar pela alça de cima: ângulo do centro até o ponteiro.
    if (ev.target === alcaGiro) {
      const r = div.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let graus = Number(elT.rotacao) || 0;
      const mover = (e) => {
        graus = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        if (e.shiftKey) graus = Math.round(graus / 15) * 15;
        graus = Math.round(((graus % 360) + 540) % 360 - 180);
        div.style.transform = `rotate(${graus}deg)`;
        estadoSalvarLayout(`Girando: ${graus}°`);
      };
      const soltar = () => {
        div.removeEventListener("pointermove", mover);
        div.removeEventListener("pointerup", soltar);
        div.removeEventListener("pointercancel", soltar);
        layoutArrastando = false;
        gravarEstiloElemento(el.id, "rotacao", graus);
      };
      div.addEventListener("pointermove", mover);
      div.addEventListener("pointerup", soltar);
      div.addEventListener("pointercancel", soltar);
      return;
    }

    const redimensionar = ev.target === alca;
    // Guias magnéticas: bordas e centro da peça e dos outros elementos.
    const palco = document.getElementById("layoutPalco");
    const alvos = { x: [0, m.dim.w / 2, m.dim.w], y: [0, m.dim.h / 2, m.dim.h] };
    elementosNoEditor().forEach((o) => {
      if (o.id === el.id) return;
      const oT = EPS.elementoDoTime(o, ajusteNoEditor(layoutPeca, o.id));
      if (!oT) return;
      const c = caixaNoEditor(o, m);
      alvos.x.push(c.x, c.x + c.w / 2, c.x + c.w);
      alvos.y.push(c.y, c.y + c.h / 2, c.y + c.h);
    });
    const tolerancia = 6 / m.s; // 6 px na tela, em mm
    const guias = [];
    const limparGuias = () => { guias.forEach((g) => g.remove()); guias.length = 0; };
    const guia = (eixo, valor) => {
      const g = document.createElement("div");
      g.className = "guia-" + eixo;
      if (eixo === "v") g.style.left = valor * m.s + "px";
      else g.style.top = valor * m.s + "px";
      palco.appendChild(g);
      guias.push(g);
    };
    const encaixar = (pontos, lista) => {
      let melhor = null;
      pontos.forEach((p) => lista.forEach((l) => {
        const d = l - p;
        if (Math.abs(d) <= tolerancia && (!melhor || Math.abs(d) < Math.abs(melhor.d))) melhor = { d, l };
      }));
      return melhor;
    };

    const mover = (e) => {
      const dx = (e.clientX - x0) / m.s, dy = (e.clientY - y0) / m.s;
      limparGuias();
      if (redimensionar) {
        const w = Math.max(2, ini.w + dx);
        // Imagem com proporção travada acompanha a largura; livre, estica.
        const livre = EPS.imagemLivre(elT);
        atual = { x: ini.x, y: ini.y, w, h: ehCaixaImagem(el) && !livre ? w / prop : Math.max(2, ini.h + dy) };
      } else {
        atual = { x: ini.x + dx, y: ini.y + dy, w: ini.w, h: ini.h };
        if (!e.altKey) {
          const sx = encaixar([atual.x, atual.x + atual.w / 2, atual.x + atual.w], alvos.x);
          const sy = encaixar([atual.y, atual.y + atual.h / 2, atual.y + atual.h], alvos.y);
          if (sx) { atual.x += sx.d; guia("v", sx.l); }
          if (sy) { atual.y += sy.d; guia("h", sy.l); }
        }
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
      limparGuias();
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

// O elemento como vale no editor (no time: com o estilo próprio dele).
function elementoNoEditor(el) {
  return layoutModo ? (EPS.elementoDoTime(el, ajusteNoEditor(layoutPeca, el.id)) || el) : el;
}

// Grava um estilo (cor, giro, efeito, travado...) de um elemento da peça
// aberta: no layout geral muda o elemento; no time, o estilo próprio dele.
function gravarEstiloElemento(elId, k, v) {
  const el = elementosNoEditor().find((e) => e.id === elId);
  if (!el) return Promise.resolve();
  const redesenhar = () => { renderizarPalcoLayout(); renderizarPainelLayout(); };
  if (layoutModo && ehExtra(elId)) {
    return mudarExtra(elId, (e) => { e[k] = v; }).then(redesenhar);
  }
  if (layoutModo) {
    return gravarAjusteTime(el.id, (a) => { a.estilo = { ...(a.estilo || {}), [k]: v }; }).then(redesenhar);
  }
  el[k] = v;
  salvarLayout();
  redesenhar();
  return Promise.resolve();
}

// Grava a caixa onde ela deve ir: no layout geral (tamanho base = posição do
// elemento; outro tamanho = ajuste daquele tamanho) ou no ajuste do time.
function gravarCaixaLayout(el, m, caixa) {
  const c = { x: arred1(caixa.x), y: arred1(caixa.y), w: arred1(caixa.w), h: arred1(caixa.h) };
  if (layoutModo && ehExtra(el.id)) {
    // Elemento só do time: muda a caixa dele mesmo (base ou o tamanho).
    mudarExtra(el.id, (e) => {
      if (m.ehBase) e.caixa = c;
      else {
        e.ajustes = e.ajustes || {};
        e.ajustes[m.tam] = c;
      }
    });
    return;
  }
  if (layoutModo) {
    const time = estadoTimes[layoutModo].time;
    const antes = JSON.stringify(producaoDoTime(time));
    const prod = limparParaFirestore(producaoDoTime(time));
    const alvo = layoutGoleiro ? (prod.goleiro = prod.goleiro || {}) : prod;
    alvo.layoutAjustes = alvo.layoutAjustes || {};
    const porPeca = alvo.layoutAjustes[layoutPeca] = alvo.layoutAjustes[layoutPeca] || {};
    const aj = porPeca[el.id] = porPeca[el.id] || {};
    // Primeira mudança de posição do goleiro: parte da posição da comum (a
    // posição vale inteira de um ou do outro — ver mesclarAjusteGoleiro).
    if (layoutGoleiro && !aj.base && !aj.tamanhos) {
      const daComum = ajusteDaProducao(producaoDoTime(time), layoutPeca, el.id) || {};
      if (daComum.base) aj.base = limparParaFirestore(daComum.base);
      if (daComum.tamanhos) aj.tamanhos = limparParaFirestore(daComum.tamanhos);
    }
    if (m.ehBase) aj.base = c;
    else {
      aj.tamanhos = aj.tamanhos || {};
      aj.tamanhos[m.tam] = c;
    }
    registrarHistorico({ tipo: "time", timeId: layoutModo, antes, depois: JSON.stringify(prod) });
    gravarProducaoTime(layoutModo, prod).then(() => estadoSalvarLayout(layoutGoleiro ? "✓ Salvo no goleiro" : "✓ Salvo no time"))
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
  // Etiqueta: textos em faixas; logo e brasão num canto.
  const naEtiqueta = layoutPeca === "etiquetaTam";
  const campoEtiqueta = { tamanho: "tamanho", time: "time", fixo: "fixo" }[tipo];
  if (campoEtiqueta) tipo = "texto";
  const caixa = naEtiqueta
    ? (tipo === "logo" || tipo === "brasao"
      ? { x: tipo === "logo" ? b.w * 0.04 : b.w * 0.96 - b.h * 0.36, y: b.h * 0.26, w: b.h * 0.36, h: b.h * 0.36 }
      : campoEtiqueta === "tamanho" ? { x: b.w * 0.3, y: b.h * 0.26, w: b.w * 0.4, h: b.h * 0.34 }
        : campoEtiqueta === "time" ? { x: b.w * 0.08, y: b.h * 0.06, w: b.w * 0.84, h: b.h * 0.13 }
          : campoEtiqueta === "fixo" ? { x: b.w * 0.08, y: b.h * 0.85, w: b.w * 0.84, h: b.h * 0.08 }
            : { x: b.w * 0.08, y: b.h * 0.67, w: b.w * 0.84, h: b.h * 0.12 })
    : tipo === "numero" ? { x: b.w * 0.3, y: b.h * 0.3, w: b.w * 0.4, h: b.h * 0.28 }
    : tipo === "nome" ? { x: b.w * 0.2, y: b.h * 0.18, w: b.w * 0.6, h: b.h * 0.07 }
      : tipo === "logo" ? caixaLogoInicial(b)
        : tipo === "detalhe" ? caixaDetalheInicial(b)
        : { x: b.w * 0.6, y: b.h * 0.15, w: b.w * 0.18, h: b.w * 0.2 };
  ["x", "y", "w", "h"].forEach((k) => (caixa[k] = arred1(caixa[k])));
  const el = { id: novoIdLayout("e"), tipo, caixa };
  if (tipo !== "brasao" && tipo !== "logo" && tipo !== "detalhe") {
    Object.assign(el, {
      campo: campoEtiqueta || (tipo === "nome" ? "nomeCamiseta" : "numero"),
      ...(campoEtiqueta === "fixo" ? { texto: "TEXTO" } : {}),
      corCmyk: [0, 0, 0, 100], contornoMm: 0, contornoCmyk: [0, 0, 0, 0],
      alinhamento: "centro", ajuste: "encolher", maiusculas: true, espacamento: 0, usarNomeSeVazio: true
    });
  }
  layoutElSel = el.id;
  if (layoutModo) {
    mudarExtrasTime((lista) => lista.push(el)).then(() => renderizarEditorLayout());
    return;
  }
  elementosDaPeca(layoutPeca).push(el);
  salvarLayout(true);
  renderizarEditorLayout();
}

// Medidas e fundo da etiqueta de tamanho (layout geral, vale para todos).
function renderizarPainelEtiqueta() {
  const box = document.getElementById("layoutPainelEl");
  if (!box) return;
  const cfg = layoutConfig.pecas.etiquetaTam || {};
  const med = EPS.medidasEtiqueta(layoutConfig);
  const fundo = cfg.fundoCmyk || [0, 0, 0, 0];
  box.innerHTML = `
    <section class="painel-secao" data-etiqueta-config>
      <h4 class="painel-titulo">${icone("tag")} Etiqueta</h4>
      <div class="arte-grade">
        <label>Largura (mm)<input type="number" min="5" max="300" step="0.5" data-etq="larguraMm" value="${med.w}" /></label>
        <label>Altura (mm)<input type="number" min="5" max="300" step="0.5" data-etq="alturaMm" value="${med.h}" /></label>
      </div>
      <p class="pix-ajuda">Cor de fundo (CMYK %; tudo 0 = sem tinta)</p>
      <div class="arte-cor">
        <span class="arte-amostra-cor" style="background:${cmykParaCss(fundo)}"></span>
        ${["C", "M", "Y", "K"].map((l, i) =>
          `<label>${l}<input type="number" min="0" max="100" step="1" data-etq-cor="${i}" value="${Number(fundo[i]) || 0}" /></label>`).join("")}
      </div>
      <p class="pix-ajuda">Sai uma etiqueta por camiseta na folha de impressão, com a faca de 3 mm em volta. Os textos "Tamanho", "Nome do time" e "Nome / apelido" mudam sozinhos em cada uma.</p>
    </section>`;
  const cfgEtq = () => {
    elementosDaPeca("etiquetaTam");
    return layoutConfig.pecas.etiquetaTam;
  };
  box.querySelectorAll("[data-etq]").forEach((inp) => {
    inp.onchange = () => {
      const v = Number(inp.value);
      if (!(v > 0)) return;
      cfgEtq()[inp.dataset.etq] = v;
      salvarLayout(true);
      renderizarPalcoLayout();
    };
  });
  box.querySelectorAll("[data-etq-cor]").forEach((inp) => {
    inp.onchange = () => {
      const c = cfgEtq();
      const cor = (c.fundoCmyk || [0, 0, 0, 0]).slice();
      cor[Number(inp.dataset.etqCor)] = Math.max(0, Math.min(100, Number(inp.value) || 0));
      c.fundoCmyk = cor;
      salvarLayout(true);
      renderizarPalcoLayout();
      box.querySelector(".arte-amostra-cor").style.background = cmykParaCss(cor);
    };
  });
}

// Selos da lista de elementos: o que este time mudou.
function seloAjusteTime(aj) {
  if (!aj) return "";
  const selos = [];
  if (aj.oculto) selos.push('<span class="badge pendente">oculto</span>');
  if (aj.base || aj.tamanhos) selos.push('<span class="badge aguardando">posição do time</span>');
  if (aj.estilo && Object.keys(aj.estilo).length) selos.push('<span class="badge aguardando">estilo do time</span>');
  return selos.length ? " " + selos.join(" ") : "";
}

function renderizarPainelLayout() {
  const painel = document.getElementById("layoutPainel");
  if (!painel) return;
  const els = elementosNoEditor();
  const el = els.find((e) => e.id === layoutElSel);
  // Elemento só do time: no pedido ele se edita inteiro, como no layout geral.
  const extra = !!(el && layoutModo && ehExtra(el.id));
  const edicaoCompleta = !layoutModo || extra;
  painel.innerHTML = `
    <div class="painel-cabecalho"><span class="ativo">Design</span></div>
    <section class="painel-secao">
      <h4 class="painel-titulo">${icone("layers")} Camadas <span>${escapeHtmlAdmin(nomePecaProducao(layoutPeca))}</span></h4>
      <ul class="lista-elementos">${els.slice().reverse().map((e) => {
        const doTime = layoutModo && ehExtra(e.id);
        const ajE = doTime ? undefined : ajusteNoEditor(layoutPeca, e.id);
        const eT = EPS.elementoDoTime(e, ajE) || { ...e, ...((ajE && ajE.estilo) || {}) };
        return `<li class="${e.id === layoutElSel ? "ativo" : ""}${ajE && ajE.oculto ? " apagado" : ""}" data-id="${escAttr(e.id)}" tabindex="0" role="button">` +
          `<span class="el-icone">${iconeElementoLayout(e)}</span><span class="el-nome">${escapeHtmlAdmin(rotuloElementoLayout(e))}</span>` +
          `${seloAjusteTime(ajE)}` +
          (doTime ? ' <span class="badge selo-do-time" title="Elemento só deste time">só do time</span>' : "") +
          `${ajusteProprioGoleiro(layoutPeca, e.id) ? ' <span class="badge goleiro">' + icone("hand") + '</span>' : ""}` +
          `<span class="camada-acoes">` +
          (layoutModo && !doTime ? `<button type="button" class="camada-botao" data-camada-olho="${escAttr(e.id)}" title="${ajE && ajE.oculto ? "Mostrar neste time" : "Ocultar neste time"}">${icone(ajE && ajE.oculto ? "eye-off" : "eye")}</button>` : "") +
          `<button type="button" class="camada-botao${eT.travado ? " ligado" : ""}" data-camada-trava="${escAttr(e.id)}" title="${eT.travado ? "Destravar" : "Travar (não deixa mover sem querer)"}">${icone(eT.travado ? "lock" : "lock-open")}</button>` +
          `</span></li>`;
      }).join("") ||
        `<li class="lista-elementos-vazia">Nada nesta peça — use as ferramentas à esquerda do desenho para adicionar${layoutModo ? " (o que adicionar aqui vale só para este time)" : ""}. A arte do time entra sozinha, cobrindo o molde.</li>`}</ul>
      ${els.length && !layoutElSel ? '<p class="pix-ajuda">Clique num elemento (aqui ou no desenho) para editar.</p>' : ""}
    </section>
    <div id="layoutPainelEl"></div>`;
  painel.querySelectorAll("[data-camada-trava]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const e = els.find((x) => x.id === b.dataset.camadaTrava);
      if (e) gravarEstiloElemento(e.id, "travado", !elementoNoEditor(e).travado);
    };
  });
  painel.querySelectorAll("[data-camada-olho]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const aj = ajusteNoEditor(layoutPeca, b.dataset.camadaOlho);
      gravarAjusteTime(b.dataset.camadaOlho, (a) => { a.oculto = !(aj && aj.oculto); })
        .then(() => { renderizarPalcoLayout(); renderizarPainelLayout(); });
    };
  });
  painel.querySelectorAll("li[data-id]").forEach((li) => {
    li.onclick = () => { layoutElSel = li.dataset.id; renderizarPalcoLayout(); renderizarPainelLayout(); };
    li.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); li.click(); } };
  });
  const m = medidasLayout();
  if (!el && layoutPeca === "etiquetaTam" && !layoutModo) renderizarPainelEtiqueta();
  if (!el || !m) return;
  const aj = ajusteNoEditor(layoutPeca, el.id);
  // No goleiro, os botões de "voltar" desfazem só o ajuste dele.
  const ajProprio = layoutGoleiro ? ajusteProprioGoleiro(layoutPeca, el.id) : aj;
  const posProprio = !!(ajProprio && (ajProprio.base || ajProprio.tamanhos));
  const estiloProprio = !!(ajProprio && ajProprio.estilo && Object.keys(ajProprio.estilo).length);
  // Valores que valem para o que está sendo editado: no time, o estilo
  // próprio dele por cima do geral.
  const elT = layoutModo ? (EPS.elementoDoTime(el, aj) || el) : el;
  const c = caixaNoEditor(elT, m);
  const box = document.getElementById("layoutPainelEl");
  const temPosicao = !!(aj && (aj.base || aj.tamanhos));
  const temEstilo = !!(aj && aj.estilo && Object.keys(aj.estilo).length);
  const ehTexto = !ehCaixaImagem(el);

  const estado = extra
    ? `Elemento só ${layoutGoleiro ? "da camiseta do goleiro" : "deste time"} — não aparece nos outros times.`
    : layoutGoleiro
    ? ajProprio ? `O goleiro tem ajuste próprio${posProprio ? " de posição" : ""}${posProprio && estiloProprio ? " e" : ""}${estiloProprio ? " de estilo" : ""}${"oculto" in ajProprio ? (ajProprio.oculto ? " (oculto)" : " (mostrado)") : ""}.`
      : "Igual à camiseta comum deste time — mudar qualquer coisa aqui cria um ajuste só para o goleiro."
    : layoutModo
    ? aj ? `Este time tem ajuste próprio${temPosicao ? " de posição" : ""}${temPosicao && temEstilo ? " e" : ""}${temEstilo ? " de estilo" : ""}${aj.oculto ? " (oculto)" : ""}.`
      : "Igual ao layout geral — mudar qualquer coisa aqui cria um ajuste só para este time."
    : m.ehBase ? `Posição no tamanho base (${escapeHtmlAdmin(m.tam)}).`
      : el.ajustes && el.ajustes[m.tam] ? `Ajuste próprio do tamanho ${escapeHtmlAdmin(m.tam)}.`
        : `Tamanho ${escapeHtmlAdmin(m.tam)}: proporcional ao base. Mexer aqui cria um ajuste só deste tamanho.`;

  let html = `
    <section class="painel-secao painel-selecionado">
      <div class="painel-el-topo">
        <span class="el-icone">${iconeElementoLayout(el)}</span>
        <strong>${escapeHtmlAdmin(rotuloElementoLayout(el))}</strong>
        <button type="button" class="painel-fechar" data-acao="soltar" title="Soltar a seleção (Esc)" aria-label="Soltar a seleção">${icone("x")}</button>
      </div>
      <p class="pix-ajuda">${estado}</p>
      ${layoutModo && !extra ? `<label class="interruptor"><input type="checkbox" data-oculto ${aj && aj.oculto ? "checked" : ""} /> <span>${layoutGoleiro ? "Ocultar no goleiro" : "Ocultar neste time"}</span></label>` : ""}
      ${layoutModo && ajProprio ? `<div class="arte-botoes-el">
        <button type="button" class="secundario" data-acao="voltarGeral">${icone("undo-2")} ${layoutGoleiro ? "Voltar à camiseta comum" : "Voltar ao layout geral"}</button>
        ${posProprio && (estiloProprio || (ajProprio && "oculto" in ajProprio)) ? '<button type="button" class="secundario" data-acao="voltarPosicao">' + icone("undo-2") + ' Só a posição</button>' : ""}
      </div>` : ""}
    </section>

    <section class="painel-secao">
      <h4 class="painel-titulo">${icone("scaling")} Layout <span>mm</span></h4>
      <div class="arte-grade arte-grade-4">
        <label>X<input type="number" step="0.5" data-cx="x" value="${c.x.toFixed(1)}" /></label>
        <label>Y<input type="number" step="0.5" data-cx="y" value="${c.y.toFixed(1)}" /></label>
        <label>Largura<input type="number" step="0.5" min="1" data-cx="w" value="${c.w.toFixed(1)}" /></label>
        <label>Altura<input type="number" step="0.5" min="1" data-cx="h" value="${c.h.toFixed(1)}" /></label>
      </div>
      ${ehTexto ? `<label class="arte-letra">Tamanho da letra <small>(altura das maiúsculas, mm)</small>
        <input type="number" step="0.5" min="1" data-letra value="${c.h.toFixed(1)}" /></label>` : ""}
      ${!ehTexto ? `<label class="interruptor"><input type="checkbox" data-proporcao ${EPS.imagemLivre(elT) ? "" : "checked"} /> <span>Manter proporção</span></label>
        <p class="pix-ajuda">Desmarque para esticar na largura e na altura, cada uma no seu.</p>` : ""}
      <div class="arte-botoes-el">
        <button type="button" class="secundario" data-acao="centralizar">${icone("move-horizontal")} Centralizar na largura</button>
        ${edicaoCompleta && !m.ehBase && el.ajustes && el.ajustes[m.tam] ? '<button type="button" class="secundario" data-acao="semAjusteTam">' + icone("undo-2") + ' Voltar ao proporcional</button>' : ""}
      </div>
    </section>`;

  // Organizar: alinhar na peça, ordem das camadas e travar.
  const alinhar = [["esquerda", "align-start-vertical", "Alinhar à esquerda da peça"], ["centroH", "align-center-vertical", "Centralizar na largura"],
    ["direita", "align-end-vertical", "Alinhar à direita da peça"], ["topo", "align-start-horizontal", "Alinhar ao topo da peça"],
    ["meio", "align-center-horizontal", "Centralizar na altura"], ["base", "align-end-horizontal", "Alinhar à base da peça"]];
  html += `
    <section class="painel-secao">
      <h4 class="painel-titulo">${icone("layout-grid")} Organizar</h4>
      <div class="linha-icones" role="group" aria-label="Alinhar na peça">${alinhar.map(([v, ic, t]) =>
        `<button type="button" data-alinhar-peca="${v}" title="${t}" aria-label="${t}">${icone(ic)}</button>`).join("")}</div>
      ${edicaoCompleta ? `<div class="linha-icones" role="group" aria-label="Ordem das camadas">
        <button type="button" data-camada="topo" title="Trazer para a frente de tudo">${icone("chevrons-up")}</button>
        <button type="button" data-camada="frente" title="Trazer uma camada para a frente">${icone("chevron-up")}</button>
        <button type="button" data-camada="tras" title="Enviar uma camada para trás">${icone("chevron-down")}</button>
        <button type="button" data-camada="fundo" title="Enviar para trás de tudo">${icone("chevrons-down")}</button>
      </div>` : ""}
      <label class="interruptor"><input type="checkbox" data-p="travado" ${elT.travado ? "checked" : ""} /> <span>${icone("lock")} Travar (não mexe ao arrastar)</span></label>
    </section>
    <section class="painel-secao">
      <h4 class="painel-titulo">${icone("rotate-cw")} Girar e espelhar</h4>
      <div class="linha-giro">
        <label class="campo-graus"><input type="number" step="1" min="-180" max="180" data-p="rotacao" value="${Number(elT.rotacao) || 0}" /><span>°</span></label>
        <button type="button" class="botao-icone" data-girar="-90" title="Girar 90° para a esquerda">${icone("rotate-ccw")}</button>
        <button type="button" class="botao-icone" data-girar="90" title="Girar 90° para a direita">${icone("rotate-cw")}</button>
        <button type="button" class="botao-icone${elT.espelharH ? " ligado" : ""}" data-espelhar="espelharH" title="Espelhar na horizontal">${icone("flip-horizontal-2")}</button>
        <button type="button" class="botao-icone${elT.espelharV ? " ligado" : ""}" data-espelhar="espelharV" title="Espelhar na vertical">${icone("flip-vertical-2")}</button>
      </div>
      <p class="pix-ajuda">Também dá para girar pela bolinha em cima da caixa (Shift: de 15 em 15°).</p>
    </section>`;

  if (ehTexto) {
    // Amostra (clique = seletor de cor) + conta-gotas + os 4 campos CMYK.
    const cmyk = (nome, v) => `<div class="arte-cmyk" data-cor="${nome}">` +
      `<label class="arte-amostra-cor" style="background:${cmykParaCss(v)}" title="Escolher a cor">` +
      `<input type="color" data-cor-rgb="${nome}" value="${cmykParaHex(v)}" aria-label="Escolher a cor" /></label>` +
      `<button type="button" class="conta-gotas" data-conta-gotas="${nome}" title="Conta-gotas: clique aqui e depois num ponto da arte" aria-label="Conta-gotas">${icone("pipette")}</button>` +
      ["C", "M", "Y", "K"].map((l, i) =>
        `<label>${l}<input type="number" min="0" max="100" step="1" data-i="${i}" value="${Number((v || [])[i]) || 0}" /></label>`).join("") +
      `</div>`;
    html += `
      <section class="painel-secao">
        <h4 class="painel-titulo">${icone("type")} Texto</h4>
        <div class="arte-grade">
          ${(el.tipo === "nome" || el.tipo === "texto") && edicaoCompleta ? `<label>Texto
            <select data-p="campo"><option value="nomeCamiseta">Nome na camiseta (apelido)</option><option value="nomeCompleto">Nome completo</option><option value="tamanho">Tamanho da camiseta</option><option value="time">Nome do time</option><option value="fixo">Texto fixo</option></select></label>` : ""}
          ${elT.campo === "fixo" ? `<label>Texto fixo<input type="text" data-p="texto" value="${escAttr(elT.texto || "")}" /></label>` : ""}
          <div class="campo-alinhar"><span>Alinhamento</span><span class="segmentado-icones" role="group" aria-label="Alinhamento">${[["esquerda", "align-left"], ["centro", "align-center"], ["direita", "align-right"]].map(([v, ic]) =>
            `<button type="button" data-alinhar="${v}" class="${(elT.alinhamento || "centro") === v ? "ativo" : ""}" title="${v === "centro" ? "Centro" : v === "esquerda" ? "Esquerda" : "Direita"}" aria-pressed="${(elT.alinhamento || "centro") === v}">${icone(ic)}</button>`).join("")}</span></div>
          <label>Texto maior que a caixa
            <select data-p="ajuste"><option value="encolher">Encolher tudo</option><option value="comprimir">Comprimir na largura</option></select></label>
          <label>Espaço entre letras<input type="number" step="0.01" data-p="espacamento" value="${Number(elT.espacamento) || 0}" /></label>
        </div>
        <label class="interruptor"><input type="checkbox" data-p="maiusculas" ${elT.maiusculas !== false ? "checked" : ""} /> <span>MAIÚSCULAS</span></label>
        ${el.tipo === "nome" && edicaoCompleta ? `<label class="interruptor"><input type="checkbox" data-p="usarNomeSeVazio" ${el.usarNomeSeVazio !== false ? "checked" : ""} /> <span>Sem apelido, usar o nome</span></label>` : ""}
        <p class="pix-ajuda">A caixa é o limite: nome ou número comprido encolhe (ou é comprimido) para caber — nunca sai dela.</p>
      </section>
      <section class="painel-secao">
        <h4 class="painel-titulo">${icone("palette")} Cores <span>CMYK %</span></h4>
        <p class="arte-rotulo-cor">Preenchimento</p>${cmyk("corCmyk", elT.corCmyk)}
        <label class="arte-contorno">Contorno <small>(mm, 0 = sem)</small><input type="number" step="0.5" min="0" data-p="contornoMm" value="${Number(elT.contornoMm) || 0}" /></label>
        <p class="arte-rotulo-cor">Cor do contorno</p>${cmyk("contornoCmyk", elT.contornoCmyk)}
      </section>
      <section class="painel-secao">
        <h4 class="painel-titulo">${icone("sparkles")} Efeitos</h4>
        <label class="campo-deslizante">Arco <small>(graus; negativo curva para baixo)</small>
          <span><input type="range" min="-180" max="180" step="5" data-p="arco" value="${Number(elT.arco) || 0}" /><input type="number" step="5" min="-300" max="300" data-p="arco" value="${Number(elT.arco) || 0}" /></span></label>
        <label class="campo-deslizante">Itálico <small>(inclinação, graus)</small>
          <span><input type="range" min="-30" max="30" step="1" data-p="inclinacao" value="${Number(elT.inclinacao) || 0}" /><input type="number" step="1" min="-45" max="45" data-p="inclinacao" value="${Number(elT.inclinacao) || 0}" /></span></label>
        <label class="interruptor"><input type="checkbox" data-p="sombra" ${elT.sombra ? "checked" : ""} /> <span>Sombra</span></label>
        ${elT.sombra ? `<div class="arte-grade arte-grade-4 efeito-sub">
          <label>Deslocar X<input type="number" step="0.5" data-p="sombraDx" value="${elT.sombraDx == null ? 1.5 : Number(elT.sombraDx)}" /></label>
          <label>Deslocar Y<input type="number" step="0.5" data-p="sombraDy" value="${elT.sombraDy == null ? 1.5 : Number(elT.sombraDy)}" /></label>
        </div>
        <p class="arte-rotulo-cor">Cor da sombra</p>${cmyk("sombraCmyk", elT.sombraCmyk || [0, 0, 0, 60])}` : ""}
        <label class="arte-contorno">Segundo contorno <small>(mm por fora do primeiro, 0 = sem)</small><input type="number" step="0.5" min="0" data-p="contorno2Mm" value="${Number(elT.contorno2Mm) || 0}" /></label>
        ${Number(elT.contorno2Mm) > 0 ? `<p class="arte-rotulo-cor">Cor do segundo contorno</p>${cmyk("contorno2Cmyk", elT.contorno2Cmyk || [0, 0, 0, 100])}` : ""}
      </section>`;
  }
  // Duplicar vale sempre (no pedido a cópia vira elemento do time); excluir
  // apaga do layout geral ou, no pedido, os elementos do time.
  html += `<section class="painel-secao painel-rodape">
    <button type="button" class="secundario" data-acao="duplicar" title="Ctrl+D">${icone("copy")} Duplicar${layoutModo && !extra ? " (só neste time)" : ""}</button>
    ${edicaoCompleta ? `<button type="button" class="perigo" data-acao="excluir" title="Delete">${icone("trash-2")} Excluir</button>` : ""}</section>`;
  box.innerHTML = html;

  const redesenhar = () => { renderizarPalcoLayout(); renderizarPainelLayout(); };
  // Estilo: no layout geral muda o elemento; no time, o estilo próprio dele.
  const gravarEstilo = (k, v) => gravarEstiloElemento(el.id, k, v);

  box.querySelectorAll("[data-alinhar]").forEach((b) => (b.onclick = () => gravarEstilo("alinhamento", b.dataset.alinhar)));
  box.querySelectorAll("[data-alinhar-peca]").forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.alinharPeca, nova = { ...c };
      if (v === "esquerda") nova.x = 0;
      else if (v === "centroH") nova.x = (m.dim.w - c.w) / 2;
      else if (v === "direita") nova.x = m.dim.w - c.w;
      else if (v === "topo") nova.y = 0;
      else if (v === "meio") nova.y = (m.dim.h - c.h) / 2;
      else nova.y = m.dim.h - c.h;
      gravarCaixaLayout(el, m, nova);
      redesenhar();
    };
  });
  box.querySelectorAll("[data-camada]").forEach((b) => (b.onclick = () => moverCamadaLayout(el, b.dataset.camada)));
  box.querySelectorAll("[data-girar]").forEach((b) => {
    b.onclick = () => {
      let g = (Number(elT.rotacao) || 0) + Number(b.dataset.girar);
      g = ((g % 360) + 540) % 360 - 180;
      gravarEstilo("rotacao", g);
    };
  });
  box.querySelectorAll("[data-espelhar]").forEach((b) => (b.onclick = () => gravarEstilo(b.dataset.espelhar, !elT[b.dataset.espelhar])));
  // Deslizante e número do mesmo efeito andam juntos.
  box.querySelectorAll('input[type="range"][data-p]').forEach((r) => {
    r.oninput = () => {
      const par = r.parentElement.querySelector('input[type="number"]');
      if (par) par.value = r.value;
    };
  });
  const chkOculto = box.querySelector("[data-oculto]");
  if (chkOculto) {
    chkOculto.onchange = () => {
      gravarAjusteTime(el.id, (a) => { a.oculto = chkOculto.checked; }).then(redesenhar);
      redesenhar();
    };
  }
  const chkProp = box.querySelector("[data-proporcao]");
  if (chkProp) chkProp.onchange = () => gravarEstilo("livre", !chkProp.checked);
  box.querySelectorAll("[data-cx]").forEach((inp) => {
    inp.onchange = () => {
      const nova = { ...c, [inp.dataset.cx]: Number(inp.value) || 0 };
      if (!ehTexto && !EPS.imagemLivre(elT) && (inp.dataset.cx === "w" || inp.dataset.cx === "h")) {
        const prop = c.w / c.h;
        if (inp.dataset.cx === "w") nova.h = nova.w / prop; else nova.w = nova.h * prop;
      }
      gravarCaixaLayout(el, m, nova);
      redesenhar();
    };
  });
  const inpLetra = box.querySelector("[data-letra]");
  if (inpLetra) {
    // A altura da caixa é a altura das maiúsculas: muda pelo centro.
    inpLetra.onchange = () => {
      const h = Math.max(1, Number(inpLetra.value) || c.h);
      gravarCaixaLayout(el, m, { ...c, y: c.y + (c.h - h) / 2, h });
      redesenhar();
    };
  }
  box.querySelectorAll("[data-p]").forEach((inp) => {
    if (inp.tagName === "SELECT") inp.value = elT[inp.dataset.p] || inp.options[0].value;
    inp.onchange = () => {
      gravarEstilo(inp.dataset.p, inp.type === "checkbox" ? inp.checked : inp.type === "number" || inp.type === "range" ? Number(inp.value) || 0 : inp.value);
    };
  });
  // Amostra: seletor de cor; conta-gotas: pega a cor de um ponto da arte.
  box.querySelectorAll("[data-cor-rgb]").forEach((inp) => {
    inp.onchange = () => gravarEstilo(inp.dataset.corRgb, hexParaCmyk(inp.value));
  });
  box.querySelectorAll("[data-conta-gotas]").forEach((b) => {
    if (b.dataset.contaGotas === contaGotasAlvo) b.classList.add("ativo");
    b.onclick = () => (contaGotasAlvo === b.dataset.contaGotas ? sairContaGotas() : entrarContaGotas(b.dataset.contaGotas));
  });
  box.querySelectorAll("[data-cor]").forEach((grupo) => {
    grupo.querySelectorAll("input[data-i]").forEach((inp) => {
      inp.onchange = () => {
        gravarEstilo(grupo.dataset.cor, [0, 1, 2, 3].map((i) =>
          Math.max(0, Math.min(100, Number(grupo.querySelector(`[data-i="${i}"]`).value) || 0))));
      };
    });
  });
  box.querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.acao;
      if (a === "soltar") {
        layoutElSel = "";
      } else if (a === "centralizar") {
        gravarCaixaLayout(el, m, { ...c, x: (m.dim.w - c.w) / 2 });
      } else if (a === "voltarGeral") {
        await gravarAjusteTime(el.id, (x) => { Object.keys(x).forEach((k) => delete x[k]); });
      } else if (a === "voltarPosicao") {
        await gravarAjusteTime(el.id, (x) => { delete x.base; delete x.tamanhos; });
      } else if (a === "semAjusteTam") {
        if (extra) {
          await mudarExtra(el.id, (e) => { if (e.ajustes) delete e.ajustes[m.tam]; });
        } else {
          delete el.ajustes[m.tam];
          salvarLayout(true);
        }
      } else if (a === "duplicar") {
        duplicarElementoLayout(el);
        return;
      } else if (a === "excluir") {
        if (!extra && !confirm(`Excluir "${rotuloElementoLayout(el)}" da peça ${nomePecaProducao(layoutPeca)}? Vale para todos os times.`)) return;
        excluirElementoLayout(el);
        return;
      }
      redesenhar();
    };
  });
}

// Muda o ajuste próprio do time aberto no editor para um elemento da peça
// mostrada (posição, estilo, oculto) e grava. Ajuste vazio é apagado.
function gravarAjusteTime(elId, mudar) {
  const time = estadoTimes[layoutModo] && estadoTimes[layoutModo].time;
  if (!time) return Promise.resolve();
  const antes = JSON.stringify(producaoDoTime(time));
  const prod = limparParaFirestore(producaoDoTime(time));
  const alvo = layoutGoleiro ? (prod.goleiro = prod.goleiro || {}) : prod;
  alvo.layoutAjustes = alvo.layoutAjustes || {};
  const porPeca = alvo.layoutAjustes[layoutPeca] = alvo.layoutAjustes[layoutPeca] || {};
  const aj = porPeca[elId] = porPeca[elId] || {};
  mudar(aj);
  if (aj.estilo && !Object.keys(aj.estilo).length) delete aj.estilo;
  // No goleiro, "mostrar" (oculto: false) só precisa ficar gravado quando
  // a comum esconde o elemento.
  const comumOculto = !!(ajusteDaProducao(prod, layoutPeca, elId) || {}).oculto;
  if (!aj.oculto && !(layoutGoleiro && comumOculto && aj.oculto === false)) delete aj.oculto;
  if (!Object.keys(aj).length) delete porPeca[elId];
  if (!Object.keys(porPeca).length) delete alvo.layoutAjustes[layoutPeca];
  if (layoutGoleiro) limparGoleiroVazio(prod);
  registrarHistorico({ tipo: "time", timeId: layoutModo, antes, depois: JSON.stringify(prod) });
  return gravarProducaoTime(layoutModo, prod).then(() => estadoSalvarLayout(layoutGoleiro ? "✓ Salvo no goleiro" : "✓ Salvo no time"))
    .catch((e) => { console.error(e); estadoSalvarLayout("⚠️ Erro ao salvar"); });
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
  const usaLogo = usaNoTime(prod, (e) => e.tipo === "logo");
  if (usaLogo && logoEmpresa) {
    aviso("Carregando o logo da empresa…");
    rec.eps.logo = await lerEps(logoEmpresa.partes || logoEmpresa.epsId, logoEmpresa.bbox);
  }
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
  // Imagens (PNG → CMYK): a arte de cada peça e o detalhe da manga. A mesma
  // arte nas duas mangas é convertida uma vez só (mesma chave).
  const imagens = [];
  pecasIds.forEach((pecaId) => {
    const ad = EPS.arteDaPeca(prod, pecaId);
    if (ad) imagens.push({ chave: ad.chave, img: ad.arte, nome: nomePecaProducao(pecaId) });
    const usaDetalhe = EPS.elementosDaPecaNoTime(layoutConfig, prod, pecaId).some((e) => e.tipo === "detalhe");
    const d = usaDetalhe && EPS.detalheDaPeca(prod, pecaId);
    if (d) imagens.push({ chave: d.chave, img: d.img, nome: "detalhe da manga" });
  });
  for (const { chave, img, nome } of imagens) {
    if (rec.imagens[chave]) continue;
    aviso(`Baixando a arte ${nome}…`);
    const bytes = await baixarArquivoDrive(driveScriptUrl, img.partes);
    const passo = Math.max(1, Math.round((img.dpi || 600) / (dpiSaida || 600)));
    rec.imagens[chave] = await PngStream.converterParaCmyk(bytes, {
      pako, passo, pausa: esperarTela,
      aoProgresso: (f) => aviso(`Convertendo a arte ${nome} para CMYK… ${Math.round(f * 100)}%`)
    });
    // O PNG original não fica guardado na memória (pode ter centenas de MB).
    delete cacheArquivosDrive[chaveArquivoDrive(img.partes)];
  }
  return rec;
}

// Peças que entram: as que o time tem arte ou o layout tem algo.
function pecasDoTime(time) {
  const prod = producaoDoTime(time);
  return PECAS_PRODUCAO.map((p) => p.id).filter((id) =>
    EPS.arteDaPeca(prod, id) || EPS.elementosDaPecaNoTime(layoutConfig, prod, id).length)
    .concat(pecasVirtuaisDoTime(time));
}

// Reforço de ombro (quando há a tabela de comprimentos na aba Tamanhos) e
// etiqueta de tamanho (quando ela tem elementos): um de cada por camiseta.
function pecasVirtuaisDoTime(time) {
  const prod = producaoDoTime(time);
  const ids = [];
  if (Object.values(moldesConfig.reforcoOmbro || {}).some((v) => Number(v) > 0)) ids.push("reforcoOmbro");
  if (EPS.elementosDaPecaNoTime(layoutConfig, prod, "etiquetaTam").length) ids.push("etiquetaTam");
  return ids;
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
          <label>Sangria para fora da linha de corte (mm)<input type="number" name="sangriaMm" min="0" max="20" step="0.5" value="${escAttr(f.sangriaMm == null ? 2 : f.sangriaMm)}" /></label>
          <label>Girar as peças para aproveitar melhor?
            <select name="rotacao">
              <option value="0">Não girar (fornecedor não permite)</option>
              <option value="90">Girar 90° quando aproveitar melhor</option>
            </select></label>
          <label>Resolução das artes
            <select name="dpi"><option value="600">600 dpi (original)</option><option value="300">300 dpi (arquivo ~4× menor)</option><option value="150">150 dpi (prova)</option></select></label>
          <label>Contorno do molde
            <select name="molde"><option value="frente">Por cima da arte (faca de 3 mm por fora)</option><option value="fundo">Por baixo da arte</option><option value="nenhum">Não incluir</option></select></label>
          <label>Altura máxima por folha (cm, 0 = sem limite)<input type="number" name="alturaMaxCm" min="0" step="1" value="${escAttr(f.alturaMaxCm || 0)}" /></label>
          <label class="checkbox-inline"><input type="checkbox" name="etiqueta" ${f.etiqueta !== false ? "checked" : ""} /> Marcador para a costureira em cada peça ("Time-Tamanho-Peça", 4 mm, dentro da área de impressão)</label>
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
        sangriaMm: Math.max(0, Number(form.sangriaMm.value) || 0),
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
      // Goleiros: os arquivos e ajustes do goleiro (o que ele não tiver vem
      // da camiseta comum).
      const timeComum = estadoTimes[g.timeId].time;
      const time = timeNaVariante(timeComum, g.goleiro);
      const rotuloTime = time.nome + (g.goleiro ? " (goleiros)" : "");
      const falta = pendenciasProducao(time);
      if (falta.includes("arte das peças")) {
        avisos.push(`${rotuloTime}: o time não tem arte enviada — ficou de fora.`);
        continue;
      }
      falta.forEach((x) => avisos.push(`${rotuloTime}: falta ${x}.`));
      if (g.goleiro && !temVarianteGoleiro(timeComum)) {
        avisos.push(`${rotuloTime}: os goleiros saíram num arquivo à parte, com a mesma arte do time — envie as artes do goleiro em Arquivos de produção → 🧤 Goleiro.`);
      }
      const pecasIds = pecasDoTime(time);
      const tamanhos = [...new Set(g.camisetas.map((c) => c.tamanho))];
      const rec = await carregarRecursosDoTime(time, tamanhos, pecasIds, op.dpi,
        (t) => avisoProducao(`${rotuloTime}: ${t}`));
      avisoProducao(`${rotuloTime}: montando a folha…`);
      await esperarTela();
      const { blocos, avisos: avB } = EPS.montarBlocos(moldesConfig, layoutConfig, time, g.camisetas, rec,
        { molde: op.molde, etiqueta: op.etiqueta, sangriaMm: op.sangriaMm, pecas: pecasIds, nomePeca: nomePecaProducao, nomeTime: time.nome });
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
      [{ ...amostraLayout, tamanho: m.tam }], rec, { molde: "frente", etiqueta: true, sangriaMm: (layoutConfig.folha || {}).sangriaMm, pecas: [layoutPeca], nomePeca: nomePecaProducao, nomeTime: time.nome });
    const { folhas } = EPS.empacotar(blocos, { larguraMm: m.dim.w + 26, espacoMm: 10, rotacao: "0" });
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
