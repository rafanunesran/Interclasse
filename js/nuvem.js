// ============================================================
// GERAÇÃO NA NUVEM (folhas de impressão)
// ============================================================
// Em vez de gerar no navegador (que trava com lote grande), o site cria um
// "trabalho" no Firestore (coleção `trabalhos`) e pede ao Apps Script que
// dispare o GitHub Actions (.github/workflows/gerar-folhas.yml). Lá, uma
// máquina abre este mesmo site num Chromium sem tela (tools/nuvem/worker.js),
// entra como admin, chama executarTrabalhoNuvem(id) — que roda a MESMA
// geração do botão — e envia os arquivos e as prévias em PNG para o Drive
// (pasta "Interclasse Camisetas/Impressão/<lote>"). O andamento e o
// resultado ficam no documento do trabalho, que o site mostra no card do lote.

const COL_TRABALHOS = "trabalhos";
const trabalhosNuvem = {}; // id → dados
let escutandoTrabalhos = false;

function escutarTrabalhosNuvem() {
  if (escutandoTrabalhos) return;
  escutandoTrabalhos = true;
  db.collection(COL_TRABALHOS).orderBy("criadoEmMs", "desc").limit(60).onSnapshot(
    (snap) => {
      Object.keys(trabalhosNuvem).forEach((k) => delete trabalhosNuvem[k]);
      snap.forEach((d) => (trabalhosNuvem[d.id] = { id: d.id, ...d.data() }));
      redesenharTrabalhosNuvem();
    },
    (e) => console.error("Trabalhos na nuvem:", e)
  );
}

function novoIdTrabalho() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Cria o trabalho e pede ao Apps Script para disparar a máquina.
// `op`: as opções do diálogo (sem destino nem nuvem).
async function pedirGeracaoNaNuvem(linhas, nomeBase, levaId, op) {
  if (!driveScriptUrl) {
    alert("Configure a URL do Apps Script na aba Configurações.");
    return;
  }
  const id = novoIdTrabalho();
  const ref = db.collection(COL_TRABALHOS).doc(id);
  await ref.set({
    levaId, nomeBase,
    itens: linhas.map((l) => l.item && l.item.id).filter(Boolean),
    nCamisetas: linhas.length,
    op,
    status: "na fila", etapa: "Esperando a máquina começar…", pct: 0,
    avisos: [], arquivos: [], previas: [],
    criadoEmMs: Date.now()
  });
  try {
    const resp = await fetch(driveScriptUrl, { method: "POST", body: JSON.stringify({ acao: "nuvem", trabalhoId: id }) });
    const dados = await resp.json();
    if (!dados || !dados.ok) throw new Error((dados && dados.erro) || "O Apps Script não respondeu.");
    if (dados.actionsUrl) await ref.update({ actionsUrl: dados.actionsUrl });
  } catch (e) {
    await ref.update({ status: "erro", erro: "Não foi possível disparar a máquina: " + (e.message || e) +
      " — confira se o Apps Script está atualizado e com a chave do GitHub (README → Geração na nuvem).", fimMs: Date.now() });
  }
  alert("Pedido enviado. A geração roda na nuvem — acompanhe no card do lote (aba Produção). Os arquivos e as prévias vão para o seu Google Drive.");
}

// ---------------- Painel no card do lote ----------------

