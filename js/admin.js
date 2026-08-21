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
      // Adiado com setTimeout para garantir que as declarações let/const do
      // restante do arquivo já existam quando rodarem (evita "TDZ").
      setTimeout(() => {
        escutarTurmas();
        carregarPainelConfig();
      }, 0);
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
    const classeBadge = classeBadgeStatus(statusId);
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
    selStatus.onchange = () => atualizarStatusPedido(turmaId, selStatus.value);
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
        // Proposta guiada (de → para). Para ajustes antigos (só texto), mostra o motivo.
        const proposta = propostaAjusteHtml(aluno);
        const motivo = (aluno.ajusteSolicitado && !aluno.ajusteProposto && aluno.ajusteMotivo)
          ? `<br><small class="motivo-ajuste">Ajuste pedido: ${escapeHtmlAdmin(aluno.ajusteMotivo)}</small>`
          : "";

        tr.innerHTML = `
          <td>${marca}${escapeHtmlAdmin(aluno.nome)}${proposta}${motivo}${historicoAjusteHtml(aluno)}</td>
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
          '<option value="dinheiro">Pago (dinheiro)</option>' +
          '<option value="interno">Interno (só custo)</option>';
        selPag.value = aluno.pago ? (aluno.pagamentoForma || "pix") : "pendente";
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
          // Aplicar: grava a correção sugerida e resolve (só o "OK" do usuário).
          if (aluno.ajusteProposto) {
            const btnAplicar = document.createElement("button");
            btnAplicar.className = "sucesso";
            btnAplicar.textContent = "Aplicar ajuste";
            btnAplicar.title = "Aplicar a correção sugerida e resolver";
            btnAplicar.onclick = () => aplicarAjuste(turmaId, aluno);
            tdAcoes.appendChild(btnAplicar);
          }

          const btnResolver = document.createElement("button");
          btnResolver.className = "secundario";
          btnResolver.textContent = aluno.ajusteProposto ? "Dispensar" : "Resolver";
          btnResolver.title = "Marcar como resolvido sem aplicar a sugestão";
          btnResolver.onclick = () => {
            db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
              ajusteSolicitado: false,
              ajusteProposto: firebase.firestore.FieldValue.delete(),
              ajusteContato: firebase.firestore.FieldValue.delete(),
              ajusteResolvidoEm: firebase.firestore.FieldValue.serverTimestamp(),
              ajusteHistorico: firebase.firestore.FieldValue.arrayUnion({ tipo: "resolvido", em: Date.now(), motivo: "Dispensado" })
            });
          };
          tdAcoes.appendChild(btnResolver);
        }

        // Avisar no WhatsApp: aparece quando há contato e o ajuste já foi resolvido.
        if (aluno.ajusteContato && !aluno.ajusteSolicitado) {
          const btnWa = document.createElement("button");
          btnWa.className = "sucesso";
          btnWa.textContent = "Avisar no WhatsApp";
          btnWa.title = "Enviar aviso de ajuste aprovado e pagamento liberado";
          btnWa.onclick = () => {
            const texto =
              `Olá! ✅ O ajuste da camiseta de ${aluno.nome} (turma ${turma.nome}) foi aprovado e aplicado. ` +
              `O pedido já está disponível para pagamento. 👕`;
            const url = linkWhatsapp(aluno.ajusteContato, texto);
            if (!url) {
              alert("O contato informado não é um telefone válido para o WhatsApp.");
              return;
            }
            window.open(url, "_blank");
            // Marca como avisado e remove o contato para o botão sumir.
            db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
              ajusteContato: firebase.firestore.FieldValue.delete(),
              ajusteAvisadoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
          };
          tdAcoes.appendChild(btnWa);
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
  renderizarFinanceiro();
}

// Atualiza o status do pedido de uma turma (usado no seletor da aba Inicial
// e ao arrastar cards no Kanban). Mantém `fechado` em sincronia com o status.
function atualizarStatusPedido(turmaId, novo) {
  const dados = { statusPedido: novo, fechado: novo !== "aberto" };
  if (novo !== "aberto") dados.fechadoEm = firebase.firestore.FieldValue.serverTimestamp();
  // Atualiza o estado local na hora para o Kanban reagir sem esperar o snapshot.
  if (estadoTurmas[turmaId]) {
    estadoTurmas[turmaId].turma.statusPedido = novo;
    estadoTurmas[turmaId].turma.fechado = novo !== "aberto";
  }
  db.collection("turmas").doc(turmaId).update(dados)
    .catch((e) => console.error("Falha ao mudar status do pedido:", e));
}

// Aplica a correção sugerida no pedido de ajuste (grava os campos propostos)
// e resolve o ajuste, registrando no histórico. É o "OK" do administrador.
function aplicarAjuste(turmaId, aluno) {
  const p = aluno.ajusteProposto || {};
  const resumo = resumoMudancasAjuste(aluno, p);
  const dados = {
    ajusteSolicitado: false,
    ajusteProposto: firebase.firestore.FieldValue.delete(),
    ajusteMotivo: "",
    ajusteResolvidoEm: firebase.firestore.FieldValue.serverTimestamp(),
    ajusteHistorico: firebase.firestore.FieldValue.arrayUnion({
      tipo: "resolvido",
      em: Date.now(),
      motivo: "Ajuste aplicado",
      mudancas: resumo
    })
  };
  CAMPOS_AJUSTE.forEach((c) => {
    if (p[c.key] !== undefined) dados[c.key] = p[c.key];
  });
  db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update(dados)
    .catch((e) => {
      console.error(e);
      alert("Não foi possível aplicar o ajuste. Tente novamente.");
    });
}

// ---------------- Kanban de pedidos ----------------

// Turma sendo arrastada no momento (evita re-render que quebraria o arraste).
let kanbanArrastandoId = null;

function renderizarKanban() {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;
  // Não redesenha durante um arraste para não remover o card em movimento.
  if (kanbanArrastandoId) return;

  board.innerHTML = "";

  const ids = Object.keys(estadoTurmas);
  if (ids.length === 0) {
    board.innerHTML = "<p>Nenhum pedido (turma) cadastrado ainda.</p>";
    return;
  }

  // Agrupa as turmas por status.
  const porStatus = {};
  STATUS_PEDIDO.forEach((s) => (porStatus[s.id] = []));
  ids.forEach((turmaId) => {
    const st = statusPedidoDe(estadoTurmas[turmaId].turma);
    // Status desconhecido cai na primeira etapa para não sumir do quadro.
    (porStatus[st] || porStatus[STATUS_PEDIDO[0].id]).push(turmaId);
  });

  STATUS_PEDIDO.forEach((etapa) => {
    const coluna = document.createElement("div");
    coluna.className = "kanban-coluna";
    coluna.dataset.status = etapa.id;

    const turmasDaColuna = porStatus[etapa.id] || [];

    const titulo = document.createElement("div");
    titulo.className = "kanban-coluna-titulo";
    titulo.innerHTML =
      `<span>${escapeHtmlAdmin(etapa.label)}</span>` +
      `<span class="kanban-contador">${turmasDaColuna.length}</span>`;
    coluna.appendChild(titulo);

    const listaCards = document.createElement("div");
    listaCards.className = "kanban-cards";

    // Realce ao arrastar sobre a coluna.
    listaCards.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      coluna.classList.add("kanban-dragover");
    });
    listaCards.addEventListener("dragleave", () => {
      coluna.classList.remove("kanban-dragover");
    });
    listaCards.addEventListener("drop", (ev) => {
      ev.preventDefault();
      coluna.classList.remove("kanban-dragover");
      const turmaId = ev.dataTransfer.getData("text/plain") || kanbanArrastandoId;
      if (turmaId && estadoTurmas[turmaId] &&
          statusPedidoDe(estadoTurmas[turmaId].turma) !== etapa.id) {
        atualizarStatusPedido(turmaId, etapa.id);
      }
      kanbanArrastandoId = null;
      renderizarKanban();
    });

    turmasDaColuna
      .sort((a, b) =>
        estadoTurmas[a].turma.nome.localeCompare(estadoTurmas[b].turma.nome, "pt-BR")
      )
      .forEach((turmaId) => listaCards.appendChild(criarCardKanban(turmaId, etapa.id)));

    if (turmasDaColuna.length === 0) {
      const vazio = document.createElement("p");
      vazio.className = "kanban-vazio";
      vazio.textContent = "—";
      listaCards.appendChild(vazio);
    }

    coluna.appendChild(listaCards);
    board.appendChild(coluna);
  });
}

function criarCardKanban(turmaId, statusId) {
  const { turma, alunos } = estadoTurmas[turmaId];

  const card = document.createElement("div");
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.turmaId = turmaId;

  card.addEventListener("dragstart", (ev) => {
    kanbanArrastandoId = turmaId;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", turmaId);
    card.classList.add("kanban-card-arrastando");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("kanban-card-arrastando");
    kanbanArrastandoId = null;
    renderizarKanban();
  });

  const nPagos = alunos.filter((a) => a.pago).length;
  const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;

  const nome = document.createElement("div");
  nome.className = "kanban-card-nome";
  nome.textContent = turma.nome;
  card.appendChild(nome);

  const info = document.createElement("div");
  info.className = "kanban-card-info";
  info.textContent =
    `${alunos.length} camiseta(s) · ${nPagos} paga(s)` +
    (alunos.length - nPagos > 0 ? `, ${alunos.length - nPagos} pendente(s)` : "");
  card.appendChild(info);

  if (nAjustes > 0) {
    const aviso = document.createElement("div");
    aviso.className = "kanban-card-ajuste";
    aviso.innerHTML = `<span class="marca-ajuste">!</span> ${nAjustes} ajuste(s) solicitado(s)`;
    card.appendChild(aviso);
  }

  // Seletor de status embutido (alternativa ao arraste, ótimo no celular).
  const sel = document.createElement("select");
  sel.className = "kanban-card-status";
  STATUS_PEDIDO.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.label;
    sel.appendChild(o);
  });
  sel.value = statusId;
  sel.onchange = () => {
    atualizarStatusPedido(turmaId, sel.value);
    renderizarKanban();
  };
  // Evita iniciar o arraste do card ao interagir com o seletor.
  sel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  card.appendChild(sel);

  return card;
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

// ============================================================
// FINANCEIRO (relatórios de faturamento)
// ============================================================
// A aba tem várias VISÕES (sub-abas), cada uma respondendo a uma pergunta:
//   Visão geral  -> "como está o pedido no total?"
//   Extrato      -> "quanto entrou em cada dia, e de quem?"
//   Evolução     -> "o dinheiro está entrando em que ritmo?"
//   A receber    -> "de quem falta cobrar / o que preciso confirmar?"
//   Resultado    -> "quanto sobra depois dos custos (DRE)?"

const FIN_VISOES = [
  { id: "geral", label: "Visão geral" },
  { id: "extrato", label: "Extrato diário" },
  { id: "evolucao", label: "Evolução" },
  { id: "cobranca", label: "A receber" },
  { id: "resultado", label: "Resultado (DRE)" }
];

// Períodos rápidos do filtro (usados no Extrato e na Evolução).
const FIN_PERIODOS = [
  { id: "hoje", label: "Hoje", dias: 1 },
  { id: "7", label: "7 dias", dias: 7 },
  { id: "30", label: "30 dias", dias: 30 },
  { id: "tudo", label: "Tudo", dias: null }
];

let finUltimo = null;        // último cálculo geral (usado na exportação)
let finVisao = "geral";      // visão ativa
let finPeriodo = "30";       // "hoje" | "7" | "30" | "tudo" | "custom"
let finDe = "";              // data inicial (YYYY-MM-DD) quando periodo = custom
let finAte = "";             // data final (YYYY-MM-DD) quando periodo = custom
let finTurmaFiltro = "";     // "" = todas as turmas
let finDiasAbertos = {};     // chave do dia -> true (linhas expandidas no extrato)

// ---------------- Auxiliares de data ----------------

// Converte um campo de data do Firestore (Timestamp), um número (millis) ou
// uma string ISO em Date. Retorna null quando não dá para saber a data.
function finParaData(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === "function") return valor.toDate();
  if (typeof valor === "number") return new Date(valor);
  if (typeof valor === "string") {
    const d = new Date(valor.length === 10 ? valor + "T00:00:00" : valor);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Chave de agrupamento por dia no fuso local: "2026-08-21".
function finChaveDia(data) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function finDataDaChave(chave) {
  return new Date(chave + "T00:00:00");
}

// "21/08 (sex)" — e "hoje"/"ontem" quando for o caso.
function finRotuloDia(chave) {
  const d = finDataDaChave(chave);
  const hoje = finChaveDia(new Date());
  const ontem = finChaveDia(new Date(Date.now() - 86400000));
  const base = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const semana = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  if (chave === hoje) return `${base} (hoje)`;
  if (chave === ontem) return `${base} (ontem)`;
  return `${base} (${semana})`;
}

function finHora(data) {
  return data ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "-";
}

// Diferença em dias inteiros entre uma data e hoje (positivo = no passado).
function finDiasDesde(data) {
  if (!data) return null;
  const ini = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const hoje = new Date();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((fim - ini) / 86400000);
}

// ---------------- Coleta dos dados ----------------

// Percorre todas as turmas/alunos e calcula os números do financeiro.
// venda = preço do tamanho (aba Pagamentos); custo = Impressão + Costureira
// do grupo (aba Tamanhos). "Já chegou" = pagos; "aguardando" = declarado mas
// não confirmado; "pendente" = nem declarado.
function calcularFinanceiro() {
  const precos = precosPorGrupoAtual || {};
  const fin = {
    previsto: 0, recebido: 0, aguardando: 0, pendente: 0,
    custos: 0, custosRecebido: 0, custoImpressao: 0, custoCostureira: 0,
    qtd: 0, qtdPagas: 0, qtdAguardando: 0, qtdPendentes: 0,
    qtdInternas: 0, custoInterno: 0,
    porForma: { pix: 0, dinheiro: 0 },
    porTurma: [],
    porGrupo: {}
  };

  Object.values(estadoTurmas).forEach(({ turma, alunos }) => {
    const t = { nome: turma.nome, previsto: 0, recebido: 0, custos: 0, custoImpressao: 0, custoCostureira: 0, qtd: alunos.length, pagas: 0, internas: 0 };
    alunos.forEach((a) => {
      const interno = ehInterno(a);
      // Camiseta interna não tem receita (venda 0); as demais usam o preço do tamanho.
      const venda = interno ? 0 : Number(precoDoTamanho(a.tamanho, precos) || 0);
      const cImp = custoImpressaoDoTamanho(a.tamanho);
      const cCos = custoCostureiraDoTamanho(a.tamanho);
      const custo = cImp + cCos; // custo entra sempre (a camiseta é produzida)
      fin.custos += custo;
      fin.custoImpressao += cImp;
      fin.custoCostureira += cCos;
      fin.qtd++;
      t.custos += custo;
      t.custoImpressao += cImp;
      t.custoCostureira += cCos;

      const g = grupoDoTamanho(a.tamanho);
      const gnome = g ? g.grupo : "Sem grupo";
      if (!fin.porGrupo[gnome]) fin.porGrupo[gnome] = { qtd: 0, venda: 0, custo: 0 };
      fin.porGrupo[gnome].qtd++;
      fin.porGrupo[gnome].venda += venda;
      fin.porGrupo[gnome].custo += custo;

      if (interno) {
        // Só custo, sem receita e fora de previsto/recebido/a receber.
        fin.qtdInternas++;
        fin.custoInterno += custo;
        t.internas++;
        return;
      }

      fin.previsto += venda;
      t.previsto += venda;

      if (a.pago) {
        fin.recebido += venda;
        fin.custosRecebido += custo;
        fin.qtdPagas++;
        t.recebido += venda;
        t.pagas++;
        if (a.pagamentoForma === "dinheiro") fin.porForma.dinheiro += venda;
        else fin.porForma.pix += venda;
      } else if (a.pagamentoDeclarado) {
        fin.aguardando += venda;
        fin.qtdAguardando++;
      } else {
        fin.pendente += venda;
        fin.qtdPendentes++;
      }
    });
    t.aReceber = t.previsto - t.recebido;
    t.lucro = t.previsto - t.custos;
    t.vendaveis = t.qtd - t.internas;
    t.margem = t.previsto > 0 ? (t.lucro / t.previsto) * 100 : 0;
    fin.porTurma.push(t);
  });

  fin.qtdVendaveis = fin.qtd - fin.qtdInternas;
  fin.aReceber = fin.previsto - fin.recebido;
  fin.lucroPrevisto = fin.previsto - fin.custos;
  fin.lucroRealizado = fin.recebido - fin.custosRecebido;
  fin.margem = fin.previsto > 0 ? (fin.lucroPrevisto / fin.previsto) * 100 : 0;
  fin.pctRecebido = fin.previsto > 0 ? (fin.recebido / fin.previsto) * 100 : 0;
  fin.ticketMedio = fin.qtdVendaveis > 0 ? fin.previsto / fin.qtdVendaveis : 0;
  fin.custoMedio = fin.qtd > 0 ? fin.custos / fin.qtd : 0;

  // Ordena as turmas por valor a receber (maior primeiro) — foco na cobrança.
  fin.porTurma.sort((a, b) => b.aReceber - a.aReceber);
  return fin;
}

// Lista de lançamentos de RECEBIMENTO (uma linha por camiseta paga).
// É a base do extrato, da evolução e da conciliação por forma de pagamento.
function finLancamentos() {
  const precos = precosPorGrupoAtual || {};
  const lista = [];
  Object.entries(estadoTurmas).forEach(([turmaId, { turma, alunos }]) => {
    alunos.forEach((a) => {
      if (!a.pago || ehInterno(a)) return; // interna não gera receita
      lista.push({
        turmaId,
        turma: turma.nome,
        alunoId: a.id,
        aluno: a.nome,
        tamanho: a.tamanho,
        valor: Number(precoDoTamanho(a.tamanho, precos) || 0),
        custo: custoDoTamanho(a.tamanho),
        forma: a.pagamentoForma === "dinheiro" ? "dinheiro" : "pix",
        online: !!a.pagamentoMpId, // confirmado pelo Mercado Pago (automático)
        data: finParaData(a.pagamentoEm)
      });
    });
  });
  // Mais recentes primeiro; os sem data ficam no fim.
  lista.sort((x, y) => (y.data ? y.data.getTime() : -1) - (x.data ? x.data.getTime() : -1));
  return lista;
}

// Lista de PENDÊNCIAS (camisetas ainda não pagas), com o tempo em aberto.
function finPendencias() {
  const precos = precosPorGrupoAtual || {};
  const lista = [];
  Object.entries(estadoTurmas).forEach(([turmaId, { turma, alunos }]) => {
    const fechadoEm = finParaData(turma.fechadoEm);
    const limite = turma.dataLimite ? finParaData(turma.dataLimite) : null;
    alunos.forEach((a) => {
      if (a.pago) return;
      const declarado = !!a.pagamentoDeclarado;
      // "Aguardando" conta o tempo desde o aviso do aluno; "pendente" conta
      // desde o fechamento do pedido (ou desde o cadastro, se ainda aberto).
      const desde = declarado
        ? finParaData(a.pagamentoDeclaradoEm)
        : (fechadoEm || finParaData(a.criadoEm));
      lista.push({
        turmaId,
        turma: turma.nome,
        alunoId: a.id,
        aluno: a.nome,
        tamanho: a.tamanho,
        valor: Number(precoDoTamanho(a.tamanho, precos) || 0),
        tipo: declarado ? "aguardando" : "pendente",
        bloqueado: !!a.ajusteSolicitado, // ajuste em aberto trava o pagamento
        contato: a.ajusteContato || "",
        desde,
        dias: finDiasDesde(desde),
        limite,
        atrasado: !!(limite && limite.getTime() < Date.now()),
        status: statusPedidoDe(turma)
      });
    });
  });
  return lista;
}

// Início/fim do período escolhido no filtro (null = sem limite).
function finLimitesPeriodo() {
  const hoje = new Date();
  const fimDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);

  if (finPeriodo === "custom") {
    const de = finDe ? new Date(finDe + "T00:00:00") : null;
    const ate = finAte ? new Date(finAte + "T23:59:59") : null;
    return { de, ate, label: "período personalizado" };
  }
  const p = FIN_PERIODOS.find((x) => x.id === finPeriodo) || FIN_PERIODOS[2];
  if (!p.dias) return { de: null, ate: null, label: "desde o início" };
  const de = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (p.dias - 1));
  return { de, ate: fimDoDia, label: p.label.toLowerCase() };
}

// Aplica o filtro de período + turma. Lançamentos sem data ficam de fora do
// recorte por data (voltam separados, para não sumirem do extrato).
function finFiltrar(lista) {
  const { de, ate } = finLimitesPeriodo();
  const dentro = [];
  const semData = [];
  lista.forEach((l) => {
    if (finTurmaFiltro && l.turmaId !== finTurmaFiltro) return;
    if (!l.data) { semData.push(l); return; }
    if (de && l.data < de) return;
    if (ate && l.data > ate) return;
    dentro.push(l);
  });
  return { dentro, semData };
}

// Agrupa lançamentos por dia e calcula o acumulado (do mais antigo ao mais novo).
function finAgruparPorDia(lista) {
  const mapa = {};
  lista.forEach((l) => {
    if (!l.data) return;
    const chave = finChaveDia(l.data);
    if (!mapa[chave]) mapa[chave] = { chave, qtd: 0, total: 0, pix: 0, dinheiro: 0, online: 0, custo: 0, itens: [] };
    const d = mapa[chave];
    d.qtd++;
    d.total += l.valor;
    d.custo += l.custo;
    if (l.forma === "dinheiro") d.dinheiro += l.valor; else d.pix += l.valor;
    if (l.online) d.online += l.valor;
    d.itens.push(l);
  });

  const dias = Object.values(mapa).sort((a, b) => a.chave.localeCompare(b.chave));
  let acc = 0;
  dias.forEach((d) => {
    acc += d.total;
    d.acumulado = acc;
    d.itens.sort((a, b) => b.data - a.data);
  });
  return dias;
}

// Soma dos lançamentos entre duas datas (usado nos comparativos).
function finSomaEntre(lista, ini, fim) {
  let total = 0, qtd = 0;
  lista.forEach((l) => {
    if (!l.data) return;
    if (l.data < ini || l.data > fim) return;
    total += l.valor;
    qtd++;
  });
  return { total, qtd };
}

// ---------------- Render principal (sub-abas + visão ativa) ----------------

function renderizarFinanceiro() {
  const el = document.getElementById("financeiroConteudo");
  if (!el) return;

  const f = calcularFinanceiro();
  finUltimo = f;

  if (f.qtd === 0) {
    el.innerHTML = "<p>Nenhuma camiseta cadastrada ainda. Assim que houver pedidos, os números aparecem aqui.</p>";
    return;
  }

  const abas = FIN_VISOES.map((v) =>
    `<button type="button" class="fin-subaba${v.id === finVisao ? " ativa" : ""}" data-fin-visao="${v.id}">${v.label}</button>`
  ).join("");

  el.innerHTML = `
    <nav class="fin-subabas">${abas}</nav>
    <div id="finVisaoConteudo"></div>
  `;

  el.querySelectorAll("[data-fin-visao]").forEach((btn) => {
    btn.onclick = () => {
      finVisao = btn.dataset.finVisao;
      renderizarFinanceiro();
    };
  });

  renderizarVisaoFinanceira(f);
}

function renderizarVisaoFinanceira(f) {
  const alvo = document.getElementById("finVisaoConteudo");
  if (!alvo) return;
  if (finVisao === "extrato") return finViewExtrato(alvo, f);
  if (finVisao === "evolucao") return finViewEvolucao(alvo, f);
  if (finVisao === "cobranca") return finViewCobranca(alvo, f);
  if (finVisao === "resultado") return finViewResultado(alvo, f);
  return finViewGeral(alvo, f);
}

// Barra de filtros (período rápido, datas personalizadas e turma).
function finBarraFiltrosHtml(comPeriodo = true) {
  const botoes = FIN_PERIODOS.map((p) =>
    `<button type="button" class="fin-chip${finPeriodo === p.id ? " ativa" : ""}" data-fin-periodo="${p.id}">${p.label}</button>`
  ).join("");

  const turmas = Object.entries(estadoTurmas)
    .map(([id, { turma }]) => ({ id, nome: turma.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((t) => `<option value="${t.id}"${finTurmaFiltro === t.id ? " selected" : ""}>${escapeHtmlAdmin(t.nome)}</option>`)
    .join("");

  if (!comPeriodo) {
    return `
      <div class="fin-filtros">
        <div class="fin-filtros-linha">
          <label for="finTurma">Turma</label>
          <select id="finTurma"><option value="">Todas as turmas</option>${turmas}</select>
        </div>
      </div>
    `;
  }

  return `
    <div class="fin-filtros">
      <div class="fin-chips">
        ${botoes}
        <button type="button" class="fin-chip${finPeriodo === "custom" ? " ativa" : ""}" data-fin-periodo="custom">Personalizado</button>
      </div>
      <div class="fin-filtros-linha${finPeriodo === "custom" ? "" : " oculto"}" id="finDatasCustom">
        <label for="finDe">De</label>
        <input type="date" id="finDe" value="${finDe}" />
        <label for="finAte">Até</label>
        <input type="date" id="finAte" value="${finAte}" />
      </div>
      <div class="fin-filtros-linha">
        <label for="finTurma">Turma</label>
        <select id="finTurma"><option value="">Todas as turmas</option>${turmas}</select>
      </div>
    </div>
  `;
}

// Liga os eventos da barra de filtros (re-renderiza só a visão ativa).
function finLigarFiltros(alvo, f) {
  alvo.querySelectorAll("[data-fin-periodo]").forEach((btn) => {
    btn.onclick = () => {
      finPeriodo = btn.dataset.finPeriodo;
      renderizarVisaoFinanceira(f);
    };
  });
  const de = alvo.querySelector("#finDe");
  const ate = alvo.querySelector("#finAte");
  if (de) de.onchange = () => { finDe = de.value; renderizarVisaoFinanceira(f); };
  if (ate) ate.onchange = () => { finAte = ate.value; renderizarVisaoFinanceira(f); };
  const sel = alvo.querySelector("#finTurma");
  if (sel) sel.onchange = () => { finTurmaFiltro = sel.value; renderizarVisaoFinanceira(f); };
}

// ---------------- Visão 1: geral ----------------

function finViewGeral(alvo, f) {
  const semPrecos = f.previsto === 0;
  const avisoPrecos = semPrecos
    ? '<p class="aviso">Defina os preços por grupo na aba <strong>Pagamentos</strong> para ver os valores de faturamento.</p>'
    : "";

  // Recorte rápido do caixa recente (o resto está no extrato).
  const lanc = finLancamentos();
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const hoje = finSomaEntre(lanc, inicioHoje, agora);
  const inicio7 = new Date(inicioHoje.getTime() - 6 * 86400000);
  const semana = finSomaEntre(lanc, inicio7, agora);

  const linhasTurma = f.porTurma.map((t, idx) => {
    const pct = t.previsto > 0 ? Math.round((t.recebido / t.previsto) * 100) : 0;
    return `<tr>
      <td>${escapeHtmlAdmin(t.nome)}</td>
      <td>${t.qtd}</td>
      <td>${formatarReais(t.previsto)}</td>
      <td class="fin-verde">${formatarReais(t.recebido)}</td>
      <td class="fin-vermelho">${formatarReais(t.aReceber)}</td>
      <td>${pct}%</td>
      <td class="fin-custo-cel" data-turma-idx="${idx}" role="button" tabindex="0" title="Ver detalhe do custo">${formatarReais(t.custos)} ›</td>
      <td>${formatarReais(t.lucro)}</td>
    </tr>`;
  }).join("");

  alvo.innerHTML = `
    ${avisoPrecos}

    <!-- Destaque principal: quanto vai chegar / já chegou / falta chegar -->
    <div class="fin-destaques">
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Vai chegar (previsto)</span>
        <span class="fin-valor">${formatarReais(f.previsto)}</span>
        <span class="fin-sub">${f.qtdVendaveis} camiseta(s) vendável(is) · ticket médio ${formatarReais(f.ticketMedio)}</span>
      </div>
      <div class="fin-card fin-card-verde">
        <span class="fin-rotulo">Já chegou (recebido)</span>
        <span class="fin-valor">${formatarReais(f.recebido)}</span>
        <span class="fin-sub">${f.qtdPagas} paga(s)</span>
      </div>
      <div class="fin-card fin-card-vermelho">
        <span class="fin-rotulo">Falta chegar (a receber)</span>
        <span class="fin-valor">${formatarReais(f.aReceber)}</span>
        <span class="fin-sub">${f.qtdAguardando + f.qtdPendentes} camiseta(s) em aberto</span>
      </div>
    </div>

    <!-- Barra de recebimento -->
    <div class="fin-barra-wrap">
      <div class="fin-barra"><div class="fin-barra-fill" style="width:${Math.min(100, Math.round(f.pctRecebido))}%"></div></div>
      <div class="fin-barra-legenda">${Math.round(f.pctRecebido)}% recebido do previsto</div>
    </div>

    <!-- Caixa recente (detalhe completo no Extrato diário) -->
    <div class="resumo-tamanhos">
      <span class="badge pago">Entrou hoje: ${formatarReais(hoje.total)} (${hoje.qtd})</span>
      <span class="badge pago">Últimos 7 dias: ${formatarReais(semana.total)} (${semana.qtd})</span>
      <span class="badge aguardando">Aguardando confirmação: ${formatarReais(f.aguardando)} (${f.qtdAguardando})</span>
      <span class="badge pendente">Pendente (sem aviso): ${formatarReais(f.pendente)} (${f.qtdPendentes})</span>
    </div>

    <!-- Custos e lucro -->
    <h3 class="fin-titulo">Custos e lucro</h3>
    <div class="fin-destaques fin-destaques-3">
      <div class="fin-card fin-card-click" data-fin-modal="total" role="button" tabindex="0" title="Ver detalhe do custo">
        <span class="fin-rotulo">Custos previstos</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.custos)}</span>
        <span class="fin-sub fin-link">Impressão + Costureira · ver detalhe ›</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Lucro previsto</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.lucroPrevisto)}</span>
        <span class="fin-sub">margem ${f.margem.toFixed(0)}% · já desconta as internas</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Lucro realizado</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.lucroRealizado)}</span>
        <span class="fin-sub">sobre o que já chegou</span>
      </div>
      ${f.qtdInternas > 0 ? `
      <div class="fin-card fin-card-interno">
        <span class="fin-rotulo">Camisetas internas</span>
        <span class="fin-valor fin-valor-md">${f.qtdInternas} un</span>
        <span class="fin-sub">custo ${formatarReais(f.custoInterno)} · sem receita</span>
      </div>` : ""}
    </div>

    <!-- Forma de pagamento (do que já chegou) -->
    <h3 class="fin-titulo">Como o dinheiro chegou</h3>
    <div class="resumo-tamanhos">
      <span class="badge pago">PIX: ${formatarReais(f.porForma.pix)}</span>
      <span class="badge pago">Dinheiro: ${formatarReais(f.porForma.dinheiro)}</span>
    </div>

    <!-- Por turma -->
    <h3 class="fin-titulo">Por turma (ordenado por valor a receber)</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr>
          <th>Turma</th><th>Qtd</th><th>Previsto</th><th>Recebido</th><th>A receber</th><th>%</th><th>Custo prev.</th><th>Lucro prev.</th>
        </tr></thead>
        <tbody>${linhasTurma}</tbody>
      </table>
    </div>
  `;

  // Liga os cliques que abrem o pop-up de detalhe de custo (total e por turma).
  const cardTotal = alvo.querySelector('[data-fin-modal="total"]');
  if (cardTotal) {
    const abrir = () => abrirModalCusto("Custo previsto — total", {
      impressao: f.custoImpressao, costureira: f.custoCostureira, total: f.custos, qtd: f.qtd
    });
    cardTotal.onclick = abrir;
    cardTotal.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } };
  }
  alvo.querySelectorAll(".fin-custo-cel").forEach((cel) => {
    const t = f.porTurma[Number(cel.dataset.turmaIdx)];
    if (!t) return;
    const abrir = () => abrirModalCusto("Custo previsto — " + t.nome, {
      impressao: t.custoImpressao, costureira: t.custoCostureira, total: t.custos, qtd: t.qtd
    });
    cel.onclick = abrir;
    cel.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } };
  });
}

// ---------------- Visão 2: extrato diário de recebimentos ----------------

function finViewExtrato(alvo, f) {
  const { dentro, semData } = finFiltrar(finLancamentos());
  const dias = finAgruparPorDia(dentro).reverse(); // mais recente primeiro
  const { label } = finLimitesPeriodo();

  const total = dentro.reduce((s, l) => s + l.valor, 0);
  const pix = dentro.filter((l) => l.forma === "pix").reduce((s, l) => s + l.valor, 0);
  const dinheiro = total - pix;
  const online = dentro.filter((l) => l.forma === "pix" && l.online).reduce((s, l) => s + l.valor, 0);
  const ticket = dentro.length > 0 ? total / dentro.length : 0;
  const mediaDia = dias.length > 0 ? total / dias.length : 0;

  const linhas = dias.map((d) => {
    const aberto = !!finDiasAbertos[d.chave];
    const detalhe = d.itens.map((l) => `
      <tr class="fin-linha-item">
        <td>${finHora(l.data)}</td>
        <td>${escapeHtmlAdmin(l.aluno)}</td>
        <td>${escapeHtmlAdmin(l.turma)}</td>
        <td>${escapeHtmlAdmin(l.tamanho)}</td>
        <td>${l.forma === "dinheiro" ? "Dinheiro" : (l.online ? "PIX (online)" : "PIX")}</td>
        <td class="fin-verde">${formatarReais(l.valor)}</td>
      </tr>`).join("");

    return `
      <tbody class="fin-grupo-dia">
        <tr class="fin-linha-dia" data-fin-dia="${d.chave}" role="button" tabindex="0">
          <td><span class="fin-seta">${aberto ? "▾" : "▸"}</span> ${finRotuloDia(d.chave)}</td>
          <td>${d.qtd}</td>
          <td>${formatarReais(d.pix)}</td>
          <td>${formatarReais(d.dinheiro)}</td>
          <td class="fin-verde"><strong>${formatarReais(d.total)}</strong></td>
          <td>${formatarReais(d.acumulado)}</td>
        </tr>
        ${aberto ? `<tr class="fin-linha-detalhe"><td colspan="6">
          <table class="fin-tabela fin-tabela-interna">
            <thead><tr><th>Hora</th><th>Aluno</th><th>Turma</th><th>Tam.</th><th>Forma</th><th>Valor</th></tr></thead>
            <tbody>${detalhe}</tbody>
          </table>
        </td></tr>` : ""}
      </tbody>`;
  }).join("");

  const avisoSemData = semData.length > 0
    ? `<p class="aviso">${semData.length} pagamento(s) confirmado(s) antes do registro de data (marcados manualmente no início) somam ${formatarReais(semData.reduce((s, l) => s + l.valor, 0))} e não aparecem no extrato por dia.</p>`
    : "";

  alvo.innerHTML = `
    ${finBarraFiltrosHtml()}

    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-verde">
        <span class="fin-rotulo">Recebido no período</span>
        <span class="fin-valor">${formatarReais(total)}</span>
        <span class="fin-sub">${dentro.length} pagamento(s) · ${label}</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Média por dia com entrada</span>
        <span class="fin-valor fin-valor-md">${formatarReais(mediaDia)}</span>
        <span class="fin-sub">${dias.length} dia(s) com recebimento</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Ticket médio</span>
        <span class="fin-valor fin-valor-md">${formatarReais(ticket)}</span>
        <span class="fin-sub">por camiseta paga</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Recebido em PIX</span>
        <span class="fin-valor fin-valor-md">${formatarReais(pix)}</span>
        <span class="fin-sub">dinheiro ${formatarReais(dinheiro)} · ${formatarReais(online)} confirmados automaticamente</span>
      </div>
    </div>

    ${avisoSemData}

    <h3 class="fin-titulo">Extrato por dia <span class="fin-dica">(clique no dia para ver os pagamentos)</span></h3>
    ${dias.length === 0
      ? "<p>Nenhum recebimento neste período.</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela fin-tabela-extrato">
            <thead><tr><th>Dia</th><th>Qtd</th><th>PIX</th><th>Dinheiro</th><th>Total do dia</th><th>Acumulado no período</th></tr></thead>
            ${linhas}
          </table>
        </div>`}
  `;

  finLigarFiltros(alvo, f);
  alvo.querySelectorAll("[data-fin-dia]").forEach((linha) => {
    const alternar = () => {
      const chave = linha.dataset.finDia;
      finDiasAbertos[chave] = !finDiasAbertos[chave];
      renderizarVisaoFinanceira(f);
    };
    linha.onclick = alternar;
    linha.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); } };
  });
}

