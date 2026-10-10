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

const estadoTimes = {}; // timeId -> { time, alunos, expandido }
const estadoClientes = {}; // clienteId -> dados do cliente
const precosTimeAbertos = {}; // "time:ID" / "cliente:ID" -> bloco de preços aberto
const precosTimeSalvos = {};  // "time:ID" / "cliente:ID" -> aviso depois de salvar/limpar

// Cliente escolhido no seletor do topo. "" = todos; SEM_CLIENTE = só os times
// que ainda não foram atribuídos a nenhum cliente. Vale para o painel inteiro
// (lista, Kanban, Financeiro, resumo de pagamentos e exportações).
let clienteFiltro = "";

// Texto digitado na busca do topo. Vale para as telas de pedidos (lista de
// times da aba Inicial e Kanban) e procura no nome do time, no nome do
// estudante e no apelido (nome na camiseta). Ver buscaTermos().
let buscaFiltro = "";

// Seção "Arquivados" (pedidos finalizados) da aba Inicial aberta ou recolhida.
let arquivadosAbertos = false;
// Times marcados na lista para mudar o status de uma vez (ids).
const selecaoTimesStatus = new Set();
let statusEmMassa = ""; // status escolhido na barra de seleção

const elPainel = document.getElementById("painelAdmin");
const elEmailLogado = document.getElementById("emailLogado");
const elFormCriarTime = document.getElementById("formCriarTime");
const elListaTimesAdmin = document.getElementById("listaTimesAdmin");
const elBtnExportarTudo = document.getElementById("btnExportarTudo");
const elBtnExportarConferencia = document.getElementById("btnExportarConferencia");
const elMsgCriarTime = document.getElementById("msgCriarTime");
const elBtnSairAdmin = document.getElementById("btnSairAdmin");
const elFiltroCliente = document.getElementById("filtroCliente");
const elBuscaPedidos = document.getElementById("buscaPedidos");
const elBtnLimparBusca = document.getElementById("btnLimparBusca");
const elResumoBusca = document.getElementById("resumoBusca");
const elFormCriarCliente = document.getElementById("formCriarCliente");
const elListaClientesAdmin = document.getElementById("listaClientesAdmin");
const elMsgCriarCliente = document.getElementById("msgCriarCliente");
const elClienteNovoTime = document.getElementById("clienteNovoTime");
const elRepNomeNovoTime = document.getElementById("repNomeNovoTime");
const elRepFoneNovoTime = document.getElementById("repFoneNovoTime");

let painelIniciado = false;

// Guarda de acesso: o Firebase mantém a sessão salva no navegador, então
// quem já entrou continua logado ao recarregar. Se não for a conta admin,
// volta para a página de login.
// Roda `f` quando todos os <script> da página já foram carregados.
function aoCarregarScripts(f) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(f, 0));
  else setTimeout(f, 0);
}

// Sai por inatividade: 24h sem uso em nenhuma aba (ver js/auth-admin.js).
async function sairPorInatividade() {
  elPainel.classList.add("oculto");
  await auth.signOut();
  window.location.replace(PAGINA_LOGIN);
}

let ultimaGravacaoAtividade = 0;
function aoUsarPainel() {
  // No máximo uma gravação por minuto (o mousemove dispara sem parar).
  const agora = Date.now();
  if (agora - ultimaGravacaoAtividade < 60 * 1000) return;
  if (sessaoAdminExpirada()) {
    sairPorInatividade();
    return;
  }
  ultimaGravacaoAtividade = agora;
  registrarAtividadeAdmin();
}
["click", "keydown", "scroll", "pointermove", "touchstart"].forEach((ev) =>
  window.addEventListener(ev, aoUsarPainel, { passive: true, capture: true }));
// Confere de tempos em tempos (e ao voltar para a aba) se o prazo acabou.
setInterval(() => { if (auth.currentUser && sessaoAdminExpirada()) sairPorInatividade(); }, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") aoUsarPainel();
});

auth.onAuthStateChanged((user) => {
  // Máquina da geração na nuvem: só o que a geração usa (as regras negam a
  // ela preços, movimentações e a lista de trabalhos).
  if (ehContaMaquina(user)) {
    window.MODO_MAQUINA = true;
    elPainel.classList.remove("oculto");
    if (!painelIniciado) {
      painelIniciado = true;
      aoCarregarScripts(() => {
        escutarClientes();
        escutarTimes();
        carregarPainelConfig();
        if (typeof escutarLevas === "function") escutarLevas();
        if (typeof escutarMoldes === "function") escutarMoldes();
        if (typeof escutarLayout === "function") escutarLayout();
      });
    }
    return;
  }
  if (ehContaAdmin(user) && sessaoAdminExpirada()) {
    sairPorInatividade();
    return;
  }
  if (ehContaAdmin(user)) {
    registrarAtividadeAdmin();
    if (elEmailLogado) elEmailLogado.textContent = user.email;
    elPainel.classList.remove("oculto");
    if (!painelIniciado) {
      painelIniciado = true;
      // Só começa depois de TODOS os scripts da página carregarem: entre um
      // script e outro o navegador pode rodar o login, e o painel desenharia
      // antes de producao.js/artes.js existirem (erro e editor pela metade).
      // Também garante que as declarações let/const deste arquivo existam.
      aoCarregarScripts(() => {
        escutarClientes();
        escutarTimes();
        carregarPainelConfig();
        // Aba Produção (js/producao.js) — carregada depois deste arquivo.
        if (typeof escutarLevas === "function") escutarLevas();
        if (typeof escutarTrabalhosNuvem === "function") escutarTrabalhosNuvem();
        // Produção em EPS: moldes (aba Tamanhos) e layout (aba Artes).
        if (typeof escutarMoldes === "function") escutarMoldes();
        if (typeof escutarLayout === "function") escutarLayout();
        escutarPrecos();
        // Financeiro → Movimentações (js/movimentacoes.js).
        if (typeof escutarMovimentacoes === "function") escutarMovimentacoes();
      });
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

// ---------------- Topo fixo (identificação + abas) ----------------
// O bloco do topo é "sticky" no CSS: ele acompanha a rolagem para trocar de
// aba de qualquer altura da página. Aqui só publicamos a altura real dele em
// --altura-topo-admin (a barra de produção usa esse valor para parar logo
// abaixo, em vez de ficar escondida atrás) e marcamos quando ele já descolou
// do topo do conteúdo, para ganhar a sombra.

const elTopoAdmin = document.querySelector(".topo-admin");

if (elTopoAdmin) {
  const medirTopoAdmin = () => {
    const altura = elTopoAdmin.offsetHeight;
    document.documentElement.style.setProperty("--altura-topo-admin", altura + "px");
    elTopoAdmin.classList.toggle("grudado", elTopoAdmin.getBoundingClientRect().top <= 0);
  };

  medirTopoAdmin();
  window.addEventListener("scroll", medirTopoAdmin, { passive: true });
  window.addEventListener("resize", medirTopoAdmin);
  if (window.ResizeObserver) {
    // A altura muda quando as abas quebram em duas linhas ou quando o painel
    // sai do "oculto" depois do login.
    new ResizeObserver(medirTopoAdmin).observe(elTopoAdmin);
  }
}

// ============================================================
// CLIENTES
// ============================================================
// Cada time pertence a um cliente (uma escola, uma empresa...). O seletor do
// topo filtra o painel inteiro por cliente, para os pedidos de um não se
// misturarem com os do outro. Times sem cliente continuam funcionando.

function escutarClientes() {
  db.collection(COL_CLIENTES).onSnapshot(
    (snap) => {
      const idsAtuais = new Set();
      snap.forEach((doc) => {
        idsAtuais.add(doc.id);
        // Preserva o "editando" para o formulário aberto não fechar sozinho
        // quando chega uma atualização do Firestore.
        const antes = estadoClientes[doc.id] || {};
        estadoClientes[doc.id] = { id: doc.id, ...doc.data(), editando: antes.editando === true };
      });
      Object.keys(estadoClientes).forEach((id) => {
        if (!idsAtuais.has(id)) delete estadoClientes[id];
      });
      // O cliente do filtro pode ter sido excluído: volta para "todos".
      if (clienteFiltro && clienteFiltro !== SEM_CLIENTE && !estadoClientes[clienteFiltro]) {
        clienteFiltro = "";
      }
      renderizarSeletoresDeCliente();
      renderizarClientesAdmin();
      renderizarTimesAdmin();
      // A arte do cliente (aba Artes) pode ter mudado.
      if (typeof renderizarEditorLayout === "function") renderizarEditorLayout();
    },
    (erro) => console.error("Erro ao carregar clientes:", erro)
  );
}

// Clientes ordenados por nome (a ordem usada em todos os seletores e listas).
function clientesOrdenados() {
  return Object.values(estadoClientes)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
}

// Nome do cliente de um time (ou "Sem cliente").
function nomeClienteDoTime(time) {
  return nomeDoCliente(clientesOrdenados(), clienteIdDoTime(time));
}

// Times que passam pelo filtro de cliente, como [[timeId, estado], ...].
// É por aqui que TODA a tela (lista, Kanban, Financeiro, CSVs) enxerga os
// pedidos, então o filtro do topo vale para o painel inteiro de uma vez.
function timesFiltrados() {
  return Object.entries(estadoTimes).filter(([, e]) => timeDoCliente(e.time, clienteFiltro));
}

// Sufixo para os nomes de arquivo exportados quando há um cliente escolhido.
function sufixoCliente() {
  if (!clienteFiltro) return "";
  const nome = clienteFiltro === SEM_CLIENTE
    ? SEM_CLIENTE_NOME
    : (estadoClientes[clienteFiltro] && estadoClientes[clienteFiltro].nome) || clienteFiltro;
  return "-" + slugify(nome);
}

// Preenche o seletor do topo e o seletor de cliente do formulário de criação.
function renderizarSeletoresDeCliente() {
  const clientes = clientesOrdenados();

  if (elFiltroCliente) {
    const opcoes = clientes
      .map((c) => `<option value="${c.id}">${escapeHtmlAdmin(c.nome || c.id)}</option>`)
      .join("");
    elFiltroCliente.innerHTML =
      '<option value="">Todos os clientes</option>' +
      opcoes +
      `<option value="${SEM_CLIENTE}">${SEM_CLIENTE_NOME}</option>`;
    elFiltroCliente.value = clienteFiltro;
  }

  if (elClienteNovoTime) {
    const escolhido = elClienteNovoTime.value;
    elClienteNovoTime.innerHTML =
      '<option value="">Sem cliente</option>' +
      clientes.map((c) => `<option value="${c.id}">${escapeHtmlAdmin(c.nome || c.id)}</option>`).join("");
    // Mantém o que estava escolhido; se não houver, já sugere o do filtro.
    const sugerido = escolhido || (clienteFiltro !== SEM_CLIENTE ? clienteFiltro : "");
    if (sugerido && estadoClientes[sugerido]) elClienteNovoTime.value = sugerido;
  }
}

if (elFiltroCliente) {
  elFiltroCliente.addEventListener("change", () => {
    clienteFiltro = elFiltroCliente.value;
    finTimeFiltro = ""; // o time escolhido antes pode não ser deste cliente
    renderizarSeletoresDeCliente();
    renderizarTimesAdmin();
  });
}

// ============================================================
// BUSCA DOS PEDIDOS (caixa do topo, acima do menu de abas)
// ============================================================
// Acha um pedido sem abrir time por time: procura no nome do TIME (e no
// cliente, no modelo e no representante dele) e, dentro dele, no NOME do
// estudante e no APELIDO (nome na camiseta). Vale para as telas de pedidos —
// a lista da aba Inicial e o Kanban. As outras abas (Financeiro, Produção,
// Pagamentos) e as exportações continuam só com o filtro de Cliente, para os
// totais não mudarem por causa de uma busca.

// Termos da busca: texto sem acentos, em minúsculas, quebrado em palavras.
// Todas as palavras precisam bater — "3a joao" acha o João do 3º Ano A.
function buscaTermos() {
  const texto = normalizarTexto(buscaFiltro);
  return texto ? texto.split(/\s+/) : [];
}

function buscaAtiva() {
  return buscaTermos().length > 0;
}

// O que, no time, entra na busca.
function textoDoTimeParaBusca(time) {
  return [
    time.nome,
    nomeClienteDoTime(time),
    time.modeloCamiseta,
    contatoDoTime(time).nome
  ].filter(Boolean).join(" ");
}

// O que, na camiseta, entra na busca (o número ajuda a achar pelo dorsal, e a
// palavra "goleiro" junta todos os goleiros de uma vez; "prof", os professores).
function textoDoAlunoParaBusca(aluno) {
  return [aluno.nome, aluno.nomeCamiseta, aluno.numero, ehGoleiro(aluno) ? "goleiro" : "", ehProf(aluno) ? "prof professor" : ""]
    .filter(Boolean).join(" ");
}

// Resultado da busca em um pedido:
//   { casa, alunos } — `casa` diz se o pedido entra na lista; `alunos` são as
//   camisetas que bateram (vazio quando quem bateu foi o próprio time).
// As palavras que já batem no time saem da conta, então "3a joao" funciona
// mesmo com "3a" vindo do nome do time e "joao" do nome do estudante.
function resultadoBusca(time, alunos, termos) {
  if (!termos.length) return { casa: true, alunos: [] };

  const alvoTime = normalizarTexto(textoDoTimeParaBusca(time));
  const faltando = termos.filter((t) => !alvoTime.includes(t));
  if (faltando.length === 0) return { casa: true, alunos: [] };

  const achados = (alunos || []).filter((a) => {
    const alvo = normalizarTexto(textoDoAlunoParaBusca(a));
    return faltando.every((t) => alvo.includes(t));
  });
  return { casa: achados.length > 0, alunos: achados };
}

// Times das telas de pedidos: filtro de Cliente do topo + busca.
function timesDosPedidos() {
  const termos = buscaTermos();
  if (!termos.length) return timesFiltrados();
  return timesFiltrados().filter(([, e]) => resultadoBusca(e.time, e.alunos, termos).casa);
}

// Mostra quanto a busca achou e liga/desliga o botão de limpar.
function atualizarResumoBusca(nTimes, nCamisetas) {
  if (elBtnLimparBusca) elBtnLimparBusca.classList.toggle("oculto", !buscaAtiva());
  if (!elResumoBusca) return;

  if (!buscaAtiva()) {
    elResumoBusca.textContent = "";
    elResumoBusca.classList.add("oculto");
    return;
  }
  elResumoBusca.classList.remove("oculto");
  elResumoBusca.textContent = nTimes === 0
    ? "Nada encontrado"
    : `${nTimes} pedido(s)` + (nCamisetas > 0 ? ` · ${nCamisetas} camiseta(s)` : "");
}

function limparBusca() {
  buscaFiltro = "";
  if (elBuscaPedidos) elBuscaPedidos.value = "";
  renderizarTimesAdmin();
  if (elBuscaPedidos) elBuscaPedidos.focus();
}

if (elBuscaPedidos) {
  elBuscaPedidos.addEventListener("input", () => {
    buscaFiltro = elBuscaPedidos.value;
    // Redesenha a lista de times — que já redesenha o Kanban no fim.
    renderizarTimesAdmin();
  });
  // Esc limpa a busca sem tirar a mão do teclado.
  elBuscaPedidos.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      limparBusca();
    }
  });
}

if (elBtnLimparBusca) {
  elBtnLimparBusca.addEventListener("click", limparBusca);
}

// ---------------- Criar cliente ----------------

if (elFormCriarCliente) {
  elFormCriarCliente.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    esconderMensagem(elMsgCriarCliente);

    const nome = document.getElementById("nomeNovoCliente").value.trim();
    const contato = document.getElementById("contatoNovoCliente").value.trim();
    if (!nome) return;

    try {
      let id = slugify(nome) || "cliente";
      let idFinal = id;
      let sufixo = 2;
      while ((await db.collection(COL_CLIENTES).doc(idFinal).get()).exists) {
        idFinal = `${id}-${sufixo}`;
        sufixo++;
      }
      await db.collection(COL_CLIENTES).doc(idFinal).set({
        nome,
        contato,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      elFormCriarCliente.reset();
      mostrarMensagem(elMsgCriarCliente, `Cliente "${nome}" criado.`, "aviso");
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgCriarCliente, "Erro ao criar o cliente.", "erro");
    }
  });
}

// ---------------- Lista de clientes ----------------

function renderizarClientesAdmin() {
  if (!elListaClientesAdmin) return;
  elListaClientesAdmin.innerHTML = "";

  const clientes = clientesOrdenados();
  if (clientes.length === 0) {
    elListaClientesAdmin.innerHTML =
      "<p>Nenhum cliente cadastrado ainda. Sem clientes, todos os times aparecem juntos — como antes.</p>";
    return;
  }

  clientes.forEach((cliente) => {
    const card = document.createElement("div");
    card.className = "card";

    if (cliente.editando) {
      card.appendChild(criarFormEdicaoCliente(cliente));
      elListaClientesAdmin.appendChild(card);
      return;
    }

    const times = Object.values(estadoTimes).filter((e) => clienteIdDoTime(e.time) === cliente.id);
    const camisetas = times.reduce((soma, e) => soma + e.alunos.length, 0);

    card.innerHTML = `
      <h2>${escapeHtmlAdmin(cliente.nome || cliente.id)}${
        cliente.oculto === true ? ` <span class="badge oculto-loja">${icone("eye-off")} Oculto na loja</span>` : ""}</h2>
      ${cliente.oculto === true ? '<p class="pix-ajuda">Este cliente e os times dele não aparecem na loja. Os links diretos dos times continuam funcionando.</p>' : ""}
      ${cliente.contato ? `<p>Contato: ${escapeHtmlAdmin(cliente.contato)}</p>` : ""}
      <p>${times.length} time(s) &middot; ${camisetas} camiseta(s) &middot; Link: <code>index.html?cliente=${cliente.id}</code></p>
    `;

    const botoes = document.createElement("div");

    const btnVer = document.createElement("button");
    btnVer.className = "primario";
    btnVer.textContent = "Ver só este cliente";
    btnVer.onclick = () => {
      clienteFiltro = cliente.id;
      finTimeFiltro = "";
      renderizarSeletoresDeCliente();
      renderizarTimesAdmin();
      const abaInicial = document.querySelector('.aba[data-aba="inicial"]');
      if (abaInicial) abaInicial.click();
    };
    botoes.appendChild(btnVer);

    // Arte só deste cliente (aba Artes): tirar um logo, mudar um texto,
    // acrescentar uma imagem… sem aparecer para os outros clientes.
    if (typeof abrirArteDoCliente === "function") {
      const arte = cliente.arte || {};
      const nArte = Object.values(arte.layoutAjustes || {}).reduce((s, p) => s + Object.keys(p || {}).length, 0) +
        Object.values(arte.elementosExtras || {}).reduce((s, l) => s + (l || []).length, 0);
      const btnArte = document.createElement("button");
      btnArte.className = "secundario";
      btnArte.textContent = "Arte do cliente" + (nArte ? ` (${nArte})` : "");
      btnArte.title = "Ajustes e elementos da arte só para os times deste cliente";
      btnArte.onclick = () => abrirArteDoCliente(cliente.id);
      botoes.appendChild(btnArte);
    }

    const btnEditar = document.createElement("button");
    btnEditar.className = "secundario";
    btnEditar.textContent = "Editar cliente";
    btnEditar.onclick = () => {
      estadoClientes[cliente.id].editando = true;
      renderizarClientesAdmin();
    };
    botoes.appendChild(btnEditar);

    const btnOcultar = document.createElement("button");
    btnOcultar.className = "secundario";
    btnOcultar.innerHTML = cliente.oculto === true
      ? icone("eye") + " Mostrar na loja"
      : icone("eye-off") + " Ocultar da loja";
    btnOcultar.onclick = () => alternarClienteOculto(cliente, btnOcultar);
    botoes.appendChild(btnOcultar);

    const btnExcluir = document.createElement("button");
    btnExcluir.className = "perigo";
    btnExcluir.textContent = "Excluir cliente";
    btnExcluir.onclick = () => excluirCliente(cliente, times.length);
    botoes.appendChild(btnExcluir);

    card.appendChild(botoes);

    // Tabela de preço do cliente (vale para todos os times dele).
    card.appendChild(criarBlocoPrecos("cliente", cliente.id));
    elListaClientesAdmin.appendChild(card);
  });
}

// Ocultar/mostrar o cliente na loja: com ele oculto, nenhum time dele aparece
// em index.html (os links diretos dos times continuam abrindo).
async function alternarClienteOculto(cliente, botao) {
  const ocultar = cliente.oculto !== true;
  botao.disabled = true;
  try {
    await db.collection(COL_CLIENTES).doc(cliente.id).update({ oculto: ocultar });
  } catch (erro) {
    console.error(erro);
    botao.disabled = false;
    alert("Erro ao salvar. Tente novamente.");
  }
}

// Formulário inline de edição do nome/contato do cliente.
function criarFormEdicaoCliente(cliente) {
  const wrap = document.createElement("div");

  const h2 = document.createElement("h2");
  h2.textContent = "Editar cliente";
  wrap.appendChild(h2);

  const lblNome = document.createElement("label");
  lblNome.textContent = "Nome do cliente";
  const inNome = document.createElement("input");
  inNome.type = "text";
  inNome.value = cliente.nome || "";

  const lblContato = document.createElement("label");
  lblContato.textContent = "Contato (opcional)";
  const inContato = document.createElement("input");
  inContato.type = "text";
  inContato.value = cliente.contato || "";

  wrap.appendChild(lblNome);
  wrap.appendChild(inNome);
  wrap.appendChild(lblContato);
  wrap.appendChild(inContato);

  const acoes = document.createElement("div");

  const btnSalvar = document.createElement("button");
  btnSalvar.className = "sucesso";
  btnSalvar.textContent = "Salvar";
  btnSalvar.onclick = async () => {
    const nome = inNome.value.trim();
    if (!nome) {
      alert("Informe o nome do cliente.");
      return;
    }
    btnSalvar.disabled = true;
    try {
      await db.collection(COL_CLIENTES).doc(cliente.id).update({ nome, contato: inContato.value.trim() });
      if (estadoClientes[cliente.id]) estadoClientes[cliente.id].editando = false;
      renderizarClientesAdmin();
    } catch (erro) {
      console.error(erro);
      alert("Erro ao salvar o cliente. Tente novamente.");
      btnSalvar.disabled = false;
    }
  };

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "secundario";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => {
    if (estadoClientes[cliente.id]) estadoClientes[cliente.id].editando = false;
    renderizarClientesAdmin();
  };

  acoes.appendChild(btnSalvar);
  acoes.appendChild(btnCancelar);
  wrap.appendChild(acoes);
  return wrap;
}

// Excluir cliente: só quando não sobra nenhum time apontando para ele — assim
// nenhum pedido fica órfão por engano. Mova os times antes, se for o caso.
async function excluirCliente(cliente, qtdTimes) {
  if (qtdTimes > 0) {
    alert(
      `"${cliente.nome}" ainda tem ${qtdTimes} time(s).\n\n` +
      "Mude o cliente desses times (aba Inicial → abra o time → Configuração) antes de excluir."
    );
    return;
  }
  if (!confirm(`Excluir o cliente "${cliente.nome}"?`)) return;
  try {
    await db.collection(COL_CLIENTES).doc(cliente.id).delete();
    // Os preços do cliente vão junto (se falhar, não atrapalha).
    db.collection(COL_PRECOS).doc(idDocPrecoCliente(cliente.id)).delete().catch(() => {});
  } catch (erro) {
    console.error(erro);
    alert("Erro ao excluir o cliente. Verifique as regras do Firestore (firestore.rules).");
  }
}

// ---------------- Criar time ----------------
// O formulário fica recolhido; o botão "+ Novo time" (topo da aba Inicial) abre.

const elCardCriarTime = document.getElementById("cardCriarTime");
const elBtnNovoTime = document.getElementById("btnNovoTime");
const elBtnCancelarNovoTime = document.getElementById("btnCancelarNovoTime");

