// ============================================================
// ABA PRODUÇÃO — levas de produção (Super Admin)
// ============================================================
// A aba Inicial exporta o CSV de um pedido inteiro (só o que foi pago). Aqui é
// o contrário: você MONTA a leva escolhendo camiseta por camiseta, de times e
// clientes diferentes, e ainda pode acrescentar unidades avulsas (professores,
// reposição, amostra) que não estão em nenhum pedido. É como se adianta um
// pedaço de um pedido junto com outro.
//
// Cada camiseta da leva carrega o seu MODELO (a arte que vai ser impressa).
// Na hora de exportar, a leva é dividida por modelo: um CSV para cada arte,
// porque cada uma vai para uma abertura diferente no programa de impressão.
//
// No Firestore: coleção `producao` (uma leva por documento) + subcoleção
// `itens` (uma camiseta por documento). Só a conta administradora lê e grava.
//
// Este arquivo é carregado DEPOIS de js/admin.js e usa o estado dele
// (estadoTimes, clienteFiltro, timesFiltrados…), que já vem preenchido pelos
// listeners do Firestore.

// ---------------- Estado ----------------

const estadoLevas = {}; // levaId -> { leva, itens: [], expandida, escutando }

// Camisetas marcadas no seletor, como "timeId/alunoId" (a mesma chave do
// carrinho: uma camiseta é única dentro do time).
const selecaoProducao = new Set();

let prodFiltroTime = "";        // "" = todos os times do cliente escolhido
let prodFiltroPagamento = "";   // "" | "pagos" | "pendentes"
let prodFiltroTamanho = "";     // "" = todos
let prodBusca = "";             // busca por nome / nome na camiseta / número
let prodEsconderNaLeva = false; // esconder o que já está em alguma leva
let prodDestino = "";           // leva escolhida na barra de ações
let prodLevasIniciado = false;

// Estado só de tela, preservado entre os re-renders (o Firestore avisa a cada
// mudança, e sem isto o time recolheria e o formulário se apagaria sozinho).
const prodTimesAbertos = {};  // timeId -> true quando o bloco está aberto
const prodAvulsoEstado = {};  // levaId -> { aberto, modelo, nome, numero, tamanho, qtd, lote }
const prodItensUnsub = {};    // levaId -> função que encerra o listener dos itens

