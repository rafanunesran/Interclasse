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
  return el.tipo === "brasao" || el.tipo === "logo" || el.tipo === "detalhe" || el.tipo === "imagem";
}

// Miniatura (url) de uma caixa de imagem para um time e uma peça.
function imagemDaCaixa(el, prod, pecaId) {
  if (el.tipo === "logo") return logoEmpresa && logoEmpresa.previaUrl;
  if (el.tipo === "imagem") return el.arquivo && el.arquivo.previaUrl;
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
    Object.keys(g.layoutAjustes || {}).length || Object.keys(g.elementos || {}).length || Object.keys(g.ordem || {}).length);
}

// Os arquivos que valem para a camiseta do goleiro (os dele; o que faltar,
// os da comum). Os ajustes de layout ficam onde estão: o nível "goleiro"
// entra na montagem das camadas (ver niveisDoTime).
function producaoDoGoleiro(prod) {
  const p = prod || {};
  const g = producaoGoleiroPropria(p);
  const saida = { ...p, pecas: { ...(p.pecas || {}), ...(g.pecas || {}) } };
  ["brasao", "fonte", "detalheManga", "detalheMangaDir"].forEach((k) => { if (g[k]) saida[k] = g[k]; });
  return saida;
}

// O time "vestido" de goleiro (ou o próprio time), para a prévia, o editor e
// a folha EPS — que leem tudo de time.producao. `_goleiro` liga o nível do
// goleiro nas camadas.
function timeNaVariante(time, goleiro) {
  if (!time || !goleiro) return time;
  return { ...time, _goleiro: true, producao: producaoDoGoleiro(producaoDoTime(time)) };
}

// ============================================================
// NÍVEIS DA ARTE: geral → cliente → time → goleiro
// ============================================================
// O layout de cada peça é montado em níveis, do mais geral ao mais
// específico:
//   • geral (aba Artes, config/layout): vale para todos os times;
//   • cliente (clientes/{id}.arte): só os times daquele cliente — os outros
//     clientes nunca recebem o que é mudado ou acrescentado ali;
//   • time (producao.layoutAjustes / elementos / ordem);
//   • goleiro (producao.goleiro.*): só na camiseta do goleiro.
// Cada nível pode AJUSTAR um elemento que veio de cima (`ajustes[peca][id]`:
// posição, estilo, ocultar/mostrar), ACRESCENTAR elementos próprios
// (`elementos[peca]`: imagem, texto, nome, número…) e mudar a ORDEM das
// camadas (`ordem[peca]`: ids de baixo para cima). O que não muda segue o
// de cima.

function clienteDaArte(time) {
  const id = clienteIdDoTime(time);
  return id && typeof estadoClientes !== "undefined" && estadoClientes[id] ? estadoClientes[id] : null;
}

function nivelDoCliente(cliente) {
  const a = (cliente && cliente.arte) || {};
  return { tipo: "cliente", ajustes: a.ajustes, elementos: a.elementos, ordem: a.ordem };
}

function nivelDaProducao(p, tipo) {
  return { tipo, ajustes: p.layoutAjustes, elementos: p.elementos, ordem: p.ordem };
}

// Níveis de um time (o layout geral é a base, fora da lista).
function niveisDoTime(time) {
  if (!time) return [];
  const niveis = [];
  const cli = clienteDaArte(time);
  if (cli) niveis.push(nivelDoCliente(cli));
  const prod = producaoDoTime(time);
  niveis.push(nivelDaProducao(prod, "time"));
  if (time._goleiro) niveis.push(nivelDaProducao(producaoGoleiroPropria(prod), "goleiro"));
  return niveis;
}

// O elemento com o ajuste de um nível por cima. A posição do nível entra no
// lugar da de cima: a caixa base dele (todos os tamanhos proporcionais a
// ela, menos os que ele mesmo ajustou) ou só os tamanhos que ele ajustou.
function aplicarAjusteNivel(el, aj) {
  const e = { ...el };
  if (aj.estilo) Object.assign(e, aj.estilo);
  if (aj.base) {
    e.caixa = aj.base;
    e.ajustes = { ...(aj.tamanhos || {}) };
  } else if (aj.tamanhos) {
    e.ajustes = { ...(e.ajustes || {}), ...aj.tamanhos };
  }
  if ("oculto" in aj) e.oculto = !!aj.oculto;
  return e;
}

// Reordena pela ordem gravada; quem não está nela (acrescentado depois)
// fica por cima, na ordem em que veio.
function aplicarOrdem(itens, ordem) {
  const pos = new Map(ordem.map((id, i) => [id, i]));
  const dentro = itens.filter((it) => pos.has(it.el.id)).sort((a, b) => pos.get(a.el.id) - pos.get(b.el.id));
  return [...dentro, ...itens.filter((it) => !pos.has(it.el.id))];
}

// Camadas de uma peça depois dos níveis, de baixo para cima:
// [{ el, origem: "geral" | "cliente" | "time" | "goleiro" }]. Os ocultos
// continuam na lista (el.oculto) — o editor mostra apagados; quem desenha
// ou imprime pula.
function resolverPeca(pecaId, niveis) {
  const geral = (layoutConfig.pecas[pecaId] && layoutConfig.pecas[pecaId].elementos) || [];
  let itens = geral.map((el) => ({ el: { ...el }, origem: "geral" }));
  (niveis || []).forEach((n) => {
    const ajs = (n.ajustes || {})[pecaId] || {};
    itens.forEach((it) => {
      const aj = ajs[it.el.id];
      if (aj) it.el = aplicarAjusteNivel(it.el, aj);
    });
    ((n.elementos || {})[pecaId] || []).forEach((el) => itens.push({ el: { ...el }, origem: n.tipo }));
    const ordem = (n.ordem || {})[pecaId];
    if (ordem && ordem.length) itens = aplicarOrdem(itens, ordem);
  });
  return itens;
}

// Elementos visíveis de uma peça, na ordem de desenho.
function elementosVisiveis(pecaId, niveis) {
  return resolverPeca(pecaId, niveis).filter((it) => !it.el.oculto).map((it) => it.el);
}

function elementosDoTime(time, pecaId) {
  return elementosVisiveis(pecaId, niveisDoTime(time));
}

// Layout pronto (sem ajustes pendentes) para a folha EPS: cada peça com os
// elementos já resolvidos pelos níveis.
function layoutComNiveis(niveis) {
  const pecas = {};
  PECAS_PRODUCAO.forEach((p) => { pecas[p.id] = { elementos: elementosVisiveis(p.id, niveis) }; });
  return { ...layoutConfig, pecas };
}

function layoutDoTime(time) {
  return layoutComNiveis(niveisDoTime(time));
}