// ---------------- Visão 3: evolução (ritmo de entrada) ----------------

function finViewEvolucao(alvo, f) {
  const lanc = finLancamentos();
  const { dentro } = finFiltrar(lanc);
  const dias = finAgruparPorDia(dentro); // ordem cronológica

  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const hoje = finSomaEntre(lanc, inicioHoje, agora);
  const ontem = finSomaEntre(lanc, new Date(inicioHoje.getTime() - 86400000), new Date(inicioHoje.getTime() - 1));
  const sem1 = finSomaEntre(lanc, new Date(inicioHoje.getTime() - 6 * 86400000), agora);
  const sem2 = finSomaEntre(lanc, new Date(inicioHoje.getTime() - 13 * 86400000), new Date(inicioHoje.getTime() - 7 * 86400000 - 1));
  const variacao = sem2.total > 0 ? ((sem1.total - sem2.total) / sem2.total) * 100 : null;

  // Série contínua do período (inclui dias sem entrada, para mostrar buracos).
  const serie = [];
  if (dias.length > 0) {
    const { de, ate } = finLimitesPeriodo();
    const ini = de ? new Date(de.getFullYear(), de.getMonth(), de.getDate()) : finDataDaChave(dias[0].chave);
    const fim = ate ? new Date(ate.getFullYear(), ate.getMonth(), ate.getDate()) : inicioHoje;
    const porChave = {};
    dias.forEach((d) => { porChave[d.chave] = d; });
    let acc = 0;
    for (let d = new Date(ini); d <= fim; d = new Date(d.getTime() + 86400000)) {
      const chave = finChaveDia(d);
      const dia = porChave[chave];
      acc += dia ? dia.total : 0;
      serie.push({ chave, total: dia ? dia.total : 0, qtd: dia ? dia.qtd : 0, acumulado: acc });
      if (serie.length > 120) break; // trava de segurança para períodos longos
    }
  }

  const maxDia = serie.reduce((m, d) => Math.max(m, d.total), 0);
  // Com muitos dias o gráfico entra em modo compacto: sem o valor em cima de
  // cada barra e com a data só de tantos em tantos dias (evita virar borrão).
  const compacto = serie.length > 14;
  const passo = Math.max(1, Math.ceil(serie.length / 12));
  const barras = serie.map((d, i) => {
    const alt = maxDia > 0 ? Math.max(2, Math.round((d.total / maxDia) * 100)) : 2;
    const mostraData = !compacto || i % passo === 0 || i === serie.length - 1;
    return `<div class="fin-gr-col" title="${finRotuloDia(d.chave)} — ${formatarReais(d.total)} (${d.qtd} pgto)">
      ${compacto ? "" : `<div class="fin-gr-topo">${d.total > 0 ? formatarReais(d.total).replace("R$ ", "") : ""}</div>`}
      <div class="fin-gr-trilho"><div class="fin-gr-barra${d.total === 0 ? " fin-gr-vazia" : ""}" style="height:${alt}%"></div></div>
      <div class="fin-gr-dia">${mostraData ? d.chave.slice(8, 10) + "/" + d.chave.slice(5, 7) : "&nbsp;"}</div>
    </div>`;
  }).join("");

  // Ritmo e projeção: com a média diária dos últimos 7 dias, em quanto tempo
  // o valor que falta entra? Serve para decidir se precisa apertar a cobrança.
  const ritmo = sem1.total / 7;
  let projecao = "Sem recebimentos nos últimos 7 dias — não dá para projetar o fechamento.";
  if (f.previsto <= 0) {
    projecao = "Defina os preços por grupo na aba Pagamentos para projetar o fechamento do caixa.";
  } else if (f.aReceber <= 0) {
    projecao = "Tudo o que estava previsto já foi recebido. 🎉";
  } else if (ritmo > 0) {
    const diasFalta = Math.ceil(f.aReceber / ritmo);
    const dataFim = new Date(inicioHoje.getTime() + diasFalta * 86400000);
    projecao = `No ritmo dos últimos 7 dias (${formatarReais(ritmo)}/dia), faltam ~${diasFalta} dia(s) para receber os ${formatarReais(f.aReceber)} em aberto (por volta de ${dataFim.toLocaleDateString("pt-BR")}).`;
  }

  // Fechamento por semana (segunda a domingo) dentro do período.
  const semanas = {};
  dentro.forEach((l) => {
    const d = l.data;
    const diaSemana = (d.getDay() + 6) % 7; // 0 = segunda
    const ini = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diaSemana);
    const chave = finChaveDia(ini);
    if (!semanas[chave]) semanas[chave] = { ini, qtd: 0, total: 0 };
    semanas[chave].qtd++;
    semanas[chave].total += l.valor;
  });
  const listaSemanas = Object.values(semanas).sort((a, b) => a.ini - b.ini);
  let accSem = 0;
  const linhasSemana = listaSemanas.map((s) => {
    accSem += s.total;
    const fim = new Date(s.ini.getTime() + 6 * 86400000);
    return `<tr>
      <td>${s.ini.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}</td>
      <td>${s.qtd}</td>
      <td class="fin-verde">${formatarReais(s.total)}</td>
      <td>${formatarReais(accSem)}</td>
    </tr>`;
  }).reverse().join("");

  const setaVar = variacao === null ? "" :
    (variacao >= 0 ? `<span class="fin-verde">▲ ${variacao.toFixed(0)}%</span>` : `<span class="fin-vermelho">▼ ${Math.abs(variacao).toFixed(0)}%</span>`);

  alvo.innerHTML = `
    ${finBarraFiltrosHtml()}

    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-verde">
        <span class="fin-rotulo">Hoje</span>
        <span class="fin-valor fin-valor-md">${formatarReais(hoje.total)}</span>
        <span class="fin-sub">${hoje.qtd} pagamento(s)</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Ontem</span>
        <span class="fin-valor fin-valor-md">${formatarReais(ontem.total)}</span>
        <span class="fin-sub">${ontem.qtd} pagamento(s)</span>
      </div>
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Últimos 7 dias</span>
        <span class="fin-valor fin-valor-md">${formatarReais(sem1.total)}</span>
        <span class="fin-sub">${setaVar || "sem base de comparação"} vs. 7 dias anteriores (${formatarReais(sem2.total)})</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Progresso do previsto</span>
        <span class="fin-valor fin-valor-md">${Math.round(f.pctRecebido)}%</span>
        <span class="fin-sub">${formatarReais(f.recebido)} de ${formatarReais(f.previsto)}</span>
      </div>
    </div>

    <h3 class="fin-titulo">Entradas por dia</h3>
    ${serie.length === 0
      ? "<p>Nenhum recebimento neste período.</p>"
      : `<div class="fin-grafico${compacto ? " fin-grafico-compacto" : ""}"><div class="fin-gr-barras">${barras}</div></div>`}

    <p class="fin-projecao">${projecao}</p>

    <h3 class="fin-titulo">Por semana</h3>
    ${listaSemanas.length === 0
      ? "<p>Sem dados para o período.</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela">
            <thead><tr><th>Semana</th><th>Qtd</th><th>Recebido</th><th>Acumulado</th></tr></thead>
            <tbody>${linhasSemana}</tbody>
          </table>
        </div>`}
  `;

  finLigarFiltros(alvo, f);
}

// ---------------- Visão 4: a receber (cobrança e conciliação) ----------------

function finViewCobranca(alvo, f) {
  const pend = finPendencias().filter((p) => !finTurmaFiltro || p.turmaId === finTurmaFiltro);
  const aguardando = pend.filter((p) => p.tipo === "aguardando").sort((a, b) => (b.dias || 0) - (a.dias || 0));
  const pendentes = pend.filter((p) => p.tipo === "pendente");
  const bloqueados = pendentes.filter((p) => p.bloqueado);

  const valAguardando = aguardando.reduce((s, p) => s + p.valor, 0);
  const valPendente = pendentes.reduce((s, p) => s + p.valor, 0);

  // Envelhecimento: quanto tempo cada pendência está em aberto.
  const faixas = [
    { label: "Até 3 dias", min: 0, max: 3 },
    { label: "4 a 7 dias", min: 4, max: 7 },
    { label: "8 a 15 dias", min: 8, max: 15 },
    { label: "Mais de 15 dias", min: 16, max: Infinity }
  ].map((fx) => {
    const itens = pendentes.filter((p) => p.dias !== null && p.dias >= fx.min && p.dias <= fx.max);
    return { ...fx, qtd: itens.length, valor: itens.reduce((s, p) => s + p.valor, 0) };
  });
  const semIdade = pendentes.filter((p) => p.dias === null);

  const linhasAguardando = aguardando.map((p) => `
    <tr>
      <td>${escapeHtmlAdmin(p.aluno)}</td>
      <td>${escapeHtmlAdmin(p.turma)}</td>
      <td>${formatarReais(p.valor)}</td>
      <td>${p.dias === null ? "-" : p.dias + " dia(s)"}</td>
      <td><button type="button" class="sucesso fin-btn-confirmar" data-turma="${p.turmaId}" data-aluno="${p.alunoId}">Confirmar PIX</button></td>
    </tr>`).join("");

  // Turmas ordenadas pelo que falta receber, com o tempo médio em aberto.
  const porTurma = {};
  pend.forEach((p) => {
    if (!porTurma[p.turmaId]) porTurma[p.turmaId] = { nome: p.turma, qtd: 0, valor: 0, dias: [], status: p.status, atrasado: p.atrasado };
    const t = porTurma[p.turmaId];
    t.qtd++;
    t.valor += p.valor;
    if (p.dias !== null) t.dias.push(p.dias);
  });
  const listaTurmas = Object.values(porTurma).sort((a, b) => b.valor - a.valor);
  const linhasTurma = listaTurmas.map((t) => {
    const medio = t.dias.length > 0 ? Math.round(t.dias.reduce((s, d) => s + d, 0) / t.dias.length) : null;
    return `<tr>
      <td>${escapeHtmlAdmin(t.nome)}${t.atrasado ? ' <span class="badge fechado">prazo vencido</span>' : ""}</td>
      <td>${t.qtd}</td>
      <td class="fin-vermelho">${formatarReais(t.valor)}</td>
      <td>${medio === null ? "-" : medio + " dia(s)"}</td>
      <td>${escapeHtmlAdmin(labelStatus(t.status))}</td>
    </tr>`;
  }).join("");

  // Maiores valores individuais em aberto (foco da cobrança).
  const maiores = [...pendentes].sort((a, b) => b.valor - a.valor || (b.dias || 0) - (a.dias || 0)).slice(0, 15);
  const linhasMaiores = maiores.map((p) => `
    <tr>
      <td>${escapeHtmlAdmin(p.aluno)}${p.bloqueado ? ' <span class="badge aguardando">ajuste pendente</span>' : ""}</td>
      <td>${escapeHtmlAdmin(p.turma)}</td>
      <td>${escapeHtmlAdmin(p.tamanho)}</td>
      <td class="fin-vermelho">${formatarReais(p.valor)}</td>
      <td>${p.dias === null ? "-" : p.dias + " dia(s)"}</td>
    </tr>`).join("");

  alvo.innerHTML = `
    ${finBarraFiltrosHtml(false)}
    <p class="fin-dica">Esta visão mostra tudo o que está em aberto hoje, independente de período.</p>

    <div class="fin-destaques fin-destaques-3">
      <div class="fin-card fin-card-vermelho">
        <span class="fin-rotulo">Total a receber</span>
        <span class="fin-valor">${formatarReais(valAguardando + valPendente)}</span>
        <span class="fin-sub">${pend.length} camiseta(s) em aberto</span>
      </div>
      <div class="fin-card fin-card-amarelo">
        <span class="fin-rotulo">Aguardando confirmação</span>
        <span class="fin-valor fin-valor-md">${formatarReais(valAguardando)}</span>
        <span class="fin-sub">${aguardando.length} aluno(s) avisaram que pagaram</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Pendente (sem aviso)</span>
        <span class="fin-valor fin-valor-md">${formatarReais(valPendente)}</span>
        <span class="fin-sub">${pendentes.length} camiseta(s)${bloqueados.length > 0 ? ` · ${bloqueados.length} travada(s) por ajuste` : ""}</span>
      </div>
    </div>

    <h3 class="fin-titulo">Fila de conferência (avisaram que pagaram)</h3>
    ${aguardando.length === 0
      ? "<p>Nada para conferir agora.</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela">
            <thead><tr><th>Aluno</th><th>Turma</th><th>Valor</th><th>Esperando há</th><th></th></tr></thead>
            <tbody>${linhasAguardando}</tbody>
          </table>
        </div>`}

    <h3 class="fin-titulo">Tempo em aberto (pendentes sem aviso)</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Faixa</th><th>Qtd</th><th>Valor</th></tr></thead>
        <tbody>
          ${faixas.map((fx) => `<tr><td>${fx.label}</td><td>${fx.qtd}</td><td>${formatarReais(fx.valor)}</td></tr>`).join("")}
          ${semIdade.length > 0 ? `<tr><td>Sem data de referência</td><td>${semIdade.length}</td><td>${formatarReais(semIdade.reduce((s, p) => s + p.valor, 0))}</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <h3 class="fin-titulo">Por turma (maior valor em aberto primeiro)</h3>
    ${listaTurmas.length === 0
      ? "<p>Nenhuma pendência. Tudo pago! 🎉</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela">
            <thead><tr><th>Turma</th><th>Em aberto</th><th>Valor</th><th>Tempo médio</th><th>Status do pedido</th></tr></thead>
            <tbody>${linhasTurma}</tbody>
          </table>
        </div>`}

    ${maiores.length === 0 ? "" : `
    <h3 class="fin-titulo">Maiores pendências individuais</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Aluno</th><th>Turma</th><th>Tam.</th><th>Valor</th><th>Em aberto há</th></tr></thead>
        <tbody>${linhasMaiores}</tbody>
      </table>
    </div>`}
  `;

  finLigarFiltros(alvo, f);
  alvo.querySelectorAll(".fin-btn-confirmar").forEach((btn) => {
    btn.onclick = () => {
      if (!confirm("Confirmar o recebimento por PIX desta camiseta?")) return;
      atualizarPagamento(btn.dataset.turma, btn.dataset.aluno, "pix");
    };
  });
}

// ---------------- Visão 5: resultado (DRE) ----------------

function finViewResultado(alvo, f) {
  const gruposOrdenados = Object.keys(f.porGrupo).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhasGrupo = gruposOrdenados.map((g) => {
    const d = f.porGrupo[g];
    const lucro = d.venda - d.custo;
    const margem = d.venda > 0 ? (lucro / d.venda) * 100 : 0;
    return `<tr>
      <td>${escapeHtmlAdmin(g)}</td>
      <td>${d.qtd}</td>
      <td>${formatarReais(d.venda)}</td>
      <td>${formatarReais(d.custo)}</td>
      <td>${formatarReais(lucro)}</td>
      <td>${margem.toFixed(0)}%</td>
    </tr>`;
  }).join("");

  // Ranking de rentabilidade por turma (quem dá mais lucro previsto).
  const ranking = [...f.porTurma].sort((a, b) => b.lucro - a.lucro).map((t) => `
    <tr>
      <td>${escapeHtmlAdmin(t.nome)}</td>
      <td>${t.qtd}${t.internas > 0 ? ` <span class="fin-sub">(${t.internas} int.)</span>` : ""}</td>
      <td>${formatarReais(t.previsto)}</td>
      <td>${formatarReais(t.custos)}</td>
      <td>${formatarReais(t.lucro)}</td>
      <td>${t.margem.toFixed(0)}%</td>
    </tr>`).join("");

  const dre = [
    ["Receita prevista (camisetas vendáveis)", f.previsto, "linha"],
    ["(-) Custo de impressão", -f.custoImpressao, "linha"],
    ["(-) Custo de costureira", -f.custoCostureira, "linha"],
    ["(=) Lucro previsto", f.lucroPrevisto, "total"],
    ["Receita já recebida", f.recebido, "linha"],
    ["(-) Custo das camisetas já pagas", -f.custosRecebido, "linha"],
    ["(=) Lucro realizado", f.lucroRealizado, "total"],
    ["Custo das camisetas internas (sem receita)", -f.custoInterno, "linha"],
    ["(=) Caixa a receber", f.aReceber, "total"]
  ].map(([rotulo, valor, tipo]) => `
    <tr class="${tipo === "total" ? "fin-linha-total" : ""}">
      <td>${rotulo}</td>
      <td class="${valor < 0 ? "fin-vermelho" : "fin-verde"}">${formatarReais(Math.abs(valor))}</td>
    </tr>`).join("");

  alvo.innerHTML = `
    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Ticket médio</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.ticketMedio)}</span>
        <span class="fin-sub">por camiseta vendável</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Custo médio unitário</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.custoMedio)}</span>
        <span class="fin-sub">impressão + costureira</span>
      </div>
      <div class="fin-card fin-card-verde">
        <span class="fin-rotulo">Margem prevista</span>
        <span class="fin-valor fin-valor-md">${f.margem.toFixed(0)}%</span>
        <span class="fin-sub">lucro ${formatarReais(f.lucroPrevisto)}</span>
      </div>
      <div class="fin-card fin-card-interno">
        <span class="fin-rotulo">Camisetas internas</span>
        <span class="fin-valor fin-valor-md">${f.qtdInternas} un</span>
        <span class="fin-sub">custo ${formatarReais(f.custoInterno)} · sem receita</span>
      </div>
    </div>

    <h3 class="fin-titulo">Demonstrativo do resultado</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela fin-tabela-dre">
        <tbody>${dre}</tbody>
      </table>
    </div>

    <h3 class="fin-titulo">Rentabilidade por turma</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Turma</th><th>Qtd</th><th>Receita prev.</th><th>Custo</th><th>Lucro prev.</th><th>Margem</th></tr></thead>
        <tbody>${ranking}</tbody>
      </table>
    </div>

    <h3 class="fin-titulo">Por grupo de tamanho</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Grupo</th><th>Qtd</th><th>Venda</th><th>Custo</th><th>Lucro</th><th>Margem</th></tr></thead>
        <tbody>${linhasGrupo}</tbody>
      </table>
    </div>
  `;
}

// Pop-up com o detalhe do custo (Impressão + Costureira).
function abrirModalCusto(titulo, d) {
  const modal = document.getElementById("modalCusto");
  const tit = document.getElementById("modalCustoTitulo");
  const corpo = document.getElementById("modalCustoCorpo");
  if (!modal || !corpo) return;
  if (tit) tit.textContent = titulo;
  corpo.innerHTML = `
    <table class="fin-tabela fin-tabela-modal">
      <tbody>
        <tr><td>Impressão</td><td>${formatarReais(d.impressao)}</td></tr>
        <tr><td>Costureira</td><td>${formatarReais(d.costureira)}</td></tr>
        <tr class="fin-linha-total"><td><strong>Total</strong></td><td><strong>${formatarReais(d.total)}</strong></td></tr>
      </tbody>
    </table>
    <p class="pix-ajuda">${d.qtd} camiseta(s) considerada(s) (inclui as internas).</p>
  `;
  modal.classList.remove("oculto");
}

function fecharModalCusto() {
  const modal = document.getElementById("modalCusto");
  if (modal) modal.classList.add("oculto");
}

// ---------------- Exportação (segue a visão aberta) ----------------

function exportarFinanceiro() {
  const f = finUltimo || calcularFinanceiro();
  if (f.qtd === 0) {
    alert("Não há dados financeiros para exportar.");
    return;
  }
  if (finVisao === "extrato") return exportarExtrato();
  if (finVisao === "evolucao") return exportarEvolucao();
  if (finVisao === "cobranca") return exportarCobranca();
  if (finVisao === "resultado") return exportarResultado(f);
  return exportarResumoPorTurma(f);
}

// Visão geral / resumo por turma (formato original do relatório).
function exportarResumoPorTurma(f) {
  const linhas = [["Turma", "Camisetas", "Previsto", "Recebido", "A receber", "% recebido", "Impressao", "Costureira", "Custos", "Lucro previsto"]];
  f.porTurma.forEach((t) => {
    const pct = t.previsto > 0 ? Math.round((t.recebido / t.previsto) * 100) : 0;
    linhas.push([
      t.nome, t.qtd,
      t.previsto.toFixed(2), t.recebido.toFixed(2), t.aReceber.toFixed(2),
      pct + "%", t.custoImpressao.toFixed(2), t.custoCostureira.toFixed(2), t.custos.toFixed(2), t.lucro.toFixed(2)
    ]);
  });
  linhas.push([]);
  linhas.push([
    "TOTAL", f.qtd,
    f.previsto.toFixed(2), f.recebido.toFixed(2), f.aReceber.toFixed(2),
    Math.round(f.pctRecebido) + "%", f.custoImpressao.toFixed(2), f.custoCostureira.toFixed(2), f.custos.toFixed(2), f.lucroPrevisto.toFixed(2)
  ]);
  baixarCSV("financeiro-interclasse.csv", linhas);
}

// Extrato analítico: uma linha por pagamento, na ordem do extrato.
function exportarExtrato() {
  const { dentro, semData } = finFiltrar(finLancamentos());
  const todos = dentro.concat(semData);
  if (todos.length === 0) {
    alert("Não há recebimentos no período selecionado.");
    return;
  }
  const linhas = [["Data", "Hora", "Aluno", "Turma", "Tamanho", "Forma", "Origem", "Valor"]];
  todos.forEach((l) => {
    linhas.push([
      l.data ? l.data.toLocaleDateString("pt-BR") : "sem data",
      l.data ? finHora(l.data) : "",
      l.aluno, l.turma, l.tamanho,
      l.forma === "dinheiro" ? "Dinheiro" : "PIX",
      l.online ? "Mercado Pago" : "Manual",
      l.valor.toFixed(2)
    ]);
  });
  linhas.push([]);
  linhas.push(["TOTAL", "", "", "", "", "", todos.length + " pgto", todos.reduce((s, l) => s + l.valor, 0).toFixed(2)]);
  baixarCSV("extrato-recebimentos.csv", linhas);
}

// Consolidado por dia (com acumulado) — bom para colar em planilha/gráfico.
function exportarEvolucao() {
  const { dentro } = finFiltrar(finLancamentos());
  const dias = finAgruparPorDia(dentro);
  if (dias.length === 0) {
    alert("Não há recebimentos no período selecionado.");
    return;
  }
  const linhas = [["Dia", "Qtd", "PIX", "Dinheiro", "Total do dia", "Acumulado"]];
  dias.forEach((d) => {
    linhas.push([
      finDataDaChave(d.chave).toLocaleDateString("pt-BR"),
      d.qtd, d.pix.toFixed(2), d.dinheiro.toFixed(2), d.total.toFixed(2), d.acumulado.toFixed(2)
    ]);
  });
  baixarCSV("recebimentos-por-dia.csv", linhas);
}

// Tudo o que está em aberto, do mais antigo para o mais novo.
function exportarCobranca() {
  const pend = finPendencias()
    .filter((p) => !finTurmaFiltro || p.turmaId === finTurmaFiltro)
    .sort((a, b) => (b.dias || 0) - (a.dias || 0));
  if (pend.length === 0) {
    alert("Não há pendências para exportar.");
    return;
  }
  const linhas = [["Aluno", "Turma", "Tamanho", "Situacao", "Valor", "Em aberto (dias)", "Desde", "Bloqueado por ajuste"]];
  pend.forEach((p) => {
    linhas.push([
      p.aluno, p.turma, p.tamanho,
      p.tipo === "aguardando" ? "Aguardando confirmacao" : "Pendente",
      p.valor.toFixed(2),
      p.dias === null ? "" : p.dias,
      p.desde ? p.desde.toLocaleDateString("pt-BR") : "",
      p.bloqueado ? "sim" : "nao"
    ]);
  });
  linhas.push([]);
  linhas.push(["TOTAL", "", "", "", pend.reduce((s, p) => s + p.valor, 0).toFixed(2), "", "", ""]);
  baixarCSV("a-receber-interclasse.csv", linhas);
}

// DRE + rentabilidade por turma e por grupo.
function exportarResultado(f) {
  const linhas = [["Demonstrativo", "Valor"]];
  [
    ["Receita prevista", f.previsto],
    ["Custo de impressao", -f.custoImpressao],
    ["Custo de costureira", -f.custoCostureira],
    ["Lucro previsto", f.lucroPrevisto],
    ["Receita recebida", f.recebido],
    ["Custo das camisetas pagas", -f.custosRecebido],
    ["Lucro realizado", f.lucroRealizado],
    ["Custo das camisetas internas", -f.custoInterno],
    ["Caixa a receber", f.aReceber]
  ].forEach(([r, v]) => linhas.push([r, v.toFixed(2)]));

  linhas.push([]);
  linhas.push(["Turma", "Qtd", "Receita prevista", "Custo", "Lucro previsto", "Margem %"]);
  [...f.porTurma].sort((a, b) => b.lucro - a.lucro).forEach((t) => {
    linhas.push([t.nome, t.qtd, t.previsto.toFixed(2), t.custos.toFixed(2), t.lucro.toFixed(2), t.margem.toFixed(0)]);
  });

  linhas.push([]);
  linhas.push(["Grupo de tamanho", "Qtd", "Venda", "Custo", "Lucro", "Margem %"]);
  Object.keys(f.porGrupo).sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((g) => {
    const d = f.porGrupo[g];
    const lucro = d.venda - d.custo;
    const margem = d.venda > 0 ? (lucro / d.venda) * 100 : 0;
    linhas.push([g, d.qtd, d.venda.toFixed(2), d.custo.toFixed(2), lucro.toFixed(2), margem.toFixed(0)]);
  });

  baixarCSV("resultado-interclasse.csv", linhas);
}

const elBtnExportarFinanceiro = document.getElementById("btnExportarFinanceiro");
if (elBtnExportarFinanceiro) elBtnExportarFinanceiro.addEventListener("click", exportarFinanceiro);

// Fechar o pop-up de custo (botão × e clique no fundo escuro).
const elFecharModalCusto = document.getElementById("fecharModalCusto");
if (elFecharModalCusto) elFecharModalCusto.addEventListener("click", fecharModalCusto);
const elModalCusto = document.getElementById("modalCusto");
if (elModalCusto) {
  elModalCusto.addEventListener("click", (ev) => {
    if (ev.target === elModalCusto) fecharModalCusto();
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
      if (aluno.ajusteSolicitado) {
        // Corrigir a linha resolve o ajuste e registra no histórico.
        dados.ajusteSolicitado = false;
        dados.ajusteProposto = firebase.firestore.FieldValue.delete();
        dados.ajusteResolvidoEm = firebase.firestore.FieldValue.serverTimestamp();
        dados.ajusteHistorico = firebase.firestore.FieldValue.arrayUnion({ tipo: "resolvido", em: Date.now() });
      }
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
    // Sobrepõe a marca d'água (sem alterar o arquivo) quando ativada na turma.
    bloco.appendChild(envolverImagemComMarca(thumb, turma.marcaDagua === true));
  }

  const inputImg = document.createElement("input");
  inputImg.type = "file";
  inputImg.accept = "image/*";
  inputImg.style.display = "none";

  // Checkbox: liga/desliga a marca d'água SOBREPOSTA (não altera o arquivo).
  // Vale na hora e para imagens já enviadas — é só uma camada na exibição.
  const lblMarca = document.createElement("label");
  lblMarca.className = "checkbox-inline check-marca";
  const chkMarca = document.createElement("input");
  chkMarca.type = "checkbox";
  chkMarca.checked = turma.marcaDagua === true;
  chkMarca.onchange = () => {
    // Atualiza o estado local na hora e persiste o flag na turma.
    if (estadoTurmas[turmaId]) estadoTurmas[turmaId].turma.marcaDagua = chkMarca.checked;
    db.collection("turmas").doc(turmaId).update({ marcaDagua: chkMarca.checked })
      .then(() => renderizarTurmasAdmin())
      .catch((e) => console.error("Falha ao salvar a marca d'água:", e));
  };
  lblMarca.appendChild(chkMarca);
  lblMarca.appendChild(document.createTextNode(" Marca d'água de referência (sobreposta)"));

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

  bloco.appendChild(lblMarca);
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

let gruposTamanhoEdit = []; // estado em edição do editor de tamanhos
let painelConfigCarregado = false;
let driveScriptUrl = ""; // URL do Apps Script para upload de imagem (config/geral)
let precosPorGrupoAtual = {}; // preço de venda por grupo (aba Pagamentos) — usado p/ o lucro

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

  precosPorGrupoAtual = cfg.precosPorGrupo || {};

  await carregarTamanhos();
  gruposTamanhoEdit = clonarGrupos(GRUPOS_TAMANHO);
  renderizarEditorTamanhos();

  // Pagamento (PIX)
  elPixChave.value = cfg.pixChave || "";
  elPixNome.value = cfg.pixNome || "";
  elPixCidade.value = cfg.pixCidade || "";
  elMpAtivo.checked = cfg.mpAtivo === true;
  elMpBackendUrl.value = cfg.mpBackendUrl || "";
  renderizarPrecosPorGrupo(cfg.precosPorGrupo || {});

  // Com preços e custos já carregados, atualiza o financeiro.
  renderizarFinanceiro();
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

  const precosPorGrupo = {};
  elPrecosPorGrupo.querySelectorAll("input").forEach((inp) => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v >= 0) precosPorGrupo[inp.dataset.grupo] = v;
  });

  const dados = {
    pixChave: elPixChave.value.trim(),
    pixNome: elPixNome.value.trim(),
    pixCidade: elPixCidade.value.trim(),
    precosPorGrupo,
    mpAtivo: elMpAtivo.checked,
    mpBackendUrl: elMpBackendUrl.value.trim().replace(/\/$/, "")
  };

  try {
    await db.collection("config").doc("geral").set(dados, { merge: true });
    // Mantém o lucro do editor de tamanhos em dia com o novo preço de venda.
    precosPorGrupoAtual = precosPorGrupo;
    renderizarEditorTamanhos();
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

    // Custos e lucro do grupo (Impressão, Costureira e Lucro = venda − custos).
    box.appendChild(criarBlocoCustos(grupo, iGrupo));

    elEditorTamanhos.appendChild(box);
  });

  if (gruposTamanhoEdit.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Nenhum grupo. Clique em \"Adicionar grupo\" para começar.";
    elEditorTamanhos.appendChild(p);
  }
}