function fmtDataHora(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtBytes(n) {
  if (!n) return "";
  return n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
}

const ROTULO_STATUS_NUVEM = { "na fila": "⏳ na fila", rodando: "⚙️ gerando", pronto: "✓ pronto", erro: "⚠️ erro" };

function htmlTrabalhoNuvem(t) {
  const st = t.status || "na fila";
  const linkDrive = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
  const parado = st === "na fila" && Date.now() - (t.criadoEmMs || 0) > 10 * 60 * 1000;
  let corpo = "";
  if (st === "na fila" || st === "rodando") {
    const pct = Math.round(Math.max(0, Math.min(1, t.pct || 0)) * 100);
    corpo += `<div class="progresso-barra geral"><span style="width:${pct}%"></span><b>${pct}%</b></div>
      <p class="pix-ajuda">${escapeHtmlAdmin(t.etapa || "")}</p>`;
    if (parado) corpo += `<p class="pix-ajuda">Ainda não começou depois de 10 minutos. Confira a execução no GitHub${t.actionsUrl ? ` (<a href="${escAttr(t.actionsUrl)}" target="_blank" rel="noopener">abrir</a>)` : ""}.</p>`;
  }
  if (st === "erro") corpo += `<p class="nuvem-erro">${escapeHtmlAdmin(t.erro || "Erro na geração.")}</p>`;
  if ((t.arquivos || []).length) {
    corpo += `<ul class="nuvem-arquivos">${t.arquivos.map((a) =>
      `<li><a href="${escAttr(linkDrive(a.id))}" target="_blank" rel="noopener">${escapeHtmlAdmin(a.nome)}</a> <small>${fmtBytes(a.bytes)}</small></li>`).join("")}</ul>`;
  }
  if ((t.previas || []).length) {
    corpo += `<div class="nuvem-previas">${t.previas.map((p) =>
      `<a href="${escAttr(linkDrive(p.id))}" target="_blank" rel="noopener" title="${escAttr(p.nome)}">
        <img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(p.id)}&sz=w800" alt="${escAttr(p.nome)}" loading="lazy" />
        <small>${escapeHtmlAdmin(p.rotulo || p.nome)}</small></a>`).join("")}</div>`;
  }
  if ((t.avisos || []).length) {
    corpo += `<details class="nuvem-avisos"><summary>${t.avisos.length} aviso(s)</summary><ul>${t.avisos.map((a) => `<li>${escapeHtmlAdmin(a)}</li>`).join("")}</ul></details>`;
  }
  const links = [
    t.pastaUrl ? `<a href="${escAttr(t.pastaUrl)}" target="_blank" rel="noopener">📁 Abrir pasta no Drive</a>` : "",
    t.runUrl ? `<a href="${escAttr(t.runUrl)}" target="_blank" rel="noopener">Ver execução</a>` : ""
  ].filter(Boolean).join(" · ");
  const op = t.op || {};
  const resumoOp = [`${t.nCamisetas || "?"} camiseta(s)`, (op.formato || "pdf").toUpperCase(), op.juntar ? "todos juntos" : "um por time", `${op.dpi || 600} dpi`].join(" · ");
  return `<div class="nuvem-trabalho st-${escAttr(st.replace(/\s/g, "-"))}" data-trabalho="${escAttr(t.id)}">
    <div class="nuvem-trabalho-topo"><strong>${t.origem === "local" ? "💾 Cópia no Drive" : "☁️ " + escapeHtmlAdmin(ROTULO_STATUS_NUVEM[st] || st)}</strong>
      <span class="pix-ajuda">${fmtDataHora(t.criadoEmMs)} · ${escapeHtmlAdmin(resumoOp)}</span>
      ${st === "rodando" ? "" : `<button type="button" class="secundario botao-remover" data-remover-trabalho="${escAttr(t.id)}" title="Tirar da lista (os arquivos no Drive continuam)">Remover</button>`}</div>
    ${corpo}${links ? `<p class="nuvem-links">${links}</p>` : ""}
  </div>`;
}

// Bloco dos trabalhos de um lote (vazio se não houver). producao.js põe um
// <div data-nuvem-leva="id"> no card; aqui ele é preenchido e atualizado.
function preencherTrabalhosDaLeva(el) {
  const levaId = el.dataset.nuvemLeva;
  const lista = Object.values(trabalhosNuvem).filter((t) => t.levaId === levaId)
    .sort((a, b) => (b.criadoEmMs || 0) - (a.criadoEmMs || 0)).slice(0, 5);
  el.innerHTML = lista.length ? `<h4 class="nuvem-titulo">Arquivos no Google Drive</h4>${lista.map(htmlTrabalhoNuvem).join("")}` : "";
  el.querySelectorAll("[data-remover-trabalho]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Tirar este registro da lista? Os arquivos no Google Drive continuam.")) return;
      await db.collection(COL_TRABALHOS).doc(b.dataset.removerTrabalho).delete();
    };
  });
}
function redesenharTrabalhosNuvem() {
  document.querySelectorAll("[data-nuvem-leva]").forEach(preencherTrabalhosDaLeva);
}

// ---------------- Lado da máquina (tools/nuvem/worker.js) ----------------

function esperarCondicao(cond, ms, oQue) {
  return new Promise((ok, erro) => {
    const t0 = Date.now();
    const passo = () => {
      let r = false;
      try { r = cond(); } catch (e) { r = false; }
      if (r) return ok();
      if (Date.now() - t0 > ms) return erro(new Error("Tempo esgotado esperando " + oQue + "."));
      setTimeout(passo, 300);
    };
    passo();
  });
}

