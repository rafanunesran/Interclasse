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

// Cópia profunda simples dos grupos de tamanho (preserva os custos, quando houver).
function clonarGrupos(grupos) {
  return grupos.map((g) => {
    const copia = { grupo: g.grupo, tamanhos: [...g.tamanhos] };
    if (g.custoImpressao != null) copia.custoImpressao = g.custoImpressao;
    if (g.custoCostureira != null) copia.custoCostureira = g.custoCostureira;
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
function baixarCSV(nomeArquivo, linhas) {
  const escapar = (valor) => {
    const texto = String(valor ?? "");
    if (/[;"\n]/.test(texto)) {
      return '"' + texto.replace(/"/g, '""') + '"';
    }
    return texto;
  };

  const conteudo = linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");
  const BOM = "﻿";
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
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

// Envia um base64 já processado ao Apps Script (Google Drive) e retorna a URL pública.
async function enviarImagemBase64Drive(scriptUrl, turmaId, dataBase64) {
  const resp = await fetch(scriptUrl, {
    method: "POST",
    // text/plain (padrão do fetch com string) evita o preflight de CORS do Apps Script.
    body: JSON.stringify({
      turmaId: turmaId,
      nome: "camiseta-" + turmaId + ".jpg",
      mimeType: "image/jpeg",
      dataBase64: dataBase64
    })
  });
  const dados = await resp.json();
  if (!dados || !dados.ok) throw new Error((dados && dados.erro) || "Falha ao enviar a imagem.");
  return dados.url;
}

// Envia a imagem ao Apps Script (Google Drive) e retorna a URL pública para exibir.
async function enviarImagemDrive(scriptUrl, turmaId, file) {
  const dataBase64 = await redimensionarImagemBase64(file, 1200);
  return enviarImagemBase64Drive(scriptUrl, turmaId, dataBase64);
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
