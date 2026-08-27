// ============================================================
// FUNÇÕES E DADOS COMPARTILHADOS
// ============================================================

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
// ou injetar marcação a partir de nomes de turma digitados no admin).
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

// CSV no padrão do programa de impressão: SEM cabeçalho e separado por vírgula,
// com nome na camiseta (coluna A), número (B) e tamanho (C). Só entram as
// camisetas que serão produzidas. Devolve quantas linhas foram geradas.
function baixarCSVProducao(nomeArquivo, alunos) {
  const linhas = (alunos || [])
    .filter(alunoSeraProduzido)
    .map((a) => [nomeNaCamiseta(a), a.numero || "", a.tamanho || ""]);
  if (linhas.length === 0) return 0;
  baixarCSV(nomeArquivo, linhas, { separador: ",", bom: false });
  return linhas.length;
}

// Marca, nas etapas de produção, quem ficou de fora dela por não ter pago.
function badgeProducaoHtml(turma, aluno) {
  if (!pedidoEmProducao(turma) || alunoSeraProduzido(aluno)) return "";
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
// STATUS DO PEDIDO (etapas da turma)
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
  // Status especial (fora da linha do tempo): pausa tudo para os usuários —
  // sem cadastrar/editar nomes e sem receber pagamento. Só o admin muda.
  { id: "suspenso", label: "Suspenso" }
];

// Status atual da turma (com compatibilidade para turmas antigas que só têm `fechado`).
function statusPedidoDe(turma) {
  if (turma && turma.statusPedido) return turma.statusPedido;
  return turma && turma.fechado ? "fechado" : "aberto";
}

function indiceStatus(id) {
  return STATUS_PEDIDO.findIndex((s) => s.id === id);
}

function labelStatus(id) {
  const s = STATUS_PEDIDO.find((x) => x.id === id);
  return s ? s.label : id;
}

// A turma está aberta para o representante editar quando o status é "aberto".
function pedidoAberto(turma) {
  return statusPedidoDe(turma) === "aberto";
}

// Pedido suspenso: tudo bloqueado para os usuários (sem cadastro e sem pagamento).
function pedidoSuspenso(turma) {
  return statusPedidoDe(turma) === "suspenso";
}

// Etapas em que o representante ainda pode ADICIONAR/EDITAR nomes na lista.
// A lista só trava de verdade quando o pagamento encerra (pagamento_encerrado
// em diante). "Suspenso" fica de fora (bloqueia tudo).
function pedidoAceitaCadastro(turma) {
  const s = statusPedidoDe(turma);
  return s === "aberto" || s === "fechado" || s === "pagamento_andamento";
}

// Etapas em que o representante pode PAGAR (fechado e pagamento em andamento).
function pedidoAceitaPagamento(turma) {
  const s = statusPedidoDe(turma);
  return s === "fechado" || s === "pagamento_andamento";
}

// Da Impressão em diante o pedido já está sendo produzido: é o momento em que
// a lista se separa entre o que vai para a impressão (pago) e o que fica
// pendente (não pago). "Suspenso" fica de fora, apesar de vir depois na lista.
function pedidoEmProducao(turma) {
  const s = statusPedidoDe(turma);
  return s !== "suspenso" && indiceStatus(s) >= indiceStatus("impressao");
}

// Classe CSS do badge conforme o status (usada em todas as telas).
function classeBadgeStatus(statusId) {
  if (statusId === "aberto") return "aberto";
  if (statusId === "entregue") return "pago";
  if (statusId === "suspenso") return "suspenso";
  return "fechado";
}

// Se a turma tem data limite (string "YYYY-MM-DD") vencida e ainda está "aberto",
// retorna "fechado" (fechamento automático). Caso contrário, null (sem mudança).
function statusAutoPorData(turma) {
  if (statusPedidoDe(turma) !== "aberto" || !turma.dataLimite) return null;
  const limite = new Date(turma.dataLimite + "T23:59:59");
  if (isNaN(limite.getTime())) return null;
  return Date.now() > limite.getTime() ? "fechado" : null;
}

// Renderiza a barra de acompanhamento (etapas do pedido) em `container`.
function renderizarBarraStatus(container, statusId) {
  if (!container) return;
  container.className = "barra-status";
  container.innerHTML = "";

  // Suspenso não faz parte da linha do tempo: mostra um indicador destacado.
  if (statusId === "suspenso") {
    const etapa = document.createElement("span");
    etapa.className = "status-etapa suspenso atual";
    etapa.textContent = "⏸ Pedido suspenso";
    container.appendChild(etapa);
    return;
  }

  const atual = indiceStatus(statusId);
  STATUS_PEDIDO.forEach((s, i) => {
    if (s.id === "suspenso") return; // fora da linha do tempo
    const etapa = document.createElement("span");
    etapa.className = "status-etapa" + (i < atual ? " concluida" : i === atual ? " atual" : "");
    etapa.textContent = s.label;
    container.appendChild(etapa);
  });
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
async function enviarImagemBase64Drive(scriptUrl, turmaId, dataBase64, tipo) {
  const prefixo = PREFIXOS_IMAGEM[tipo] || PREFIXOS_IMAGEM.camiseta;
  const resp = await fetch(scriptUrl, {
    method: "POST",
    // text/plain (padrão do fetch com string) evita o preflight de CORS do Apps Script.
    body: JSON.stringify({
      turmaId: turmaId,
      nome: prefixo + "-" + turmaId + ".jpg",
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
async function enviarImagemDrive(scriptUrl, turmaId, file, tipo) {
  const maiorResolucao = tipo === "arte" || tipo === "tamanho";
  const dataBase64 = await redimensionarImagemBase64(file, maiorResolucao ? 1600 : 1200);
  return enviarImagemBase64Drive(scriptUrl, turmaId, dataBase64, tipo);
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
