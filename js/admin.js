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
    fin.porTurma.push(t);
  });

  fin.qtdVendaveis = fin.qtd - fin.qtdInternas;
  fin.aReceber = fin.previsto - fin.recebido;
  fin.lucroPrevisto = fin.previsto - fin.custos;
  fin.lucroRealizado = fin.recebido - fin.custosRecebido;
  fin.margem = fin.previsto > 0 ? (fin.lucroPrevisto / fin.previsto) * 100 : 0;
  fin.pctRecebido = fin.previsto > 0 ? (fin.recebido / fin.previsto) * 100 : 0;
  fin.ticketMedio = fin.qtdVendaveis > 0 ? fin.previsto / fin.qtdVendaveis : 0;

  // Ordena as turmas por valor a receber (maior primeiro) — foco na cobrança.
  fin.porTurma.sort((a, b) => b.aReceber - a.aReceber);
  return fin;
}

let finUltimo = null; // guarda o último cálculo p/ exportar

function renderizarFinanceiro() {
  const el = document.getElementById("financeiroConteudo");
  if (!el) return;

  const f = calcularFinanceiro();
  finUltimo = f;

  if (f.qtd === 0) {
    el.innerHTML = "<p>Nenhuma camiseta cadastrada ainda. Assim que houver pedidos, os números aparecem aqui.</p>";
    return;
  }

  const semPrecos = f.previsto === 0;
  const avisoPrecos = semPrecos
    ? '<p class="aviso">Defina os preços por grupo na aba <strong>Pagamentos</strong> para ver os valores de faturamento.</p>'
    : "";

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

  const gruposOrdenados = Object.keys(f.porGrupo).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhasGrupo = gruposOrdenados.map((g) => {
    const d = f.porGrupo[g];
    const lucro = d.venda - d.custo;
    return `<tr>
      <td>${escapeHtmlAdmin(g)}</td>
      <td>${d.qtd}</td>
      <td>${formatarReais(d.venda)}</td>
      <td>${formatarReais(d.custo)}</td>
      <td>${formatarReais(lucro)}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `
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

    <!-- Detalhe do "falta chegar" -->
    <div class="resumo-tamanhos">
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

    <!-- Por grupo de tamanho -->
    <h3 class="fin-titulo">Por grupo de tamanho</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr>
          <th>Grupo</th><th>Qtd</th><th>Venda</th><th>Custo</th><th>Lucro</th>
        </tr></thead>
        <tbody>${linhasGrupo}</tbody>
      </table>
    </div>
  `;

  // Liga os cliques que abrem o pop-up de detalhe de custo (total e por turma).
  const cardTotal = el.querySelector('[data-fin-modal="total"]');
  if (cardTotal) {
    const abrir = () => abrirModalCusto("Custo previsto — total", {
      impressao: f.custoImpressao, costureira: f.custoCostureira, total: f.custos, qtd: f.qtd
    });
    cardTotal.onclick = abrir;
    cardTotal.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } };
  }
  el.querySelectorAll(".fin-custo-cel").forEach((cel) => {
    const t = f.porTurma[Number(cel.dataset.turmaIdx)];
    if (!t) return;
    const abrir = () => abrirModalCusto("Custo previsto — " + t.nome, {
      impressao: t.custoImpressao, costureira: t.custoCostureira, total: t.custos, qtd: t.qtd
    });
    cel.onclick = abrir;
    cel.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } };
  });
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

// Exporta o relatório financeiro (por turma + totais) em CSV.
function exportarFinanceiro() {
  const f = finUltimo || calcularFinanceiro();
  if (f.qtd === 0) {
    alert("Não há dados financeiros para exportar.");
    return;
  }
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
