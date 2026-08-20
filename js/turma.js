// ============================================================
// PÁGINA DA TURMA: cadastro, conferência e fechamento do pedido
// ============================================================

const params = new URLSearchParams(window.location.search);
const turmaId = params.get("id");

let turmaAtual = null;
let desbloqueado = false;
let alunosAtuais = []; // cache da última leitura, para exportar/resumir
let cadastrosGlobaisAbertos = true; // controlado nas configurações gerais (admin)
let configGeral = {}; // config/geral (inclui dados de PIX e preços)

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
const elBtnExportar = document.getElementById("btnExportar");
const elMensagemFechado = document.getElementById("mensagemFechado");
const elMensagemGlobalFechado = document.getElementById("mensagemGlobalFechado");
const elMensagemSuspenso = document.getElementById("mensagemSuspenso");
const elBarraStatus = document.getElementById("barraStatus");
const elImagemTurma = document.getElementById("imagemTurma");
const elWrapImagemTurma = document.getElementById("wrapImagemTurma");
const elMarcaImagemTurma = document.getElementById("marcaImagemTurma");
const elInfoDataLimite = document.getElementById("infoDataLimite");
const elBlocoDataLimite = document.getElementById("blocoDataLimite");
const elDataLimite = document.getElementById("dataLimite");
const elBtnSalvarDataLimite = document.getElementById("btnSalvarDataLimite");
const elMsgDataLimite = document.getElementById("msgDataLimite");

if (!turmaId) {
  elNomeTurma.textContent = "Turma não especificada.";
} else {
  iniciar();
}

async function iniciar() {
  // Login anônimo é necessário para GRAVAR (cadastrar/editar). Ler é público,
  // então não travamos a tela se ele falhar — apenas a gravação exigirá que o
  // provedor "Anônimo" esteja ativado no Firebase.
  try {
    await entrarAnonimo();
  } catch (e) {
    console.warn("Login anônimo indisponível; a página abre, mas cadastrar exige o provedor Anônimo ativo.", e);
  }

  // Carrega tamanhos e configurações gerais antes de montar a tela.
  await carregarTamanhos();
  configGeral = await carregarConfigGeral();
  aplicarConfigGeral(configGeral);
  cadastrosGlobaisAbertos = configGeral.cadastrosAbertos !== false;

  preencherSelectTamanhos(document.getElementById("tamanho"));

  const doc = await db.collection("turmas").doc(turmaId).get();
  if (!doc.exists) {
    elNomeTurma.textContent = "Turma não encontrada.";
    return;
  }
  turmaAtual = doc.data();
  elNomeTurma.textContent = turmaAtual.nome;
  await aplicarFechamentoAutomatico();
  atualizarBadge();

  // Se já desbloqueou nesta aba antes, não pede senha de novo.
  if (sessionStorage.getItem("desbloqueado-" + turmaId) === "1") {
    desbloqueado = true;
  }
  atualizarVisibilidade();

  escutarAlunos();

  // Mantém o status da turma atualizado em tempo real.
  db.collection("turmas").doc(turmaId).onSnapshot(async (snap) => {
    if (snap.exists) {
      turmaAtual = snap.data();
      await aplicarFechamentoAutomatico();
      atualizarBadge();
      atualizarVisibilidade();
    }
  });
}