// O time com os ajustes já embutidos no layout resolvido (para a folha EPS).
function timeSemAjustes(time) {
  return { ...time, producao: { ...producaoDoTime(time), layoutAjustes: {} } };
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
      <button type="button" data-variante="goleiro" class="${gol ? "ativo" : ""}" aria-selected="${gol}">🧤 Goleiro${temVarianteGoleiro(time) ? " ●" : ""}</button>
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

// O que falta para o time poder gerar a folha (na variante do goleiro, passe
// timeNaVariante(time, true)).
function pendenciasProducao(time) {
  const p = producaoDoTime(time);
  const falta = [];
  const temArte = PECAS_PRODUCAO.some((x) => p.pecas && p.pecas[x.id]);
  if (!temArte) falta.push("arte das peças");
  // O que o layout DESTE time usa (geral + cliente + time [+ goleiro]).
  const todos = PECAS_PRODUCAO.flatMap((x) => elementosDoTime(time, x.id));
  const usaTexto = todos.some((e) => !ehCaixaImagem(e));
  const usaBrasao = todos.some((e) => e.tipo === "brasao");
  if (usaTexto && !p.fonte) falta.push("fonte");
  if (usaBrasao && !p.brasao) falta.push("brasão");
  const usaDetalhe = todos.some((e) => e.tipo === "detalhe");
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

  const nArtes = PECAS_PRODUCAO.filter((x) => EPS.arteDaPeca(prod, x.id)).length;
  const falta = pendenciasProducao(gol ? timeNaVariante(time, true) : time);
  const nProprios = gol ? Object.keys(propria.pecas || {}).length +
    ["brasao", "fonte", "detalheManga", "detalheMangaDir"].filter((k) => propria[k]).length : 0;
  bloco.innerHTML = `<summary>${gol ? "🧤 Arquivos do goleiro" : "🎨 Arquivos de produção"} <span class="badge ${falta.length ? "pendente" : "pago"}">` +
    `${falta.length ? "falta " + escapeHtmlAdmin(falta.join(", ")) : "pronto ✓"}</span>` +
    ` <span class="pix-ajuda">${gol
      ? `${nProprios} arquivo(s) próprio(s) — o resto usa o da camiseta comum`
      : `${nArtes}/${PECAS_PRODUCAO.length} artes${prod.brasao ? " · brasão" : ""}${prod.fonte ? " · fonte" : ""}`}</span></summary>`;

  const grade = document.createElement("div");
  grade.className = "producao-grade";

  const infoPng = (a) => a ? {
    previa: a.previaUrl,
    info: `${a.larguraPx} × ${a.alturaPx} px · ${a.dpi || "?"} dpi · ` +
      `${Math.round((a.larguraPx / (a.dpi || 600)) * 25.4)} × ${Math.round((a.alturaPx / (a.dpi || 600)) * 25.4)} mm`
  } : null;
  const infoBrasao = (b) => b ? { previa: b.previaUrl, info: b.nomeArquivo || "EPS" } : null;
  const infoFonte = (f) => f ? { info: f.nome } : null;
  // Na variante do goleiro, um espaço sem arquivo próprio mostra (apagado) o
  // da camiseta comum, que é o que vai ser usado.
  const slot = (id, titulo, proprio, daComum, formato) => {
    const herdado = gol && !proprio && daComum ? daComum : null;
    grade.appendChild(criarSlotProducao(timeId, id, titulo, proprio, formato, herdado));
  };
  // Uma arte serve para as duas mangas; a da direita só aparece quando o
  // time ativa "manga direita com arte diferente".
  PECAS_PRODUCAO.forEach((peca) => {
    if (peca.id === "mangaDir" && !comum.mangaDirDiferente) return;
    const titulo = peca.id === "mangaEsq" && !comum.mangaDirDiferente ? "Mangas (as duas)" : peca.nome;
    slot(`arte:${peca.id}`, titulo, infoPng(propria.pecas && propria.pecas[peca.id]),
      infoPng(comum.pecas && comum.pecas[peca.id]), "PNG 600 dpi");
  });
  slot("detalhe", comum.detalheDirDiferente ? "Detalhe da manga esquerda" : "Detalhe da manga",
    infoPng(propria.detalheManga), infoPng(comum.detalheManga), "PNG 600 dpi");
  if (comum.detalheDirDiferente) {
    slot("detalhe:dir", "Detalhe da manga direita", infoPng(propria.detalheMangaDir), infoPng(comum.detalheMangaDir), "PNG 600 dpi");
  }
  slot("brasao", "Brasão", infoBrasao(propria.brasao), infoBrasao(comum.brasao), "EPS");
  slot("fonte", "Fonte", infoFonte(propria.fonte), infoFonte(comum.fonte), ".ttf / .otf");
  bloco.appendChild(grade);

  // Mangas e detalhe diferentes em cada lado (padrão: um arquivo para as duas).
  // Valem para as duas variantes.
  const opcoes = document.createElement("div");
  opcoes.className = "producao-opcoes";
  opcoes.innerHTML = `
    <label class="checkbox-inline"><input type="checkbox" data-op="mangaDirDiferente" ${comum.mangaDirDiferente ? "checked" : ""} /> Manga direita com arte diferente</label>
    <label class="checkbox-inline"><input type="checkbox" data-op="detalheDirDiferente" ${comum.detalheDirDiferente ? "checked" : ""} /> Detalhe diferente na manga direita</label>
    ${gol ? '<span class="pix-ajuda">(vale para a camiseta comum e a do goleiro)</span>' : ""}`;
  opcoes.querySelectorAll("[data-op]").forEach((inp) => {
    inp.onchange = async () => {
      const p = limparParaFirestore(producaoDoTime(estadoTimes[timeId].time));
      p[inp.dataset.op] = inp.checked;
      await gravarProducaoTime(timeId, p);
    };
  });
  bloco.appendChild(opcoes);

  const rodape = document.createElement("div");
  rodape.className = "producao-rodape";
  const btnLayout = document.createElement("button");
  btnLayout.type = "button";
  btnLayout.className = "secundario";
  btnLayout.textContent = gol ? "Editar arte do goleiro" : "Editar arte deste time";
  btnLayout.onclick = () => abrirLayoutDoTime(timeId);
  rodape.appendChild(btnLayout);
  const nAjustes = Object.values(propria.layoutAjustes || {}).reduce((s, p) => s + Object.keys(p || {}).length, 0);
  if (nAjustes) rodape.insertAdjacentHTML("beforeend", `<span class="pix-ajuda">${nAjustes} ajuste(s) próprio(s)${gol ? " do goleiro" : ""} — aba "Editar arte"</span>`);
  bloco.appendChild(rodape);
  return bloco;
}

// `herdado`: na variante do goleiro, o arquivo da comum que vale no lugar.
function criarSlotProducao(timeId, slot, titulo, atual, formato, herdado) {
  const gol = editandoGoleiro(timeId);
  const div = document.createElement("div");
  div.className = "producao-slot" + (atual ? " ok" : "") + (herdado ? " herdado" : "");
  const andamento = enviandoProducao[chaveEnvio(timeId, slot, gol)];
  const mostrar = atual || herdado;
  div.innerHTML = `
    <div class="producao-slot-titulo">${escapeHtmlAdmin(titulo)}</div>
    <div class="producao-slot-previa">${mostrar && mostrar.previa
      ? `<img src="${escAttr(mostrar.previa)}" alt="" loading="lazy" />`
      : `<span>${mostrar ? "✓" : escapeHtmlAdmin(formato)}</span>`}</div>
    <div class="producao-slot-info">${andamento ? escapeHtmlAdmin(andamento)
      : atual ? escapeHtmlAdmin(atual.info || "")
        : herdado ? "Usa o da camiseta comum" : "—"}</div>`;
  const acoes = document.createElement("div");
  acoes.className = "producao-slot-acoes";
  const env = document.createElement("button");
  env.type = "button";
  env.className = "secundario";
  env.textContent = atual ? "Trocar" : "Enviar";
  env.disabled = !!andamento;
  env.onclick = () => enviarArquivoProducao(timeId, slot, gol);
  acoes.appendChild(env);
  if (atual) {
    const rem = document.createElement("button");
    rem.type = "button";
    rem.className = "perigo";
    rem.textContent = "×";
    rem.title = gol ? "Remover (volta a usar o da camiseta comum)" : "Remover";
    rem.onclick = async () => {
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

// Envia um PNG de produção (600 dpi) ao Drive, com a miniatura para a tela.
// Devolve os dados a gravar, ou null se cancelado. `marcar(texto)` mostra o
// andamento.
async function enviarPngProducao(file, pref, marcar) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = PngStream.lerCabecalho(bytes); // valida (8 bits, sem entrelaçamento)
  if (info.dpi && info.dpi !== 600 &&
      !confirm(`Este PNG está em ${info.dpi} dpi (o esperado é 600). O tamanho real na peça é calculado pelo dpi do arquivo. Enviar mesmo assim?`)) return null;
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
  } finally {
    marcar("");
  }
  return {
    partes: env.partes, nomeArquivo: file.name,
    larguraPx: info.largura, alturaPx: info.altura, dpi: info.dpi || 600, previaUrl
  };
}

async function enviarArquivoProducao(timeId, slot, goleiro) {
  if (!exigirDriveProducao()) return;
  const accept = slot === "brasao" ? ".eps,.ps,application/postscript"
    : slot === "fonte" ? ".ttf,.otf,font/ttf,font/otf" : "image/png";
  const file = await escolherArquivos(accept);
  if (!file) return;
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
      dados = await enviarPngProducao(file, pref, marcar);
      if (!dados) return;
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
  const ad = EPS.arteDaPeca(prod, pecaId);
  const arte = ad && ad.arte;
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
  // Recorte no formato do molde (a arte, o brasão, o logo e os textos).
  const idClip = "pc" + Math.random().toString(36).slice(2, 8);
  const recorte = !semRecorte && molde && molde.contorno ? molde.contorno : "";
  if (arte && arte.previaUrl && soArte !== "elementos") {
    const c = EPS.caixaArte(arte, base, dim, sangriaDaPrevia());
    partes.push(`<image href="${escAttr(urlPreviaGrande(arte.previaUrl))}" x="${n(c.x)}" y="${n(c.y)}" ` +
      `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="none" />`);
  }

  const fonte = fonteProntaDoTime(time);
  // As camadas do time (geral + cliente + time [+ goleiro]), já ajustadas.
  (soArte === true ? [] : elementosDoTime(time, pecaId)).forEach((el) => {
    const c = EPS.caixaEfetiva(el, tam, base, dim);
    if (ehCaixaImagem(el)) {
      const url = imagemDaCaixa(el, prod, pecaId);
      if (url) {
        partes.push(`<image href="${escAttr(urlPreviaGrande(url))}" x="${n(c.x)}" y="${n(c.y)}" ` +
          `width="${n(c.w)}" height="${n(c.h)}" preserveAspectRatio="${EPS.imagemLivre(el) ? "none" : "xMidYMid meet"}" />`);
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

  // Marcador da costureira (só na prévia "Arte", como vai sair na folha).
  if (comMolde && fonte && tam && molde) {
    const cmds = EPS.marcadorDaPeca(fonte, EPS.textoDoMarcador(time.nome, tam, nomePecaProducao(pecaId)), dim.w, dim.h, pecaId === "gola");
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
  return { w: dim.w, h: dim.h, svg, contorno: recorte, temArte: !!arte, margem };
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

function canvasEmPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), "image/png"));
}

// Monta e publica a prévia do cliente. Uma geração por time de cada vez; um
// pedido no meio faz rodar de novo no fim (com os dados mais novos).
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
    const pecas = await pecasParaMockup(time, timeId, tam, AMOSTRA_CLIENTE);
    const pref = `${slugify(time.nome) || timeId}-previa-cliente`;
    const previa = { geradaEmMs: Date.now() };
    const envios = [["cena", "Cena"], ["frente", "Frente"], ["costas", "Costas"]].map(([vista]) => async () => {
      const canvas = await Mockup.renderizar(vista, pecas);
      return [vista, await canvasEmPng(canvas)];
    });
    envios.push(async () => {
      const c = await arteDoClienteEmCanvas(time, timeId, tam);
      return ["arte", c ? await canvasEmPng(c) : null];
    });
    for (const gerar of envios) {
      const [chave, blob] = await gerar();
      if (!blob) continue;
      const env = await enviarArquivoDrive(driveScriptUrl, new File([blob], chave + ".png", { type: "image/png" }), pref);
      previa[chave] = urlPreviaGrande(env.url);
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
  return quando ? `Prévia do cliente publicada em ${quando}.` : "A página do cliente ainda não tem prévia.";
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
      <button type="button" class="secundario ${previaTime.modo === "mockup" ? "" : "oculto"}" data-so-mockup data-baixar-mockup>⬇ Baixar PNG</button>
    </div>
    <div class="previa-area"></div>
    <p class="pix-ajuda previa-nota"></p>
    <div class="previa-cliente">
      <button type="button" class="secundario" data-publicar-previa="${escAttr(timeId)}">📤 Publicar prévia para o cliente</button>
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

  let esperandoFonte = false;
  const desenhar = () => {
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
        .then((pecas) => Mockup.renderizar(previaTime.vista, pecas))
        .then((canvas) => {
          if (vez !== desenhoMockup) return;
          canvas.className = "mockup-canvas";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Mockup da camiseta de ${time.nome}`);
          area.innerHTML = "";
          area.appendChild(canvas);
          ultimoMockup = canvas;
          nota.textContent = temArquivos
            ? `Simulação na foto, montada com as artes${tamAtual ? " do tamanho " + tamAtual : ""}. O mockup mostra frente, costas, mangas e gola.`
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
    // Como a folha do molde: gola em cima, mangas no meio, frente e costas
    // embaixo — todas na MESMA escala (a manga do tamanho certo perto do corpo).
    const linhas = [["gola"], ["mangaEsq", "mangaDir", "detalheMangaEsq", "detalheMangaDir"], ["frente", "costas"]]
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

// O mesmo editor serve à aba Artes (#editorLayout: layout geral, um cliente
// ou um time) e à aba "Editar arte" do pedido (travado naquele time). Só um
// desenha por vez: o do pedido quando está visível, senão o da aba Artes.
// Ele sempre edita UM nível (ver NÍVEIS DA ARTE): o que é deste nível muda
// direto; o que veio de cima vira um ajuste deste nível.
let elEditorLayout = document.getElementById("editorLayout");
let editorPedido = null;    // { container, timeId } da aba "Editar arte"
let editorTravado = false;  // desenhando no pedido?
let layoutModoArtes = "";   // o que a aba Artes estava editando
let layoutModo = "";        // "" = layout geral; "c:<id>" = cliente; timeId = time
let layoutGoleiro = false;  // no pedido: editando a variante do goleiro?
let layoutTimePrevia = "";  // time cuja arte/fonte aparece na prévia (geral e cliente)
let layoutPeca = "costas";
let layoutTam = "";
let layoutElSel = "";
let layoutArrastando = false;
const amostraLayout = { nomeCamiseta: "JOÃO PEDRO", nome: "João Pedro Silva", numero: "10" };

const PREFIXO_MODO_CLIENTE = "c:";

function modoCliente() {
  return layoutModo.startsWith(PREFIXO_MODO_CLIENTE) ? layoutModo.slice(PREFIXO_MODO_CLIENTE.length) : "";
}

function modoTime() {
  return layoutModo && !layoutModo.startsWith(PREFIXO_MODO_CLIENTE) ? layoutModo : "";
}

// "geral" | "cliente" | "time" | "goleiro": o nível que o editor está mexendo.
function nivelAtualTipo() {
  if (modoCliente()) return "cliente";
  if (modoTime()) return layoutGoleiro ? "goleiro" : "time";
  return "geral";
}

const NOME_NIVEL = { geral: "layout geral", cliente: "cliente", time: "time", goleiro: "goleiro" };

// Para quem vale o que se muda no nível aberto (para os textos de ajuda).
function alvoDoNivel() {
  const tipo = nivelAtualTipo();
  if (tipo === "cliente") {
    const c = estadoClientes[modoCliente()];
    return `os times de ${c ? c.nome || c.id : "este cliente"}`;
  }
  if (tipo === "time") return "este time";
  if (tipo === "goleiro") return "o goleiro deste time";
  return "todos os times";
}

// "Ajustar layout deste time": abre a aba "Editar arte" do pedido.
function abrirLayoutDoTime(timeId) {
  if (typeof abrirTimeAdmin === "function") abrirTimeAdmin(timeId, "editarArte");
}

// "Editar arte do cliente": abre a aba Artes editando aquele cliente.
function abrirArteDoCliente(clienteId) {
  layoutModo = layoutModoArtes = PREFIXO_MODO_CLIENTE + clienteId;
  layoutElSel = "";
  const aba = document.querySelector('.aba[data-aba="artes"]');
  if (aba) aba.click();
  else renderizarEditorLayout();
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

// Times da prévia: no modo cliente, só os daquele cliente.
function timesDaPreviaLayout() {
  const cid = modoCliente();
  const times = timesParaLayout();
  return cid ? times.filter(([, e]) => clienteIdDoTime(e.time) === cid) : times;
}

// Time cujos arquivos (arte, brasão, fonte) aparecem no palco. No modo time,
// é o próprio time (na variante aberta).
function timeDaPrevia() {
  const t = modoTime();
  if (t) return estadoTimes[t] ? timeNaVariante(estadoTimes[t].time, layoutGoleiro) : null;
  return layoutTimePrevia && estadoTimes[layoutTimePrevia] ? estadoTimes[layoutTimePrevia].time : null;
}

// Níveis aplicados no editor, do mais geral ao aberto (o último é o que se
// edita; no layout geral, nenhum).
function niveisDoEditor() {
  const cid = modoCliente();
  if (cid) return estadoClientes[cid] ? [nivelDoCliente(estadoClientes[cid])] : [];
  if (modoTime()) return niveisDoTime(timeDaPrevia());
  return [];
}

// Camadas da peça aberta como ficam no nível editado, de baixo para cima.
function itensDoEditor(pecaId) {
  return resolverPeca(pecaId || layoutPeca, niveisDoEditor());
}

// As mesmas camadas sem o nível editado (o que vem "de cima").
function itensAcimaDoEditor(pecaId) {
  return resolverPeca(pecaId || layoutPeca, niveisDoEditor().slice(0, -1));
}

// Dados próprios do nível editado (ajustes, elementos, ordem).
function nivelDoEditor() {
  const niveis = niveisDoEditor();
  return niveis.length ? niveis[niveis.length - 1] : null;
}

// Ajuste que o nível editado fez num elemento herdado.
function ajusteDoNivel(pecaId, elId) {
  const n = nivelDoEditor();
  const aj = n && n.ajustes;
  return aj && aj[pecaId] && aj[pecaId][elId];
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
  if (layoutArrastando) return;
  escolherAlvoDoEditor();
  if (!elEditorLayout) return;
  const foco = document.activeElement && elEditorLayout.contains(document.activeElement) ? document.activeElement : null;
  // Não redesenha com o cursor num campo de texto (perderia o que se digita).
  if (foco && foco.tagName === "INPUT" && foco.type !== "checkbox") return;

  const times = timesParaLayout();
  if (modoTime() && !estadoTimes[modoTime()]) layoutModo = "";
  if (modoCliente() && !estadoClientes[modoCliente()]) layoutModo = "";
  if (!modoTime()) {
    const daPrevia = timesDaPreviaLayout();
    if (!daPrevia.some(([id]) => id === layoutTimePrevia)) {
      const comArte = daPrevia.find(([, e]) => e.time.producao && e.time.producao.pecas);
      layoutTimePrevia = comArte ? comArte[0] : (daPrevia[0] ? daPrevia[0][0] : "");
    }
  }
  const tipo = nivelAtualTipo();
  const tam = tamanhoDoEditor();
  const opcTimes = (lista, sel) => lista.map(([id, e]) =>
    `<option value="${escAttr(id)}"${id === sel ? " selected" : ""}>${escapeHtmlAdmin(e.time.nome)}</option>`).join("");
  const clientes = typeof clientesOrdenados === "function" ? clientesOrdenados() : [];
  const opcClientes = clientes.map((c) => {
    const v = PREFIXO_MODO_CLIENTE + c.id;
    return `<option value="${escAttr(v)}"${v === layoutModo ? " selected" : ""}>Cliente: ${escapeHtmlAdmin(c.nome || c.id)}</option>`;
  }).join("");

  let aviso = "";
  if (tipo === "cliente") {
    aviso = `Arte do cliente <strong>${escapeHtmlAdmin(estadoClientes[modoCliente()].nome || modoCliente())}</strong>: o que mudar ou acrescentar aqui vale só para os times dele — os outros clientes não veem nada disto. Cada time ainda pode ter o seu ajuste próprio por cima.`;
  } else if (tipo === "time" || tipo === "goleiro") {
    const time = estadoTimes[modoTime()].time;
    const cli = clienteDaArte(time);
    const deCima = cli ? `a arte do cliente <strong>${escapeHtmlAdmin(cli.nome || cli.id)}</strong> e o layout geral` : "o layout geral (aba Artes)";
    aviso = tipo === "goleiro"
      ? `🧤 Ajustes do <strong>goleiro</strong> de <strong>${escapeHtmlAdmin(time.nome)}</strong>: valem só para a camiseta do goleiro. O que não for mudado aqui segue a camiseta comum deste time.`
      : `Ajustes próprios de <strong>${escapeHtmlAdmin(time.nome)}</strong>: posição, tamanho da letra, cores, o que aparece, camadas e elementos novos valem só para este time. O que não for mudado aqui segue ${deCima}.`;
    if (cli && editorTravado) {
      aviso += ` <button type="button" class="link-botao" data-l="abrirCliente">Editar a arte do cliente</button>`;
    }
  }

  elEditorLayout.innerHTML = `
    <div class="layout-topo">
      ${editorTravado ? "" : `<label>Editando
        <select data-l="modo"><option value="">Layout geral (todos os times)</option>
          ${opcClientes ? `<optgroup label="Clientes (só os times do cliente)">${opcClientes}</optgroup>` : ""}
          <optgroup label="Times">${opcTimes(times, modoTime())}</optgroup></select></label>`}
      ${modoTime() ? "" : `<label>Prévia com a arte de
        <select data-l="previa"><option value="">(nenhum time)</option>${opcTimes(timesDaPreviaLayout(), layoutTimePrevia)}</select></label>`}
      <span id="layoutEstadoSalvar" class="pix-ajuda"></span>
    </div>
    ${aviso ? `<p class="aviso">${aviso}</p>` : ""}
    <nav class="fin-subabas layout-pecas">${PECAS_PRODUCAO.map((p) =>
      `<button type="button" class="fin-subaba${p.id === layoutPeca ? " ativa" : ""}" data-peca="${p.id}">${escapeHtmlAdmin(p.nome)}</button>`).join("")}</nav>
    <div class="arte-area">
      <div class="arte-palco-col">
        <div class="arte-barra-palco">
          <label>Tamanho <select data-l="tam">${tamanhosComMolde(layoutPeca).map((t) =>
            `<option value="${escAttr(t)}"${t === tam ? " selected" : ""}>${escapeHtmlAdmin(t)}${t === moldesConfig.tamanhoBase ? " (base)" : ""}</option>`).join("")}</select></label>
          <label>Apelido de teste <input type="text" data-amostra="nomeCamiseta" value="${escAttr(amostraLayout.nomeCamiseta)}" /></label>
          <label>Número <input type="text" data-amostra="numero" value="${escAttr(amostraLayout.numero)}" style="width:60px" /></label>
          <span class="arte-botoes-add" title="${tipo === "geral" ? "Acrescenta no layout geral (todos os times)" : `Acrescenta só para ${escAttr(alvoDoNivel())}`}">
            <button type="button" class="secundario" data-add="imagem" title="Imagem própria (PNG 600 dpi ou EPS): um patrocinador, um desenho, um selo…">+ Imagem</button>
            <button type="button" class="secundario" data-add="texto" title="Texto fixo, igual em todas as camisetas">+ Texto</button>
            <button type="button" class="secundario" data-add="brasao">+ Brasão</button>
            <button type="button" class="secundario" data-add="logo" title="Logo da empresa (enviado em Configurações)">+ Logo</button>
            <button type="button" class="secundario" data-add="detalhe" title="Detalhe da manga (PNG enviado em cada time)">+ Detalhe</button>
            <button type="button" class="secundario" data-add="nome">+ Nome</button>
            <button type="button" class="secundario" data-add="numero">+ Número</button>
            <button type="button" class="secundario" data-l="teste">⬇ EPS de teste</button>
          </span>
        </div>
        <div class="arte-palco-wrap"><div id="layoutPalco" class="arte-palco"></div></div>
      </div>
      <div class="arte-painel" id="layoutPainel"></div>
    </div>`;

  const q = (s) => elEditorLayout.querySelector(s);
  if (q('[data-l="modo"]')) q('[data-l="modo"]').onchange = (ev) => {
    layoutModo = ev.target.value;
    layoutModoArtes = layoutModo;
    if (modoTime()) layoutTimePrevia = layoutModo;
    layoutElSel = "";
    renderizarEditorLayout();
  };
  if (q('[data-l="previa"]')) q('[data-l="previa"]').onchange = (ev) => { layoutTimePrevia = ev.target.value; renderizarEditorLayout(); };
  if (q('[data-l="abrirCliente"]')) {
    q('[data-l="abrirCliente"]').onclick = () => abrirArteDoCliente(clienteIdDoTime(estadoTimes[modoTime()].time));
  }
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

// Caixa de um elemento já resolvido (os ajustes dos níveis já estão nele).
function caixaNoEditor(el, m) {
  return EPS.caixaEfetiva(el, m.tam, m.base, m.dim);
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
  if (el.rotulo) return el.rotulo;
  if (el.tipo === "brasao") return "Brasão";
  if (el.tipo === "logo") return "Logo da empresa";
  if (el.tipo === "detalhe") return "Detalhe da manga";
  if (el.tipo === "imagem") return (el.arquivo && el.arquivo.nomeArquivo) || "Imagem";
  if (el.tipo === "texto") return `Texto “${el.texto || ""}”`;
  if (el.tipo === "numero") return "Número";
  return el.campo === "nomeCompleto" ? "Nome completo" : "Nome na camiseta";
}

function rotuloVazioDaCaixa(el) {
  if (el.tipo === "logo") return "Logo<br>(envie em Configurações)";
  if (el.tipo === "detalhe") return "Detalhe da manga";
  if (el.tipo === "imagem") return "Imagem";
  return "Brasão";
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
  const adEd = EPS.arteDaPeca(prod, layoutPeca);
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
  const tipoNivel = nivelAtualTipo();
  // As camadas na ordem (a de cima por último). Ocultas aparecem apagadas
  // (dá para selecionar e mostrar de novo).
  itensDoEditor().forEach((it, i) => {
    const el = it.el;
    const c = caixaNoEditor(el, m);
    const div = document.createElement("div");
    const temAjusteNivel = tipoNivel !== "geral" && (it.origem === tipoNivel || !!ajusteDoNivel(layoutPeca, el.id));
    div.className = "arte-el arte-el-" + el.tipo + (el.id === layoutElSel ? " selecionado" : "") +
      (temAjusteNivel ? " ajuste-time" : "") + (el.oculto ? " oculto-time" : "");
    div.style.left = c.x * s + "px";
    div.style.top = c.y * s + "px";
    div.style.width = c.w * s + "px";
    div.style.height = c.h * s + "px";
    div.style.zIndex = String(10 + i);
    if (ehCaixaImagem(el)) {
      const url = imagemDaCaixa(el, prod, layoutPeca);
      div.innerHTML = url
        ? `<img src="${escAttr(urlPreviaGrande(url))}" alt="" draggable="false" style="object-fit:${EPS.imagemLivre(el) ? "fill" : "contain"}" />`
        : `<span class="arte-el-rotulo">${rotuloVazioDaCaixa(el)}</span>`;
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
    ligarArrasteLayout(div, alca, el.id);
    palco.appendChild(div);
  });
}

// Arrastar (mover) e a alça do canto (redimensionar). Imagens mantêm a
// proporção (a não ser que desmarcada); as caixas de texto são livres (são
// o limite do texto).
function ligarArrasteLayout(div, alca, elId) {
  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const redimensionar = ev.target === alca;
    if (layoutElSel !== elId) {
      layoutElSel = elId;
      document.querySelectorAll("#layoutPalco .arte-el").forEach((d) => d.classList.toggle("selecionado", d === div));
      renderizarPainelLayout();
    }
    const m = medidasLayout();
    const it = itensDoEditor().find((x) => x.el.id === elId);
    if (!m || !it) return;
    const el = it.el;
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
        // Imagem com proporção travada acompanha a largura; livre, estica.
        atual = { x: ini.x, y: ini.y, w, h: ehCaixaImagem(el) && !EPS.imagemLivre(el) ? w / prop : Math.max(2, ini.h + dy) };
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
        gravarCaixaLayout(elId, m, atual);
      }
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
    div.addEventListener("pointermove", mover);
    div.addEventListener("pointerup", soltar);
    div.addEventListener("pointercancel", soltar);
  });
}

// ---------------- Gravar no nível editado ----------------

// Tira o que ficou vazio de um nível { ajustes, elementos, ordem }.
function compactarNivel(n) {
  const saida = {};
  const ajustes = {};
  Object.entries(n.ajustes || {}).forEach(([pecaId, porPeca]) => {
    const limpo = {};
    Object.entries(porPeca || {}).forEach(([elId, aj]) => {
      if (!aj) return;
      if (aj.estilo && !Object.keys(aj.estilo).length) delete aj.estilo;
      if (aj.tamanhos && !Object.keys(aj.tamanhos).length) delete aj.tamanhos;
      if (Object.keys(aj).length) limpo[elId] = aj;
    });
    if (Object.keys(limpo).length) ajustes[pecaId] = limpo;
  });
  const elementos = {};
  Object.entries(n.elementos || {}).forEach(([pecaId, lista]) => { if (lista && lista.length) elementos[pecaId] = lista; });
  const ordem = {};
  Object.entries(n.ordem || {}).forEach(([pecaId, lista]) => { if (lista && lista.length) ordem[pecaId] = lista; });
  if (Object.keys(ajustes).length) saida.ajustes = ajustes;
  if (Object.keys(elementos).length) saida.elementos = elementos;
  if (Object.keys(ordem).length) saida.ordem = ordem;
  return saida;
}

// Muda o nível editado (cliente, time ou goleiro) e grava. `mudar(n)`
// recebe { ajustes, elementos, ordem } editáveis. O layout geral não passa
// por aqui (é o config/layout, gravado por salvarLayout).
function gravarNivelEditor(mudar) {
  const tipo = nivelAtualTipo();
  const erro = (e) => { console.error(e); estadoSalvarLayout("⚠️ Erro ao salvar"); };
  if (tipo === "cliente") {
    const cid = modoCliente();
    const cli = estadoClientes[cid];
    if (!cli) return Promise.resolve();
    const arte = limparParaFirestore(cli.arte || {});
    const n = { ajustes: arte.ajustes || {}, elementos: arte.elementos || {}, ordem: arte.ordem || {} };
    mudar(n);
    const nova = compactarNivel(n);
    cli.arte = nova; // já mostra, sem esperar o Firestore
    estadoSalvarLayout("Salvando…");
    return db.collection(COL_CLIENTES).doc(cid).update({ arte: nova })
      .then(() => {
        estadoSalvarLayout("✓ Salvo no cliente");
        // A prévia do cliente de cada time dele muda junto.
        Object.entries(estadoTimes).forEach(([id, e]) => { if (clienteIdDoTime(e.time) === cid) agendarPreviaCliente(id); });
      })
      .catch(erro);
  }
  const timeId = modoTime();
  const time = estadoTimes[timeId] && estadoTimes[timeId].time;
  if (!time) return Promise.resolve();
  const prod = limparParaFirestore(producaoDoTime(time));
  const alvo = tipo === "goleiro" ? (prod.goleiro = prod.goleiro || {}) : prod;
  const n = { ajustes: alvo.layoutAjustes || {}, elementos: alvo.elementos || {}, ordem: alvo.ordem || {} };
  mudar(n);
  const c = compactarNivel(n);
  [["layoutAjustes", "ajustes"], ["elementos", "elementos"], ["ordem", "ordem"]].forEach(([k, kn]) => {
    if (c[kn]) alvo[k] = c[kn]; else delete alvo[k];
  });
  if (tipo === "goleiro") limparGoleiroVazio(prod);
  return gravarProducaoTime(timeId, prod)
    .then(() => estadoSalvarLayout(tipo === "goleiro" ? "✓ Salvo no goleiro" : "✓ Salvo no time"))
    .catch(erro);
}

// Muda um elemento da peça aberta no nível editado: se ele é deste nível,
// muda ele mesmo (`noElemento`); se veio de cima, grava um ajuste deste
// nível (`noAjuste`). O que o ajuste não muda continua seguindo o de cima.
function mudarElementoNoEditor(elId, noElemento, noAjuste) {
  const tipo = nivelAtualTipo();
  if (tipo === "geral") {
    const el = elementosDaPeca(layoutPeca).find((e) => e.id === elId);
    if (el) {
      noElemento(el);
      salvarLayout();
    }
    return Promise.resolve();
  }
  const it = itensDoEditor().find((x) => x.el.id === elId);
  if (!it) return Promise.resolve();
  const acima = itensAcimaDoEditor().find((x) => x.el.id === elId);
  return gravarNivelEditor((n) => {
    if (it.origem === tipo) {
      const el = (n.elementos[layoutPeca] || []).find((e) => e.id === elId);
      if (el) noElemento(el);
      return;
    }
    const porPeca = n.ajustes[layoutPeca] = n.ajustes[layoutPeca] || {};
    const aj = porPeca[elId] = porPeca[elId] || {};
    noAjuste(aj);
    // "oculto" só fica gravado quando é diferente do que vem de cima.
    if ("oculto" in aj && !!aj.oculto === !!(acima && acima.el.oculto)) delete aj.oculto;
  });
}

// Posição/tamanho: no tamanho base é a caixa; noutro, o ajuste do tamanho.
function gravarCaixaLayout(elId, m, caixa) {
  const c = { x: arred1(caixa.x), y: arred1(caixa.y), w: arred1(caixa.w), h: arred1(caixa.h) };
  return mudarElementoNoEditor(elId,
    (el) => {
      if (m.ehBase) el.caixa = c;
      else (el.ajustes = el.ajustes || {})[m.tam] = c;
    },
    (aj) => {
      if (m.ehBase) aj.base = c;
      else (aj.tamanhos = aj.tamanhos || {})[m.tam] = c;
    });
}

function gravarEstiloLayout(elId, k, v) {
  return mudarElementoNoEditor(elId,
    (el) => { el[k] = v; },
    (aj) => { aj.estilo = { ...(aj.estilo || {}), [k]: v }; });
}

function gravarOcultoLayout(elId, oculto) {
  return mudarElementoNoEditor(elId,
    (el) => { if (oculto) el.oculto = true; else delete el.oculto; },
    (aj) => { aj.oculto = !!oculto; });
}

// Acrescenta um elemento pronto no nível editado (por cima das camadas).
function acrescentarElementoNoNivel(el) {
  if (nivelAtualTipo() === "geral") {
    elementosDaPeca(layoutPeca).push(el);
    salvarLayout(true);
    return Promise.resolve();
  }
  const ordemAtual = itensDoEditor().map((x) => x.el.id);
  return gravarNivelEditor((n) => {
    (n.elementos[layoutPeca] = n.elementos[layoutPeca] || []).push(el);
    // Com uma ordem própria gravada, o novo entra no topo dela.
    if (n.ordem[layoutPeca]) n.ordem[layoutPeca] = [...ordemAtual, el.id];
  });
}

// Sobe (+1) ou desce (-1) uma camada. No layout geral muda a ordem da lista;
// nos outros níveis grava a ordem deste nível.
function moverCamadaLayout(elId, delta) {
  const ids = itensDoEditor().map((x) => x.el.id);
  const i = ids.indexOf(elId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return Promise.resolve();
  [ids[i], ids[j]] = [ids[j], ids[i]];
  if (nivelAtualTipo() === "geral") {
    const els = elementosDaPeca(layoutPeca);
    els.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    salvarLayout(true);
    return Promise.resolve();
  }
  return gravarNivelEditor((n) => { n.ordem[layoutPeca] = ids; });
}

// Imagem própria de um elemento: PNG (600 dpi) ou EPS, enviado ao Drive.
async function escolherImagemDeElemento() {
  if (!exigirDriveProducao()) return null;
  const file = await escolherArquivos(".png,image/png,.eps,.ps,application/postscript");
  if (!file) return null;
  const pref = "elemento-" + (slugify(file.name.replace(/\.[^.]+$/, "")) || "imagem");
  try {
    if (/\.(eps|ps)$/i.test(file.name) || file.type === "application/postscript") {
      const d = await enviarEpsComPrevia(file, pref, 600);
      if (d.semPrevia) alert("A imagem foi enviada, mas a prévia não pôde ser desenhada. Ela aparece como uma caixa no editor.");
      return { formato: "eps", partes: d.partes, epsId: d.epsId, bbox: d.bbox, previaUrl: d.previaUrl, nomeArquivo: d.nomeArquivo };
    }
    const d = await enviarPngProducao(file, pref, (t) => estadoSalvarLayout(t ? `Imagem: ${t}` : ""));
    return d ? { formato: "png", ...d } : null;
  } catch (e) {
    console.error(e);
    alert(e.message || "Não foi possível enviar a imagem.");
    return null;
  } finally {
    avisoProducao("");
  }
}

// Proporção (altura / largura) do arquivo de um elemento de imagem.
function proporcaoDoArquivo(a) {
  if (!a) return 1;
  if (a.formato === "eps" && a.bbox) {
    const d = EPS.tamanhoMmDoBbox(a.bbox);
    return d.w ? d.h / d.w : 1;
  }
  return a.larguraPx ? a.alturaPx / a.larguraPx : 1;
}

async function adicionarElementoLayout(tipo) {
  const m = medidasLayout();
  if (!m) {
    alert("Envie o molde de corte desta peça na aba Tamanhos primeiro.");
    return;
  }
  const b = m.base;
  const el = { id: novoIdLayout("e"), tipo };
  if (tipo === "imagem") {
    const arquivo = await escolherImagemDeElemento();
    if (!arquivo) return;
    const w = b.w * 0.3;
    el.arquivo = arquivo;
    el.caixa = { x: (b.w - w) / 2, y: b.h * 0.3, w, h: w * proporcaoDoArquivo(arquivo) };
  } else if (tipo === "texto") {
    const texto = prompt("Texto (igual em todas as camisetas):", "");
    if (texto == null || !texto.trim()) return;
    el.texto = texto.trim();
    el.caixa = { x: b.w * 0.2, y: b.h * 0.1, w: b.w * 0.6, h: b.h * 0.05 };
  } else {
    el.caixa = tipo === "numero" ? { x: b.w * 0.3, y: b.h * 0.3, w: b.w * 0.4, h: b.h * 0.28 }
      : tipo === "nome" ? { x: b.w * 0.2, y: b.h * 0.18, w: b.w * 0.6, h: b.h * 0.07 }
        : tipo === "logo" ? caixaLogoInicial(b)
          : tipo === "detalhe" ? caixaDetalheInicial(b)
            : { x: b.w * 0.6, y: b.h * 0.15, w: b.w * 0.18, h: b.w * 0.2 };
  }
  ["x", "y", "w", "h"].forEach((k) => (el.caixa[k] = arred1(el.caixa[k])));
  if (!ehCaixaImagem(el)) {
    Object.assign(el, {
      campo: tipo === "nome" ? "nomeCamiseta" : tipo === "texto" ? "texto" : "numero",
      corCmyk: [0, 0, 0, 100], contornoMm: 0, contornoCmyk: [0, 0, 0, 0],
      alinhamento: "centro", ajuste: "encolher", maiusculas: true, espacamento: 0, usarNomeSeVazio: true
    });
  }
  layoutElSel = el.id;
  await acrescentarElementoNoNivel(el);
  renderizarPalcoLayout();
  renderizarPainelLayout();
}

// Selos da lista de camadas: o que o nível editado mudou num elemento herdado.
function seloAjusteTime(aj) {
  if (!aj) return "";
  const selos = [];
  if ("oculto" in aj) selos.push(aj.oculto ? '<span class="badge pendente">oculto</span>' : '<span class="badge aguardando">mostrado</span>');
  if (aj.base || aj.tamanhos) selos.push('<span class="badge aguardando">posição</span>');
  if (aj.estilo && Object.keys(aj.estilo).length) selos.push('<span class="badge aguardando">estilo</span>');
  return selos.length ? " " + selos.join(" ") : "";
}

// Selo de onde o elemento veio (quando não é do layout geral).
function seloOrigem(origem) {
  if (origem === "geral") return "";
  return ` <span class="badge origem-${origem}" title="Acrescentado no nível ${escAttr(NOME_NIVEL[origem])}">${origem === "goleiro" ? "🧤 " : ""}${escapeHtmlAdmin(NOME_NIVEL[origem])}</span>`;
}

// ---------------- Painel: camadas + o elemento escolhido ----------------

function renderizarPainelLayout() {
  const painel = document.getElementById("layoutPainel");
  if (!painel) return;
  const tipoNivel = nivelAtualTipo();
  const itens = itensDoEditor();
  const it = itens.find((x) => x.el.id === layoutElSel);
  const n = nivelDoEditor();
  const temOrdemPropria = !!(n && n.ordem && n.ordem[layoutPeca]);

  // Camadas de cima para baixo (a primeira da lista fica na frente).
  const linhas = itens.map((x, i) => {
    const el = x.el;
    const ajN = tipoNivel !== "geral" && x.origem !== tipoNivel ? ajusteDoNivel(layoutPeca, el.id) : null;
    return `<li class="camada${el.id === layoutElSel ? " ativo" : ""}${el.oculto ? " camada-oculta" : ""}" data-id="${escAttr(el.id)}">
      <button type="button" class="camada-olho" data-olho title="${el.oculto ? "Mostrar" : "Ocultar"}" aria-label="${el.oculto ? "Mostrar" : "Ocultar"}">${el.oculto ? "◌" : "👁"}</button>
      <span class="camada-nome">${escapeHtmlAdmin(rotuloElementoLayout(el))}${seloOrigem(x.origem)}${seloAjusteTime(ajN)}</span>
      <span class="camada-mover">
        <button type="button" data-mover="1" title="Subir (para a frente)" ${i === itens.length - 1 ? "disabled" : ""}>↑</button>
        <button type="button" data-mover="-1" title="Descer (para trás)" ${i === 0 ? "disabled" : ""}>↓</button>
      </span></li>`;
  }).reverse().join("");

  painel.innerHTML = `
    <div class="camadas-topo">
      <h4>Camadas — ${escapeHtmlAdmin(nomePecaProducao(layoutPeca))}</h4>
      ${temOrdemPropria ? '<button type="button" class="link-botao" data-ordem="voltar" title="Esquecer a ordem deste nível">Voltar à ordem de cima</button>' : ""}
    </div>
    <ul class="arte-lista-el arte-camadas">${linhas ||
      `<li class="pix-ajuda">Nada nesta peça — use + Imagem, + Texto, + Nome…</li>`}
      <li class="camada camada-fundo" title="A arte da peça fica sempre por baixo de tudo">🖼 Arte da peça (fundo)</li>
    </ul>
    <div id="layoutPainelEl"></div>`;
  painel.querySelectorAll("li[data-id]").forEach((li) => {
    const id = li.dataset.id;
    li.onclick = () => { layoutElSel = id; renderizarPalcoLayout(); renderizarPainelLayout(); };
    li.querySelector("[data-olho]").onclick = async (ev) => {
      ev.stopPropagation();
      const x = itens.find((y) => y.el.id === id);
      await gravarOcultoLayout(id, !(x && x.el.oculto));
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
    li.querySelectorAll("[data-mover]").forEach((b) => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        await moverCamadaLayout(id, Number(b.dataset.mover));
        renderizarPalcoLayout();
        renderizarPainelLayout();
      };
    });
  });
  const btOrdem = painel.querySelector('[data-ordem="voltar"]');
  if (btOrdem) {
    btOrdem.onclick = async () => {
      await gravarNivelEditor((x) => { delete x.ordem[layoutPeca]; });
      renderizarPalcoLayout();
      renderizarPainelLayout();
    };
  }

  const m = medidasLayout();
  if (!it || !m) return;
  const el = it.el;
  const dono = tipoNivel === "geral" || it.origem === tipoNivel;
  const aj = dono ? null : ajusteDoNivel(layoutPeca, el.id);
  const c = caixaNoEditor(el, m);
  const box = document.getElementById("layoutPainelEl");
  const temPosicao = !!(aj && (aj.base || aj.tamanhos));
  const temEstilo = !!(aj && aj.estilo && Object.keys(aj.estilo).length);
  const ehTexto = !ehCaixaImagem(el);
  const ajustesTam = dono && el.ajustes && el.ajustes[m.tam];

  let explica;
  if (tipoNivel === "geral") {
    explica = m.ehBase ? `Posição no tamanho base (${escapeHtmlAdmin(m.tam)}).`
      : ajustesTam ? `Ajuste próprio do tamanho ${escapeHtmlAdmin(m.tam)}.`
        : `Tamanho ${escapeHtmlAdmin(m.tam)}: proporcional ao base. Mexer aqui cria um ajuste só deste tamanho.`;
  } else if (dono) {
    explica = `Acrescentado neste nível (${escapeHtmlAdmin(NOME_NIVEL[tipoNivel])}): só aparece para ${escapeHtmlAdmin(alvoDoNivel())}.` +
      (m.ehBase ? "" : ajustesTam ? ` Ajuste próprio do tamanho ${escapeHtmlAdmin(m.tam)}.` : ` Tamanho ${escapeHtmlAdmin(m.tam)}: proporcional ao base.`);
  } else if (aj) {
    explica = `Ajustado aqui${temPosicao ? " (posição)" : ""}${temEstilo ? " (estilo)" : ""}${"oculto" in aj ? (aj.oculto ? " (oculto)" : " (mostrado)") : ""} — só para ${escapeHtmlAdmin(alvoDoNivel())}.`;
  } else {
    explica = `Vem de cima (${escapeHtmlAdmin(NOME_NIVEL[it.origem])}). Mudar qualquer coisa aqui cria um ajuste só para ${escapeHtmlAdmin(alvoDoNivel())}.`;
  }

  let html = `<p class="pix-ajuda">${explica}</p>
    <label class="checkbox-inline"><input type="checkbox" data-oculto ${el.oculto ? "checked" : ""} /> ${tipoNivel === "geral" ? "Ocultar (em todos os times)" : "Ocultar"}</label>
    <label>Nome da camada<input type="text" data-p="rotulo" value="${escAttr(el.rotulo || "")}" placeholder="${escAttr(rotuloElementoLayout({ ...el, rotulo: "" }))}" /></label>
    <div class="arte-grade arte-grade-4">
      <label>X (mm)<input type="number" step="0.5" data-cx="x" value="${c.x.toFixed(1)}" /></label>
      <label>Y (mm)<input type="number" step="0.5" data-cx="y" value="${c.y.toFixed(1)}" /></label>
      <label>Largura<input type="number" step="0.5" min="1" data-cx="w" value="${c.w.toFixed(1)}" /></label>
      <label>Altura<input type="number" step="0.5" min="1" data-cx="h" value="${c.h.toFixed(1)}" /></label>
    </div>
    ${ehTexto ? `<label class="arte-letra">Tamanho da letra (altura das maiúsculas, mm)
      <input type="number" step="0.5" min="1" data-letra value="${c.h.toFixed(1)}" /></label>` : ""}
    <div class="arte-botoes-el">
      <button type="button" class="secundario" data-acao="centralizar">Centralizar na largura</button>
      ${aj ? '<button type="button" class="secundario" data-acao="voltarGeral">Voltar ao de cima</button>' : ""}
      ${temPosicao && (temEstilo || "oculto" in aj) ? '<button type="button" class="secundario" data-acao="voltarPosicao">Voltar só a posição</button>' : ""}
      ${dono && !m.ehBase && ajustesTam ? '<button type="button" class="secundario" data-acao="semAjusteTam">Voltar ao proporcional</button>' : ""}
    </div>`;

  if (!ehTexto) {
    if (el.tipo === "imagem") {
      const a = el.arquivo || {};
      html += `<p class="pix-ajuda">Arquivo: <strong>${escapeHtmlAdmin(a.nomeArquivo || "—")}</strong>${a.formato ? ` (${a.formato.toUpperCase()})` : ""}</p>
        <div class="arte-botoes-el"><button type="button" class="secundario" data-acao="trocarImagem">Trocar imagem${dono ? "" : " (só aqui)"}</button></div>`;
    }
    html += `<label class="checkbox-inline"><input type="checkbox" data-proporcao ${EPS.imagemLivre(el) ? "" : "checked"} /> Manter proporção</label>
      <p class="pix-ajuda">Desmarque para esticar ${escapeHtmlAdmin(rotuloElementoLayout(el).toLowerCase())} na largura e na altura, cada uma no seu (a alça do canto e os campos passam a mexer só na medida escolhida).</p>`;
  } else {
    const cmyk = (nome, v) => `<div class="arte-cmyk" data-cor="${nome}">` +
      ["C", "M", "Y", "K"].map((l, i) =>
        `<label>${l}<input type="number" min="0" max="100" step="1" data-i="${i}" value="${Number((v || [])[i]) || 0}" /></label>`).join("") +
      `<span class="arte-amostra-cor" style="background:${cmykParaCss(v)}"></span></div>`;
    html += `
      <div class="arte-grade">
        ${el.tipo === "texto" ? `<label>Texto<input type="text" data-p="texto" value="${escAttr(el.texto || "")}" /></label>` : ""}
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
      <p class="pix-ajuda">A caixa é o limite: o texto comprido encolhe (ou é comprimido) para caber — nunca sai dela.</p>`;
  }
  html += `<div class="arte-botoes-el">
    <button type="button" class="secundario" data-acao="duplicar" title="${tipoNivel === "geral" ? "Cópia no layout geral" : `Cópia só para ${escAttr(alvoDoNivel())}`}">Duplicar</button>
    ${dono ? '<button type="button" class="perigo" data-acao="excluir">Excluir</button>' : ""}</div>`;
  box.innerHTML = html;

  const redesenhar = () => { renderizarPalcoLayout(); renderizarPainelLayout(); };
  const gravarEstilo = (k, v) => gravarEstiloLayout(el.id, k, v).then(redesenhar);

  box.querySelector("[data-oculto]").onchange = (ev) => gravarOcultoLayout(el.id, ev.target.checked).then(redesenhar);
  const chkProp = box.querySelector("[data-proporcao]");
  if (chkProp) chkProp.onchange = () => gravarEstilo("livre", !chkProp.checked);
  box.querySelectorAll("[data-cx]").forEach((inp) => {
    inp.onchange = () => {
      const nova = { ...c, [inp.dataset.cx]: Number(inp.value) || 0 };
      if (!ehTexto && !EPS.imagemLivre(el) && (inp.dataset.cx === "w" || inp.dataset.cx === "h")) {
        const prop = c.w / c.h;
        if (inp.dataset.cx === "w") nova.h = nova.w / prop; else nova.w = nova.h * prop;
      }
      gravarCaixaLayout(el.id, m, nova).then(redesenhar);
    };
  });
  const inpLetra = box.querySelector("[data-letra]");
  if (inpLetra) {
    // A altura da caixa é a altura das maiúsculas: muda pelo centro.
    inpLetra.onchange = () => {
      const h = Math.max(1, Number(inpLetra.value) || c.h);
      gravarCaixaLayout(el.id, m, { ...c, y: c.y + (c.h - h) / 2, h }).then(redesenhar);
    };
  }
  box.querySelectorAll("[data-p]").forEach((inp) => {
    if (inp.tagName === "SELECT") inp.value = el[inp.dataset.p] || inp.options[0].value;
    inp.onchange = () => {
      const k = inp.dataset.p;
      let v = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? Number(inp.value) || 0 : inp.value;
      if (k === "rotulo" || k === "texto") v = String(v).trim();
      gravarEstilo(k, v);
    };
  });
  box.querySelectorAll("[data-cor]").forEach((grupo) => {
    grupo.querySelectorAll("input").forEach((inp) => {
      inp.onchange = () => {
        gravarEstilo(grupo.dataset.cor, [0, 1, 2, 3].map((i) =>
          Math.max(0, Math.min(100, Number(grupo.querySelector(`[data-i="${i}"]`).value) || 0))));
      };
    });
  });
  box.querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.acao;
      if (a === "centralizar") {
        await gravarCaixaLayout(el.id, m, { ...c, x: (m.dim.w - c.w) / 2 });
      } else if (a === "voltarGeral") {
        await gravarNivelEditor((x) => { if (x.ajustes[layoutPeca]) delete x.ajustes[layoutPeca][el.id]; });
      } else if (a === "voltarPosicao") {
        await gravarNivelEditor((x) => {
          const y = x.ajustes[layoutPeca] && x.ajustes[layoutPeca][el.id];
          if (y) { delete y.base; delete y.tamanhos; }
        });
      } else if (a === "semAjusteTam") {
        await mudarElementoNoEditor(el.id, (e) => { if (e.ajustes) delete e.ajustes[m.tam]; }, () => {});
      } else if (a === "trocarImagem") {
        const arquivo = await escolherImagemDeElemento();
        if (!arquivo) return;
        await gravarEstiloLayout(el.id, "arquivo", arquivo);
      } else if (a === "duplicar") {
        // Cópia do elemento como está aqui, no nível editado.
        const copia = limparParaFirestore(el);
        copia.id = novoIdLayout("e");
        const cx = copia.caixa || c;
        copia.caixa = { ...cx, x: arred1(cx.x + 10), y: arred1(cx.y + 10) };
        delete copia.ajustes;
        delete copia.oculto;
        if (copia.rotulo) copia.rotulo += " (cópia)";
        layoutElSel = copia.id;
        await acrescentarElementoNoNivel(copia);
      } else if (a === "excluir") {
        if (!confirm(`Excluir "${rotuloElementoLayout(el)}" da peça ${nomePecaProducao(layoutPeca)}? Vale para ${alvoDoNivel()}.`)) return;
        if (tipoNivel === "geral") {
          const els = elementosDaPeca(layoutPeca);
          const i = els.findIndex((e) => e.id === el.id);
          if (i >= 0) els.splice(i, 1);
          salvarLayout(true);
        } else {
          await gravarNivelEditor((x) => {
            x.elementos[layoutPeca] = (x.elementos[layoutPeca] || []).filter((e) => e.id !== el.id);
            if (x.ordem[layoutPeca]) x.ordem[layoutPeca] = x.ordem[layoutPeca].filter((id) => id !== el.id);
          });
        }
        layoutElSel = "";
      }
      redesenhar();
    };
  });
}

// ============================================================
// GERAÇÃO DA FOLHA EPS
// ============================================================

// Carrega o que o time usa: fonte, brasão, moldes dos tamanhos pedidos e as
// artes (convertidas para CMYK na resolução de saída).
// `lay`: o layout já resolvido (padrão: o do time, com os níveis).
async function carregarRecursosDoTime(time, tamanhos, pecasIds, dpiSaida, aviso, lay) {
  const pako = await carregarLib("pako");
  const prod = producaoDoTime(time);
  const layout = lay || layoutDoTime(time);
  const elementosDe = (pecaId) => (layout.pecas[pecaId] && layout.pecas[pecaId].elementos) || [];
  const rec = { eps: {}, imagens: {}, fonte: null, fonteEtiqueta: null };
  if (prod.fonte && prod.fonte.partes) {
    aviso("Carregando a fonte…");
    rec.fonte = rec.fonteEtiqueta = await obterFonte(prod.fonte.partes);
  }
  const lerEps = async (ref, bbox) => {
    const bytes = await baixarArquivoDrive(driveScriptUrl, ref);
    return { bytes: EPS.extrairPostScript(bytes), bbox: bbox || EPS.lerBoundingBox(bytes) };
  };
  const usaLogo = pecasIds.some((id) => elementosDe(id).some((e) => e.tipo === "logo"));
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
  // Elementos de imagem acrescentados no layout (PNG ou EPS de cada um).
  const imagens = [];
  for (const pecaId of pecasIds) {
    const ad = EPS.arteDaPeca(prod, pecaId);
    if (ad) imagens.push({ chave: ad.chave, img: ad.arte, nome: nomePecaProducao(pecaId) });
    const usaDetalhe = elementosDe(pecaId).some((e) => e.tipo === "detalhe");
    const d = usaDetalhe && EPS.detalheDaPeca(prod, pecaId);
    if (d) imagens.push({ chave: d.chave, img: d.img, nome: "detalhe da manga" });
    for (const el of elementosDe(pecaId)) {
      const a = el.tipo === "imagem" && el.arquivo;
      if (!a) continue;
      const chave = EPS.chaveDoElemento(el);
      if (a.formato === "eps") {
        if (rec.eps[chave]) continue;
        aviso(`Carregando a imagem ${rotuloElementoLayout(el)}…`);
        rec.eps[chave] = await lerEps(a.partes || a.epsId, a.bbox);
      } else {
        imagens.push({ chave, img: a, nome: rotuloElementoLayout(el) });
      }
    }
  }
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
    EPS.arteDaPeca(prod, id) || elementosDoTime(time, id).length);
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
      const { blocos, avisos: avB } = EPS.montarBlocos(moldesConfig, layoutDoTime(time), timeSemAjustes(time), g.camisetas, rec,
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
    // O layout do nível aberto no editor (geral, cliente ou time).
    const lay = layoutComNiveis(niveisDoEditor());
    const rec = await carregarRecursosDoTime(time, [m.tam], [layoutPeca], 150, avisoProducao, lay);
    const { blocos, avisos } = EPS.montarBlocos(moldesConfig, lay, timeSemAjustes(time),
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
