// ============================================================
// PAINEL ADMINISTRATIVO
// ============================================================

let adminDesbloqueado = false;
let senhaAdminValida = null;
const estadoTurmas = {}; // turmaId -> { turma, alunos, expandido }

const elFormAdminSenha = document.getElementById("formAdminSenhaForm");
const elCardAdminSenha = document.getElementById("cardAdminSenha");
const elMsgAdminSenha = document.getElementById("msgAdminSenha");
const elPainel = document.getElementById("painelAdmin");
const elFormCriarTurma = document.getElementById("formCriarTurma");
const elListaTurmasAdmin = document.getElementById("listaTurmasAdmin");
const elBtnExportarTudo = document.getElementById("btnExportarTudo");
const elMsgCriarTurma = document.getElementById("msgCriarTurma");

iniciar();

async function iniciar() {
  await authPronta;

  if (sessionStorage.getItem("admin-desbloqueado") === "1") {
    adminDesbloqueado = true;
    elCardAdminSenha.classList.add("oculto");
    elPainel.classList.remove("oculto");
    escutarTurmas();
  }
}

elFormAdminSenha.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgAdminSenha);
  const valor = document.getElementById("senhaAdmin").value.trim();

  try {
    const doc = await db.collection("config").doc("admin").get();
    if (!doc.exists) {
      mostrarMensagem(
        elMsgAdminSenha,
        "O documento de senha do admin ainda não foi criado no Firestore (config/admin). Veja o README.",
        "erro"
      );
      return;
    }
    if (valor === doc.data().senha) {
      adminDesbloqueado = true;
      sessionStorage.setItem("admin-desbloqueado", "1");
      elCardAdminSenha.classList.add("oculto");
      elPainel.classList.remove("oculto");
      escutarTurmas();
    } else {
      mostrarMensagem(elMsgAdminSenha, "Senha incorreta.", "erro");
    }
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(elMsgAdminSenha, "Erro ao verificar senha.", "erro");
  }
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
        renderizarTurmasAdmin();
      },
      (erro) => console.error("Erro ao carregar turmas:", erro)
    );
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

    const status = turma.fechado
      ? '<span class="badge fechado">Fechado</span>'
      : '<span class="badge aberto">Aberto</span>';

    card.innerHTML = `
      <h2>${escapeHtmlAdmin(turma.nome)} ${status}</h2>
      <p>Senha da turma: <code>${escapeHtmlAdmin(turma.senha)}</code> &middot; Link: <code>turma.html?id=${turmaId}</code></p>
      <p>${alunos.length} camiseta(s) cadastrada(s)</p>
    `;

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

    if (turma.fechado) {
      const btnReabrir = document.createElement("button");
      btnReabrir.className = "sucesso";
      btnReabrir.textContent = "Reabrir pedido";
      btnReabrir.onclick = () => db.collection("turmas").doc(turmaId).update({ fechado: false });
      botoes.appendChild(btnReabrir);
    } else {
      const btnFechar = document.createElement("button");
      btnFechar.className = "perigo";
      btnFechar.textContent = "Fechar pedido";
      btnFechar.onclick = () => {
        if (confirm(`Fechar o pedido de ${turma.nome}?`)) {
          db.collection("turmas").doc(turmaId).update({
            fechado: true,
            fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      };
      botoes.appendChild(btnFechar);
    }

    card.appendChild(botoes);

    if (expandido) {
      const tabela = document.createElement("table");
      tabela.innerHTML = `
        <thead>
          <tr><th>Nome</th><th>Tamanho</th><th>Número</th><th>Nome na camiseta</th><th>Ações</th></tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = tabela.querySelector("tbody");

      alunos.forEach((aluno) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtmlAdmin(aluno.nome)}</td>
          <td>${escapeHtmlAdmin(aluno.tamanho)}</td>
          <td>${escapeHtmlAdmin(aluno.numero || "-")}</td>
          <td>${escapeHtmlAdmin(aluno.nomeCamiseta || "-")}</td>
          <td class="acoes-linha"></td>
        `;
        const tdAcoes = tr.querySelector(".acoes-linha");
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
  const linhas = [["Turma", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta"]];
  alunos.forEach((a) => linhas.push([turma.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || ""]));
  baixarCSV(`pedido-${slugify(turma.nome)}.csv`, linhas);
}

elBtnExportarTudo.addEventListener("click", () => {
  const linhas = [["Turma", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta"]];
  let total = 0;
  Object.values(estadoTurmas).forEach(({ turma, alunos }) => {
    alunos.forEach((a) => {
      linhas.push([turma.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || ""]);
      total++;
    });
  });
  if (total === 0) {
    alert("Não há alunos cadastrados em nenhuma turma.");
    return;
  }
  baixarCSV("pedido-interclasse-geral.csv", linhas);
});