function mostrarFormNovoTime(mostrar) {
  if (!elCardCriarTime) return;
  elCardCriarTime.classList.toggle("oculto", !mostrar);
  if (elBtnNovoTime) elBtnNovoTime.classList.toggle("oculto", mostrar);
  if (mostrar) {
    esconderMensagem(elMsgCriarTime);
    const nome = document.getElementById("nomeNovoTime");
    if (nome) nome.focus();
  }
}

if (elBtnNovoTime) elBtnNovoTime.addEventListener("click", () => mostrarFormNovoTime(true));
if (elBtnCancelarNovoTime) {
  elBtnCancelarNovoTime.addEventListener("click", () => {
    elFormCriarTime.reset();
    mostrarFormNovoTime(false);
  });
}

elFormCriarTime.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgCriarTime);

  const nome = document.getElementById("nomeNovoTime").value.trim();
  const senha = document.getElementById("senhaNovoTime").value.trim();

  if (!nome || !senha) return;

  let id = slugify(nome);
  if (!id) id = "time";

  try {
    let idFinal = id;
    let sufixo = 2;
    while ((await db.collection(COL_TIMES).doc(idFinal).get()).exists) {
      idFinal = `${id}-${sufixo}`;
      sufixo++;
    }

    await db.collection(COL_TIMES).doc(idFinal).set({
      nome,
      senha,
      // Cliente dono do pedido ("" = ainda sem cliente).
      clienteId: elClienteNovoTime ? elClienteNovoTime.value : "",
      // Contato do representante (opcional): vira o link de WhatsApp no card.
      representanteNome: elRepNomeNovoTime ? elRepNomeNovoTime.value.trim() : "",
      representanteTelefone: elRepFoneNovoTime ? elRepFoneNovoTime.value.trim() : "",
      fechado: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });

    elFormCriarTime.reset();
    renderizarSeletoresDeCliente();
    mostrarFormNovoTime(false);
    // Abre o time novo já na Configuração: é de lá que sai o link e a senha
    // para mandar ao representante.
    abrirTimeAdmin(idFinal, "config");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(elMsgCriarTime, "Erro ao criar time.", "erro");
  }
});

// ---------------- Listagem de times ----------------

function escutarTimes() {
  db.collection(COL_TIMES)
    .orderBy("nome")
    .onSnapshot(
      (snap) => {
        const idsAtuais = new Set();
        snap.forEach((doc) => {
          idsAtuais.add(doc.id);
          if (!estadoTimes[doc.id]) {
            estadoTimes[doc.id] = { time: doc.data(), alunos: [], expandido: false };
            escutarAlunosDaTime(doc.id);
          } else {
            estadoTimes[doc.id].time = doc.data();
          }
        });
        Object.keys(estadoTimes).forEach((id) => {
          if (!idsAtuais.has(id)) delete estadoTimes[id];
        });
        timesCarregados = true;
        if (typeof migrarPrecosAntigos === "function") migrarPrecosAntigos();
        aplicarFechamentoAutomatico();
        renderizarTimesAdmin();
      },
      (erro) => console.error("Erro ao carregar times:", erro)
    );
}

// Fecha automaticamente os times cuja data limite já passou (aberto ->
// pagamento do 1º lote). Única mudança de status automática; as demais são
// manuais (seletor de status).
function aplicarFechamentoAutomatico() {
  Object.keys(estadoTimes).forEach((timeId) => {
    const time = estadoTimes[timeId].time;
    const novo = statusAutoPorData(time);
    if (novo) {
      estadoTimes[timeId].time.statusPedido = novo;
      estadoTimes[timeId].time.fechado = true;
      db.collection(COL_TIMES).doc(timeId).update({
        statusPedido: novo,
        fechado: true,
        fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
      }).catch((e) => console.warn("Falha no fechamento automático:", e));
    }
  });
}

function escutarAlunosDaTime(timeId) {
  db.collection(COL_TIMES)
    .doc(timeId)
    .collection("alunos")
    .where("excluido", "==", false)
    .onSnapshot((snap) => {
      if (!estadoTimes[timeId]) return;
      estadoTimes[timeId].alunos = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      renderizarTimesAdmin();
      // Confere o lote de produção gravado em cada camiseta (js/producao.js).
      if (typeof agendarSincronizacaoLotes === "function") agendarSincronizacaoLotes();
    });
}

// ============================================================
// ABA INICIAL: lista de times e o time aberto (com abas próprias)
// ============================================================
// A lista mostra só o essencial de cada pedido — o nome do time e quem o
// representa. Ao clicar, o time abre com três abas:
//   • Lista — as camisetas, com editar, registrar pagamento e adicionar;
//   • Configuração — representante (contato e senha), data limite e a
//     tabela especial de preço;
//   • Arquivos de produção — os arquivos da folha EPS, a prévia da arte
//     (sem simulação e no mockup) e as imagens da página do pedido;
//   • Editar arte — o editor de layout travado neste time: posição,
//     tamanho da letra, cores e o que aparece, só para ele.
// O time aberto fica no endereço (#time=ID&aba=...), então recarregar a
// página ou usar o "voltar" do navegador funciona como esperado.

const ABAS_TIME_ADMIN = [
  { id: "lista", label: "Lista" },
  { id: "config", label: "Configuração" },
  { id: "arquivos", label: "Arquivos de produção" },
  { id: "editarArte", label: "Editar arte" }
];

let timeAbertoAdmin = "";     // time aberto na aba Inicial ("" = lista de times)
let abaTimeAdmin = "lista";   // aba do time aberto
let timesCarregados = false;  // já chegou a primeira leitura dos times?
let renderTimesPendente = false;
const rascunhoConfigTime = {}; // timeId -> campos da Configuração ainda não salvos

function lerEnderecoAdmin() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  timeAbertoAdmin = p.get("time") || "";
  const aba = p.get("aba") || "lista";
  abaTimeAdmin = ABAS_TIME_ADMIN.some((a) => a.id === aba) ? aba : "lista";
}

function enderecoDoTime(timeId, aba) {
  return "#time=" + encodeURIComponent(timeId) + (aba && aba !== "lista" ? "&aba=" + aba : "");
}

// Abre um time (vai para a aba Inicial, se estiver em outra).
function abrirTimeAdmin(timeId, aba) {
  const abaInicial = document.querySelector('.aba[data-aba="inicial"]');
  if (abaInicial && !abaInicial.classList.contains("ativa")) abaInicial.click();
  const destino = enderecoDoTime(timeId, aba);
  if (window.location.hash === destino) return;
  window.location.hash = destino; // hashchange redesenha
}

// Troca a aba do time aberto sem empilhar histórico (o "voltar" sai do time).
function trocarAbaTimeAdmin(aba) {
  window.location.replace(enderecoDoTime(timeAbertoAdmin, aba));
}

function voltarParaListaAdmin() {
  if (!window.location.hash) return;
  history.pushState("", document.title, window.location.pathname + window.location.search);
  lerEnderecoAdmin();
  renderizarTimesAdmin();
}

lerEnderecoAdmin();
window.addEventListener("hashchange", () => {
  const antes = timeAbertoAdmin;
  lerEnderecoAdmin();
  renderizarTimesAdmin();
  if (antes !== timeAbertoAdmin) window.scrollTo({ top: 0 });
});

// Campo de texto com o cursor dentro do time aberto: redesenhar agora
// apagaria o que está sendo digitado. Espera o campo perder o foco.
function digitandoNoTimeAberto() {
  const a = document.activeElement;
  if (!timeAbertoAdmin || !a || !elListaTimesAdmin.contains(a)) return false;
  if (a.tagName === "TEXTAREA") return true;
  return a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "file", "color"].includes(a.type);
}

elListaTimesAdmin.addEventListener("focusout", () => {
  if (renderTimesPendente) setTimeout(renderizarTimesAdmin, 0);
});

// Telas que dependem da mesma lista de times (redesenhadas junto).
function renderizarTelasDosTimes() {
  renderizarResumoPagamentos();
  renderizarKanban();
  renderizarFinanceiro();
  // A aba Clientes conta os times de cada um, então acompanha a lista.
  renderizarClientesAdmin();
  // A aba Produção escolhe camisetas a partir desta mesma lista.
  if (typeof renderizarProducao === "function") renderizarProducao();
  // O editor de layout (aba Artes) lista os times e mostra a arte deles.
  if (typeof renderizarEditorLayout === "function") renderizarEditorLayout();
}

function renderizarTimesAdmin() {
  if (digitandoNoTimeAberto()) {
    renderTimesPendente = true;
    renderizarTelasDosTimes();
    return;
  }
  renderTimesPendente = false;

  const secao = document.getElementById("aba-inicial");
  if (secao) secao.classList.toggle("com-time-aberto", !!timeAbertoAdmin);

  // A busca do topo conta os pedidos e as camisetas encontradas.
  const termos = buscaTermos();
  const achados = timesDosPedidos();
  const nCamisetas = achados.reduce((s, [, e]) => s + resultadoBusca(e.time, e.alunos, termos).alunos.length, 0);
  atualizarResumoBusca(achados.length, nCamisetas);

  elListaTimesAdmin.innerHTML = "";
  if (timeAbertoAdmin) renderizarTimeAberto(timeAbertoAdmin);
  else renderizarListaTimes();

  renderizarTelasDosTimes();
}

// ---------------- Lista de times (só o nome e o representante) ----------------

function renderizarListaTimes() {
  const termosBusca = buscaTermos();
  const ids = timesDosPedidos()
    .map(([id]) => id)
    .sort((a, b) => estadoTimes[a].time.nome.localeCompare(estadoTimes[b].time.nome, "pt-BR"));

  if (!timesCarregados) {
    elListaTimesAdmin.innerHTML = '<p class="pix-ajuda">Carregando os times…</p>';
    return;
  }

  if (ids.length === 0) {
    elListaTimesAdmin.innerHTML = termosBusca.length
      ? `<div class="vazio-lista"><p>Nenhum pedido encontrado para <strong>${escapeHtmlAdmin(buscaFiltro.trim())}</strong>.</p><p class="pix-ajuda">A busca procura no nome do time, no nome do estudante e no apelido da camiseta${clienteFiltro ? ", dentro do cliente escolhido no topo" : ""}.</p></div>`
      : clienteFiltro
        ? '<div class="vazio-lista"><p>Nenhum time para o cliente escolhido.</p><p class="pix-ajuda">Troque o cliente no seletor do topo ou crie um time com <strong>+ Novo time</strong>.</p></div>'
        : '<div class="vazio-lista"><p>Nenhum time cadastrado ainda.</p><p class="pix-ajuda">Comece pelo botão <strong>+ Novo time</strong>.</p></div>';
    return;
  }

  // Marcados que sumiram da lista (outro cliente, busca, time excluído) saem
  // da seleção: a ação em massa só vale para o que está na tela.
  [...selecaoTimesStatus].forEach((id) => { if (!ids.includes(id)) selecaoTimesStatus.delete(id); });
  elListaTimesAdmin.appendChild(criarBarraStatusEmMassa(ids));

  // Pedidos finalizados vão para o "arquivo": uma seção recolhível no fim.
  const idsAtivos = ids.filter((id) => !pedidoFinalizado(estadoTimes[id].time));
  const idsArquivados = ids.filter((id) => pedidoFinalizado(estadoTimes[id].time));

  if (idsAtivos.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "pix-ajuda";
    vazio.textContent = termosBusca.length
      ? "Nenhum pedido em andamento bateu com a busca — veja os arquivados abaixo."
      : "Nenhum pedido em andamento — todos estão arquivados.";
    elListaTimesAdmin.appendChild(vazio);
  }

  // Sem cliente escolhido no topo, os times vêm agrupados por cliente.
  const agrupar = !clienteFiltro && clientesOrdenados().length > 0;
  if (agrupar) {
    const grupos = {};
    idsAtivos.forEach((id) => {
      const nome = nomeClienteDoTime(estadoTimes[id].time);
      (grupos[nome] = grupos[nome] || []).push(id);
    });
    Object.keys(grupos)
      .sort((a, b) => (a === SEM_CLIENTE_NOME) - (b === SEM_CLIENTE_NOME) || a.localeCompare(b, "pt-BR"))
      .forEach((nome) => {
        const titulo = document.createElement("h3");
        titulo.className = "grupo-times-titulo";
        titulo.innerHTML = `${escapeHtmlAdmin(nome)} <span class="grupo-times-qtd">${grupos[nome].length}</span>`;
        elListaTimesAdmin.appendChild(titulo);
        elListaTimesAdmin.appendChild(criarListaDeLinhas(grupos[nome], termosBusca));
      });
  } else if (idsAtivos.length > 0) {
    elListaTimesAdmin.appendChild(criarListaDeLinhas(idsAtivos, termosBusca));
  }

  if (idsArquivados.length > 0) {
    const elArquivados = document.createElement("details");
    elArquivados.className = "arquivados-admin";
    // Com busca ativa o arquivo já abre, para o resultado não ficar escondido.
    elArquivados.open = arquivadosAbertos || termosBusca.length > 0;
    elArquivados.addEventListener("toggle", () => {
      if (!buscaAtiva()) arquivadosAbertos = elArquivados.open;
    });
    elArquivados.innerHTML =
      `<summary>${icone("archive")} Arquivados (finalizados) <span class="badge finalizado">${idsArquivados.length}</span></summary>` +
      '<p class="pix-ajuda">Pedidos com status Finalizado. Eles saem do Kanban e da tela inicial, mas continuam no Financeiro. Para tirar um pedido do arquivo, mude o status dele.</p>';
    elArquivados.appendChild(criarListaDeLinhas(idsArquivados, termosBusca));
    elListaTimesAdmin.appendChild(elArquivados);
  }
}

// Barra da seleção em massa: "selecionar todos" e, com algo marcado, o
// status novo e o botão que aplica em todos os times marcados.
function criarBarraStatusEmMassa(ids) {
  const barra = document.createElement("div");
  const n = selecaoTimesStatus.size;
  barra.className = "barra-status-massa" + (n > 0 ? " ativa" : "");

  const rotuloTodos = document.createElement("label");
  rotuloTodos.className = "check-massa";
  const chkTodos = document.createElement("input");
  chkTodos.type = "checkbox";
  chkTodos.checked = n > 0 && n === ids.length;
  chkTodos.indeterminate = n > 0 && n < ids.length;
  chkTodos.onchange = () => {
    if (chkTodos.checked) ids.forEach((id) => selecaoTimesStatus.add(id));
    else selecaoTimesStatus.clear();
    renderizarTimesAdmin();
  };
  rotuloTodos.appendChild(chkTodos);
  rotuloTodos.appendChild(document.createTextNode(
    n > 0 ? ` ${n} time(s) selecionado(s)` : ` Selecionar todos (${ids.length})`));
  barra.appendChild(rotuloTodos);

  if (n === 0) {
    const ajuda = document.createElement("span");
    ajuda.className = "pix-ajuda";
    ajuda.textContent = "Marque os times para mudar o status de vários de uma vez.";
    barra.appendChild(ajuda);
    return barra;
  }

  const sel = document.createElement("select");
  sel.className = "select-status";
  sel.innerHTML = '<option value="">Mudar status para…</option>' +
    STATUS_PEDIDO.map((s) => `<option value="${s.id}">${escapeHtmlAdmin(s.label)}</option>`).join("");
  sel.value = statusEmMassa;
  sel.onchange = () => {
    statusEmMassa = sel.value;
    btnAplicar.disabled = !statusEmMassa;
  };
  barra.appendChild(sel);

  const btnAplicar = document.createElement("button");
  btnAplicar.type = "button";
  btnAplicar.className = "primario";
  btnAplicar.textContent = "Aplicar";
  btnAplicar.disabled = !statusEmMassa;
  btnAplicar.onclick = () => aplicarStatusEmMassa();
  barra.appendChild(btnAplicar);

  const btnLimpar = document.createElement("button");
  btnLimpar.type = "button";
  btnLimpar.className = "secundario";
  btnLimpar.textContent = "Limpar seleção";
  btnLimpar.onclick = () => {
    selecaoTimesStatus.clear();
    renderizarTimesAdmin();
  };
  barra.appendChild(btnLimpar);
  return barra;
}

function aplicarStatusEmMassa() {
  const novo = statusEmMassa;
  const ids = [...selecaoTimesStatus].filter((id) => estadoTimes[id]);
  if (!novo || ids.length === 0) return;
  const mudar = ids.filter((id) => statusPedidoDe(estadoTimes[id].time) !== novo);
  if (mudar.length === 0) {
    alert(`Os ${ids.length} time(s) selecionado(s) já estão em "${labelStatus(novo)}".`);
    return;
  }
  const nomes = mudar.map((id) => "• " + estadoTimes[id].time.nome).slice(0, 15).join("\n") +
    (mudar.length > 15 ? `\n… e mais ${mudar.length - 15}` : "");
  if (!confirm(
    `Mudar o status de ${mudar.length} time(s) para "${labelStatus(novo)}"?\n\n${nomes}` +
    (mudar.length < ids.length ? `\n\n(${ids.length - mudar.length} já estão nesse status.)` : "")
  )) return;
  mudar.forEach((id) => atualizarStatusPedido(id, novo));
  selecaoTimesStatus.clear();
  statusEmMassa = "";
  renderizarTimesAdmin();
}

function criarListaDeLinhas(ids, termosBusca) {
  const lista = document.createElement("div");
  lista.className = "lista-times-admin";
  ids.forEach((id) => lista.appendChild(criarLinhaTime(id, termosBusca)));
  return lista;
}

// Uma linha da lista: o nome do time e o representante (com o WhatsApp).
// O status e os avisos entram pequenos, à direita, só como sinalização.
function criarLinhaTime(timeId, termosBusca) {
  const { time, alunos } = estadoTimes[timeId];
  const statusId = statusPedidoDe(time);
  const achado = resultadoBusca(time, alunos, termosBusca);
  const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;
  const nConfirmar = alunos.filter((a) => a.pagamentoDeclarado && !a.pago).length;

  const linha = document.createElement("div");
  linha.className = "linha-time";
  linha.tabIndex = 0;
  linha.setAttribute("role", "button");
  linha.setAttribute("aria-label", "Abrir o time " + time.nome);

  const capa = time.imagemUrl || time.arteUrl || (time.previaCliente && time.previaCliente.cena);
  const avatar = capa
    ? `<img src="${escAttr(capa)}" alt="" loading="lazy" />`
    : `<span>${escapeHtmlAdmin((time.nome || "?").trim().charAt(0).toUpperCase())}</span>`;

  const sinais = [];
  if (achado.alunos.length > 0) sinais.push(`<span class="sinal sinal-busca">🔎 ${achado.alunos.length}</span>`);
  if (nAjustes > 0) sinais.push(`<span class="sinal sinal-ajuste" title="Ajustes solicitados">! ${nAjustes}</span>`);
  if (nConfirmar > 0) sinais.push(`<span class="sinal sinal-pix" title="PIX avisado, a confirmar">PIX ${nConfirmar}</span>`);
  if (timeOcultoNaLoja(time, estadoClientes)) {
    sinais.push(`<span class="sinal sinal-oculto" title="${time.oculto === true ? "Time oculto na loja" : "Cliente oculto na loja"}">${icone("eye-off")}</span>`);
  }

  if (selecaoTimesStatus.has(timeId)) linha.classList.add("selecionada");
  linha.innerHTML = `
    <label class="check-linha-time" title="Selecionar para mudar o status em massa">
      <input type="checkbox" aria-label="Selecionar o time ${escAttr(time.nome)}" ${selecaoTimesStatus.has(timeId) ? "checked" : ""} />
    </label>
    <span class="linha-time-avatar">${avatar}</span>
    <span class="linha-time-texto">
      <span class="linha-time-nome">${escapeHtmlAdmin(time.nome)}</span>
      <span class="linha-time-rep">${representanteCurtoHtml(time)}</span>
    </span>
    <span class="linha-time-sinais">
      ${sinais.join("")}
      <span class="badge ${classeBadgeStatus(statusId)}">${escapeHtmlAdmin(labelStatus(statusId))}</span>
      <span class="linha-time-seta" aria-hidden="true">›</span>
    </span>`;

  // O link do WhatsApp abre a conversa, não o time.
  linha.querySelectorAll("a").forEach((a) => a.addEventListener("click", (ev) => ev.stopPropagation()));
  // A caixa de seleção marca o time para a mudança em massa, sem abri-lo.
  const rotuloChk = linha.querySelector(".check-linha-time");
  rotuloChk.addEventListener("click", (ev) => ev.stopPropagation());
  rotuloChk.addEventListener("keydown", (ev) => ev.stopPropagation());
  rotuloChk.querySelector("input").addEventListener("change", (ev) => {
    if (ev.target.checked) selecaoTimesStatus.add(timeId);
    else selecaoTimesStatus.delete(timeId);
    renderizarTimesAdmin();
  });
  const abrir = () => abrirTimeAdmin(timeId);
  linha.addEventListener("click", abrir);
  linha.addEventListener("keydown", (ev) => {
    if (ev.target === linha && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      abrir();
    }
  });
  return linha;
}

// Representante em uma linha: nome e WhatsApp (link), ou o aviso de que falta.
function representanteCurtoHtml(time) {
  const { nome, telefone } = contatoDoTime(time);
  if (!nome && !telefone) return '<span class="sem-rep">Sem representante</span>';
  const url = linkRepresentante(time);
  const texto = escapeHtmlAdmin(nome || "Representante") +
    (telefone ? ` · ${escapeHtmlAdmin(formatarTelefone(telefone))}` : "");
  return url
    ? `<a href="${escAttr(url)}" target="_blank" rel="noopener" class="link-whats" title="Falar no WhatsApp">${icone("message-circle")} ${texto}</a>`
    : `<span title="Sem um WhatsApp válido (informe com DDD)">${icone("user")} ${texto}</span>`;
}

// ---------------- Time aberto ----------------

