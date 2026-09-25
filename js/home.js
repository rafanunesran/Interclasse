// ============================================================
// PÁGINA INICIAL: a "loja" com os times
// ============================================================
// Todos os pedidos em andamento aparecem numa vitrine, cada time como um
// produto (a imagem da camiseta, o preço e a situação do pedido). Dá para
// filtrar por escola/cliente e buscar pelo nome. O filtro fica no endereço
// (`index.html?cliente=ID`), então o link de um cliente abre só os times dele.

const paramsInicio = new URLSearchParams(window.location.search);
let clienteEscolhido = paramsInicio.get("cliente") || "";

const elLista = document.getElementById("listaTimes");
const elCarregando = document.getElementById("carregando");
const elTituloLista = document.getElementById("tituloLista");
const elSubtituloLista = document.getElementById("subtituloLista");
const elBuscaLoja = document.getElementById("buscaLoja");
const elFiltroClientes = document.getElementById("filtroClientesLoja");
const elResumoLoja = document.getElementById("resumoLoja");
const elBarraCarrinho = document.getElementById("barraCarrinho");
const elCarrinhoResumo = document.getElementById("carrinhoResumo");
const elBtnPagarCarrinho = document.getElementById("btnPagarCarrinho");
const elBtnEsvaziarCarrinho = document.getElementById("btnEsvaziarCarrinho");

let clientesLoja = [];
let timesLoja = [];
let configLoja = {};

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
      configLoja = await carregarConfigGeral();
      aplicarConfigGeral(configLoja);
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
    timesLoja = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !pedidoFinalizado(t));
    clientesLoja = clientes;

    elCarregando.classList.add("oculto");

    // Cliente da URL que não existe (ou foi removido): mostra todos.
    if (clienteEscolhido && clienteEscolhido !== SEM_CLIENTE &&
        !clientesLoja.some((c) => c.id === clienteEscolhido)) {
      clienteEscolhido = "";
    }
    renderizarFiltros();
    renderizarLoja();
  } catch (erro) {
    console.error(erro);
    elCarregando.classList.remove("oculto");
    elCarregando.textContent =
      "Erro ao carregar a lista. Verifique a configuração do Firebase (js/firebase-config.js).";
  }
}

// ---------------- Filtros ----------------

// Chips "Todos" + um por escola/cliente com time em andamento.
function renderizarFiltros() {
  if (!elFiltroClientes) return;
  const comTimes = clientesLoja.filter((c) => timesLoja.some((t) => clienteIdDoTime(t) === c.id));
  const temSemCliente = timesLoja.some((t) => !clienteIdDoTime(t));
  const opcoes = [{ id: "", nome: "Todos" }]
    .concat(comTimes.map((c) => ({ id: c.id, nome: c.nome || c.id })));
  if (temSemCliente && comTimes.length > 0) opcoes.push({ id: SEM_CLIENTE, nome: "Outros" });

  // Com um cliente só (ou nenhum), o filtro não ajuda em nada.
  elFiltroClientes.classList.toggle("oculto", opcoes.length <= 2);
  elFiltroClientes.innerHTML = "";
  opcoes.forEach((o) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-filtro" + (o.id === clienteEscolhido ? " ativo" : "");
    b.textContent = o.nome;
    b.setAttribute("aria-pressed", o.id === clienteEscolhido ? "true" : "false");
    b.onclick = () => {
      clienteEscolhido = o.id;
      // O filtro vai para o endereço: dá para compartilhar o link já filtrado.
      const url = new URL(window.location.href);
      if (o.id) url.searchParams.set("cliente", o.id);
      else url.searchParams.delete("cliente");
      window.history.replaceState({}, "", url.toString());
      renderizarFiltros();
      renderizarLoja();
    };
    elFiltroClientes.appendChild(b);
  });
}

if (elBuscaLoja) elBuscaLoja.addEventListener("input", () => renderizarLoja());

function nomeClienteLoja(time) {
  const id = clienteIdDoTime(time);
  if (!id) return "";
  const c = clientesLoja.find((x) => x.id === id);
  return c ? c.nome || "" : "";
}

