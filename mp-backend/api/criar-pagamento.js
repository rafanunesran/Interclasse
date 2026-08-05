// POST /api/criar-pagamento
// Chamado pelo site quando o usuário clica em "Pagar (PIX)". Cria uma cobrança
// PIX no Mercado Pago (Payments API) e devolve o QR Code + o "copia e cola".
// O valor é calculado AQUI (a partir do Firestore), não confiando no cliente.
const { db } = require("../lib/firebase");
const { GRUPOS_PADRAO, precoDoTamanho } = require("../lib/preco");
const { setCors } = require("../lib/http");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido" });

  try {
    const { turmaId, alunoId } = req.body || {};
    if (!turmaId || !alunoId) {
      return res.status(400).json({ erro: "Informe turmaId e alunoId." });
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

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Backend sem MP_ACCESS_TOKEN configurado." });
    }

    const baseUrl = `https://${req.headers.host}`;
    const idempotencia = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `${turmaId}-${alunoId}-${Date.now()}`;
    const primeiroNome = String(aluno.nome || "Aluno").trim().split(/\s+/)[0];

    const resp = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencia
      },
      body: JSON.stringify({
        transaction_amount: Number(Number(valor).toFixed(2)),
        description: `Camiseta interclasse - ${aluno.nome || ""}`.trim(),
        payment_method_id: "pix",
        payer: {
          email: process.env.MP_EMAIL_PAGADOR || "pagador@interclasse.app",
          first_name: primeiroNome
        },
        external_reference: `${turmaId}__${alunoId}`,
        notification_url: `${baseUrl}/api/webhook-mp`
      })
    });

    const pg = await resp.json();
    if (!resp.ok) {
      console.error("Erro do Mercado Pago ao criar pagamento:", pg);
      return res.status(502).json({ erro: "Falha ao criar a cobrança no Mercado Pago.", detalhe: pg && pg.message });
    }

    const td = (pg.point_of_interaction && pg.point_of_interaction.transaction_data) || {};

    // Guarda o id do pagamento no aluno (correlação; o status vem pelo webhook).
    await alunoRef.update({ pagamentoMpId: String(pg.id) });

    return res.status(200).json({
      pagamentoId: pg.id,
      valor: Number(valor),
      qrCode: td.qr_code || "",
      qrCodeBase64: td.qr_code_base64 || ""
    });
  } catch (erro) {
    console.error("Erro interno em criar-pagamento:", erro);
    return res.status(500).json({ erro: "Erro interno." });
  }
};
