// POST /api/webhook-mp
// Recebe a notificação do Mercado Pago quando um pagamento muda de status.
// Valida a assinatura, consulta o pagamento e, se aprovado, marca o aluno
// como pago no Firestore (via Admin SDK — não depende das regras).
// Aproveita a mesma consulta para guardar a TAXA do Mercado Pago (o que ele
// desconta do recebimento) e o valor líquido, para o Financeiro mostrar
// quanto de fato entrou na conta e não só o preço da camiseta.
const crypto = require("crypto");
const { db, admin, COL_TIMES } = require("../lib/firebase");

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
    let valores = null; // { bruto, taxa, liquido } do Mercado Pago

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
        valores = extrairValores(pg);
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

    // merchant_order e order só trazem o id do pagamento; a taxa está no
    // pagamento em si, então buscamos o detalhe dele.
    if (!valores && pagamentoId) valores = await valoresDoPagamento(pagamentoId);

    if (externalReference) {
      const alvo = await resolverCobranca(externalReference);
      if (alvo && alvo.itens.length > 0) {
        // Uma cobrança pode ter várias camisetas, inclusive de times
        // diferentes (o carrinho de um responsável com filhos em mais de um
        // time). Todas viram pagas no mesmo lote — que atravessa coleções —,
        // para nenhuma ficar para trás se algo falhar no meio.
        // A taxa vem do pagamento inteiro; aqui ela é rateada camiseta a
        // camiseta, para o Financeiro somar o líquido por aluno/time.
        const rateio = ratearValores(alvo.itens, valores);

        const lote = db.batch();
        alvo.itens.forEach((item, i) => {
          const ref = db.collection(COL_TIMES).doc(item.timeId)
            .collection("alunos").doc(item.alunoId);
          const parte = rateio ? rateio[i] : null;
          const apagar = admin.firestore.FieldValue.delete();
          lote.update(ref, {
            pago: true,
            pagamentoForma: "pix",
            pagamentoDeclarado: false,
            pagamentoMpId: pagamentoId ? String(pagamentoId) : apagar,
            // Sem o detalhe do MP, os campos de taxa saem do documento em vez
            // de ficarem com um valor velho de uma tentativa anterior.
            pagamentoBruto: parte ? parte.bruto : apagar,
            pagamentoTaxa: parte ? parte.taxa : apagar,
            pagamentoLiquido: parte ? parte.liquido : apagar,
            pagamentoEm: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        if (alvo.cobrancaId) {
          lote.update(db.collection("cobrancas").doc(alvo.cobrancaId), {
            status: "paga",
            valorBruto: valores ? valores.bruto : admin.firestore.FieldValue.delete(),
            taxa: valores ? valores.taxa : admin.firestore.FieldValue.delete(),
            valorLiquido: valores ? valores.liquido : admin.firestore.FieldValue.delete(),
            pagaEm: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        await lote.commit();
        const times = [...new Set(alvo.itens.map((i) => i.timeId))];
        const resumoTaxa = valores
          ? ` Bruto ${valores.bruto} - taxa ${valores.taxa} = líquido ${valores.liquido}.`
          : " Sem detalhe de taxa do MP.";
        console.log(`Pagamento aprovado: ${alvo.itens.length} camiseta(s) em ${times.length} time(s) (${times.join(", ")}).${resumoTaxa}`);
      }
    }

    return res.status(200).end();
  } catch (erro) {
    // Respondemos 200 para o MP não re-tentar em looping; o erro fica nos logs.
    console.error("Erro no webhook:", erro);
    return res.status(200).end();
  }
};

// Descobre quais camisetas a cobrança paga, a partir do external_reference.
// Devolve { itens: [{ timeId, alunoId }], cobrancaId }. Dois formatos:
//   "lote:<id>"        -> documento em `cobrancas` com a lista das camisetas
//                         (o campo do MP é curto demais para levar os ids).
//   "<timeId>__<id>"   -> formato antigo, de uma camiseta só. Continua aceito
//                         para as cobranças criadas antes desta versão.
async function resolverCobranca(externalReference) {
  const ref = String(externalReference);

  if (ref.startsWith("lote:")) {
    const cobrancaId = ref.slice("lote:".length);
    if (!cobrancaId) return null;
    const snap = await db.collection("cobrancas").doc(cobrancaId).get();
    if (!snap.exists) {
      console.warn("Cobrança não encontrada:", cobrancaId);
      return null;
    }
    const dados = snap.data();

    // Formato atual: cada camiseta com o seu time (e o seu valor, quando a
    // cobrança foi criada por uma versão que já o guarda).
    if (Array.isArray(dados.itens)) {
      const itens = dados.itens
        .filter((i) => i && typeof i.timeId === "string" && typeof i.alunoId === "string")
        .map((i) => ({ timeId: i.timeId, alunoId: i.alunoId, valor: Number(i.valor) || 0 }));
      return { itens, cobrancaId };
    }

    // Cobranças gravadas antes do carrinho entre times: um time só.
    const alunoIds = Array.isArray(dados.alunoIds) ? dados.alunoIds.filter((x) => typeof x === "string") : [];
    const itens = dados.timeId ? alunoIds.map((alunoId) => ({ timeId: dados.timeId, alunoId })) : [];
    return { itens, cobrancaId };
  }

  const [timeId, alunoId] = ref.split("__");
  if (!timeId || !alunoId) return null;
  return { itens: [{ timeId, alunoId }], cobrancaId: null };
}

// Consulta um pagamento no MP só para pegar bruto/taxa/líquido. Usada quando o
// aviso veio como merchant_order ou order, que não trazem esse detalhe.
async function valoresDoPagamento(pagamentoId) {
  try {
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const pg = await resp.json();
    if (!resp.ok) {
      console.warn("Não foi possível ler a taxa do pagamento:", pg && pg.message);
      return null;
    }
    return extrairValores(pg);
  } catch (erro) {
    // Falhar aqui não pode impedir de marcar a camiseta como paga.
    console.warn("Erro ao consultar a taxa do pagamento:", erro);
    return null;
  }
}

// Bruto, taxa e líquido de um pagamento do Mercado Pago.
//   fee_details            -> as tarifas cobradas (a nossa é a do "collector")
//   net_received_amount    -> o que cai na conta depois da tarifa
// Quando um dos dois falta, o outro completa a conta.
function extrairValores(pg) {
  const bruto = Number(pg.transaction_amount || 0);
  if (!bruto) return null;

  const detalhes = Array.isArray(pg.fee_details) ? pg.fee_details : [];
  let taxa = detalhes
    .filter((f) => !f.fee_payer || f.fee_payer === "collector")
    .reduce((s, f) => s + (Number(f.amount) || 0), 0);

  const td = pg.transaction_details || {};
  let liquido = td.net_received_amount != null ? Number(td.net_received_amount) : null;

  // Nenhuma das duas informações veio: taxa desconhecida. Não gravamos zero,
  // que apareceria no relatório como "não teve taxa".
  if (detalhes.length === 0 && liquido == null) return null;

  if (!taxa && liquido != null) taxa = bruto - liquido;
  if (liquido == null) liquido = bruto - taxa;
  if (taxa < 0 || taxa > bruto) return null; // número estranho: melhor não gravar

  return { bruto: centavos(bruto), taxa: centavos(taxa), liquido: centavos(liquido) };
}

// Divide bruto/taxa/líquido entre as camisetas da cobrança, na proporção do
// preço de cada uma (cobranças antigas, sem o valor por item, dividem em
// partes iguais). A sobra dos centavos vai para a última camiseta, para a
// soma bater exatamente com o que o Mercado Pago informou.
function ratearValores(itens, valores) {
  if (!valores || itens.length === 0) return null;

  const pesos = itens.map((i) => (Number(i.valor) > 0 ? Number(i.valor) : 0));
  const somaPesos = pesos.reduce((s, v) => s + v, 0);
  const base = somaPesos > 0 ? pesos : itens.map(() => 1);
  const soma = somaPesos > 0 ? somaPesos : itens.length;

  const partes = itens.map((_, i) => ({
    bruto: centavos((valores.bruto * base[i]) / soma),
    taxa: centavos((valores.taxa * base[i]) / soma),
    liquido: centavos((valores.liquido * base[i]) / soma)
  }));

  // Ajuste do arredondamento na última parte.
  const ultima = partes[partes.length - 1];
  ["bruto", "taxa", "liquido"].forEach((campo) => {
    const somado = partes.reduce((s, p) => s + p[campo], 0);
    ultima[campo] = centavos(ultima[campo] + (valores[campo] - somado));
  });
  return partes;
}

// Arredonda para centavos (evita 0.1 + 0.2 aparecendo no relatório).
function centavos(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

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
