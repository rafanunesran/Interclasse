// ============================================================
// PÁGINA INICIAL: escolhe o cliente e lista os times dele
// ============================================================
// Com clientes cadastrados, a tela abre na lista de clientes e cada um leva
// para os seus próprios times (`index.html?cliente=ID`) — assim os pedidos de
// um cliente não se misturam com os de outro. Sem nenhum cliente cadastrado,
// a página continua como antes: a lista de todos os times, direto.

const paramsInicio = new URLSearchParams(window.location.search);
const clienteDaUrl = paramsInicio.get("cliente") || "";

const elLista = document.getElementById("listaTimes");
const elCarregando = document.getElementById("carregando");
const elTituloLista = document.getElementById("tituloLista");
const elSubtituloLista = document.getElementById("subtituloLista");
const elVoltarClientes = document.getElementById("voltarClientes");
const elBarraCarrinho = document.getElementById("barraCarrinho");
const elCarrinhoResumo = document.getElementById("carrinhoResumo");
const elBtnPagarCarrinho = document.getElementById("btnPagarCarrinho");
const elBtnEsvaziarCarrinho = document.getElementById("btnEsvaziarCarrinho");

async function carregarInicio() {
  try {
    // O login anônimo é necessário apenas para GRAVAR (na página do time).
    // A leitura é pública, então se ele falhar aqui (ex.: provedor "Anônimo"
    // não ativado no Firebase) seguimos mesmo assim e listamos normalmente.
    try {
      await entrarAnonimo();
    } catch (e) {
      console.warn("Login anônimo indisponível; listando mesmo assim.", e);
    }

    try {
      aplicarConfigGeral(await carregarConfigGeral());
    } catch (e) {
      console.warn("Não foi possível aplicar as configurações gerais.", e);
    }

    // O carrinho vale para o site inteiro: mostramos aqui o que já foi
    // marcado, mesmo que seja de times que não estão nesta tela.
    mostrarCarrinho();

    const [clientes, snap] = await Promise.all([
      carregarClientes(),
      db.collection(COL_TIMES).orderBy("nome").get()
    ]);
    // Pedidos finalizados estão arquivados: não aparecem mais aqui (o link
    // direto do time continua abrindo, só para consulta).
    const times = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !pedidoFinalizado(t));

    elCarregando.classList.add("oculto");

    // Sem clientes cadastrados: tudo junto, como sempre foi.
    if (clientes.length === 0) return mostrarTimes(times);

    // Um cliente escolhido na URL: só os times dele.
    if (clienteDaUrl) return mostrarTimesDoCliente(clientes, times);

    return mostrarClientes(clientes, times);
  } catch (erro) {
    console.error(erro);
    elCarregando.classList.remove("oculto");
    elCarregando.textContent =
      "Erro ao carregar a lista. Verifique a configuração do Firebase (js/firebase-config.js).";
  }
}

// ---------------- Lista de clientes (cada um com os seus times) ----------------

function mostrarClientes(clientes, times) {
  if (elTituloLista) elTituloLista.textContent = "Clientes";
  if (elSubtituloLista) elSubtituloLista.textContent = "Toque no seu cliente para ver os times dele.";
  if (elVoltarClientes) elVoltarClientes.classList.add("oculto");

  // Times ainda sem cliente entram num card à parte, para não sumirem da tela.
  const semCliente = times.filter((t) => !clienteIdDoTime(t));
  const cartoes = clientes.map((c) => ({
    id: c.id,
    nome: c.nome || c.id,
    qtd: times.filter((t) => clienteIdDoTime(t) === c.id).length
  }));
  if (semCliente.length > 0) {
    cartoes.push({ id: SEM_CLIENTE, nome: SEM_CLIENTE_NOME, qtd: semCliente.length });
  }

  elLista.innerHTML = "";
  cartoes.forEach((c) => {
    const item = document.createElement("a");
    item.className = "time-card cliente-card";
    item.href = "index.html?cliente=" + encodeURIComponent(c.id);
    item.innerHTML = `
      <span class="time-card-topo">
        <span class="time-card-nome">${escaparHtml(c.nome)}</span>
        <span class="badge">${c.qtd} time(s)</span>
      </span>
      <span class="time-card-acao">Ver times →</span>
    `;
    elLista.appendChild(item);
  });
}

// ---------------- Times de um cliente ----------------

