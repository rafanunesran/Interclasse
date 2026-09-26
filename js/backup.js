// ============================================================
// ABA BACKUP (Super Admin)
// ============================================================
// Os backups são feitos pelo Apps Script (apps-script/Backup.gs): todo dia
// ele salva uma cópia de todos os dados do Firestore numa pasta privada do
// Google Drive. Esta aba lista, baixa e restaura esses backups.
//
// Guarda: os backups dos últimos 30 dias são protegidos (o script recusa
// apagá-los). Os mais antigos nunca saem sozinhos: só depois de o
// administrador confirmar aqui — e vão para a lixeira do Drive.
//
// Cada chamada leva o token de login da conta administradora; o script
// confere o e-mail antes de fazer qualquer coisa.
//
// Carregado depois de js/admin.js (usa driveScriptUrl e escapeHtmlAdmin).

const elBackupStatus = document.getElementById("backupStatus");
const elBackupLista = document.getElementById("backupLista");
const elBackupAntigos = document.getElementById("backupAntigos");
const elMsgBackup = document.getElementById("msgBackup");
const elModalRestaurar = document.getElementById("modalRestaurar");
const elRestaurarCorpo = document.getElementById("restaurarCorpo");
const elInputBackupArquivo = document.getElementById("inputBackupArquivo");

let backupEstado = null;     // última resposta de backupListar
let backupCarregando = false;

async function chamarBackup(acao, extra) {
  if (!driveScriptUrl) {
    throw new Error("Configure a URL do Apps Script na aba Configurações (a mesma das imagens).");
  }
  const user = auth.currentUser;
  if (!user) throw new Error("Sessão expirada: entre de novo como administrador.");
  const idToken = await user.getIdToken();
  const resp = await fetch(driveScriptUrl, {
    method: "POST",
    body: JSON.stringify({ acao, idToken, ...(extra || {}) })
  });
  let dados;
  try {
    dados = await resp.json();
  } catch (e) {
    throw new Error("O Apps Script não respondeu como esperado. Ele foi atualizado com o Backup.gs? (apps-script/README.md)");
  }
  if (!dados || !dados.ok) {
    const erro = (dados && dados.erro) || "Falha no backup.";
    throw new Error(/Sem imagem/.test(erro)
      ? "O Apps Script publicado ainda não tem o backup. Atualize-o com o Codigo.gs e o Backup.gs novos (apps-script/README.md)."
      : erro);
  }
  return dados;
}