function timesVisiveis() {
  const termos = normalizarTexto(elBuscaLoja ? elBuscaLoja.value : "").split(/\s+/).filter(Boolean);
  return timesLoja.filter((t) => {
    if (clienteEscolhido && !timeDoCliente(t, clienteEscolhido)) return false;
    if (!termos.length) return true;
    const alvo = normalizarTexto(t.nome + " " + nomeClienteLoja(t));
    return termos.every((x) => alvo.includes(x));
  });
}

// ---------------- Vitrine ----------------

function renderizarLoja() {
  const cliente = clientesLoja.find((c) => c.id === clienteEscolhido);
  if (elTituloLista) {
    elTituloLista.textContent = cliente
      ? cliente.nome
      : clienteEscolhido === SEM_CLIENTE ? "Outros times" : "Escolha o seu time";
  }
  if (elSubtituloLista) {
    elSubtituloLista.textContent = cliente
      ? "Escolha o seu time para ver a lista de camisetas e pagar."
      : "Encontre o pedido da sua turma, confira a lista e pague as camisetas.";
  }

  const times = timesVisiveis();
  const buscando = !!(elBuscaLoja && elBuscaLoja.value.trim());
  if (elResumoLoja) {
    elResumoLoja.classList.toggle("oculto", timesLoja.length === 0);
    elResumoLoja.textContent = `${times.length} time(s)` + (buscando ? " encontrados" : "");
  }

  if (times.length === 0) {
    elLista.innerHTML = `<div class="vazio-lista"><p>${
      timesLoja.length === 0
        ? "Nenhum time cadastrado ainda."
        : buscando ? "Nenhum time encontrado com essa busca." : "Nenhum time para esta escola ainda."
    }</p><p class="pix-ajuda">${
      timesLoja.length === 0
        ? "Peça para a coordenação criar os times no painel administrativo."
        : "Confira o nome ou escolha outra escola."
    }</p></div>`;
    return;
  }

  elLista.innerHTML = "";
  times.forEach((time) => elLista.appendChild(criarCardProduto(time)));
}

// Preço exibido no card: o valor único ou "a partir de" o menor.
function precoDoCard(timeId) {
  const valores = Object.values(precosDoTime(configLoja, timeId)).filter((v) => v > 0);
  if (valores.length === 0) return "";
  const menor = Math.min(...valores);
  const unico = valores.every((v) => v === menor);
  return (unico ? "" : "a partir de ") + formatarReais(menor);
}

// Cor de fundo estável por time, para os cards sem imagem não ficarem iguais.
function corDoTime(texto) {
  let h = 0;
  for (const ch of String(texto)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 88%)`;
}

function criarCardProduto(time) {
  const item = document.createElement("a");
  item.className = "produto-card";
  item.href = "time.html?id=" + encodeURIComponent(time.id);

  const statusId = statusPedidoDe(time);
  const status = `<span class="badge ${classeBadgeStatus(statusId)}">${escaparHtml(labelStatus(statusId))}</span>`;
  const acao = pedidoAceitaPagamento(time) && !pedidoTravado(time)
    ? "Ver lista e pagar"
    : statusId === "aberto" ? "Ver lista" : "Acompanhar pedido";

  const marcaOverlay = time.marcaDagua === true
    ? '<span class="marca-overlay" aria-hidden="true"></span>'
    : "";
  // No card mostramos a simulação; se o time só tiver a arte, ela serve de capa.
  const capaUrl = time.imagemUrl || time.arteUrl;
  const imagem = capaUrl
    ? `<span class="wrap-imagem"><img class="img-na-marca" src="${escaparHtml(capaUrl).replace(/"/g, "&quot;")}" alt="Camiseta de ${escaparHtml(time.nome)}" loading="lazy" />${marcaOverlay}</span>`
    : `<span class="produto-sem-imagem" style="background:${corDoTime(time.nome)}" aria-hidden="true">👕</span>`;

  const cliente = nomeClienteLoja(time);
  const preco = precoDoCard(time.id);

  item.innerHTML = `
    <span class="produto-img">${imagem}<span class="produto-status">${status}</span></span>
    <span class="produto-corpo">
      ${cliente ? `<span class="produto-cliente">${escaparHtml(cliente)}</span>` : ""}
      <span class="produto-nome">${escaparHtml(time.nome)}</span>
      ${preco ? `<span class="produto-preco">${escaparHtml(preco)}</span>` : ""}
      <span class="produto-cta">${escaparHtml(acao)} →</span>
    </span>
  `;
  return item;
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
