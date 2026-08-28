// POST /api/criar-pagamento
// Chamado pelo site quando o usuário clica em "Pagar (PIX)". Cria uma cobrança
// PIX no Mercado Pago (Payments API) e devolve o QR Code + o "copia e cola".
// O valor é calculado AQUI (a partir do Firestore), não confiando no cliente.
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
    const corpo = req.body || {};
    const pares = paresDoPedido(corpo);
    if (pares.length === 0) {
      return res.status(400).json({ erro: "Informe as camisetas em `itens` ({ timeId, alunoId })." });
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

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Backend sem MP_ACCESS_TOKEN configurado." });
    }

    const baseUrl = `https://${req.headers.host}`;
    const idempotencia = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `${pares.map((p) => p.timeId + "-" + p.alunoId).join("_")}-${Date.now()}`;
    const primeiroNome = String(itens[0].aluno.nome || "Aluno").trim().split(/\s+/)[0];

    // Uma cobrança só, com a lista de camisetas guardada para o webhook.
    const { cobrancaId, referencia } = await registrarCobranca({
      db, admin, itens, total, origem: "pix-direto"
    });
    const descricao = itens.length === 1
      ? `Camiseta interclasse - ${itens[0].aluno.nome || ""}`.trim()
      : `Camisetas interclasse - ${itens.length} unidades`;

    const resp = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencia
      },
      body: JSON.stringify({
        transaction_amount: total,
        description: descricao,
        payment_method_id: "pix",
        payer: {
          email: process.env.MP_EMAIL_PAGADOR || "pagador@interclasse.app",
          first_name: primeiroNome
        },
        external_reference: referencia,
        notification_url: `${baseUrl}/api/webhook-mp`
      })
    });

    const pg = await resp.json();
    if (!resp.ok) {
      console.error("Erro do Mercado Pago ao criar pagamento:", pg);
      return res.status(502).json({ erro: "Falha ao criar a cobrança no Mercado Pago.", detalhe: pg && pg.message });
    }

    const td = (pg.point_of_interaction && pg.point_of_interaction.transaction_data) || {};

    // Guarda o id do pagamento em cada camiseta (correlação; o status vem
    // pelo webhook).
    const lote = db.batch();
    itens.forEach((i) => lote.update(i.ref, { pagamentoMpId: String(pg.id) }));
    lote.update(db.collection("cobrancas").doc(cobrancaId), { pagamentoId: String(pg.id) });
    await lote.commit();

    return res.status(200).json({
      pagamentoId: pg.id,
      cobrancaId,
      itens: itens.length,
      valor: total,
      qrCode: td.qr_code || "",
      qrCodeBase64: td.qr_code_base64 || ""
    });
  } catch (erro) {
    console.error("Erro interno em criar-pagamento:", erro);
    return res.status(500).json({ erro: "Erro interno." });
  }
};
