// Itens de uma cobrança: uma camiseta (o formato antigo) ou várias, quando o
// pagador junta o carrinho. Fica aqui o que os dois endpoints de cobrança
// (`criar-pagamento` e `criar-preferencia`) precisam fazer igual.
const { precoDoTamanhoNoTime } = require("./preco");

// Teto de camisetas numa cobrança só. Existe para uma requisição estranha não
// virar centenas de leituras no Firestore; 60 cobre até uma turma inteira.
const MAX_ITENS = 60;

// Um id de documento válido (sem "/", que quebraria o caminho no Firestore).
function idValido(id) {
  return typeof id === "string" && id.trim() !== "" && !id.includes("/");
}

// Camisetas que vieram do site, como pares { timeId, alunoId }. Três formatos,
// do mais novo para o mais antigo:
//   itens: [{ timeId, alunoId }]  -> carrinho, que pode ter times diferentes
//   timeId + alunoIds: [...]      -> carrinho de um time só
//   timeId + alunoId              -> uma camiseta
// Sem duplicados e dentro do teto.
function paresDoPedido(entrada) {
  const timePadrao = entrada.timeId || entrada.turmaId;
  const bruto = [];

  if (Array.isArray(entrada.itens) && entrada.itens.length > 0) {
    entrada.itens.forEach((i) => {
      if (i && typeof i === "object") bruto.push({ timeId: i.timeId || timePadrao, alunoId: i.alunoId });
    });
  } else if (Array.isArray(entrada.alunoIds) && entrada.alunoIds.length > 0) {
    entrada.alunoIds.forEach((alunoId) => bruto.push({ timeId: timePadrao, alunoId }));
  } else if (entrada.alunoId) {
    bruto.push({ timeId: timePadrao, alunoId: entrada.alunoId });
  }

  const vistos = new Set();
  const pares = [];
  bruto.forEach((par) => {
    if (!idValido(par.timeId) || !idValido(par.alunoId)) return;
    const chave = par.timeId + "/" + par.alunoId;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    pares.push({ timeId: par.timeId.trim(), alunoId: par.alunoId.trim() });
  });
  return pares.slice(0, MAX_ITENS);
}

// Lê os alunos e calcula o preço de cada um. O preço é o do TIME DAQUELA
// camiseta (que pode ter tabela própria), e não o de um time só — é isso que
// deixa o carrinho juntar filhos de times diferentes numa cobrança só.
// Devolve { itens, total } ou { erro } quando alguma camiseta não serve.
async function carregarItens({ db, colecao, pares, geral, grupos }) {
  const refs = pares.map((p) => db.collection(colecao).doc(p.timeId).collection("alunos").doc(p.alunoId));
  const snaps = await Promise.all(refs.map((r) => r.get()));

  const itens = [];
  let total = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (!snaps[i].exists) return { erro: `Aluno não encontrado (${pares[i].alunoId}).`, status: 404 };
    const aluno = snaps[i].data();
    const valor = precoDoTamanhoNoTime(aluno.tamanho, geral, pares[i].timeId, grupos);
    if (!valor || valor <= 0) {
      return { erro: `Não há preço definido para o tamanho de ${aluno.nome || pares[i].alunoId}.`, status: 400 };
    }
    total += valor;
    itens.push({
      timeId: pares[i].timeId,
      alunoId: pares[i].alunoId,
      ref: refs[i],
      aluno,
      valor: Number(Number(valor).toFixed(2))
    });
  }
  return { itens, total: Number(total.toFixed(2)) };
}

// Guarda a cobrança (quais camisetas estão nela) e devolve a referência que
// vai no `external_reference` do Mercado Pago. O webhook volta por aqui para
// saber quem marcar como pago: a referência do MP é curta demais para levar
// uma lista de ids, então ela leva só o id deste documento.
async function registrarCobranca({ db, admin, itens, total, origem }) {
  const times = [...new Set(itens.map((i) => i.timeId))];
  const doc = await db.collection("cobrancas").add({
    // Cada camiseta com o seu time: uma cobrança pode atravessar times.
    // O valor de cada uma fica guardado porque o webhook rateia a taxa do
    // Mercado Pago entre as camisetas na proporção do que cada uma custou.
    itens: itens.map((i) => ({ timeId: i.timeId, alunoId: i.alunoId, valor: i.valor })),
    times,
    valor: total,
    origem: origem || "",
    status: "aberta",
    criadaEm: admin.firestore.FieldValue.serverTimestamp()
  });
  return { cobrancaId: doc.id, referencia: `lote:${doc.id}` };
}

module.exports = { MAX_ITENS, paresDoPedido, carregarItens, registrarCobranca };
