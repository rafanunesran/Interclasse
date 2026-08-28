// POST /api/criar-preferencia
// Checkout Pro: cria uma "preferência" no Mercado Pago e devolve a URL da
// página hospedada do MP (init_point). O site redireciona o pagador para lá.
// Aceita uma camiseta ou o carrinho inteiro — que pode ter camisetas de
// times diferentes (um responsável com filhos em vários times). Sai uma
// cobrança só, com um item por camiseta. O valor é calculado AQUI (a partir
// do Firestore), nunca vem do cliente.
const { db, admin, COL_TIMES } = require("../lib/firebase");
const { GRUPOS_PADRAO } = require("../lib/preco");
const { paresDoPedido, carregarItens, registrarCobranca } = require("../lib/itens");
const { setCors } = require("../lib/http");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido" });

  try {
    // "turmaId" é o nome antigo do campo; aceito para o site publicado antes
    // da renomeação continuar funcionando até atualizar.
    const entrada = req.body || {};
    const retornoUrl = entrada.retornoUrl;
    const pares = paresDoPedido(entrada);
    if (pares.length === 0) {
      return res.status(400).json({ erro: "Informe as camisetas em `itens` ({ timeId, alunoId })." });
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Backend sem MP_ACCESS_TOKEN configurado." });
    }

    const [geralSnap, tamSnap] = await Promise.all([
      db.collection("config").doc("geral").get(),
      db.collection("config").doc("tamanhos").get()
    ]);
    const geral = geralSnap.exists ? geralSnap.data() : {};
    const grupos = tamSnap.exists && Array.isArray(tamSnap.data().grupos) ? tamSnap.data().grupos : GRUPOS_PADRAO;

    // Usa o preço do time (o geral, ou o personalizado dele, se houver).
    const { itens, total, erro, status } = await carregarItens({
      db, colecao: COL_TIMES, pares, geral, grupos
    });
    if (erro) return res.status(status).json({ erro });

    const baseUrl = `https://${req.headers.host}`;
    // URL de retorno ao site (validada como http/https para o auto_return).
    let retorno = typeof retornoUrl === "string" ? retornoUrl : "";
    if (!/^https?:\/\//i.test(retorno)) retorno = "";

    // Uma cobrança, um item por camiseta: o pagador vê a lista no Mercado Pago.
    const { cobrancaId, referencia } = await registrarCobranca({
      db, admin, itens, total, origem: "checkout-pro"
    });

    const corpo = {
      items: itens.map((i) => ({
        title: `Camiseta interclasse - ${i.aluno.nome || ""}`.trim().slice(0, 250),
        quantity: 1,
        unit_price: i.valor,
        currency_id: "BRL"
      })),
      external_reference: referencia,
      // Deixa essencialmente o PIX (exclui cartão/boleto).
      payment_methods: {
        excluded_payment_types: [
          { id: "credit_card" },
          { id: "debit_card" },
          { id: "ticket" },
          { id: "atm" }
        ],
        installments: 1
      },
      notification_url: `${baseUrl}/api/webhook-mp`
    };
    if (retorno) {
      corpo.back_urls = { success: retorno, pending: retorno, failure: retorno };
      corpo.auto_return = "approved";
    }

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(corpo)
    });

    const pref = await resp.json();
    if (!resp.ok) {
      console.error("Erro do Mercado Pago ao criar preferência:", pref);
      return res.status(502).json({ erro: "Falha ao criar a cobrança no Mercado Pago.", detalhe: pref && pref.message });
    }

    const lote = db.batch();
    itens.forEach((i) => lote.update(i.ref, { pagamentoMpPreferencia: String(pref.id || "") }));
    lote.update(db.collection("cobrancas").doc(cobrancaId), { preferenciaId: String(pref.id || "") });
    await lote.commit();

    return res.status(200).json({
      preferenciaId: pref.id,
      cobrancaId,
      initPoint: pref.init_point || pref.sandbox_init_point || "",
      itens: itens.length,
      valor: total
    });
  } catch (erro) {
    console.error("Erro interno em criar-preferencia:", erro);
    return res.status(500).json({ erro: "Erro interno." });
  }
};