// Escapa um texto para ir DENTRO de um atributo HTML (aspas incluídas).
// escapeHtmlAdmin() cuida do conteúdo; para atributo, as aspas também contam.
function escAttr(texto) {
  return escapeHtmlAdmin(texto).replace(/"/g, "&quot;");
}

const STATUS_LEVA = [
  { id: "aberta", label: "Em montagem" },
  { id: "enviada", label: "Enviada para impressão" },
  { id: "concluida", label: "Concluída" }
];

const elListaLevas = document.getElementById("listaLevas");
const elSelecaoProducao = document.getElementById("selecaoProducao");
const elFiltrosProducao = document.getElementById("filtrosProducao");
const elBarraProducao = document.getElementById("barraProducao");
const elFormNovaLeva = document.getElementById("formNovaLeva");
const elNomeNovaLeva = document.getElementById("nomeNovaLeva");
const elObsNovaLeva = document.getElementById("obsNovaLeva");
const elMsgNovaLeva = document.getElementById("msgNovaLeva");

// ---------------- Leitura do Firestore ----------------

function escutarLevas() {
  if (prodLevasIniciado || !elListaLevas) return;
  prodLevasIniciado = true;

  db.collection(COL_PRODUCAO)
    .orderBy("criadaEmMs", "desc")
    .onSnapshot(
      (snap) => {
        const idsAtuais = new Set();
        snap.forEach((doc) => {
          idsAtuais.add(doc.id);
          const antes = estadoLevas[doc.id] || {};
          estadoLevas[doc.id] = {
            leva: { id: doc.id, ...doc.data() },
            itens: antes.itens || [],
            expandida: antes.expandida === true,
            escutando: antes.escutando === true
          };
          if (!estadoLevas[doc.id].escutando) {
            estadoLevas[doc.id].escutando = true;
            escutarItensDaLeva(doc.id);
          }
        });
        Object.keys(estadoLevas).forEach((id) => {
          if (idsAtuais.has(id)) return;
          if (prodItensUnsub[id]) {
            prodItensUnsub[id]();
            delete prodItensUnsub[id];
          }
          delete estadoLevas[id];
          delete prodAvulsoEstado[id];
        });
        if (prodDestino && !estadoLevas[prodDestino]) prodDestino = "";
        renderizarProducao();
      },
      (erro) => console.error("Erro ao carregar as levas de produção:", erro)
    );
}

function escutarItensDaLeva(levaId) {
  prodItensUnsub[levaId] = db.collection(COL_PRODUCAO)
    .doc(levaId)
    .collection(SUB_ITENS_PRODUCAO)
    .onSnapshot(
      (snap) => {
        if (!estadoLevas[levaId]) return;
        estadoLevas[levaId].itens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderizarProducao();
      },
      (erro) => console.error("Erro ao carregar os itens da leva:", erro)
    );
}

// ---------------- Auxiliares ----------------

function levasOrdenadas() {
  return Object.values(estadoLevas).sort(
    (a, b) => (b.leva.criadaEmMs || 0) - (a.leva.criadaEmMs || 0)
  );
}

function labelStatusLeva(id) {
  const s = STATUS_LEVA.find((x) => x.id === id);
  return s ? s.label : "Em montagem";
}

function classeBadgeLeva(id) {
  if (id === "concluida") return "pago";
  if (id === "enviada") return "aguardando";
  return "aberto";
}

// Id do documento de um item que veio de um pedido. Como é derivado do time e
// do aluno, a mesma camiseta nunca entra duas vezes na MESMA leva.
function idItemDePedido(timeId, alunoId) {
  return `${timeId}__${alunoId}`;
}

// Em quais levas esta camiseta já está (usado para avisar antes de repetir).
function levasComItem(timeId, alunoId) {
  const idItem = idItemDePedido(timeId, alunoId);
  return levasOrdenadas()
    .filter((e) => e.itens.some((i) => i.id === idItem))
    .map((e) => e.leva);
}

// Valores ATUAIS de um item da leva. Para o que veio de um pedido, vale o que
// está no cadastro agora (se o nome foi corrigido depois, é o corrigido que vai
// para a impressão); a cópia guardada na leva só serve de reserva para quando a
// camiseta some do pedido. Para o avulso, os valores são os da própria leva.
function itemAtual(item) {
  const base = {
    nome: item.nome || "",
    nomeCamiseta: item.nomeCamiseta || "",
    numero: item.numero || "",
    tamanho: item.tamanho || "",
    modelo: item.modelo || MODELO_PADRAO,
    timeNome: item.timeNome || "",
    clienteNome: item.clienteNome || "",
    avulso: item.origem === "avulso",
    removido: false,
    mudou: false,
    pago: !!item.pago,
    pagamentoForma: item.pagamentoForma || ""
  };
  if (item.origem === "avulso") return base;

  const estado = estadoTimes[item.timeId];
  const aluno = estado && estado.alunos.find((a) => a.id === item.alunoId);
  if (!aluno) {
    base.removido = true;
    return base;
  }
  base.mudou =
    (aluno.nome || "") !== (item.nome || "") ||
    (aluno.nomeCamiseta || "") !== (item.nomeCamiseta || "") ||
    String(aluno.numero || "") !== String(item.numero || "") ||
    (aluno.tamanho || "") !== (item.tamanho || "");
  base.nome = aluno.nome || "";
  base.nomeCamiseta = aluno.nomeCamiseta || "";
  base.numero = aluno.numero || "";
  base.tamanho = aluno.tamanho || "";
  base.pago = !!aluno.pago;
  base.pagamentoForma = aluno.pagamentoForma || "";
  base.timeNome = (estado.time && estado.time.nome) || item.timeNome || "";
  return base;
}

// Agrupa os itens de uma leva por modelo (a divisão que vira um CSV por arte).
function agruparPorModelo(itens) {
  const grupos = new Map();
  (itens || []).forEach((item) => {
    const atual = itemAtual(item);
    const modelo = String(item.modelo || MODELO_PADRAO).trim() || MODELO_PADRAO;
    if (!grupos.has(modelo)) grupos.set(modelo, []);
    grupos.get(modelo).push({ item, atual });
  });
  return [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([modelo, linhas]) => ({
      modelo,
      linhas: linhas.sort((a, b) =>
        String(a.atual.nome).localeCompare(String(b.atual.nome), "pt-BR")
      )
    }));
}

// Todos os modelos conhecidos: os dos times visíveis mais os já usados na leva.
function modelosConhecidos(levaId) {
  const nomes = new Set();
  timesFiltrados().forEach(([, e]) => nomes.add(modeloDoTime(e.time)));
  if (levaId && estadoLevas[levaId]) {
    estadoLevas[levaId].itens.forEach((i) => nomes.add(i.modelo || MODELO_PADRAO));
  }
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// ---------------- Render ----------------

function renderizarProducao() {
  if (!elListaLevas) return; // outra página
  renderizarListaLevas();
  renderizarFiltrosProducao();
  renderizarSelecaoProducao();
  renderizarBarraProducao();
}

// ---------------- Levas ----------------

function renderizarListaLevas() {
  elListaLevas.innerHTML = "";
  const levas = levasOrdenadas();

  if (levas.length === 0) {
    elListaLevas.innerHTML =
      "<p>Nenhuma leva criada ainda. Crie uma acima e depois escolha as camisetas na lista abaixo.</p>";
    return;
  }

  levas.forEach(({ leva, itens, expandida }) => {
    const card = document.createElement("div");
    card.className = "card leva";

    const grupos = agruparPorModelo(itens);
    const statusId = leva.status || "aberta";
    const resumoModelos = grupos.length
      ? grupos.map((g) => `${escapeHtmlAdmin(g.modelo)} (${g.linhas.length})`).join(" &middot; ")
      : "nenhuma camiseta ainda";
    const nPagos = itens.filter((i) => itemAtual(i).pago).length;
    const nRemovidos = itens.filter((i) => itemAtual(i).removido).length;

    card.innerHTML = `
      <h3>${escapeHtmlAdmin(leva.nome || "Leva sem nome")}
        <span class="badge ${classeBadgeLeva(statusId)}">${escapeHtmlAdmin(labelStatusLeva(statusId))}</span>
      </h3>
      ${leva.observacao ? `<p class="pix-ajuda">${escapeHtmlAdmin(leva.observacao)}</p>` : ""}
      <p><strong>${itens.length} camiseta(s)</strong> em <strong>${grupos.length} modelo(s)</strong>
         &middot; ${nPagos} paga(s), ${itens.length - nPagos} não paga(s)</p>
      <p class="pix-ajuda">Modelos: ${resumoModelos}</p>
      ${nRemovidos > 0
        ? `<p class="aviso-ajustes"><span class="marca-ajuste">!</span> ${nRemovidos} camiseta(s) desta leva já não existe(m) no pedido de origem — confira antes de imprimir.</p>`
        : ""}
    `;

    // Status da leva.
    const linhaStatus = document.createElement("div");
    linhaStatus.className = "linha-status-admin";
    const lbl = document.createElement("label");
    lbl.textContent = "Situação da leva:";
    const sel = document.createElement("select");
    sel.className = "select-status";
    STATUS_LEVA.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.label;
      sel.appendChild(o);
    });
    sel.value = statusId;
    sel.onchange = () =>
      db.collection(COL_PRODUCAO).doc(leva.id).update({
        status: sel.value,
        atualizadaEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    linhaStatus.appendChild(lbl);
    linhaStatus.appendChild(sel);
    card.appendChild(linhaStatus);

    const botoes = document.createElement("div");

    const btnVer = document.createElement("button");
    btnVer.className = "secundario";
    btnVer.textContent = expandida ? "Ocultar itens" : `Ver itens (${itens.length})`;
    btnVer.onclick = () => {
      estadoLevas[leva.id].expandida = !expandida;
      renderizarProducao();
    };
    botoes.appendChild(btnVer);

    const btnCsvs = document.createElement("button");
    btnCsvs.className = "primario";
    btnCsvs.textContent = `Baixar CSVs por modelo (${grupos.length})`;
    btnCsvs.title = "Um arquivo de produção para cada modelo de camiseta desta leva";
    btnCsvs.onclick = () => baixarCsvsDaLeva(leva, grupos);
    botoes.appendChild(btnCsvs);

    const btnConf = document.createElement("button");
    btnConf.className = "secundario";
    btnConf.textContent = "CSV de conferência";
    btnConf.title = "Lista completa da leva, com time, cliente, modelo e pagamento";
    btnConf.onclick = () => exportarConferenciaLeva(leva, grupos);
    botoes.appendChild(btnConf);

    const btnRenomear = document.createElement("button");
    btnRenomear.className = "secundario";
    btnRenomear.textContent = "Renomear";
    btnRenomear.onclick = () => renomearLeva(leva);
    botoes.appendChild(btnRenomear);

    const btnExcluir = document.createElement("button");
    btnExcluir.className = "perigo";
    btnExcluir.textContent = "Excluir leva";
    btnExcluir.onclick = () => excluirLeva(leva, itens.length);
    botoes.appendChild(btnExcluir);

    card.appendChild(botoes);

    if (expandida) {
      card.appendChild(criarFormAvulso(leva));
      if (grupos.length === 0) {
        const vazio = document.createElement("p");
        vazio.textContent =
          "Leva vazia. Marque camisetas na lista abaixo e clique em “Enviar para a produção”, ou acrescente unidades avulsas acima.";
        card.appendChild(vazio);
      }
      grupos.forEach((g) => card.appendChild(criarBlocoModelo(leva, g)));
    }

    elListaLevas.appendChild(card);
  });
}

// Bloco de um modelo dentro da leva: é exatamente o que sai num CSV.
function criarBlocoModelo(leva, grupo) {
  const bloco = document.createElement("div");
  bloco.className = "modelo-leva";

  const cabecalho = document.createElement("div");
  cabecalho.className = "modelo-leva-cabecalho";
  const titulo = document.createElement("h4");
  titulo.textContent = `Modelo: ${grupo.modelo} — ${grupo.linhas.length} camiseta(s)`;
  cabecalho.appendChild(titulo);

  const btn = document.createElement("button");
  btn.className = "secundario";
  btn.textContent = "CSV deste modelo";
  btn.onclick = () => {
    baixarCSVProducaoItens(nomeArquivoModelo(leva, grupo.modelo), grupo.linhas.map((l) => l.atual));
  };
  cabecalho.appendChild(btn);
  bloco.appendChild(cabecalho);

  const tabela = document.createElement("table");
  tabela.innerHTML = `
    <thead>
      <tr><th>Nome na camiseta</th><th>Número</th><th>Tamanho</th><th>Origem</th><th>Pagamento</th><th>Ações</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabela.querySelector("tbody");

  grupo.linhas.forEach(({ item, atual }) => {
    const tr = document.createElement("tr");
    if (atual.removido) tr.classList.add("linha-fora-producao");

    const origem = atual.avulso
      ? '<span class="badge interno">Avulso</span>'
      : escapeHtmlAdmin(atual.timeNome || item.timeNome || "—") +
        (atual.clienteNome ? `<br><small class="pix-ajuda">${escapeHtmlAdmin(atual.clienteNome)}</small>` : "");

    const avisos =
      (atual.removido
        ? '<br><small class="motivo-ajuste">Já não existe no pedido — vai pelo que foi salvo aqui.</small>'
        : "") +
      (atual.mudou
        ? '<br><small class="motivo-ajuste">Mudou no pedido depois de entrar na leva — o CSV usa o valor de agora.</small>'
        : "");

    tr.innerHTML = `
      <td>${escapeHtmlAdmin(nomeNaCamiseta(atual) || "—")}${avisos}
          ${!atual.avulso && atual.nome && atual.nomeCamiseta
            ? `<br><small class="pix-ajuda">${escapeHtmlAdmin(atual.nome)}</small>` : ""}</td>
      <td>${escapeHtmlAdmin(atual.numero || "-")}</td>
      <td>${escapeHtmlAdmin(atual.tamanho || "-")}</td>
      <td>${origem}</td>
      <td>${atual.avulso ? '<span class="badge interno">—</span>' : badgePagamentoHtml(atual)}</td>
      <td class="acoes-linha"></td>
    `;

    const tdAcoes = tr.querySelector(".acoes-linha");

    // Trocar o modelo desta camiseta (é o que divide os CSVs).
    const selModelo = document.createElement("select");
    selModelo.className = "select-status";
    selModelo.title = "Modelo (arte) desta camiseta";
    const modelos = modelosConhecidos(leva.id);
    if (!modelos.includes(grupo.modelo)) modelos.push(grupo.modelo);
    modelos.sort((a, b) => a.localeCompare(b, "pt-BR"));
    selModelo.innerHTML =
      modelos.map((m) => `<option value="${escAttr(m)}">${escapeHtmlAdmin(m)}</option>`).join("") +
      '<option value="__novo__">Outro modelo…</option>';
    selModelo.value = grupo.modelo;
    selModelo.onchange = () => {
      let novo = selModelo.value;
      if (novo === "__novo__") {
        novo = (window.prompt("Nome do modelo (a arte que vai ser impressa):", grupo.modelo) || "").trim();
        if (!novo) {
          selModelo.value = grupo.modelo;
          return;
        }
      }
      db.collection(COL_PRODUCAO).doc(leva.id).collection(SUB_ITENS_PRODUCAO).doc(item.id)
        .update({ modelo: novo })
        .catch((e) => {
          console.error(e);
          alert("Não foi possível trocar o modelo.");
        });
    };
    tdAcoes.appendChild(selModelo);

    if (atual.avulso) {
      const btnEditar = document.createElement("button");
      btnEditar.className = "secundario";
      btnEditar.textContent = "Editar";
      btnEditar.onclick = () => editarAvulso(leva, item);
      tdAcoes.appendChild(btnEditar);
    }

    const btnTirar = document.createElement("button");
    btnTirar.className = "perigo";
    btnTirar.textContent = "Tirar da leva";
    btnTirar.onclick = () => {
      db.collection(COL_PRODUCAO).doc(leva.id).collection(SUB_ITENS_PRODUCAO).doc(item.id).delete()
        .catch((e) => {
          console.error(e);
          alert("Não foi possível tirar a camiseta da leva.");
        });
    };
    tdAcoes.appendChild(btnTirar);

    tbody.appendChild(tr);
  });

  bloco.appendChild(tabela);
  return bloco;
}

// ---------------- Avulsos (professores, reposição, amostra) ----------------

function criarFormAvulso(leva) {
  // O que estiver digitado sobrevive aos re-renders (o Firestore avisa a cada
  // mudança e a tela é redesenhada — sem isto, o texto colado se perderia).
  const memoria = prodAvulsoEstado[leva.id] || (prodAvulsoEstado[leva.id] = {
    aberto: false, modelo: "", nome: "", numero: "", tamanho: "", qtd: "1", lote: ""
  });

  const det = document.createElement("details");
  det.className = "avulso-leva";
  det.open = memoria.aberto;
  det.addEventListener("toggle", () => { memoria.aberto = det.open; });

  const sum = document.createElement("summary");
  sum.textContent = "+ Acrescentar camisetas avulsas (professores, reposição…)";
  det.appendChild(sum);

  const ajuda = document.createElement("p");
  ajuda.className = "pix-ajuda";
  ajuda.textContent =
    "Camisetas que não estão em nenhum pedido. Escolha o modelo (a arte) e informe nome, número e tamanho — ou cole uma lista, uma camiseta por linha.";
  det.appendChild(ajuda);

  // Liga um campo à memória da tela.
  const lembrar = (el, chave) => {
    el.value = memoria[chave] || "";
    el.addEventListener("input", () => { memoria[chave] = el.value; });
    el.addEventListener("change", () => { memoria[chave] = el.value; });
    return el;
  };

  const lblModelo = document.createElement("label");
  lblModelo.textContent = "Modelo (arte)";
  const inModelo = document.createElement("input");
  inModelo.type = "text";
  inModelo.placeholder = "Ex: Professores 2026";
  inModelo.setAttribute("list", "modelos-conhecidos-" + leva.id);
  lembrar(inModelo, "modelo");
  const datalist = document.createElement("datalist");
  datalist.id = "modelos-conhecidos-" + leva.id;
  datalist.innerHTML = modelosConhecidos(leva.id)
    .map((m) => `<option value="${escAttr(m)}"></option>`)
    .join("");
  det.appendChild(lblModelo);
  det.appendChild(inModelo);
  det.appendChild(datalist);

  const linha = document.createElement("div");
  linha.className = "avulso-campos";

  const inNome = document.createElement("input");
  inNome.type = "text";
  inNome.placeholder = "Nome na camiseta";
  lembrar(inNome, "nome");

  const inNumero = document.createElement("input");
  inNumero.type = "text";
  inNumero.placeholder = "Número";
  lembrar(inNumero, "numero");

  const selTamanho = document.createElement("select");
  selTamanho.innerHTML =
    '<option value="">Tamanho</option>' +
    GRUPOS_TAMANHO.map(
      (g) =>
        `<optgroup label="${escAttr(g.grupo)}">` +
        g.tamanhos.map((t) => `<option value="${escAttr(t)}">${escapeHtmlAdmin(t)}</option>`).join("") +
        "</optgroup>"
    ).join("");
  lembrar(selTamanho, "tamanho");

  const inQtd = document.createElement("input");
  inQtd.type = "number";
  inQtd.min = "1";
  inQtd.title = "Quantas camisetas iguais a esta";
  lembrar(inQtd, "qtd");
  if (!inQtd.value) inQtd.value = "1";

  const btnAdd = document.createElement("button");
  btnAdd.type = "button";
  btnAdd.className = "sucesso";
  btnAdd.textContent = "Acrescentar";
  btnAdd.onclick = async () => {
    const modelo = inModelo.value.trim();
    if (!modelo) {
      alert("Informe o modelo (a arte) desta camiseta.");
      return;
    }
    const quantidade = Math.max(1, parseInt(inQtd.value, 10) || 1);
    const base = {
      nome: inNome.value.trim(),
      nomeCamiseta: inNome.value.trim(),
      numero: inNumero.value.trim(),
      tamanho: selTamanho.value
    };
    if (!base.nome && !base.numero && !base.tamanho) {
      alert("Preencha ao menos o nome ou o tamanho.");
      return;
    }
    btnAdd.disabled = true;
    try {
      await gravarAvulsos(leva.id, modelo, Array.from({ length: quantidade }, () => ({ ...base })));
      memoria.nome = "";
      memoria.numero = "";
      memoria.qtd = "1";
      inNome.value = "";
      inNumero.value = "";
      inQtd.value = "1";
    } catch (e) {
      console.error(e);
      alert("Não foi possível acrescentar a camiseta avulsa.");
    } finally {
      btnAdd.disabled = false;
    }
  };

  const lblQtd = document.createElement("label");
  lblQtd.className = "avulso-qtd";
  lblQtd.textContent = "Qtd.";
  lblQtd.appendChild(inQtd);

  linha.appendChild(inNome);
  linha.appendChild(inNumero);
  linha.appendChild(selTamanho);
  linha.appendChild(lblQtd);
  linha.appendChild(btnAdd);
  det.appendChild(linha);

  const lblLote = document.createElement("label");
  lblLote.textContent = "Ou cole uma lista (uma camiseta por linha: nome, número, tamanho)";
  const txtLote = document.createElement("textarea");
  txtLote.rows = 4;
  txtLote.placeholder = "PROF. ANA, 1, M\nPROF. BRUNO, 2, G\nCOORDENAÇÃO, , GG";
  lembrar(txtLote, "lote");

  const btnLote = document.createElement("button");
  btnLote.type = "button";
  btnLote.className = "secundario";
  btnLote.textContent = "Acrescentar a lista";
  btnLote.onclick = async () => {
    const modelo = inModelo.value.trim();
    if (!modelo) {
      alert("Informe o modelo (a arte) antes de colar a lista.");
      return;
    }
    const itens = interpretarListaAvulsa(txtLote.value);
    if (itens.length === 0) {
      alert("Nenhuma linha reconhecida. Use uma camiseta por linha: nome, número, tamanho.");
      return;
    }
    if (!confirm(`Acrescentar ${itens.length} camiseta(s) ao modelo "${modelo}"?`)) return;
    btnLote.disabled = true;
    try {
      await gravarAvulsos(leva.id, modelo, itens);
      memoria.lote = "";
      txtLote.value = "";
    } catch (e) {
      console.error(e);
      alert("Não foi possível acrescentar a lista.");
    } finally {
      btnLote.disabled = false;
    }
  };

  det.appendChild(lblLote);
  det.appendChild(txtLote);
  det.appendChild(btnLote);
  return det;
}

// Lê o texto colado: uma camiseta por linha, campos separados por vírgula,
// ponto e vírgula ou tabulação. Com dois campos, o segundo é o tamanho quando
// bate com um tamanho cadastrado; senão é o número.
function interpretarListaAvulsa(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const partes = linha.split(/[;,\t]/).map((p) => p.trim());
      const nome = partes[0] || "";
      let numero = "";
      let tamanho = "";
      if (partes.length >= 3) {
        numero = partes[1] || "";
        tamanho = partes[2] || "";
      } else if (partes.length === 2) {
        if (TODOS_TAMANHOS.some((t) => t.toLowerCase() === partes[1].toLowerCase())) {
          tamanho = partes[1];
        } else {
          numero = partes[1];
        }
      }
      return { nome, nomeCamiseta: nome, numero, tamanho };
    })
    .filter((i) => i.nome || i.numero || i.tamanho);
}

async function gravarAvulsos(levaId, modelo, itens) {
  const col = db.collection(COL_PRODUCAO).doc(levaId).collection(SUB_ITENS_PRODUCAO);
  const lote = db.batch();
  itens.forEach((i) => {
    lote.set(col.doc(), {
      origem: "avulso",
      modelo,
      nome: i.nome || "",
      nomeCamiseta: i.nomeCamiseta || i.nome || "",
      numero: i.numero || "",
      tamanho: i.tamanho || "",
      criadoEmMs: Date.now()
    });
  });
  await lote.commit();
  await db.collection(COL_PRODUCAO).doc(levaId).update({
    atualizadaEm: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function editarAvulso(leva, item) {
  const nome = window.prompt("Nome na camiseta:", item.nomeCamiseta || item.nome || "");
  if (nome === null) return;
  const numero = window.prompt("Número:", item.numero || "");
  if (numero === null) return;
  const tamanho = window.prompt(`Tamanho (${TODOS_TAMANHOS.join(", ")}):`, item.tamanho || "");
  if (tamanho === null) return;
  db.collection(COL_PRODUCAO).doc(leva.id).collection(SUB_ITENS_PRODUCAO).doc(item.id)
    .update({
      nome: nome.trim(),
      nomeCamiseta: nome.trim(),
      numero: numero.trim(),
      tamanho: tamanho.trim()
    })
    .catch((e) => {
      console.error(e);
      alert("Não foi possível salvar a camiseta avulsa.");
    });
}

// ---------------- Criar / renomear / excluir leva ----------------

if (elFormNovaLeva) {
  elFormNovaLeva.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    esconderMensagem(elMsgNovaLeva);
    const nome = elNomeNovaLeva.value.trim();
    if (!nome) return;
    try {
      const id = await criarLeva(nome, elObsNovaLeva.value.trim());
      prodDestino = id;
      elFormNovaLeva.reset();
      mostrarMensagem(elMsgNovaLeva, `Leva "${nome}" criada — já é o destino do que você marcar abaixo.`, "aviso");
      renderizarProducao();
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(elMsgNovaLeva, "Erro ao criar a leva.", "erro");
    }
  });
}

async function criarLeva(nome, observacao) {
  const base = slugify(nome) || "leva";
  let id = base;
  let sufixo = 2;
  while ((await db.collection(COL_PRODUCAO).doc(id).get()).exists) {
    id = `${base}-${sufixo}`;
    sufixo++;
  }
  await db.collection(COL_PRODUCAO).doc(id).set({
    nome,
    observacao: observacao || "",
    status: "aberta",
    clienteId: clienteFiltro && clienteFiltro !== SEM_CLIENTE ? clienteFiltro : "",
    criadaEmMs: Date.now(),
    criadaEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  return id;
}

function renomearLeva(leva) {
  const nome = window.prompt("Nome da leva:", leva.nome || "");
  if (nome === null) return;
  const limpo = nome.trim();
  if (!limpo) return;
  const observacao = window.prompt("Observação (opcional):", leva.observacao || "");
  if (observacao === null) return;
  db.collection(COL_PRODUCAO).doc(leva.id)
    .update({ nome: limpo, observacao: observacao.trim() })
    .catch((e) => {
      console.error(e);
      alert("Não foi possível renomear a leva.");
    });
}

async function excluirLeva(leva, qtd) {
  if (!confirm(
    `Excluir a leva "${leva.nome}"?\n\n` +
    `As ${qtd} camiseta(s) saem da leva (os pedidos e os cadastros não são alterados). ` +
    `As camisetas avulsas desta leva são apagadas de vez.`
  )) return;
  try {
    const snap = await db.collection(COL_PRODUCAO).doc(leva.id).collection(SUB_ITENS_PRODUCAO).get();
    // O Firestore não apaga subcoleção sozinho: vai em lotes de 400 documentos.
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const lote = db.batch();
      docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
    await db.collection(COL_PRODUCAO).doc(leva.id).delete();
  } catch (erro) {
    console.error(erro);
    alert("Erro ao excluir a leva. Tente novamente.");
  }
}

// ---------------- Seletor de camisetas ----------------

function renderizarFiltrosProducao() {
  if (!elFiltrosProducao) return;

  const times = timesFiltrados()
    .sort((a, b) => a[1].time.nome.localeCompare(b[1].time.nome, "pt-BR"));
  if (prodFiltroTime && !times.some(([id]) => id === prodFiltroTime)) prodFiltroTime = "";

  elFiltrosProducao.innerHTML = `
    <div class="fin-filtros filtros-producao">
      <label>Time
        <select id="prodFiltroTime">
          <option value="">Todos os times</option>
          ${times.map(([id, e]) => `<option value="${escAttr(id)}">${escapeHtmlAdmin(e.time.nome)}</option>`).join("")}
        </select>
      </label>
      <label>Pagamento
        <select id="prodFiltroPagamento">
          <option value="">Pagas e não pagas</option>
          <option value="pagos">Só as pagas</option>
          <option value="pendentes">Só as não pagas</option>
        </select>
      </label>
      <label>Tamanho
        <select id="prodFiltroTamanho">
          <option value="">Todos os tamanhos</option>
          ${TODOS_TAMANHOS.map((t) => `<option value="${escAttr(t)}">${escapeHtmlAdmin(t)}</option>`).join("")}
        </select>
      </label>
      <label>Buscar
        <input type="search" id="prodBusca" placeholder="nome, número…" value="${escAttr(prodBusca)}" />
      </label>
      <label class="checkbox-inline">
        <input type="checkbox" id="prodEsconderNaLeva" ${prodEsconderNaLeva ? "checked" : ""} />
        Esconder o que já está em alguma leva
      </label>
    </div>
  `;

  const selTime = elFiltrosProducao.querySelector("#prodFiltroTime");
  selTime.value = prodFiltroTime;
  selTime.onchange = () => { prodFiltroTime = selTime.value; renderizarProducao(); };

  const selPag = elFiltrosProducao.querySelector("#prodFiltroPagamento");
  selPag.value = prodFiltroPagamento;
  selPag.onchange = () => { prodFiltroPagamento = selPag.value; renderizarProducao(); };

  const selTam = elFiltrosProducao.querySelector("#prodFiltroTamanho");
  selTam.value = prodFiltroTamanho;
  selTam.onchange = () => { prodFiltroTamanho = selTam.value; renderizarProducao(); };

  const inBusca = elFiltrosProducao.querySelector("#prodBusca");
  inBusca.oninput = () => {
    prodBusca = inBusca.value;
    renderizarSelecaoProducao();
    renderizarBarraProducao();
  };

  const chk = elFiltrosProducao.querySelector("#prodEsconderNaLeva");
  chk.onchange = () => { prodEsconderNaLeva = chk.checked; renderizarProducao(); };
}

// As camisetas de um time que passam pelos filtros da aba.
function alunosVisiveis(timeId, alunos) {
  const busca = prodBusca.trim().toLowerCase();
  return alunos.filter((a) => {
    if (prodFiltroPagamento === "pagos" && !a.pago) return false;
    if (prodFiltroPagamento === "pendentes" && a.pago) return false;
    if (prodFiltroTamanho && a.tamanho !== prodFiltroTamanho) return false;
    if (prodEsconderNaLeva && levasComItem(timeId, a.id).length > 0) return false;
    if (busca) {
      const alvo = `${a.nome || ""} ${a.nomeCamiseta || ""} ${a.numero || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderizarSelecaoProducao() {
  if (!elSelecaoProducao) return;
  elSelecaoProducao.innerHTML = "";

  const times = timesFiltrados()
    .filter(([id]) => !prodFiltroTime || id === prodFiltroTime)
    .sort((a, b) => a[1].time.nome.localeCompare(b[1].time.nome, "pt-BR"));

  let totalVisivel = 0;

  times.forEach(([timeId, { time, alunos }]) => {
    const visiveis = alunosVisiveis(timeId, alunos);
    if (visiveis.length === 0) return;
    totalVisivel += visiveis.length;

    const det = document.createElement("details");
    det.className = "prod-time";
    if (prodTimesAbertos[timeId] === undefined) {
      prodTimesAbertos[timeId] = times.length <= 3 || !!prodFiltroTime;
    }
    det.open = prodTimesAbertos[timeId];
    det.addEventListener("toggle", () => { prodTimesAbertos[timeId] = det.open; });

    const sum = document.createElement("summary");
    const nPagos = visiveis.filter((a) => a.pago).length;
    sum.innerHTML =
      `<strong>${escapeHtmlAdmin(time.nome)}</strong> ` +
      `<span class="badge ${classeBadgeStatus(statusPedidoDe(time))}">${escapeHtmlAdmin(labelStatus(statusPedidoDe(time)))}</span> ` +
      `<span class="pix-ajuda">${escapeHtmlAdmin(nomeClienteDoTime(time))} &middot; modelo “${escapeHtmlAdmin(modeloDoTime(time))}” ` +
      `&middot; ${visiveis.length} camiseta(s), ${nPagos} paga(s)</span>`;
    det.appendChild(sum);

    const atalhos = document.createElement("div");
    atalhos.className = "prod-atalhos";
    atalhos.appendChild(criarAtalho("Marcar todas", () => marcarLista(timeId, visiveis, true)));
    atalhos.appendChild(criarAtalho("Marcar só as pagas", () => marcarLista(timeId, visiveis.filter((a) => a.pago), true)));
    atalhos.appendChild(criarAtalho("Desmarcar todas", () => marcarLista(timeId, visiveis, false)));
    det.appendChild(atalhos);

    const tabela = document.createElement("table");
    tabela.innerHTML = `
      <thead>
        <tr><th></th><th>Nome</th><th>Nome na camiseta</th><th>Número</th><th>Tamanho</th><th>Pagamento</th><th>Já na produção</th></tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tabela.querySelector("tbody");

    visiveis.forEach((aluno) => {
      const chave = chaveDoItem(timeId, aluno.id);
      const jaEm = levasComItem(timeId, aluno.id);

      const tr = document.createElement("tr");
      if (selecaoProducao.has(chave)) tr.classList.add("linha-marcada");

      tr.innerHTML = `
        <td class="cel-marcar"></td>
        <td>${escapeHtmlAdmin(aluno.nome)}</td>
        <td>${escapeHtmlAdmin(aluno.nomeCamiseta || "-")}</td>
        <td>${escapeHtmlAdmin(aluno.numero || "-")}</td>
        <td>${escapeHtmlAdmin(aluno.tamanho || "-")}</td>
        <td>${badgePagamentoHtml(aluno)}</td>
        <td>${jaEm.length
          ? jaEm.map((l) => `<span class="badge aguardando">${escapeHtmlAdmin(l.nome || l.id)}</span>`).join(" ")
          : '<span class="pix-ajuda">—</span>'}</td>
      `;

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = selecaoProducao.has(chave);
      chk.onchange = () => {
        if (chk.checked) selecaoProducao.add(chave);
        else selecaoProducao.delete(chave);
        tr.classList.toggle("linha-marcada", chk.checked);
        renderizarBarraProducao();
      };
      tr.querySelector(".cel-marcar").appendChild(chk);

      tbody.appendChild(tr);
    });

    det.appendChild(tabela);
    elSelecaoProducao.appendChild(det);
  });

  if (totalVisivel === 0) {
    elSelecaoProducao.innerHTML =
      "<p>Nenhuma camiseta com os filtros de agora. Troque o cliente no topo, mude os filtros ou desmarque “esconder o que já está em alguma leva”.</p>";
  }
}

function criarAtalho(texto, acao) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "secundario";
  b.textContent = texto;
  b.onclick = acao;
  return b;
}

function marcarLista(timeId, alunos, marcar) {
  alunos.forEach((a) => {
    const chave = chaveDoItem(timeId, a.id);
    if (marcar) selecaoProducao.add(chave);
    else selecaoProducao.delete(chave);
  });
  renderizarSelecaoProducao();
  renderizarBarraProducao();
}

// ---------------- Barra de ações (enviar para a produção) ----------------

function renderizarBarraProducao() {
  if (!elBarraProducao) return;
  const n = selecaoProducao.size;
  const levas = levasOrdenadas();

  if (n === 0) {
    elBarraProducao.classList.add("oculto");
    elBarraProducao.innerHTML = "";
    return;
  }
  elBarraProducao.classList.remove("oculto");

  if (prodDestino && !estadoLevas[prodDestino]) prodDestino = "";
  if (!prodDestino && levas.length > 0) prodDestino = levas[0].leva.id;

  elBarraProducao.innerHTML = `
    <strong>${n} camiseta(s) marcada(s)</strong>
    <label>Leva de destino
      <select id="prodDestino">
        ${levas.map((e) => `<option value="${escAttr(e.leva.id)}">${escapeHtmlAdmin(e.leva.nome || e.leva.id)}</option>`).join("")}
        <option value="__nova__">➕ Nova leva…</option>
      </select>
    </label>
    <button type="button" class="primario" id="btnEnviarProducao">Enviar para a produção</button>
    <button type="button" class="secundario" id="btnLimparSelecao">Limpar seleção</button>
  `;

  const sel = elBarraProducao.querySelector("#prodDestino");
  sel.value = prodDestino || "__nova__";
  sel.onchange = () => { prodDestino = sel.value; };

  elBarraProducao.querySelector("#btnEnviarProducao").onclick = () => enviarSelecaoParaProducao();
  elBarraProducao.querySelector("#btnLimparSelecao").onclick = () => {
    selecaoProducao.clear();
    renderizarProducao();
  };
}

async function enviarSelecaoParaProducao() {
  const escolhidas = [...selecaoProducao];
  if (escolhidas.length === 0) return;

  let levaId = prodDestino;
  if (!levaId || levaId === "__nova__") {
    const nome = (window.prompt("Nome da nova leva:", sugestaoNomeLeva()) || "").trim();
    if (!nome) return;
    try {
      levaId = await criarLeva(nome, "");
    } catch (e) {
      console.error(e);
      alert("Não foi possível criar a leva.");
      return;
    }
  }

  // Monta os itens a partir do cadastro de agora, e avisa sobre repetições.
  const itens = [];
  let repetidas = 0;
  let perdidas = 0;
  escolhidas.forEach((chave) => {
    const corte = chave.indexOf("/");
    const timeId = chave.slice(0, corte);
    const alunoId = chave.slice(corte + 1);
    const estado = estadoTimes[timeId];
    const aluno = estado && estado.alunos.find((a) => a.id === alunoId);
    if (!estado || !aluno) {
      perdidas++;
      return;
    }
    const naLeva = (estadoLevas[levaId] && estadoLevas[levaId].itens) || [];
    if (naLeva.some((i) => i.id === idItemDePedido(timeId, alunoId))) repetidas++;
    itens.push({ timeId, alunoId, aluno, time: estado.time });
  });

  if (itens.length === 0) {
    alert("Nenhuma das camisetas marcadas existe mais no cadastro.");
    selecaoProducao.clear();
    renderizarProducao();
    return;
  }

  const nomeLeva = (estadoLevas[levaId] && estadoLevas[levaId].leva.nome) || levaId;
  const avisos = [];
  if (repetidas > 0) avisos.push(`${repetidas} já está(ão) nesta leva e será(ão) apenas atualizada(s).`);
  if (perdidas > 0) avisos.push(`${perdidas} não existe(m) mais no cadastro e ficará(ão) de fora.`);
  const naoPagas = itens.filter((i) => !i.aluno.pago).length;
  if (naoPagas > 0) avisos.push(`${naoPagas} ainda não foi(ram) paga(s) — vão assim mesmo, é a produção adiantada.`);

  if (!confirm(
    `Enviar ${itens.length} camiseta(s) para a leva "${nomeLeva}"?` +
    (avisos.length ? "\n\n" + avisos.join("\n") : "")
  )) return;

  try {
    const col = db.collection(COL_PRODUCAO).doc(levaId).collection(SUB_ITENS_PRODUCAO);
    for (let i = 0; i < itens.length; i += 400) {
      const lote = db.batch();
      itens.slice(i, i + 400).forEach(({ timeId, alunoId, aluno, time }) => {
        lote.set(
          col.doc(idItemDePedido(timeId, alunoId)),
          {
            origem: "pedido",
            timeId,
            alunoId,
            modelo: modeloDoTime(time),
            timeNome: time.nome || "",
            clienteNome: nomeClienteDoTime(time),
            // Cópia do que estava valendo na hora: serve de reserva se a
            // camiseta sumir do pedido depois.
            nome: aluno.nome || "",
            nomeCamiseta: aluno.nomeCamiseta || "",
            numero: aluno.numero || "",
            tamanho: aluno.tamanho || "",
            criadoEmMs: Date.now()
          },
          { merge: true }
        );
      });
      await lote.commit();
    }
    await db.collection(COL_PRODUCAO).doc(levaId).update({
      atualizadaEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    selecaoProducao.clear();
    if (estadoLevas[levaId]) estadoLevas[levaId].expandida = true;
    renderizarProducao();
  } catch (erro) {
    console.error(erro);
    alert("Erro ao enviar as camisetas para a produção. Tente novamente.");
  }
}

function sugestaoNomeLeva() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  return `Leva ${hoje}`;
}

// ---------------- Exportação ----------------

function nomeArquivoModelo(leva, modelo) {
  return `producao-${slugify(leva.nome || leva.id)}-${slugify(modelo) || "modelo"}.csv`;
}

// Um arquivo por modelo. Os navegadores bloqueiam vários downloads disparados
// no mesmo instante, então os arquivos saem em fila, com um respiro entre eles.
function baixarCsvsDaLeva(leva, grupos) {
  if (grupos.length === 0) {
    alert("Esta leva ainda não tem nenhuma camiseta.");
    return;
  }
  if (!confirm(
    `Baixar ${grupos.length} arquivo(s) — um por modelo?\n\n` +
    grupos.map((g) => `• ${g.modelo}: ${g.linhas.length} camiseta(s)`).join("\n") +
    "\n\nO navegador pode pedir permissão para baixar vários arquivos."
  )) return;

  grupos.forEach((g, i) => {
    setTimeout(() => {
      baixarCSVProducaoItens(nomeArquivoModelo(leva, g.modelo), g.linhas.map((l) => l.atual));
    }, i * 400);
  });
}

// Conferência da leva inteira: um arquivo só, com o modelo em cada linha.
function exportarConferenciaLeva(leva, grupos) {
  const linhas = [["Leva", "Modelo", "Cliente", "Time", "Origem", "Nome do Estudante", "Nome na Camiseta", "Numero", "Tamanho", "Pago", "Forma Pagto", "Situacao"]];
  grupos.forEach((g) => {
    g.linhas.forEach(({ atual }) => {
      linhas.push([
        leva.nome || leva.id,
        g.modelo,
        atual.avulso ? "" : atual.clienteNome,
        atual.avulso ? "" : atual.timeNome,
        atual.avulso ? "Avulso" : "Pedido",
        atual.avulso ? "" : atual.nome,
        nomeNaCamiseta(atual),
        atual.numero || "",
        atual.tamanho || "",
        atual.avulso ? "-" : (atual.pago ? "Sim" : "Nao"),
        atual.avulso ? "" : (atual.pagamentoForma || ""),
        atual.removido ? "Fora do pedido" : (atual.mudou ? "Alterada apos entrar" : "OK")
      ]);
    });
  });
  if (linhas.length === 1) {
    alert("Esta leva ainda não tem nenhuma camiseta.");
    return;
  }
  baixarCSV(`conferencia-${slugify(leva.nome || leva.id)}.csv`, linhas);
}