function renderizarTimeAberto(timeId) {
  const estado = estadoTimes[timeId];
  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.className = "botao-voltar";
  voltar.innerHTML = icone("arrow-left") + " Todos os times";
  voltar.onclick = voltarParaListaAdmin;

  if (!estado) {
    const aviso = document.createElement("div");
    aviso.className = "card";
    aviso.innerHTML = timesCarregados
      ? "<h2>Time não encontrado</h2><p>Esse time não existe mais (ou foi excluído).</p>"
      : '<p class="pix-ajuda">Carregando o time…</p>';
    elListaTimesAdmin.appendChild(voltar);
    elListaTimesAdmin.appendChild(aviso);
    return;
  }

  const { time, alunos } = estado;
  const statusId = statusPedidoDe(time);

  // Topo: voltar, e o atalho para a página que o cliente vê.
  const topo = document.createElement("div");
  topo.className = "detalhe-topo";
  topo.appendChild(voltar);
  const verPagina = document.createElement("a");
  verPagina.className = "botao-link";
  verPagina.href = "time.html?id=" + encodeURIComponent(timeId);
  verPagina.target = "_blank";
  verPagina.rel = "noopener";
  verPagina.innerHTML = "Ver a página do pedido " + icone("arrow-up-right");
  topo.appendChild(verPagina);
  elListaTimesAdmin.appendChild(topo);

  // Cabeçalho: nome, cliente, representante e o status (sempre à mão).
  const cab = document.createElement("div");
  cab.className = "card detalhe-cabecalho";
  cab.innerHTML = `
    <div class="detalhe-titulo">
      <p class="detalhe-cliente">${escapeHtmlAdmin(nomeClienteDoTime(time))}${
        time.modeloCamiseta ? ` · Modelo: ${escapeHtmlAdmin(time.modeloCamiseta)}` : ""}</p>
      <h2>${escapeHtmlAdmin(time.nome)} <span class="badge ${classeBadgeStatus(statusId)}">${escapeHtmlAdmin(labelStatus(statusId))}</span>${
        timeOcultoNaLoja(time, estadoClientes) ? ` <span class="badge oculto-loja">${icone("eye-off")} Oculto na loja</span>` : ""}${
        precoOculto(time) ? ` <span class="badge oculto-loja">${icone("eye-off")} Preço oculto</span>` : ""}</h2>
      <p class="linha-time-rep">${representanteCurtoHtml(time)}</p>
    </div>`;

  const linhaStatus = document.createElement("label");
  linhaStatus.className = "detalhe-status";
  linhaStatus.textContent = "Status do pedido";
  const selStatus = document.createElement("select");
  selStatus.className = "select-status";
  STATUS_PEDIDO.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.label;
    selStatus.appendChild(o);
  });
  selStatus.value = statusId;
  selStatus.onchange = () => atualizarStatusPedido(timeId, selStatus.value);
  linhaStatus.appendChild(selStatus);
  cab.appendChild(linhaStatus);

  const barra = document.createElement("div");
  renderizarBarraStatus(barra, statusId);
  cab.appendChild(barra);
  cab.querySelectorAll("a").forEach((a) => a.addEventListener("click", (ev) => ev.stopPropagation()));
  elListaTimesAdmin.appendChild(cab);

  // Abas do time.
  const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;
  const faltaProducao = typeof pendenciasProducao === "function" ? pendenciasProducao(time) : [];
  const contadores = {
    lista: `<span class="subaba-qtd">${alunos.length}</span>${nAjustes ? ` <span class="marca-ajuste">!</span>` : ""}`,
    config: rascunhoConfigTime[timeId] ? ' <span class="subaba-ponto" title="Alterações não salvas">●</span>' : "",
    arquivos: faltaProducao.length ? ' <span class="subaba-ponto pendente" title="Faltam arquivos">●</span>' : ' <span class="subaba-ok">✓</span>',
    editarArte: (() => {
      const prod = time.producao || {};
      const contar = (aj) => Object.values(aj || {}).reduce((s, p) => s + Object.keys(p || {}).length, 0);
      const n = contar(prod.layoutAjustes) + contar(prod.goleiro && prod.goleiro.layoutAjustes) +
        Object.keys(prod.individuais || {}).length;
      return n ? `<span class="subaba-qtd" title="Ajustes próprios deste time (comum e goleiro)">${n}</span>` : "";
    })()
  };
  const nav = document.createElement("nav");
  nav.className = "subabas-time";
  nav.setAttribute("role", "tablist");
  ABAS_TIME_ADMIN.forEach((aba) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "subaba-time" + (aba.id === abaTimeAdmin ? " ativa" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", aba.id === abaTimeAdmin ? "true" : "false");
    b.innerHTML = `${escapeHtmlAdmin(aba.label)} ${contadores[aba.id] || ""}`;
    b.onclick = () => trocarAbaTimeAdmin(aba.id);
    nav.appendChild(b);
  });
  elListaTimesAdmin.appendChild(nav);

  if (abaTimeAdmin === "config") renderizarConfigTime(timeId);
  else if (abaTimeAdmin === "arquivos") renderizarArquivosTime(timeId);
  else if (abaTimeAdmin === "editarArte") renderizarEditarArteTime(timeId);
  else renderizarListaDoTime(timeId);
}

// ---------------- Aba Lista ----------------

