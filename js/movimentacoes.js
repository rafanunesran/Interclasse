// ============================================================
// FINANCEIRO → MOVIMENTAÇÕES (caixa)
// ============================================================
// Lançamentos feitos à mão pelo admin, fora dos pagamentos das camisetas:
//   - Saque: dinheiro retirado da conta/caixa (ex.: transferência para você).
//   - Pagamento: uma despesa paga (impressão, costureira, material, frete...).
//   - Entrada: dinheiro que entrou por fora dos pedidos (aporte, ajuste).
// Cada lançamento fica em `movimentacoes/{id}` (só o admin lê e grava — ver
// firestore.rules). Nada é apagado: "Cancelar" marca o lançamento como
// cancelado, e ele continua no histórico (riscado), com a data e o motivo.
//
// Saldo em caixa = recebido líquido dos pedidos (camisetas pagas, já sem a
// taxa do Mercado Pago) + entradas − saques − pagamentos. Pagamento marcado
// como "A pagar" (conta ainda em aberto) não sai do saldo até ser quitado.
//
// CUSTOS POR LOTE: um pagamento pode ser ligado a um lote (uma leva da aba
// Produção). O total lançado no lote é dividido pelas unidades dele, e esse
// custo real por unidade substitui a estimativa da aba Tamanhos no Financeiro
// (Impressão e Costureira por categoria; as demais categorias — malha, frete…
// — entram como "outros custos"). Ver custosDosLotes() e calcularFinanceiro().
//
// Carregado depois de js/admin.js: usa o estado e os auxiliares do Financeiro.

const COL_MOVIMENTACOES = "movimentacoes";

const MOV_TIPOS = {
  saque: { label: "Saque", sinal: -1 },
  pagamento: { label: "Pagamento", sinal: -1 },
  entrada: { label: "Entrada", sinal: 1 }
};

const MOV_CATEGORIAS = ["Impressão", "Costureira", "Malha / camisetas", "Material", "Frete / entrega", "Taxas e tarifas", "Outros"];

const MOV_FORMAS = { pix: "PIX", transferencia: "Transferência", dinheiro: "Dinheiro", cartao: "Cartão", boleto: "Boleto" };

let movimentacoes = [];          // [{ id, ...dados }]
let movCarregadas = false;
let movMostrarCanceladas = false;
let movTipoFiltro = "";          // "" = todos
let movFormAberto = false;
let movRascunho = null;          // o que foi digitado no formulário (sobrevive a re-render)
let movErroLeitura = false;      // regras do Firestore ainda sem a coleção

FIN_VISOES.push({ id: "movimentacoes", label: "Movimentações" });
FIN_VISOES.push({ id: "lotes", label: "Custos por lote" });

// Categorias que substituem a estimativa da aba Tamanhos; o resto vira "outros".
const MOV_CAT_CUSTO = { "Impressão": "impressao", "Costureira": "costureira" };

function escutarMovimentacoes() {
  db.collection(COL_MOVIMENTACOES).onSnapshot(
    (snap) => {
      movimentacoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      movCarregadas = true;
      // Custos de lote mudam o custo por unidade: recalcula o Financeiro
      // inteiro (e o resumo de custo nos cards das levas).
      renderizarFinanceiro();
      if (typeof renderizarProducao === "function") renderizarProducao();
    },
    (erro) => {
      console.error("Erro ao carregar as movimentações:", erro);
      movCarregadas = true;
      movErroLeitura = true;
      if (finVisao === "movimentacoes" || finVisao === "lotes") renderizarVisaoFinanceira(finUltimo || calcularFinanceiro());
    }
  );
}

// Data (YYYY-MM-DD) de hoje no fuso local.
function movHojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function movDataDe(m) {
  return m.data ? new Date(m.data + "T12:00:00") : finParaData(m.criadoEm);
}

function movDataBr(iso) {
  if (!iso) return "—";
  const [a, mes, d] = String(iso).split("-");
  return `${d}/${mes}/${a}`;
}

// Movimentações que passam pelo seletor de cliente do topo. Com um cliente
// escolhido, só as ligadas a ele; as gerais (sem cliente) só em "Todos".
function movDoCliente() {
  return movimentacoes.filter((m) => {
    if (!clienteFiltro) return true;
    const id = m.clienteId || "";
    return clienteFiltro === SEM_CLIENTE ? !id : id === clienteFiltro;
  });
}

function movAtivas(lista) {
  return lista.filter((m) => m.cancelado !== true);
}

// Soma por tipo. Pagamento "A pagar" fica à parte (aPagar): ainda não saiu do caixa.
function movSomar(lista) {
  const r = { saque: 0, pagamento: 0, entrada: 0, aPagar: 0, qtdAPagar: 0 };
  lista.forEach((m) => {
    const v = Number(m.valor) || 0;
    if (m.tipo === "pagamento" && m.aPagar === true) {
      r.aPagar += v;
      r.qtdAPagar++;
      return;
    }
    if (r[m.tipo] !== undefined) r[m.tipo] += v;
  });
  return r;
}

// ---------------- Custos por lote ----------------

// Nome de um lote (leva da Produção) — ou o que ficou gravado, se foi excluída.
function movNomeLote(levaId, reserva) {
  const e = typeof estadoLevas !== "undefined" ? estadoLevas[levaId] : null;
  return (e && e.leva.nome) || reserva || "Leva excluída";
}