// Bloco de custos de um grupo: Impressão, Costureira e Lucro calculado.
// O "valor de venda" vem do preço por grupo definido na aba Pagamentos.
function criarBlocoCustos(grupo, iGrupo) {
  const bloco = document.createElement("div");
  bloco.className = "bloco-custos";

  const titulo = document.createElement("div");
  titulo.className = "bloco-custos-titulo";
  titulo.textContent = "Custos e lucro";
  bloco.appendChild(titulo);

  const linha = document.createElement("div");
  linha.className = "linha-custos";

  // Campo de custo (Impressão ou Costureira) que recalcula o lucro ao digitar.
  const campoCusto = (rotulo, chave) => {
    const wrap = document.createElement("div");
    wrap.className = "campo-custo";
    const lbl = document.createElement("label");
    lbl.textContent = rotulo + " (R$)";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.min = "0";
    inp.placeholder = "0,00";
    inp.value = grupo[chave] != null ? grupo[chave] : "";
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      gruposTamanhoEdit[iGrupo][chave] = isNaN(v) ? null : v;
      atualizarLucro();
    };
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    return wrap;
  };

  linha.appendChild(campoCusto("Impressão", "custoImpressao"));
  linha.appendChild(campoCusto("Costureira", "custoCostureira"));

  // Venda (somente leitura) — definida na aba Pagamentos.
  const venda = Number(precosPorGrupoAtual[grupo.grupo] || 0);
  const wrapVenda = document.createElement("div");
  wrapVenda.className = "campo-custo";
  const lblVenda = document.createElement("label");
  lblVenda.textContent = "Venda (R$)";
  const valVenda = document.createElement("div");
  valVenda.className = "valor-venda";
  valVenda.textContent = venda > 0 ? formatarReais(venda) : "—";
  wrapVenda.appendChild(lblVenda);
  wrapVenda.appendChild(valVenda);
  linha.appendChild(wrapVenda);

  // Lucro (somente leitura) = venda − impressão − costureira.
  const wrapLucro = document.createElement("div");
  wrapLucro.className = "campo-custo";
  const lblLucro = document.createElement("label");
  lblLucro.textContent = "Lucro (R$)";
  const valLucro = document.createElement("div");
  valLucro.className = "valor-lucro";
  wrapLucro.appendChild(lblLucro);
  wrapLucro.appendChild(valLucro);
  linha.appendChild(wrapLucro);

  function atualizarLucro() {
    const imp = Number(gruposTamanhoEdit[iGrupo].custoImpressao || 0);
    const cos = Number(gruposTamanhoEdit[iGrupo].custoCostureira || 0);
    const lucro = venda - imp - cos;
    valLucro.textContent = formatarReais(lucro);
    valLucro.classList.toggle("negativo", lucro < 0);
  }
  atualizarLucro();

  bloco.appendChild(linha);

  if (venda <= 0) {
    const aviso = document.createElement("small");
    aviso.className = "pix-ajuda";
    aviso.textContent = "Defina o preço de venda deste grupo na aba Pagamentos para calcular o lucro.";
    bloco.appendChild(aviso);
  }

  return bloco;
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
    .map((g) => {
      const grupo = {
        grupo: g.grupo.trim(),
        tamanhos: g.tamanhos.map((t) => t.trim()).filter(Boolean)
      };
      // Guarda os custos só quando informados (número >= 0).
      if (g.custoImpressao != null && !isNaN(g.custoImpressao)) grupo.custoImpressao = Number(g.custoImpressao);
      if (g.custoCostureira != null && !isNaN(g.custoCostureira)) grupo.custoCostureira = Number(g.custoCostureira);
      return grupo;
    })
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
