// ============================================================
// PÁGINA DO TIME: cadastro, conferência e fechamento do pedido
// ============================================================

const params = new URLSearchParams(window.location.search);
const timeId = params.get("id");

let timeAtual = null;
let desbloqueado = false;
let alunosAtuais = []; // cache da última leitura, para exportar/resumir
let alunosCarregados = false; // true depois da primeira leitura da lista
let cadastrosGlobaisAbertos = true; // controlado nas configurações gerais (admin)
let configGeral = {}; // config/geral (inclui dados de PIX e preços)

// Elementos
const elNomeTime = document.getElementById("nomeTime");
const elClienteTime = document.getElementById("clienteTime");
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
const elMensagemProducao = document.getElementById("mensagemProducao");
const elBarraStatus = document.getElementById("barraStatus");
const elGaleria = document.getElementById("galeriaImagens");
const elGaleriaTrilho = document.getElementById("galeriaTrilho");
const elGaleriaAntes = document.getElementById("galeriaAntes");
const elGaleriaDepois = document.getElementById("galeriaDepois");
const elInfoDataLimite = document.getElementById("infoDataLimite");
const elInfoPrecos = document.getElementById("infoPrecos");
const elBlocoDataLimite = document.getElementById("blocoDataLimite");
const elDataLimite = document.getElementById("dataLimite");
const elBtnSalvarDataLimite = document.getElementById("btnSalvarDataLimite");
const elMsgDataLimite = document.getElementById("msgDataLimite");
const elBarraCarrinho = document.getElementById("barraCarrinho");
const elCarrinhoResumo = document.getElementById("carrinhoResumo");
const elBtnPagarCarrinho = document.getElementById("btnPagarCarrinho");
const elBtnEsvaziarCarrinho = document.getElementById("btnEsvaziarCarrinho");

if (!timeId) {
  elNomeTime.textContent = "Time não especificado.";
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

  const doc = await db.collection(COL_TIMES).doc(timeId).get();
  if (!doc.exists) {
    elNomeTime.textContent = "Time não encontrado.";
    return;
  }
  timeAtual = doc.data();
  elNomeTime.textContent = timeAtual.nome;
  await mostrarCliente();
  await aplicarFechamentoAutomatico();
  atualizarBadge();

  carrinho = lerCarrinho();

  // Se já desbloqueou nesta aba antes, não pede senha de novo.
  if (sessionStorage.getItem("desbloqueado-" + timeId) === "1") {
    desbloqueado = true;
  }
  atualizarVisibilidade();

  escutarAlunos();

  // Mantém o status do time atualizado em tempo real.
  db.collection(COL_TIMES).doc(timeId).onSnapshot(async (snap) => {
    if (snap.exists) {
      timeAtual = snap.data();
      await aplicarFechamentoAutomatico();
      atualizarBadge();
      atualizarVisibilidade();
    }
  });
}

// Mostra de qual cliente é este pedido (quando o time tem um cliente).
async function mostrarCliente() {
  if (!elClienteTime) return;
  const clienteId = clienteIdDoTime(timeAtual);
  if (!clienteId) {
    elClienteTime.classList.add("oculto");
    return;
  }
  try {
    const doc = await db.collection(COL_CLIENTES).doc(clienteId).get();
    const nome = doc.exists ? doc.data().nome : "";
    if (!nome) {
      elClienteTime.classList.add("oculto");
      return;
    }
    elClienteTime.textContent = "Cliente: " + nome;
    elClienteTime.classList.remove("oculto");
  } catch (e) {
    console.warn("Não foi possível carregar o cliente deste time.", e);
    elClienteTime.classList.add("oculto");
  }
}

