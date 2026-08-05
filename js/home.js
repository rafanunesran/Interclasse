// ============================================================
// PÁGINA INICIAL: lista as turmas cadastradas
// ============================================================

async function carregarTurmas() {
  const lista = document.getElementById("listaTurmas");
  const carregando = document.getElementById("carregando");

  try {
    await authPronta;
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
      item.href = "turma.html?id=" + encodeURIComponent(doc.id);

      const status = turma.fechado
        ? '<span class="badge fechado">Fechado</span>'
        : '<span class="badge aberto">Aberto</span>';

      item.innerHTML = `<span>${turma.nome}</span>${status}`;
      lista.appendChild(item);
    });
  } catch (erro) {
    console.error(erro);
    carregando.textContent = "Erro ao carregar turmas. Verifique a configuração do Firebase (js/firebase-config.js).";
  }
}

carregarTurmas();
