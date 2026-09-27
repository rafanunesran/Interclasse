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
// taxa do Mercado Pago) + entradas − saques − pagamentos.
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

function escutarMovimentacoes() {
  db.collection(COL_MOVIMENTACOES).onSnapshot(
    (snap) => {
      movimentacoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      movCarregadas = true;
      if (finVisao === "movimentacoes") renderizarVisaoFinanceira(finUltimo || calcularFinanceiro());
    },
    (erro) => {
      console.error("Erro ao carregar as movimentações:", erro);
      movCarregadas = true;
      movErroLeitura = true;
      if (finVisao === "movimentacoes") renderizarVisaoFinanceira(finUltimo || calcularFinanceiro());
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

function movSomar(lista) {
  const r = { saque: 0, pagamento: 0, entrada: 0 };
  lista.forEach((m) => {
    if (r[m.tipo] !== undefined) r[m.tipo] += Number(m.valor) || 0;
  });
  return r;
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

function finViewMovimentacoes(alvo) {
  if (!movCarregadas) {
    alvo.innerHTML = '<p class="pix-ajuda">Carregando as movimentações…</p>';
    return;
  }

  // Saldo: tudo desde o início (não depende do período escolhido).
  const lancTodos = finLancamentos();
  const totAtivas = movSomar(movAtivas(movDoCliente()));
  const recebidoLiq = movRecebidoLiquido(lancTodos);
  const saldo = recebidoLiq + totAtivas.entrada - totAtivas.saque - totAtivas.pagamento;

  // Recorte do período (o que aparece na lista e nos totais do período).
  const lista = movFiltrar();
  const noPeriodo = movSomar(movAtivas(lista));
  const { dentro } = finFiltrar(lancTodos);
  const recebidoPeriodo = movRecebidoLiquido(dentro);
  const { label } = finLimitesPeriodo();

  const r = movRascunho || { tipo: "saque", data: movHojeIso(), valor: "", descricao: "", categoria: "", forma: "pix", timeId: "" };

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
    const detalhes = [m.categoria, MOV_FORMAS[m.forma], time].filter(Boolean).map(escapeHtmlAdmin).join(" · ");
    const quando = finParaData(m.criadoEm);
    const obsCanc = canc
      ? `<span class="mov-cancelado-info">Cancelado${m.canceladoEm ? " em " + escapeHtmlAdmin(finParaData(m.canceladoEm).toLocaleString("pt-BR")) : ""}${m.motivoCancelamento ? ": " + escapeHtmlAdmin(m.motivoCancelamento) : ""}</span>`
      : "";
    return `<tr class="${canc ? "mov-cancelado" : ""}">
      <td>${movDataBr(m.data)}</td>
      <td><span class="badge mov-${escAttr(m.tipo)}">${escapeHtmlAdmin(t.label)}</span></td>
      <td>${escapeHtmlAdmin(m.descricao || "—")}${detalhes ? `<br><span class="fin-dica">${detalhes}</span>` : ""}${obsCanc ? "<br>" + obsCanc : ""}</td>
      <td class="${t.sinal < 0 ? "fin-vermelho" : "fin-verde"} mov-valor">${t.sinal < 0 ? "−" : "+"}${formatarReais(Number(m.valor) || 0)}</td>
      <td class="fin-dica" title="Quando foi lançado">${quando ? escapeHtmlAdmin(quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })) : ""}</td>
      <td>${canc ? "" : `<button type="button" class="secundario mov-btn-cancelar" data-mov-cancelar="${escAttr(m.id)}" title="Cancelar lançamento">Cancelar</button>`}</td>
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
        <span class="fin-rotulo">Saques</span>
        <span class="fin-valor fin-valor-md">${formatarReais(noPeriodo.saque)}</span>
        <span class="fin-sub">${escapeHtmlAdmin(label)}</span>
      </div>
      <div class="fin-card fin-card-amarelo">
        <span class="fin-rotulo">Pagamentos</span>
        <span class="fin-valor fin-valor-md">${formatarReais(noPeriodo.pagamento)}</span>
        <span class="fin-sub">${escapeHtmlAdmin(label)}</span>
      </div>
    </div>
    <p class="pix-ajuda">Saldo = recebido dos pedidos (já sem a taxa do Mercado Pago) + entradas − saques − pagamentos. Os pagamentos lançados aqui não mudam o DRE, que continua usando os custos por tamanho.</p>

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
    // Movimentação geral lançada com um cliente escolhido no topo fica com ele.
    const clienteId = time ? clienteIdDoTime(time) : (clienteFiltro && clienteFiltro !== SEM_CLIENTE ? clienteFiltro : "");
    const dados = {
      tipo: MOV_TIPOS[r.tipo] ? r.tipo : "saque",
      valor,
      data: r.data,
      descricao: String(r.descricao || "").trim(),
      forma: MOV_FORMAS[r.forma] ? r.forma : "pix",
      categoria: r.tipo === "pagamento" ? (r.categoria || "") : "",
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
  const linhas = [["Data", "Tipo", "Valor", "Descricao", "Categoria", "Forma", "Time", "Situacao", "Motivo do cancelamento", "Lancado em"]];
  lista.forEach((m) => {
    const t = MOV_TIPOS[m.tipo] || { label: m.tipo, sinal: -1 };
    const quando = finParaData(m.criadoEm);
    linhas.push([
      movDataBr(m.data), t.label, ((Number(m.valor) || 0) * t.sinal).toFixed(2), m.descricao || "",
      m.categoria || "", MOV_FORMAS[m.forma] || "", m.timeNome || "",
      m.cancelado ? "Cancelado" : "Valido", m.motivoCancelamento || "",
      quando ? quando.toLocaleString("pt-BR") : ""
    ]);
  });
  baixarCSV(`movimentacoes-interclasse${sufixoCliente()}.csv`, linhas);
}