// Fecha o pedido automaticamente quando a data limite passa (aberto -> fechado).
// Esta é a única mudança de status feita fora do Super Admin.
async function aplicarFechamentoAutomatico() {
  const novo = statusAutoPorData(turmaAtual);
  if (!novo) return;
  try {
    await db.collection("turmas").doc(turmaId).update({
      statusPedido: novo,
      fechado: true,
      fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    turmaAtual.statusPedido = novo;
    turmaAtual.fechado = true;
  } catch (e) {
    console.warn("Não foi possível aplicar o fechamento automático por data.", e);
  }
}

function atualizarBadge() {
  const statusId = statusPedidoDe(turmaAtual);
  elBadgeStatus.textContent = labelStatus(statusId);
  elBadgeStatus.className = "badge " + classeBadgeStatus(statusId);

  renderizarBarraStatus(elBarraStatus, statusId);

  // Imagem da camiseta (referência para os alunos).
  if (elImagemTurma && elWrapImagemTurma) {
    if (turmaAtual.imagemUrl) {
      elImagemTurma.src = turmaAtual.imagemUrl;
      elWrapImagemTurma.classList.remove("oculto");
      // Marca d'água sobreposta (não altera o arquivo), conforme o flag da turma.
      if (elMarcaImagemTurma) {
        elMarcaImagemTurma.classList.toggle("oculto", turmaAtual.marcaDagua !== true);
      }
    } else {
      elWrapImagemTurma.classList.add("oculto");
      elImagemTurma.removeAttribute("src");
    }
  }

  // Info da data limite.
  if (elInfoDataLimite) {
    if (turmaAtual.dataLimite) {
      const d = new Date(turmaAtual.dataLimite + "T00:00:00");
      const txt = isNaN(d.getTime()) ? turmaAtual.dataLimite : d.toLocaleDateString("pt-BR");
      elInfoDataLimite.textContent = "Data limite para pagamento: " + txt;
      elInfoDataLimite.classList.remove("oculto");
    } else {
      elInfoDataLimite.classList.add("oculto");
    }
  }
}

function atualizarVisibilidade() {
  const aberto = pedidoAberto(turmaAtual);
  const suspenso = pedidoSuspenso(turmaAtual);
  const aceitaCadastro = pedidoAceitaCadastro(turmaAtual); // aberto/fechado/pagamento
  const podeEditar = desbloqueado && aceitaCadastro && cadastrosGlobaisAbertos;

  elCardSenha.classList.toggle("oculto", desbloqueado);
  elBlocoCadastro.classList.toggle("oculto", !podeEditar);
  // Data limite: o representante define enquanto o pedido está aberto.
  if (elBlocoDataLimite) {
    elBlocoDataLimite.classList.toggle("oculto", !(desbloqueado && aberto));
    if (elDataLimite && document.activeElement !== elDataLimite) {
      elDataLimite.value = turmaAtual.dataLimite || "";
    }
  }
  // Mensagem de suspenso tem prioridade sobre a de "lista travada".
  if (elMensagemSuspenso) elMensagemSuspenso.classList.toggle("oculto", !suspenso);
  // "Não é mais possível editar" só quando a lista realmente travou (pagamento encerrado+).
  elMensagemFechado.classList.toggle("oculto", aceitaCadastro || suspenso);
  if (elMensagemGlobalFechado) {
    // Aviso global só quando a turma aceitaria cadastro, mas o admin fechou tudo.
    elMensagemGlobalFechado.classList.toggle("oculto", cadastrosGlobaisAbertos || !aceitaCadastro);
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
        verificarConfirmacaoPix();
      },
      (erro) => console.error("Erro ao carregar alunos:", erro)
    );
}

function renderizarTabela() {
  const podeEditar = desbloqueado && pedidoAceitaCadastro(turmaAtual) && cadastrosGlobaisAbertos;

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

    const marca = aluno.ajusteSolicitado
      ? '<span class="marca-ajuste" title="Ajuste solicitado à organização">!</span> '
      : "";

    tr.innerHTML = `
      <td>${marca}${escapeHtml(aluno.nome)}${propostaAjusteHtml(aluno)}${historicoAjusteHtml(aluno)}</td>
      <td>${escapeHtml(aluno.tamanho)}</td>
      <td>${escapeHtml(aluno.numero || "-")}</td>
      <td>${escapeHtml(aluno.nomeCamiseta || "-")}</td>
      <td>${badgePagamentoHtml(aluno)}</td>
      <td class="acoes-linha"></td>
    `;

    const tdAcoes = tr.querySelector(".acoes-linha");

    if (!pedidoSuspenso(turmaAtual)) {
      // Editar/excluir: liberado enquanto a lista aceita cadastro
      // (aberto, fechado e pagamento em andamento).
      if (podeEditar) {
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

      const ajustePendente = !!aluno.ajusteSolicitado;

      // Pagar: disponível nas etapas de pagamento (fechado / em andamento),
      // se houver PIX/Mercado Pago e o aluno não estiver pago. Fica BLOQUEADO
      // enquanto houver um ajuste pendente nesta unidade.
      const temMp = !!(configGeral.mpAtivo && configGeral.mpBackendUrl);
      const podePagar = pedidoAceitaPagamento(turmaAtual) && !aluno.pago && (configGeral.pixChave || temMp);
      if (podePagar && !ajustePendente) {
        const btnPagar = document.createElement("button");
        btnPagar.className = "primario";
        btnPagar.textContent = "Pagar";
        btnPagar.onclick = () => abrirPagamentoPix(aluno);
        tdAcoes.appendChild(btnPagar);
      }

      // Solicitar ajuste: em qualquer fase que não seja "aberto" (onde dá para
      // editar direto), enquanto o pagamento não foi feito nem declarado —
      // pagar confirma os dados e encerra a possibilidade de ajuste.
      if (!pedidoAberto(turmaAtual) && !aluno.pago && !aluno.pagamentoDeclarado) {
        const btnAjuste = document.createElement("button");
        btnAjuste.className = "secundario";
        if (ajustePendente) {
          btnAjuste.textContent = "Ajuste solicitado ✓";
          btnAjuste.disabled = true;
        } else {
          btnAjuste.textContent = "Solicitar ajuste";
          btnAjuste.onclick = () => solicitarAjuste(aluno);
        }
        tdAcoes.appendChild(btnAjuste);
      }

      // Aviso de pagamento bloqueado por ajuste pendente.
      if (podePagar && ajustePendente) {
        const nota = document.createElement("small");
        nota.className = "motivo-ajuste";
        nota.textContent = "Pagamento bloqueado até a organização resolver o ajuste.";
        tdAcoes.appendChild(nota);
      }
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

  // Segurança: só cadastra enquanto a lista aceita nomes (aberto/fechado/
  // pagamento em andamento) e os cadastros globais estão liberados.
  if (!pedidoAceitaCadastro(turmaAtual) || !cadastrosGlobaisAbertos) {
    alert("Os cadastros estão fechados para esta turma no momento.");
    return;
  }

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

  const tdPagamento = document.createElement("td"); // coluna de pagamento (vazia na edição)

  tr.appendChild(tdNome);
  tr.appendChild(tdTamanho);
  tr.appendChild(tdNumero);
  tr.appendChild(tdCostas);
  tr.appendChild(tdPagamento);
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

// ---------------- Solicitar ajuste (correção guiada por campos) ----------------

const elModalAjuste = document.getElementById("modalAjuste");
const elFormAjuste = document.getElementById("formAjuste");
const elAjusteNome = document.getElementById("ajusteNome");
const elAjusteTamanho = document.getElementById("ajusteTamanho");
const elAjusteNumero = document.getElementById("ajusteNumero");
const elAjusteNomeCamiseta = document.getElementById("ajusteNomeCamiseta");
const elAjusteObs = document.getElementById("ajusteObs");
const elAjusteContato = document.getElementById("ajusteContato");
const elMsgAjuste = document.getElementById("msgAjuste");
const elFecharModalAjuste = document.getElementById("fecharModalAjuste");

let ajusteAlunoAtual = null; // aluno aberto no modal de ajuste

// Abre o modal de ajuste com os campos já preenchidos com os valores atuais.
function solicitarAjuste(aluno) {
  ajusteAlunoAtual = aluno;
  if (elAjusteTamanho && elAjusteTamanho.options.length === 0) {
    preencherSelectTamanhos(elAjusteTamanho);
  }
  if (elAjusteNome) elAjusteNome.value = aluno.nome || "";
  if (elAjusteTamanho) elAjusteTamanho.value = aluno.tamanho || "";
  if (elAjusteNumero) elAjusteNumero.value = aluno.numero || "";
  if (elAjusteNomeCamiseta) elAjusteNomeCamiseta.value = aluno.nomeCamiseta || "";
  if (elAjusteObs) elAjusteObs.value = "";
  if (elAjusteContato) elAjusteContato.value = aluno.ajusteContato || "";
  if (elMsgAjuste) esconderMensagem(elMsgAjuste);
  if (elModalAjuste) elModalAjuste.classList.remove("oculto");
}

function fecharModalAjuste() {
  if (elModalAjuste) elModalAjuste.classList.add("oculto");
  ajusteAlunoAtual = null;
}

if (elFecharModalAjuste) elFecharModalAjuste.addEventListener("click", fecharModalAjuste);
if (elModalAjuste) {
  elModalAjuste.addEventListener("click", (ev) => {
    if (ev.target === elModalAjuste) fecharModalAjuste();
  });
}

if (elFormAjuste) {
  elFormAjuste.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!ajusteAlunoAtual) return;
    const aluno = ajusteAlunoAtual;
    esconderMensagem(elMsgAjuste);

    // Monta apenas os campos que mudaram em relação ao valor atual.
    const novos = {
      nome: elAjusteNome.value.trim(),
      tamanho: elAjusteTamanho.value,
      numero: elAjusteNumero.value.trim(),
      nomeCamiseta: elAjusteNomeCamiseta.value.trim()
    };
    const proposto = {};
    CAMPOS_AJUSTE.forEach((c) => {
      const atual = (aluno[c.key] || "").toString();
      if (novos[c.key] !== atual) proposto[c.key] = novos[c.key];
    });

    if (Object.keys(proposto).length === 0) {
      mostrarMensagem(elMsgAjuste, "Altere pelo menos um campo para solicitar o ajuste.", "erro");
      return;
    }
    if (proposto.nome === "" || proposto.tamanho === "" || proposto.nomeCamiseta === "") {
      mostrarMensagem(elMsgAjuste, "Nome, tamanho e nome na camiseta não podem ficar em branco.", "erro");
      return;
    }

    const obs = elAjusteObs.value.trim();
    const contato = elAjusteContato.value.trim();
    const resumo = resumoMudancasAjuste(aluno, proposto);

    const botao = elFormAjuste.querySelector("button[type=submit]");
    botao.disabled = true;
    try {
      await db.collection("turmas").doc(turmaId).collection("alunos").doc(aluno.id).update({
        ajusteSolicitado: true,
        ajusteProposto: proposto,
        ajusteMotivo: obs,
        ajusteContato: contato,
        ajusteSolicitadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        // Arrays não aceitam serverTimestamp; usamos millis + resumo em texto.
        ajusteHistorico: firebase.firestore.FieldValue.arrayUnion({
          tipo: "solicitado",
          em: Date.now(),
          mudancas: resumo,
          motivo: obs
        })
      });
      fecharModalAjuste();
      alert("Ajuste enviado para a organização. O pagamento desta unidade fica bloqueado até aplicarem a correção.");
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgAjuste, "Não foi possível enviar o ajuste. Tente novamente.", "erro");
      botao.disabled = false;
    }
  });
}

