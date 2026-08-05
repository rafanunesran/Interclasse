// ============================================================
// PÁGINA DA TURMA: cadastro, conferência e fechamento do pedido
// ============================================================

const params = new URLSearchParams(window.location.search);
const turmaId = params.get("id");

let turmaAtual = null;
let desbloqueado = false;
let alunosAtuais = []; // cache da última leitura, para exportar/resumir
let cadastrosGlobaisAbertos = true; // controlado nas configurações gerais (admin)

// Elementos
const elNomeTurma = document.getElementById("nomeTurma");
const elBadgeStatus = document.getElementById("badgeStatus");
const elMsgSenha = document.getElementById("msgSenha");
const elCardSenha = document.getElementById("formSenha");
const elFormSenha = document.getElementById("formSenhaForm");
const elBlocoCadastro = document.getElementById("blocoCadastro");
const elFormAluno = document.getElementById("formAluno");
const elTabelaCorpo = document.querySelector("#tabelaAlunos tbody");
const elResumo = document.getElementById("resumoTamanhos");
const elAvisoDuplicado = document.getElementById("avisoDuplicado");
const elBtnFechar = document.getElementById("btnFechar");
const elBtnExportar = document.getElementById("btnExportar");
const elMensagemFechado = document.getElementById("mensagemFechado");
const elMensagemGlobalFechado = document.getElementById("mensagemGlobalFechado");

if (!turmaId) {
  elNomeTurma.textContent = "Turma não especificada.";
} else {
  iniciar();
}

async function iniciar() {
  await entrarAnonimo();

  // Carrega tamanhos e configurações gerais antes de montar a tela.
  await carregarTamanhos();
  const cfgGeral = await carregarConfigGeral();
  aplicarConfigGeral(cfgGeral);
  cadastrosGlobaisAbertos = cfgGeral.cadastrosAbertos !== false;

  preencherSelectTamanhos(document.getElementById("tamanho"));

  const doc = await db.collection("turmas").doc(turmaId).get();
  if (!doc.exists) {
    elNomeTurma.textContent = "Turma não encontrada.";
    return;
  }
  turmaAtual = doc.data();
  elNomeTurma.textContent = turmaAtual.nome;
  atualizarBadge();

  // Se já desbloqueou nesta aba antes, não pede senha de novo.
  if (sessionStorage.getItem("desbloqueado-" + turmaId) === "1") {
    desbloqueado = true;
  }
  atualizarVisibilidade();

  escutarAlunos();

  // Mantém o status da turma (aberto/fechado) atualizado em tempo real
  db.collection("turmas").doc(turmaId).onSnapshot((snap) => {
    if (snap.exists) {
      turmaAtual = snap.data();
      atualizarBadge();
      atualizarVisibilidade();
    }
  });
}

function atualizarBadge() {
  elBadgeStatus.textContent = turmaAtual.fechado ? "Fechado" : "Aberto";
  elBadgeStatus.className = "badge " + (turmaAtual.fechado ? "fechado" : "aberto");
}

function atualizarVisibilidade() {
  const podeEditar = desbloqueado && !turmaAtual.fechado && cadastrosGlobaisAbertos;

  elCardSenha.classList.toggle("oculto", desbloqueado);
  elBlocoCadastro.classList.toggle("oculto", !podeEditar);
  elBtnFechar.classList.toggle("oculto", !(desbloqueado && !turmaAtual.fechado && cadastrosGlobaisAbertos));
  elMensagemFechado.classList.toggle("oculto", !turmaAtual.fechado);
  if (elMensagemGlobalFechado) {
    // Só mostra o aviso global quando a turma em si não está fechada (para não duplicar avisos).
    elMensagemGlobalFechado.classList.toggle("oculto", cadastrosGlobaisAbertos || turmaAtual.fechado);
  }

  renderizarTabela(); // re-render para mostrar/esconder botões de ação
}

// ---------------- Senha ----------------

elFormSenha.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const valor = document.getElementById("senhaTurma").value.trim();
  esconderMensagem(elMsgSenha);

  if (valor === turmaAtual.senha) {
    desbloqueado = true;
    sessionStorage.setItem("desbloqueado-" + turmaId, "1");
    atualizarVisibilidade();
    // Leva o representante direto para a tela de cadastro.
    if (!elBlocoCadastro.classList.contains("oculto")) {
      elBlocoCadastro.scrollIntoView({ behavior: "smooth", block: "start" });
      const inputNome = document.getElementById("nomeAluno");
      if (inputNome) inputNome.focus();
    }
  } else {
    mostrarMensagem(elMsgSenha, "Senha incorreta. Confira com a coordenação/organização do interclasse.", "erro");
  }
});

// ---------------- Listagem em tempo real ----------------

function escutarAlunos() {
  db.collection("turmas")
    .doc(turmaId)
    .collection("alunos")
    .where("excluido", "==", false)
    .onSnapshot(
      (snap) => {
        alunosAtuais = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        renderizarTabela();
      },
      (erro) => console.error("Erro ao carregar alunos:", erro)
    );
}