// Roda o trabalho `id` nesta página (já logada como admin). Os arquivos saem
// como downloads (o worker os recebe). Enquanto isso, o andamento (texto da
// etapa, %, avisos) vai para o documento do trabalho a cada poucos segundos.
// Devolve { avisos, resumo }.
async function executarTrabalhoNuvem(id, runUrl) {
  const ref = db.collection(COL_TRABALHOS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Trabalho " + id + " não encontrado.");
  const t = snap.data();
  if (t.status === "pronto") throw new Error("Este trabalho já foi feito.");
  await ref.update({ status: "rodando", inicioMs: Date.now(), runUrl: runUrl || "", etapa: "Abrindo o site e carregando os dados…", pct: 0 });
  await esperarCondicao(() => driveScriptUrl && estadoLevas[t.levaId] && estadoLevas[t.levaId].itensCarregados &&
    Object.keys(estadoTimes).length && Object.keys((moldesConfig || {}).pecas || {}).length, 180000, "os dados do lote");
  await new Promise((ok) => setTimeout(ok, 2000)); // layout e configurações chegam juntos
  const ids = new Set(t.itens || []);
  const itens = estadoLevas[t.levaId].itens.filter((i) => !ids.size || ids.has(i.id));
  if (!itens.length) throw new Error("O lote não tem as camisetas deste pedido (foram tiradas do lote?).");
  const linhas = agruparPorModelo(itens).flatMap((g) => g.linhas);

  const lerTela = () => {
    const m = document.querySelector(".modal-progresso-eps");
    if (!m) return null;
    const barra = m.querySelector(".progresso-barra.geral b");
    return {
      etapa: [m.querySelector(".progresso-eps-resumo"), m.querySelector(".progresso-eps-etapa")]
        .map((e) => (e && e.textContent) || "").filter(Boolean).join(" — "),
      pct: barra ? (parseInt(barra.textContent, 10) || 0) / 100 : 0,
      avisos: [...m.querySelectorAll(".progresso-eps-avisos li")].map((li) => li.textContent).slice(0, 200)
    };
  };
  let ultimo = "";
  const informar = async () => {
    const s = lerTela();
    if (!s) return;
    const chave = JSON.stringify(s);
    if (chave === ultimo) return;
    ultimo = chave;
    try { await ref.update({ etapa: s.etapa.slice(0, 500), pct: Math.min(0.95, s.pct), avisos: s.avisos }); } catch (e) { console.warn(e); }
  };
  const relogio = setInterval(informar, 4000);
  try {
    await gerarFolhasEps(linhas, t.nomeBase || "lote", t.levaId, { ...t.op, nuvem: false });
  } finally {
    clearInterval(relogio);
  }
  const fim = lerTela() || { etapa: "", avisos: [] };
  await ref.update({ etapa: "Enviando os arquivos para o Google Drive…", pct: 0.96, avisos: fim.avisos });
  return { avisos: fim.avisos, resumo: fim.etapa, nomeBase: t.nomeBase || "lote", larguraCm: (t.op || {}).larguraCm || 150 };
}

// ---------------- Cópia no Drive do que foi gerado aqui ----------------
// "Gerar aqui" com "Guardar uma cópia no Google Drive": o arquivo vai inteiro
// para Impressão/<lote> (envio retomável). O Apps Script abre a sessão (só o
// admin, pelo token de login); os bytes vão direto ao Google em pedaços de
// 16 MB — e, se o navegador bloquear, cada pedaço passa pelo Apps Script.

const PEDACO_COPIA = 16 * 1024 * 1024; // múltiplo de 256 KB

async function chamarScriptCopia(corpo) {
  let ultimo;
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(driveScriptUrl, { method: "POST", body: JSON.stringify(corpo) });
      const dados = await r.json();
      if (dados && dados.ok) return dados;
      ultimo = new Error((dados && dados.erro) || "o Apps Script não respondeu");
      if (/login|negado|inv[aá]lid/i.test(ultimo.message)) break;
    } catch (e) {
      ultimo = e;
    }
    await new Promise((ok) => setTimeout(ok, 1500 * t));
  }
  throw ultimo;
}