// ---------------- Pagamento via PIX ----------------

const elModalPix = document.getElementById("modalPix");
const elPixAluno = document.getElementById("pixAluno");
const elPixValor = document.getElementById("pixValor");
const elPixQr = document.getElementById("pixQr");
const elPixCodigo = document.getElementById("pixCodigo");
const elPixCopiar = document.getElementById("pixCopiar");
const elPixCopiado = document.getElementById("pixCopiado");
const elPixFechar = document.getElementById("fecharModalPix");
const elPixJaPaguei = document.getElementById("pixJaPaguei");
const elPixDeclarado = document.getElementById("pixDeclarado");
const elPixStatus = document.getElementById("pixStatus");
const elPixConteudo = document.getElementById("pixConteudo");

let pixAlunoAtual = null; // aluno aberto no modal de pagamento

function definirStatusPix(texto, tipo) {
  if (!elPixStatus) return;
  if (!texto) {
    elPixStatus.classList.add("oculto");
    elPixStatus.textContent = "";
    return;
  }
  elPixStatus.textContent = texto;
  elPixStatus.className =
    tipo === "erro" ? "erro" :
    tipo === "aguardando" ? "aviso" :
    tipo === "pago" ? "pix-ok" : "pix-ajuda";
}

function abrirPagamentoPix(aluno) {
  // Segurança: pedido suspenso não recebe pagamento.
  if (pedidoSuspenso(turmaAtual)) {
    alert("Os pagamentos estão temporariamente suspensos para esta turma.");
    return;
  }
  // Segurança: unidade com ajuste pendente fica bloqueada para pagamento.
  if (aluno.ajusteSolicitado) {
    alert("Esta camiseta tem um ajuste pendente. O pagamento libera assim que a organização resolver o ajuste.");
    return;
  }
  // Confirmação: pagar confirma os dados e encerra a possibilidade de ajuste.
  const confirmar = confirm(
    `Confira os dados desta camiseta antes de pagar:\n\n` +
    `• Nome: ${aluno.nome}\n` +
    `• Tamanho: ${aluno.tamanho}\n` +
    `• Número: ${aluno.numero || "-"}\n` +
    `• Nome na camiseta: ${aluno.nomeCamiseta || "-"}\n\n` +
    `Ao pagar, você CONFIRMA que estes dados estão corretos. ` +
    `Depois do pagamento, NÃO será mais possível solicitar ajuste desta unidade.\n\n` +
    `Deseja continuar?`
  );
  if (!confirmar) return;

  pixAlunoAtual = aluno;

  elPixAluno.textContent = `${aluno.nome} — tamanho ${aluno.tamanho}`;
  elPixCopiado.classList.add("oculto");
  elPixDeclarado.classList.add("oculto");
  definirStatusPix("", "");
  elModalPix.classList.remove("oculto");

  const usarMp = !!(configGeral.mpAtivo && configGeral.mpBackendUrl);

  if (usarMp) {
    // Checkout Pro: o conteúdo de PIX estático não é usado (vamos redirecionar).
    if (elPixConteudo) elPixConteudo.classList.add("oculto");
    if (aluno.pago) {
      definirStatusPix("Pagamento confirmado! ✅", "pago");
    } else {
      irParaCheckoutMp(aluno);
    }
    return;
  }

  // Modo PIX estático (no próprio site).
  if (elPixConteudo) elPixConteudo.classList.remove("oculto");
  if (elPixJaPaguei) {
    elPixJaPaguei.classList.toggle("oculto", !!(aluno.pago || aluno.pagamentoDeclarado));
  }
  if (aluno.pago) definirStatusPix("Pagamento confirmado! ✅", "pago");
  gerarPagamentoEstatico(aluno);
}

