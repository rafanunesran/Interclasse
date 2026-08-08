// ============================================================
// PAINEL ADMINISTRATIVO
// ============================================================

// ============================================================
// SUPER ADMIN (superadmin.html)
// Página protegida: só a conta administradora (ver auth-admin.js) entra.
// O login em si é feito na página admin.html (js/login.js). Quem chegar aqui
// sem estar logado como admin é mandado de volta para o login.
// ============================================================

const PAGINA_LOGIN = "admin.html";

const estadoTurmas = {}; // turmaId -> { turma, alunos, expandido }

const elPainel = document.getElementById("painelAdmin");
const elEmailLogado = document.getElementById("emailLogado");
const elFormCriarTurma = document.getElementById("formCriarTurma");
const elListaTurmasAdmin = document.getElementById("listaTurmasAdmin");
const elBtnExportarTudo = document.getElementById("btnExportarTudo");
const elMsgCriarTurma = document.getElementById("msgCriarTurma");
const elBtnSairAdmin = document.getElementById("btnSairAdmin");

let painelIniciado = false;

// Guarda de acesso: o Firebase mantém a sessão salva no navegador, então
// quem já entrou continua logado ao recarregar. Se não for a conta admin,
// volta para a página de login.
auth.onAuthStateChanged((user) => {
  if (ehContaAdmin(user)) {
    if (elEmailLogado) elEmailLogado.textContent = user.email;
    elPainel.classList.remove("oculto");
    if (!painelIniciado) {
      painelIniciado = true;
      escutarTurmas();
      carregarPainelConfig();
    }
  } else {
    elPainel.classList.add("oculto");
    window.location.replace(PAGINA_LOGIN);
  }
});

if (elBtnSairAdmin) {
  elBtnSairAdmin.addEventListener("click", async () => {
    await auth.signOut();
    window.location.replace(PAGINA_LOGIN);
  });
}

// ---------------- Abas (Inicial / Tamanhos / Pagamentos / Configurações) ----------------

document.querySelectorAll(".aba").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    btn.classList.add("ativa");
    document.querySelectorAll(".secao-aba").forEach((s) => s.classList.add("oculto"));
    const secao = document.getElementById("aba-" + btn.dataset.aba);
    if (secao) secao.classList.remove("oculto");
  });
});

// ---------------- Criar turma ----------------

elFormCriarTurma.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgCriarTurma);

  const nome = document.getElementById("nomeNovaTurma").value.trim();
  const senha = document.getElementById("senhaNovaTurma").value.trim();

  if (!nome || !senha) return;

  let id = slugify(nome);
  if (!id) id = "turma";

  try {
    let idFinal = id;
    let sufixo = 2;
    while ((await db.collection("turmas").doc(idFinal).get()).exists) {
      idFinal = `${id}-${sufixo}`;
      sufixo++;
    }

    await db.collection("turmas").doc(idFinal).set({
      nome,
      senha,
      fechado: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });

    elFormCriarTurma.reset();
    mostrarMensagem(elMsgCriarTurma, `Turma "${nome}" criada. Link: turma.html?id=${idFinal}`, "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(elMsgCriarTurma, "Erro ao criar turma.", "erro");
  }
});

// ---------------- Listagem de turmas ----------------

function escutarTurmas() {
  db.collection("turmas")
    .orderBy("nome")
    .onSnapshot(
      (snap) => {
        const idsAtuais = new Set();
        snap.forEach((doc) => {
          idsAtuais.add(doc.id);
          if (!estadoTurmas[doc.id]) {
            estadoTurmas[doc.id] = { turma: doc.data(), alunos: [], expandido: false };
            escutarAlunosDaTurma(doc.id);
          } else {
            estadoTurmas[doc.id].turma = doc.data();
          }
        });
        Object.keys(estadoTurmas).forEach((id) => {
          if (!idsAtuais.has(id)) delete estadoTurmas[id];
        });
        aplicarFechamentoAutomatico();
        renderizarTurmasAdmin();
      },
      (erro) => console.error("Erro ao carregar turmas:", erro)
    );
}

// Fecha automaticamente as turmas cuja data limite já passou (aberto -> fechado).
// Única mudança de status automática; as demais são manuais (seletor de status).
function aplicarFechamentoAutomatico() {
  Object.keys(estadoTurmas).forEach((turmaId) => {
    const turma = estadoTurmas[turmaId].turma;
    if (statusAutoPorData(turma) === "fechado") {
      estadoTurmas[turmaId].turma.statusPedido = "fechado";
      estadoTurmas[turmaId].turma.fechado = true;
      db.collection("turmas").doc(turmaId).update({
        statusPedido: "fechado",
        fechado: true,
        fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
      }).catch((e) => console.warn("Falha no fechamento automático:", e));
    }
  });
}

function escutarAlunosDaTurma(turmaId) {
  db.collection("turmas")
    .doc(turmaId)
    .collection("alunos")
    .where("excluido", "==", false)
    .onSnapshot((snap) => {
      if (!estadoTurmas[turmaId]) return;
      estadoTurmas[turmaId].alunos = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      renderizarTurmasAdmin();
    });
}

