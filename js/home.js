// ============================================================
// PÁGINA INICIAL: lista os times cadastrados
// ============================================================

async function carregarTimes() {
  const lista = document.getElementById("listaTimes");
  const carregando = document.getElementById("carregando");

  try {
    // O login anônimo é necessário apenas para GRAVAR (na página do time).
    // A leitura dos times é pública, então se o login anônimo falhar aqui
    // (ex.: provedor "Anônimo" não ativado no Firebase) seguimos mesmo assim
    // e ainda listamos os times normalmente.
    try {
      await entrarAnonimo();
    } catch (e) {
      console.warn("Login anônimo indisponível; listando os times mesmo assim.", e);
    }

    try {
      aplicarConfigGeral(await carregarConfigGeral());
    } catch (e) {
      console.warn("Não foi possível aplicar as configurações gerais.", e);
    }

    const snap = await db.collection(COL_TIMES).orderBy("nome").get();

    carregando.classList.add("oculto");

    if (snap.empty) {
      lista.innerHTML = "<p>Nenhum time cadastrado ainda. Peça para a coordenação criar os times no painel administrativo.</p>";
      return;
    }

    lista.innerHTML = "";
    snap.forEach((doc) => {
      const time = doc.data();
      const item = document.createElement("a");
      item.className = "time-card";
      item.href = "time.html?id=" + encodeURIComponent(doc.id);

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
      lista.appendChild(item);
    });
  } catch (erro) {
    console.error(erro);
    carregando.textContent = "Erro ao carregar times. Verifique a configuração do Firebase (js/firebase-config.js).";
  }
}

carregarTimes();
