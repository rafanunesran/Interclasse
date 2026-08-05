// ============================================================
// PAINEL ADMINISTRATIVO
// ============================================================

// E-mail da conta administradora (master). É apenas um identificador; a
// segurança vem da senha, guardada no Firebase Authentication (não no código).
const MASTER_EMAIL = "rafaelnf93@gmail.com";

const estadoTurmas = {}; // turmaId -> { turma, alunos, expandido }

const elFormAdminSenha = document.getElementById("formAdminSenhaForm");
const elCardAdminSenha = document.getElementById("cardAdminSenha");
const elMsgAdminSenha = document.getElementById("msgAdminSenha");
const elPainel = document.getElementById("painelAdmin");
const elFormCriarTurma = document.getElementById("formCriarTurma");
const elListaTurmasAdmin = document.getElementById("listaTurmasAdmin");
const elBtnExportarTudo = document.getElementById("btnExportarTudo");
const elMsgCriarTurma = document.getElementById("msgCriarTurma");
const elBtnSairAdmin = document.getElementById("btnSairAdmin");

let painelIniciado = false;

// A autenticação usa o Firebase Authentication (e-mail/senha). O Firebase
// mantém a sessão salva no navegador: quem já entrou continua logado ao
// recarregar a página, até clicar em "Sair".
auth.onAuthStateChanged((user) => {
  const ehAdmin = !!user && !user.isAnonymous && user.email === MASTER_EMAIL;

  if (ehAdmin) {
    elCardAdminSenha.classList.add("oculto");
    elPainel.classList.remove("oculto");
    if (!painelIniciado) {
      painelIniciado = true;
      escutarTurmas();
      carregarPainelConfig();
    }
  } else {
    elPainel.classList.add("oculto");
    elCardAdminSenha.classList.remove("oculto");
  }
});

elFormAdminSenha.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgAdminSenha);

  const email = document.getElementById("emailAdmin").value.trim();
  const senha = document.getElementById("senhaAdmin").value;
  const botao = elFormAdminSenha.querySelector("button[type=submit]");
  botao.disabled = true;

  try {
    const cred = await auth.signInWithEmailAndPassword(email, senha);
    if (cred.user.email !== MASTER_EMAIL) {
      // Conta válida no Firebase, mas não é a conta administradora.
      await auth.signOut();
      mostrarMensagem(elMsgAdminSenha, "Esta conta não tem acesso administrativo.", "erro");
    }
    // Caso contrário, o onAuthStateChanged acima cuida de mostrar o painel.
  } catch (erro) {
    console.error(erro);
    let msg = "Não foi possível entrar. Confira o e-mail e a senha.";
    if (erro.code === "auth/operation-not-allowed") {
      msg = "O login por e-mail/senha ainda não foi ativado no Firebase (Authentication > Sign-in method).";
    } else if (erro.code === "auth/too-many-requests") {
      msg = "Muitas tentativas seguidas. Aguarde um pouco e tente novamente.";
    }
    mostrarMensagem(elMsgAdminSenha, msg, "erro");
  } finally {
    botao.disabled = false;
  }
});

if (elBtnSairAdmin) {
  elBtnSairAdmin.addEventListener("click", () => auth.signOut());
}

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

// ============================================================
// CONFIGURAÇÕES GERAIS E TAMANHOS
// ============================================================

const elFormConfigGeral = document.getElementById("formConfigGeral");
const elTituloEvento = document.getElementById("tituloEvento");
const elRodapeTexto = document.getElementById("rodapeTexto");
const elCadastrosAbertos = document.getElementById("cadastrosAbertos");
const elMsgConfigGeral = document.getElementById("msgConfigGeral");

const elEditorTamanhos = document.getElementById("editorTamanhos");
const elBtnAddGrupo = document.getElementById("btnAddGrupo");
const elBtnSalvarTamanhos = document.getElementById("btnSalvarTamanhos");
const elBtnRestaurarTamanhos = document.getElementById("btnRestaurarTamanhos");
const elMsgTamanhos = document.getElementById("msgTamanhos");

let gruposTamanhoEdit = []; // estado em edição do editor de tamanhos
let painelConfigCarregado = false;

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

  await carregarTamanhos();
  gruposTamanhoEdit = clonarGrupos(GRUPOS_TAMANHO);
  renderizarEditorTamanhos();
}

// ---------------- Configurações gerais ----------------

elFormConfigGeral.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgConfigGeral);

  const dados = {
    tituloEvento: elTituloEvento.value.trim(),
    rodape: elRodapeTexto.value.trim(),
    cadastrosAbertos: elCadastrosAbertos.checked
  };

  try {
    await db.collection("config").doc("geral").set(dados, { merge: true });
    aplicarConfigGeral(dados);
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