// Modo padrão: PIX estático gerado no próprio site (chave direta, sem taxa).
function gerarPagamentoEstatico(aluno) {
  const valor = precoDoTamanho(aluno.tamanho, configGeral.precosPorGrupo);
  const codigo = pixCopiaECola({
    chave: configGeral.pixChave,
    nome: configGeral.pixNome,
    cidade: configGeral.pixCidade,
    valor: valor
  });

  elPixValor.textContent = valor
    ? formatarReais(valor)
    : "Valor não definido para este tamanho — digite no app do banco.";
  elPixCodigo.value = codigo;
  elPixQr.src =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=" +
    encodeURIComponent(codigo);
}

// Modo Mercado Pago (Checkout Pro): pede a preferência ao backend e redireciona
// para a página hospedada do Mercado Pago. Depois de pagar, o pagador volta ao
// site e o status vira "Pago" sozinho (webhook -> Firestore -> onSnapshot).
async function irParaCheckoutMp(aluno) {
  definirStatusPix("Abrindo o Mercado Pago…", "");
  try {
    const url = configGeral.mpBackendUrl.replace(/\/$/, "") + "/api/criar-preferencia";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turmaId: turmaId,
        alunoId: aluno.id,
        retornoUrl: window.location.href
      })
    });
    const dados = await resp.json();
    if (!resp.ok || !dados.initPoint) {
      throw new Error((dados && (dados.detalhe || dados.erro)) || "Falha ao gerar pagamento");
    }
    window.location.href = dados.initPoint;
  } catch (erro) {
    console.error(erro);
    definirStatusPix("Não foi possível abrir o Mercado Pago: " + erro.message, "erro");
  }
}

