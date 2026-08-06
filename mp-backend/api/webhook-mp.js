// POST /api/webhook-mp
// Recebe a notificação do Mercado Pago quando um pagamento muda de status.
// Valida a assinatura, consulta o pagamento e, se aprovado, marca o aluno
// como pago no Firestore (via Admin SDK — não depende das regras).
const crypto = require("crypto");
const { db, admin } = require("../lib/firebase");

module.exports = async (req, res) => {
  try {
    // O MP manda type/data.id na query e/ou no corpo.
    const tipo = req.query.type || req.query.topic || (req.body && (req.body.type || req.body.topic));
    const dataId =
      req.query["data.id"] ||
      req.query.id ||
      (req.body && req.body.data && req.body.data.id) ||
      (req.body && req.body.id);

    if (!validarAssinatura(req, dataId)) {
      console.warn("Webhook com assinatura inválida.");
      return res.status(401).end();
    }

    if (!dataId) return res.status(200).end();
    if (!process.env.MP_ACCESS_TOKEN) {
      console.error("Webhook sem MP_ACCESS_TOKEN configurado.");
      return res.status(200).end();
    }

    // Descobre a referência externa e se está aprovado, a partir do tipo de aviso.
    let externalReference = null;
    let pagamentoId = null;

    if (tipo === "payment") {
      // Payments API e Checkout Pro (o pagamento herda o external_reference).
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const pg = await resp.json();
      if (!resp.ok) { console.error("Erro ao consultar pagamento no MP:", pg); return res.status(200).end(); }
      if (pg.status === "approved") {
        externalReference = pg.external_reference;
        pagamentoId = pg.id;
      }
    } else if (tipo === "merchant_order") {
      // Checkout Pro também notifica por merchant_order.
      const resp = await fetch(`https://api.mercadopago.com/merchant_orders/${dataId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const mo = await resp.json();
      if (!resp.ok) { console.error("Erro ao consultar merchant_order no MP:", mo); return res.status(200).end(); }
      const aprovado = Array.isArray(mo.payments) && mo.payments.some((p) => p.status === "approved");
      if (aprovado || mo.order_status === "paid") {
        externalReference = mo.external_reference;
        const pagoAprovado = (mo.payments || []).find((p) => p.status === "approved");
        pagamentoId = pagoAprovado ? pagoAprovado.id : null;
      }
    } else if (tipo === "order") {
      // Orders API: notifica com type "order" (status "processed" = pago).
      const resp = await fetch(`https://api.mercadopago.com/v1/orders/${dataId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const ordem = await resp.json();
      if (!resp.ok) { console.error("Erro ao consultar order no MP:", ordem); return res.status(200).end(); }
      const pagamentos = (ordem.transactions && ordem.transactions.payments) || [];
      const pgOk = pagamentos.find((p) => p.status === "processed" || p.status === "approved");
      if (ordem.status === "processed" || pgOk) {
        externalReference = ordem.external_reference;
        pagamentoId = pgOk ? pgOk.id : null;
      }
    } else {
      // Outros tipos de aviso: ignorar (respondendo 200 para o MP aceitar).
      return res.status(200).end();
    }

    if (externalReference) {
      const [turmaId, alunoId] = String(externalReference).split("__");
      if (turmaId && alunoId) {
        await db
          .collection("turmas").doc(turmaId)
          .collection("alunos").doc(alunoId)
          .update({
            pago: true,
            pagamentoForma: "pix",
            pagamentoDeclarado: false,
            pagamentoMpId: pagamentoId ? String(pagamentoId) : admin.firestore.FieldValue.delete(),
            pagamentoEm: admin.firestore.FieldValue.serverTimestamp()
          });
        console.log(`Pagamento aprovado: turma ${turmaId}, aluno ${alunoId}.`);
      }
    }

    return res.status(200).end();
  } catch (erro) {
    // Respondemos 200 para o MP não re-tentar em looping; o erro fica nos logs.
    console.error("Erro no webhook:", erro);
    return res.status(200).end();
  }
};

// Valida a assinatura do webhook (cabeçalho x-signature) conforme o padrão do MP:
//   manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//   v1 = HMAC-SHA256(manifest, MP_WEBHOOK_SECRET)
function validarAssinatura(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sem secret configurado, não bloqueia (recomendamos configurar)

  const assinatura = req.headers["x-signature"] || "";
  const requestId = req.headers["x-request-id"] || "";

  const partes = {};
  assinatura.split(",").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v) partes[k.trim()] = v.trim();
  });
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1 || !dataId) return false;

  // IDs alfanuméricos devem ir em minúsculo no manifesto.
  const idManifest = String(dataId).toLowerCase();
  const manifest = `id:${idManifest};request-id:${requestId};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(esperado, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
