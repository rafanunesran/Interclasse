// Cálculo do preço no backend (espelha a lógica de js/utils.js -> precoDoTamanho),
// para o valor da cobrança nunca vir do cliente (que poderia adulterá-lo).

// Fallback caso config/tamanhos ainda não exista (igual ao TAMANHOS_PADRAO do site).
const GRUPOS_PADRAO = [
  { grupo: "Infantil", tamanhos: ["10", "12", "14", "16"] },
  { grupo: "Normal", tamanhos: ["P", "M", "G", "GG"] },
  { grupo: "Plus Size", tamanhos: ["G1", "G2", "G3", "G4"] }
];

// Descobre o preço de um tamanho a partir do mapa preços-por-grupo + os grupos.
function precoDoTamanho(tamanho, precosPorGrupo, grupos) {
  if (!precosPorGrupo || !Array.isArray(grupos)) return null;
  const grupo = grupos.find((g) => Array.isArray(g.tamanhos) && g.tamanhos.includes(tamanho));
  if (grupo && precosPorGrupo[grupo.grupo] != null) return Number(precosPorGrupo[grupo.grupo]);
  return null;
}

// Preços que valem numa turma: a tabela geral (geral.precosPorGrupo) com o
// preço personalizado da turma por cima (geral.precosPorTurma[turmaId]),
// grupo a grupo. Espelha precosDaTurma() de js/utils.js.
// Os dois mapas vêm de config/geral, que só o admin grava — por isso o valor
// da cobrança continua confiável mesmo com preço por turma.
function precosDaTurma(geral, turmaId) {
  const base = (geral && geral.precosPorGrupo) || {};
  const proprios = (geral && geral.precosPorTurma && geral.precosPorTurma[turmaId]) || {};
  const efetivos = {};
  Object.keys(base).forEach((g) => {
    const v = Number(base[g]);
    if (base[g] != null && !isNaN(v)) efetivos[g] = v;
  });
  Object.keys(proprios).forEach((g) => {
    const v = Number(proprios[g]);
    if (proprios[g] != null && !isNaN(v)) efetivos[g] = v;
  });
  return efetivos;
}

// Preço de um tamanho já considerando o preço personalizado da turma.
function precoDoTamanhoNaTurma(tamanho, geral, turmaId, grupos) {
  return precoDoTamanho(tamanho, precosDaTurma(geral, turmaId), grupos);
}

module.exports = { GRUPOS_PADRAO, precoDoTamanho, precosDaTurma, precoDoTamanhoNaTurma };