// Se o pagamento do aluno aberto no modal for confirmado (em tempo real),
// mostra a confirmação sem precisar recarregar.
function verificarConfirmacaoPix() {
  if (!pixAlunoAtual || !elModalPix || elModalPix.classList.contains("oculto")) return;
  const atual = alunosAtuais.find((a) => a.id === pixAlunoAtual.id);
  if (atual && atual.pago) {
    definirStatusPix("Pagamento confirmado! ✅", "pago");
    if (elPixJaPaguei) elPixJaPaguei.classList.add("oculto");
  }
}

function fecharPagamentoPix() {
  elModalPix.classList.add("oculto");
}

if (elPixFechar) elPixFechar.addEventListener("click", fecharPagamentoPix);
if (elModalPix) {
  // Fecha ao clicar fora do conteúdo (no fundo escuro).
  elModalPix.addEventListener("click", (ev) => {
    if (ev.target === elModalPix) fecharPagamentoPix();
  });
}
if (elPixCopiar) {
  elPixCopiar.addEventListener("click", async () => {
    const texto = elPixCodigo.value;
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      // Fallback para navegadores sem clipboard API.
      elPixCodigo.select();
      document.execCommand("copy");
    }
    elPixCopiado.classList.remove("oculto");
  });
}
if (elPixJaPaguei) {
  elPixJaPaguei.addEventListener("click", async () => {
    if (!pixAlunoAtual) return;
    if (pedidoSuspenso(turmaAtual)) {
      alert("Os pagamentos estão temporariamente suspensos para esta turma.");
      return;
    }
    elPixJaPaguei.disabled = true;
    try {
      await db.collection("turmas").doc(turmaId).collection("alunos").doc(pixAlunoAtual.id).update({
        pagamentoDeclarado: true,
        pagamentoForma: "pix",
        pagamentoDeclaradoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      elPixJaPaguei.classList.add("oculto");
      elPixDeclarado.classList.remove("oculto");
    } catch (erro) {
      console.error(erro);
      alert("Não foi possível registrar. Tente novamente.");
    } finally {
      elPixJaPaguei.disabled = false;
    }
  });
}

// ---------------- Data limite para pagamento ----------------

if (elBtnSalvarDataLimite) {
  elBtnSalvarDataLimite.addEventListener("click", async () => {
    esconderMensagem(elMsgDataLimite);
    const valor = elDataLimite.value; // "YYYY-MM-DD" ou ""
    try {
      await db.collection("turmas").doc(turmaId).update({
        dataLimite: valor || firebase.firestore.FieldValue.delete()
      });
      mostrarMensagem(
        elMsgDataLimite,
        valor ? "Data limite salva. O pedido fecha sozinho ao passar dessa data." : "Data limite removida. O pedido fica aberto até a organização fechar.",
        "aviso"
      );
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgDataLimite, "Erro ao salvar a data limite. Tente novamente.", "erro");
    }
  });
}

// ---------------- Exportar CSV ----------------

elBtnExportar.addEventListener("click", () => {
  if (alunosAtuais.length === 0) {
    alert("Não há alunos cadastrados para exportar.");
    return;
  }
  const linhas = [["Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta", "Pago", "Forma Pagto"]];
  alunosAtuais.forEach((a) => {
    linhas.push([a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || "", a.pago ? "Sim" : "Nao", a.pagamentoForma || ""]);
  });
  baixarCSV(`pedido-${slugify(turmaAtual.nome)}.csv`, linhas);
});