function movOpcoesLotes(selecionado) {
  if (typeof levasOrdenadas !== "function") return "";
  return levasOrdenadas()
    .map(({ leva, itens }) =>
      `<option value="${escAttr(leva.id)}"${leva.id === selecionado ? " selected" : ""}>${escapeHtmlAdmin(leva.nome || "Leva sem nome")} (${itens.length} un.)</option>`)
    .join("");
}

// Pagamentos válidos (não cancelados) ligados a um lote — "A pagar" inclusive:
// a conta em aberto já é custo do lote, só não saiu do caixa.
function movCustosDoLote(levaId) {
  return movimentacoes.filter((m) => m.levaId === levaId && m.tipo === "pagamento" && m.cancelado !== true);
}

function levaTemCustos(levaId) {
  return movCustosDoLote(levaId).length > 0;
}

// Custo real de cada lote e o rateio por unidade.
//   lotes:   um resumo por lote com custos (total, por categoria, por unidade,
//            estimativa da tabela para comparar)
//   porItem: "timeId__alunoId" -> { impressao, costureira, outros } por unidade
//            (null = aquele lote não tem custo da categoria: vale a tabela).
// Uma camiseta que foi para dois lotes com custo (reimpressão) soma os dois.
function custosDosLotes() {
  const porItem = new Map();
  const lotes = [];
  let custoAvulsas = 0;
  let qtdAvulsas = 0;

  const porLeva = {};
  movimentacoes.forEach((m) => {
    if (m.tipo !== "pagamento" || m.cancelado === true || !m.levaId) return;
    (porLeva[m.levaId] = porLeva[m.levaId] || []).push(m);
  });
  if (Object.keys(porLeva).length === 0) return { porItem, lotes, custoAvulsas, qtdAvulsas, projecao: {} };

  Object.entries(porLeva).forEach(([levaId, movs]) => {
    const e = typeof estadoLevas !== "undefined" ? estadoLevas[levaId] : null;
    const itens = e ? e.itens : [];
    const c = { impressao: 0, costureira: 0, outros: 0, aPagar: 0, porCategoria: {} };
    const tem = { impressao: false, costureira: false };
    movs.forEach((m) => {
      const v = Number(m.valor) || 0;
      const k = MOV_CAT_CUSTO[m.categoria] || "outros";
      c[k] += v;
      if (tem[k] !== undefined) tem[k] = true;
      const cat = m.categoria || "Outros";
      c.porCategoria[cat] = (c.porCategoria[cat] || 0) + v;
      if (m.aPagar === true) c.aPagar += v;
    });
    const total = c.impressao + c.costureira + c.outros;
    const unidades = itens.length;
    const un = unidades > 0
      ? { impressao: c.impressao / unidades, costureira: c.costureira / unidades, outros: c.outros / unidades }
      : { impressao: 0, costureira: 0, outros: 0 };
    const porUnidade = unidades > 0 ? total / unidades : 0;

    // Estimativa da tabela (aba Tamanhos) para as mesmas unidades — a comparação.
    let estimado = 0;
    const est = { impressao: 0, costureira: 0 };
    let semPedido = 0;
    // Impressão é por metro linear: rateada pela ÁREA das peças de cada
    // camiseta (js/custo-impressao.js). Faltando o molde de alguma, divide
    // igual para todas.
    const atuais = itens.map((i) => typeof itemAtual === "function" ? itemAtual(i) : { tamanho: i.tamanho, avulso: i.origem === "avulso" });
    const cacheArea = new Map();
    let pesos = typeof areaDaCamisetaMm2 === "function"
      ? itens.map((i, idx) => areaDaCamisetaMm2(i, atuais[idx], cacheArea)) : [];
    const rateioArea = pesos.length > 0 && pesos.every((p) => p > 0);
    if (!rateioArea) pesos = itens.map(() => 1);
    const somaPesos = pesos.reduce((a, b) => a + b, 0) || 1;
    itens.forEach((i, idx) => {
      const atual = atuais[idx];
      const impItem = c.impressao * pesos[idx] / somaPesos;
      est.impressao += custoImpressaoDoTamanho(atual.tamanho);
      est.costureira += custoCostureiraDoTamanho(atual.tamanho);
      estimado += custoImpressaoDoTamanho(atual.tamanho) + custoCostureiraDoTamanho(atual.tamanho);
      // Avulsa (ou camiseta que sumiu do pedido): não tem aluno para carregar o custo.
      if (atual.avulso || atual.removido) {
        semPedido++;
        custoAvulsas += impItem + un.costureira + un.outros;
        return;
      }
      const chave = `${i.timeId}__${i.alunoId}`;
      const r = porItem.get(chave) || { impressao: null, costureira: null, outros: 0 };
      if (tem.impressao) r.impressao = (r.impressao || 0) + impItem;
      if (tem.costureira) r.costureira = (r.costureira || 0) + un.costureira;
      r.outros += un.outros;
      porItem.set(chave, r);
    });
    qtdAvulsas += semPedido;

    lotes.push({
      levaId,
      nome: movNomeLote(levaId, movs[0].levaNome),
      existe: !!e,
      criadaEmMs: e ? e.leva.criadaEmMs || 0 : 0,
      unidades, semPedido, lancamentos: movs.length,
      ...c, tem, est, total, un, porUnidade, estimado, rateioArea,
      metros: movs.reduce((s, m) => s + (Number(m.metrosLineares) || 0), 0),
      estimadoUnidade: unidades > 0 ? estimado / unidades : 0
    });
  });

  lotes.sort((a, b) => (b.criadaEmMs || 0) - (a.criadaEmMs || 0));

  // PROJEÇÃO para o que ainda não foi para a produção: o lote mais recente com
  // custo de cada categoria vira a nova referência.
  //   Impressão/Costureira: fator = real ÷ tabela daquele lote, aplicado à
  //   tabela de cada tamanho (mantém a diferença entre P, GG, Plus Size...).
  //   Sem custo na tabela, vale o custo por unidade do lote, igual para todos.
  //   Outros (malha, frete...): o custo por unidade do lote.
  const projecao = {};
  ["impressao", "costureira"].forEach((k) => {
    const l = lotes.find((x) => x.existe && x.unidades > 0 && x.tem[k]);
    if (!l) return;
    projecao[k] = {
      lote: l.nome,
      fator: l.est[k] > 0 ? l[k] / l.est[k] : null,
      porUnidade: l.un[k]
    };
  });
  const lOut = lotes.find((x) => x.existe && x.unidades > 0 && x.outros > 0);
  if (lOut) projecao.outros = { lote: lOut.nome, porUnidade: lOut.un.outros };

  return { porItem, lotes, custoAvulsas, qtdAvulsas, projecao };
}

