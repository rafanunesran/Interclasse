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

// Preços que valem num time: a tabela geral (geral.precosPorGrupo), depois
// o preço do CLIENTE do time e, por cima, o do próprio TIME, grupo a grupo.
// Espelha precosDoTime() de js/utils.js. Os preços especiais vêm da coleção
// `precos` (lidos por carregarPrecosEspeciais, abaixo) e ficam em
// geral._precosCliente / _precosTime / _clienteDoTime. O campo antigo
// geral.precosPorTime ("precosPorTurma", mais antigo ainda) continua valendo
// para o time que ainda não foi movido. Tudo isso só o admin grava — o valor
// da cobrança continua confiável.
function limpar(mapa) {
  const saida = {};
  Object.keys(mapa || {}).forEach((g) => {
    const v = Number(mapa[g]);
    if (mapa[g] != null && mapa[g] !== "" && !isNaN(v)) saida[g] = v;
  });
  return saida;
}

function precosDoTime(geral, timeId) {
  const g = geral || {};
  const efetivos = limpar(g.precosPorGrupo);
  const clienteId = (g._clienteDoTime || {})[timeId];
  const doCliente = limpar(clienteId ? (g._precosCliente || {})[clienteId] : null);
  const antigo = (g.precosPorTime || g.precosPorTurma || {})[timeId];
  const doTime = limpar((g._precosTime || {})[timeId] || antigo);
  Object.assign(efetivos, doCliente, doTime);
  return efetivos;
}

// Lê os preços especiais dos times de uma cobrança (e dos clientes deles) e
// devolve uma cópia de `geral` com eles. Documento que não existe só não conta.
async function carregarPrecosEspeciais({ db, colecao, geral, timeIds }) {
  const saida = { ...(geral || {}), _precosTime: {}, _precosCliente: {}, _clienteDoTime: {}, _precosAluno: {} };
  const unicos = [...new Set(timeIds)];
  const times = await Promise.all(unicos.map((id) => db.collection(colecao).doc(id).get()));
  const clientes = new Set();
  times.forEach((snap, i) => {
    const clienteId = snap.exists ? (snap.data().clienteId || "") : "";
    saida._clienteDoTime[unicos[i]] = clienteId;
    if (clienteId) clientes.add(clienteId);
  });
  const precosTime = await Promise.all(unicos.map((id) => db.collection("precos").doc("time_" + id).get()));
  precosTime.forEach((snap, i) => {
    if (!snap.exists) return;
    const d = snap.data();
    if (d.precos) saida._precosTime[unicos[i]] = d.precos;
    if (d.porAluno) saida._precosAluno[unicos[i]] = d.porAluno; // preço especial por camiseta
  });
  const idsClientes = [...clientes];
  const precosCliente = await Promise.all(idsClientes.map((id) => db.collection("precos").doc("cliente_" + id).get()));
  precosCliente.forEach((snap, i) => {
    if (snap.exists) saida._precosCliente[idsClientes[i]] = snap.data().precos || {};
  });
  return saida;
}

// Preço de um tamanho já considerando o preço personalizado do time.
function precoDoTamanhoNoTime(tamanho, geral, timeId, grupos) {
  return precoDoTamanho(tamanho, precosDoTime(geral, timeId), grupos);
}

// Preço de uma camiseta: o especial dela (precos/time_ID → porAluno), se
// houver; senão, o do tamanho no time. Espelha precoDoAluno() de js/utils.js.
function precoDoAluno(geral, timeId, alunoId, tamanho, grupos) {
  const m = ((geral && geral._precosAluno) || {})[timeId];
  const v = m ? Number(m[alunoId]) : NaN;
  if (m && m[alunoId] != null && m[alunoId] !== "" && !isNaN(v)) return v;
  return precoDoTamanhoNoTime(tamanho, geral, timeId, grupos);
}

module.exports = { GRUPOS_PADRAO, precoDoTamanho, precosDoTime, precoDoTamanhoNoTime, precoDoAluno, carregarPrecosEspeciais };