// Fecha o pedido automaticamente quando a data limite passa (aberto -> fechado).
// Esta é a única mudança de status feita fora do Super Admin.
async function aplicarFechamentoAutomatico() {
  const novo = statusAutoPorData(timeAtual);
  if (!novo) return;
  try {
    await db.collection(COL_TIMES).doc(timeId).update({
      statusPedido: novo,
      fechado: true,
      fechadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    timeAtual.statusPedido = novo;
    timeAtual.fechado = true;
  } catch (e) {
    console.warn("Não foi possível aplicar o fechamento automático por data.", e);
  }
}

// Monta a lista de imagens da galeria, na ordem em que aparecem: a simulação
// na camiseta, a arte pura e, em seguida, as medidas de cada grupo de tamanhos.
function imagensDaGaleria() {
  const itens = [];
  // Marca d'água sobreposta nas imagens da camiseta, conforme o flag do time.
  const comMarca = timeAtual && timeAtual.marcaDagua === true;
  if (timeAtual && timeAtual.imagemUrl) {
    itens.push({ url: timeAtual.imagemUrl, legenda: "Simulação na camiseta", comMarca });
  }
  if (timeAtual && timeAtual.arteUrl) {
    itens.push({ url: timeAtual.arteUrl, legenda: "Arte (sem simulação)", comMarca });
  }
  // A tabela de medidas é informação para o aluno: nunca leva marca d'água.
  GRUPOS_TAMANHO.filter((g) => g.imagemUrl).forEach((g) => {
    itens.push({
      url: g.imagemUrl,
      legenda: "Medidas — " + g.grupo + " (" + g.tamanhos.join(", ") + ")",
      comMarca: false
    });
  });
  return itens;
}

let assinaturaGaleria = null; // evita remontar (e perder a posição) sem necessidade

// Galeria deslizante do topo da página. Cada imagem abre ampliada ao clicar, e
// dentro da ampliação dá para passar para a próxima com as setas.
function renderizarGaleria() {
  if (!elGaleria || !elGaleriaTrilho) return;

  const itens = imagensDaGaleria();
  const comMarcaDagua = timeAtual && timeAtual.marcaDagua === true;
  const assinatura = JSON.stringify([itens.map((i) => i.url), comMarcaDagua]);
  if (assinatura === assinaturaGaleria) return; // nada mudou: preserva a rolagem
  assinaturaGaleria = assinatura;

  elGaleria.classList.toggle("oculto", itens.length === 0);
  elGaleriaTrilho.innerHTML = "";

  itens.forEach((item, indice) => {
    const figura = document.createElement("figure");
    figura.className = "carrossel-slide";

    const wrap = document.createElement("span");
    wrap.className = "wrap-imagem";

    const img = document.createElement("img");
    img.className = "imagem-galeria img-na-marca";
    img.src = item.url;
    img.alt = item.legenda;
    img.loading = indice === 0 ? "eager" : "lazy";
    // Clicar (ou Enter/Espaço) amplia, já dentro da galeria toda.
    tornarImagemAmpliavel(img, item.legenda, item.comMarca, itens, indice);
    wrap.appendChild(img);

    // Marca d'água sobreposta (não altera o arquivo), conforme o flag do time.
    if (item.comMarca) {
      const marca = document.createElement("span");
      marca.className = "marca-overlay";
      marca.setAttribute("aria-hidden", "true");
      wrap.appendChild(marca);
    }

    const legenda = document.createElement("figcaption");
    legenda.textContent = item.legenda;

    figura.appendChild(wrap);
    figura.appendChild(legenda);
    elGaleriaTrilho.appendChild(figura);
  });

  atualizarSetasGaleria();
}

// Rola a galeria uma "página" para o lado.
function deslizarGaleria(direcao) {
  if (!elGaleriaTrilho) return;
  const slide = elGaleriaTrilho.querySelector(".carrossel-slide");
  const passo = slide ? slide.getBoundingClientRect().width + 12 : elGaleriaTrilho.clientWidth;
  elGaleriaTrilho.scrollBy({ left: direcao * passo, behavior: "smooth" });
}

// As setas só aparecem quando há mais imagens do que cabem na tela, e cada uma
// some quando a galeria já chegou ao fim daquele lado.
function atualizarSetasGaleria() {
  if (!elGaleriaTrilho || !elGaleriaAntes || !elGaleriaDepois) return;
  const sobra = elGaleriaTrilho.scrollWidth - elGaleriaTrilho.clientWidth;
  const x = elGaleriaTrilho.scrollLeft;
  elGaleriaAntes.classList.toggle("oculto", sobra <= 1 || x <= 1);
  elGaleriaDepois.classList.toggle("oculto", sobra <= 1 || x >= sobra - 1);
}

if (elGaleriaAntes) elGaleriaAntes.onclick = () => deslizarGaleria(-1);
if (elGaleriaDepois) elGaleriaDepois.onclick = () => deslizarGaleria(1);
if (elGaleriaTrilho) elGaleriaTrilho.addEventListener("scroll", atualizarSetasGaleria, { passive: true });
window.addEventListener("resize", atualizarSetasGaleria);

function atualizarBadge() {
  const statusId = statusPedidoDe(timeAtual);
  elBadgeStatus.textContent = labelStatus(statusId);
  elBadgeStatus.className = "badge " + classeBadgeStatus(statusId);

  renderizarBarraStatus(elBarraStatus, statusId);

  // Galeria de referência: simulação, arte e as medidas de cada grupo.
  renderizarGaleria();

  // Valor da camiseta neste time (o geral ou o preço próprio dele).
  mostrarPrecosDaTime();

  // Info da data limite.
  if (elInfoDataLimite) {
    if (timeAtual.dataLimite) {
      const d = new Date(timeAtual.dataLimite + "T00:00:00");
      const txt = isNaN(d.getTime()) ? timeAtual.dataLimite : d.toLocaleDateString("pt-BR");
      elInfoDataLimite.textContent = "Data limite para pagamento: " + txt;
      elInfoDataLimite.classList.remove("oculto");
    } else {
      elInfoDataLimite.classList.add("oculto");
    }
  }
}

// Mostra quanto custa a camiseta neste time, por grupo de tamanho. Usa os
// preços em vigor aqui: os gerais, com o preço próprio do time por cima.
function mostrarPrecosDaTime() {
  if (!elInfoPrecos) return;
  const precos = precosDoTime(configGeral, timeId);
  const partes = GRUPOS_TAMANHO
    .filter((g) => precos[g.grupo] != null)
    .map((g) => `${g.grupo}: ${formatarReais(precos[g.grupo])}`);

  if (partes.length === 0) {
    elInfoPrecos.classList.add("oculto");
    return;
  }
  elInfoPrecos.textContent = "Valor da camiseta — " + partes.join(" · ");
  elInfoPrecos.classList.remove("oculto");
}

function atualizarVisibilidade() {
  const aberto = pedidoAberto(timeAtual);
  const suspenso = pedidoSuspenso(timeAtual);
  const aceitaCadastro = pedidoAceitaCadastro(timeAtual); // aberto/fechado/pagamento
  const podeEditar = desbloqueado && aceitaCadastro && cadastrosGlobaisAbertos;

  elCardSenha.classList.toggle("oculto", desbloqueado);
  elBlocoCadastro.classList.toggle("oculto", !podeEditar);
  // Data limite: o representante define enquanto o pedido está aberto.
  if (elBlocoDataLimite) {
    elBlocoDataLimite.classList.toggle("oculto", !(desbloqueado && aberto));
    if (elDataLimite && document.activeElement !== elDataLimite) {
      elDataLimite.value = timeAtual.dataLimite || "";
    }
  }
  // Da Impressão em diante: o que não foi pago fica pendente e não é produzido.
  if (elMensagemProducao) {
    const { produzir, pendentes } = separarProducao(alunosAtuais);
    const mostrar = pedidoEmProducao(timeAtual) && alunosAtuais.length > 0;
    elMensagemProducao.classList.toggle("oculto", !mostrar);
    if (mostrar) {
      elMensagemProducao.textContent = pendentes.length === 0
        ? `🖨️ Produção em andamento: as ${produzir.length} camiseta(s) do time foram pagas e entraram na produção.`
        : `🖨️ Produção em andamento: ${produzir.length} camiseta(s) paga(s) entraram na produção. ` +
          `${pendentes.length} não foi(ram) paga(s) até a impressão, ficou(aram) pendente(s) e não será(ão) produzida(s) nesta leva.`;
    }
  }

  // Mensagem de suspenso tem prioridade sobre a de "lista travada".
  if (elMensagemSuspenso) elMensagemSuspenso.classList.toggle("oculto", !suspenso);
  // "Não é mais possível editar" só quando a lista realmente travou (pagamento encerrado+).
  elMensagemFechado.classList.toggle("oculto", aceitaCadastro || suspenso);
  if (elMensagemGlobalFechado) {
    // Aviso global só quando o time aceitaria cadastro, mas o admin fechou tudo.
    elMensagemGlobalFechado.classList.toggle("oculto", cadastrosGlobaisAbertos || !aceitaCadastro);
  }

  renderizarTabela(); // re-render para mostrar/esconder botões de ação
}

// ---------------- Senha ----------------

elFormSenha.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const valor = document.getElementById("senhaTime").value.trim();
  esconderMensagem(elMsgSenha);

  if (valor === timeAtual.senha) {
    desbloqueado = true;
    sessionStorage.setItem("desbloqueado-" + timeId, "1");
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

// ============================================================
// CARRINHO — pagar várias camisetas de uma vez, sem login
// ============================================================
// A mecânica do carrinho (guardar, somar, reconferir) fica em js/utils.js,
// porque ele vale para o site inteiro: um responsável com filhos em times
// diferentes marca as camisetas em cada time e paga tudo de uma vez. Aqui
// ficam só as partes que dependem desta página.

let carrinho = [];            // itens do carrinho (podem ser de vários times)
let carrinhoConferido = false; // já reconferimos no Firestore nesta visita?

// Tem como cobrar? (chave PIX ou Mercado Pago configurados)
function temFormaDePagamento() {
  return !!(configGeral.pixChave || (configGeral.mpAtivo && configGeral.mpBackendUrl));
}

// Uma camiseta DESTE time pode entrar no carrinho?
function podeEntrarNoCarrinho(aluno) {
  return podePagarAgora(timeAtual, aluno) && temFormaDePagamento();
}

// Vira item de carrinho: leva o essencial para a barra e o modal montarem a
// tela sem precisar ler o banco de novo a cada clique.
function itemDoAluno(aluno) {
  return {
    timeId,
    alunoId: aluno.id,
    nome: aluno.nome || "",
    tamanho: aluno.tamanho || "",
    numero: aluno.numero || "",
    nomeCamiseta: aluno.nomeCamiseta || "",
    time: (timeAtual && timeAtual.nome) || timeId,
    valor: Number(precoDoTamanhoNoTime(aluno.tamanho, configGeral, timeId) || 0)
  };
}

function estaNoCarrinho(alunoId) {
  return carrinhoTem(carrinho, timeId, alunoId);
}

function alternarNoCarrinho(aluno) {
  carrinho = estaNoCarrinho(aluno.id)
    ? carrinhoRemover(carrinho, timeId, aluno.id)
    : carrinhoAdicionar(carrinho, itemDoAluno(aluno));
  gravarCarrinho(carrinho);
  renderizarTabela();
}

function esvaziarCarrinho() {
  carrinho = [];
  gravarCarrinho(carrinho);
  renderizarTabela();
}

// Mantém em dia só os itens DESTE time, a partir da lista que já chega em
// tempo real. Os de outros times ficam como estão até a reconferência.
function sincronizarCarrinhoDoTime() {
  if (!alunosCarregados) return;
  const antes = JSON.stringify(carrinho);
  carrinho = carrinho.filter((item) => {
    if (item.timeId !== timeId) return true;
    const aluno = alunosAtuais.find((a) => a.id === item.alunoId);
    if (!aluno || !podeEntrarNoCarrinho(aluno)) return false;
    // Nome/tamanho/preço podem ter mudado desde que entrou no carrinho.
    Object.assign(item, itemDoAluno(aluno));
    return true;
  });
  if (JSON.stringify(carrinho) !== antes) gravarCarrinho(carrinho);
}

// Reconfere no Firestore o que veio de outros times (e o resto junto).
// Roda uma vez ao abrir a página e de novo antes de pagar.
async function conferirCarrinho() {
  const { itens, removidos } = await revalidarCarrinho(configGeral);
  carrinho = itens;
  carrinhoConferido = true;
  if (removidos.length > 0) {
    const nomes = removidos.map((i) => `${i.nome || i.alunoId} (${i.time || i.timeId})`).join(", ");
    alert(
      `Tiramos do carrinho ${removidos.length} camiseta(s) que não podem mais ser pagas ` +
      `(já pagas, com ajuste em aberto ou de um pedido que mudou de etapa):\n\n${nomes}`
    );
  }
  renderizarTabela();
  return carrinho;
}

// Barra fixa do rodapé: quantidade, times, total e o botão de pagar tudo.
function renderizarCarrinho() {
  if (!elBarraCarrinho) return;
  elBarraCarrinho.classList.toggle("oculto", carrinho.length === 0);
  // A barra é fixa no rodapé: a classe abre espaço para ela não tampar nada.
  document.body.classList.toggle("com-carrinho", carrinho.length > 0);
  if (carrinho.length === 0) return;

  const { total, semPreco } = carrinhoTotal(carrinho);
  const times = carrinhoTimes(carrinho);
  const valor = total > 0 ? " · " + formatarReais(total) : "";
  // Com filhos em times diferentes, dizer de quantos times é o carrinho ajuda.
  const deQuemE = times.length > 1 ? ` · ${times.length} times` : "";
  const aviso = semPreco > 0 ? ` (${semPreco} sem preço definido)` : "";
  elCarrinhoResumo.textContent = `${carrinho.length} camiseta(s)${deQuemE}${valor}${aviso}`;
  elCarrinhoResumo.title = times.join(" · ");
  if (elBtnPagarCarrinho) {
    elBtnPagarCarrinho.textContent = total > 0 ? `Pagar ${formatarReais(total)}` : "Pagar";
  }
}

if (elBtnEsvaziarCarrinho) {
  elBtnEsvaziarCarrinho.addEventListener("click", () => {
    if (carrinho.length > 0 && confirm("Tirar todas as camisetas do carrinho?")) esvaziarCarrinho();
  });
}
if (elBtnPagarCarrinho) {
  elBtnPagarCarrinho.addEventListener("click", () => {
    if (carrinho.length > 0) abrirPagamento(carrinho);
  });
}

// ---------------- Listagem em tempo real ----------------

function escutarAlunos() {
  db.collection(COL_TIMES)
    .doc(timeId)
    .collection("alunos")
    .where("excluido", "==", false)
    .onSnapshot(
      (snap) => {
        alunosAtuais = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        const primeiraLeitura = !alunosCarregados;
        alunosCarregados = true;
        renderizarTabela();
        verificarConfirmacaoPix();
        // Na primeira leitura, confere no banco o que veio de outros times.
        if (primeiraLeitura && !carrinhoConferido && carrinho.length > 0) {
          conferirCarrinho().then(abrirCarrinhoSePedido);
        } else if (primeiraLeitura) {
          carrinhoConferido = true;
          abrirCarrinhoSePedido();
        }
      },
      (erro) => console.error("Erro ao carregar alunos:", erro)
    );
}

function renderizarTabela() {
  const podeEditar = desbloqueado && pedidoAceitaCadastro(timeAtual) && cadastrosGlobaisAbertos;

  // Conta ocorrências de cada número (ignorando vazios) para destacar duplicados
  const contagemNumero = {};
  alunosAtuais.forEach((a) => {
    if (a.numero) contagemNumero[a.numero] = (contagemNumero[a.numero] || 0) + 1;
  });
  const duplicados = Object.keys(contagemNumero).filter((n) => contagemNumero[n] > 1);

  if (duplicados.length > 0) {
    mostrarMensagem(
      elAvisoDuplicado,
      "Atenção: números de camiseta duplicados neste time: " + duplicados.join(", "),
      "aviso"
    );
  } else {
    esconderMensagem(elAvisoDuplicado);
  }

  // Atualiza (e limpa) os itens deste time antes de desenhar. Os de outros
  // times são conferidos por conferirCarrinho(), no banco.
  sincronizarCarrinhoDoTime();

  elTabelaCorpo.innerHTML = "";
  alunosAtuais.forEach((aluno) => {
    const tr = document.createElement("tr");
    if (aluno.numero && duplicados.includes(String(aluno.numero))) {
      tr.classList.add("duplicado");
    }
    // Nas etapas de produção, quem não pagou fica visivelmente de fora.
    if (pedidoEmProducao(timeAtual) && !alunoSeraProduzido(aluno)) {
      tr.classList.add("linha-fora-producao");
    }

    const marca = aluno.ajusteSolicitado
      ? '<span class="marca-ajuste" title="Ajuste solicitado à organização">!</span> '
      : "";

    tr.innerHTML = `
      <td>${marca}${escapeHtml(aluno.nome)}${propostaAjusteHtml(aluno)}${historicoAjusteHtml(aluno)}</td>
      <td>${escapeHtml(aluno.tamanho)}</td>
      <td>${escapeHtml(aluno.numero || "-")}</td>
      <td>${escapeHtml(aluno.nomeCamiseta || "-")}</td>
      <td>${badgePagamentoHtml(aluno)}${badgeProducaoHtml(timeAtual, aluno)}</td>
      <td class="cel-carrinho"></td>
      <td class="acoes-linha"></td>
    `;

    // Carrinho: marque quantas quiser e pague todas de uma vez lá embaixo.
    const tdCarrinho = tr.querySelector(".cel-carrinho");
    if (podeEntrarNoCarrinho(aluno)) {
      const rotulo = document.createElement("label");
      rotulo.className = "check-carrinho";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = estaNoCarrinho(aluno.id);
      chk.setAttribute("aria-label", "Colocar a camiseta de " + aluno.nome + " no carrinho");
      chk.onchange = () => alternarNoCarrinho(aluno);
      rotulo.appendChild(chk);
      rotulo.appendChild(document.createTextNode(estaNoCarrinho(aluno.id) ? " no carrinho" : " somar"));
      tdCarrinho.appendChild(rotulo);
      if (estaNoCarrinho(aluno.id)) tr.classList.add("linha-no-carrinho");
    } else {
      tdCarrinho.textContent = "-";
    }

    const tdAcoes = tr.querySelector(".acoes-linha");

    if (!pedidoSuspenso(timeAtual)) {
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
      const podePagar = pedidoAceitaPagamento(timeAtual) && !aluno.pago && (configGeral.pixChave || temMp);
      if (podePagar && !ajustePendente) {
        const btnPagar = document.createElement("button");
        btnPagar.className = "primario";
        // Mostra o valor no botão (o deste time, se ele tiver preço próprio).
        const valorLinha = precoDoTamanhoNoTime(aluno.tamanho, configGeral, timeId);
        btnPagar.textContent = valorLinha ? `Pagar ${formatarReais(valorLinha)}` : "Pagar";
        btnPagar.title = "Pagar só esta camiseta (para juntar várias, use o carrinho)";
        btnPagar.onclick = () => abrirPagamento([itemDoAluno(aluno)]);
        tdAcoes.appendChild(btnPagar);
      }

      // Solicitar ajuste: em qualquer fase que não seja "aberto" (onde dá para
      // editar direto), enquanto o pagamento não foi feito nem declarado —
      // pagar confirma os dados e encerra a possibilidade de ajuste.
      if (!pedidoAberto(timeAtual) && !aluno.pago && !aluno.pagamentoDeclarado) {
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

  renderizarCarrinho();
  renderizarResumo();
}

function renderizarResumo() {
  const contagem = {};
  TODOS_TAMANHOS.forEach((t) => (contagem[t] = 0));
  alunosAtuais.forEach((a) => {
    if (contagem[a.tamanho] !== undefined) contagem[a.tamanho]++;
  });

  elResumo.innerHTML = `<span><strong>Total: ${alunosAtuais.length}</strong></span>`;
  if (pedidoEmProducao(timeAtual)) {
    const { produzir, pendentes } = separarProducao(alunosAtuais);
    const emProducao = document.createElement("span");
    emProducao.innerHTML = `<strong>Em produção: ${produzir.length}</strong>`;
    elResumo.appendChild(emProducao);
    if (pendentes.length > 0) {
      const fora = document.createElement("span");
      fora.textContent = `Fora da produção: ${pendentes.length}`;
      elResumo.appendChild(fora);
    }
  }
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
  if (!pedidoAceitaCadastro(timeAtual) || !cadastrosGlobaisAbertos) {
    alert("Os cadastros estão fechados para este time no momento.");
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
    await db.collection(COL_TIMES).doc(timeId).collection("alunos").add({
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
      await db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({
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
  const tdCarrinho = document.createElement("td");  // coluna do carrinho (vazia na edição)

  tr.appendChild(tdNome);
  tr.appendChild(tdTamanho);
  tr.appendChild(tdNumero);
  tr.appendChild(tdCostas);
  tr.appendChild(tdPagamento);
  tr.appendChild(tdCarrinho);
  tr.appendChild(tdAcoes);
}

async function excluirAluno(aluno) {
  if (!confirm(`Remover "${aluno.nome}" da lista?`)) return;
  try {
    await db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({
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
      await db.collection(COL_TIMES).doc(timeId).collection("alunos").doc(aluno.id).update({
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
const elPixTitulo = document.getElementById("pixTitulo");
const elPixItens = document.getElementById("pixItens");
const elPixAvisoLote = document.getElementById("pixAvisoLote");

let pagamentoAtual = []; // itens abertos agora no modal (um ou o carrinho)

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

// Uma linha de resumo por camiseta. Com camisetas de times diferentes no
// mesmo pagamento, o nome do time entra junto para não confundir.
function descricaoDoItem(item, comTime) {
  const valor = Number(item.valor || 0);
  return `${item.nome} — ${item.tamanho}` +
    (comTime ? ` · ${item.time}` : "") +
    (valor > 0 ? ` · ${formatarReais(valor)}` : " · sem preço");
}

// Abre o pagamento de UMA camiseta ou de várias (o carrinho, que pode ter
// camisetas de times diferentes). O caminho é o mesmo nos dois casos.
async function abrirPagamento(itens) {
  const lista = (itens || []).filter(Boolean);
  if (lista.length === 0) return;

  // Reconfere no banco antes de cobrar: preço, tamanho e se ainda pode pagar.
  // É aqui que camisetas de outros times são validadas de verdade.
  const { itens: validos, removidos } = await revalidarItens(configGeral, lista);
  if (removidos.length > 0) {
    const nomes = removidos.map((i) => `${i.nome || i.alunoId} (${i.time || i.timeId})`).join(", ");
    alert(
      `Não dá para pagar ${removidos.length} camiseta(s) agora — já pagas, com ajuste em ` +
      `aberto ou de um pedido que mudou de etapa:\n\n${nomes}`
    );
    // O carrinho guardado também perde o que não vale mais.
    removidos.forEach((i) => { carrinho = carrinhoRemover(carrinho, i.timeId, i.alunoId); });
    gravarCarrinho(carrinho);
    renderizarTabela();
  }
  if (validos.length === 0) return;

  const varios = carrinhoTimes(validos).length > 1;

  // Confirmação: pagar confirma os dados e encerra a possibilidade de ajuste.
  const { total, semPreco } = carrinhoTotal(validos);
  const linhas = validos.slice(0, 12).map((i) =>
    `• ${i.nome} — ${i.tamanho}, nº ${i.numero || "-"}, nas costas "${i.nomeCamiseta || "-"}"` +
    (varios ? ` [${i.time}]` : "")
  );
  if (validos.length > linhas.length) linhas.push(`• …e mais ${validos.length - linhas.length}`);

  const confirmar = confirm(
    (validos.length === 1
      ? "Confira os dados desta camiseta antes de pagar:\n\n"
      : `Confira as ${validos.length} camisetas antes de pagar:\n\n`) +
    linhas.join("\n") +
    (total > 0 ? `\n\nTotal: ${formatarReais(total)}` : "") +
    (semPreco > 0 ? `\n(${semPreco} sem preço definido — digite o valor no app do banco)` : "") +
    "\n\nAo pagar, você CONFIRMA que estes dados estão corretos. " +
    (validos.length === 1
      ? "Depois do pagamento, NÃO será mais possível solicitar ajuste desta unidade.\n\n"
      : "Depois do pagamento, NÃO será mais possível solicitar ajuste dessas unidades.\n\n") +
    "Deseja continuar?"
  );
  if (!confirmar) return;

  pagamentoAtual = validos;

  if (elPixTitulo) {
    elPixTitulo.textContent = validos.length === 1
      ? "Pagamento via PIX"
      : `Pagamento de ${validos.length} camisetas`;
  }
  elPixAluno.textContent = validos.length === 1
    ? descricaoDoItem(validos[0], varios)
    : `${validos.length} camisetas neste pagamento` +
      (varios ? ` (${carrinhoTimes(validos).join(", ")})` : "");

  // Com mais de uma camiseta, lista tudo para a pessoa conferir.
  if (elPixItens) {
    elPixItens.innerHTML = validos.length > 1
      ? validos.map((i) => `<li>${escapeHtml(descricaoDoItem(i, varios))}</li>`).join("")
      : "";
    elPixItens.classList.toggle("oculto", validos.length <= 1);
  }
  if (elPixAvisoLote) elPixAvisoLote.classList.toggle("oculto", validos.length <= 1);

  elPixCopiado.classList.add("oculto");
  elPixDeclarado.classList.add("oculto");
  definirStatusPix("", "");
  elModalPix.classList.remove("oculto");

  const usarMp = !!(configGeral.mpAtivo && configGeral.mpBackendUrl);

  if (usarMp) {
    // Checkout Pro: o conteúdo de PIX estático não é usado (vamos redirecionar).
    if (elPixConteudo) elPixConteudo.classList.add("oculto");
    irParaCheckoutMp(validos);
    return;
  }

  // Modo PIX estático (no próprio site).
  if (elPixConteudo) elPixConteudo.classList.remove("oculto");
  if (elPixJaPaguei) {
    elPixJaPaguei.classList.remove("oculto");
    elPixJaPaguei.textContent = validos.length === 1
      ? "Já fiz o pagamento"
      : `Já paguei as ${validos.length} camisetas`;
  }
  gerarPagamentoEstatico(validos);
}

// Abre o carrinho já no pagamento quando a pessoa chegou pelo botão da tela
// inicial (index.html manda ?carrinho=1).
function abrirCarrinhoSePedido() {
  if (params.get("carrinho") !== "1" || carrinho.length === 0) return;
  // Tira o parâmetro para um F5 não reabrir o pagamento sem querer.
  try {
    const limpa = new URL(window.location.href);
    limpa.searchParams.delete("carrinho");
    window.history.replaceState({}, "", limpa.toString());
  } catch (e) { /* navegador antigo: segue sem limpar */ }
  abrirPagamento(carrinho);
}

// Modo padrão: PIX estático gerado no próprio site (chave direta, sem taxa).
// Com várias camisetas é um código só, com a soma — o banco cobra de uma vez.
function gerarPagamentoEstatico(itens) {
  const { total, semPreco } = carrinhoTotal(itens);
  const codigo = pixCopiaECola({
    chave: configGeral.pixChave,
    nome: configGeral.pixNome,
    cidade: configGeral.pixCidade,
    valor: total
  });

  if (total > 0 && semPreco === 0) {
    elPixValor.textContent = formatarReais(total) +
      (itens.length > 1 ? ` (${itens.length} camisetas)` : "");
  } else if (total > 0) {
    elPixValor.textContent = formatarReais(total) +
      ` — ${semPreco} camiseta(s) sem preço ficaram de fora; combine o valor com a organização.`;
  } else {
    elPixValor.textContent = "Valor não definido para estes tamanhos — digite no app do banco.";
  }

  elPixCodigo.value = codigo;
  elPixQr.src =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=" +
    encodeURIComponent(codigo);
}

// Modo Mercado Pago (Checkout Pro): pede a preferência ao backend e redireciona
// para a página hospedada do Mercado Pago. Depois de pagar, o pagador volta ao
// site e o status vira "Pago" sozinho (webhook -> Firestore -> onSnapshot).
// Vai a lista inteira, com o time de cada camiseta: é uma cobrança só.
async function irParaCheckoutMp(itens) {
  definirStatusPix("Abrindo o Mercado Pago…", "");
  try {
    const url = configGeral.mpBackendUrl.replace(/\/$/, "") + "/api/criar-preferencia";
    const daPagina = itens.filter((i) => i.timeId === timeId);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Formato novo: cada camiseta com o seu time (o carrinho pode ter
        // filhos de times diferentes).
        itens: itens.map((i) => ({ timeId: i.timeId, alunoId: i.alunoId })),
        // Campos antigos, para um backend ainda não republicado cobrar pelo
        // menos as camisetas deste time em vez de falhar.
        timeId: timeId,
        turmaId: timeId,
        alunoIds: daPagina.map((i) => i.alunoId),
        alunoId: daPagina.length > 0 ? daPagina[0].alunoId : undefined,
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

// Se o pagamento aberto no modal for confirmado (em tempo real), mostra a
// confirmação sem precisar recarregar. Só dá para acompanhar as camisetas
// DESTE time — as de outros times a página não escuta.
function verificarConfirmacaoPix() {
  if (pagamentoAtual.length === 0 || !elModalPix || elModalPix.classList.contains("oculto")) return;
  const deOutrosTimes = pagamentoAtual.filter((i) => i.timeId !== timeId).length;
  const pagas = pagamentoAtual.filter((i) => {
    if (i.timeId !== timeId) return false;
    const aluno = alunosAtuais.find((a) => a.id === i.alunoId);
    return aluno && aluno.pago;
  }).length;
  if (pagas === 0) return;

  if (pagas === pagamentoAtual.length) {
    definirStatusPix("Pagamento confirmado! ✅", "pago");
    if (elPixJaPaguei) elPixJaPaguei.classList.add("oculto");
  } else {
    definirStatusPix(
      `${pagas} de ${pagamentoAtual.length} camisetas já confirmadas` +
      (deOutrosTimes > 0 ? " (as de outros times aparecem na página de cada um)." : "."),
      "aguardando"
    );
  }
}

function fecharPagamentoPix() {
  elModalPix.classList.add("oculto");
  pagamentoAtual = [];
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
    if (pagamentoAtual.length === 0) return;
    // Não checamos o status desta página aqui: o carrinho pode ter camisetas
    // de outros times, e cada uma já foi conferida em abrirPagamento().
    elPixJaPaguei.disabled = true;
    try {
      // Um aviso por camiseta do lote: a organização confere e confirma cada
      // uma. Vai em lote (que atravessa times) para as linhas não ficarem
      // pela metade.
      const lote = db.batch();
      pagamentoAtual.forEach((item) => {
        const ref = db.collection(COL_TIMES).doc(item.timeId)
          .collection("alunos").doc(item.alunoId);
        lote.update(ref, {
          pagamentoDeclarado: true,
          pagamentoForma: "pix",
          pagamentoDeclaradoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await lote.commit();

      // Já avisado: sai do carrinho para não ser pago duas vezes sem querer.
      pagamentoAtual.forEach((item) => {
        carrinho = carrinhoRemover(carrinho, item.timeId, item.alunoId);
      });
      gravarCarrinho(carrinho);
      renderizarCarrinho();

      elPixJaPaguei.classList.add("oculto");
      elPixDeclarado.textContent = pagamentoAtual.length === 1
        ? "Pagamento informado! A organização vai confirmar."
        : `Pagamento das ${pagamentoAtual.length} camisetas informado! A organização vai confirmar.`;
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
      await db.collection(COL_TIMES).doc(timeId).update({
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
  baixarCSV(`pedido-${slugify(timeAtual.nome)}.csv`, linhas);
});