// Custo de uma categoria para uma camiseta que ainda não está em lote com
// custo: a projeção do último lote, ou a tabela da aba Tamanhos se não houver.
function custoProjetado(lotes, k, tamanho) {
  const tabela = k === "impressao" ? custoImpressaoDoTamanho(tamanho)
    : k === "costureira" ? custoCostureiraDoTamanho(tamanho) : 0;
  const p = lotes && lotes.projecao && lotes.projecao[k];
  if (!p) return tabela;
  if (k === "outros") return p.porUnidade;
  return p.fator !== null ? tabela * p.fator : p.porUnidade;
}

// Recebido líquido dos pedidos (camisetas pagas, sem a taxa do MP).
function movRecebidoLiquido(lanc) {
  return lanc.reduce((s, l) => s + l.liquido, 0);
}

// Movimentações dentro do período do filtro (e do tipo/time escolhidos).
function movFiltrar() {
  const { de, ate } = finLimitesPeriodo();
  return movDoCliente()
    .filter((m) => movMostrarCanceladas || m.cancelado !== true)
    .filter((m) => !movTipoFiltro || m.tipo === movTipoFiltro)
    .filter((m) => !finTimeFiltro || m.timeId === finTimeFiltro)
    .filter((m) => {
      const d = movDataDe(m);
      if (!d) return true;
      if (de && d < de) return false;
      if (ate && d > ate) return false;
      return true;
    })
    .sort((a, b) =>
      String(b.data || "").localeCompare(String(a.data || "")) ||
      ((finParaData(b.criadoEm) || 0) - (finParaData(a.criadoEm) || 0)));
}

function movOpcoesTimes(selecionado) {
  return timesFiltrados()
    .sort(([, a], [, b]) => String(a.time.nome).localeCompare(String(b.time.nome), "pt-BR"))
    .map(([id, { time }]) =>
      `<option value="${escAttr(id)}"${id === selecionado ? " selected" : ""}>${escapeHtmlAdmin(time.nome)}</option>`)
    .join("");
}

function movRascunhoVazio() {
  return { tipo: "saque", data: movHojeIso(), valor: "", descricao: "", categoria: "", forma: "pix", timeId: "", levaId: "", situacao: "pago" };
}

// Abre o formulário já como custo de um lote (botão da visão Custos por lote).
function movNovoCustoDoLote(levaId) {
  movRascunho = { ...movRascunhoVazio(), tipo: "pagamento", categoria: "Impressão", levaId };
  movFormAberto = true;
  finVisao = "movimentacoes";
  renderizarFinanceiro();
  const campo = document.querySelector('#movForm [data-mov="valor"]');
  if (campo) {
    campo.scrollIntoView({ block: "center" });
    campo.focus();
  }
}