function renderizarListaDoTime(timeId) {
  const { time, alunos, expandido } = estadoTimes[timeId];
  const card = document.createElement("div");
  card.className = "card";

  const nPagos = alunos.filter((a) => a.pago).length;
  const nConfirmar = alunos.filter((a) => a.pagamentoDeclarado && !a.pago).length;
  const nGoleiros = alunos.filter(ehGoleiro).length;
  const nProfs = alunos.filter(ehProf).length;
  const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;

  const numeros = [
    `<span class="numero-chip"><strong>${alunos.length}</strong> camiseta(s)</span>`,
    `<span class="numero-chip ok"><strong>${nPagos}</strong> paga(s)</span>`,
    `<span class="numero-chip"><strong>${alunos.length - nPagos}</strong> pendente(s)</span>`
  ];
  if (nConfirmar) numeros.push(`<span class="numero-chip alerta"><strong>${nConfirmar}</strong> PIX a confirmar</span>`);
  if (nGoleiros) numeros.push(`<span class="numero-chip">${icone("hand")} <strong>${nGoleiros}</strong> goleiro(s)</span>`);
  if (nProfs) numeros.push(`<span class="numero-chip">${icone("graduation-cap")} <strong>${nProfs}</strong> prof</span>`);
  if (nAjustes) numeros.push(`<span class="numero-chip alerta"><span class="marca-ajuste">!</span> <strong>${nAjustes}</strong> ajuste(s)</span>`);

  const cab = document.createElement("div");
  cab.className = "lista-cabecalho";
  cab.innerHTML = `<div class="numeros-chips">${numeros.join("")}</div>`;

  const acoes = document.createElement("div");
  acoes.className = "lista-acoes";
  const btnAdicionar = document.createElement("button");
  btnAdicionar.className = "primario";
  btnAdicionar.textContent = "+ Adicionar camiseta";
  btnAdicionar.title = "Cadastrar uma camiseta na lista deste time";
  btnAdicionar.onclick = () => abrirNovaCamiseta(timeId);
  acoes.appendChild(btnAdicionar);

  const btnExportar = document.createElement("button");
  btnExportar.className = "secundario";
  btnExportar.textContent = "CSV de produção";
  btnExportar.title = "Só as camisetas pagas, no padrão do programa de impressão";
  btnExportar.onclick = () => exportarProducaoTime(time, alunos);
  acoes.appendChild(btnExportar);

  const btnConferencia = document.createElement("button");
  btnConferencia.className = "secundario";
  btnConferencia.textContent = "CSV de conferência";
  btnConferencia.title = "Lista completa do time, com pagamento";
  btnConferencia.onclick = () => exportarTime(time, alunos);
  acoes.appendChild(btnConferencia);
  cab.appendChild(acoes);
  card.appendChild(cab);

  // Com o pagamento do 1º lote encerrado, o que conta é o que entra na produção.
  if (pedidoEmProducao(time)) {
    const p = document.createElement("p");
    p.className = "linha-producao";
    p.innerHTML = `<strong>${nPagos} em produção</strong> &middot; ${alunos.length - nPagos} em aberto (não paga(s))`;
    card.appendChild(p);
  }

  if (alunos.length === 0) {
    const vazio = document.createElement("div");
    vazio.className = "vazio-lista";
    vazio.innerHTML = "<p>Nenhuma camiseta na lista ainda.</p>" +
      '<p class="pix-ajuda">Use <strong>+ Adicionar camiseta</strong> ou envie ao representante o link e a senha (aba <strong>Configuração</strong>).</p>';
    card.appendChild(vazio);
    elListaTimesAdmin.appendChild(card);
    return;
  }

  // O que a busca do topo achou neste time: por padrão, só essas camisetas.
  const achado = resultadoBusca(time, alunos, buscaTermos());
  const idsAchados = new Set(achado.alunos.map((a) => a.id));
  const soResultados = idsAchados.size > 0 && !expandido;
  if (idsAchados.size > 0) {
    const nota = document.createElement("p");
    nota.className = "busca-nota";
    nota.innerHTML = soResultados
      ? `🔎 Mostrando <strong>${idsAchados.size}</strong> de ${alunos.length} camiseta(s) — as que combinam com a busca. `
      : `🔎 ${idsAchados.size} camiseta(s) combinam com a busca (em destaque). `;
    const alternar = document.createElement("button");
    alternar.type = "button";
    alternar.className = "link-inline";
    alternar.textContent = soResultados ? "Ver lista completa" : "Mostrar só os resultados";
    alternar.onclick = () => {
      estadoTimes[timeId].expandido = soResultados;
      renderizarTimesAdmin();
    };
    nota.appendChild(alternar);
    card.appendChild(nota);
  }

  const tabela = document.createElement("table");
  tabela.className = "tabela-responsiva";
  tabela.innerHTML = `
    <thead>
      <tr><th>Nome</th><th>Tamanho</th><th>Número</th><th>Nome na camiseta</th><th>Goleiro</th><th>Prof</th><th>Pagamento</th><th>Ações</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabela.querySelector("tbody");
  const alunosDaTabela = soResultados ? achado.alunos : alunos;
  // Mesmo agrupamento da página do time: em aberto em cima, lotes embaixo.
  preencherListaAgrupada(tbody, alunosDaTabela, {
    colunas: 8,
    ajudaAberto: "Ainda não entraram em nenhum lote de produção.",
    criarLinha: (aluno) => criarLinhaAlunoAdmin(timeId, time, aluno, idsAchados)
  });

  const rolagem = document.createElement("div");
  rolagem.className = "tabela-rolagem";
  rolagem.appendChild(tabela);
  card.appendChild(rolagem);
  elListaTimesAdmin.appendChild(card);
}

// Uma linha da lista do time no Super Admin.
function criarLinhaAlunoAdmin(timeId, time, aluno, idsAchados) {
  const tr = document.createElement("tr");
  if (aluno.ajusteSolicitado) tr.classList.add("linha-ajuste");
  // Realce de quem a busca achou (útil na lista completa do time).
  if (idsAchados.has(aluno.id)) tr.classList.add("linha-busca");

  const marca = aluno.ajusteSolicitado
    ? '<span class="marca-ajuste" title="Ajuste solicitado">!</span> '
    : "";
  // Proposta guiada (de → para). Para ajustes antigos (só texto), mostra o motivo.
  const proposta = propostaAjusteHtml(aluno);
  const motivo = (aluno.ajusteSolicitado && !aluno.ajusteProposto && aluno.ajusteMotivo)
    ? `<br><small class="motivo-ajuste">Ajuste pedido: ${escapeHtmlAdmin(aluno.ajusteMotivo)}</small>`
    : "";

  tr.innerHTML = `
    <td data-label="Nome">${marca}${escapeHtmlAdmin(aluno.nome)}${typeof temArteIndividual === "function" && temArteIndividual(time, aluno.id)
      ? ' <span class="badge selo-do-time" title="Esta camiseta tem arte própria (aba Editar arte → Uma camiseta)">arte própria</span>' : ""}${proposta}${motivo}${historicoAjusteHtml(aluno)}</td>
    <td data-label="Tamanho">${escapeHtmlAdmin(aluno.tamanho)}</td>
    <td data-label="Número">${escapeHtmlAdmin(aluno.numero || "-")}</td>
    <td data-label="Nome na camiseta">${escapeHtmlAdmin(aluno.nomeCamiseta || "-")}</td>
    <td data-label="Goleiro" class="cel-goleiro"></td>
    <td data-label="Prof" class="cel-prof"></td>
    <td data-label="Pagamento" class="cel-pagamento"></td>
    <td data-label="" class="acoes-linha"></td>
  `;

  // Goleiro: camiseta de cor especial. O Super Admin marca e desmarca
  // num clique, mesmo com a lista já fechada para o representante.
  preencherCelulaGoleiroAdmin(tr.querySelector(".cel-goleiro"), timeId, aluno);
  // Prof: camiseta de professor, marca só para organização.
  preencherCelulaProfAdmin(tr.querySelector(".cel-prof"), timeId, aluno);

  // Coluna de pagamento: badge + seletor para registrar o pagamento.
  const tdPag = tr.querySelector(".cel-pagamento");
  tdPag.innerHTML = badgePagamentoHtml(aluno);
  const selPag = document.createElement("select");
  selPag.className = "select-pagamento";
  selPag.setAttribute("aria-label", "Registrar pagamento de " + aluno.nome);
  selPag.innerHTML =
    '<option value="pendente">Pendente</option>' +
    '<option value="pix">Pago (PIX)</option>' +
    '<option value="dinheiro">Pago (dinheiro)</option>' +
    '<option value="interno">Interno (só custo)</option>';
  selPag.value = aluno.pago ? (aluno.pagamentoForma || "pix") : "pendente";
  selPag.onchange = () => atualizarPagamento(timeId, aluno.id, selPag.value);
  tdPag.appendChild(selPag);

  // Preço especial desta camiseta: preenchido, ela é vendida por este valor
  // (no pagamento, no Financeiro e no DRE). Em branco, vale o preço do tamanho.
  if (!ehInterno(aluno)) {
    const especial = precoEspecialDoAluno(configGeralAtual, timeId, aluno.id);
    const normal = precoDoTamanhoNoTime(aluno.tamanho, configGeralAtual, timeId);
    const lbl = document.createElement("label");
    lbl.className = "preco-aluno" + (especial != null ? " ativo" : "");
    lbl.title = "Preço especial desta camiseta. Em branco = preço do tamanho.";
    lbl.innerHTML = '<span>R$</span>';
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.min = "0";
    inp.inputMode = "decimal";
    inp.placeholder = normal != null ? Number(normal).toFixed(2) : "preço";
    inp.value = especial != null ? especial : "";
    inp.setAttribute("aria-label", "Preço especial da camiseta de " + aluno.nome);
    inp.disabled = precosAdminErro;
    if (precosAdminErro) lbl.title = "Publique o firestore.rules atualizado para usar o preço especial.";
    inp.onchange = async () => {
      const bruto = inp.value.trim().replace(",", ".");
      const v = bruto === "" ? null : Math.round(parseFloat(bruto) * 100) / 100;
      if (v != null && (isNaN(v) || v < 0)) {
        alert("Informe um valor válido (0 ou mais) ou deixe em branco.");
        inp.value = especial != null ? especial : "";
        return;
      }
      if ((v == null && especial == null) || v === especial) return;
      if (aluno.pago && !confirm(`Esta camiseta já está paga. Mudar o valor dela para ${v == null ? "o preço do tamanho" : formatarReais(v)} altera o recebido e o lucro no Financeiro. Continuar?`)) {
        inp.value = especial != null ? especial : "";
        return;
      }
      inp.disabled = true;
      try {
        await gravarPrecoAluno(timeId, aluno.id, v);
      } catch (erro) {
        console.error(erro);
        inp.disabled = false;
        alert("Erro ao salvar o preço especial. Confira se o firestore.rules atualizado foi publicado.");
      }
    };
    lbl.appendChild(inp);
    tdPag.appendChild(lbl);
  }
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
  btnEditar.onclick = () => editarAlunoAdmin(tr, timeId, aluno);
  tdAcoes.appendChild(btnEditar);

  // Arte só desta camiseta (um logo a mais, um elemento diferente…).
  if (typeof abrirArteDaCamiseta === "function") {
    const btnArte = document.createElement("button");
    btnArte.className = "secundario";
    btnArte.textContent = "Arte";
    btnArte.title = "Arte só desta camiseta: um logo a mais, um elemento diferente…";
    btnArte.onclick = () => abrirArteDaCamiseta(timeId, aluno.id);
    tdAcoes.appendChild(btnArte);
  }

  if (aluno.ajusteSolicitado) {
    // Aplicar: grava a correção sugerida e resolve (só o "OK" do usuário).
    if (aluno.ajusteProposto) {
      const btnAplicar = document.createElement("button");
      btnAplicar.className = "sucesso";
      btnAplicar.textContent = "Aplicar ajuste";
      btnAplicar.title = "Aplicar a correção sugerida e resolver";
      btnAplicar.onclick = () => aplicarAjuste(timeId, aluno);
      tdAcoes.appendChild(btnAplicar);
    }

    const btnResolver = document.createElement("button");
    btnResolver.className = "secundario";
    btnResolver.textContent = aluno.ajusteProposto ? "Dispensar" : "Resolver";
    btnResolver.title = "Marcar como resolvido sem aplicar a sugestão";
    btnResolver.onclick = () => {
      db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({
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
        `Olá! ✅ O ajuste da camiseta de ${aluno.nome} (time ${time.nome}) foi aprovado e aplicado. ` +
        `O pedido já está disponível para pagamento. 👕`;
      const url = linkWhatsapp(aluno.ajusteContato, texto);
      if (!url) {
        alert("O contato informado não é um telefone válido para o WhatsApp.");
        return;
      }
      window.open(url, "_blank");
      // Marca como avisado e remove o contato para o botão sumir.
      db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({
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
      db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({ excluido: true });
    }
  };
  tdAcoes.appendChild(btnExcluir);
  return tr;
}

// ---------------- Aba Configuração ----------------
// Representante (contato e senha), data limite, dados do time e a tabela
// especial de preço. Os campos guardam um rascunho enquanto se digita, para
// uma atualização que chega do Firestore não apagar o que ainda não foi salvo.

const CAMPOS_CONFIG_TIME = ["nome", "clienteId", "modeloCamiseta", "representanteNome", "representanteTelefone", "senha", "dataLimite"];

function valorConfigTime(timeId, campo) {
  const r = rascunhoConfigTime[timeId];
  if (r && r[campo] !== undefined) return r[campo];
  const t = estadoTimes[timeId].time;
  if (campo === "clienteId") return clienteIdDoTime(t);
  if (campo === "representanteNome") return contatoDoTime(t).nome;
  if (campo === "representanteTelefone") return contatoDoTime(t).telefone;
  return t[campo] || "";
}

// Endereço completo da página do pedido (para mandar ao representante).
function urlPaginaDoTime(timeId) {
  try {
    return new URL("time.html?id=" + encodeURIComponent(timeId), window.location.href).href;
  } catch (e) {
    return "time.html?id=" + encodeURIComponent(timeId);
  }
}

function renderizarConfigTime(timeId) {
  const { time } = estadoTimes[timeId];
  const v = (campo) => escAttr(valorConfigTime(timeId, campo));
  const temRascunho = !!rascunhoConfigTime[timeId];

  const card = document.createElement("div");
  card.className = "card config-time";
  card.innerHTML = `
    <form class="form-config-time" novalidate>
      <fieldset>
        <legend>Representante</legend>
        <p class="pix-ajuda">Quem responde pelo pedido. Na página do pedido, ele entra pela ⚙️ (canto superior direito) com a senha abaixo para cadastrar nomes e definir a data limite.</p>
        <div class="grade-2">
          <label>Nome<input type="text" data-campo="representanteNome" value="${v("representanteNome")}" placeholder="Ex: Ana Souza" /></label>
          <label>WhatsApp<input type="tel" inputmode="tel" data-campo="representanteTelefone" value="${v("representanteTelefone")}" placeholder="Ex: (11) 91234-5678" /></label>
        </div>
        <label>Senha do time<input type="text" data-campo="senha" value="${v("senha")}" autocomplete="off" required /></label>
        <div class="config-atalhos">
          <button type="button" class="secundario" data-acao="copiar">Copiar link do pedido</button>
          <button type="button" class="sucesso" data-acao="enviar">Enviar link e senha no WhatsApp</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Pagamento</legend>
        <label>Data limite para pagamento<input type="date" data-campo="dataLimite" value="${v("dataLimite")}" /></label>
        <p class="pix-ajuda">Ao passar a data, o pedido <strong>Aberto</strong> fecha sozinho. Em branco, fica aberto até você mudar o status.</p>
      </fieldset>

      <fieldset>
        <legend>Time</legend>
        <label>Nome do time<input type="text" data-campo="nome" value="${v("nome")}" required /></label>
        <div class="grade-2">
          <label>Cliente<select data-campo="clienteId"><option value="">Sem cliente</option>${
            clientesOrdenados().map((c) => `<option value="${escAttr(c.id)}">${escapeHtmlAdmin(c.nome || c.id)}</option>`).join("")
          }</select></label>
          <label>Modelo da camiseta (arte)<input type="text" data-campo="modeloCamiseta" value="${v("modeloCamiseta")}" placeholder="Em branco = &quot;${escAttr(time.nome)}&quot;" /></label>
        </div>
        <p class="pix-ajuda">O modelo separa os CSVs da aba Produção por arte: repita o mesmo nome em times que usam a mesma arte.</p>
      </fieldset>

      <div class="config-salvar${temRascunho ? " com-rascunho" : ""}">
        <span class="pix-ajuda">${temRascunho ? "Alterações ainda não salvas." : "Tudo salvo."}</span>
        <span>
          ${temRascunho ? '<button type="button" class="secundario" data-acao="descartar">Descartar</button>' : ""}
          <button type="submit" class="primario">Salvar configuração</button>
        </span>
      </div>
      <p class="msg-config oculto"></p>
    </form>`;

  const form = card.querySelector("form");
  const sel = form.querySelector('[data-campo="clienteId"]');
  sel.value = valorConfigTime(timeId, "clienteId");

  const msg = form.querySelector(".msg-config");
  const marcarRascunho = () => {
    const box = form.querySelector(".config-salvar");
    box.classList.add("com-rascunho");
    box.querySelector(".pix-ajuda").textContent = "Alterações ainda não salvas.";
  };
  form.querySelectorAll("[data-campo]").forEach((el) => {
    const evento = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(evento, () => {
      rascunhoConfigTime[timeId] = rascunhoConfigTime[timeId] || {};
      rascunhoConfigTime[timeId][el.dataset.campo] = el.value;
      marcarRascunho();
    });
  });

  form.querySelector('[data-acao="copiar"]').onclick = async (ev) => {
    const url = urlPaginaDoTime(timeId);
    try {
      await navigator.clipboard.writeText(url);
      ev.target.textContent = "Link copiado ✓";
    } catch (e) {
      prompt("Copie o link do pedido:", url);
    }
  };
  form.querySelector('[data-acao="enviar"]').onclick = () => {
    const nome = valorConfigTime(timeId, "representanteNome");
    const tel = valorConfigTime(timeId, "representanteTelefone");
    const texto =
      `Olá${nome ? ", " + nome.split(" ")[0] : ""}! Aqui está o pedido de camisetas do time ${valorConfigTime(timeId, "nome")}:\n` +
      `${urlPaginaDoTime(timeId)}\n\n` +
      `Para cadastrar os nomes, toque na engrenagem ⚙️ no canto da página e use a senha: ${valorConfigTime(timeId, "senha")}`;
    const url = linkWhatsapp(tel, texto);
    if (!url) {
      alert("Informe um WhatsApp válido (com DDD) para o representante.");
      return;
    }
    window.open(url, "_blank");
  };
  const btnDescartar = form.querySelector('[data-acao="descartar"]');
  if (btnDescartar) {
    btnDescartar.onclick = () => {
      delete rascunhoConfigTime[timeId];
      renderizarTimesAdmin();
    };
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = {};
    CAMPOS_CONFIG_TIME.forEach((c) => (dados[c] = String(valorConfigTime(timeId, c) || "").trim()));
    if (!dados.nome || !dados.senha) {
      mostrarMensagem(msg, "Preencha o nome e a senha do time.", "erro");
      return;
    }
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await db.collection(COL_TIMES).doc(timeId).update({
        nome: dados.nome,
        senha: dados.senha,
        clienteId: dados.clienteId,
        representanteNome: dados.representanteNome,
        representanteTelefone: dados.representanteTelefone,
        modeloCamiseta: dados.modeloCamiseta || firebase.firestore.FieldValue.delete(),
        dataLimite: dados.dataLimite || firebase.firestore.FieldValue.delete()
      });
      delete rascunhoConfigTime[timeId];
      renderizarTimesAdmin();
      const novo = elListaTimesAdmin.querySelector(".msg-config");
      if (novo) mostrarMensagem(novo, "Configuração salva.", "aviso");
    } catch (erro) {
      console.error(erro);
      botao.disabled = false;
      mostrarMensagem(msg, "Erro ao salvar. Tente novamente.", "erro");
    }
  });
  elListaTimesAdmin.appendChild(card);

  // Tabela especial de preço (sobrepõe a tabela geral, grupo a grupo).
  const cardPrecos = document.createElement("div");
  cardPrecos.className = "card";
  cardPrecos.innerHTML = '<h3 class="titulo-bloco">Tabela especial de preço</h3>';
  const blocoPrecos = criarBlocoPrecosTime(timeId);
  blocoPrecos.open = true;
  blocoPrecos.classList.add("fixo");
  cardPrecos.appendChild(blocoPrecos);
  elListaTimesAdmin.appendChild(cardPrecos);

  // Visibilidade na loja (vale na hora, fora do rascunho da configuração).
  const clienteOculto = !!(estadoClientes[clienteIdDoTime(time)] && estadoClientes[clienteIdDoTime(time)].oculto === true);
  const cardVisivel = document.createElement("div");
  cardVisivel.className = "card";
  cardVisivel.innerHTML = '<h3 class="titulo-bloco">Visibilidade para o cliente</h3>' +
    `<p class="pix-ajuda">${time.oculto === true
      ? "Este time está <strong>oculto</strong>: não aparece na loja (index.html). O link direto do pedido continua funcionando."
      : "Este time aparece na loja (index.html). Ocultando, ele some da loja, mas o link direto do pedido continua funcionando."}${
      clienteOculto ? " <strong>O cliente deste time está oculto</strong>, então ele já não aparece na loja (aba Clientes)." : ""}</p>`;
  const btnOcultar = document.createElement("button");
  btnOcultar.type = "button";
  btnOcultar.className = "secundario";
  btnOcultar.innerHTML = time.oculto === true
    ? icone("eye") + " Mostrar na loja"
    : icone("eye-off") + " Ocultar da loja";
  btnOcultar.onclick = async () => {
    btnOcultar.disabled = true;
    try {
      await db.collection(COL_TIMES).doc(timeId).update({ oculto: time.oculto !== true });
    } catch (erro) {
      console.error(erro);
      btnOcultar.disabled = false;
      alert("Erro ao salvar. Tente novamente.");
    }
  };
  cardVisivel.appendChild(btnOcultar);

  // Preço oculto: o pedido continua na loja, só sem mostrar o valor.
  const pPreco = document.createElement("p");
  pPreco.className = "pix-ajuda";
  pPreco.innerHTML = precoOculto(time)
    ? "O <strong>preço está oculto</strong>: a loja e a página do pedido não mostram o valor da camiseta. O pagamento continua funcionando — o valor aparece só na hora de pagar (no PIX)."
    : "O preço aparece na loja e na página do pedido. Ocultando, o pedido continua visível, mas sem o valor da camiseta (ele só aparece na hora de pagar).";
  cardVisivel.appendChild(pPreco);
  const btnPreco = document.createElement("button");
  btnPreco.type = "button";
  btnPreco.className = "secundario";
  btnPreco.innerHTML = precoOculto(time)
    ? icone("eye") + " Mostrar o preço"
    : icone("eye-off") + " Ocultar o preço";
  btnPreco.onclick = async () => {
    btnPreco.disabled = true;
    try {
      await db.collection(COL_TIMES).doc(timeId).update({ ocultarPreco: !precoOculto(time) });
    } catch (erro) {
      console.error(erro);
      btnPreco.disabled = false;
      alert("Erro ao salvar. Tente novamente.");
    }
  };
  cardVisivel.appendChild(btnPreco);
  elListaTimesAdmin.appendChild(cardVisivel);

  // Zona de perigo.
  const cardPerigo = document.createElement("div");
  cardPerigo.className = "card zona-perigo";
  cardPerigo.innerHTML = '<h3 class="titulo-bloco">Excluir time</h3><p class="pix-ajuda">Apaga o time e todas as camisetas cadastradas nele. Não dá para desfazer.</p>';
  const btnExcluir = document.createElement("button");
  btnExcluir.className = "perigo";
  btnExcluir.textContent = "Excluir este time";
  btnExcluir.onclick = () => excluirTime(timeId, time);
  cardPerigo.appendChild(btnExcluir);
  elListaTimesAdmin.appendChild(cardPerigo);
}

// ---------------- Aba Editar arte ----------------
// O editor de layout (js/artes.js) travado neste time: o que mudar aqui vale
// só para ele; o resto segue o layout geral da aba Artes.

function renderizarEditarArteTime(timeId) {
  const card = document.createElement("div");
  card.className = "card tema-escuro";
  card.innerHTML = '<h3 class="titulo-bloco">Editar arte deste time</h3>' +
    '<p class="pix-ajuda">Clique num elemento (no desenho ou na lista) para mudar a posição, a letra, as cores ou ocultá-lo — só neste time. ' +
    'A folha EPS, a prévia e o mockup já saem com estes ajustes.</p>';
  // Camiseta comum ou a do goleiro (o mesmo seletor da aba Arquivos).
  if (typeof criarSeletorVariante === "function") card.appendChild(criarSeletorVariante(timeId, true));
  const host = document.createElement("div");
  host.className = "editor-layout-pedido";
  card.appendChild(host);
  elListaTimesAdmin.appendChild(card);
  if (typeof montarEditorLayout === "function") montarEditorLayout(host, timeId);
  else host.innerHTML = '<p class="pix-ajuda">Editor indisponível.</p>';
}

// ---------------- Aba Arquivos de produção ----------------

function renderizarArquivosTime(timeId) {
  const { time } = estadoTimes[timeId];

  // Arquivos da folha EPS: arte de cada peça (PNG 600 dpi), brasão e fonte.
  if (typeof criarBlocoProducaoTime === "function") {
    const card = document.createElement("div");
    card.className = "card tema-escuro";
    card.innerHTML = '<h3 class="titulo-bloco">Arquivos para impressão</h3>' +
      '<p class="pix-ajuda">Clique num espaço ou arraste o arquivo para cima dele. Arquivos grandes vão ao Drive em partes.</p>';
    // Camiseta comum ou a do goleiro: o que o goleiro não tiver usa o da comum.
    if (typeof criarSeletorVariante === "function") card.appendChild(criarSeletorVariante(timeId));
    const bloco = criarBlocoProducaoTime(timeId, time);
    bloco.open = true;
    bloco.classList.add("fixo");
    card.appendChild(bloco);
    elListaTimesAdmin.appendChild(card);
  }

  // Prévia montada com os arquivos acima: a arte plana e no mockup.
  if (typeof criarPreviaArteTime === "function") {
    const card = document.createElement("div");
    card.className = "card tema-escuro";
    const golPrevia = typeof editandoGoleiro === "function" && editandoGoleiro(timeId);
    card.innerHTML = `<h3 class="titulo-bloco">Prévia da arte${golPrevia ? " — " + icone("hand") + " goleiro" : ""}</h3>`;
    card.appendChild(criarPreviaArteTime(timeId, time));
    elListaTimesAdmin.appendChild(card);
  }

  // Imagens que o cliente vê na loja e na página do pedido.
  const cardImagens = document.createElement("div");
  cardImagens.className = "card tema-escuro";
  cardImagens.innerHTML = '<h3 class="titulo-bloco">Imagens da página do pedido</h3>' +
    '<p class="pix-ajuda">É o que o cliente vê na loja e no topo da página do pedido: a simulação na camiseta (mockup) e a arte sem simulação.</p>';
  cardImagens.appendChild(criarBlocoImagemTime(timeId, time));
  elListaTimesAdmin.appendChild(cardImagens);
}

// Atualiza o status do pedido de um time (usado no seletor da aba Inicial
// e ao arrastar cards no Kanban). Mantém `fechado` em sincronia com o status.
function atualizarStatusPedido(timeId, novo) {
  const dados = { statusPedido: novo, fechado: novo !== "aberto" };
  if (novo !== "aberto") dados.fechadoEm = firebase.firestore.FieldValue.serverTimestamp();
  // Atualiza o estado local na hora para o Kanban reagir sem esperar o snapshot.
  if (estadoTimes[timeId]) {
    estadoTimes[timeId].time.statusPedido = novo;
    estadoTimes[timeId].time.fechado = novo !== "aberto";
  }
  db.collection(COL_TIMES).doc(timeId).update(dados)
    .catch((e) => console.error("Falha ao mudar status do pedido:", e));
}

// Aplica a correção sugerida no pedido de ajuste (grava os campos propostos)
// e resolve o ajuste, registrando no histórico. É o "OK" do administrador.
function aplicarAjuste(timeId, aluno) {
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
  db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update(dados)
    .catch((e) => {
      console.error(e);
      alert("Não foi possível aplicar o ajuste. Tente novamente.");
    });
}

// ---------------- Kanban de pedidos ----------------

// Time sendo arrastada no momento (evita re-render que quebraria o arraste).
let kanbanArrastandoId = null;

function renderizarKanban() {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;
  // Não redesenha durante um arraste para não remover o card em movimento.
  if (kanbanArrastandoId) return;

  board.innerHTML = "";

  const ids = timesDosPedidos().map(([id]) => id);
  if (ids.length === 0) {
    board.innerHTML = buscaAtiva()
      ? `<p>Nenhum pedido encontrado para <strong>${escapeHtmlAdmin(buscaFiltro.trim())}</strong>.</p>`
      : clienteFiltro
        ? "<p>Nenhum pedido para o cliente escolhido.</p>"
        : "<p>Nenhum pedido (time) cadastrado ainda.</p>";
    return;
  }

  // Agrupa os times por status.
  const porStatus = {};
  STATUS_PEDIDO.forEach((s) => (porStatus[s.id] = []));
  ids.forEach((timeId) => {
    const st = statusPedidoDe(estadoTimes[timeId].time);
    // Status desconhecido cai na primeira etapa para não sumir do quadro.
    (porStatus[st] || porStatus[STATUS_PEDIDO[0].id]).push(timeId);
  });

  STATUS_PEDIDO.forEach((etapa) => {
    const coluna = document.createElement("div");
    coluna.className = "kanban-coluna";
    coluna.dataset.status = etapa.id;

    const timesDaColuna = porStatus[etapa.id] || [];

    const titulo = document.createElement("div");
    titulo.className = "kanban-coluna-titulo";
    titulo.innerHTML =
      `<span>${escapeHtmlAdmin(etapa.label)}</span>` +
      `<span class="kanban-contador">${timesDaColuna.length}</span>`;
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
      const timeId = ev.dataTransfer.getData("text/plain") || kanbanArrastandoId;
      if (timeId && estadoTimes[timeId] &&
          statusPedidoDe(estadoTimes[timeId].time) !== etapa.id) {
        atualizarStatusPedido(timeId, etapa.id);
      }
      kanbanArrastandoId = null;
      renderizarKanban();
    });

    // Finalizados são o arquivo: a coluna só recebe cards (arraste um pedido
    // para cá para arquivá-lo) e mostra quantos há, sem listar cada um.
    if (etapa.id === "finalizado") {
      coluna.classList.add("kanban-coluna-arquivo");
      const aviso = document.createElement("p");
      aviso.className = "kanban-vazio";
      aviso.innerHTML = icone("archive") + (timesDaColuna.length > 0
        ? ` ${timesDaColuna.length} arquivado(s) — veja na aba Inicial`
        : " Solte aqui para arquivar");
      listaCards.appendChild(aviso);
      coluna.appendChild(listaCards);
      board.appendChild(coluna);
      return;
    }

    timesDaColuna
      .sort((a, b) =>
        estadoTimes[a].time.nome.localeCompare(estadoTimes[b].time.nome, "pt-BR")
      )
      .forEach((timeId) => listaCards.appendChild(criarCardKanban(timeId, etapa.id)));

    if (timesDaColuna.length === 0) {
      const vazio = document.createElement("p");
      vazio.className = "kanban-vazio";
      vazio.textContent = "—";
      listaCards.appendChild(vazio);
    }

    coluna.appendChild(listaCards);
    board.appendChild(coluna);
  });
}

function criarCardKanban(timeId, statusId) {
  const { time, alunos } = estadoTimes[timeId];

  const card = document.createElement("div");
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.timeId = timeId;

  card.addEventListener("dragstart", (ev) => {
    kanbanArrastandoId = timeId;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", timeId);
    card.classList.add("kanban-card-arrastando");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("kanban-card-arrastando");
    kanbanArrastandoId = null;
    renderizarKanban();
  });

  const nPagos = alunos.filter((a) => a.pago).length;
  const nAjustes = alunos.filter((a) => a.ajusteSolicitado).length;

  const nome = document.createElement("button");
  nome.type = "button";
  nome.className = "kanban-card-nome";
  nome.textContent = time.nome;
  nome.title = "Abrir o time";
  nome.onclick = () => abrirTimeAdmin(timeId);
  nome.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  card.appendChild(nome);

  // Sem filtro de cliente o quadro mistura todo mundo, então o card diz de quem é.
  if (!clienteFiltro) {
    const cli = document.createElement("div");
    cli.className = "kanban-card-cliente";
    cli.textContent = nomeClienteDoTime(time);
    card.appendChild(cli);
  }

  const info = document.createElement("div");
  info.className = "kanban-card-info";
  info.textContent =
    `${alunos.length} camiseta(s) · ${nPagos} paga(s)` +
    (alunos.length - nPagos > 0 ? `, ${alunos.length - nPagos} pendente(s)` : "");
  card.appendChild(info);

  // Falar com o representante sem sair do quadro: é aqui que a gente cobra
  // o andamento do pedido.
  const urlWhats = linkRepresentante(time);
  if (urlWhats) {
    const link = document.createElement("a");
    link.className = "kanban-card-whats";
    link.href = urlWhats;
    link.target = "_blank";
    link.rel = "noopener";
    const contato = contatoDoTime(time);
    link.innerHTML = icone("message-circle") + " " + escapeHtmlAdmin(contato.nome || formatarTelefone(contato.telefone));
    link.title = "Falar no WhatsApp com o representante do time";
    // O card é arrastável: sem isso, clicar no link viraria um arraste.
    link.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    link.addEventListener("dragstart", (ev) => ev.preventDefault());
    card.appendChild(link);
  }

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
    atualizarStatusPedido(timeId, sel.value);
    renderizarKanban();
  };
  // Evita iniciar o arraste do card ao interagir com o seletor.
  sel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  card.appendChild(sel);

  return card;
}

// Atualiza o status de pagamento de um aluno (usado no seletor por linha).
// Marcar na mão apaga a taxa do Mercado Pago que porventura estivesse gravada:
// ela vale para o pagamento online que o webhook confirmou, não para o que o
// admin está registrando agora.
function atualizarPagamento(timeId, alunoId, valor) {
  const ref = db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(alunoId);
  const apagar = firebase.firestore.FieldValue.delete();
  const semTaxa = {
    pagamentoBruto: apagar,
    pagamentoTaxa: apagar,
    pagamentoLiquido: apagar
  };
  if (valor === "pendente") {
    ref.update({ pago: false, pagamentoForma: "", pagamentoDeclarado: false, ...semTaxa });
  } else {
    ref.update({
      pago: true,
      pagamentoForma: valor, // "pix" ou "dinheiro"
      pagamentoDeclarado: false,
      ...semTaxa,
      pagamentoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// Resumo geral de pagamentos (aba Pagamentos).
function renderizarResumoPagamentos() {
  const el = document.getElementById("resumoPagamentos");
  if (!el) return;

  let total = 0, pagos = 0, aguardando = 0, goleiros = 0, profs = 0;
  timesFiltrados().forEach(([, { alunos }]) => {
    alunos.forEach((a) => {
      total++;
      if (a.pago) pagos++;
      else if (a.pagamentoDeclarado) aguardando++;
      if (ehGoleiro(a)) goleiros++;
      if (ehProf(a)) profs++;
    });
  });
  const pendentes = total - pagos - aguardando;
  // Quantas camisetas saem na cor de goleiro (só aparece quando há alguma).
  const marcaGoleiros = goleiros > 0
    ? `<span class="badge goleiro" title="Camiseta de cor especial">${icone("hand")} Goleiros: ${goleiros}</span>`
    : "";
  const marcaProfs = profs > 0
    ? `<span class="badge prof" title="Camisetas de professor">${icone("graduation-cap")} Prof: ${profs}</span>`
    : "";

  el.innerHTML = `
    <div class="resumo-tamanhos">
      <span><strong>Total: ${total}</strong></span>
      <span class="badge pago">Pagos: ${pagos}</span>
      <span class="badge aguardando">Aguardando: ${aguardando}</span>
      <span class="badge pendente">Pendentes: ${pendentes}</span>
      ${marcaGoleiros}
      ${marcaProfs}
    </div>
  `;

  renderizarResumoPrecosTimes();
}

// Lista os times que têm um preço próprio para um grupo de tamanho.
function timesComPrecoProprio(nomeGrupo) {
  return Object.entries(mapaPrecosPorTime(configGeralAtual))
    .filter(([, mapa]) => mapa && mapa[nomeGrupo] != null && !isNaN(Number(mapa[nomeGrupo])))
    .map(([id, mapa]) => ({
      timeId: id,
      nome: (estadoTimes[id] && estadoTimes[id].time.nome) || id,
      valor: Number(mapa[nomeGrupo])
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Tabela (aba Pagamentos) com o preço que vale em cada time, por grupo.
// Quem não tem preço próprio aparece com o valor geral, em cinza.
function renderizarResumoPrecosTimes() {
  const el = document.getElementById("precosTimesResumo");
  if (!el) return;

  const ids = Object.keys(estadoTimes).sort((a, b) =>
    estadoTimes[a].time.nome.localeCompare(estadoTimes[b].time.nome, "pt-BR")
  );

  if (ids.length === 0 || GRUPOS_TAMANHO.length === 0) {
    el.innerHTML = "<p>Cadastre times e tamanhos para ver os preços aqui.</p>";
    return;
  }

  const cabecalho = GRUPOS_TAMANHO.map((g) => `<th>${escapeHtmlAdmin(g.grupo)}</th>`).join("");

  const linhas = ids.map((id) => {
    const proprios = precosPersonalizadosDoTime(configGeralAtual, id);
    const efetivos = precosDoTime(configGeralAtual, id);
    const clienteId = clienteIdDoTime(estadoTimes[id].time);
    const doCliente = precosPersonalizadosDoCliente(configGeralAtual, clienteId);
    const celulas = GRUPOS_TAMANHO.map((g) => {
      const valor = efetivos[g.grupo];
      if (valor == null) return '<td class="fin-sub">—</td>';
      const proprio = proprios[g.grupo] != null || doCliente[g.grupo] != null;
      return `<td class="${proprio ? "preco-proprio" : "fin-sub"}">${formatarReais(valor)}</td>`;
    }).join("");
    const marca = (Object.keys(proprios).length > 0 ? ' <span class="badge interno">próprio</span>' : "") +
      (Object.keys(doCliente).length > 0 ? ' <span class="badge aguardando">do cliente</span>' : "");
    return `<tr><td>${escapeHtmlAdmin(estadoTimes[id].time.nome)}${marca}</td>${celulas}</tr>`;
  }).join("");

  el.innerHTML = `
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Time</th>${cabecalho}</tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <p class="pix-ajuda">Em destaque, os preços especiais (do cliente ou do próprio time); em cinza, os da tabela geral. Para mudar: aba <strong>Clientes</strong> → tabela de preço do cliente, ou abra o time (aba Inicial) → Configuração → Tabela especial de preço.</p>
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
  { id: "juntar", label: "Juntar cobrança" },
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
let finTimeFiltro = "";     // "" = todos os times
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

// Taxa do Mercado Pago cobrada nesta camiseta. Vem do webhook (só nos
// pagamentos online); no dinheiro e no PIX marcado na mão não existe taxa.
function taxaMpDoAluno(a) {
  const taxa = Number(a.pagamentoTaxa);
  return isNaN(taxa) || taxa < 0 ? 0 : taxa;
}

// Percorre os times/alunos que passam pelo filtro de cliente e calcula os
// números do financeiro. venda = preço do tamanho no time (o geral da aba
// Pagamentos ou o preço personalizado do time); custo = Impressão +
// Costureira do grupo (aba Tamanhos). Quando a camiseta está num lote (leva
// da Produção) com custos lançados, vale o custo REAL por unidade do lote no
// lugar da estimativa — ver custosDosLotes() em js/movimentacoes.js.
// "Já chegou" = pagos; "aguardando" = declarado mas não confirmado;
// "pendente" = nem declarado.
function calcularFinanceiro() {
  const fin = {
    previsto: 0, recebido: 0, aguardando: 0, pendente: 0,
    custos: 0, custosRecebido: 0, custoImpressao: 0, custoCostureira: 0,
    // Mesma quebra dos custos, mas só das camisetas já pagas: é o que entra
    // no lucro realizado.
    custoImpressaoRecebido: 0, custoCostureiraRecebido: 0,
    // Custos dos lotes fora de impressão/costureira (malha, frete...), rateados
    // por unidade; e o custo das unidades do lote que não são de nenhum pedido
    // (avulsas), que só entra na visão sem cliente escolhido.
    custoOutros: 0, custoOutrosRecebido: 0, custoAvulsas: 0, qtdAvulsasLotes: 0,
    qtdCustoReal: 0, qtdCustoProjetado: 0,
    // Taxas do Mercado Pago já descontadas do que entrou: só existem nos
    // pagamentos online, que o webhook grava camiseta a camiseta.
    taxas: 0, qtdComTaxa: 0, recebidoOnline: 0,
    qtd: 0, qtdPagas: 0, qtdAguardando: 0, qtdPendentes: 0,
    qtdInternas: 0, custoInterno: 0,
    porForma: { pix: 0, dinheiro: 0 },
    porTime: [],
    porCliente: [],
    porGrupo: {}
  };

  // Acumulado por cliente (nome -> totais), montado junto com o por time.
  const clientes = {};

  // Custo real por unidade dos lotes com custos lançados (Financeiro → Custos por lote).
  const lotes = typeof custosDosLotes === "function" ? custosDosLotes() : null;

  timesFiltrados().forEach(([timeId, { time, alunos }]) => {
    const t = { nome: time.nome, cliente: nomeClienteDoTime(time), previsto: 0, recebido: 0, taxas: 0, custos: 0, custoImpressao: 0, custoCostureira: 0, custoOutros: 0, qtdCustoReal: 0, qtd: alunos.length, pagas: 0, internas: 0 };
    alunos.forEach((a) => {
      const interno = ehInterno(a);
      // Camiseta interna não tem receita (venda 0); as demais usam o preço do tamanho.
      // O preço especial da camiseta (lista do time) ganha do preço do tamanho.
      const venda = interno ? 0 : Number(precoDoAluno(configGeralAtual, timeId, a.id, a.tamanho) || 0);
      const real = lotes && lotes.porItem.get(`${timeId}__${a.id}`);
      // Fora de lote com custo (ou sem aquela categoria no lote): vale a
      // projeção do último lote lançado — ver custoProjetado().
      const projetar = (k) => typeof custoProjetado === "function"
        ? custoProjetado(lotes, k, a.tamanho)
        : (k === "impressao" ? custoImpressaoDoTamanho(a.tamanho) : k === "costureira" ? custoCostureiraDoTamanho(a.tamanho) : 0);
      const cImp = real && real.impressao !== null ? real.impressao : projetar("impressao");
      const cCos = real && real.costureira !== null ? real.costureira : projetar("costureira");
      const cOut = real ? real.outros : projetar("outros");
      const custo = cImp + cCos + cOut; // custo entra sempre (a camiseta é produzida)
      fin.custos += custo;
      fin.custoImpressao += cImp;
      fin.custoCostureira += cCos;
      fin.custoOutros += cOut;
      fin.qtd++;
      t.custos += custo;
      t.custoImpressao += cImp;
      t.custoCostureira += cCos;
      t.custoOutros += cOut;
      if (real) {
        fin.qtdCustoReal++;
        t.qtdCustoReal++;
      }
      else if (lotes && lotes.projecao && Object.keys(lotes.projecao).length) fin.qtdCustoProjetado++;

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
        const taxa = taxaMpDoAluno(a);
        fin.recebido += venda;
        fin.custosRecebido += custo;
        fin.custoImpressaoRecebido += cImp;
        fin.custoCostureiraRecebido += cCos;
        fin.custoOutrosRecebido += cOut;
        fin.taxas += taxa;
        fin.qtdPagas++;
        t.recebido += venda;
        t.taxas += taxa;
        t.pagas++;
        if (taxa > 0) fin.qtdComTaxa++;
        if (a.pagamentoMpId) fin.recebidoOnline += venda;
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
    t.recebidoLiquido = t.recebido - t.taxas;
    t.lucro = t.previsto - t.custos;
    t.vendaveis = t.qtd - t.internas;
    t.margem = t.previsto > 0 ? (t.lucro / t.previsto) * 100 : 0;
    fin.porTime.push(t);

    if (!clientes[t.cliente]) {
      clientes[t.cliente] = { nome: t.cliente, times: 0, qtd: 0, previsto: 0, recebido: 0, custos: 0 };
    }
    const c = clientes[t.cliente];
    c.times++;
    c.qtd += t.qtd;
    c.previsto += t.previsto;
    c.recebido += t.recebido;
    c.custos += t.custos;
  });

  fin.porCliente = Object.values(clientes)
    .map((c) => ({
      ...c,
      aReceber: c.previsto - c.recebido,
      lucro: c.previsto - c.custos,
      pct: c.previsto > 0 ? (c.recebido / c.previsto) * 100 : 0
    }))
    .sort((a, b) => b.previsto - a.previsto);

  // Unidades dos lotes que não vêm de pedido nenhum (avulsas): não têm cliente,
  // então o custo delas só entra quando o seletor está em "Todos".
  if (lotes && !clienteFiltro) {
    fin.custoAvulsas = lotes.custoAvulsas;
    fin.qtdAvulsasLotes = lotes.qtdAvulsas;
  }

  fin.qtdVendaveis = fin.qtd - fin.qtdInternas;
  fin.aReceber = fin.previsto - fin.recebido;
  fin.lucroPrevisto = fin.previsto - fin.custos - fin.custoAvulsas;
  // O que entrou de verdade na conta: o preço menos a taxa do Mercado Pago.
  fin.recebidoLiquido = fin.recebido - fin.taxas;
  // As internas não têm receita, mas são produzidas: o custo delas sai do
  // lucro realizado (como já sai do previsto).
  fin.lucroRealizado = fin.recebido - fin.custosRecebido - fin.taxas - fin.custoInterno - fin.custoAvulsas;
  fin.taxaMedia = fin.recebidoOnline > 0 ? (fin.taxas / fin.recebidoOnline) * 100 : 0;
  fin.margem = fin.previsto > 0 ? (fin.lucroPrevisto / fin.previsto) * 100 : 0;
  fin.pctRecebido = fin.previsto > 0 ? (fin.recebido / fin.previsto) * 100 : 0;
  fin.ticketMedio = fin.qtdVendaveis > 0 ? fin.previsto / fin.qtdVendaveis : 0;
  fin.custoMedio = fin.qtd > 0 ? fin.custos / fin.qtd : 0;

  // Ordena os times por valor a receber (maior primeiro) — foco na cobrança.
  fin.porTime.sort((a, b) => b.aReceber - a.aReceber);
  return fin;
}

// Lista de lançamentos de RECEBIMENTO (uma linha por camiseta paga).
// É a base do extrato, da evolução e da conciliação por forma de pagamento.
function finLancamentos() {
  const lista = [];
  timesFiltrados().forEach(([timeId, { time, alunos }]) => {
    alunos.forEach((a) => {
      if (!a.pago || ehInterno(a)) return; // interna não gera receita
      lista.push({
        timeId,
        time: time.nome,
        cliente: nomeClienteDoTime(time),
        alunoId: a.id,
        aluno: a.nome,
        tamanho: a.tamanho,
        valor: Number(precoDoAluno(configGeralAtual, timeId, a.id, a.tamanho) || 0),
        custo: custoDoTamanho(a.tamanho),
        taxa: taxaMpDoAluno(a), // o que o Mercado Pago descontou
        forma: a.pagamentoForma === "dinheiro" ? "dinheiro" : "pix",
        online: !!a.pagamentoMpId, // confirmado pelo Mercado Pago (automático)
        data: finParaData(a.pagamentoEm)
      });
    });
  });
  lista.forEach((l) => { l.liquido = l.valor - l.taxa; });
  // Mais recentes primeiro; os sem data ficam no fim.
  lista.sort((x, y) => (y.data ? y.data.getTime() : -1) - (x.data ? x.data.getTime() : -1));
  return lista;
}

// Lista de PENDÊNCIAS (camisetas ainda não pagas), com o tempo em aberto.
function finPendencias() {
  const lista = [];
  timesFiltrados().forEach(([timeId, { time, alunos }]) => {
    const fechadoEm = finParaData(time.fechadoEm);
    const limite = time.dataLimite ? finParaData(time.dataLimite) : null;
    alunos.forEach((a) => {
      if (a.pago) return;
      const declarado = !!a.pagamentoDeclarado;
      // "Aguardando" conta o tempo desde o aviso do aluno; "pendente" conta
      // desde o fechamento do pedido (ou desde o cadastro, se ainda aberto).
      const desde = declarado
        ? finParaData(a.pagamentoDeclaradoEm)
        : (fechadoEm || finParaData(a.criadoEm));
      lista.push({
        timeId,
        time: time.nome,
        cliente: nomeClienteDoTime(time),
        alunoId: a.id,
        aluno: a.nome,
        tamanho: a.tamanho,
        valor: Number(precoDoAluno(configGeralAtual, timeId, a.id, a.tamanho) || 0),
        tipo: declarado ? "aguardando" : "pendente",
        bloqueado: !!a.ajusteSolicitado, // ajuste em aberto trava o pagamento
        contato: a.ajusteContato || "",
        desde,
        dias: finDiasDesde(desde),
        limite,
        atrasado: !!(limite && limite.getTime() < Date.now()),
        status: statusPedidoDe(time)
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

// Aplica o filtro de período + time. Lançamentos sem data ficam de fora do
// recorte por data (voltam separados, para não sumirem do extrato).
function finFiltrar(lista) {
  const { de, ate } = finLimitesPeriodo();
  const dentro = [];
  const semData = [];
  lista.forEach((l) => {
    if (finTimeFiltro && l.timeId !== finTimeFiltro) return;
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
    if (!mapa[chave]) mapa[chave] = { chave, qtd: 0, total: 0, pix: 0, dinheiro: 0, online: 0, taxa: 0, liquido: 0, custo: 0, itens: [] };
    const d = mapa[chave];
    d.qtd++;
    d.total += l.valor;
    d.taxa += l.taxa;
    d.liquido += l.liquido;
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

  if (f.qtd === 0 && finVisao !== "movimentacoes" && finVisao !== "lotes") {
    el.innerHTML = "<p>Nenhuma camiseta cadastrada ainda. Assim que houver pedidos, os números aparecem aqui.</p>" +
      '<button type="button" class="secundario" data-fin-visao="movimentacoes">Ver movimentações (saques e pagamentos)</button>';
    el.querySelector("[data-fin-visao]").onclick = () => { finVisao = "movimentacoes"; renderizarFinanceiro(); };
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
  if (finVisao === "juntar") return finViewJuntar(alvo, f);
  if (finVisao === "resultado") return finViewResultado(alvo, f);
  if (finVisao === "movimentacoes" && typeof finViewMovimentacoes === "function") return finViewMovimentacoes(alvo, f);
  if (finVisao === "lotes" && typeof finViewLotes === "function") return finViewLotes(alvo, f);
  return finViewGeral(alvo, f);
}

// Barra de filtros (período rápido, datas personalizadas e time).
function finBarraFiltrosHtml(comPeriodo = true) {
  const botoes = FIN_PERIODOS.map((p) =>
    `<button type="button" class="fin-chip${finPeriodo === p.id ? " ativa" : ""}" data-fin-periodo="${p.id}">${p.label}</button>`
  ).join("");

  const times = timesFiltrados()
    .map(([id, { time }]) => ({ id, nome: time.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((t) => `<option value="${t.id}"${finTimeFiltro === t.id ? " selected" : ""}>${escapeHtmlAdmin(t.nome)}</option>`)
    .join("");

  if (!comPeriodo) {
    return `
      <div class="fin-filtros">
        <div class="fin-filtros-linha">
          <label for="finTime">Time</label>
          <select id="finTime"><option value="">Todos os times</option>${times}</select>
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
        <label for="finTime">Time</label>
        <select id="finTime"><option value="">Todos os times</option>${times}</select>
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
  const sel = alvo.querySelector("#finTime");
  if (sel) sel.onchange = () => { finTimeFiltro = sel.value; renderizarVisaoFinanceira(f); };
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

  // Quadro por cliente: só faz sentido quando há mais de um na conta.
  const tabelaClientes = f.porCliente.length > 1
    ? `
    <h3 class="fin-titulo">Por cliente</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr>
          <th>Cliente</th><th>Times</th><th>Qtd</th><th>Previsto</th><th>Recebido</th><th>A receber</th><th>%</th><th>Lucro prev.</th>
        </tr></thead>
        <tbody>${f.porCliente.map((c) => `<tr>
          <td>${escapeHtmlAdmin(c.nome)}</td>
          <td>${c.times}</td>
          <td>${c.qtd}</td>
          <td>${formatarReais(c.previsto)}</td>
          <td class="fin-verde">${formatarReais(c.recebido)}</td>
          <td class="fin-vermelho">${formatarReais(c.aReceber)}</td>
          <td>${Math.round(c.pct)}%</td>
          <td>${formatarReais(c.lucro)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`
    : "";

  const colCliente = f.porCliente.length > 1; // sem vários clientes, a coluna só ocupa espaço
  const linhasTime = f.porTime.map((t, idx) => {
    const pct = t.previsto > 0 ? Math.round((t.recebido / t.previsto) * 100) : 0;
    return `<tr>
      <td>${escapeHtmlAdmin(t.nome)}</td>
      ${colCliente ? `<td>${escapeHtmlAdmin(t.cliente)}</td>` : ""}
      <td>${t.qtd}</td>
      <td>${formatarReais(t.previsto)}</td>
      <td class="fin-verde">${formatarReais(t.recebido)}</td>
      <td class="fin-vermelho">${formatarReais(t.aReceber)}</td>
      <td>${pct}%</td>
      <td class="fin-custo-cel" data-time-idx="${idx}" role="button" tabindex="0" title="Ver detalhe do custo">${formatarReais(t.custos)} ›</td>
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
        <span class="fin-sub">${f.qtdPagas} paga(s)${f.taxas > 0 ? ` · ${formatarReais(f.recebidoLiquido)} líquido` : ""}</span>
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
    <div class="fin-destaques fin-destaques-4">
      <div class="fin-card fin-card-click" data-fin-modal="total" role="button" tabindex="0" title="Ver detalhe do custo">
        <span class="fin-rotulo">Custos previstos</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.custos)}</span>
        <span class="fin-sub fin-link">${f.qtdCustoReal > 0 || f.qtdCustoProjetado > 0 ? `${f.qtdCustoReal} un. custo real · ${f.qtdCustoProjetado} projetada(s)` : "Impressão + Costureira"} · ver detalhe ›</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Taxas do Mercado Pago</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.taxas)}</span>
        <span class="fin-sub">${f.taxas > 0
          ? `${f.taxaMedia.toFixed(1)}% do que veio online · ${f.qtdComTaxa} pagamento(s)`
          : "nenhum pagamento online com taxa registrada"}</span>
      </div>
      <div class="fin-card">
        <span class="fin-rotulo">Lucro previsto</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.lucroPrevisto)}</span>
        <span class="fin-sub">margem ${f.margem.toFixed(0)}% · sem as taxas (só conhecidas ao pagar)</span>
      </div>
      <div class="fin-card fin-card-click" data-fin-modal="lucro-realizado" role="button" tabindex="0" title="Ver detalhe do lucro realizado">
        <span class="fin-rotulo">Lucro realizado</span>
        <span class="fin-valor fin-valor-md">${formatarReais(f.lucroRealizado)}</span>
        <span class="fin-sub fin-link">Custos realizados + taxas${f.qtdInternas > 0 ? " + internas" : ""} · ver detalhe ›</span>
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
      <span class="badge pago">Online (Mercado Pago): ${formatarReais(f.recebidoOnline)}</span>
      <span class="badge aguardando">Taxas descontadas: ${formatarReais(f.taxas)}</span>
    </div>

    ${tabelaClientes}

    <!-- Por time -->
    <h3 class="fin-titulo">Por time (ordenado por valor a receber)</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr>
          <th>Time</th>${colCliente ? "<th>Cliente</th>" : ""}<th>Qtd</th><th>Previsto</th><th>Recebido</th><th>A receber</th><th>%</th><th>Custo prev.</th><th>Lucro prev.</th>
        </tr></thead>
        <tbody>${linhasTime}</tbody>
      </table>
    </div>
  `;

  // Liga os cliques que abrem os pop-ups de detalhe (custo total, custo por
  // time e lucro realizado).
  const ligarDetalhe = (el, abrir) => {
    if (!el) return;
    el.onclick = abrir;
    el.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } };
  };

  ligarDetalhe(alvo.querySelector('[data-fin-modal="total"]'), () =>
    abrirModalCusto("Custo previsto — total", {
      impressao: f.custoImpressao, costureira: f.custoCostureira, outros: f.custoOutros,
      avulsas: f.custoAvulsas, qtdAvulsas: f.qtdAvulsasLotes,
      total: f.custos + f.custoAvulsas, qtd: f.qtd, qtdReal: f.qtdCustoReal, qtdProjetado: f.qtdCustoProjetado
    }));

  ligarDetalhe(alvo.querySelector('[data-fin-modal="lucro-realizado"]'), () =>
    abrirModalLucroRealizado(f));
  alvo.querySelectorAll(".fin-custo-cel").forEach((cel) => {
    const t = f.porTime[Number(cel.dataset.timeIdx)];
    if (!t) return;
    ligarDetalhe(cel, () => abrirModalCusto("Custo previsto — " + t.nome, {
      impressao: t.custoImpressao, costureira: t.custoCostureira, outros: t.custoOutros,
      total: t.custos, qtd: t.qtd, qtdReal: t.qtdCustoReal
    }));
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
  const taxa = dentro.reduce((s, l) => s + l.taxa, 0);
  const liquido = total - taxa;
  const ticket = dentro.length > 0 ? total / dentro.length : 0;
  const mediaDia = dias.length > 0 ? total / dias.length : 0;

  const linhas = dias.map((d) => {
    const aberto = !!finDiasAbertos[d.chave];
    const detalhe = d.itens.map((l) => `
      <tr class="fin-linha-item">
        <td>${finHora(l.data)}</td>
        <td>${escapeHtmlAdmin(l.aluno)}</td>
        <td>${escapeHtmlAdmin(l.time)}</td>
        <td>${escapeHtmlAdmin(l.tamanho)}</td>
        <td>${l.forma === "dinheiro" ? "Dinheiro" : (l.online ? "PIX (online)" : "PIX")}</td>
        <td class="fin-verde">${formatarReais(l.valor)}</td>
        <td class="${l.taxa > 0 ? "fin-vermelho" : ""}">${l.taxa > 0 ? "-" + formatarReais(l.taxa) : "—"}</td>
        <td>${formatarReais(l.liquido)}</td>
      </tr>`).join("");

    return `
      <tbody class="fin-grupo-dia">
        <tr class="fin-linha-dia" data-fin-dia="${d.chave}" role="button" tabindex="0">
          <td><span class="fin-seta">${aberto ? "▾" : "▸"}</span> ${finRotuloDia(d.chave)}</td>
          <td>${d.qtd}</td>
          <td>${formatarReais(d.pix)}</td>
          <td>${formatarReais(d.dinheiro)}</td>
          <td class="fin-verde"><strong>${formatarReais(d.total)}</strong></td>
          <td class="${d.taxa > 0 ? "fin-vermelho" : ""}">${d.taxa > 0 ? "-" + formatarReais(d.taxa) : "—"}</td>
          <td>${formatarReais(d.acumulado)}</td>
        </tr>
        ${aberto ? `<tr class="fin-linha-detalhe"><td colspan="7">
          <table class="fin-tabela fin-tabela-interna">
            <thead><tr><th>Hora</th><th>Aluno</th><th>Time</th><th>Tam.</th><th>Forma</th><th>Valor</th><th>Taxa MP</th><th>Líquido</th></tr></thead>
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
        <span class="fin-sub">${dentro.length} pagamento(s) · ${label}${taxa > 0 ? ` · líquido ${formatarReais(liquido)}` : ""}</span>
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
        <span class="fin-sub">dinheiro ${formatarReais(dinheiro)} · ${formatarReais(online)} confirmados automaticamente (taxa ${formatarReais(taxa)})</span>
      </div>
    </div>

    ${avisoSemData}

    <h3 class="fin-titulo">Extrato por dia <span class="fin-dica">(clique no dia para ver os pagamentos)</span></h3>
    ${dias.length === 0
      ? "<p>Nenhum recebimento neste período.</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela fin-tabela-extrato">
            <thead><tr><th>Dia</th><th>Qtd</th><th>PIX</th><th>Dinheiro</th><th>Total do dia</th><th>Taxa MP</th><th>Acumulado no período</th></tr></thead>
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

// ---------------- Visão 5: juntar cobrança ----------------
// Junta camisetas em aberto de times diferentes (as dos professores, por
// exemplo) numa cobrança só: filtra, marca as que entram, e manda o total no
// WhatsApp com o link de pagamento (que já abre o carrinho com elas) e o PIX
// copia e cola da soma. Se pagarem fora do site, marca todas como pagas de
// uma vez. A seleção sobrevive às atualizações em tempo real da lista.

const juntarSel = new Set();  // "timeId/alunoId" das camisetas marcadas
let juntarSoProf = true;      // começa nos professores, o caso mais comum
let juntarBusca = "";
let juntarNome = "";          // para quem vai a cobrança (saudação)
let juntarTelefone = "";
let juntarDesconto = "";      // valor digitado no campo de desconto
let juntarDescontoTipo = "reais"; // "reais" | "pct"

// Desconto digitado, em centavos, sobre um total também em centavos
// (0 quando vazio; null quando inválido ou maior que o total).
function juntarDescontoCentavos(totalCent) {
  const bruto = String(juntarDesconto || "").trim().replace(",", ".");
  if (!bruto) return 0;
  const v = parseFloat(bruto);
  if (isNaN(v) || v < 0) return null;
  const cent = juntarDescontoTipo === "pct"
    ? Math.round(totalCent * Math.min(v, 100) / 100)
    : Math.round(v * 100);
  return cent > totalCent ? null : cent;
}

// Reparte o desconto entre as camisetas na proporção do preço de cada uma
// (a última leva a sobra dos arredondamentos) e grava o resultado como o
// preço especial delas. Assim o link, o PIX, o Mercado Pago e o Financeiro
// enxergam o mesmo valor, sem nada novo para cada um entender.
function juntarRepartirDesconto(itens, descCent) {
  const totalCent = itens.reduce((s, p) => s + Math.round(p.valor * 100), 0);
  const alvoCent = totalCent - descCent;
  let usado = 0;
  return itens.map((p, i) => {
    const cent = i === itens.length - 1
      ? alvoCent - usado
      : Math.round(Math.round(p.valor * 100) * alvoCent / totalCent);
    usado += cent;
    return { item: p, valor: Math.max(0, cent) / 100 };
  });
}

function juntarChave(p) {
  return p.timeId + "/" + p.alunoId;
}

// Camisetas que podem entrar numa cobrança: as não pagas e sem aviso de
// pagamento (essas estão na fila de conferência, em "A receber").
function juntarCandidatas() {
  const lista = [];
  timesFiltrados().forEach(([timeId, { time, alunos }]) => {
    alunos.forEach((a) => {
      if (a.pago || a.pagamentoDeclarado) return;
      lista.push({
        timeId,
        alunoId: a.id,
        aluno: a.nome || "",
        time: time.nome || timeId,
        tamanho: a.tamanho || "",
        numero: a.numero || "",
        nomeCamiseta: a.nomeCamiseta || "",
        prof: ehProf(a),
        valor: Number(precoDoAluno(configGeralAtual, timeId, a.id, a.tamanho) || 0),
        especial: precoEspecialDoAluno(configGeralAtual, timeId, a.id) != null,
        bloqueado: !!a.ajusteSolicitado,
        // O link só cobra o que a página do pedido aceitaria pagar agora.
        pagavel: podePagarAgora(time, a)
      });
    });
  });
  return lista.sort((x, y) =>
    x.time.localeCompare(y.time, "pt-BR") || x.aluno.localeCompare(y.aluno, "pt-BR"));
}

function juntarVisiveis(todas) {
  const termos = normalizarTexto(juntarBusca).split(/\s+/).filter(Boolean);
  return todas.filter((p) => {
    if (finTimeFiltro && p.timeId !== finTimeFiltro) return false;
    if (juntarSoProf && !p.prof) return false;
    if (termos.length === 0) return true;
    const alvo = normalizarTexto([p.aluno, p.nomeCamiseta, p.numero, p.time].join(" "));
    return termos.every((t) => alvo.includes(t));
  });
}

// Texto que vai no WhatsApp: a lista, o total, o link e o PIX da soma.
function juntarMensagem(sel) {
  const total = sel.reduce((s, p) => s + p.valor, 0);
  const pagaveis = sel.filter((p) => p.pagavel);
  const primeiroNome = juntarNome.trim().split(/\s+/)[0] || "";
  const linhas = sel.map((p) =>
    `• ${p.aluno} — ${p.time} — ${p.tamanho || "-"}${p.valor > 0 ? " — " + formatarReais(p.valor) : ""}`);
  let texto =
    (primeiroNome ? `Olá, ${primeiroNome}! ` : "Olá! ") +
    "Aqui é da organização do interclasse. Seguem as camisetas em aberto:\n\n" +
    linhas.join("\n") +
    `\n\n*Total: ${formatarReais(total)}* (${sel.length} camiseta(s))`;
  if (pagaveis.length > 0) {
    // Se parte não pode ser paga pelo site agora, o link diz quais leva.
    texto += pagaveis.length === sel.length
      ? "\n\nPara pagar tudo de uma vez pelo site:\n"
      : `\n\nPelo site dá para pagar agora ${pagaveis.length} delas (${pagaveis.map((p) => p.aluno).join(", ")}):\n`;
    texto += linkCobranca(pagaveis);
  }
  if (configGeralAtual.pixChave && total > 0) {
    texto += (pagaveis.length > 0 ? "\n\nOu pelo PIX copia e cola:\n" : "\n\nPIX copia e cola:\n") +
      pixCopiaECola({
        chave: configGeralAtual.pixChave,
        nome: configGeralAtual.pixNome,
        cidade: configGeralAtual.pixCidade,
        valor: total
      });
  }
  return texto;
}

async function juntarCopiar(texto, botao, rotulo) {
  try {
    await navigator.clipboard.writeText(texto);
    botao.textContent = "Copiado ✓";
    setTimeout(() => { botao.textContent = rotulo; }, 1800);
  } catch (e) {
    prompt("Copie:", texto);
  }
}

function finViewJuntar(alvo) {
  const todas = juntarCandidatas();
  // Some da seleção o que foi pago (ou saiu da lista) desde a última vez.
  const existentes = new Set(todas.map(juntarChave));
  [...juntarSel].forEach((k) => { if (!existentes.has(k)) juntarSel.delete(k); });

  const nProfs = todas.filter((p) => p.prof).length;

  alvo.innerHTML = `
    ${finBarraFiltrosHtml(false)}
    <div class="fin-filtros juntar-filtros">
      <div class="fin-chips">
        <button type="button" class="fin-chip${juntarSoProf ? " ativa" : ""}" data-juntar-prof="1">${icone("graduation-cap")} Só professores (${nProfs})</button>
        <button type="button" class="fin-chip${juntarSoProf ? "" : " ativa"}" data-juntar-prof="0">Todas em aberto (${todas.length})</button>
      </div>
      <div class="fin-filtros-linha">
        <label for="juntarBusca">Buscar</label>
        <input type="search" id="juntarBusca" placeholder="Nome, número ou time" value="${escapeHtmlAdmin(juntarBusca)}" />
      </div>
    </div>
    <p class="fin-dica">Marque as camisetas que vão na mesma cobrança — podem ser de times diferentes. Só aparecem as não pagas e sem aviso de pagamento (as que avisaram estão em <em>A receber</em>).</p>

    <div class="juntar-resumo" id="juntarResumo"></div>

    <div class="fin-tabela-wrap">
      <table class="fin-tabela juntar-tabela">
        <thead><tr>
          <th><input type="checkbox" id="juntarTodas" aria-label="Marcar todas as da lista" /></th>
          <th>Nome</th><th>Time</th><th>Tam.</th><th>Nº / nas costas</th><th>Valor</th><th>Situação</th>
        </tr></thead>
        <tbody id="juntarCorpo"></tbody>
      </table>
    </div>
  `;

  finLigarFiltros(alvo, finUltimo);
  alvo.querySelectorAll("[data-juntar-prof]").forEach((btn) => {
    btn.onclick = () => { juntarSoProf = btn.dataset.juntarProf === "1"; finViewJuntar(alvo); };
  });

  const corpo = alvo.querySelector("#juntarCorpo");
  const resumo = alvo.querySelector("#juntarResumo");
  const todasBox = alvo.querySelector("#juntarTodas");

  const desenhar = () => {
    const visiveis = juntarVisiveis(todas);
    corpo.innerHTML = visiveis.length === 0
      ? `<tr><td colspan="7">${juntarSoProf ? "Nenhuma camiseta de professor em aberto." : "Nenhuma camiseta em aberto com esse filtro."}</td></tr>`
      : visiveis.map((p) => {
        const k = juntarChave(p);
        const situacao = p.bloqueado
          ? '<span class="badge aguardando">ajuste pendente</span>'
          : p.pagavel
            ? '<span class="badge pendente">pendente</span>'
            : '<span class="badge fechado" title="O pedido não está na fase de pagamento: o link não cobra esta camiseta (o PIX da mensagem cobra)">fora do pagamento</span>';
        return `<tr class="${juntarSel.has(k) ? "juntar-marcada" : ""}">
          <td><input type="checkbox" data-juntar="${escapeHtmlAdmin(k)}"${juntarSel.has(k) ? " checked" : ""} aria-label="Juntar ${escapeHtmlAdmin(p.aluno)}" /></td>
          <td>${escapeHtmlAdmin(p.aluno)}${p.prof ? " " + badgeProfHtml({ prof: true }) : ""}</td>
          <td>${escapeHtmlAdmin(p.time)}</td>
          <td>${escapeHtmlAdmin(p.tamanho)}</td>
          <td>${escapeHtmlAdmin([p.numero, p.nomeCamiseta].filter(Boolean).join(" · ") || "-")}</td>
          <td>${p.valor > 0 ? formatarReais(p.valor) : "-"}${p.especial ? ' <span class="fin-dica" title="Preço especial desta camiseta (desconto)">especial</span>' : ""}</td>
          <td>${situacao}</td>
        </tr>`;
      }).join("");

    const marcadasVisiveis = visiveis.filter((p) => juntarSel.has(juntarChave(p))).length;
    todasBox.checked = visiveis.length > 0 && marcadasVisiveis === visiveis.length;
    todasBox.indeterminate = marcadasVisiveis > 0 && marcadasVisiveis < visiveis.length;
    todasBox.disabled = visiveis.length === 0;
    todasBox.onchange = () => {
      visiveis.forEach((p) => {
        if (todasBox.checked) juntarSel.add(juntarChave(p)); else juntarSel.delete(juntarChave(p));
      });
      desenhar();
    };
    corpo.querySelectorAll("[data-juntar]").forEach((box) => {
      box.onchange = () => {
        if (box.checked) juntarSel.add(box.dataset.juntar); else juntarSel.delete(box.dataset.juntar);
        desenhar();
      };
    });
    desenharResumo();
  };

  const desenharResumo = () => {
    // A seleção vale mesmo para o que o filtro esconde agora.
    const sel = todas.filter((p) => juntarSel.has(juntarChave(p)));
    if (sel.length === 0) {
      resumo.innerHTML = '<p class="fin-dica">Nenhuma camiseta marcada ainda.</p>';
      return;
    }
    const total = sel.reduce((s, p) => s + p.valor, 0);
    const semPreco = sel.filter((p) => !(p.valor > 0)).length;
    const foraDoLink = sel.filter((p) => !p.pagavel).length;
    const times = [...new Set(sel.map((p) => p.time))];
    const avisos = [];
    if (semPreco > 0) avisos.push(`${semPreco} sem preço definido (fora do total)`);
    if (foraDoLink > 0) avisos.push(`${foraDoLink} não entra(m) no link — pedido fora da fase de pagamento ou com ajuste em aberto; o PIX da mensagem cobra a soma de todas`);
    if (!configGeralAtual.pixChave) avisos.push("sem chave PIX configurada: a mensagem vai só com o link");

    resumo.innerHTML = `
      <div class="fin-card fin-card-azul">
        <span class="fin-rotulo">Cobrança juntada</span>
        <span class="fin-valor fin-valor-md">${formatarReais(total)}</span>
        <span class="fin-sub">${sel.length} camiseta(s) · ${times.length} time(s)</span>
        ${avisos.length ? `<span class="fin-sub">⚠️ ${escapeHtmlAdmin(avisos.join(" · "))}</span>` : ""}
      </div>
      <div class="juntar-desconto">
        <label for="juntarDesconto">Desconto</label>
        <input type="text" inputmode="decimal" id="juntarDesconto" placeholder="0,00" value="${escapeHtmlAdmin(juntarDesconto)}" />
        <select id="juntarDescontoTipo" aria-label="Tipo de desconto">
          <option value="reais"${juntarDescontoTipo === "reais" ? " selected" : ""}>R$</option>
          <option value="pct"${juntarDescontoTipo === "pct" ? " selected" : ""}>%</option>
        </select>
        <span class="juntar-desconto-previa" id="juntarDescontoPrevia"></span>
        <button type="button" class="primario" data-juntar-acao="desconto"${precosAdminErro ? " disabled" : ""}>Aplicar desconto</button>
        ${sel.some((p) => p.especial) ? '<button type="button" class="secundario" data-juntar-acao="sem-desconto" title="Tira o preço especial das marcadas: voltam ao preço do tamanho">Voltar ao preço normal</button>' : ""}
      </div>
      <p class="fin-dica">O desconto é repartido entre as camisetas marcadas (na proporção do preço) e fica gravado como o preço especial de cada uma — vale no link, no PIX, no Mercado Pago e no Financeiro.</p>
      <div class="juntar-envio">
        <label>Para quem (opcional)<input type="text" id="juntarNome" placeholder="Ex: Prof. Ana" value="${escapeHtmlAdmin(juntarNome)}" /></label>
        <label>WhatsApp (opcional)<input type="tel" inputmode="tel" id="juntarTelefone" placeholder="(11) 91234-5678 — em branco, você escolhe o contato" value="${escapeHtmlAdmin(juntarTelefone)}" /></label>
      </div>
      <div class="juntar-acoes">
        <button type="button" class="sucesso" data-juntar-acao="whats">${icone("message-circle")} Enviar no WhatsApp</button>
        <button type="button" class="secundario" data-juntar-acao="mensagem">Copiar mensagem</button>
        <button type="button" class="secundario" data-juntar-acao="link"${sel.some((p) => p.pagavel) ? "" : " disabled"}>Copiar link de pagamento</button>
        <select data-juntar-acao="pagar" aria-label="Marcar as selecionadas como pagas">
          <option value="">Marcar como pagas…</option>
          <option value="pix">Pagas (PIX)</option>
          <option value="dinheiro">Pagas (dinheiro)</option>
        </select>
        <button type="button" class="secundario" data-juntar-acao="limpar">Limpar seleção</button>
      </div>
    `;

    const totalCent = Math.round(total * 100);
    const comPreco = sel.filter((p) => p.valor > 0);
    const previa = resumo.querySelector("#juntarDescontoPrevia");
    const atualizarPrevia = () => {
      const d = juntarDescontoCentavos(totalCent);
      previa.textContent = d === null
        ? "valor inválido (maior que o total?)"
        : d > 0 ? `→ ${formatarReais((totalCent - d) / 100)} (−${formatarReais(d / 100)})` : "";
      previa.classList.toggle("fin-vermelho", d === null);
    };
    atualizarPrevia();
    resumo.querySelector("#juntarDesconto").oninput = (ev) => { juntarDesconto = ev.target.value; atualizarPrevia(); };
    resumo.querySelector("#juntarDescontoTipo").onchange = (ev) => { juntarDescontoTipo = ev.target.value; atualizarPrevia(); };
    const btnDesc = resumo.querySelector('[data-juntar-acao="desconto"]');
    btnDesc.onclick = async () => {
      const d = juntarDescontoCentavos(totalCent);
      if (d === null) { alert("Informe um desconto válido, que não passe do total."); return; }
      if (d === 0) { alert("Digite o valor do desconto."); return; }
      if (comPreco.length === 0) { alert("Nenhuma das marcadas tem preço para descontar."); return; }
      const novos = juntarRepartirDesconto(comPreco, d);
      const linhas = novos.map((n) => `• ${n.item.aluno}: ${formatarReais(n.item.valor)} → ${formatarReais(n.valor)}`).join("\n");
      if (!confirm(`Aplicar ${formatarReais(d / 100)} de desconto? O total passa a ${formatarReais((totalCent - d) / 100)}.\n\n${linhas}`)) return;
      btnDesc.disabled = true;
      try {
        await Promise.all(novos.map((n) => gravarPrecoAluno(n.item.timeId, n.item.alunoId, n.valor)));
        juntarDesconto = "";
        // A lista se redesenha sozinha quando os preços novos chegam.
      } catch (erro) {
        console.error(erro);
        btnDesc.disabled = false;
        alert("Erro ao gravar o desconto. Confira se o firestore.rules atualizado foi publicado.");
      }
    };
    const btnSemDesc = resumo.querySelector('[data-juntar-acao="sem-desconto"]');
    if (btnSemDesc) {
      btnSemDesc.onclick = async () => {
        const comEspecial = sel.filter((p) => p.especial);
        if (!confirm(`Tirar o preço especial (desconto) de ${comEspecial.length} camiseta(s)? Elas voltam ao preço do tamanho.`)) return;
        btnSemDesc.disabled = true;
        try {
          await Promise.all(comEspecial.map((p) => gravarPrecoAluno(p.timeId, p.alunoId, null)));
        } catch (erro) {
          console.error(erro);
          btnSemDesc.disabled = false;
          alert("Erro ao voltar ao preço normal.");
        }
      };
    }
    resumo.querySelector("#juntarNome").oninput = (ev) => { juntarNome = ev.target.value; };
    resumo.querySelector("#juntarTelefone").oninput = (ev) => { juntarTelefone = ev.target.value; };
    resumo.querySelector('[data-juntar-acao="whats"]').onclick = () => {
      const texto = juntarMensagem(sel);
      // Sem número, o wa.me deixa escolher o contato (ou um grupo) na hora.
      const url = juntarTelefone.trim()
        ? linkWhatsapp(juntarTelefone, texto)
        : "https://wa.me/?text=" + encodeURIComponent(texto);
      if (!url) {
        alert("O WhatsApp informado não é válido (use DDD). Deixe em branco para escolher o contato no WhatsApp.");
        return;
      }
      window.open(url, "_blank");
    };
    const btnMsg = resumo.querySelector('[data-juntar-acao="mensagem"]');
    btnMsg.onclick = () => juntarCopiar(juntarMensagem(sel), btnMsg, "Copiar mensagem");
    const btnLink = resumo.querySelector('[data-juntar-acao="link"]');
    btnLink.onclick = () => juntarCopiar(linkCobranca(sel.filter((p) => p.pagavel)), btnLink, "Copiar link de pagamento");
    const selPagar = resumo.querySelector('[data-juntar-acao="pagar"]');
    selPagar.onchange = () => {
      const forma = selPagar.value;
      selPagar.value = "";
      if (!forma) return;
      const rotulo = forma === "pix" ? "PIX" : "dinheiro";
      if (!confirm(`Marcar ${sel.length} camiseta(s) como pagas (${rotulo}), somando ${formatarReais(total)}?`)) return;
      sel.forEach((p) => {
        atualizarPagamento(p.timeId, p.alunoId, forma);
        juntarSel.delete(juntarChave(p));
      });
      desenhar();
    };
    resumo.querySelector('[data-juntar-acao="limpar"]').onclick = () => {
      juntarSel.clear();
      desenhar();
    };
  };

  alvo.querySelector("#juntarBusca").oninput = (ev) => {
    juntarBusca = ev.target.value;
    desenhar();
  };

  desenhar();
}

// ---------------- Visão 4: a receber (cobrança e conciliação) ----------------

function finViewCobranca(alvo, f) {
  const pend = finPendencias().filter((p) => !finTimeFiltro || p.timeId === finTimeFiltro);
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
      <td>${escapeHtmlAdmin(p.time)}</td>
      <td>${formatarReais(p.valor)}</td>
      <td>${p.dias === null ? "-" : p.dias + " dia(s)"}</td>
      <td><button type="button" class="sucesso fin-btn-confirmar" data-time="${p.timeId}" data-aluno="${p.alunoId}">Confirmar PIX</button></td>
    </tr>`).join("");

  // Times ordenadas pelo que falta receber, com o tempo médio em aberto.
  const porTime = {};
  pend.forEach((p) => {
    if (!porTime[p.timeId]) porTime[p.timeId] = { nome: p.time, qtd: 0, valor: 0, dias: [], status: p.status, atrasado: p.atrasado };
    const t = porTime[p.timeId];
    t.qtd++;
    t.valor += p.valor;
    if (p.dias !== null) t.dias.push(p.dias);
  });
  const listaTimes = Object.values(porTime).sort((a, b) => b.valor - a.valor);
  const linhasTime = listaTimes.map((t) => {
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
      <td>${escapeHtmlAdmin(p.time)}</td>
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
            <thead><tr><th>Aluno</th><th>Time</th><th>Valor</th><th>Esperando há</th><th></th></tr></thead>
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

    <h3 class="fin-titulo">Por time (maior valor em aberto primeiro)</h3>
    ${listaTimes.length === 0
      ? "<p>Nenhuma pendência. Tudo pago! 🎉</p>"
      : `<div class="fin-tabela-wrap">
          <table class="fin-tabela">
            <thead><tr><th>Time</th><th>Em aberto</th><th>Valor</th><th>Tempo médio</th><th>Status do pedido</th></tr></thead>
            <tbody>${linhasTime}</tbody>
          </table>
        </div>`}

    ${maiores.length === 0 ? "" : `
    <h3 class="fin-titulo">Maiores pendências individuais</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Aluno</th><th>Time</th><th>Tam.</th><th>Valor</th><th>Em aberto há</th></tr></thead>
        <tbody>${linhasMaiores}</tbody>
      </table>
    </div>`}
  `;

  finLigarFiltros(alvo, f);
  alvo.querySelectorAll(".fin-btn-confirmar").forEach((btn) => {
    btn.onclick = () => {
      if (!confirm("Confirmar o recebimento por PIX desta camiseta?")) return;
      atualizarPagamento(btn.dataset.time, btn.dataset.aluno, "pix");
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

  // Ranking de rentabilidade por time (quem dá mais lucro previsto).
  const ranking = [...f.porTime].sort((a, b) => b.lucro - a.lucro).map((t) => `
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
    ...(f.custoOutros > 0 ? [["(-) Outros custos dos lotes (malha, frete…)", -f.custoOutros, "linha"]] : []),
    ...(f.custoAvulsas > 0 ? [["(-) Custo das avulsas dos lotes (sem pedido)", -f.custoAvulsas, "linha"]] : []),
    ["(=) Lucro previsto", f.lucroPrevisto, "total"],
    ["Receita já recebida", f.recebido, "linha"],
    ["(-) Custo das camisetas já pagas", -f.custosRecebido, "linha"],
    ["(-) Taxas do Mercado Pago", -f.taxas, "linha"],
    ["(-) Custo das camisetas internas (sem receita)", -f.custoInterno, "linha"],
    ...(f.custoAvulsas > 0 ? [["(-) Custo das avulsas dos lotes", -f.custoAvulsas, "linha"]] : []),
    ["(=) Lucro realizado", f.lucroRealizado, "total"],
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
        <span class="fin-sub">lucro ${formatarReais(f.lucroPrevisto)} · antes das taxas do MP</span>
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
    <p class="pix-ajuda">A taxa do Mercado Pago é a informada por ele em cada pagamento online (chega junto com a confirmação automática), rateada entre as camisetas da cobrança. Pagamento em dinheiro ou PIX marcado na mão não tem taxa, e o previsto ainda não a considera — ela só é conhecida quando o pagamento acontece.</p>

    <h3 class="fin-titulo">Rentabilidade por time</h3>
    <div class="fin-tabela-wrap">
      <table class="fin-tabela">
        <thead><tr><th>Time</th><th>Qtd</th><th>Receita prev.</th><th>Custo</th><th>Lucro prev.</th><th>Margem</th></tr></thead>
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

// Pop-up de detalhe (custo, lucro): uma tabela de "rótulo → valor" com uma
// observação embaixo. Cada linha é [rótulo, valor, tipo]; o valor negativo é
// o que sai (vai em vermelho, sem o sinal, com o "(-)" já no rótulo, como no
// DRE), e o tipo marca as somas: "subtotal" e "total".
function abrirModalDetalhe(titulo, linhas, nota) {
  const modal = document.getElementById("modalCusto");
  const tit = document.getElementById("modalCustoTitulo");
  const corpo = document.getElementById("modalCustoCorpo");
  if (!modal || !corpo) return;
  if (tit) tit.textContent = titulo;
  const corpoTabela = linhas.map(([rotulo, valor, tipo]) => {
    const classeLinha = tipo === "total" ? "fin-linha-total" : (tipo === "subtotal" ? "fin-linha-subtotal" : "");
    const valorFmt = formatarReais(Math.abs(valor));
    return `
      <tr class="${classeLinha}">
        <td>${rotulo}</td>
        <td class="${valor < 0 ? "fin-vermelho" : ""}">${valorFmt}</td>
      </tr>`;
  }).join("");
  corpo.innerHTML = `
    <table class="fin-tabela fin-tabela-modal">
      <tbody>${corpoTabela}</tbody>
    </table>
    ${nota ? `<p class="pix-ajuda">${nota}</p>` : ""}
  `;
  modal.classList.remove("oculto");
}

// Detalhe do custo (Impressão + Costureira) do total ou de um time.
function abrirModalCusto(titulo, d) {
  const nota = `${d.qtd} camiseta(s) considerada(s) (inclui as internas).` +
    (d.qtdReal > 0
      ? ` ${d.qtdReal} delas com o custo real por unidade do lote (Financeiro → Custos por lote).`
      : " Nenhuma está num lote com custos lançados.") +
    (d.qtdProjetado > 0
      ? ` ${d.qtdProjetado} ainda fora dos lotes usam o custo projetado pelo último lote lançado.`
      : "");
  abrirModalDetalhe(titulo, [
    ["Impressão", d.impressao, "linha"],
    ["Costureira", d.costureira, "linha"],
    ...(d.outros > 0 ? [["Outros custos dos lotes (malha, frete…)", d.outros, "linha"]] : []),
    ...(d.avulsas > 0 ? [[`Unidades avulsas dos lotes (${d.qtdAvulsas})`, d.avulsas, "linha"]] : []),
    ["Total", d.total, "total"]
  ], nota);
}

// Detalhe do lucro realizado: o que já entrou, menos os custos das camisetas
// que foram pagas (impressão + costureira) e as taxas do Mercado Pago.
function abrirModalLucroRealizado(f) {
  const nota = `${f.qtdPagas} camiseta(s) paga(s). O custo das que ainda não foram pagas fica no custo previsto.`
    + (f.qtdInternas > 0
      ? ` As ${f.qtdInternas} interna(s) não têm receita, mas são produzidas: o custo delas é descontado.`
      : "");
  abrirModalDetalhe("Lucro realizado — detalhe", [
    ["Receita já recebida", f.recebido, "linha"],
    ["(-) Custo de impressão", -f.custoImpressaoRecebido, "linha"],
    ["(-) Custo de costureira", -f.custoCostureiraRecebido, "linha"],
    ...(f.custoOutrosRecebido > 0 ? [["(-) Outros custos dos lotes", -f.custoOutrosRecebido, "linha"]] : []),
    ["(=) Custos realizados", -f.custosRecebido, "subtotal"],
    ["(-) Taxas do Mercado Pago", -f.taxas, "linha"],
    ...(f.qtdInternas > 0 ? [["(-) Custo das camisetas internas", -f.custoInterno, "linha"]] : []),
    ...(f.custoAvulsas > 0 ? [["(-) Custo das avulsas dos lotes", -f.custoAvulsas, "linha"]] : []),
    ["(=) Lucro realizado", f.lucroRealizado, "total"]
  ], nota);
}

function fecharModalCusto() {
  const modal = document.getElementById("modalCusto");
  if (modal) modal.classList.add("oculto");
}

// ---------------- Exportação (segue a visão aberta) ----------------

function exportarFinanceiro() {
  // Movimentações (js/movimentacoes.js) não dependem de haver camisetas.
  if (finVisao === "movimentacoes" && typeof exportarMovimentacoes === "function") return exportarMovimentacoes();
  if (finVisao === "lotes" && typeof exportarCustosLotes === "function") return exportarCustosLotes();
  const f = finUltimo || calcularFinanceiro();
  if (f.qtd === 0) {
    alert("Não há dados financeiros para exportar.");
    return;
  }
  if (finVisao === "extrato") return exportarExtrato();
  if (finVisao === "evolucao") return exportarEvolucao();
  if (finVisao === "cobranca") return exportarCobranca();
  if (finVisao === "resultado") return exportarResultado(f);
  return exportarResumoPorTime(f);
}

// Visão geral / resumo por time (formato original do relatório).
function exportarResumoPorTime(f) {
  const linhas = [["Cliente", "Time", "Camisetas", "Previsto", "Recebido", "Taxa MP", "Recebido liquido", "A receber", "% recebido", "Impressao", "Costureira", "Custos", "Lucro previsto"]];
  f.porTime.forEach((t) => {
    const pct = t.previsto > 0 ? Math.round((t.recebido / t.previsto) * 100) : 0;
    linhas.push([
      t.cliente, t.nome, t.qtd,
      t.previsto.toFixed(2), t.recebido.toFixed(2), t.taxas.toFixed(2), t.recebidoLiquido.toFixed(2), t.aReceber.toFixed(2),
      pct + "%", t.custoImpressao.toFixed(2), t.custoCostureira.toFixed(2), t.custos.toFixed(2), t.lucro.toFixed(2)
    ]);
  });
  linhas.push([]);
  linhas.push([
    "TOTAL", "", f.qtd,
    f.previsto.toFixed(2), f.recebido.toFixed(2), f.taxas.toFixed(2), f.recebidoLiquido.toFixed(2), f.aReceber.toFixed(2),
    Math.round(f.pctRecebido) + "%", f.custoImpressao.toFixed(2), f.custoCostureira.toFixed(2), f.custos.toFixed(2), f.lucroPrevisto.toFixed(2)
  ]);

  // Consolidado por cliente, embaixo do detalhe por time.
  if (f.porCliente.length > 1) {
    linhas.push([]);
    linhas.push(["Cliente", "Times", "Camisetas", "Previsto", "Recebido", "A receber", "% recebido", "Lucro previsto"]);
    f.porCliente.forEach((c) => {
      linhas.push([
        c.nome, c.times, c.qtd,
        c.previsto.toFixed(2), c.recebido.toFixed(2), c.aReceber.toFixed(2),
        Math.round(c.pct) + "%", c.lucro.toFixed(2)
      ]);
    });
  }
  baixarCSV(`financeiro-interclasse${sufixoCliente()}.csv`, linhas);
}

// Extrato analítico: uma linha por pagamento, na ordem do extrato.
function exportarExtrato() {
  const { dentro, semData } = finFiltrar(finLancamentos());
  const todos = dentro.concat(semData);
  if (todos.length === 0) {
    alert("Não há recebimentos no período selecionado.");
    return;
  }
  const linhas = [["Data", "Hora", "Aluno", "Time", "Cliente", "Tamanho", "Forma", "Origem", "Valor", "Taxa MP", "Liquido"]];
  todos.forEach((l) => {
    linhas.push([
      l.data ? l.data.toLocaleDateString("pt-BR") : "sem data",
      l.data ? finHora(l.data) : "",
      l.aluno, l.time, l.cliente, l.tamanho,
      l.forma === "dinheiro" ? "Dinheiro" : "PIX",
      l.online ? "Mercado Pago" : "Manual",
      l.valor.toFixed(2), l.taxa.toFixed(2), l.liquido.toFixed(2)
    ]);
  });
  linhas.push([]);
  linhas.push([
    "TOTAL", "", "", "", "", "", "", todos.length + " pgto",
    todos.reduce((s, l) => s + l.valor, 0).toFixed(2),
    todos.reduce((s, l) => s + l.taxa, 0).toFixed(2),
    todos.reduce((s, l) => s + l.liquido, 0).toFixed(2)
  ]);
  baixarCSV(`extrato-recebimentos${sufixoCliente()}.csv`, linhas);
}

// Consolidado por dia (com acumulado) — bom para colar em planilha/gráfico.
function exportarEvolucao() {
  const { dentro } = finFiltrar(finLancamentos());
  const dias = finAgruparPorDia(dentro);
  if (dias.length === 0) {
    alert("Não há recebimentos no período selecionado.");
    return;
  }
  const linhas = [["Dia", "Qtd", "PIX", "Dinheiro", "Total do dia", "Taxa MP", "Liquido do dia", "Acumulado"]];
  dias.forEach((d) => {
    linhas.push([
      finDataDaChave(d.chave).toLocaleDateString("pt-BR"),
      d.qtd, d.pix.toFixed(2), d.dinheiro.toFixed(2), d.total.toFixed(2),
      d.taxa.toFixed(2), d.liquido.toFixed(2), d.acumulado.toFixed(2)
    ]);
  });
  baixarCSV(`recebimentos-por-dia${sufixoCliente()}.csv`, linhas);
}

// Tudo o que está em aberto, do mais antigo para o mais novo.
function exportarCobranca() {
  const pend = finPendencias()
    .filter((p) => !finTimeFiltro || p.timeId === finTimeFiltro)
    .sort((a, b) => (b.dias || 0) - (a.dias || 0));
  if (pend.length === 0) {
    alert("Não há pendências para exportar.");
    return;
  }
  const linhas = [["Aluno", "Time", "Cliente", "Tamanho", "Situacao", "Valor", "Em aberto (dias)", "Desde", "Bloqueado por ajuste"]];
  pend.forEach((p) => {
    linhas.push([
      p.aluno, p.time, p.cliente, p.tamanho,
      p.tipo === "aguardando" ? "Aguardando confirmacao" : "Pendente",
      p.valor.toFixed(2),
      p.dias === null ? "" : p.dias,
      p.desde ? p.desde.toLocaleDateString("pt-BR") : "",
      p.bloqueado ? "sim" : "nao"
    ]);
  });
  linhas.push([]);
  linhas.push(["TOTAL", "", "", "", "", pend.reduce((s, p) => s + p.valor, 0).toFixed(2), "", "", ""]);
  baixarCSV(`a-receber-interclasse${sufixoCliente()}.csv`, linhas);
}

// DRE + rentabilidade por time e por grupo.
function exportarResultado(f) {
  const linhas = [["Demonstrativo", "Valor"]];
  [
    ["Receita prevista", f.previsto],
    ["Custo de impressao", -f.custoImpressao],
    ["Custo de costureira", -f.custoCostureira],
    ["Outros custos dos lotes", -f.custoOutros],
    ["Custo das avulsas dos lotes", -f.custoAvulsas],
    ["Lucro previsto", f.lucroPrevisto],
    ["Receita recebida", f.recebido],
    ["Custo das camisetas pagas", -f.custosRecebido],
    ["Taxas do Mercado Pago", -f.taxas],
    ["Receita liquida recebida", f.recebidoLiquido],
    ["Custo das camisetas internas", -f.custoInterno],
    ["Custo das avulsas dos lotes", -f.custoAvulsas],
    ["Lucro realizado", f.lucroRealizado],
    ["Caixa a receber", f.aReceber]
  ].forEach(([r, v]) => linhas.push([r, v.toFixed(2)]));

  if (f.porCliente.length > 1) {
    linhas.push([]);
    linhas.push(["Cliente", "Times", "Qtd", "Receita prevista", "Custo", "Lucro previsto"]);
    f.porCliente.forEach((c) => {
      linhas.push([c.nome, c.times, c.qtd, c.previsto.toFixed(2), c.custos.toFixed(2), c.lucro.toFixed(2)]);
    });
  }

  linhas.push([]);
  linhas.push(["Time", "Cliente", "Qtd", "Receita prevista", "Custo", "Lucro previsto", "Margem %"]);
  [...f.porTime].sort((a, b) => b.lucro - a.lucro).forEach((t) => {
    linhas.push([t.nome, t.cliente, t.qtd, t.previsto.toFixed(2), t.custos.toFixed(2), t.lucro.toFixed(2), t.margem.toFixed(0)]);
  });

  linhas.push([]);
  linhas.push(["Grupo de tamanho", "Qtd", "Venda", "Custo", "Lucro", "Margem %"]);
  Object.keys(f.porGrupo).sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((g) => {
    const d = f.porGrupo[g];
    const lucro = d.venda - d.custo;
    const margem = d.venda > 0 ? (lucro / d.venda) * 100 : 0;
    linhas.push([g, d.qtd, d.venda.toFixed(2), d.custo.toFixed(2), lucro.toFixed(2), margem.toFixed(0)]);
  });

  baixarCSV(`resultado-interclasse${sufixoCliente()}.csv`, linhas);
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

// Exclui o time de verdade: apaga os alunos (subcoleção) e depois o time.
async function excluirTime(timeId, time) {
  const qtd = (estadoTimes[timeId] && estadoTimes[timeId].alunos.length) || 0;
  const aviso =
    `Excluir o time "${time.nome}"?\n\n` +
    `Isso apaga o time e as ${qtd} camiseta(s) cadastrada(s) nele. ` +
    `Esta ação NÃO pode ser desfeita.`;
  if (!confirm(aviso)) return;

  try {
    // Apaga a subcoleção de alunos em lote (o Firestore não faz isso sozinho).
    const alunosSnap = await db.collection(COL_TIMES).doc(timeId).collection("alunos").get();
    if (!alunosSnap.empty) {
      const lote = db.batch();
      alunosSnap.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
    await db.collection(COL_TIMES).doc(timeId).delete();
    // Apaga os preços próprios do time junto, para não sobrar lixo (se
    // falhar, não atrapalha: o time já não existe).
    try {
      await limparPrecosDoTime(timeId);
    } catch (e) {
      console.warn("Time excluído, mas não deu para apagar os preços dele.", e);
    }
    delete precosTimeAbertos["time:" + timeId];
    delete precosTimeSalvos["time:" + timeId];
    delete rascunhoConfigTime[timeId];
    // O onSnapshot dos times remove o time da lista; se ele estava aberto,
    // volta para a lista.
    if (timeAbertoAdmin === timeId) voltarParaListaAdmin();
  } catch (erro) {
    console.error(erro);
    alert(
      "Erro ao excluir o time. Verifique se as regras do Firestore permitem " +
      "'delete' para o admin (firestore.rules) e se elas foram publicadas no console."
    );
  }
}

// ============================================================
// ADICIONAR CAMISETA (Super Admin)
// ============================================================
// O caminho curto para o nome que faltou: o representante cadastra pela
// página do time, com a senha, mas quem organiza precisa conseguir incluir
// alguém na hora — inclusive com o pedido já fechado, que é justamente
// quando aparece o esquecido. O formulário fica aberto depois de salvar,
// para cadastrar um atrás do outro.

let novaCamisetaTimeId = null;

const elModalNovaCamiseta = document.getElementById("modalNovaCamiseta");
const elFormNovaCamiseta = document.getElementById("formNovaCamiseta");
const elNovaCamisetaTime = document.getElementById("novaCamisetaTime");
const elNovaCamisetaAviso = document.getElementById("novaCamisetaAviso");
const elNovaCamisetaNome = document.getElementById("novaCamisetaNome");
const elNovaCamisetaTamanho = document.getElementById("novaCamisetaTamanho");
const elNovaCamisetaNumero = document.getElementById("novaCamisetaNumero");
const elNovaCamisetaCostas = document.getElementById("novaCamisetaCostas");
const elNovaCamisetaQtd = document.getElementById("novaCamisetaQtd");
const elNovaCamisetaGoleiro = document.getElementById("novaCamisetaGoleiro");
const elNovaCamisetaProf = document.getElementById("novaCamisetaProf");
const elMsgNovaCamiseta = document.getElementById("msgNovaCamiseta");
const elNovaCamisetaDuplicado = document.getElementById("novaCamisetaDuplicado");

function abrirNovaCamiseta(timeId) {
  const estado = estadoTimes[timeId];
  if (!estado || !elModalNovaCamiseta) return;

  novaCamisetaTimeId = timeId;
  const time = estado.time;

  if (elNovaCamisetaTime) {
    elNovaCamisetaTime.innerHTML =
      `Time <strong>${escapeHtmlAdmin(time.nome)}</strong> &middot; ${escapeHtmlAdmin(nomeClienteDoTime(time))}`;
  }

  // O pedido já andou? A camiseta nova entra fora do que já foi exportado —
  // melhor dizer isso antes de cadastrar do que descobrir na gráfica.
  if (elNovaCamisetaAviso) {
    const statusId = statusPedidoDe(time);
    let aviso = "";
    if (pedidoEmProducao(time)) {
      aviso = `${icone("triangle-alert")} Este pedido já está em <strong>${escapeHtmlAdmin(labelStatus(statusId))}</strong>: ` +
        "a camiseta nova entra como pendente e não está nos CSVs já exportados. " +
        "Confirme o pagamento e leve no próximo lote.";
    } else if (statusId !== "aberto") {
      aviso = `Este pedido está em <strong>${escapeHtmlAdmin(labelStatus(statusId))}</strong> — ` +
        "o representante não consegue mais cadastrar por conta própria, mas você sim.";
    }
    elNovaCamisetaAviso.innerHTML = aviso;
    elNovaCamisetaAviso.classList.toggle("oculto", !aviso);
  }

  preencherSelectTamanhos(elNovaCamisetaTamanho);
  limparNovaCamiseta();
  if (elMsgNovaCamiseta) esconderMensagem(elMsgNovaCamiseta);

  elModalNovaCamiseta.classList.remove("oculto");
  if (elNovaCamisetaNome) elNovaCamisetaNome.focus();
}

// Número repetido dentro do time é problema conhecido (a página do time já
// avisa na conferência): melhor apontar enquanto se digita do que depois.
function conferirNumeroRepetido() {
  if (!elNovaCamisetaDuplicado) return;
  const estado = estadoTimes[novaCamisetaTimeId];
  const numero = elNovaCamisetaNumero ? elNovaCamisetaNumero.value.trim() : "";
  const donos = !numero || !estado
    ? []
    : [...new Set(estado.alunos.filter((a) => String(a.numero || "") === numero).map((a) => a.nome))];

  elNovaCamisetaDuplicado.textContent = donos.length
    ? `⚠️ O número ${numero} já é de ${donos.join(", ")} neste time.`
    : "";
  elNovaCamisetaDuplicado.classList.toggle("oculto", donos.length === 0);
}

if (elNovaCamisetaNumero) {
  elNovaCamisetaNumero.addEventListener("input", conferirNumeroRepetido);
}

function limparNovaCamiseta() {
  if (elNovaCamisetaNome) elNovaCamisetaNome.value = "";
  if (elNovaCamisetaNumero) elNovaCamisetaNumero.value = "";
  if (elNovaCamisetaCostas) elNovaCamisetaCostas.value = "";
  if (elNovaCamisetaQtd) elNovaCamisetaQtd.value = "1";
  if (elNovaCamisetaGoleiro) elNovaCamisetaGoleiro.checked = false;
  if (elNovaCamisetaProf) elNovaCamisetaProf.checked = false;
  // O tamanho também volta ao "Selecione...": cadastrar o próximo com o
  // tamanho do anterior por descuido é erro caro (camiseta errada).
  if (elNovaCamisetaTamanho) elNovaCamisetaTamanho.value = "";
  conferirNumeroRepetido();
}

function fecharNovaCamiseta() {
  novaCamisetaTimeId = null;
  if (elModalNovaCamiseta) elModalNovaCamiseta.classList.add("oculto");
}

if (elFormNovaCamiseta) {
  elFormNovaCamiseta.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const timeId = novaCamisetaTimeId;
    if (!timeId || !estadoTimes[timeId]) return;

    const nome = elNovaCamisetaNome.value.trim();
    const tamanho = elNovaCamisetaTamanho.value;
    if (!nome || !tamanho) {
      mostrarMensagem(elMsgNovaCamiseta, "Preencha o nome e o tamanho.", "erro");
      return;
    }

    const botao = elFormNovaCamiseta.querySelector("button[type=submit]");
    botao.disabled = true;
    try {
      // Mesmo formato do cadastro feito na página do time (js/time.js) —
      // inclusive `excluido: false`, sem o qual a camiseta não apareceria
      // na lista (a consulta filtra por esse campo).
      const quantidade = lerQuantidadeCamisetas(elNovaCamisetaQtd);
      await cadastrarCamisetasIguais(timeId, {
        nome,
        tamanho,
        numero: elNovaCamisetaNumero.value.trim(),
        // Em branco, o que vai estampado é o nome do estudante.
        nomeCamiseta: elNovaCamisetaCostas.value.trim() || nome,
        goleiro: !!(elNovaCamisetaGoleiro && elNovaCamisetaGoleiro.checked),
        prof: !!(elNovaCamisetaProf && elNovaCamisetaProf.checked)
      }, quantidade);

      // Deixa a lista do time aberta para a camiseta nova aparecer ao fechar.
      estadoTimes[timeId].expandido = true;
      mostrarMensagem(elMsgNovaCamiseta, quantidade > 1
        ? `✅ ${quantidade} camisetas iguais de ${nome} entraram na lista. Pode cadastrar o próximo.`
        : `✅ ${nome} entrou na lista. Pode cadastrar o próximo.`, "aviso");
      limparNovaCamiseta();
      elNovaCamisetaNome.focus();
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgNovaCamiseta, "Erro ao adicionar a camiseta. Tente novamente.", "erro");
    } finally {
      botao.disabled = false;
    }
  });
}

const elFecharNovaCamiseta = document.getElementById("fecharNovaCamiseta");
if (elFecharNovaCamiseta) elFecharNovaCamiseta.addEventListener("click", fecharNovaCamiseta);
if (elModalNovaCamiseta) {
  // Clique no fundo escuro fecha; dentro do formulário, não.
  elModalNovaCamiseta.addEventListener("click", (ev) => {
    if (ev.target === elModalNovaCamiseta) fecharNovaCamiseta();
  });
}
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && elModalNovaCamiseta && !elModalNovaCamiseta.classList.contains("oculto")) {
    fecharNovaCamiseta();
  }
});

// Célula "Goleiro" da lista do Super Admin: caixa de marcar que grava na hora.
// O goleiro veste uma camiseta de cor diferente, então a marca acompanha a
// camiseta até a produção, que a separa num arquivo próprio.
function preencherCelulaGoleiroAdmin(td, timeId, aluno) {
  if (!td) return;
  td.innerHTML = "";

  td.appendChild(criarCheckGoleiro(aluno, (valor, chk) => {
    chk.disabled = true;
    db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id)
      .update({ goleiro: valor })
      .catch((erro) => {
        console.error(erro);
        alert("Não foi possível salvar a marca de goleiro. Tente novamente.");
        renderizarTimesAdmin();
      })
      .finally(() => { chk.disabled = false; });
  }));
}

// Célula "Prof" da lista do Super Admin: marca de camiseta de professor, só
// para organização (não muda nada na produção). Grava na hora.
function preencherCelulaProfAdmin(td, timeId, aluno) {
  if (!td) return;
  td.innerHTML = "";

  td.appendChild(criarCheckProf(aluno, (valor, chk) => {
    chk.disabled = true;
    db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id)
      .update({ prof: valor })
      .catch((erro) => {
        console.error(erro);
        alert("Não foi possível salvar a marca de prof. Tente novamente.");
        renderizarTimesAdmin();
      })
      .finally(() => { chk.disabled = false; });
  }));
}

// Edição inline de um aluno no Super Admin (permite corrigir a linha mesmo
// com o pedido fechado). Ao salvar, resolve o pedido de ajuste, se houver.
function editarAlunoAdmin(tr, timeId, aluno) {
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

  const tdGoleiro = document.createElement("td");
  const rotuloGoleiro = criarCheckGoleiro(aluno);
  tdGoleiro.appendChild(rotuloGoleiro);

  const tdProf = document.createElement("td");
  const rotuloProf = criarCheckProf(aluno);
  tdProf.appendChild(rotuloProf);

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
        nomeCamiseta: novoCostas,
        goleiro: rotuloGoleiro.chk.checked,
        prof: rotuloProf.chk.checked
      };
      if (aluno.ajusteSolicitado) {
        // Corrigir a linha resolve o ajuste e registra no histórico.
        dados.ajusteSolicitado = false;
        dados.ajusteProposto = firebase.firestore.FieldValue.delete();
        dados.ajusteResolvidoEm = firebase.firestore.FieldValue.serverTimestamp();
        dados.ajusteHistorico = firebase.firestore.FieldValue.arrayUnion({ tipo: "resolvido", em: Date.now() });
      }
      await db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update(dados);
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
  btnCancelar.onclick = () => renderizarTimesAdmin();

  tdAcoes.appendChild(btnSalvar);
  tdAcoes.appendChild(btnCancelar);

  const tdPagamento = document.createElement("td"); // coluna de pagamento (vazia na edição)
  [[tdNome, "Nome"], [tdTamanho, "Tamanho"], [tdNumero, "Número"], [tdCostas, "Nome na camiseta"],
    [tdGoleiro, "Goleiro"], [tdProf, "Prof"], [tdPagamento, ""], [tdAcoes, ""]]
    .forEach(([td, rotulo]) => (td.dataset.label = rotulo));
  tr.classList.add("linha-editando");

  tr.appendChild(tdNome);
  tr.appendChild(tdTamanho);
  tr.appendChild(tdNumero);
  tr.appendChild(tdCostas);
  tr.appendChild(tdGoleiro);
  tr.appendChild(tdProf);
  tr.appendChild(tdPagamento);
  tr.appendChild(tdAcoes);
}

// Imagens de cada time: a simulação na camiseta e a arte pura (sem simulação).
// `campo` é o nome do campo no time; as duas seguem o mesmo fluxo de upload.
const IMAGENS_TIME = [
  {
    campo: "imagemUrl",
    tipo: "camiseta",
    alt: "Simulação da camiseta",
    titulo: "Simulação na camiseta",
    labelEnviar: "Enviar simulação da camiseta",
    labelTrocar: "Trocar simulação",
    labelRemover: "Remover simulação",
    confirmRemover: "Remover a simulação da camiseta deste time?"
  },
  {
    campo: "arteUrl",
    tipo: "arte",
    alt: "Arte da camiseta (sem simulação)",
    titulo: "Arte (sem simulação)",
    labelEnviar: "Enviar arte (sem simulação)",
    labelTrocar: "Trocar arte",
    labelRemover: "Remover arte",
    confirmRemover: "Remover a arte (sem simulação) deste time?"
  }
];

// ---------------- Preços especiais (por cliente e por time) ----------------
// Por cima da tabela geral (aba Pagamentos), grupo a grupo: o preço do
// cliente (vale para todos os times dele) e o do time (ganha do cliente).
// Ficam na coleção `precos` (docs "cliente_ID" e "time_ID") — ver o
// comentário em js/utils.js: qualquer um lê um documento pelo id, mas só o
// admin lista a coleção, então um cliente não descobre o preço dos outros.

const precosAdmin = { time: {}, cliente: {}, aluno: {} }; // espelho da coleção `precos`
let precosAdminCarregados = false;
let precosAdminErro = false;   // regras do Firestore ainda sem a coleção
let precosMigracaoFeita = false;

// Pendura os preços especiais no configGeralAtual (só em memória), para
// precosDoTime() e companhia enxergarem cliente e time.
function anexarPrecosAdmin() {
  configGeralAtual._precosTime = precosAdmin.time;
  configGeralAtual._precosCliente = precosAdmin.cliente;
  configGeralAtual._precosAluno = precosAdmin.aluno;
  configGeralAtual._clienteDoTime = (id) => (estadoTimes[id] ? clienteIdDoTime(estadoTimes[id].time) : "");
}

function escutarPrecos() {
  db.collection(COL_PRECOS).onSnapshot(
    (snap) => {
      precosAdmin.time = {};
      precosAdmin.cliente = {};
      precosAdmin.aluno = {};
      snap.forEach((doc) => {
        const d = doc.data();
        if (doc.id.startsWith("time_")) {
          if (d.precos) precosAdmin.time[doc.id.slice(5)] = d.precos;
          if (d.porAluno) precosAdmin.aluno[doc.id.slice(5)] = d.porAluno;
        } else if (doc.id.startsWith("cliente_")) {
          precosAdmin.cliente[doc.id.slice(8)] = d.precos || {};
        }
      });
      precosAdminCarregados = true;
      precosAdminErro = false;
      anexarPrecosAdmin();
      migrarPrecosAntigos();
      renderizarClientesAdmin();
      renderizarTimesAdmin();
    },
    (erro) => {
      console.error("Erro ao ler os preços especiais:", erro);
      precosAdminErro = true;
      renderizarClientesAdmin();
      renderizarTimesAdmin();
    }
  );
}

// Os preços por time moravam em config/geral (legível por todos). Quando a
// coleção nova já está acessível, move cada um para "time_ID", marca o time
// e apaga o campo antigo. Roda uma vez, depois de carregar o config e os
// preços (se as regras novas não estiverem publicadas, fica para depois).
async function migrarPrecosAntigos() {
  if (precosMigracaoFeita || !precosAdminCarregados || !painelConfigPronto || !timesCarregados) return;
  const antigos = mapaPrecosPorTime(configGeralAtual);
  const ids = Object.keys(antigos);
  precosMigracaoFeita = true;
  if (ids.length === 0) return;
  try {
    const lote = db.batch();
    ids.forEach((id) => {
      const p = precosLimpos(antigos[id]);
      // Se já existe o documento novo, ele é o que vale.
      if (!precosAdmin.time[id] && Object.keys(p).length > 0) {
        lote.set(db.collection(COL_PRECOS).doc(idDocPrecoTime(id)), { precos: p, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });
      }
      if (estadoTimes[id] && Object.keys(p).length > 0) {
        lote.update(db.collection(COL_TIMES).doc(id), { temPrecoEspecial: true });
      }
    });
    lote.update(db.collection("config").doc("geral"), {
      precosPorTime: firebase.firestore.FieldValue.delete(),
      precosPorTurma: firebase.firestore.FieldValue.delete()
    });
    await lote.commit();
    delete configGeralAtual.precosPorTime;
    delete configGeralAtual.precosPorTurma;
  } catch (erro) {
    console.error("Não foi possível mover os preços por time para a coleção protegida.", erro);
    precosMigracaoFeita = false; // tenta de novo no próximo carregamento
  }
}

// Bloco da tabela especial de preço, com um campo por grupo.
//   tipo "time": aba Configuração do time; a base é o geral com o do cliente.
//   tipo "cliente": card do cliente (aba Clientes); a base é o geral.
function criarBlocoPrecos(tipo, id) {
  const chave = tipo + ":" + id;
  const ehTime = tipo === "time";
  const bloco = document.createElement("details");
  bloco.className = "precos-time";
  bloco.open = !!precosTimeAbertos[chave];
  bloco.addEventListener("toggle", () => {
    precosTimeAbertos[chave] = bloco.open;
  });

  const personalizados = ehTime
    ? precosPersonalizadosDoTime(configGeralAtual, id)
    : precosPersonalizadosDoCliente(configGeralAtual, id);
  const nPersonalizados = Object.keys(personalizados).length;

  const resumo = document.createElement("summary");
  resumo.innerHTML =
    (ehTime ? "Preço da camiseta neste time " : "Preço da camiseta para este cliente ") +
    (nPersonalizados > 0
      ? `<span class="badge interno">${nPersonalizados} preço(s) próprio(s)</span>`
      : '<span class="badge pendente">tabela geral</span>');
  bloco.appendChild(resumo);

  const corpo = document.createElement("div");
  corpo.className = "precos-time-corpo";

  if (GRUPOS_TAMANHO.length === 0) {
    corpo.innerHTML = "<p>Cadastre os tamanhos primeiro (aba Tamanhos).</p>";
    bloco.appendChild(corpo);
    return bloco;
  }
  if (precosAdminErro) {
    corpo.innerHTML = '<p class="erro">Publique o <strong>firestore.rules</strong> atualizado no console do Firebase: os preços especiais agora ficam na coleção protegida <code>precos</code>.</p>';
    bloco.appendChild(corpo);
    return bloco;
  }

  // O que vale sem o preço próprio: no time, o geral com o do cliente por cima.
  const gerais = precosLimpos(configGeralAtual.precosPorGrupo || {});
  const clienteDoTime = ehTime && estadoTimes[id] ? clienteIdDoTime(estadoTimes[id].time) : "";
  const doCliente = ehTime ? precosPersonalizadosDoCliente(configGeralAtual, clienteDoTime) : {};

  const ajuda = document.createElement("small");
  ajuda.className = "pix-ajuda";
  ajuda.textContent = ehTime
    ? "Deixe em branco para usar o preço do cliente ou o geral. O valor preenchido vale só para este time — no PIX, no Mercado Pago e no Financeiro."
    : "Deixe em branco para usar o preço geral. O valor preenchido vale para todos os times deste cliente (um time com preço próprio ainda ganha deste). Outros clientes não veem este valor.";
  corpo.appendChild(ajuda);

  const grade = document.createElement("div");
  grade.className = "linha-custos precos-time-grade";

  GRUPOS_TAMANHO.forEach((g) => {
    const wrap = document.createElement("div");
    wrap.className = "campo-custo";

    const lbl = document.createElement("label");
    lbl.textContent = `${g.grupo} (R$)`;

    const doClienteG = doCliente[g.grupo];
    const base = doClienteG != null ? doClienteG : gerais[g.grupo];
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.min = "0";
    inp.dataset.grupo = g.grupo;
    inp.placeholder = base != null ? Number(base).toFixed(2) : "0,00";
    inp.value = personalizados[g.grupo] != null ? personalizados[g.grupo] : "";

    const dica = document.createElement("small");
    dica.className = "pix-ajuda";
    dica.textContent = doClienteG != null
      ? `Cliente: ${formatarReais(doClienteG)}`
      : gerais[g.grupo] != null ? `Geral: ${formatarReais(gerais[g.grupo])}` : "Sem preço geral";

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(dica);
    grade.appendChild(wrap);
  });

  corpo.appendChild(grade);

  const msg = document.createElement("p");
  msg.className = "oculto";
  const acoes = document.createElement("div");

  const btnSalvar = document.createElement("button");
  btnSalvar.className = "sucesso";
  btnSalvar.textContent = ehTime ? "Salvar preços do time" : "Salvar preços do cliente";
  btnSalvar.onclick = async () => {
    const mapa = {};
    let invalido = false;
    grade.querySelectorAll("input").forEach((inp) => {
      const bruto = inp.value.trim();
      if (bruto === "") return; // vazio = usa a base
      const v = parseFloat(bruto.replace(",", "."));
      if (isNaN(v) || v < 0) invalido = true;
      else mapa[inp.dataset.grupo] = v;
    });
    if (invalido) {
      mostrarMensagem(msg, "Informe valores válidos (0 ou mais) ou deixe em branco.", "erro");
      return;
    }
    btnSalvar.disabled = true;
    try {
      await gravarPrecosEspeciais(tipo, id, mapa);
      precosTimeAbertos[chave] = true;
      precosTimeSalvos[chave] = Object.keys(mapa).length > 0
        ? (ehTime ? "Preços deste time salvos." : "Preços deste cliente salvos.")
        : "Sem preço próprio: volta a valer a tabela geral.";
      renderizarClientesAdmin();
      renderizarTimesAdmin();
    } catch (erro) {
      console.error(erro);
      btnSalvar.disabled = false;
      mostrarMensagem(msg, "Erro ao salvar. Confira se o firestore.rules atualizado foi publicado no Firebase.", "erro");
    }
  };
  acoes.appendChild(btnSalvar);

  if (nPersonalizados > 0) {
    const btnLimpar = document.createElement("button");
    btnLimpar.className = "secundario";
    btnLimpar.textContent = "Usar a tabela geral";
    btnLimpar.title = ehTime ? "Apaga os preços próprios deste time" : "Apaga os preços próprios deste cliente";
    btnLimpar.onclick = async () => {
      if (!confirm(`Apagar os preços próprios deste ${ehTime ? "time" : "cliente"} e voltar para a tabela geral?`)) return;
      btnLimpar.disabled = true;
      try {
        await gravarPrecosEspeciais(tipo, id, {});
        precosTimeAbertos[chave] = true;
        precosTimeSalvos[chave] = "Preços próprios apagados: vale a tabela geral.";
        renderizarClientesAdmin();
        renderizarTimesAdmin();
      } catch (erro) {
        console.error(erro);
        btnLimpar.disabled = false;
        mostrarMensagem(msg, "Erro ao apagar os preços.", "erro");
      }
    };
    acoes.appendChild(btnLimpar);
  }

  corpo.appendChild(acoes);
  corpo.appendChild(msg);

  // Aviso de "salvo" que sobrevive ao re-render disparado pelo próprio salvar.
  if (precosTimeSalvos[chave]) {
    mostrarMensagem(msg, precosTimeSalvos[chave], "aviso");
    delete precosTimeSalvos[chave];
  }
  bloco.appendChild(corpo);
  return bloco;
}

function criarBlocoPrecosTime(timeId) {
  return criarBlocoPrecos("time", timeId);
}

// Grava (ou apaga, com mapa vazio) os preços especiais de um cliente/time e a
// marca temPrecoEspecial no documento dele. Também tira o time do campo
// antigo em config/geral, se ele ainda estiver lá.
async function gravarPrecosEspeciais(tipo, id, mapa) {
  const ehTime = tipo === "time";
  const ref = db.collection(COL_PRECOS).doc(ehTime ? idDocPrecoTime(id) : idDocPrecoCliente(id));
  const tem = Object.keys(mapa).length > 0;
  // O documento do time também guarda os preços por camiseta (porAluno):
  // só troca o campo `precos` e só apaga o documento quando não sobra nada.
  const temPorAluno = ehTime && Object.keys(precosAdmin.aluno[id] || {}).length > 0;
  const lote = db.batch();
  if (tem || temPorAluno) {
    lote.set(ref, { precos: mapa, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() },
      { mergeFields: ["precos", "atualizadoEm"] });
  } else {
    lote.delete(ref);
  }
  const dono = ehTime ? estadoTimes[id] : estadoClientes[id];
  if (dono) {
    lote.update(db.collection(ehTime ? COL_TIMES : COL_CLIENTES).doc(id), { temPrecoEspecial: tem });
  }
  if (ehTime && mapaPrecosPorTime(configGeralAtual)[id]) {
    lote.set(db.collection("config").doc("geral"), {
      precosPorTime: { [id]: firebase.firestore.FieldValue.delete() },
      precosPorTurma: { [id]: firebase.firestore.FieldValue.delete() }
    }, { merge: true });
  }
  await lote.commit();
  if (ehTime && configGeralAtual.precosPorTime) delete configGeralAtual.precosPorTime[id];
  if (ehTime && configGeralAtual.precosPorTurma) delete configGeralAtual.precosPorTurma[id];
}

// Preço especial de UMA camiseta (valor = número, ou null para tirar).
async function gravarPrecoAluno(timeId, alunoId, valor) {
  await db.collection(COL_PRECOS).doc(idDocPrecoTime(timeId)).set({
    porAluno: { [alunoId]: valor == null ? firebase.firestore.FieldValue.delete() : valor },
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// Apaga os preços próprios de um time excluído (o documento do time já não
// existe, então só o de preços e o campo antigo).
async function limparPrecosDoTime(timeId) {
  await db.collection(COL_PRECOS).doc(idDocPrecoTime(timeId)).delete();
  if (mapaPrecosPorTime(configGeralAtual)[timeId]) {
    await db.collection("config").doc("geral").set({
      precosPorTime: { [timeId]: firebase.firestore.FieldValue.delete() },
      precosPorTurma: { [timeId]: firebase.firestore.FieldValue.delete() }
    }, { merge: true });
  }
}

// Bloco de imagens da camiseta no card do Super Admin (enviar/trocar/remover).
function criarBlocoImagemTime(timeId, time) {
  const bloco = document.createElement("div");
  bloco.className = "bloco-imagens-admin";

  // Checkbox: liga/desliga a marca d'água SOBREPOSTA (não altera os arquivos).
  // Vale na hora e para imagens já enviadas — é só uma camada na exibição,
  // aplicada tanto na simulação quanto na arte.
  const lblMarca = document.createElement("label");
  lblMarca.className = "checkbox-inline check-marca";
  const chkMarca = document.createElement("input");
  chkMarca.type = "checkbox";
  chkMarca.checked = time.marcaDagua === true;
  chkMarca.onchange = () => {
    // Atualiza o estado local na hora e persiste o flag no time.
    if (estadoTimes[timeId]) estadoTimes[timeId].time.marcaDagua = chkMarca.checked;
    db.collection(COL_TIMES).doc(timeId).update({ marcaDagua: chkMarca.checked })
      .then(() => renderizarTimesAdmin())
      .catch((e) => console.error("Falha ao salvar a marca d'água:", e));
  };
  lblMarca.appendChild(chkMarca);
  lblMarca.appendChild(document.createTextNode(" Marca d'água de referência (sobreposta nas duas imagens)"));
  bloco.appendChild(lblMarca);

  IMAGENS_TIME.forEach((cfg) => {
    bloco.appendChild(criarLinhaImagemTime(timeId, time, cfg));
  });

  return bloco;
}

// Uma linha do bloco acima: miniatura + botões de enviar/trocar e remover.
function criarLinhaImagemTime(timeId, time, cfg) {
  const linha = document.createElement("div");
  linha.className = "bloco-imagem-admin";

  const rotulo = document.createElement("span");
  rotulo.className = "rotulo-imagem";
  rotulo.textContent = cfg.titulo;
  linha.appendChild(rotulo);

  const urlAtual = time[cfg.campo];

  if (urlAtual) {
    const thumb = document.createElement("img");
    thumb.className = "thumb-camiseta";
    thumb.src = urlAtual;
    thumb.alt = cfg.alt;
    // Sobrepõe a marca d'água (sem alterar o arquivo) quando ativada no time.
    linha.appendChild(envolverImagemComMarca(thumb, time.marcaDagua === true));
  }

  const inputImg = document.createElement("input");
  inputImg.type = "file";
  inputImg.accept = "image/*";
  inputImg.style.display = "none";

  const btnImg = document.createElement("button");
  btnImg.className = "secundario";
  btnImg.textContent = urlAtual ? cfg.labelTrocar : cfg.labelEnviar;
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
      const url = await enviarImagemDrive(driveScriptUrl, timeId, file, cfg.tipo);
      await db.collection(COL_TIMES).doc(timeId).update({ [cfg.campo]: url });
    } catch (e) {
      console.error(e);
      alert("Erro ao enviar a imagem: " + e.message);
    } finally {
      btnImg.disabled = false;
      btnImg.textContent = antes;
      inputImg.value = "";
    }
  };

  linha.appendChild(btnImg);

  if (urlAtual) {
    const btnRemover = document.createElement("button");
    btnRemover.className = "perigo";
    btnRemover.textContent = cfg.labelRemover;
    btnRemover.onclick = () => {
      if (confirm(cfg.confirmRemover)) {
        db.collection(COL_TIMES).doc(timeId)
          .update({ [cfg.campo]: firebase.firestore.FieldValue.delete() });
      }
    };
    linha.appendChild(btnRemover);
  }

  linha.appendChild(inputImg);
  return linha;
}

function escapeHtmlAdmin(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// ---------------- Exportação ----------------

// CSV que vai para o programa de impressão: só o que será produzido (pago),
// sem cabeçalho e separado por vírgula — nome na camiseta, número e tamanho.
function exportarProducaoTime(time, alunos) {
  const { produzir, pendentes } = separarProducao(alunos);
  if (produzir.length === 0) {
    alert("Nenhuma camiseta paga neste time — não há o que produzir ainda.");
    return;
  }
  if (pendentes.length > 0 && !confirm(
    pendentes.length + " camiseta(s) não paga(s) ficam de fora da produção.\n\n" +
    "Exportar as " + produzir.length + " camiseta(s) pagas?"
  )) return;
  const saida = baixarCSVProducaoSeparado(`producao-${slugify(time.nome)}.csv`, produzir);
  avisarGoleirosSeparados(saida);
}

// Conta para o admin quando os goleiros saíram num arquivo à parte — o
// download extra não pode passar despercebido.
function avisarGoleirosSeparados(saida) {
  if (!saida || saida.goleiros === 0) return;
  alert(
    `🧤 ${saida.goleiros} camiseta(s) de goleiro saíram num arquivo à parte ` +
    `("...-goleiros.csv"), porque a cor é outra.` +
    (saida.demais > 0 ? `\n\nO arquivo principal traz as outras ${saida.demais}.` : "")
  );
}

// CSV de conferência: a lista completa do time, com situação de pagamento.
function exportarTime(time, alunos) {
  if (alunos.length === 0) {
    alert("Esse time não tem alunos cadastrados.");
    return;
  }
  const linhas = [["Cliente", "Time", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta", "Goleiro", "Prof", "Pago", "Forma Pagto"]];
  const cliente = nomeClienteDoTime(time);
  alunos.forEach((a) =>
    linhas.push([cliente, time.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || "", ehGoleiro(a) ? "Sim" : "Nao", ehProf(a) ? "Sim" : "Nao", a.pago ? "Sim" : "Nao", a.pagamentoForma || ""])
  );
  baixarCSV(`pedido-${slugify(time.nome)}.csv`, linhas);
}

// CSV geral de produção: junta todos os times, só o que será produzido.
elBtnExportarTudo.addEventListener("click", () => {
  const produzir = [];
  let pendentes = 0;
  timesFiltrados().forEach(([, { alunos }]) => {
    const separado = separarProducao(alunos);
    produzir.push(...separado.produzir);
    pendentes += separado.pendentes.length;
  });
  if (produzir.length === 0) {
    alert(clienteFiltro
      ? "Nenhuma camiseta paga no cliente escolhido — não há o que produzir."
      : "Nenhuma camiseta paga ainda — não há o que produzir.");
    return;
  }
  if (pendentes > 0 && !confirm(
    pendentes + " camiseta(s) não paga(s) ficam de fora da produção.\n\n" +
    "Exportar as " + produzir.length + " camiseta(s) pagas?"
  )) return;
  avisarGoleirosSeparados(
    baixarCSVProducaoSeparado(`producao-interclasse-geral${sufixoCliente()}.csv`, produzir)
  );
});

// CSV geral de conferência: tudo, com time e situação de pagamento.
if (elBtnExportarConferencia) {
  elBtnExportarConferencia.addEventListener("click", () => {
    const linhas = [["Cliente", "Time", "Nome do Estudante", "Tamanho", "Numero", "Nome na Camiseta", "Goleiro", "Prof", "Pago", "Forma Pagto"]];
    let total = 0;
    timesFiltrados().forEach(([, { time, alunos }]) => {
      alunos.forEach((a) => {
        linhas.push([nomeClienteDoTime(time), time.nome, a.nome, a.tamanho, a.numero || "", a.nomeCamiseta || "", ehGoleiro(a) ? "Sim" : "Nao", ehProf(a) ? "Sim" : "Nao", a.pago ? "Sim" : "Nao", a.pagamentoForma || ""]);
        total++;
      });
    });
    if (total === 0) {
      alert(clienteFiltro
        ? "Não há alunos cadastrados nos times do cliente escolhido."
        : "Não há alunos cadastrados em nenhum time.");
      return;
    }
    baixarCSV(`pedido-interclasse-geral${sufixoCliente()}.csv`, linhas);
  });
}

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
let configGeralAtual = {};    // config/geral inteiro (+ os preços especiais em memória)
let painelConfigPronto = false; // config/geral já carregado (a migração de preços espera)

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

  configGeralAtual = cfg || {};
  anexarPrecosAdmin();
  painelConfigPronto = true;
  migrarPrecosAntigos();
  precosPorGrupoAtual = cfg.precosPorGrupo || {};

  await carregarTamanhos();
  gruposTamanhoEdit = clonarGrupos(GRUPOS_TAMANHO);
  renderizarEditorTamanhos();
  // Moldes, layout e produção podem ter desenhado antes (com os tamanhos
  // padrão, sem os grupos novos): redesenha com a lista de verdade.
  redesenharListasDeTamanho();

  // Pagamento (PIX)
  elPixChave.value = cfg.pixChave || "";
  elPixNome.value = cfg.pixNome || "";
  elPixCidade.value = cfg.pixCidade || "";
  elMpAtivo.checked = cfg.mpAtivo === true;
  elMpBackendUrl.value = cfg.mpBackendUrl || "";
  renderizarPrecosPorGrupo(cfg.precosPorGrupo || {});

  // Com preços e custos já carregados, atualiza o financeiro e os cards das
  // times (que mostram o preço em vigor em cada uma).
  renderizarFinanceiro();
  renderizarTimesAdmin();
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
    configGeralAtual = { ...configGeralAtual, ...dados };
    renderizarEditorTamanhos();
    // Os preços dos times partem do geral: re-renderiza para refletir a base.
    renderizarTimesAdmin();
    mostrarMensagem(elMsgPix, "Dados de pagamento salvos.", "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(elMsgPix, textoErroConfig(erro, "geral"), "erro");
  }
});

// Explica o erro do Firestore ao salvar configurações: o código real ajuda a
// saber se foi falta de permissão (sessão do admin caiu / regras antigas no
// console) ou um dado recusado.
function textoErroConfig(erro, docId) {
  const code = (erro && erro.code) || "";
  if (code === "permission-denied") {
    const user = auth.currentUser;
    if (!ehContaAdmin(user)) {
      return "Erro ao salvar: você não está logado como administrador (a sessão pode ter caído). Saia e entre de novo no Super Admin.";
    }
    return `Erro ao salvar: o Firestore recusou a escrita em config/${docId}. Publique o firestore.rules atualizado no console do Firebase.`;
  }
  if (code === "unavailable") return "Erro ao salvar: sem conexão com o Firebase. Confira a internet e tente de novo.";
  return `Erro ao salvar em config/${docId}: ${(erro && erro.message) || erro}${code ? ` (${code})` : ""}`;
}

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
    mostrarMensagem(elMsgConfigGeral, textoErroConfig(erro, "geral"), "erro");
  }
});

// ---------------- Editor de tamanhos ----------------

// Telas de outros arquivos que listam os tamanhos (moldes de corte, editor de
// layout/prévias, filtros e avulsas da Produção, cards dos times). Chamado
// quando a lista de tamanhos chega do Firestore e quando ela é salva.
function redesenharListasDeTamanho() {
  if (typeof renderizarMoldes === "function") renderizarMoldes();
  if (typeof renderizarEditorLayout === "function") renderizarEditorLayout();
  if (typeof renderizarProducao === "function") renderizarProducao();
  if (typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
}

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

    // Imagem de referência de medidas deste grupo (aparece na página do pedido).
    box.appendChild(criarBlocoImagemGrupo(grupo, iGrupo));

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

// Imagem de referência de medidas do grupo (ex.: tabela de medidas do Infantil).
// Fica salva em config/tamanhos junto com o grupo e aparece na página do pedido.
function criarBlocoImagemGrupo(grupo, iGrupo) {
  const bloco = document.createElement("div");
  bloco.className = "bloco-imagem-grupo";

  const titulo = document.createElement("div");
  titulo.className = "bloco-custos-titulo";
  titulo.textContent = "Imagem de referência de medidas";
  bloco.appendChild(titulo);

  const linha = document.createElement("div");
  linha.className = "bloco-imagem-admin";

  if (grupo.imagemUrl) {
    const thumb = document.createElement("img");
    thumb.className = "thumb-camiseta";
    thumb.src = grupo.imagemUrl;
    thumb.alt = "Medidas do grupo " + grupo.grupo;
    // Clicar amplia, igual à página do pedido — para conferir antes de salvar.
    tornarImagemAmpliavel(thumb, "Medidas — " + grupo.grupo, false);
    linha.appendChild(thumb);
  }

  const inputImg = document.createElement("input");
  inputImg.type = "file";
  inputImg.accept = "image/*";
  inputImg.style.display = "none";

  const btnImg = document.createElement("button");
  btnImg.type = "button";
  btnImg.className = "secundario";
  btnImg.textContent = grupo.imagemUrl ? "Trocar imagem" : "Enviar imagem de medidas";
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
      const nomeArquivo = slugify(gruposTamanhoEdit[iGrupo].grupo || "grupo");
      const url = await enviarImagemDrive(driveScriptUrl, nomeArquivo, file, "tamanho");
      gruposTamanhoEdit[iGrupo].imagemUrl = url;
      renderizarEditorTamanhos();
      // O upload já foi feito, mas o vínculo com o grupo só vale depois de salvar.
      mostrarMensagem(elMsgTamanhos, 'Imagem enviada. Clique em "Salvar tamanhos" para aplicar.', "aviso");
    } catch (e) {
      console.error(e);
      alert("Erro ao enviar a imagem: " + e.message);
      btnImg.disabled = false;
      btnImg.textContent = antes;
      inputImg.value = "";
    }
  };

  linha.appendChild(btnImg);

  if (grupo.imagemUrl) {
    const btnRemover = document.createElement("button");
    btnRemover.type = "button";
    btnRemover.className = "perigo";
    btnRemover.textContent = "Remover imagem";
    btnRemover.onclick = () => {
      if (!confirm("Remover a imagem de medidas do grupo " + grupo.grupo + "?")) return;
      delete gruposTamanhoEdit[iGrupo].imagemUrl;
      renderizarEditorTamanhos();
      mostrarMensagem(elMsgTamanhos, 'Imagem removida. Clique em "Salvar tamanhos" para aplicar.', "aviso");
    };
    linha.appendChild(btnRemover);
  }

  linha.appendChild(inputImg);
  bloco.appendChild(linha);

  const ajuda = document.createElement("small");
  ajuda.className = "pix-ajuda";
  ajuda.textContent = grupo.imagemUrl
    ? "Aparece na página de cada pedido, no guia de tamanhos. Clique na miniatura para conferir ampliada."
    : "Ex.: a tabela de medidas deste grupo. Aparece na página de cada pedido, no guia de tamanhos.";
  bloco.appendChild(ajuda);

  return bloco;
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

  // Times que cobram um valor diferente do geral neste grupo — o lucro acima
  // é o da tabela geral; nesses times ele muda.
  const excecoes = timesComPrecoProprio(grupo.grupo);
  if (excecoes.length > 0) {
    const nota = document.createElement("small");
    nota.className = "pix-ajuda";
    nota.textContent =
      "Preço próprio em " + excecoes.map((e) => `${e.nome} (${formatarReais(e.valor)})`).join(", ") +
      ". O lucro acima usa o preço geral.";
    bloco.appendChild(nota);
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
      // Imagem de referência de medidas (quando o grupo tiver uma).
      if (g.imagemUrl) grupo.imagemUrl = g.imagemUrl;
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
    // O grupo novo já ganha o campo de preço na aba Pagamentos (sem perder o
    // que foi digitado lá e ainda não salvo).
    const digitados = { ...precosPorGrupoAtual };
    elPrecosPorGrupo.querySelectorAll("input").forEach((inp) => {
      if (inp.value !== "") digitados[inp.dataset.grupo] = inp.value;
    });
    renderizarPrecosPorGrupo(digitados);
    redesenharListasDeTamanho();
    mostrarMensagem(elMsgTamanhos, "Tamanhos salvos. Eles já valem para o cadastro dos times.", "aviso");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(elMsgTamanhos, textoErroConfig(erro, "tamanhos"), "erro");
  }
});
