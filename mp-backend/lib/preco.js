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

module.exports = { GRUPOS_PADRAO, precoDoTamanho };
