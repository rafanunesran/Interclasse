// ============================================================
// FUNÇÕES E DADOS COMPARTILHADOS
// ============================================================

// Nome da coleção dos times no Firestore. O produto chama de "time" o que
// antes se chamava "turma"; a coleção continua com o nome antigo ("turmas")
// para não quebrar os dados já cadastrados — só o nome interno ficou para trás.
const COL_TIMES = "turmas";

// Coleção dos clientes: cada cliente tem os seus próprios times/pedidos.
const COL_CLIENTES = "clientes";

// Coleção das levas de produção ("mandar para produção"): cada documento é uma
// leva, e a subcoleção `itens` guarda as camisetas escolhidas para ela — de
// times diferentes, de clientes diferentes ou avulsas (professores, reposição).
const COL_PRODUCAO = "producao";
const SUB_ITENS_PRODUCAO = "itens";

// Peças da camiseta na produção. Cada time envia a arte (PNG 600 dpi) de cada
// peça; na aba Tamanhos fica o molde de corte (EPS) de cada peça em cada
// tamanho; na aba Artes, o layout (brasão, nome e número) de cada peça.
const PECAS_PRODUCAO = [
  { id: "frente", nome: "Frente" },
  { id: "costas", nome: "Costas" },
  { id: "mangaEsq", nome: "Manga esquerda" },
  { id: "mangaDir", nome: "Manga direita" },
  { id: "detalheMangaEsq", nome: "Detalhe da manga esquerda" },
  { id: "detalheMangaDir", nome: "Detalhe da manga direita" }
];

function nomePecaProducao(id) {
  const p = PECAS_PRODUCAO.find((x) => x.id === id);
  return p ? p.nome : id;
}

// Tamanhos padrão (usados quando ainda não há nada salvo no Firestore
// ou para restaurar o padrão no painel administrativo). NÃO alterar em runtime.
const TAMANHOS_PADRAO = [
  { grupo: "Infantil", tamanhos: ["10", "12", "14", "16"] },
  { grupo: "Normal", tamanhos: ["P", "M", "G", "GG"] },
  { grupo: "Plus Size", tamanhos: ["G1", "G2", "G3", "G4"] }
];

// Tamanhos disponíveis, agrupados para o <select>. Começam com o padrão e
// podem ser substituídos pelo que estiver salvo em config/tamanhos.
let GRUPOS_TAMANHO = clonarGrupos(TAMANHOS_PADRAO);

// Lista simples de todos os tamanhos, na ordem de exibição do resumo.
let TODOS_TAMANHOS = GRUPOS_TAMANHO.flatMap((g) => g.tamanhos);

// Cópia profunda simples dos grupos de tamanho (preserva custos e a imagem
// de referência de medidas, quando houver).
function clonarGrupos(grupos) {
  return grupos.map((g) => {
    const copia = { grupo: g.grupo, tamanhos: [...g.tamanhos] };
    if (g.custoImpressao != null) copia.custoImpressao = g.custoImpressao;
    if (g.custoCostureira != null) copia.custoCostureira = g.custoCostureira;
    if (g.imagemUrl) copia.imagemUrl = g.imagemUrl;
    return copia;
  });
}

// Carrega os tamanhos salvos em config/tamanhos (se existirem) e atualiza
// GRUPOS_TAMANHO / TODOS_TAMANHOS. Em caso de erro, mantém o padrão.
async function carregarTamanhos() {
  try {
    const doc = await db.collection("config").doc("tamanhos").get();
    const grupos = doc.exists ? doc.data().grupos : null;
    if (Array.isArray(grupos) && grupos.length > 0) {
      GRUPOS_TAMANHO = clonarGrupos(grupos);
      TODOS_TAMANHOS = GRUPOS_TAMANHO.flatMap((g) => g.tamanhos);
    }
  } catch (erro) {
    console.warn("Não foi possível carregar os tamanhos do Firestore; usando o padrão.", erro);
  }
}

// Lê as configurações gerais (config/geral). Retorna {} se não existir.
async function carregarConfigGeral() {
  try {
    const doc = await db.collection("config").doc("geral").get();
    return doc.exists ? doc.data() : {};
  } catch (erro) {
    console.warn("Não foi possível carregar as configurações gerais.", erro);
    return {};
  }
}

// Aplica as configurações gerais à página atual (título e rodapé), quando definidas.
function aplicarConfigGeral(cfg) {
  if (!cfg) return;
  if (cfg.tituloEvento) {
    const h1 = document.querySelector("header.topo h1");
    if (h1) h1.textContent = "👕 " + cfg.tituloEvento;
    document.title = cfg.tituloEvento;
  }
  if (cfg.rodape) {
    document.querySelectorAll(".rodape").forEach((el) => (el.textContent = cfg.rodape));
  }
}

function preencherSelectTamanhos(selectEl) {
  selectEl.innerHTML = '<option value="">Selecione...</option>';
  GRUPOS_TAMANHO.forEach(({ grupo, tamanhos }) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = grupo;
    tamanhos.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      optgroup.appendChild(opt);
    });
    selectEl.appendChild(optgroup);
  });
}