function renderizarTabela() {
  const podeEditar = desbloqueado && !turmaAtual.fechado;

  // Conta ocorrências de cada número (ignorando vazios) para destacar duplicados
  const contagemNumero = {};
  alunosAtuais.forEach((a) => {
    if (a.numero) contagemNumero[a.numero] = (contagemNumero[a.numero] || 0) + 1;
  });
  const duplicados = Object.keys(contagemNumero).filter((n) => contagemNumero[n] > 1);

  if (duplicados.length > 0) {
    mostrarMensagem(
      elAvisoDuplicado,
      "Atenção: números de camiseta duplicados nesta turma: " + duplicados.join(", "),
      "aviso"
    );
  } else {
    esconderMensagem(elAvisoDuplicado);
  }

  elTabelaCorpo.innerHTML = "";
  alunosAtuais.forEach((aluno) => {
    const tr = document.createElement("tr");
    if (aluno.numero && duplicados.includes(String(aluno.numero))) {
      tr.classList.add("duplicado");
    }

    tr.innerHTML = `
      <td>${escapeHtml(aluno.nome)}</td>
      <td>${escapeHtml(aluno.tamanho)}</td>
      <td>${escapeHtml(aluno.numero || "-")}</td>
      <td>${escapeHtml(aluno.nomeCamiseta || "-")}</td>
      <td class="acoes-linha"></td>
    `;

    if (podeEditar) {
      const tdAcoes = tr.querySelector(".acoes-linha");

      const btnEditar = document.createElement("button");
      btnEditar.textContent = "Editar";
      btnEditar.className = "secundario";
      btnEditar.onclick = () => editarLinha(tr, aluno);

      const btnExcluir = document.createElement("button");
      btnExcluir.textContent = "Excluir";
      btnExcluir.className = "perigo";
      btnExcluir.onclick = () => excluirAluno(aluno);

      tdAcoes.appendChild(btnEditar);
      tdAcoes.appendChild(btnExcluir);
    }

    elTabelaCorpo.appendChild(tr);
  });

  renderizarResumo();
}

function renderizarResumo() {
  const contagem = {};
  TODOS_TAMANHOS.forEach((t) => (contagem[t] = 0));
  alunosAtuais.forEach((a) => {
    if (contagem[a.tamanho] !== undefined) contagem[a.tamanho]++;
  });

  elResumo.innerHTML = `<span><strong>Total: ${alunosAtuais.length}</strong></span>`;
  TODOS_TAMANHOS.forEach((t) => {
    if (contagem[t] > 0) {
      const span = document.createElement("span");
      span.textContent = `${t}: ${contagem[t]}`;
      elResumo.appendChild(span);
    }
  });
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// ---------------- Cadastro de aluno ----------------

elFormAluno.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const nome = document.getElementById("nomeAluno").value.trim();
  const tamanho = document.getElementById("tamanho").value;
  const numero = document.getElementById("numeroCamiseta").value.trim();
  const nomeCamiseta = document.getElementById("nomeCostas").value.trim();

  if (!nome || !tamanho || !nomeCamiseta) {
    alert("Preencha nome, tamanho e nome para a camiseta.");
    return;
  }

  const botao = elFormAluno.querySelector("button[type=submit]");
  botao.disabled = true;

  try {
    await db.collection("turmas").doc(turmaId).collection("alunos").add({
      nome,
      tamanho,
      numero,
      nomeCamiseta,
      excluido: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    elFormAluno.reset();
    document.getElementById("nomeAluno").focus();
  } catch (erro) {
    console.error(erro);
    alert("Erro ao salvar aluno. Tente novamente.");
  } finally {
    botao.disabled = false;
  }
});

// ---------------- Editar aluno (inline) ----------------

function editarLinha(tr, aluno) {
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
  btnSalvar.textContent = "Salvar";
  btnSalvar.className = "sucesso";
  btnSalvar.onclick = async () => {
    const novoNome = inputNome.value.trim();
    const novoNomeCamiseta = inputCostas.value.trim();
    if (!novoNome || !selectTamanho.value || !novoNomeCamiseta) {
      alert("Preencha nome, tamanho e nome para a camiseta.");
      return;
    }
    try {
      await db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
        nome: novoNome,
        tamanho: selectTamanho.value,
        numero: inputNumero.value.trim(),
        nomeCamiseta: novoNomeCamiseta
      });
    } catch (erro) {
      console.error(erro);
      alert("Erro ao salvar. Tente novamente.");
    }
  };

  const btnCancelar = document.createElement("button");
  btnCancelar.textContent = "Cancelar";
  btnCancelar.className = "secundario";
  btnCancelar.onclick = () => renderizarTabela();

  tdAcoes.appendChild(btnSalvar);
  tdAcoes.appendChild(btnCancelar);

  tr.appendChild(tdNome);
  tr.appendChild(tdTamanho);
  tr.appendChild(tdNumero);
  tr.appendChild(tdCostas);
  tr.appendChild(tdAcoes);
}

async function excluirAluno(aluno) {
  if (!confirm(`Remover "${aluno.nome}" da lista?`)) return;
  try {
    await db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
      excluido: true
    });
  } catch (erro) {
    console.error(erro);
    alert("Erro ao remover. Tente novamente.");
  }
}

// ---------------- Fechar pedido ----------------

elBtnFechar.addEventListener("click", async () => {
  if (alunosAtuais.length === 0) {
    alert("Cadastre pelo menos um aluno antes de fechar o pedido.");
    return;
  }
  if (!confirm(`Fechar o pedido de ${turmaAtual.nome} com ${alunosAtuais.length} camiseta(s)? Depois de fechado, a lista não poderá mais ser editada (só a coordenação pode reabrir).`)) {
    return;
  }
  try {
    await db.collection("turmas").doc(turmaId).update({
      fechado: true,
      fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (erro) {
    console.error(erro);
    alert("Erro ao fechar pedido. Tente novamente.");
  }
});

// ---------------- Exportar CSV ----------------

elBtnExportar.addEventListener("click", () => {
  if (alunosAtuais.length === 0) {
    alert("Não há alunos cadastrados para exportar.");
    return;
  }
  const linhas = [["Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta"]];
  alunosAtuais.forEach((a) => {
    linhas.push([a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || ""]);
  });
  baixarCSV(`pedido-${slugify(turmaAtual.nome)}.csv`, linhas);
});