function renderizarTurmasAdmin() {
  elListaTurmasAdmin.innerHTML = "";

  const ids = Object.keys(estadoTurmas).sort((a, b) =>
    estadoTurmas[a].turma.nome.localeCompare(estadoTurmas[b].turma.nome, "pt-BR")
  );

  if (ids.length === 0) {
    elListaTurmasAdmin.innerHTML = "<p>Nenhuma turma cadastrada ainda.</p>";
    return;
  }

  ids.forEach((turmaId) => {
    const { turma, alunos, expandido } = estadoTurmas[turmaId];

    const card = document.createElement("div");
    card.className = "card";

    // ----- Modo edição (nome e senha da turma) -----
    if (estadoTurmas[turmaId].editando) {
      card.appendChild(criarFormEdicaoTurma(turmaId, turma));
      elListaTurmasAdmin.appendChild(card);
      return;
    }

    const statusId = statusPedidoDe(turma);
    const classeBadge = statusId === "aberto" ? "aberto" : statusId === "entregue" ? "pago" : "fechado";
    const status = `<span class="badge ${classeBadge}">${labelStatus(statusId)}</span>`;

    const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;
    const avisoAjustes = nAjustes > 0
      ? `<p class="aviso-ajustes"><span class="marca-ajuste">!</span> ${nAjustes} ajuste(s) solicitado(s) — abra a lista para ver e corrigir.</p>`
      : "";

    const nPagos = alunos.filter((a) => a.pago).length;

    card.innerHTML = `
      <h2>${escapeHtmlAdmin(turma.nome)} ${status}</h2>
      <p>Senha da turma: <code>${escapeHtmlAdmin(turma.senha)}</code> &middot; Link: <code>turma.html?id=${turmaId}</code></p>
      <p>${alunos.length} camiseta(s) &middot; ${nPagos} paga(s), ${alunos.length - nPagos} pendente(s)</p>
      ${avisoAjustes}
    `;

    // Barra de acompanhamento das etapas do pedido.
    const barra = document.createElement("div");
    renderizarBarraStatus(barra, statusId);
    card.appendChild(barra);

    // Seletor de status (só o Super Admin muda o status).
    const linhaStatus = document.createElement("div");
    linhaStatus.className = "linha-status-admin";
    const lblStatus = document.createElement("label");
    lblStatus.textContent = "Status do pedido:";
    const selStatus = document.createElement("select");
    selStatus.className = "select-status";
    STATUS_PEDIDO.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.label;
      selStatus.appendChild(o);
    });
    selStatus.value = statusId;
    selStatus.onchange = () => {
      const novo = selStatus.value;
      const dados = { statusPedido: novo, fechado: novo !== "aberto" };
      if (novo !== "aberto") dados.fechadoEm = firebase.firestore.FieldValue.serverTimestamp();
      db.collection("turmas").doc(turmaId).update(dados);
    };
    linhaStatus.appendChild(lblStatus);
    linhaStatus.appendChild(selStatus);
    card.appendChild(linhaStatus);

    // Data limite para pagamento (o Super Admin também vê e edita).
    const linhaData = document.createElement("div");
    linhaData.className = "linha-status-admin";
    const lblData = document.createElement("label");
    lblData.textContent = "Data limite p/ pagamento:";
    const inputData = document.createElement("input");
    inputData.type = "date";
    inputData.className = "input-data-limite";
    inputData.value = turma.dataLimite || "";
    inputData.onchange = () => {
      db.collection("turmas").doc(turmaId).update({
        dataLimite: inputData.value || firebase.firestore.FieldValue.delete()
      });
    };
    linhaData.appendChild(lblData);
    linhaData.appendChild(inputData);
    if (!turma.dataLimite) {
      const semData = document.createElement("small");
      semData.className = "pix-ajuda";
      semData.textContent = "(sem data — fica aberto até você fechar)";
      linhaData.appendChild(semData);
    }
    card.appendChild(linhaData);

    // Imagem da camiseta (Google Drive via Apps Script).
    card.appendChild(criarBlocoImagemTurma(turmaId, turma));

    const botoes = document.createElement("div");

    const btnExpandir = document.createElement("button");
    btnExpandir.className = "secundario";
    btnExpandir.textContent = expandido ? "Ocultar lista" : "Ver lista";
    btnExpandir.onclick = () => {
      estadoTurmas[turmaId].expandido = !estadoTurmas[turmaId].expandido;
      renderizarTurmasAdmin();
    };
    botoes.appendChild(btnExpandir);

    const btnExportar = document.createElement("button");
    btnExportar.className = "secundario";
    btnExportar.textContent = "Exportar CSV";
    btnExportar.onclick = () => exportarTurma(turma, alunos);
    botoes.appendChild(btnExportar);

    const btnEditar = document.createElement("button");
    btnEditar.className = "secundario";
    btnEditar.textContent = "Editar turma";
    btnEditar.onclick = () => {
      estadoTurmas[turmaId].editando = true;
      renderizarTurmasAdmin();
    };
    botoes.appendChild(btnEditar);

    const btnExcluir = document.createElement("button");
    btnExcluir.className = "perigo";
    btnExcluir.textContent = "Excluir turma";
    btnExcluir.onclick = () => excluirTurma(turmaId, turma);
    botoes.appendChild(btnExcluir);

    card.appendChild(botoes);

    if (expandido) {
      const tabela = document.createElement("table");
      tabela.innerHTML = `
        <thead>
          <tr><th>Nome</th><th>Tamanho</th><th>Número</th><th>Nome na camiseta</th><th>Pagamento</th><th>Ações</th></tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = tabela.querySelector("tbody");

      alunos.forEach((aluno) => {
        const tr = document.createElement("tr");
        if (aluno.ajusteSolicitado) tr.classList.add("linha-ajuste");

        const marca = aluno.ajusteSolicitado
          ? '<span class="marca-ajuste" title="Ajuste solicitado">!</span> '
          : "";
        const motivo = aluno.ajusteSolicitado && aluno.ajusteMotivo
          ? `<br><small class="motivo-ajuste">Ajuste pedido: ${escapeHtmlAdmin(aluno.ajusteMotivo)}</small>`
          : "";

        tr.innerHTML = `
          <td>${marca}${escapeHtmlAdmin(aluno.nome)}${motivo}</td>
          <td>${escapeHtmlAdmin(aluno.tamanho)}</td>
          <td>${escapeHtmlAdmin(aluno.numero || "-")}</td>
          <td>${escapeHtmlAdmin(aluno.nomeCamiseta || "-")}</td>
          <td class="cel-pagamento"></td>
          <td class="acoes-linha"></td>
        `;

        // Coluna de pagamento: badge + seletor de status.
        const tdPag = tr.querySelector(".cel-pagamento");
        tdPag.innerHTML = badgePagamentoHtml(aluno);
        const selPag = document.createElement("select");
        selPag.className = "select-pagamento";
        selPag.innerHTML =
          '<option value="pendente">Pendente</option>' +
          '<option value="pix">Pago (PIX)</option>' +
          '<option value="dinheiro">Pago (dinheiro)</option>';
        selPag.value = aluno.pago ? (aluno.pagamentoForma === "dinheiro" ? "dinheiro" : "pix") : "pendente";
        selPag.onchange = () => atualizarPagamento(turmaId, aluno.id, selPag.value);
        tdPag.appendChild(selPag);
        if (aluno.pagamentoDeclarado && !aluno.pago) {
          const nota = document.createElement("small");
          nota.className = "motivo-ajuste";
          nota.textContent = "Pagante marcou PIX — confirme.";
          tdPag.appendChild(nota);
        }

        const tdAcoes = tr.querySelector(".acoes-linha");

        const btnEditar = document.createElement("button");
        btnEditar.className = "secundario";
        btnEditar.textContent = "Editar";
        btnEditar.onclick = () => editarAlunoAdmin(tr, turmaId, aluno);
        tdAcoes.appendChild(btnEditar);

        if (aluno.ajusteSolicitado) {
          const btnResolver = document.createElement("button");
          btnResolver.className = "sucesso";
          btnResolver.textContent = "Resolver";
          btnResolver.title = "Marcar o ajuste como resolvido";
          btnResolver.onclick = () => {
            db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
              ajusteSolicitado: false
            });
          };
          tdAcoes.appendChild(btnResolver);
        }

        const btnExcluir = document.createElement("button");
        btnExcluir.className = "perigo";
        btnExcluir.textContent = "Excluir";
        btnExcluir.onclick = () => {
          if (confirm(`Remover "${aluno.nome}"?`)) {
            db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({ excluido: true });
          }
        };
        tdAcoes.appendChild(btnExcluir);
        tbody.appendChild(tr);
      });

      card.appendChild(tabela);
    }

    elListaTurmasAdmin.appendChild(card);
  });

  renderizarResumoPagamentos();
  renderizarKanban();
  renderizarRelatorio();
}

// ---------------- Valores da turma (preço/pago/pendente) ----------------
function valoresDaTurma(alunos) {
  let total = 0, pago = 0, nPago = 0;
  alunos.forEach((a) => {
    const preco = precoDoTamanho(a.tamanho, precosPorGrupo) || 0;
    total += preco;
    if (a.pago) { pago += preco; nPago++; }
  });
  return { total, pago, pendente: total - pago, nPago, nTotal: alunos.length };
}

// ---------------- Kanban (pedidos por status) ----------------
function renderizarKanban() {
  if (!elKanban) return;
  elKanban.innerHTML = "";

  STATUS_PEDIDO.forEach((s) => {
    const coluna = document.createElement("div");
    coluna.className = "kanban-coluna";
    coluna.dataset.status = s.id;

    const ids = Object.keys(estadoTurmas).filter(
      (id) => statusPedidoDe(estadoTurmas[id].turma) === s.id
    );

    const titulo = document.createElement("h3");
    titulo.className = "kanban-titulo";
    titulo.textContent = `${s.label} (${ids.length})`;
    coluna.appendChild(titulo);

    // Permite soltar cards nesta coluna.
    coluna.addEventListener("dragover", (ev) => { ev.preventDefault(); coluna.classList.add("arrastando-sobre"); });
    coluna.addEventListener("dragleave", () => coluna.classList.remove("arrastando-sobre"));
    coluna.addEventListener("drop", (ev) => {
      ev.preventDefault();
      coluna.classList.remove("arrastando-sobre");
      const turmaId = ev.dataTransfer.getData("text/plain");
      if (turmaId) mudarStatusTurma(turmaId, s.id);
    });

    ids.sort((a, b) => estadoTurmas[a].turma.nome.localeCompare(estadoTurmas[b].turma.nome, "pt-BR"));
    ids.forEach((turmaId) => {
      coluna.appendChild(criarCardKanban(turmaId, estadoTurmas[turmaId]));
    });

    elKanban.appendChild(coluna);
  });
}

function criarCardKanban(turmaId, estado) {
  const { turma, alunos } = estado;
  const v = valoresDaTurma(alunos);

  const card = document.createElement("div");
  card.className = "kanban-card";
  card.draggable = true;
  card.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("text/plain", turmaId);
    card.classList.add("arrastando");
  });
  card.addEventListener("dragend", () => card.classList.remove("arrastando"));

  card.innerHTML = `
    <strong>${escapeHtmlAdmin(turma.nome)}</strong>
    <div class="kanban-valores">
      <span>Total: <b>${formatarReais(v.total)}</b></span>
      <span class="txt-pago">Pago: ${formatarReais(v.pago)} (${v.nPago})</span>
      <span class="txt-pendente">Pendente: ${formatarReais(v.pendente)} (${v.nTotal - v.nPago})</span>
    </div>
  `;

  const sel = document.createElement("select");
  sel.className = "select-status-kanban";
  STATUS_PEDIDO.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.label;
    sel.appendChild(o);
  });
  sel.value = statusPedidoDe(turma);
  sel.onchange = () => mudarStatusTurma(turmaId, sel.value);
  card.appendChild(sel);

  return card;
}

function mudarStatusTurma(turmaId, novo) {
  const dados = { statusPedido: novo, fechado: novo !== "aberto" };
  if (novo !== "aberto") dados.fechadoEm = firebase.firestore.FieldValue.serverTimestamp();
  db.collection("turmas").doc(turmaId).update(dados);
}

// Atualiza o status de pagamento de um aluno (usado no seletor por linha).
function atualizarPagamento(turmaId, alunoId, valor) {
  const ref = db.collection("turmas").doc(turmaId).collection("alunos").doc(alunoId);
  if (valor === "pendente") {
    ref.update({ pago: false, pagamentoForma: "", pagamentoDeclarado: false });
  } else {
    ref.update({
      pago: true,
      pagamentoForma: valor, // "pix" ou "dinheiro"
      pagamentoDeclarado: false,
      pagamentoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// Resumo geral de pagamentos (aba Pagamentos).
function renderizarResumoPagamentos() {
  const el = document.getElementById("resumoPagamentos");
  if (!el) return;

  let total = 0, pagos = 0, aguardando = 0;
  Object.values(estadoTurmas).forEach(({ alunos }) => {
    alunos.forEach((a) => {
      total++;
      if (a.pago) pagos++;
      else if (a.pagamentoDeclarado) aguardando++;
    });
  });
  const pendentes = total - pagos - aguardando;

  el.innerHTML = `
    <div class="resumo-tamanhos">
      <span><strong>Total: ${total}</strong></span>
      <span class="badge pago">Pagos: ${pagos}</span>
      <span class="badge aguardando">Aguardando: ${aguardando}</span>
      <span class="badge pendente">Pendentes: ${pendentes}</span>
    </div>
  `;
}

// ---------------- Custos e lucro por grupo (aba Tamanhos) ----------------
function renderizarCustosPorGrupo() {
  if (!elCustosPorGrupo) return;
  elCustosPorGrupo.innerHTML = "";
  if (GRUPOS_TAMANHO.length === 0) {
    elCustosPorGrupo.innerHTML = "<p>Cadastre os tamanhos primeiro.</p>";
    return;
  }

  GRUPOS_TAMANHO.forEach((g) => {
    const preco = Number(precosPorGrupo[g.grupo]) || 0;
    const c = custosPorGrupo[g.grupo] || {};

    const box = document.createElement("div");
    box.className = "grupo-tamanho";
    box.innerHTML = `<strong>${escapeHtmlAdmin(g.grupo)}</strong> <small class="pix-ajuda">— preço de venda: ${formatarReais(preco)}</small>`;

    const linha = document.createElement("div");
    linha.className = "linha-custos";

    const inImp = document.createElement("input");
    inImp.type = "number"; inImp.step = "0.01"; inImp.min = "0";
    inImp.placeholder = "Impressão"; inImp.dataset.grupo = g.grupo; inImp.dataset.tipo = "impressao";
    inImp.value = c.impressao != null ? c.impressao : "";

    const inCost = document.createElement("input");
    inCost.type = "number"; inCost.step = "0.01"; inCost.min = "0";
    inCost.placeholder = "Costureira"; inCost.dataset.grupo = g.grupo; inCost.dataset.tipo = "costureira";
    inCost.value = c.costureira != null ? c.costureira : "";

    const lucroSpan = document.createElement("span");
    lucroSpan.className = "lucro-grupo";
    const calcularLucro = () => {
      const imp = parseFloat(inImp.value) || 0;
      const cost = parseFloat(inCost.value) || 0;
      lucroSpan.textContent = "Lucro: " + formatarReais(preco - imp - cost);
    };
    inImp.oninput = calcularLucro;
    inCost.oninput = calcularLucro;
    calcularLucro();

    const lblImp = document.createElement("label"); lblImp.textContent = "Impressão (R$)";
    const lblCost = document.createElement("label"); lblCost.textContent = "Costureira (R$)";

    linha.appendChild(lblImp); linha.appendChild(inImp);
    linha.appendChild(lblCost); linha.appendChild(inCost);
    linha.appendChild(lucroSpan);
    box.appendChild(linha);
    elCustosPorGrupo.appendChild(box);
  });
}

if (elBtnSalvarCustos) {
  elBtnSalvarCustos.addEventListener("click", async () => {
    esconderMensagem(elMsgCustos);
    const novo = {};
    elCustosPorGrupo.querySelectorAll("input").forEach((inp) => {
      const grupo = inp.dataset.grupo;
      const v = parseFloat(inp.value);
      if (!novo[grupo]) novo[grupo] = {};
      if (!isNaN(v) && v >= 0) novo[grupo][inp.dataset.tipo] = v;
    });
    try {
      await db.collection("config").doc("geral").set({ custosPorGrupo: novo }, { merge: true });
      custosPorGrupo = novo;
      renderizarRelatorio();
      mostrarMensagem(elMsgCustos, "Custos salvos.", "aviso");
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgCustos, "Erro ao salvar os custos.", "erro");
    }
  });
}

// ---------------- Relatório de faturamento por mês ----------------
function mesDoAluno(aluno) {
  const t = aluno.pagamentoEm;
  if (!t || !t.toDate) return null;
  const d = t.toDate();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function renderizarRelatorio() {
  if (!elMesRelatorio || !elRelatorioResultado) return;

  // Coleta os meses que têm camisetas pagas.
  const meses = new Set();
  Object.values(estadoTurmas).forEach(({ alunos }) => {
    alunos.forEach((a) => {
      if (a.pago) {
        const m = mesDoAluno(a);
        if (m) meses.add(m);
      }
    });
  });
  const listaMeses = Array.from(meses).sort().reverse();
  const agora = new Date();
  const mesAtual = agora.getFullYear() + "-" + String(agora.getMonth() + 1).padStart(2, "0");
  if (!listaMeses.includes(mesAtual)) listaMeses.unshift(mesAtual);

  if (!mesRelatorioSel || !listaMeses.includes(mesRelatorioSel)) {
    mesRelatorioSel = listaMeses[0];
  }

  elMesRelatorio.innerHTML = "";
  listaMeses.forEach((m) => {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = rotuloMes(m);
    elMesRelatorio.appendChild(o);
  });
  elMesRelatorio.value = mesRelatorioSel;

  // Calcula os totais do mês selecionado (por turma).
  let receita = 0, custo = 0, qtd = 0;
  const porTurma = {};
  Object.keys(estadoTurmas).forEach((turmaId) => {
    const { turma, alunos } = estadoTurmas[turmaId];
    alunos.forEach((a) => {
      if (a.pago && mesDoAluno(a) === mesRelatorioSel) {
        const preco = precoDoTamanho(a.tamanho, precosPorGrupo) || 0;
        const c = custoDoTamanho(a.tamanho, custosPorGrupo) || 0;
        receita += preco; custo += c; qtd++;
        if (!porTurma[turmaId]) porTurma[turmaId] = { nome: turma.nome, receita: 0, custo: 0, qtd: 0 };
        porTurma[turmaId].receita += preco;
        porTurma[turmaId].custo += c;
        porTurma[turmaId].qtd++;
      }
    });
  });
  const lucro = receita - custo;

  let linhas = "";
  Object.values(porTurma)
    .sort((a, b) => b.receita - a.receita)
    .forEach((t) => {
      linhas += `<tr><td>${escapeHtmlAdmin(t.nome)}</td><td>${t.qtd}</td><td>${formatarReais(t.receita)}</td><td>${formatarReais(t.custo)}</td><td>${formatarReais(t.receita - t.custo)}</td></tr>`;
    });

  elRelatorioResultado.innerHTML = `
    <div class="resumo-tamanhos" style="margin-top:12px">
      <span><strong>${qtd}</strong> camiseta(s) paga(s)</span>
      <span class="badge pago">Receita: ${formatarReais(receita)}</span>
      <span class="badge pendente">Custo: ${formatarReais(custo)}</span>
      <span class="badge aberto">Lucro: ${formatarReais(lucro)}</span>
    </div>
    ${qtd === 0 ? "<p>Nenhum pagamento neste mês.</p>" : `
    <table>
      <thead><tr><th>Turma</th><th>Qtd</th><th>Receita</th><th>Custo</th><th>Lucro</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>`}
  `;
}

function rotuloMes(m) {
  const [ano, mes] = m.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

if (elMesRelatorio) {
  elMesRelatorio.addEventListener("change", () => {
    mesRelatorioSel = elMesRelatorio.value;
    renderizarRelatorio();
  });
}

// Monta o formulário inline de edição do nome e da senha da turma.
function criarFormEdicaoTurma(turmaId, turma) {
  const wrap = document.createElement("div");

  const h2 = document.createElement("h2");
  h2.textContent = "Editar turma";
  wrap.appendChild(h2);

  const lblNome = document.createElement("label");
  lblNome.textContent = "Nome da turma";
  const inNome = document.createElement("input");
  inNome.type = "text";
  inNome.value = turma.nome;

  const lblSenha = document.createElement("label");
  lblSenha.textContent = "Senha da turma";
  const inSenha = document.createElement("input");
  inSenha.type = "text";
  inSenha.value = turma.senha;

  wrap.appendChild(lblNome);
  wrap.appendChild(inNome);
  wrap.appendChild(lblSenha);
  wrap.appendChild(inSenha);

  const acoes = document.createElement("div");

  const btnSalvar = document.createElement("button");
  btnSalvar.className = "sucesso";
  btnSalvar.textContent = "Salvar";
  btnSalvar.onclick = async () => {
    const novoNome = inNome.value.trim();
    const novaSenha = inSenha.value.trim();
    if (!novoNome || !novaSenha) {
      alert("Preencha o nome e a senha da turma.");
      return;
    }
    btnSalvar.disabled = true;
    try {
      await db.collection("turmas").doc(turmaId).update({ nome: novoNome, senha: novaSenha });
      if (estadoTurmas[turmaId]) estadoTurmas[turmaId].editando = false;
      // O onSnapshot re-renderiza com os dados novos; garantimos o re-render.
      renderizarTurmasAdmin();
    } catch (erro) {
      console.error(erro);
      alert("Erro ao salvar a turma. Tente novamente.");
      btnSalvar.disabled = false;
    }
  };

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "secundario";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => {
    if (estadoTurmas[turmaId]) estadoTurmas[turmaId].editando = false;
    renderizarTurmasAdmin();
  };

  acoes.appendChild(btnSalvar);
  acoes.appendChild(btnCancelar);
  wrap.appendChild(acoes);

  return wrap;
}

// Exclui a turma de verdade: apaga os alunos (subcoleção) e depois a turma.
async function excluirTurma(turmaId, turma) {
  const qtd = (estadoTurmas[turmaId] && estadoTurmas[turmaId].alunos.length) || 0;
  const aviso =
    `Excluir a turma "${turma.nome}"?\n\n` +
    `Isso apaga a turma e as ${qtd} camiseta(s) cadastrada(s) nela. ` +
    `Esta ação NÃO pode ser desfeita.`;
  if (!confirm(aviso)) return;

  try {
    // Apaga a subcoleção de alunos em lote (o Firestore não faz isso sozinho).
    const alunosSnap = await db.collection("turmas").doc(turmaId).collection("alunos").get();
    if (!alunosSnap.empty) {
      const lote = db.batch();
      alunosSnap.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
    await db.collection("turmas").doc(turmaId).delete();
    // O onSnapshot das turmas remove o card automaticamente.
  } catch (erro) {
    console.error(erro);
    alert(
      "Erro ao excluir a turma. Verifique se as regras do Firestore permitem " +
      "'delete' para o admin (firestore.rules) e se elas foram publicadas no console."
    );
  }
}

// Edição inline de um aluno no Super Admin (permite corrigir a linha mesmo
// com o pedido fechado). Ao salvar, resolve o pedido de ajuste, se houver.
function editarAlunoAdmin(tr, turmaId, aluno) {
  tr.innerHTML = "";

  const tdNome = document.createElement("td");
  const inputNome = document.createElement("input");
  inputNome.type = "text";
  inputNome.value = aluno.nome;
  tdNome.appendChild(inputNome);

  const tdTamanho = document.createElement("td");
  const selectTamanho = document.createElement("select");
  preencherSelectTamanhos(selectTamanho);
  selectTamanho.value = aluno.tamanho;
  tdTamanho.appendChild(selectTamanho);

  const tdNumero = document.createElement("td");
  const inputNumero = document.createElement("input");
  inputNumero.type = "text";
  inputNumero.value = aluno.numero || "";
  tdNumero.appendChild(inputNumero);

  const tdCostas = document.createElement("td");
  const inputCostas = document.createElement("input");
  inputCostas.type = "text";
  inputCostas.value = aluno.nomeCamiseta || "";
  tdCostas.appendChild(inputCostas);

  const tdAcoes = document.createElement("td");
  tdAcoes.className = "acoes-linha";

  const btnSalvar = document.createElement("button");
  btnSalvar.className = "sucesso";
  btnSalvar.textContent = "Salvar";
  btnSalvar.onclick = async () => {
    const novoNome = inputNome.value.trim();
    const novoCostas = inputCostas.value.trim();
    if (!novoNome || !selectTamanho.value || !novoCostas) {
      alert("Preencha nome, tamanho e nome para a camiseta.");
      return;
    }
    btnSalvar.disabled = true;
    try {
      const dados = {
        nome: novoNome,
        tamanho: selectTamanho.value,
        numero: inputNumero.value.trim(),
        nomeCamiseta: novoCostas
      };
      if (aluno.ajusteSolicitado) dados.ajusteSolicitado = false; // corrigiu = resolveu
      await db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update(dados);
      // O onSnapshot dos alunos re-renderiza a lista automaticamente.
    } catch (erro) {
      console.error(erro);
      alert("Erro ao salvar. Tente novamente.");
      btnSalvar.disabled = false;
    }
  };

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "secundario";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => renderizarTurmasAdmin();

  tdAcoes.appendChild(btnSalvar);
  tdAcoes.appendChild(btnCancelar);

  const tdPagamento = document.createElement("td"); // coluna de pagamento (vazia na edição)

  tr.appendChild(tdNome);
  tr.appendChild(tdTamanho);
  tr.appendChild(tdNumero);
  tr.appendChild(tdCostas);
  tr.appendChild(tdPagamento);
  tr.appendChild(tdAcoes);
}

// Bloco de imagem da camiseta no card do Super Admin (enviar/trocar/remover).
function criarBlocoImagemTurma(turmaId, turma) {
  const bloco = document.createElement("div");
  bloco.className = "bloco-imagem-admin";

  if (turma.imagemUrl) {
    const thumb = document.createElement("img");
    thumb.className = "thumb-camiseta";
    thumb.src = turma.imagemUrl;
    thumb.alt = "Imagem da camiseta";
    bloco.appendChild(thumb);
  }

  const inputImg = document.createElement("input");
  inputImg.type = "file";
  inputImg.accept = "image/*";
  inputImg.style.display = "none";

  const btnImg = document.createElement("button");
  btnImg.className = "secundario";
  btnImg.textContent = turma.imagemUrl ? "Trocar imagem" : "Enviar imagem da camiseta";
  btnImg.onclick = () => {
    if (!driveScriptUrl) {
      alert("Configure a URL do Apps Script na aba Configurações antes de enviar imagens.");
      return;
    }
    inputImg.click();
  };

  inputImg.onchange = async () => {
    const file = inputImg.files[0];
    if (!file) return;
    btnImg.disabled = true;
    const antes = btnImg.textContent;
    btnImg.textContent = "Enviando…";
    try {
      const url = await enviarImagemDrive(driveScriptUrl, turmaId, file);
      await db.collection("turmas").doc(turmaId).update({ imagemUrl: url });
    } catch (e) {
      console.error(e);
      alert("Erro ao enviar a imagem: " + e.message);
    } finally {
      btnImg.disabled = false;
      btnImg.textContent = antes;
      inputImg.value = "";
    }
  };

  bloco.appendChild(btnImg);

  if (turma.imagemUrl) {
    const btnRemover = document.createElement("button");
    btnRemover.className = "perigo";
    btnRemover.textContent = "Remover imagem";
    btnRemover.onclick = () => {
      if (confirm("Remover a imagem da camiseta desta turma?")) {
        db.collection("turmas").doc(turmaId).update({ imagemUrl: firebase.firestore.FieldValue.delete() });
      }
    };
    bloco.appendChild(btnRemover);
  }

  bloco.appendChild(inputImg);
  return bloco;
}

function escapeHtmlAdmin(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// ---------------- Exportação ----------------

function exportarTurma(turma, alunos) {
  if (alunos.length === 0) {
    alert("Essa turma não tem alunos cadastrados.");
    return;
  }
  const linhas = [["Turma", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta", "Pago", "Forma Pagto"]];
  alunos.forEach((a) =>
    linhas.push([turma.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || "", a.pago ? "Sim" : "Nao", a.pagamentoForma || ""])
  );
  baixarCSV(`pedido-${slugify(turma.nome)}.csv`, linhas);
}

elBtnExportarTudo.addEventListener("click", () => {
  const linhas = [["Turma", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta", "Pago", "Forma Pagto"]];
  let total = 0;
  Object.values(estadoTurmas).forEach(({ turma, alunos }) => {
    alunos.forEach((a) => {
      linhas.push([turma.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || "", a.pago ? "Sim" : "Nao", a.pagamentoForma || ""]);
      total++;
    });
  });
  if (total === 0) {
    alert("Não há alunos cadastrados em nenhuma turma.");
    return;
  }
  baixarCSV("pedido-interclasse-geral.csv", linhas);
});

// ============================================================
// CONFIGURAÇÕES GERAIS E TAMANHOS
// ============================================================

const elFormConfigGeral = document.getElementById("formConfigGeral");
const elTituloEvento = document.getElementById("tituloEvento");
const elRodapeTexto = document.getElementById("rodapeTexto");
const elCadastrosAbertos = document.getElementById("cadastrosAbertos");
const elDriveScriptUrl = document.getElementById("driveScriptUrl");
const elMsgConfigGeral = document.getElementById("msgConfigGeral");

const elEditorTamanhos = document.getElementById("editorTamanhos");
const elBtnAddGrupo = document.getElementById("btnAddGrupo");
const elBtnSalvarTamanhos = document.getElementById("btnSalvarTamanhos");
const elBtnRestaurarTamanhos = document.getElementById("btnRestaurarTamanhos");
const elMsgTamanhos = document.getElementById("msgTamanhos");

const elFormPix = document.getElementById("formPix");
const elPixChave = document.getElementById("pixChave");
const elPixNome = document.getElementById("pixNome");
const elPixCidade = document.getElementById("pixCidade");
const elPrecosPorGrupo = document.getElementById("precosPorGrupo");
const elMpAtivo = document.getElementById("mpAtivo");
const elMpBackendUrl = document.getElementById("mpBackendUrl");
const elMsgPix = document.getElementById("msgPix");

const elKanban = document.getElementById("kanban");
const elCustosPorGrupo = document.getElementById("custosPorGrupo");
const elBtnSalvarCustos = document.getElementById("btnSalvarCustos");
const elMsgCustos = document.getElementById("msgCustos");
const elMesRelatorio = document.getElementById("mesRelatorio");
const elRelatorioResultado = document.getElementById("relatorioResultado");

let gruposTamanhoEdit = []; // estado em edição do editor de tamanhos
let painelConfigCarregado = false;
let driveScriptUrl = ""; // URL do Apps Script para upload de imagem (config/geral)
let precosPorGrupo = {};  // preço de venda por grupo (config/geral)
let custosPorGrupo = {};  // custos (impressão/costureira) por grupo (config/geral)
let mesRelatorioSel = ""; // "YYYY-MM" selecionado no relatório

// Carrega as configurações gerais e os tamanhos nos respectivos formulários.
// Chamado uma vez quando o painel é desbloqueado.
async function carregarPainelConfig() {
  if (painelConfigCarregado) return;
  painelConfigCarregado = true;

  const cfg = await carregarConfigGeral();
  aplicarConfigGeral(cfg);
  elTituloEvento.value = cfg.tituloEvento || "";
  elRodapeTexto.value = cfg.rodape || "";
  elCadastrosAbertos.checked = cfg.cadastrosAbertos !== false; // padrão: aberto
  if (elDriveScriptUrl) elDriveScriptUrl.value = cfg.driveScriptUrl || "";
  driveScriptUrl = cfg.driveScriptUrl || "";

  await carregarTamanhos();
  gruposTamanhoEdit = clonarGrupos(GRUPOS_TAMANHO);
  renderizarEditorTamanhos();

  // Pagamento (PIX)
  elPixChave.value = cfg.pixChave || "";
  elPixNome.value = cfg.pixNome || "";
  elPixCidade.value = cfg.pixCidade || "";
  elMpAtivo.checked = cfg.mpAtivo === true;
  elMpBackendUrl.value = cfg.mpBackendUrl || "";
  precosPorGrupo = cfg.precosPorGrupo || {};
  custosPorGrupo = cfg.custosPorGrupo || {};
  renderizarPrecosPorGrupo(precosPorGrupo);
  renderizarCustosPorGrupo();

  // Já dá para desenhar Kanban e Relatório (dependem de preços/custos).
  renderizarKanban();
  renderizarRelatorio();
}

// ---------------- Pagamento (PIX) ----------------

// Renderiza um campo de preço para cada grupo de tamanho atual.
function renderizarPrecosPorGrupo(precos) {
  elPrecosPorGrupo.innerHTML = "";
  if (GRUPOS_TAMANHO.length === 0) {
    elPrecosPorGrupo.innerHTML = "<p>Cadastre os tamanhos primeiro.</p>";
    return;
  }
  GRUPOS_TAMANHO.forEach((g) => {
    const lbl = document.createElement("label");
    lbl.textContent = `${g.grupo} — R$`;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.min = "0";
    inp.placeholder = "0,00";
    inp.dataset.grupo = g.grupo;
    inp.value = precos[g.grupo] != null ? precos[g.grupo] : "";
    elPrecosPorGrupo.appendChild(lbl);
    elPrecosPorGrupo.appendChild(inp);
  });
}

elFormPix.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgPix);

  const precos = {};
  elPrecosPorGrupo.querySelectorAll("input").forEach((inp) => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v >= 0) precos[inp.dataset.grupo] = v;
  });

  const dados = {
    pixChave: elPixChave.value.trim(),
    pixNome: elPixNome.value.trim(),
    pixCidade: elPixCidade.value.trim(),
    precosPorGrupo: precos,
    mpAtivo: elMpAtivo.checked,
    mpBackendUrl: elMpBackendUrl.value.trim().replace(/\/$/, "")
  };

  try {
    await db.collection("config").doc("geral").set(dados, { merge: true });
    precosPorGrupo = precos;
    renderizarCustosPorGrupo(); // o lucro depende do preço
    renderizarKanban();
    renderizarRelatorio();
    mostrarMensagem(elMsgPix, "Dados de pagamento salvos.", "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(
      elMsgPix,
      "Erro ao salvar. Verifique se as regras do Firestore permitem escrita em config/geral.",
      "erro"
    );
  }
});

// ---------------- Configurações gerais ----------------

elFormConfigGeral.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgConfigGeral);

  const dados = {
    tituloEvento: elTituloEvento.value.trim(),
    rodape: elRodapeTexto.value.trim(),
    cadastrosAbertos: elCadastrosAbertos.checked,
    driveScriptUrl: elDriveScriptUrl ? elDriveScriptUrl.value.trim() : ""
  };

  try {
    await db.collection("config").doc("geral").set(dados, { merge: true });
    aplicarConfigGeral(dados);
    driveScriptUrl = dados.driveScriptUrl;
    mostrarMensagem(elMsgConfigGeral, "Configurações salvas.", "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(
      elMsgConfigGeral,
      "Erro ao salvar. Verifique se as regras do Firestore permitem escrita em config/geral (ver firestore.rules).",
      "erro"
    );
  }
});

// ---------------- Editor de tamanhos ----------------

function renderizarEditorTamanhos() {
  elEditorTamanhos.innerHTML = "";

  gruposTamanhoEdit.forEach((grupo, iGrupo) => {
    const box = document.createElement("div");
    box.className = "grupo-tamanho";

    // Cabeçalho: nome do grupo + remover grupo
    const cabecalho = document.createElement("div");
    cabecalho.className = "linha-add-tamanho";

    const inputNome = document.createElement("input");
    inputNome.type = "text";
    inputNome.value = grupo.grupo;
    inputNome.placeholder = "Nome do grupo (ex: Normal)";
    inputNome.oninput = () => {
      gruposTamanhoEdit[iGrupo].grupo = inputNome.value;
    };
    cabecalho.appendChild(inputNome);

    const btnRemoverGrupo = document.createElement("button");
    btnRemoverGrupo.type = "button";
    btnRemoverGrupo.className = "perigo";
    btnRemoverGrupo.textContent = "Remover grupo";
    btnRemoverGrupo.onclick = () => {
      gruposTamanhoEdit.splice(iGrupo, 1);
      renderizarEditorTamanhos();
    };
    cabecalho.appendChild(btnRemoverGrupo);

    box.appendChild(cabecalho);

    // Chips de tamanhos
    const chips = document.createElement("div");
    chips.className = "chips-tamanho";
    grupo.tamanhos.forEach((tam, iTam) => {
      const chip = document.createElement("span");
      chip.className = "chip-tamanho";
      chip.appendChild(document.createTextNode(tam));

      const btnX = document.createElement("button");
      btnX.type = "button";
      btnX.textContent = "×";
      btnX.title = "Remover tamanho";
      btnX.onclick = () => {
        gruposTamanhoEdit[iGrupo].tamanhos.splice(iTam, 1);
        renderizarEditorTamanhos();
      };
      chip.appendChild(btnX);
      chips.appendChild(chip);
    });
    if (grupo.tamanhos.length === 0) {
      const vazio = document.createElement("span");
      vazio.style.color = "#6b7280";
      vazio.style.fontSize = "0.85rem";
      vazio.textContent = "Nenhum tamanho neste grupo ainda.";
      chips.appendChild(vazio);
    }
    box.appendChild(chips);

    // Linha para adicionar tamanho
    const linhaAdd = document.createElement("div");
    linhaAdd.className = "linha-add-tamanho";

    const inputNovo = document.createElement("input");
    inputNovo.type = "text";
    inputNovo.placeholder = "Novo tamanho (ex: XG)";

    const adicionar = () => {
      const valor = inputNovo.value.trim();
      if (!valor) return;
      if (gruposTamanhoEdit[iGrupo].tamanhos.includes(valor)) {
        inputNovo.value = "";
        return;
      }
      gruposTamanhoEdit[iGrupo].tamanhos.push(valor);
      renderizarEditorTamanhos();
    };

    inputNovo.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        adicionar();
      }
    };
    linhaAdd.appendChild(inputNovo);

    const btnAddTam = document.createElement("button");
    btnAddTam.type = "button";
    btnAddTam.className = "secundario";
    btnAddTam.textContent = "Adicionar";
    btnAddTam.onclick = adicionar;
    linhaAdd.appendChild(btnAddTam);

    box.appendChild(linhaAdd);
    elEditorTamanhos.appendChild(box);
  });

  if (gruposTamanhoEdit.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Nenhum grupo. Clique em \"Adicionar grupo\" para começar.";
    elEditorTamanhos.appendChild(p);
  }
}

elBtnAddGrupo.addEventListener("click", () => {
  gruposTamanhoEdit.push({ grupo: "Novo grupo", tamanhos: [] });
  renderizarEditorTamanhos();
});

elBtnRestaurarTamanhos.addEventListener("click", () => {
  if (!confirm("Restaurar os tamanhos para o padrão? As alterações não salvas serão perdidas.")) return;
  gruposTamanhoEdit = clonarGrupos(TAMANHOS_PADRAO);
  renderizarEditorTamanhos();
});

elBtnSalvarTamanhos.addEventListener("click", async () => {
  esconderMensagem(elMsgTamanhos);

  // Limpa e valida: remove tamanhos/grupos vazios e nomes em branco.
  const grupos = gruposTamanhoEdit
    .map((g) => ({
      grupo: g.grupo.trim(),
      tamanhos: g.tamanhos.map((t) => t.trim()).filter(Boolean)
    }))
    .filter((g) => g.grupo && g.tamanhos.length > 0);

  if (grupos.length === 0) {
    mostrarMensagem(elMsgTamanhos, "Cadastre pelo menos um grupo com um tamanho.", "erro");
    return;
  }

  try {
    await db.collection("config").doc("tamanhos").set({ grupos });
    // Atualiza o estado local para refletir o que foi salvo (removidos os vazios).
    gruposTamanhoEdit = clonarGrupos(grupos);
    GRUPOS_TAMANHO = clonarGrupos(grupos);
    TODOS_TAMANHOS = GRUPOS_TAMANHO.flatMap((g) => g.tamanhos);
    renderizarEditorTamanhos();
    mostrarMensagem(elMsgTamanhos, "Tamanhos salvos. Eles já valem para o cadastro das turmas.", "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(
      elMsgTamanhos,
      "Erro ao salvar. Verifique se as regras do Firestore permitem escrita em config/tamanhos (ver firestore.rules).",
      "erro"
    );
  }
});