// Escapa texto para inserir com segurança em HTML (evita quebrar o layout
// ou injetar marcação a partir de nomes de time digitados no admin).
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function slugify(texto) {
  const marcasDiacriticas = new RegExp("[" + "̀" + "-" + "ͯ" + "]", "g");
  return texto
    .toString()
    .normalize("NFD")
    .replace(marcasDiacriticas, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Texto "achatado" para comparar/buscar: sem acentos, minúsculo e sem espaços
// sobrando. É o que faz "joao" encontrar "João" e "3o ano" encontrar "3º Ano"
// — os indicadores ordinais (º ª) e o sinal de grau viram letra, porque cada
// um digita o nome do time de um jeito.
function normalizarTexto(texto) {
  const marcasDiacriticas = new RegExp("[" + "\u0300" + "-" + "\u036f" + "]", "g");
  return String(texto ?? "")
    .normalize("NFD")
    .replace(marcasDiacriticas, "")
    .replace(/[\u00ba\u00b0]/g, "o") // º e °
    .replace(/\u00aa/g, "a")          // ª
    .toLowerCase()
    .trim();
}

function formatarData(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const d = timestamp.toDate();
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Gera e baixa um CSV. `linhas` é um array de arrays (primeira linha = cabeçalho).
// Usa ";" como delimitador (padrão de configuração regional brasileira no Excel)
// e adiciona BOM UTF-8 para acentos aparecerem corretamente no Excel/CorelDraw.
// `opcoes`: { separador (padrão ";"), bom (padrão true) }. O BOM faz o Excel
// abrir os acentos certos, mas atrapalha quem lê o arquivo campo a campo — ele
// gruda no primeiro valor da primeira linha —, por isso o CSV de produção não usa.
function baixarCSV(nomeArquivo, linhas, opcoes) {
  const { separador, bom } = opcoes || {};
  const sep = separador || ";";
  const escapar = (valor) => {
    const texto = String(valor ?? "");
    // Aspas em volta quando o valor tem o separador, aspas ou quebra de linha.
    if (texto.includes(sep) || /["\n]/.test(texto)) {
      return '"' + texto.replace(/"/g, '""') + '"';
    }
    return texto;
  };

  const conteudo = linhas.map((linha) => linha.map(escapar).join(sep)).join("\r\n");
  const BOM = bom === false ? "" : "﻿";
  const blob = new Blob([BOM + conteudo], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================
// CLIENTES — cada cliente tem os seus próprios times (pedidos)
// ============================================================

// Valor usado nos filtros para "times que ainda não têm cliente". Não pode
// colidir com um id de verdade: slugify() nunca gera "_".
const SEM_CLIENTE = "__sem_cliente__";

// Como os times sem cliente aparecem nas listas e nos relatórios.
const SEM_CLIENTE_NOME = "Sem cliente";

// Id do cliente de um time ("" quando o time ainda não foi atribuído).
function clienteIdDoTime(time) {
  const id = time && time.clienteId;
  return typeof id === "string" ? id : "";
}

// Lê a coleção de clientes e devolve [{ id, nome, ... }] ordenado por nome.
// Devolve [] se não houver nenhum (o site funciona sem clientes cadastrados).
async function carregarClientes() {
  try {
    const snap = await db.collection(COL_CLIENTES).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
  } catch (erro) {
    console.warn("Não foi possível carregar os clientes.", erro);
    return [];
  }
}

// Nome do cliente de um time, a partir de uma lista/mapa de clientes.
// Sem cliente (ou cliente já excluído) cai no rótulo padrão.
function nomeDoCliente(clientes, clienteId) {
  if (!clienteId) return SEM_CLIENTE_NOME;
  const lista = Array.isArray(clientes) ? clientes : Object.values(clientes || {});
  const c = lista.find((x) => x.id === clienteId);
  return (c && c.nome) || SEM_CLIENTE_NOME;
}

// Um time pertence ao cliente escolhido no filtro? Filtro vazio = todos.
function timeDoCliente(time, filtro) {
  if (!filtro) return true;
  const id = clienteIdDoTime(time);
  return filtro === SEM_CLIENTE ? !id : id === filtro;
}

// ============================================================
// PIX — gera o "copia e cola" (BR Code / padrão EMV do Banco Central)
// ============================================================

// Monta um campo TLV: id + tamanho(2 dígitos) + valor.
function pixCampo(id, valor) {
  return id + String(valor.length).padStart(2, "0") + valor;
}

// Limpa texto para os campos de nome/cidade (sem acentos, só ASCII, maiúsculo).
function pixLimparTexto(txt, max) {
  return (txt || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase()
    .slice(0, max)
    .trim();
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF) exigido pelo padrão PIX.
function pixCrc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Gera o código "copia e cola" do PIX. `valor` em reais (número) ou null/0
// para não embutir valor (o pagador digita no app do banco).
function pixCopiaECola({ chave, nome, cidade, valor }) {
  const nomeLimpo = pixLimparTexto(nome, 25) || "RECEBEDOR";
  const cidadeLimpa = pixLimparTexto(cidade, 15) || "CIDADE";

  const mai = pixCampo("26", pixCampo("00", "br.gov.bcb.pix") + pixCampo("01", chave));
  const valorCampo = valor && Number(valor) > 0 ? pixCampo("54", Number(valor).toFixed(2)) : "";
  const adicional = pixCampo("62", pixCampo("05", "***"));

  const semCrc =
    pixCampo("00", "01") +
    mai +
    pixCampo("52", "0000") +
    pixCampo("53", "986") +
    valorCampo +
    pixCampo("58", "BR") +
    pixCampo("59", nomeLimpo) +
    pixCampo("60", cidadeLimpa) +
    adicional +
    "6304";

  return semCrc + pixCrc16(semCrc);
}

// Descobre o preço de um tamanho a partir do mapa preços-por-grupo.
function precoDoTamanho(tamanho, precosPorGrupo) {
  if (!precosPorGrupo) return null;
  const grupo = GRUPOS_TAMANHO.find((g) => g.tamanhos.includes(tamanho));
  if (grupo && precosPorGrupo[grupo.grupo] != null) return Number(precosPorGrupo[grupo.grupo]);
  return null;
}

// ---------------- Preços personalizados por time ----------------
// A tabela geral (config/geral -> precosPorGrupo) vale para todo mundo.
// Cada time pode ter preços próprios em config/geral -> precosPorTime:
//   precosPorTime: { "3o-ano-a-manha": { "Normal": 50, "Plus Size": 60 } }
// A personalização é grupo a grupo: o que o time não define continua
// usando o preço geral. Fica em config/geral (e não no time) porque só o
// admin grava nesse documento — assim o representante não muda o próprio preço.

// Só os preços personalizados de um time (mapa {grupo: valor}), sem os gerais.
// Mapa {timeId: {grupo: valor}} guardado em config/geral. "precosPorTurma" é
// o nome antigo do campo, ainda lido para não perder os preços já salvos.
function mapaPrecosPorTime(cfg) {
  return (cfg && (cfg.precosPorTime || cfg.precosPorTurma)) || {};
}

function precosPersonalizadosDoTime(cfg, timeId) {
  const mapa = mapaPrecosPorTime(cfg)[timeId] || {};
  const saida = {};
  Object.keys(mapa).forEach((g) => {
    const v = Number(mapa[g]);
    if (mapa[g] != null && !isNaN(v)) saida[g] = v;
  });
  return saida;
}

// Preços que valem de fato num time: os gerais com o personalizado por cima.
function precosDoTime(cfg, timeId) {
  const geral = (cfg && cfg.precosPorGrupo) || {};
  const efetivos = {};
  Object.keys(geral).forEach((g) => {
    const v = Number(geral[g]);
    if (geral[g] != null && !isNaN(v)) efetivos[g] = v;
  });
  const proprios = precosPersonalizadosDoTime(cfg, timeId);
  Object.keys(proprios).forEach((g) => (efetivos[g] = proprios[g]));
  return efetivos;
}

// Preço de um tamanho já considerando o preço personalizado do time.
function precoDoTamanhoNoTime(tamanho, cfg, timeId) {
  return precoDoTamanho(tamanho, precosDoTime(cfg, timeId));
}

// Grupo de tamanho ao qual um tamanho pertence (ou null).
function grupoDoTamanho(tamanho) {
  return GRUPOS_TAMANHO.find((g) => g.tamanhos.includes(tamanho)) || null;
}

// Custo de impressão unitário de um tamanho (a partir do grupo).
function custoImpressaoDoTamanho(tamanho) {
  const grupo = grupoDoTamanho(tamanho);
  return grupo ? Number(grupo.custoImpressao || 0) : 0;
}

// Custo de costureira unitário de um tamanho (a partir do grupo).
function custoCostureiraDoTamanho(tamanho) {
  const grupo = grupoDoTamanho(tamanho);
  return grupo ? Number(grupo.custoCostureira || 0) : 0;
}

// Custo unitário total (Impressão + Costureira) de um tamanho.
function custoDoTamanho(tamanho) {
  return custoImpressaoDoTamanho(tamanho) + custoCostureiraDoTamanho(tamanho);
}

// Formata um número como moeda BRL (ex.: 45 -> "R$ 45,00").
function formatarReais(valor) {
  return "R$ " + Number(valor || 0).toFixed(2).replace(".", ",");
}

// Retorna o HTML do badge de status de pagamento de um aluno.
function badgePagamentoHtml(aluno) {
  // Camiseta interna (produção própria): custo entra no financeiro, sem receita.
  if (aluno.pago && aluno.pagamentoForma === "interno") {
    return '<span class="badge interno">Interno</span>';
  }
  if (aluno.pago) {
    const forma =
      aluno.pagamentoForma === "pix" ? " (PIX)" :
      aluno.pagamentoForma === "dinheiro" ? " (dinheiro)" : "";
    return `<span class="badge pago">Pago${forma}</span>`;
  }
  if (aluno.pagamentoDeclarado) {
    return '<span class="badge aguardando">Aguardando confirmação</span>';
  }
  return '<span class="badge pendente">Pendente</span>';
}

// ---------------- Produção (o que vai ser impresso) ----------------

// Só entra na produção quem já pagou (a camiseta interna conta como paga).
// Quem não pagou fica pendente e não vai para a impressão.
function alunoSeraProduzido(aluno) {
  return !!(aluno && aluno.pago);
}

// Separa a lista em quem será produzido e quem ficou pendente.
function separarProducao(alunos) {
  const lista = alunos || [];
  return {
    produzir: lista.filter(alunoSeraProduzido),
    pendentes: lista.filter((a) => !alunoSeraProduzido(a))
  };
}

// Nome que vai estampado nas costas (cai para o nome do estudante se vazio).
function nomeNaCamiseta(aluno) {
  return String((aluno && (aluno.nomeCamiseta || aluno.nome)) || "").trim();
}

// Modelo de camiseta de um time: é a arte que vai ser impressa. Por padrão é o
// próprio nome do time (cada time tem a sua arte), mas dá para dar um nome de
// modelo no "Editar time" — assim dois times que usam a MESMA arte saem juntos
// num arquivo só, e um time cuja arte é diferente sai separado.
const MODELO_PADRAO = "Sem modelo";

function modeloDoTime(time) {
  const m = time && time.modeloCamiseta;
  const texto = String(m || "").trim();
  if (texto) return texto;
  return String((time && time.nome) || MODELO_PADRAO).trim() || MODELO_PADRAO;
}

// ============================================================
// GOLEIRO — camiseta de cor especial
// ============================================================
// O goleiro veste uma camiseta de cor diferente, para ser identificado em
// quadra. Aqui isso é só uma marca na camiseta (o campo `goleiro` do aluno):
// quem cuida da lista do time (com a senha do time) e o Super Admin marcam e
// desmarcam, e a produção separa essas camisetas das demais — cor diferente
// quer dizer arquivo de impressão diferente.

function ehGoleiro(aluno) {
  return !!(aluno && aluno.goleiro);
}

// Marca do goleiro para as listas que não têm a coluna de marcar (produção,
// levas, conferência). Onde dá para editar, quem manda é a caixa de marcar.
function badgeGoleiroHtml(aluno) {
  return ehGoleiro(aluno)
    ? '<span class="badge goleiro" title="Goleiro — camiseta de cor especial">🧤 Goleiro</span>'
    : "";
}

// Caixa de marcar o goleiro — a mesma na página do time e no Super Admin.
// `aoMudar(valor, chk)` é chamada a cada clique quando a marca grava na hora;
// sem ela, a caixa só fica ali para ser lida ao salvar a linha inteira (é o
// caso da edição). O rótulo devolvido expõe a caixa em `.chk`.
function criarCheckGoleiro(aluno, aoMudar) {
  return criarCheckMarca(aluno, {
    classe: "check-goleiro",
    titulo: "Goleiro — camiseta de cor especial",
    icone: "🧤",
    palavra: "goleiro",
    marcado: ehGoleiro(aluno)
  }, aoMudar);
}

// Caixa de marcar genérica das colunas de marca da lista (Goleiro, Prof).
function criarCheckMarca(aluno, cfg, aoMudar) {
  const rotulo = document.createElement("label");
  rotulo.className = cfg.classe;
  rotulo.title = cfg.titulo;

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = !!cfg.marcado;
  chk.setAttribute("aria-label",
    "Marcar " + ((aluno && aluno.nome) || "esta camiseta") + " como " + cfg.palavra);

  // Ícone e palavra são separados de propósito: no celular a palavra some
  // (CSS) para a coluna não alargar a tabela, e o ícone continua identificando.
  const icone = document.createElement("span");
  icone.className = cfg.classe + "-icone";
  icone.textContent = cfg.icone;
  const texto = document.createElement("span");
  texto.className = cfg.classe + "-texto";

  const pintar = () => {
    icone.hidden = !chk.checked;
    texto.textContent = chk.checked ? cfg.palavra : "marcar";
  };
  pintar();

  chk.onchange = () => {
    pintar();
    if (aoMudar) aoMudar(chk.checked, chk);
  };

  rotulo.appendChild(chk);
  rotulo.appendChild(icone);
  rotulo.appendChild(texto);
  rotulo.chk = chk;
  return rotulo;
}

// ============================================================
// PROF — camiseta de professor
// ============================================================
// Marca só de organização (o campo `prof` do aluno): ajuda a separar e
// entregar as camisetas dos professores. Não muda nada na produção — a
// camiseta sai no mesmo CSV e na mesma leva das demais.

function ehProf(aluno) {
  return !!(aluno && aluno.prof);
}

function badgeProfHtml(aluno) {
  return ehProf(aluno)
    ? '<span class="badge prof" title="Camiseta de professor">🎓 Prof</span>'
    : "";
}

function criarCheckProf(aluno, aoMudar) {
  return criarCheckMarca(aluno, {
    classe: "check-prof",
    titulo: "Camiseta de professor (só para organização)",
    icone: "🎓",
    palavra: "prof",
    marcado: ehProf(aluno)
  }, aoMudar);
}

// Separa os goleiros do resto da lista.
function separarGoleiros(itens) {
  const lista = itens || [];
  return {
    goleiros: lista.filter(ehGoleiro),
    demais: lista.filter((i) => !ehGoleiro(i))
  };
}

// Na produção, o goleiro vira uma variação do modelo: como a cor da camiseta
// é outra, ele não pode sair no mesmo arquivo de impressão do restante.
const SUFIXO_MODELO_GOLEIRO = " — goleiro";

function modeloComGoleiro(modelo, goleiro) {
  const base = String(modelo || MODELO_PADRAO).trim() || MODELO_PADRAO;
  return goleiro ? base + SUFIXO_MODELO_GOLEIRO : base;
}

// Nome de arquivo irmão ("producao-time.csv" + "-goleiros" ->
// "producao-time-goleiros.csv").
function nomeComSufixo(nomeArquivo, sufixo) {
  const base = String(nomeArquivo || "").replace(/\.csv$/i, "");
  return base + sufixo + ".csv";
}

// CSV de produção com os goleiros à parte: o arquivo principal sai igual ao de
// sempre (mesmo nome, mesmo formato) e, SÓ se houver goleiro na lista, sai
// também um "-goleiros.csv" com eles. Devolve as contagens de cada arquivo.
function baixarCSVProducaoSeparado(nomeArquivo, alunos) {
  const produzir = (alunos || []).filter(alunoSeraProduzido);
  const { goleiros, demais } = separarGoleiros(produzir);

  if (demais.length > 0) baixarCSVProducaoItens(nomeArquivo, demais);
  if (goleiros.length > 0) {
    // O navegador barra dois downloads disparados no mesmo instante: o
    // segundo arquivo sai logo depois, com um respiro.
    const nomeGoleiros = nomeComSufixo(nomeArquivo, "-goleiros");
    if (demais.length === 0) baixarCSVProducaoItens(nomeGoleiros, goleiros);
    else setTimeout(() => baixarCSVProducaoItens(nomeGoleiros, goleiros), 400);
  }
  return { goleiros: goleiros.length, demais: demais.length };
}

// Uma linha do CSV de produção: nome na camiseta (A), número (B), tamanho (C).
function linhaProducaoDe(item) {
  return [nomeNaCamiseta(item), (item && item.numero) || "", (item && item.tamanho) || ""];
}

// CSV no padrão do programa de impressão a partir de itens JÁ escolhidos, sem
// filtrar por pagamento: quem decide o que entra é o Super Admin, na aba
// Produção (é assim que dá para adiantar camisetas ainda não pagas — as dos
// professores, por exemplo). Devolve quantas linhas foram geradas.
function baixarCSVProducaoItens(nomeArquivo, itens) {
  const linhas = (itens || []).map(linhaProducaoDe);
  if (linhas.length === 0) return 0;
  baixarCSV(nomeArquivo, linhas, { separador: ",", bom: false });
  return linhas.length;
}

// CSV no padrão do programa de impressão: SEM cabeçalho e separado por vírgula,
// com nome na camiseta (coluna A), número (B) e tamanho (C). Só entram as
// camisetas que serão produzidas. Devolve quantas linhas foram geradas.
function baixarCSVProducao(nomeArquivo, alunos) {
  return baixarCSVProducaoItens(nomeArquivo, (alunos || []).filter(alunoSeraProduzido));
}

// Marca, nas etapas de produção, quem ficou de fora dela por não ter pago.
function badgeProducaoHtml(time, aluno) {
  if (!pedidoEmProducao(time) || alunoSeraProduzido(aluno)) return "";
  return '<span class="badge pendente" title="Não foi pago até a impressão, então não entra nesta produção">Fora da produção</span>';
}

// Camiseta interna: paga como "interno" (produção própria, sem receita).
function ehInterno(aluno) {
  return !!(aluno && aluno.pago && aluno.pagamentoForma === "interno");
}

// Normaliza um telefone para o formato do WhatsApp (só dígitos, com DDI).
// Se vier com 10/11 dígitos (DDD + número), assume Brasil e prefixa 55.
function normalizarTelefoneWhats(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (!d) return "";
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) d = "55" + d;
  return d;
}

// Monta o link wa.me com texto pré-preenchido (ou "" se telefone inválido).
function linkWhatsapp(tel, texto) {
  const fone = normalizarTelefoneWhats(tel);
  if (fone.length < 10) return "";
  return "https://wa.me/" + fone + "?text=" + encodeURIComponent(texto || "");
}

// Formata um telefone brasileiro para exibir: "(11) 91234-5678".
// Se não reconhecer o formato, devolve o que foi digitado, sem inventar nada.
function formatarTelefone(tel) {
  const texto = String(tel || "").trim();
  let d = texto.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return texto;
}

// ---------------- Representante do time (contato rápido) ----------------

// Contato do representante guardado no time ({ nome, telefone }).
function contatoDoTime(time) {
  return {
    nome: String((time && time.representanteNome) || "").trim(),
    telefone: String((time && time.representanteTelefone) || "").trim()
  };
}

function timeTemContato(time) {
  const c = contatoDoTime(time);
  return !!(c.nome || c.telefone);
}

// Mensagem que já vai escrita no WhatsApp, para não começar do zero.
function mensagemParaRepresentante(time) {
  const c = contatoDoTime(time);
  const primeiroNome = c.nome ? c.nome.split(/\s+/)[0] : "";
  const nomeTime = (time && time.nome) || "";
  return (
    (primeiroNome ? `Olá, ${primeiroNome}! ` : "Olá! ") +
    `Aqui é da organização do interclasse, sobre o pedido de camisetas do time ${nomeTime}` +
    ` (situação: ${labelStatus(statusPedidoDe(time))}).`
  );
}

// Link do WhatsApp do representante ("" quando não dá para abrir).
function linkRepresentante(time) {
  const c = contatoDoTime(time);
  return linkWhatsapp(c.telefone, mensagemParaRepresentante(time));
}

// Formata um instante em millis (Date.now()) como "dd/mm/aaaa hh:mm".
function formatarMillis(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Campos da camiseta que podem ser corrigidos por um pedido de ajuste.
const CAMPOS_AJUSTE = [
  { key: "nome", label: "Nome" },
  { key: "tamanho", label: "Tamanho" },
  { key: "numero", label: "Número" },
  { key: "nomeCamiseta", label: "Nome na camiseta" }
];

// HTML da proposta de ajuste (valor atual → valor sugerido), quando houver.
function propostaAjusteHtml(aluno) {
  const p = aluno && aluno.ajusteProposto;
  if (!p || typeof p !== "object") return "";
  const linhas = CAMPOS_AJUSTE
    .filter((c) => p[c.key] !== undefined)
    .map((c) => {
      const de = (aluno[c.key] === undefined || aluno[c.key] === "") ? "-" : String(aluno[c.key]);
      const para = (p[c.key] === undefined || p[c.key] === "") ? "-" : String(p[c.key]);
      return `<li>${c.label}: <span class="prop-de">${escaparHtml(de)}</span> → <span class="prop-para">${escaparHtml(para)}</span></li>`;
    })
    .join("");
  if (!linhas) return "";
  const obs = aluno.ajusteMotivo ? `<div class="prop-obs">Obs.: ${escaparHtml(aluno.ajusteMotivo)}</div>` : "";
  return `<div class="ajuste-proposto"><strong>Ajuste solicitado</strong><ul>${linhas}</ul>${obs}</div>`;
}

// Resumo em texto das mudanças propostas (para histórico/CSV).
function resumoMudancasAjuste(aluno, proposto) {
  return CAMPOS_AJUSTE
    .filter((c) => proposto[c.key] !== undefined)
    .map((c) => {
      const de = (aluno[c.key] === undefined || aluno[c.key] === "") ? "-" : String(aluno[c.key]);
      return `${c.label}: ${de} → ${proposto[c.key] || "-"}`;
    })
    .join("; ");
}

// HTML do histórico de ajustes de uma unidade (solicitações e resoluções).
function historicoAjusteHtml(aluno) {
  const h = aluno && Array.isArray(aluno.ajusteHistorico) ? aluno.ajusteHistorico : [];
  if (h.length === 0) return "";
  const itens = h
    .slice()
    .sort((a, b) => (a.em || 0) - (b.em || 0))
    .map((e) => {
      const quando = formatarMillis(e.em);
      const label = e.tipo === "resolvido" ? "Ajuste resolvido" : "Ajuste solicitado";
      const detalhe = e.mudancas ? " — " + escaparHtml(e.mudancas) : (e.motivo ? ": " + escaparHtml(e.motivo) : "");
      const obs = e.mudancas && e.motivo ? ` (${escaparHtml(e.motivo)})` : "";
      return `<li>${quando ? quando + " — " : ""}${label}${detalhe}${obs}</li>`;
    })
    .join("");
  // <details> recolhível (fechado por padrão) para não alongar a página.
  return `<details class="hist-ajuste"><summary>Histórico de ajustes (${h.length})</summary><ul>${itens}</ul></details>`;
}

// ============================================================
// STATUS DO PEDIDO (etapas do time)
// ============================================================
const STATUS_PEDIDO = [
  { id: "aberto", label: "Aberto" },
  { id: "fechado", label: "Fechado" },
  { id: "pagamento_andamento", label: "Pagamento em andamento" },
  { id: "pagamento_encerrado", label: "Pagamento encerrado" },
  { id: "impressao", label: "Impressão" },
  { id: "costura", label: "Costura" },
  { id: "logistica", label: "Logística" },
  { id: "entregue", label: "Entregue ao representante" },
  // Última etapa: o pedido acabou de vez e vai para o ARQUIVO — sai da lista
  // principal e do Kanban do painel e da tela inicial, mas continua existindo
  // (e contando no Financeiro). Para desarquivar, basta trocar o status.
  { id: "finalizado", label: "Finalizado" },
  // Status especiais (fora da linha do tempo): param tudo para os usuários —
  // sem cadastrar/editar nomes e sem receber pagamento. Só o admin muda.
  // "Suspenso" é a pausa temporária (o pedido volta de onde parou);
  // "Bloqueado" é a trava por decisão da organização (pendência com o cliente,
  // pedido em disputa...), até que ela mesma resolva e devolva o status.
  { id: "suspenso", label: "Suspenso" },
  { id: "bloqueado", label: "Bloqueado" }
];

// Status que NÃO fazem parte da linha do tempo do pedido: ficam fora da barra
// de etapas e travam o pedido, apesar de virem no fim da lista acima.
const STATUS_FORA_DA_LINHA = ["suspenso", "bloqueado"];

function statusForaDaLinha(statusId) {
  return STATUS_FORA_DA_LINHA.includes(statusId);
}

// Status atual do time (com compatibilidade para times antigos que só têm `fechado`).
function statusPedidoDe(time) {
  if (time && time.statusPedido) return time.statusPedido;
  return time && time.fechado ? "fechado" : "aberto";
}

function indiceStatus(id) {
  return STATUS_PEDIDO.findIndex((s) => s.id === id);
}

function labelStatus(id) {
  const s = STATUS_PEDIDO.find((x) => x.id === id);
  return s ? s.label : id;
}

// Pedido finalizado: arquivado (fora das listas do dia a dia).
function pedidoFinalizado(time) {
  return statusPedidoDe(time) === "finalizado";
}

// O time está aberta para o representante editar quando o status é "aberto".
function pedidoAberto(time) {
  return statusPedidoDe(time) === "aberto";
}

// Pedido suspenso: tudo parado para os usuários (sem cadastro e sem pagamento).
function pedidoSuspenso(time) {
  return statusPedidoDe(time) === "suspenso";
}

// Pedido bloqueado: mesma trava do suspenso, mas por decisão da organização.
function pedidoBloqueado(time) {
  return statusPedidoDe(time) === "bloqueado";
}

// Pedido travado (suspenso OU bloqueado): nada de cadastro nem de pagamento.
function pedidoTravado(time) {
  return statusForaDaLinha(statusPedidoDe(time));
}

// Etapas em que o representante ainda pode ADICIONAR/EDITAR nomes na lista.
// A lista só trava de verdade quando o pagamento encerra (pagamento_encerrado
// em diante). "Suspenso" e "Bloqueado" ficam de fora (travam tudo).
function pedidoAceitaCadastro(time) {
  const s = statusPedidoDe(time);
  return s === "aberto" || s === "fechado" || s === "pagamento_andamento";
}

// Etapas em que o representante pode PAGAR (fechado e pagamento em andamento).
function pedidoAceitaPagamento(time) {
  const s = statusPedidoDe(time);
  return s === "fechado" || s === "pagamento_andamento";
}

// Da Impressão em diante o pedido já está sendo produzido: é o momento em que
// a lista se separa entre o que vai para a impressão (pago) e o que fica
// pendente (não pago). Os status fora da linha do tempo ("Suspenso" e
// "Bloqueado") ficam de fora, apesar de virem depois na lista.
function pedidoEmProducao(time) {
  const s = statusPedidoDe(time);
  return !statusForaDaLinha(s) && indiceStatus(s) >= indiceStatus("impressao");
}

// Classe CSS do badge conforme o status (usada em todas as telas).
function classeBadgeStatus(statusId) {
  if (statusId === "aberto") return "aberto";
  if (statusId === "entregue") return "pago";
  if (statusId === "finalizado") return "finalizado";
  if (statusId === "suspenso") return "suspenso";
  if (statusId === "bloqueado") return "bloqueado";
  return "fechado";
}

// Se o time tem data limite (string "YYYY-MM-DD") vencida e ainda está "aberto",
// retorna "fechado" (fechamento automático). Caso contrário, null (sem mudança).
function statusAutoPorData(time) {
  if (statusPedidoDe(time) !== "aberto" || !time.dataLimite) return null;
  const limite = new Date(time.dataLimite + "T23:59:59");
  if (isNaN(limite.getTime())) return null;
  return Date.now() > limite.getTime() ? "fechado" : null;
}

// Renderiza a barra de acompanhamento (etapas do pedido) em `container`.
function renderizarBarraStatus(container, statusId) {
  if (!container) return;
  container.className = "barra-status";
  container.innerHTML = "";

  // Suspenso e bloqueado não fazem parte da linha do tempo: mostram um
  // indicador destacado no lugar das etapas.
  if (statusForaDaLinha(statusId)) {
    const etapa = document.createElement("span");
    etapa.className = "status-etapa " + statusId + " atual";
    etapa.textContent = statusId === "bloqueado" ? "🚫 Pedido bloqueado" : "⏸ Pedido suspenso";
    container.appendChild(etapa);
    return;
  }

  const atual = indiceStatus(statusId);
  STATUS_PEDIDO.forEach((s, i) => {
    if (statusForaDaLinha(s.id)) return; // fora da linha do tempo
    const etapa = document.createElement("span");
    etapa.className = "status-etapa" + (i < atual ? " concluida" : i === atual ? " atual" : "");
    etapa.textContent = s.label;
    container.appendChild(etapa);
  });
}

// ============================================================
// CARRINHO — pagar várias camisetas de uma vez, sem login
// ============================================================
// O carrinho é uma lista guardada NESTE navegador (localStorage): não existe
// conta nem cadastro, e cada pessoa tem o seu. Ele vale para o site inteiro,
// não para um time só — um responsável com filhos em times diferentes junta
// tudo num pagamento só.
//
// Cada item guarda uma cópia do que a tela precisa (nome, tamanho, nome do
// time e valor), para a barra do carrinho aparecer sem ler o banco de novo.
// Antes de pagar, tudo é reconferido no Firestore — ver revalidarCarrinho().

const CHAVE_CARRINHO = "carrinho-interclasse";

// Identidade de um item: a camiseta é única dentro do time.
function chaveDoItem(timeId, alunoId) {
  return timeId + "/" + alunoId;
}

// localStorage pode falhar (janela anônima, site sem permissão de dados):
// aí o carrinho só deixa de sobreviver ao recarregar, o resto continua igual.
function lerCarrinho() {
  try {
    const bruto = localStorage.getItem(CHAVE_CARRINHO);
    const lista = bruto ? JSON.parse(bruto) : [];
    if (!Array.isArray(lista)) return [];
    return lista.filter((i) => i && typeof i.timeId === "string" && typeof i.alunoId === "string");
  } catch (e) {
    return [];
  }
}

function gravarCarrinho(itens) {
  try {
    localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens || []));
  } catch (e) {
    console.warn("Não deu para guardar o carrinho neste navegador.", e);
  }
}

function carrinhoTem(itens, timeId, alunoId) {
  const chave = chaveDoItem(timeId, alunoId);
  return (itens || []).some((i) => chaveDoItem(i.timeId, i.alunoId) === chave);
}

// Adiciona (sem repetir) e devolve a lista nova.
function carrinhoAdicionar(itens, item) {
  const lista = itens || [];
  if (carrinhoTem(lista, item.timeId, item.alunoId)) return lista;
  return lista.concat([item]);
}

function carrinhoRemover(itens, timeId, alunoId) {
  const chave = chaveDoItem(timeId, alunoId);
  return (itens || []).filter((i) => chaveDoItem(i.timeId, i.alunoId) !== chave);
}

// Soma do carrinho e quantos itens ficaram sem preço definido.
function carrinhoTotal(itens) {
  let total = 0;
  let semPreco = 0;
  (itens || []).forEach((i) => {
    const valor = Number(i.valor || 0);
    if (valor > 0) total += valor; else semPreco++;
  });
  return { total, semPreco };
}

// Nomes dos times representados no carrinho, na ordem em que aparecem.
function carrinhoTimes(itens) {
  const nomes = [];
  (itens || []).forEach((i) => {
    const nome = i.time || i.timeId;
    if (!nomes.includes(nome)) nomes.push(nome);
  });
  return nomes;
}

// Uma camiseta pode ser paga agora? Vale para o time dela, não para o time
// da página aberta — é o que permite juntar filhos de times diferentes.
function podePagarAgora(time, aluno) {
  if (!time || pedidoTravado(time) || !pedidoAceitaPagamento(time)) return false;
  if (!aluno || aluno.excluido || aluno.pago || aluno.ajusteSolicitado) return false;
  return true;
}

// Reconfere o carrinho guardado e salva o resultado.
async function revalidarCarrinho(cfg) {
  const resultado = await revalidarItens(cfg, lerCarrinho());
  gravarCarrinho(resultado.itens);
  return resultado;
}

// Reconfere uma lista de itens no Firestore: atualiza nome/tamanho/preço de
// cada camiseta e tira o que não pode mais ser pago (já paga, apagada da
// lista, com ajuste em aberto, ou de um time que saiu da fase de pagamento).
// Devolve { itens, removidos } — `removidos` alimenta o aviso na tela.
async function revalidarItens(cfg, lista) {
  const itens = lista || [];
  if (itens.length === 0) return { itens: [], removidos: [] };

  // Um `get` por time e um por camiseta: o carrinho é pequeno por natureza.
  const times = {};
  await Promise.all(
    [...new Set(itens.map((i) => i.timeId))].map(async (timeId) => {
      try {
        const doc = await db.collection(COL_TIMES).doc(timeId).get();
        times[timeId] = doc.exists ? doc.data() : null;
      } catch (e) {
        times[timeId] = undefined; // erro de leitura: mantém o item como está
      }
    })
  );

  const validos = [];
  const removidos = [];
  await Promise.all(
    itens.map(async (item) => {
      const time = times[item.timeId];
      if (time === undefined) { validos.push(item); return; } // não deu para conferir
      if (time === null) { removidos.push(item); return; }    // time apagado

      let aluno = null;
      try {
        const doc = await db.collection(COL_TIMES).doc(item.timeId)
          .collection("alunos").doc(item.alunoId).get();
        aluno = doc.exists ? doc.data() : null;
      } catch (e) {
        validos.push(item);
        return;
      }
      if (!podePagarAgora(time, aluno)) { removidos.push(item); return; }

      validos.push({
        timeId: item.timeId,
        alunoId: item.alunoId,
        nome: aluno.nome || "",
        tamanho: aluno.tamanho || "",
        numero: aluno.numero || "",
        nomeCamiseta: aluno.nomeCamiseta || "",
        time: time.nome || item.timeId,
        valor: Number(precoDoTamanhoNoTime(aluno.tamanho, cfg, item.timeId) || 0)
      });
    })
  );

  // Mantém a ordem em que foram colocados no carrinho.
  const ordem = itens.map((i) => chaveDoItem(i.timeId, i.alunoId));
  validos.sort((a, b) => ordem.indexOf(chaveDoItem(a.timeId, a.alunoId)) - ordem.indexOf(chaveDoItem(b.timeId, b.alunoId)));

  return { itens: validos, removidos };
}

// ============================================================
// IMAGEM DA CAMISETA (Google Drive via Apps Script)
// ============================================================

// Marca d'água por SOBREPOSIÇÃO (não altera o arquivo). Envolve uma <img>
// num wrapper posicionado e, quando `comMarca`, adiciona uma camada com o
// texto "REFERÊNCIA" repetido em diagonal (definida em CSS: .marca-overlay).
// Vale para qualquer imagem, inclusive as já enviadas ao Drive.
function envolverImagemComMarca(imgEl, comMarca) {
  const wrap = document.createElement("span");
  wrap.className = "wrap-imagem";
  imgEl.classList.add("img-na-marca");
  wrap.appendChild(imgEl);
  if (comMarca) {
    const camada = document.createElement("span");
    camada.className = "marca-overlay";
    camada.setAttribute("aria-hidden", "true");
    wrap.appendChild(camada);
  }
  return wrap;
}

// Reduz a imagem para no máximo `maxLargura` px e devolve base64 (JPEG, sem prefixo).
// O fundo é pintado de branco antes de desenhar porque o JPEG não tem
// transparência — sem isso, uma arte em PNG transparente sairia com fundo preto.
function redimensionarImagemBase64(file, maxLargura) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, maxLargura / img.width);
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

// Prefixo do arquivo no Drive conforme o tipo de imagem enviada.
const PREFIXOS_IMAGEM = { arte: "arte", tamanho: "tamanho", camiseta: "camiseta" };

// Envia um base64 já processado ao Apps Script (Google Drive) e retorna a URL pública.
// `tipo` entra no nome do arquivo no Drive ("camiseta" = simulação, "arte" = arte
// pura, "tamanho" = tabela de medidas de um grupo de tamanhos).
async function enviarImagemBase64Drive(scriptUrl, timeId, dataBase64, tipo) {
  const prefixo = PREFIXOS_IMAGEM[tipo] || PREFIXOS_IMAGEM.camiseta;
  const resp = await fetch(scriptUrl, {
    method: "POST",
    // text/plain (padrão do fetch com string) evita o preflight de CORS do Apps Script.
    body: JSON.stringify({
      timeId: timeId,
      nome: prefixo + "-" + timeId + ".jpg",
      mimeType: "image/jpeg",
      dataBase64: dataBase64
    })
  });
  const dados = await resp.json();
  if (!dados || !dados.ok) throw new Error((dados && dados.erro) || "Falha ao enviar a imagem.");
  return dados.url;
}

// Envia a imagem ao Apps Script (Google Drive) e retorna a URL pública para exibir.
// A arte pura e a tabela de medidas vão maiores (1600 px) porque têm detalhes e
// números que precisam continuar legíveis quando a imagem é ampliada.
async function enviarImagemDrive(scriptUrl, timeId, file, tipo) {
  const maiorResolucao = tipo === "arte" || tipo === "tamanho";
  const dataBase64 = await redimensionarImagemBase64(file, maiorResolucao ? 1600 : 1200);
  return enviarImagemBase64Drive(scriptUrl, timeId, dataBase64, tipo);
}

// ---------------- Arquivos originais (artes de produção) ----------------
// Diferente das imagens acima, estes arquivos vão ao Drive EXATAMENTE como
// foram escolhidos (EPS, PNG em alta, fontes) — nada de reduzir ou converter,
// porque é deles que sai o arquivo de impressão.

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(",")[1] || "");
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(file);
  });
}

// O Apps Script aceita uns 50 MB por envio (e o base64 aumenta um terço),
// então arquivo grande — como uma arte em 600 dpi — vai em PARTES: cada parte
// vira um arquivo na pasta do Drive e o site junta tudo na hora de usar.
const TAMANHO_PARTE_DRIVE = 20 * 1024 * 1024;

async function enviarBase64Drive(scriptUrl, nome, mimeType, dataBase64) {
  const resp = await fetch(scriptUrl, {
    method: "POST",
    body: JSON.stringify({ nome, mimeType, dataBase64 })
  });
  const dados = await resp.json();
  if (!dados || !dados.ok) throw new Error((dados && dados.erro) || "Falha ao enviar o arquivo.");
  return dados;
}

// Envia o arquivo original ao Drive. Devolve { fileId, partes, url }:
//   fileId — a primeira parte (ou o arquivo inteiro, se couber numa só);
//   partes — ids de todas as partes, em ordem (é o que se guarda);
//   url    — miniatura pública (só faz sentido para imagem de uma parte).
// `aoProgresso(fração)` é opcional.
async function enviarArquivoDrive(scriptUrl, file, prefixo, aoProgresso) {
  const nome = (prefixo ? prefixo + "-" : "") + file.name;
  const nPartes = Math.max(1, Math.ceil(file.size / TAMANHO_PARTE_DRIVE));
  const partes = [];
  let url = "";
  for (let i = 0; i < nPartes; i++) {
    const pedaco = nPartes === 1 ? file : file.slice(i * TAMANHO_PARTE_DRIVE, (i + 1) * TAMANHO_PARTE_DRIVE);
    const dataBase64 = await lerArquivoBase64(pedaco);
    const dados = await enviarBase64Drive(
      scriptUrl,
      nPartes === 1 ? nome : `${nome}.parte${i + 1}de${nPartes}`,
      nPartes === 1 ? file.type || "application/octet-stream" : "application/octet-stream",
      dataBase64
    );
    partes.push(dados.fileId);
    if (i === 0) url = dados.url;
    if (aoProgresso) aoProgresso((i + 1) / nPartes);
  }
  return { fileId: partes[0], partes, url: nPartes === 1 ? url : "" };
}

// Bytes de um arquivo do Drive (via Apps Script, por causa do CORS). Aceita
// o id de um arquivo ou a lista de partes. Guarda em memória: a mesma arte é
// usada em todas as camisetas da leva.
const cacheArquivosDrive = {};
function baixarParteDrive(scriptUrl, fileId) {
  const sep = scriptUrl.includes("?") ? "&" : "?";
  return fetch(scriptUrl + sep + "acao=arquivo&id=" + encodeURIComponent(fileId))
    .then((r) => r.json())
    .then((dados) => {
      if (!dados || !dados.ok) {
        throw new Error((dados && dados.erro) ||
          "Não foi possível baixar o arquivo. Reimplante o Apps Script (apps-script/README.md).");
      }
      const bin = atob(dados.dataBase64 || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    });
}

function chaveArquivoDrive(ref) {
  return Array.isArray(ref) ? ref.join("+") : String(ref);
}

function baixarArquivoDrive(scriptUrl, ref) {
  const chave = chaveArquivoDrive(ref);
  if (!cacheArquivosDrive[chave]) {
    const ids = Array.isArray(ref) ? ref : [ref];
    cacheArquivosDrive[chave] = (async () => {
      const pedacos = [];
      for (const id of ids) pedacos.push(await baixarParteDrive(scriptUrl, id));
      if (pedacos.length === 1) return pedacos[0];
      const total = pedacos.reduce((s, p) => s + p.length, 0);
      const junto = new Uint8Array(total);
      let o = 0;
      pedacos.forEach((p) => { junto.set(p, o); o += p.length; });
      return junto;
    })().catch((e) => {
      delete cacheArquivosDrive[chave];
      throw e;
    });
  }
  return cacheArquivosDrive[chave];
}

// Guarda no cache os bytes de um arquivo que acabou de ser enviado (evita
// baixar de volta o que já está na memória).
function guardarArquivoDriveNoCache(ref, bytes) {
  cacheArquivosDrive[chaveArquivoDrive(ref)] = Promise.resolve(bytes);
}

// ---------------- Ampliar imagem (lightbox) ----------------

let lightboxEls = null;       // elementos do lightbox, criados na primeira vez
let focoAntesLightbox = null; // para devolver o foco ao fechar
let lightboxItens = [];       // imagens da ampliação atual
let lightboxIndice = 0;       // qual delas está sendo exibida

// Monta (uma única vez) a estrutura do lightbox e devolve seus elementos.
function obterLightbox() {
  if (lightboxEls) return lightboxEls;

  const fundo = document.createElement("div");
  fundo.className = "lightbox oculto";
  fundo.setAttribute("role", "dialog");
  fundo.setAttribute("aria-modal", "true");

  const conteudo = document.createElement("div");
  conteudo.className = "lightbox-conteudo";

  const fechar = document.createElement("button");
  fechar.type = "button";
  fechar.className = "lightbox-fechar";
  fechar.setAttribute("aria-label", "Fechar imagem ampliada");
  fechar.textContent = "×";

  const wrap = document.createElement("span");
  wrap.className = "wrap-imagem";

  const img = document.createElement("img");
  img.className = "lightbox-img img-na-marca";
  img.alt = "";

  const marca = document.createElement("span");
  marca.className = "marca-overlay oculto";
  marca.setAttribute("aria-hidden", "true");

  const legenda = document.createElement("p");
  legenda.className = "lightbox-legenda";

  // Setas para passar de uma imagem à outra sem sair da ampliação.
  const antes = document.createElement("button");
  antes.type = "button";
  antes.className = "lightbox-seta lightbox-antes";
  antes.setAttribute("aria-label", "Imagem anterior");
  antes.textContent = "‹";

  const depois = document.createElement("button");
  depois.type = "button";
  depois.className = "lightbox-seta lightbox-depois";
  depois.setAttribute("aria-label", "Próxima imagem");
  depois.textContent = "›";

  wrap.appendChild(img);
  wrap.appendChild(marca);
  conteudo.appendChild(fechar);
  conteudo.appendChild(antes);
  conteudo.appendChild(wrap);
  conteudo.appendChild(depois);
  conteudo.appendChild(legenda);
  fundo.appendChild(conteudo);
  document.body.appendChild(fundo);

  fechar.onclick = fecharLightbox;
  antes.onclick = () => passarLightbox(-1);
  depois.onclick = () => passarLightbox(1);
  // Clicar fora da imagem (no fundo escuro) também fecha.
  fundo.onclick = (ev) => {
    if (ev.target === fundo || ev.target === conteudo) fecharLightbox();
  };
  document.addEventListener("keydown", (ev) => {
    if (fundo.classList.contains("oculto")) return;
    if (ev.key === "Escape") fecharLightbox();
    if (ev.key === "ArrowLeft") passarLightbox(-1);
    if (ev.key === "ArrowRight") passarLightbox(1);
  });

  lightboxEls = { fundo, img, marca, legenda, fechar, antes, depois };
  return lightboxEls;
}

// Abre a galeria ampliada a partir de `indice`. Cada item é
// { url, legenda, comMarca } — a marca d'água, quando ligada, acompanha a
// ampliação, então ampliar não é um jeito de contornar a proteção.
function abrirLightbox(itens, indice) {
  const lista = (Array.isArray(itens) ? itens : [itens]).filter((i) => i && i.url);
  if (lista.length === 0) return;
  lightboxItens = lista;
  focoAntesLightbox = document.activeElement;
  const els = obterLightbox();
  els.fundo.classList.remove("oculto");
  document.body.classList.add("sem-rolagem");
  mostrarNoLightbox(Math.min(Math.max(indice || 0, 0), lista.length - 1));
  els.fechar.focus();
}

// Troca a imagem exibida na ampliação (usado pelas setas e pelo teclado).
function mostrarNoLightbox(indice) {
  const els = obterLightbox();
  const item = lightboxItens[indice];
  if (!item) return;
  lightboxIndice = indice;
  els.img.src = item.url;
  els.img.alt = item.legenda || "Imagem ampliada";
  els.legenda.textContent = item.legenda || "";
  els.legenda.classList.toggle("oculto", !item.legenda);
  els.marca.classList.toggle("oculto", item.comMarca !== true);
  // Com uma imagem só, as setas não fazem sentido.
  const varias = lightboxItens.length > 1;
  els.antes.classList.toggle("oculto", !varias);
  els.depois.classList.toggle("oculto", !varias);
}

// Passa para a imagem anterior/seguinte, dando a volta no fim da lista.
function passarLightbox(direcao) {
  if (lightboxItens.length < 2) return;
  const total = lightboxItens.length;
  mostrarNoLightbox((lightboxIndice + direcao + total) % total);
}

function fecharLightbox() {
  if (!lightboxEls) return;
  lightboxEls.fundo.classList.add("oculto");
  lightboxEls.img.removeAttribute("src");
  lightboxItens = [];
  document.body.classList.remove("sem-rolagem");
  if (focoAntesLightbox && focoAntesLightbox.focus) focoAntesLightbox.focus();
  focoAntesLightbox = null;
}

// Deixa uma <img> clicável (e acessível pelo teclado) para abrir ampliada.
// `comMarca` é lido na hora do clique, então pode ser uma função. Passando
// `itens`/`indice`, a ampliação já abre com a galeria inteira para navegar.
function tornarImagemAmpliavel(imgEl, legenda, comMarca, itens, indice) {
  if (!imgEl) return imgEl;
  imgEl.classList.add("imagem-ampliavel");
  imgEl.tabIndex = 0;
  imgEl.setAttribute("role", "button");
  imgEl.title = "Clique para ampliar";
  const marcaAtiva = () => (typeof comMarca === "function" ? comMarca() : comMarca === true);
  const abrir = () =>
    Array.isArray(itens) && itens.length > 0
      ? abrirLightbox(itens, indice || 0)
      : abrirLightbox([{ url: imgEl.currentSrc || imgEl.src, legenda, comMarca: marcaAtiva() }], 0);
  imgEl.onclick = abrir;
  imgEl.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      abrir();
    }
  };
  return imgEl;
}

function mostrarMensagem(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = tipo; // "aviso" ou "erro"
  elemento.classList.remove("oculto");
}

function esconderMensagem(elemento) {
  elemento.classList.add("oculto");
  elemento.textContent = "";
}
