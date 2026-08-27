// Itens de uma cobrança: uma camiseta (o formato antigo) ou várias, quando o
// pagador junta o carrinho. Fica aqui o que os dois endpoints de cobrança
// (`criar-pagamento` e `criar-preferencia`) precisam fazer igual.
const { precoDoTamanhoNoTime } = require("./preco");

// Teto de camisetas numa cobrança só. Existe para uma requisição estranha não
// virar centenas de leituras no Firestore; 60 cobre até uma turma inteira.
const MAX_ITENS = 60;

// Ids que vieram do site. Aceita a lista nova (`alunoIds`) e o campo antigo
// de uma camiseta só (`alunoId`), sem duplicados e dentro do teto.
function idsDoPedido(entrada) {
  const bruto = Array.isArray(entrada.alunoIds) && entrada.alunoIds.length > 0
    ? entrada.alunoIds
    : [entrada.alunoId];
  const vistos = new Set();
  const ids = [];
  bruto.forEach((id) => {
    if (typeof id !== "string") return;
    const limpo = id.trim();
    // "/" quebraria o caminho do documento; ids do Firestore nunca têm.
    if (!limpo || limpo.includes("/") || vistos.has(limpo)) return;
    vistos.add(limpo);
    ids.push(limpo);
  });
  return ids.slice(0, MAX_ITENS);
}

// Lê os alunos e calcula o preço de cada um (o do time, que pode ser próprio).
// Devolve { itens, total } ou { erro } quando algum id não serve.
async function carregarItens({ db, colecao, timeId, ids, geral, grupos }) {
  const refs = ids.map((id) => db.collection(colecao).doc(timeId).collection("alunos").doc(id));
  const snaps = await Promise.all(refs.map((r) => r.get()));

  const itens = [];
  let total = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (!snaps[i].exists) return { erro: `Aluno não encontrado (${ids[i]}).`, status: 404 };
    const aluno = snaps[i].data();
    const valor = precoDoTamanhoNoTime(aluno.tamanho, geral, timeId, grupos);
    if (!valor || valor <= 0) {
      return { erro: `Não há preço definido para o tamanho de ${aluno.nome || ids[i]}.`, status: 400 };
    }
    total += valor;
    itens.push({ id: ids[i], ref: refs[i], aluno, valor: Number(Number(valor).toFixed(2)) });
  }
  return { itens, total: Number(total.toFixed(2)) };
}

// Guarda a cobrança (quais camisetas estão nela) e devolve a referência que
// vai no `external_reference` do Mercado Pago. O webhook volta por aqui para
// saber quem marcar como pago: a referência do MP é curta demais para levar
// uma lista de ids, então ela leva só o id deste documento.
async function registrarCobranca({ db, admin, timeId, itens, total, origem }) {
  const doc = await db.collection("cobrancas").add({
    timeId,
    alunoIds: itens.map((i) => i.id),
    valor: total,
    origem: origem || "",
    status: "aberta",
    criadaEm: admin.firestore.FieldValue.serverTimestamp()
  });
  return { cobrancaId: doc.id, referencia: `lote:${doc.id}` };
}

module.exports = { MAX_ITENS, idsDoPedido, carregarItens, registrarCobranca };