function base64DoBlob(blob) {
  return new Promise((ok, erro) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result).split(",")[1] || "");
    l.onerror = () => erro(l.error);
    l.readAsDataURL(blob);
  });
}

// Devolve { id, pastaUrl }. `aoProgresso(fração)` é opcional.
async function guardarCopiaNoDrive(nome, blob, lote, aoProgresso) {
  if (!driveScriptUrl) throw new Error("URL do Apps Script não configurada.");
  const idToken = await auth.currentUser.getIdToken();
  const mime = blob.type || (/\.pdf$/i.test(nome) ? "application/pdf" : /\.png$/i.test(nome) ? "image/png"
    : /\.zip$/i.test(nome) ? "application/zip" : "application/postscript");
  const s = await chamarScriptCopia({ acao: "copiaSessao", idToken, nome, mimeType: mime, tamanho: blob.size, lote, origem: location.origin });
  const total = blob.size;
  let direto = true;
  for (let inicio = 0; ;) {
    const fim = Math.min(total, inicio + PEDACO_COPIA);
    const pedaco = blob.slice(inicio, fim);
    let res = null;
    for (let t = 1; t <= 3 && !res; t++) {
      try {
        if (direto) {
          const r = await fetch(s.uploadUrl, { method: "PUT", body: pedaco, headers: { "Content-Range": `bytes ${inicio}-${fim - 1}/${total}` } });
          if (r.status === 308) res = { status: 308 };
          else if (r.ok) res = { status: r.status, id: (await r.json()).id };
          else if (r.status < 500) throw new Error(`Drive recusou (${r.status})`);
        } else {
          res = await chamarScriptCopia({ acao: "copiaPedaco", idToken, uploadUrl: s.uploadUrl, inicio, total, dataBase64: await base64DoBlob(pedaco) });
        }
      } catch (e) {
        // Bloqueado pelo navegador (CORS/rede): segue pelo Apps Script.
        if (direto && e instanceof TypeError) { direto = false; t--; continue; }
        if (t >= 3) throw e;
        await new Promise((ok) => setTimeout(ok, 2000 * t));
      }
    }
    if (!res) throw new Error("o Drive não respondeu");
    if (aoProgresso) aoProgresso(fim / (total || 1));
    if (res.status !== 308) return { id: res.id, pastaUrl: s.pastaUrl };
    inicio = fim;
  }
}

// Registro da geração local no card do lote (mesmo painel da nuvem).
// criarRegistroCopia(...) devolve { guardar(nome, blob, etapa, previa) } —
// cada arquivo copiado entra na lista; falha vira aviso e não interrompe.
function criarRegistroCopia(levaId, nomeBase, op, nCamisetas, prog) {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  const lote = `${nomeBase} - ${z(d.getDate())}-${z(d.getMonth() + 1)}-${d.getFullYear()} ${z(d.getHours())}h${z(d.getMinutes())}`;
  const id = novoIdTrabalho();
  const ref = db.collection(COL_TRABALHOS).doc(id);
  const reg = { arquivos: [], previas: [], pastaUrl: "" };
  let criado = null;
  const salvarRegistro = async () => {
    const dados = { ...reg, status: "pronto", origem: "local", pct: 1, etapa: `Cópia no Drive: pasta "Impressão/${lote}".`, fimMs: Date.now() };
    try {
      if (!criado) criado = ref.set({ levaId, nomeBase, nCamisetas, op, criadoEmMs: Date.now(), avisos: [], ...dados });
      else { await criado; await ref.update(dados); }
      await criado;
    } catch (e) { console.warn("Registro da cópia:", e); }
  };
  const self = {
    prog,
    async guardar(nome, blob, etapa, previa) {
      try {
        const r = await guardarCopiaNoDrive(nome, blob, lote,
          (f) => etapa && etapa(`guardando ${nome} no Drive… ${Math.round(f * 100)}%`));
        if (r.pastaUrl) reg.pastaUrl = r.pastaUrl;
        if (previa) reg.previas.push({ nome, id: r.id, rotulo: nome.replace(/\.png$/i, "") });
        else reg.arquivos.push({ nome, id: r.id, bytes: blob.size });
        await salvarRegistro();
        return r;
      } catch (e) {
        console.error(e);
        if (self.prog) self.prog.aviso(`Cópia de ${nome} no Drive não foi feita: ${e.message || e}. O arquivo do computador continua valendo.`);
        return null;
      }
    }
  };
  return self;
}