function mostrarTimesDoCliente(clientes, times) {
  const cliente = clientes.find((c) => c.id === clienteDaUrl);
  const semCliente = clienteDaUrl === SEM_CLIENTE;

  if (!cliente && !semCliente) {
    if (elTituloLista) elTituloLista.textContent = "Cliente não encontrado";
    if (elSubtituloLista) elSubtituloLista.textContent = "";
    mostrarVoltar();
    elLista.innerHTML = "<p>Esse cliente não existe (ou foi removido). Volte e escolha outro.</p>";
    return;
  }

  const nome = semCliente ? SEM_CLIENTE_NOME : cliente.nome;
  if (elTituloLista) elTituloLista.textContent = nome;
  if (elSubtituloLista) elSubtituloLista.textContent = "Toque no seu time para cadastrar a lista de camisetas.";
  mostrarVoltar();

  const doCliente = times.filter((t) =>
    semCliente ? !clienteIdDoTime(t) : clienteIdDoTime(t) === clienteDaUrl
  );
  mostrarTimes(doCliente, `Nenhum time cadastrado para ${nome} ainda.`);
}

function mostrarVoltar() {
  if (elVoltarClientes) elVoltarClientes.classList.remove("oculto");
}

// ---------------- Cards de time ----------------

function mostrarTimes(times, vazioTexto) {
  if (times.length === 0) {
    elLista.innerHTML = `<p>${escaparHtml(
      vazioTexto || "Nenhum time cadastrado ainda. Peça para a coordenação criar os times no painel administrativo."
    )}</p>`;
    return;
  }

  elLista.innerHTML = "";
  times.forEach((time) => {
    const item = document.createElement("a");
    item.className = "time-card";
    item.href = "time.html?id=" + encodeURIComponent(time.id);

    const statusId = statusPedidoDe(time);
    const classeBadge = classeBadgeStatus(statusId);
    const status = `<span class="badge ${classeBadge}">${labelStatus(statusId)}</span>`;

    const acao = statusId === "aberto" ? "Cadastrar lista →" : "Ver detalhes";

    const marcaOverlay = time.marcaDagua === true
      ? '<span class="marca-overlay" aria-hidden="true"></span>'
      : "";
    // No card mostramos a simulação; se o time só tiver a arte, ela serve de capa.
    const capaUrl = time.imagemUrl || time.arteUrl;
    const imagem = capaUrl
      ? `<span class="wrap-imagem wrap-imagem-card">
           <img class="time-card-img img-na-marca" src="${encodeURI(capaUrl)}" alt="Camiseta de ${escaparHtml(time.nome)}" />
           ${marcaOverlay}
         </span>`
      : "";

    item.innerHTML = `
      ${imagem}
      <span class="time-card-topo">
        <span class="time-card-nome">${escaparHtml(time.nome)}</span>
        ${status}
      </span>
      <span class="time-card-acao">${acao}</span>
    `;
    elLista.appendChild(item);
  });
}

// ---------------- Carrinho (barra do rodapé) ----------------
// A tela inicial não cobra nada: ela só mostra o que já está no carrinho e
// leva de volta para a página de um dos times, onde o pagamento acontece.

function mostrarCarrinho() {
  if (!elBarraCarrinho) return;
  const itens = lerCarrinho();
  elBarraCarrinho.classList.toggle("oculto", itens.length === 0);
  document.body.classList.toggle("com-carrinho", itens.length > 0);
  if (itens.length === 0) return;

  const { total, semPreco } = carrinhoTotal(itens);
  const times = carrinhoTimes(itens);
  const valor = total > 0 ? " · " + formatarReais(total) : "";
  const deQuemE = times.length > 1 ? ` · ${times.length} times` : "";
  const aviso = semPreco > 0 ? ` (${semPreco} sem preço definido)` : "";
  elCarrinhoResumo.textContent = `${itens.length} camiseta(s)${deQuemE}${valor}${aviso}`;
  elCarrinhoResumo.title = times.join(" · ");
  if (elBtnPagarCarrinho) {
    elBtnPagarCarrinho.textContent = total > 0 ? `Pagar ${formatarReais(total)}` : "Pagar";
  }
}

if (elBtnEsvaziarCarrinho) {
  elBtnEsvaziarCarrinho.addEventListener("click", () => {
    if (confirm("Tirar todas as camisetas do carrinho?")) {
      gravarCarrinho([]);
      mostrarCarrinho();
    }
  });
}
if (elBtnPagarCarrinho) {
  elBtnPagarCarrinho.addEventListener("click", () => {
    const itens = lerCarrinho();
    if (itens.length === 0) return;
    // O pagamento mora na página do time; `?carrinho=1` abre direto nele.
    window.location.href =
      "time.html?id=" + encodeURIComponent(itens[0].timeId) + "&carrinho=1";
  });
}

carregarInicio();
