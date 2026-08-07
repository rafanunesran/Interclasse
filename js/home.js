// ============================================================
// PÁGINA INICIAL: lista as turmas cadastradas
// ============================================================

async function carregarTurmas() {
  const lista = document.getElementById("listaTurmas");
  const carregando = document.getElementById("carregando");

  try {
    // O login anônimo é necessário apenas para GRAVAR (na página da turma).
    // A leitura das turmas é pública, então se o login anônimo falhar aqui
    // (ex.: provedor "Anônimo" não ativado no Firebase) seguimos mesmo assim
    // e ainda listamos as turmas normalmente.
    try {
      await entrarAnonimo();
    } catch (e) {
      console.warn("Login anônimo indisponível; listando as turmas mesmo assim.", e);
    }

    try {
      aplicarConfigGeral(await carregarConfigGeral());
    } catch (e) {
      console.warn("Não foi possível aplicar as configurações gerais.", e);
    }

    const snap = await db.collection("turmas").orderBy("nome").get();

    carregando.classList.add("oculto");

    if (snap.empty) {
      lista.innerHTML = "<p>Nenhuma turma cadastrada ainda. Peça para a coordenação criar as turmas no painel administrativo.</p>";
      return;
    }

    lista.innerHTML = "";
    snap.forEach((doc) => {
      const turma = doc.data();
      const item = document.createElement("a");
      item.className = "turma-card";
      item.href = "turma.html?id=" + encodeURIComponent(doc.id);

      const statusId = statusPedidoDe(turma);
      const classeBadge = statusId === "aberto" ? "aberto" : statusId === "entregue" ? "pago" : "fechado";
      const status = `<span class="badge ${classeBadge}">${labelStatus(statusId)}</span>`;

      const acao = statusId === "aberto" ? "Cadastrar lista →" : "Ver detalhes";

      const imagem = turma.imagemUrl
        ? `<img class="turma-card-img" src="${encodeURI(turma.imagemUrl)}" alt="Camiseta de ${escaparHtml(turma.nome)}" />`
        : "";

      item.innerHTML = `
        ${imagem}
        <span class="turma-card-topo">
          <span class="turma-card-nome">${escaparHtml(turma.nome)}</span>
          ${status}
        </span>
        <span class="turma-card-acao">${acao}</span>
      `;
      lista.appendChild(item);
    });
  } catch (erro) {
    console.error(erro);
    carregando.textContent = "Erro ao carregar turmas. Verifique a configuração do Firebase (js/firebase-config.js).";
  }
}

carregarTurmas();