function formatarBytes(n) {
  if (!(n > 0)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function formatarDataHora(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const ROTULO_TIPO_BACKUP = {
  diario: "Diário",
  manual: "Manual",
  "antes-de-restaurar": "Antes de restaurar"
};

// ---------------- Lista ----------------

async function carregarBackups() {
  if (backupCarregando) return;
  backupCarregando = true;
  esconderMensagem(elMsgBackup);
  elBackupLista.innerHTML = '<p class="pix-ajuda">Carregando backups…</p>';
  try {
    backupEstado = await chamarBackup("backupListar");
    renderizarBackups();
  } catch (e) {
    console.error(e);
    elBackupStatus.innerHTML = "";
    elBackupLista.innerHTML = `<p class="erro">${escapeHtmlAdmin(e.message)}</p>`;
  } finally {
    backupCarregando = false;
  }
}

function renderizarBackups() {
  const { backups, diarioAtivo, diasProtegidos } = backupEstado;
  const ultimo = backups[0];
  const horasDesde = ultimo ? (Date.now() - new Date(ultimo.criadoEm)) / 3600000 : Infinity;
  const atrasado = horasDesde > 30;

  elBackupStatus.innerHTML = `
    <div class="numeros-chips backup-status">
      <span class="numero-chip ${diarioAtivo ? "ok" : "alerta"}">${diarioAtivo ? "✓ Backup diário ligado" : "⚠️ Backup diário desligado"}</span>
      <span class="numero-chip ${atrasado ? "alerta" : "ok"}">Último: <strong>${ultimo ? escapeHtmlAdmin(formatarDataHora(ultimo.criadoEm)) : "nenhum"}</strong></span>
      <span class="numero-chip"><strong>${backups.length}</strong> backup(s) · ${backups.filter((b) => b.protegido).length} no histórico de ${diasProtegidos} dias</span>
    </div>
    ${diarioAtivo ? "" : '<p class="aviso">O backup automático não está ligado. <button type="button" class="link-inline" id="btnAtivarDiario">Ligar agora</button> (ou rode <code>instalarBackupDiario</code> no editor do Apps Script).</p>'}
    ${diarioAtivo && atrasado && ultimo ? '<p class="aviso">O último backup tem mais de um dia. Confira no Apps Script (Execuções) se o backup diário está falhando.</p>' : ""}`;
  const btnAtivar = document.getElementById("btnAtivarDiario");
  if (btnAtivar) btnAtivar.onclick = ativarBackupDiario;

  // Backups além dos 30 dias: nunca saem sozinhos; aqui o admin decide.
  const antigos = backups.filter((b) => !b.protegido);
  elBackupAntigos.innerHTML = "";
  if (antigos.length > 0) {
    const card = document.createElement("div");
    card.className = "card backup-antigos";
    card.innerHTML = `
      <h3 class="titulo-bloco">${antigos.length} backup(s) com mais de ${diasProtegidos} dias</h3>
      <p class="pix-ajuda">Eles continuam guardados e <strong>não serão apagados</strong> sem a sua confirmação. Se quiser liberar espaço no Drive, marque os que podem sair. Eles vão para a lixeira do Drive (recuperáveis por mais 30 dias).</p>
      <details><summary>Revisar e excluir…</summary>
        <ul class="backup-antigos-lista">${antigos.map((b) =>
          `<li><label class="checkbox-inline"><input type="checkbox" value="${escAttr(b.id)}" /> ${escapeHtmlAdmin(formatarDataHora(b.criadoEm))} · ${escapeHtmlAdmin(ROTULO_TIPO_BACKUP[b.tipo] || b.tipo)} · ${formatarBytes(b.tamanho)} (${b.idadeDias} dias)</label></li>`).join("")}
        </ul>
        <button type="button" class="perigo" data-acao="excluir">Excluir os marcados…</button>
      </details>`;
    card.querySelector('[data-acao="excluir"]').onclick = () => {
      const ids = [...card.querySelectorAll("input:checked")].map((i) => i.value);
      excluirBackupsAntigos(ids);
    };
    elBackupAntigos.appendChild(card);
  }

  if (backups.length === 0) {
    elBackupLista.innerHTML = '<div class="vazio-lista"><p>Nenhum backup ainda.</p><p class="pix-ajuda">Clique em <strong>Fazer backup agora</strong> para criar o primeiro.</p></div>';
    return;
  }

  const tabela = document.createElement("table");
  tabela.className = "tabela-responsiva";
  tabela.innerHTML = `<thead><tr><th>Data</th><th>Tipo</th><th>Tamanho</th><th>Conteúdo</th><th>Guarda</th><th>Ações</th></tr></thead><tbody></tbody>`;
  const tbody = tabela.querySelector("tbody");
  backups.forEach((b) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Data"><strong>${escapeHtmlAdmin(formatarDataHora(b.criadoEm))}</strong></td>
      <td data-label="Tipo">${escapeHtmlAdmin(ROTULO_TIPO_BACKUP[b.tipo] || b.tipo || "—")}</td>
      <td data-label="Tamanho">${formatarBytes(b.tamanho)}</td>
      <td data-label="Conteúdo">${escapeHtmlAdmin((b.descricao || "").replace(/^[^·]*·\s*/, "") || "—")}</td>
      <td data-label="Guarda">${b.protegido
        ? `<span class="badge pago" title="Histórico protegido: não pode ser apagado">🔒 ${Math.max(0, diasProtegidos - b.idadeDias)} dia(s)</span>`
        : '<span class="badge aguardando">antigo</span>'}</td>
      <td data-label="" class="acoes-linha"></td>`;
    const acoes = tr.querySelector(".acoes-linha");
    const btnBaixar = document.createElement("button");
    btnBaixar.className = "secundario";
    btnBaixar.textContent = "Baixar";
    btnBaixar.onclick = () => baixarBackup(b, btnBaixar);
    acoes.appendChild(btnBaixar);
    const btnRestaurar = document.createElement("button");
    btnRestaurar.className = "primario";
    btnRestaurar.textContent = "Restaurar…";
    btnRestaurar.onclick = () => abrirRestauracao({ id: b.id, nome: b.nome });
    acoes.appendChild(btnRestaurar);
    tbody.appendChild(tr);
  });
  const rolagem = document.createElement("div");
  rolagem.className = "tabela-rolagem";
  rolagem.appendChild(tabela);
  elBackupLista.innerHTML = "";
  elBackupLista.appendChild(rolagem);
}

// ---------------- Ações ----------------

async function fazerBackupAgora(btn) {
  btn.disabled = true;
  const antes = btn.textContent;
  btn.textContent = "Fazendo backup…";
  try {
    const r = await chamarBackup("backupAgora");
    mostrarMensagem(elMsgBackup, `✅ Backup feito: ${r.nome} (${r.totalDocumentos} documentos).`, "aviso");
    await carregarBackups();
  } catch (e) {
    mostrarMensagem(elMsgBackup, e.message, "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = antes;
  }
}

async function ativarBackupDiario() {
  try {
    await chamarBackup("backupAtivarDiario");
    mostrarMensagem(elMsgBackup, "✅ Backup diário ligado: todo dia por volta das 3h.", "aviso");
    await carregarBackups();
  } catch (e) {
    mostrarMensagem(elMsgBackup, e.message, "erro");
  }
}

async function baixarBackup(b, btn) {
  btn.disabled = true;
  btn.textContent = "Baixando…";
  try {
    const r = await chamarBackup("backupBaixar", { id: b.id });
    const blob = new Blob([r.conteudo], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = r.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Baixar";
  }
}

async function excluirBackupsAntigos(ids) {
  if (ids.length === 0) {
    alert("Marque os backups que podem ser excluídos.");
    return;
  }
  if (!confirm(`Excluir ${ids.length} backup(s) com mais de 30 dias?\n\nEles vão para a lixeira do Google Drive (recuperáveis por mais 30 dias).`)) return;
  const digitado = prompt('Para confirmar, digite EXCLUIR (em maiúsculas):');
  if (digitado !== "EXCLUIR") {
    alert("Nada foi excluído.");
    return;
  }
  try {
    const r = await chamarBackup("backupExcluirAntigos", { ids, confirmacao: "EXCLUIR" });
    mostrarMensagem(elMsgBackup,
      `${r.excluidos.length} backup(s) enviados para a lixeira do Drive.` +
      (r.recusados.length ? ` ${r.recusados.length} recusado(s) por estarem no histórico protegido.` : ""), "aviso");
    await carregarBackups();
  } catch (e) {
    mostrarMensagem(elMsgBackup, e.message, "erro");
  }
}

// ---------------- Restaurar ----------------

// Mesmo resumo que o Apps Script devolve, para arquivos escolhidos no computador.
function resumoDoBackupLocal(b) {
  const alunosPorTime = {};
  const times = [];
  b.documentos.forEach((d) => {
    const p = d.caminho.split("/");
    if (p[0] === "turmas" && p.length === 2) {
      times.push({ id: p[1], nome: (d.campos.nome && d.campos.nome.stringValue) || p[1] });
    } else if (p[0] === "turmas" && p[2] === "alunos") {
      const ex = d.campos.excluido && d.campos.excluido.booleanValue === true;
      if (!ex) alunosPorTime[p[1]] = (alunosPorTime[p[1]] || 0) + 1;
    }
  });
  times.forEach((t) => (t.camisetas = alunosPorTime[t.id] || 0));
  times.sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR"));
  return { criadoEm: b.criadoEm, tipo: b.tipo, resumo: b.resumo, times };
}

// origem: { id, nome } (backup do Drive) ou { conteudo, nome } (arquivo local)
async function abrirRestauracao(origem) {
  elRestaurarCorpo.innerHTML = '<p class="pix-ajuda">Lendo o backup…</p>';
  elModalRestaurar.classList.remove("oculto");
  let info;
  try {
    if (origem.conteudo) {
      const b = JSON.parse(origem.conteudo);
      if (!b || b.formato !== "interclasse-backup" || !Array.isArray(b.documentos)) {
        throw new Error("Esse arquivo não é um backup do Interclasse.");
      }
      info = resumoDoBackupLocal(b);
    } else {
      info = (await chamarBackup("backupResumo", { id: origem.id })).resumo;
    }
  } catch (e) {
    elRestaurarCorpo.innerHTML = `<p class="erro">${escapeHtmlAdmin(e.message)}</p>`;
    return;
  }

  const porColecao = (info.resumo && info.resumo.porColecao) || {};
  const nomesColecao = { turmas: "Times", "turmas/*/alunos": "Camisetas", clientes: "Clientes", config: "Configurações", producao: "Levas de produção", "producao/*/itens": "Itens das levas", cobrancas: "Cobranças" };
  elRestaurarCorpo.innerHTML = `
    <p><strong>${escapeHtmlAdmin(origem.nome || "Backup")}</strong><br><span class="pix-ajuda">Feito em ${escapeHtmlAdmin(formatarDataHora(info.criadoEm))}</span></p>
    <div class="numeros-chips">${Object.keys(porColecao).map((c) =>
      `<span class="numero-chip"><strong>${porColecao[c]}</strong> ${escapeHtmlAdmin(nomesColecao[c] || c)}</span>`).join("")}</div>
    <label>O que restaurar
      <select data-r="escopo">
        <option value="tudo">Tudo (todos os dados do backup)</option>
        ${info.times.map((t) => `<option value="time:${escAttr(t.id)}">Só o time: ${escapeHtmlAdmin(t.nome)} (${t.camisetas} camiseta(s))</option>`).join("")}
      </select>
    </label>
    <p class="aviso">Os dados escolhidos <strong>voltam a ser como estavam no backup</strong> (o que foi mudado depois é sobrescrito). O que foi criado depois do backup não é apagado. Antes de restaurar, é feito automaticamente um backup <strong>"antes de restaurar"</strong> — dá para desfazer.</p>
    <label>Para confirmar, digite RESTAURAR
      <input type="text" data-r="confirmacao" autocomplete="off" />
    </label>
    <button type="button" class="perigo" data-r="ir" disabled>Restaurar</button>
    <p data-r="msg" class="oculto"></p>`;

  const conf = elRestaurarCorpo.querySelector('[data-r="confirmacao"]');
  const btn = elRestaurarCorpo.querySelector('[data-r="ir"]');
  const msg = elRestaurarCorpo.querySelector('[data-r="msg"]');
  conf.oninput = () => (btn.disabled = conf.value.trim() !== "RESTAURAR");
  btn.onclick = async () => {
    const escopo = elRestaurarCorpo.querySelector('[data-r="escopo"]').value;
    btn.disabled = true;
    btn.textContent = "Restaurando…";
    try {
      const r = await chamarBackup("backupRestaurar", {
        escopo,
        confirmacao: "RESTAURAR",
        ...(origem.conteudo ? { conteudo: origem.conteudo } : { id: origem.id })
      });
      mostrarMensagem(msg,
        `✅ ${r.restaurados} documento(s) restaurado(s). Backup de segurança: ${r.backupSeguranca}. ` +
        "As telas se atualizam sozinhas; se algo parecer desatualizado, recarregue a página.", "aviso");
      btn.textContent = "Restaurado";
      carregarBackups();
    } catch (e) {
      mostrarMensagem(msg, e.message, "erro");
      btn.disabled = false;
      btn.textContent = "Restaurar";
    }
  };
}

function fecharRestauracao() {
  elModalRestaurar.classList.add("oculto");
}

// ---------------- Ligações ----------------

document.getElementById("btnBackupAgora").addEventListener("click", (ev) => fazerBackupAgora(ev.currentTarget));
document.getElementById("btnBackupAtualizar").addEventListener("click", carregarBackups);
document.getElementById("btnBackupArquivo").addEventListener("click", () => elInputBackupArquivo.click());
elInputBackupArquivo.addEventListener("change", async () => {
  const f = elInputBackupArquivo.files[0];
  elInputBackupArquivo.value = "";
  if (!f) return;
  abrirRestauracao({ conteudo: await f.text(), nome: f.name });
});
document.getElementById("fecharModalRestaurar").addEventListener("click", fecharRestauracao);
elModalRestaurar.addEventListener("click", (ev) => {
  if (ev.target === elModalRestaurar) fecharRestauracao();
});

// A lista só é pedida ao Apps Script quando a aba é aberta.
const abaBackup = document.querySelector('.aba[data-aba="backup"]');
if (abaBackup) abaBackup.addEventListener("click", () => carregarBackups());