function finViewMovimentacoes(alvo, f) {
  if (!movCarregadas) {
    alvo.innerHTML = '<p class="pix-ajuda">Carregando as movimentações…</p>';
    return;
  }

  // Saldo: tudo desde o início (não depende do período escolhido).
  const lancTodos = finLancamentos();
  const totAtivas = movSomar(movAtivas(movDoCliente()));
  const recebidoLiq = movRecebidoLiquido(lancTodos);
  const saldo = recebidoLiq + totAtivas.entrada - totAtivas.saque - totAtivas.pagamento;
  // Disponível para saque = lucro realizado (recebido − custos das camisetas
  // pagas − taxas − internas − avulsas dos lotes) − tudo o que já foi sacado.
  const lucroRealizado = (f || finUltimo || calcularFinanceiro()).lucroRealizado || 0;
  const disponivelSaque = lucroRealizado - totAtivas.saque;
  const contasAPagar = movAtivas(movDoCliente()).filter((m) => m.tipo === "pagamento" && m.aPagar === true);

  // Recorte do período (o que aparece na lista e nos totais do período).
  const lista = movFiltrar();
  const noPeriodo = movSomar(movAtivas(lista));
  const { dentro } = finFiltrar(lancTodos);
  const recebidoPeriodo = movRecebidoLiquido(dentro);
  const { label } = finLimitesPeriodo();

  const r = movRascunho || movRascunhoVazio();

  const form = movFormAberto ? `
    <form class="card mov-form" id="movForm" novalidate>
      <h3 class="titulo-bloco">Nova movimentação</h3>
      <div class="mov-tipos" role="radiogroup" aria-label="Tipo">
        ${Object.entries(MOV_TIPOS).map(([id, t]) =>
          `<label class="mov-tipo${r.tipo === id ? " ativo" : ""}"><input type="radio" name="movTipo" value="${id}"${r.tipo === id ? " checked" : ""} /> ${t.label}</label>`).join("")}
      </div>
      <div class="grade-2">
        <label>Valor (R$)<input type="number" data-mov="valor" min="0.01" step="0.01" inputmode="decimal" value="${escAttr(r.valor)}" required /></label>
        <label>Data<input type="date" data-mov="data" value="${escAttr(r.data)}" required /></label>
      </div>
      <label>Descrição<input type="text" data-mov="descricao" value="${escAttr(r.descricao)}" maxlength="140" placeholder="${r.tipo === "saque" ? "Ex: Transferência para a minha conta" : r.tipo === "pagamento" ? "Ex: Gráfica — leva 3" : "Ex: Aporte para comprar malha"}" /></label>
      <div class="grade-2">
        ${r.tipo === "pagamento"
          ? `<label>Categoria<select data-mov="categoria"><option value="">—</option>${MOV_CATEGORIAS.map((c) =>
              `<option${c === r.categoria ? " selected" : ""}>${escapeHtmlAdmin(c)}</option>`).join("")}</select></label>`
          : ""}
        <label>Forma<select data-mov="forma">${Object.entries(MOV_FORMAS).map(([id, n]) =>
          `<option value="${id}"${id === r.forma ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Time (opcional)<select data-mov="timeId"><option value="">Geral (nenhum time)</option>${movOpcoesTimes(r.timeId)}</select></label>
      </div>
      ${r.tipo === "pagamento" ? `
      <div class="grade-2">
        <label>Lote (leva da Produção)<select data-mov="levaId"><option value="">Nenhum (despesa geral)</option>${movOpcoesLotes(r.levaId)}</select></label>
        <label>Situação<select data-mov="situacao">
          <option value="pago"${r.situacao !== "apagar" ? " selected" : ""}>Pago (sai do caixa)</option>
          <option value="apagar"${r.situacao === "apagar" ? " selected" : ""}>A pagar (conta em aberto)</option>
        </select></label>
      </div>
      <p class="pix-ajuda">Ligado a um lote, o valor é dividido pelas unidades dele e vira o <strong>custo real por unidade</strong> dessas camisetas no Financeiro (Impressão e Costureira substituem a tabela da aba Tamanhos; as outras categorias somam como “outros custos”).</p>` : ""}
      <div class="mov-form-acoes">
        <button type="button" class="secundario" data-mov-acao="cancelar-form">Cancelar</button>
        <button type="submit" class="primario">Lançar</button>
      </div>
      <p class="msg-mov oculto"></p>
    </form>` : "";

  const linhas = lista.map((m) => {
    const t = MOV_TIPOS[m.tipo] || { label: m.tipo, sinal: -1 };
    const time = m.timeId && estadoTimes[m.timeId] ? estadoTimes[m.timeId].time.nome : (m.timeNome || "");
    const canc = m.cancelado === true;
    const lote = m.levaId ? "Lote: " + movNomeLote(m.levaId, m.levaNome) : "";
    const detalhes = [m.categoria, MOV_FORMAS[m.forma], time, lote].filter(Boolean).map(escapeHtmlAdmin).join(" · ");
    const aPagar = !canc && m.tipo === "pagamento" && m.aPagar === true;
    const quitado = m.tipo === "pagamento" && m.pagoEm && m.aPagar === false
      ? `<br><span class="fin-dica">Quitado em ${movDataBr(m.pagoEm)}</span>` : "";
    const quando = finParaData(m.criadoEm);
    const obsCanc = canc
      ? `<span class="mov-cancelado-info">Cancelado${m.canceladoEm ? " em " + escapeHtmlAdmin(finParaData(m.canceladoEm).toLocaleString("pt-BR")) : ""}${m.motivoCancelamento ? ": " + escapeHtmlAdmin(m.motivoCancelamento) : ""}</span>`
      : "";
    return `<tr class="${canc ? "mov-cancelado" : ""}">
      <td>${movDataBr(m.data)}</td>
      <td><span class="badge mov-${escAttr(m.tipo)}">${escapeHtmlAdmin(t.label)}</span>${aPagar ? '<br><span class="badge mov-apagar">A pagar</span>' : ""}</td>
      <td>${escapeHtmlAdmin(m.descricao || "—")}${detalhes ? `<br><span class="fin-dica">${detalhes}</span>` : ""}${quitado}${obsCanc ? "<br>" + obsCanc : ""}</td>
      <td class="${t.sinal < 0 ? "fin-vermelho" : "fin-verde"} mov-valor">${t.sinal < 0 ? "−" : "+"}${formatarReais(Number(m.valor) || 0)}</td>
      <td class="fin-dica" title="Quando foi lançado">${quando ? escapeHtmlAdmin(quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })) : ""}</td>
      <td>${aPagar ? `<button type="button" class="primario mov-btn-cancelar" data-mov-quitar="${escAttr(m.id)}" title="A conta foi paga: passa a sair do caixa">Marcar como pago</button>` : ""}${canc ? "" : `<button type="button" class="secundario mov-btn-cancelar" data-mov-cancelar="${escAttr(m.id)}" title="Cancelar lançamento">Cancelar</button>`}</td>
    </tr>`;
  }).join("");

  alvo.innerHTML = `
    ${movErroLeitura ? '<p class="erro">Não foi possível ler as movimentações. Publique o <strong>firestore.rules</strong> atualizado no console do Firebase (ele ganhou a coleção <code>movimentacoes</code>).</p>' : ""}
    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Saldo em caixa</span>
        <span class="fin-valor">${formatarReais(saldo)}</span>
        <span class="fin-sub">desde o início${clienteFiltro ? " · cliente escolhido" : ""}</span>
      </div>
      <div class="fin-card fin-card-verde">
        <span class="fin-rotulo">Recebido dos pedidos</span>
        <span class="fin-valor fin-valor-md">${formatarReais(recebidoPeriodo)}</span>
        <span class="fin-sub">líquido · ${escapeHtmlAdmin(label)}${noPeriodo.entrada ? ` · + ${formatarReais(noPeriodo.entrada)} de entradas` : ""}</span>
      </div>
      <div class="fin-card fin-card-vermelho">
        <span class="fin-rotulo">Disponível para saque</span>
        <span class="fin-valor fin-valor-md">${formatarReais(disponivelSaque)}</span>
        <span class="fin-sub">lucro realizado ${formatarReais(lucroRealizado)} − sacado ${formatarReais(totAtivas.saque)}</span>
        <span class="fin-sub">saques ${escapeHtmlAdmin(label)}: ${formatarReais(noPeriodo.saque)}</span>
      </div>
      <div class="fin-card fin-card-amarelo">
        <span class="fin-rotulo">Pagamentos</span>
        <span class="fin-valor fin-valor-md">${formatarReais(noPeriodo.pagamento)}</span>
        <span class="fin-sub">${escapeHtmlAdmin(label)}</span>
      </div>
    </div>
    ${contasAPagar.length ? `<p class="aviso">Contas a pagar: <strong>${formatarReais(contasAPagar.reduce((s, m) => s + (Number(m.valor) || 0), 0))}</strong> em ${contasAPagar.length} lançamento(s) — ainda fora do saldo. Use <em>Marcar como pago</em> quando quitar.</p>` : ""}
    <p class="pix-ajuda">Saldo = recebido dos pedidos (já sem a taxa do Mercado Pago) + entradas − saques − pagamentos já pagos. <strong>Disponível para saque</strong> = lucro realizado (Visão geral) − tudo o que já foi sacado. Pagamentos ligados a um <strong>lote</strong> viram o custo real por unidade daquele lote no Financeiro (veja <em>Custos por lote</em>); os demais não mudam o DRE, que usa os custos por tamanho.</p>

    ${movFormAberto ? form : `<button type="button" class="primario" data-mov-acao="abrir-form">${icone("plus")} Nova movimentação</button>`}

    ${finBarraFiltrosHtml(true)}
    <div class="fin-filtros-linha">
      <label for="movTipoFiltro">Tipo</label>
      <select id="movTipoFiltro">
        <option value="">Todos</option>
        ${Object.entries(MOV_TIPOS).map(([id, t]) => `<option value="${id}"${id === movTipoFiltro ? " selected" : ""}>${t.label}</option>`).join("")}
      </select>
      <label class="checkbox-inline"><input type="checkbox" id="movMostrarCanceladas"${movMostrarCanceladas ? " checked" : ""} /> Mostrar canceladas</label>
    </div>

    <h3 class="fin-titulo">Histórico</h3>
    ${lista.length === 0
      ? `<p class="pix-ajuda">Nenhuma movimentação ${movimentacoes.length ? "neste filtro" : "lançada ainda"}.</p>`
      : `<div class="fin-tabela-wrap"><table class="fin-tabela mov-tabela">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Lançado em</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table></div>`}
  `;

  finLigarFiltros(alvo, finUltimo || calcularFinanceiro());
  movLigar(alvo);
}

function movLigar(alvo) {
  const redesenhar = () => renderizarVisaoFinanceira(finUltimo || calcularFinanceiro());

  const abrir = alvo.querySelector('[data-mov-acao="abrir-form"]');
  if (abrir) abrir.onclick = () => { movFormAberto = true; redesenhar(); };

  const selTipo = alvo.querySelector("#movTipoFiltro");
  if (selTipo) selTipo.onchange = () => { movTipoFiltro = selTipo.value; redesenhar(); };
  const chk = alvo.querySelector("#movMostrarCanceladas");
  if (chk) chk.onchange = () => { movMostrarCanceladas = chk.checked; redesenhar(); };

  alvo.querySelectorAll("[data-mov-cancelar]").forEach((b) => {
    b.onclick = () => cancelarMovimentacao(b.dataset.movCancelar);
  });
  alvo.querySelectorAll("[data-mov-quitar]").forEach((b) => {
    b.onclick = () => quitarMovimentacao(b.dataset.movQuitar);
  });

  const form = alvo.querySelector("#movForm");
  if (!form) return;

  const lerForm = () => {
    const r = movRascunho || {};
    const tipo = form.querySelector('input[name="movTipo"]:checked');
    r.tipo = tipo ? tipo.value : "saque";
    form.querySelectorAll("[data-mov]").forEach((el) => (r[el.dataset.mov] = el.value));
    movRascunho = r;
    return r;
  };
  form.querySelectorAll("[data-mov]").forEach((el) => el.addEventListener("input", lerForm));
  // Trocar o tipo muda o formulário (a categoria só existe em Pagamento).
  form.querySelectorAll('input[name="movTipo"]').forEach((el) =>
    el.addEventListener("change", () => { lerForm(); redesenhar(); }));
  form.querySelector('[data-mov-acao="cancelar-form"]').onclick = () => {
    movFormAberto = false;
    movRascunho = null;
    redesenhar();
  };

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const r = lerForm();
    const msg = form.querySelector(".msg-mov");
    const valor = Math.round(Number(String(r.valor).replace(",", ".")) * 100) / 100;
    if (!(valor > 0)) {
      mostrarMensagem(msg, "Informe um valor maior que zero.", "erro");
      return;
    }
    if (!r.data) {
      mostrarMensagem(msg, "Informe a data.", "erro");
      return;
    }
    const time = r.timeId && estadoTimes[r.timeId] ? estadoTimes[r.timeId].time : null;
    const ehPagamento = r.tipo === "pagamento";
    const levaId = ehPagamento && r.levaId && typeof estadoLevas !== "undefined" && estadoLevas[r.levaId] ? r.levaId : "";
    // Movimentação geral lançada com um cliente escolhido no topo fica com ele.
    const clienteId = time ? clienteIdDoTime(time) : (clienteFiltro && clienteFiltro !== SEM_CLIENTE ? clienteFiltro : "");
    const dados = {
      tipo: MOV_TIPOS[r.tipo] ? r.tipo : "saque",
      valor,
      data: r.data,
      descricao: String(r.descricao || "").trim(),
      forma: MOV_FORMAS[r.forma] ? r.forma : "pix",
      categoria: ehPagamento ? (r.categoria || "") : "",
      levaId,
      levaNome: levaId ? (estadoLevas[levaId].leva.nome || "") : "",
      aPagar: ehPagamento && r.situacao === "apagar",
      timeId: time ? r.timeId : "",
      timeNome: time ? time.nome : "",
      clienteId,
      cancelado: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    };
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await db.collection(COL_MOVIMENTACOES).add(dados);
      movFormAberto = false;
      movRascunho = null;
      redesenhar();
    } catch (erro) {
      console.error(erro);
      botao.disabled = false;
      mostrarMensagem(msg, "Erro ao lançar. Confira se o firestore.rules atualizado foi publicado no Firebase.", "erro");
    }
  });
}

// Conta "A pagar" quitada: passa a sair do caixa (com a data de hoje).
async function quitarMovimentacao(id) {
  const m = movimentacoes.find((x) => x.id === id);
  if (!m) return;
  const data = prompt(
    `Marcar como pago: ${m.descricao || m.categoria || "pagamento"} de ${formatarReais(Number(m.valor) || 0)}.\n\n` +
    "Data do pagamento (AAAA-MM-DD):", movHojeIso());
  if (data === null) return;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(data.trim()) ? data.trim() : movHojeIso();
  try {
    await db.collection(COL_MOVIMENTACOES).doc(id).update({
      aPagar: false,
      pagoEm: iso,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (erro) {
    console.error(erro);
    alert("Erro ao marcar como pago. Tente novamente.");
  }
}

async function cancelarMovimentacao(id) {
  const m = movimentacoes.find((x) => x.id === id);
  if (!m) return;
  const t = MOV_TIPOS[m.tipo] ? MOV_TIPOS[m.tipo].label : m.tipo;
  const motivo = prompt(
    `Cancelar ${t.toLowerCase()} de ${formatarReais(Number(m.valor) || 0)} (${movDataBr(m.data)})?\n\n` +
    "Ele deixa de contar no saldo, mas continua no histórico. Motivo (opcional):", "");
  if (motivo === null) return;
  try {
    await db.collection(COL_MOVIMENTACOES).doc(id).update({
      cancelado: true,
      motivoCancelamento: motivo.trim(),
      canceladoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (erro) {
    console.error(erro);
    alert("Erro ao cancelar. Tente novamente.");
  }
}

function exportarMovimentacoes() {
  const lista = movFiltrar();
  if (lista.length === 0) {
    alert("Nenhuma movimentação no filtro atual.");
    return;
  }
  const linhas = [["Data", "Tipo", "Valor", "Descricao", "Categoria", "Forma", "Time", "Lote", "Pagamento", "Situacao", "Motivo do cancelamento", "Lancado em"]];
  lista.forEach((m) => {
    const t = MOV_TIPOS[m.tipo] || { label: m.tipo, sinal: -1 };
    const quando = finParaData(m.criadoEm);
    linhas.push([
      movDataBr(m.data), t.label, ((Number(m.valor) || 0) * t.sinal).toFixed(2), m.descricao || "",
      m.categoria || "", MOV_FORMAS[m.forma] || "", m.timeNome || "",
      m.levaId ? movNomeLote(m.levaId, m.levaNome) : "",
      m.tipo !== "pagamento" ? "" : m.aPagar ? "A pagar" : (m.pagoEm ? "Pago em " + movDataBr(m.pagoEm) : "Pago"),
      m.cancelado ? "Cancelado" : "Valido", m.motivoCancelamento || "",
      quando ? quando.toLocaleString("pt-BR") : ""
    ]);
  });
  baixarCSV(`movimentacoes-interclasse${sufixoCliente()}.csv`, linhas);
}

// ---------------- Visão: Custos por lote ----------------

// Um lote = uma leva da aba Produção. Mostra o que foi gasto em cada lote, o
// custo REAL por unidade (total ÷ unidades do lote) e a comparação com a
// estimativa da aba Tamanhos. Lançar um custo aqui é lançar um Pagamento
// ligado ao lote — ele aparece também em Movimentações.
function finViewLotes(alvo) {
  if (!movCarregadas) {
    alvo.innerHTML = '<p class="pix-ajuda">Carregando os custos…</p>';
    return;
  }
  const levas = typeof levasOrdenadas === "function" ? levasOrdenadas() : [];
  const { lotes, projecao } = custosDosLotes();
  const porId = {};
  lotes.forEach((l) => (porId[l.levaId] = l));

  // Todas as levas (com ou sem custo) + as excluídas que ainda têm custos.
  const linhas = levas.map(({ leva, itens }) => porId[leva.id] || {
    levaId: leva.id, nome: leva.nome || "Leva sem nome", existe: true, unidades: itens.length, semPedido: 0,
    lancamentos: 0, impressao: 0, costureira: 0, outros: 0, aPagar: 0, total: 0, porUnidade: 0,
    un: { impressao: 0, costureira: 0, outros: 0 }, porCategoria: {},
    estimadoUnidade: itens.length
      ? itens.reduce((s, i) => {
          const t = itemAtual(i).tamanho;
          return s + custoImpressaoDoTamanho(t) + custoCostureiraDoTamanho(t);
        }, 0) / itens.length
      : 0
  });
  lotes.filter((l) => !l.existe).forEach((l) => linhas.push(l));

  const comCusto = lotes.filter((l) => l.unidades > 0);
  const totalGasto = lotes.reduce((s, l) => s + l.total, 0);
  const totalAPagar = lotes.reduce((s, l) => s + l.aPagar, 0);
  const unidades = comCusto.reduce((s, l) => s + l.unidades, 0);
  const medio = unidades > 0 ? comCusto.reduce((s, l) => s + l.total, 0) / unidades : 0;

  const tabela = linhas.map((l) => {
    const dif = l.total > 0 && l.unidades > 0 ? l.porUnidade - l.estimadoUnidade : null;
    const cats = Object.entries(l.porCategoria || {})
      .map(([c, v]) => `${escapeHtmlAdmin(c)}: ${formatarReais(v)}`).join(" · ");
    return `<tr>
      <td><strong>${escapeHtmlAdmin(l.nome)}</strong>${!l.existe ? ' <span class="badge pendente">excluída</span>' : ""}
        ${cats ? `<br><span class="fin-dica">${cats}</span>` : ""}
        ${l.metros > 0 ? `<br><span class="fin-dica">${l.metros.toLocaleString("pt-BR")} m lineares de impressão</span>` : ""}
        ${l.impressao > 0 ? `<br><span class="fin-dica">Impressão rateada ${l.rateioArea ? "pela área das peças" : "igual por unidade (falta molde de algum tamanho)"}</span>` : ""}
        ${l.aPagar > 0 ? `<br><span class="badge mov-apagar">A pagar ${formatarReais(l.aPagar)}</span>` : ""}
        ${l.total > 0 && l.unidades === 0 ? '<br><span class="fin-dica fin-vermelho">Lote sem unidades: não dá para ratear.</span>' : ""}</td>
      <td>${l.unidades}${l.semPedido ? ` <span class="fin-dica">(${l.semPedido} avulsa(s))</span>` : ""}</td>
      <td>${formatarReais(l.total)}</td>
      <td>${l.total > 0 && l.unidades > 0
        ? `<strong>${formatarReais(l.porUnidade)}</strong> <span class="fin-dica">(média)</span><br><span class="fin-dica">imp. ${formatarReais(l.un.impressao)} · cost. ${formatarReais(l.un.costureira)}${l.un.outros ? ` · outros ${formatarReais(l.un.outros)}` : ""}</span>`
        : "—"}</td>
      <td>${formatarReais(l.estimadoUnidade)}</td>
      <td class="${dif === null ? "" : dif > 0 ? "fin-vermelho" : "fin-verde"}">${dif === null ? "—" : (dif > 0 ? "+" : "−") + formatarReais(Math.abs(dif))}</td>
      <td>${l.existe ? `${typeof abrirCalculadoraMetro === "function" ? `<button type="button" class="primario mov-btn-cancelar" data-lote-metro="${escAttr(l.levaId)}" title="Encaixa as peças do lote no rolo e calcula a impressão por metro linear">📏 Impressão por metro</button>` : ""}<button type="button" class="secundario mov-btn-cancelar" data-lote-custo="${escAttr(l.levaId)}">+ Lançar custo</button>` : ""}</td>
    </tr>`;
  }).join("");

  alvo.innerHTML = `
    ${movErroLeitura ? '<p class="erro">Não foi possível ler as movimentações. Publique o <strong>firestore.rules</strong> atualizado no console do Firebase.</p>' : ""}
    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Gasto nos lotes</span>
        <span class="fin-valor fin-valor-md">${formatarReais(totalGasto)}</span>
        <span class="fin-sub">${lotes.length} lote(s) com custo lançado</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Custo real médio</span>
        <span class="fin-valor fin-valor-md">${formatarReais(medio)}</span>
        <span class="fin-sub">por unidade · ${unidades} unidade(s)</span>
      </div>
      <div class="fin-card fin-card-amarelo">
        <span class="fin-rotulo">A pagar</span>
        <span class="fin-valor fin-valor-md">${formatarReais(totalAPagar)}</span>
        <span class="fin-sub">custos de lote ainda em aberto</span>
      </div>
    </div>
    <p class="pix-ajuda">Cada lote é uma <strong>leva</strong> da aba Produção. Lance o que foi gasto nela (ex.: <em>Lote 1 — impressão R$ 800</em>) e o site divide pelo número de unidades do lote: esse passa a ser o custo por unidade daquelas camisetas no Financeiro (Visão geral, DRE e lucro). <strong>Impressão</strong> e <strong>Costureira</strong> substituem a estimativa da aba Tamanhos; malha, frete e outras categorias somam como “outros custos”. Se entrar ou sair camiseta do lote, o custo por unidade é recalculado na hora.</p>
    ${projecaoHtml(projecao)}
    ${linhas.length === 0
      ? '<p class="pix-ajuda">Nenhuma leva criada ainda. Crie os lotes na aba <strong>Produção</strong>.</p>'
      : `<div class="fin-tabela-wrap"><table class="fin-tabela">
          <thead><tr><th>Lote</th><th>Unidades</th><th>Gasto</th><th>Custo real / un.</th><th>Tabela / un.</th><th>Diferença</th><th></th></tr></thead>
          <tbody>${tabela}</tbody>
        </table></div>`}
  `;

  alvo.querySelectorAll("[data-lote-metro]").forEach((b) => {
    b.onclick = () => abrirCalculadoraMetro(b.dataset.loteMetro);
  });
  alvo.querySelectorAll("[data-lote-custo]").forEach((b) => {
    b.onclick = () => movNovoCustoDoLote(b.dataset.loteCusto);
  });
}

// Quadro "o que ainda não foi produzido": qual custo está valendo agora.
function projecaoHtml(projecao) {
  const itens = [];
  const desc = (k, nome) => {
    const p = projecao[k];
    if (!p) return;
    const regra = k === "outros" || p.fator === null
      ? `${formatarReais(p.porUnidade)} por unidade`
      : `tabela da aba Tamanhos × ${p.fator.toFixed(2)} (${p.fator >= 1 ? "+" : "−"}${Math.abs(Math.round((p.fator - 1) * 100))}%)`;
    itens.push(`<li><strong>${nome}:</strong> ${regra} — pelo lote <em>${escapeHtmlAdmin(p.lote)}</em></li>`);
  };
  desc("impressao", "Impressão");
  desc("costureira", "Costureira");
  desc("outros", "Outros (malha, frete…)");
  if (!itens.length) {
    return '<p class="pix-ajuda">Camisetas que ainda não estão em um lote com custo usam a tabela da aba Tamanhos. Assim que um lote tiver custo lançado, ele passa a ser a referência delas.</p>';
  }
  return `<div class="card"><h3 class="titulo-bloco">Custo projetado para o que ainda não foi produzido</h3>
    <p class="pix-ajuda">O lote mais recente com custo de cada categoria atualiza o custo das camisetas que ainda não estão em nenhum lote com custo (previsto, DRE e lucro já usam estes valores). Impressão e costureira mantêm a proporção entre os tamanhos.</p>
    <ul>${itens.join("")}</ul></div>`;
}

function exportarCustosLotes() {
  const { lotes } = custosDosLotes();
  if (lotes.length === 0) {
    alert("Nenhum custo lançado em lote ainda.");
    return;
  }
  const linhas = [["Lote", "Unidades", "Avulsas", "Impressao", "Costureira", "Outros", "Total", "A pagar", "Custo real por unidade", "Tabela por unidade"]];
  lotes.forEach((l) => {
    linhas.push([
      l.nome, l.unidades, l.semPedido,
      l.impressao.toFixed(2), l.costureira.toFixed(2), l.outros.toFixed(2), l.total.toFixed(2), l.aPagar.toFixed(2),
      l.porUnidade.toFixed(2), l.estimadoUnidade.toFixed(2)
    ]);
  });
  baixarCSV("custos-por-lote-interclasse.csv", linhas);
}
