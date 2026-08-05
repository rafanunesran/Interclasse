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

// Cópia profunda simples dos grupos de tamanho.
function clonarGrupos(grupos) {
  return grupos.map((g) => ({ grupo: g.grupo, tamanhos: [...g.tamanhos] }));
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

function mostrarMensagem(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = tipo; // "aviso" ou "erro"
  elemento.classList.remove("oculto");
}

function esconderMensagem(elemento) {
  elemento.classList.add("oculto");
  elemento.textContent = "";
}
