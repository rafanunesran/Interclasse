// POST /api/criar-preferencia
// Checkout Pro: cria uma "preferência" no Mercado Pago e devolve a URL da
// página hospedada do MP (init_point). O site redireciona o pagador para lá.
// O valor é calculado AQUI (a partir do Firestore), nunca vem do cliente.
const { db } = require("../lib/firebase");
const { GRUPOS_PADRAO, precoDoTamanho } = require("../lib/preco");
const { setCors } = require("../lib/http");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido" });

  try {
    const { turmaId, alunoId, retornoUrl } = req.body || {};
    if (!turmaId || !alunoId) {
      return res.status(400).json({ erro: "Informe turmaId e alunoId." });
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Backend sem MP_ACCESS_TOKEN configurado." });
    }

    const alunoRef = db.collection("turmas").doc(turmaId).collection("alunos").doc(alunoId);
    const [alunoSnap, geralSnap, tamSnap] = await Promise.all([
      alunoRef.get(),
      db.collection("config").doc("geral").get(),
      db.collection("config").doc("tamanhos").get()
    ]);

    if (!alunoSnap.exists) return res.status(404).json({ erro: "Aluno não encontrado." });

    const aluno = alunoSnap.data();
    const geral = geralSnap.exists ? geralSnap.data() : {};
    const grupos = tamSnap.exists && Array.isArray(tamSnap.data().grupos) ? tamSnap.data().grupos : GRUPOS_PADRAO;

    const valor = precoDoTamanho(aluno.tamanho, geral.precosPorGrupo, grupos);
    if (!valor || valor <= 0) {
      return res.status(400).json({ erro: "Não há preço definido para o tamanho deste aluno." });
    }

    const baseUrl = `https://${req.headers.host}`;
    // URL de retorno ao site (validada como http/https para o auto_return).
    let retorno = typeof retornoUrl === "string" ? retornoUrl : "";
    if (!/^https?:\/\//i.test(retorno)) retorno = "";

    const corpo = {
      items: [
        {
          title: `Camiseta interclasse - ${aluno.nome || ""}`.trim().slice(0, 250),
          quantity: 1,
          unit_price: Number(Number(valor).toFixed(2)),
          currency_id: "BRL"
        }
      ],
      external_reference: `${turmaId}__${alunoId}`,
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

    await alunoRef.update({ pagamentoMpPreferencia: String(pref.id || "") });

    return res.status(200).json({
      preferenciaId: pref.id,
      initPoint: pref.init_point || pref.sandbox_init_point || "",
      valor: Number(valor)
    });
  } catch (erro) {
    console.error("Erro interno em criar-preferencia:", erro);
    return res.status(500).json({ erro: "Erro interno." });
  }
};
