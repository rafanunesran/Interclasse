// ============================================================
// MOLDES DE CORTE (aba Tamanhos do Super Admin)
// ============================================================
// Um EPS por PEÇA em cada TAMANHO (costas M, frente GG, manga esquerda P...).
// É ele que vai para a folha de impressão, no tamanho real (lido do
// %%BoundingBox), e é em cima dele que a arte de cada time é adaptada.
// Ao enviar, o site desenha uma prévia (Ghostscript no navegador,
// js/previa-eps.js) para o editor de layout mostrar o molde.
//
// No Firestore: config/moldes = {
//   tamanhoBase: "M",
//   pecas: { costas: { M: { epsId, partes, bbox, previaUrl, nomeArquivo } } }
// }
//
// Carregado depois de js/admin.js e js/producao.js (usa driveScriptUrl,
// escapeHtmlAdmin, escAttr...).

let moldesConfig = { tamanhoBase: "", pecas: {} };
let moldesIniciado = false;
let moldesEnviando = "";

const elMoldesCorte = document.getElementById("moldesCorte");

function escutarMoldes() {
  if (moldesIniciado) return;
  moldesIniciado = true;
  db.collection("config").doc("moldes").onSnapshot(
    (doc) => {
      const d = doc.exists ? doc.data() : {};
      moldesConfig = { tamanhoBase: d.tamanhoBase || "", baseAutomatica: d.baseAutomatica === true, pecas: d.pecas || {} };
      renderizarMoldes();
      if (typeof renderizarEditorLayout === "function") renderizarEditorLayout();
      if (typeof renderizarTimesAdmin === "function") renderizarTimesAdmin();
    },
    (erro) => console.error("Erro ao carregar os moldes:", erro)
  );
}

function moldeDe(pecaId, tamanho) {
  const p = moldesConfig.pecas[pecaId];
  return (p && p[tamanho]) || null;
}

async function gravarMoldes() {
  await db.collection("config").doc("moldes").set(JSON.parse(JSON.stringify(moldesConfig)));
}

// ---------------- Utilitários de envio (usados também no time e no editor) ----------------

// Abre o seletor de arquivos. Com `multiplo`, devolve uma lista.
function escolherArquivos(accept, multiplo) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.multiple = !!multiplo;
    // Alguns navegadores (Safari) só abrem o seletor com o input na página.
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.onchange = () => {
      const arqs = [...(inp.files || [])];
      inp.remove();
      resolve(multiplo ? arqs : arqs[0] || null);
    };
    inp.click();
  });
}

function exigirDriveProducao() {
  if (!driveScriptUrl) {
    alert("Configure a URL do Apps Script na aba Configurações antes de enviar arquivos.");
    return false;
  }
  return true;
}

// Aviso de andamento no rodapé da tela (mesmo painel da geração da folha).
function avisoProducao(texto) {
  let el = document.getElementById("progressoEps");
  if (!el) {
    el = document.createElement("div");
    el.id = "progressoEps";
    el.className = "progresso-eps oculto";
    document.body.appendChild(el);
  }
  el.textContent = texto || "";
  el.classList.toggle("oculto", !texto);
}

// Envia um EPS (molde ou brasão) e a prévia dele. Devolve os dados para
// guardar: { epsId, partes, bbox, previaUrl, nomeArquivo, semPrevia }.
// `comContorno`: é um molde — lê também o contorno da peça, para recortar a
// arte no formato dele.
async function enviarEpsComPrevia(file, prefixo, larguraPrevia, comContorno) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bbox = EPS.lerBoundingBox(bytes); // valida antes de enviar
  avisoProducao(`Enviando ${file.name}…`);
  const env = await enviarArquivoDrive(driveScriptUrl, file, prefixo);
  guardarArquivoDriveNoCache(env.partes, bytes);
  const dados = { epsId: env.fileId, partes: env.partes, bbox, previaUrl: "", nomeArquivo: file.name };
  try {
    avisoProducao(`Desenhando a prévia de ${file.name}…`);
    const png = await PreviaEps.gerar(EPS.extrairPostScript(bytes), bbox, larguraPrevia || 1200);
    const prev = await enviarArquivoDrive(driveScriptUrl,
      new File([png], file.name.replace(/\.[^.]+$/, "") + "-previa.png", { type: "image/png" }), prefixo);
    dados.previaUrl = prev.url;
  } catch (e) {
    console.warn("Prévia do EPS não gerada:", e);
    dados.semPrevia = true;
  }
  if (comContorno) {
    try {
      avisoProducao(`Lendo o contorno de ${file.name}…`);
      dados.contorno = (await PreviaEps.contorno(EPS.extrairPostScript(bytes))) || "";
    } catch (e) {
      console.warn("Contorno do molde não lido:", e);
      dados.contorno = "";
    }
    if (!dados.contorno) dados.semContorno = true;
  }
  return dados;
}

// Prévia maior do que a miniatura padrão do Drive (melhor para posicionar).
function urlPreviaGrande(url) {
  return url ? String(url).replace(/sz=w\d+/, "sz=w2000") : "";
}

// ---------------- Reconhecer peça e tamanho pelo nome do arquivo ----------------
// "costas-M.eps", "Manga Esq GG.eps", "detalhe_manga_dir_P.eps", "gola M.eps"...

function pecaPeloNome(nome) {
  const n = " " + normalizarTexto(nome).replace(/[^a-z0-9]+/g, " ") + " ";
  const esq = /\besq|esquerd/.test(n);
  const dir = /\bdir|direit/.test(n);
  if (/\bgola/.test(n)) return "gola";
  // Detalhe da manga não tem molde (é um elemento na manga): fica de fora.
  if (/detalhe/.test(n)) return "";
  if (/manga/.test(n)) return esq ? "mangaEsq" : dir ? "mangaDir" : "";
  if (/frente|frontal/.test(n)) return "frente";
  if (/costa/.test(n)) return "costas";
  return "";
}

function tamanhoPeloNome(nome) {
  const tokens = String(nome).replace(/\.[^.]+$/, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = TODOS_TAMANHOS.find((x) => x.toLowerCase() === tokens[i].toLowerCase());
    if (t) return t;
  }
  return "";
}

// ---------------- Tela ----------------

function renderizarMoldes() {
  if (!elMoldesCorte) return;
  const tamanhos = TODOS_TAMANHOS;
  const total = PECAS_PRODUCAO.length * tamanhos.length;
  const feitos = PECAS_PRODUCAO.reduce((s, p) => s + tamanhos.filter((t) => moldeDe(p.id, t)).length, 0);
  const semContorno = PECAS_PRODUCAO.reduce((s, p) =>
    s + tamanhos.filter((t) => { const m = moldeDe(p.id, t); return m && (!m.contorno || (p.id !== "gola" && contornoRetangular(m.contorno))); }).length, 0);

  elMoldesCorte.innerHTML = `
    <p>Um <strong>EPS por peça em cada tamanho</strong>, no tamanho real. É ele que vai para a folha de impressão e é nele que a arte de cada time é adaptada. A prévia é desenhada automaticamente.</p>
    <p class="pix-ajuda">Dica: em <strong>Enviar vários</strong>, escolha todos os arquivos de uma vez — o site reconhece a peça e o tamanho pelo nome (ex.: <code>costas-M.eps</code>, <code>manga esq GG.eps</code>, <code>gola M.eps</code>).</p>
    <div class="moldes-topo">
      <button type="button" class="primario" data-acao="varios">Enviar vários</button>
      <label>Tamanho base (onde o layout é marcado)
        <select data-acao="base"><option value="">—</option>${tamanhos.map((t) =>
          `<option value="${escAttr(t)}"${moldesConfig.tamanhoBase === t ? " selected" : ""}>${escapeHtmlAdmin(t)}</option>`).join("")}</select>
      </label>
      <span class="badge">${feitos}/${total} moldes</span>
      ${feitos ? `<button type="button" class="${semContorno ? "primario" : "secundario"}" data-acao="contornos" title="Lê de novo o formato de todas as peças enviadas (corrige as que ficaram quadradas)">Reler contornos${semContorno ? ` (${semContorno} com problema)` : ""}</button>` : ""}
    </div>
    <div class="moldes-tabela-wrap"><table class="moldes-tabela">
      <thead><tr><th>Tamanho</th>${PECAS_PRODUCAO.map((p) => `<th>${escapeHtmlAdmin(p.nome)}</th>`).join("")}</tr></thead>
      <tbody>${tamanhos.map((t) => `<tr><th>${escapeHtmlAdmin(t)}</th>${PECAS_PRODUCAO.map((p) => celulaMolde(p.id, t)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;

  elMoldesCorte.querySelector('[data-acao="varios"]').onclick = enviarVariosMoldes;
  const btnContornos = elMoldesCorte.querySelector('[data-acao="contornos"]');
  if (btnContornos) btnContornos.onclick = lerContornosPendentes;
  elMoldesCorte.querySelector('[data-acao="base"]').onchange = async (ev) => {
    moldesConfig.tamanhoBase = ev.target.value;
    moldesConfig.baseAutomatica = false;
    await gravarMoldes();
  };
  elMoldesCorte.querySelectorAll("[data-molde]").forEach((b) => {
    const [pecaId, tam, acao] = b.dataset.molde.split("|");
    b.onclick = () => acaoMolde(pecaId, tam, acao);
  });
}

function celulaMolde(pecaId, tam) {
  const m = moldeDe(pecaId, tam);
  const chave = `${pecaId}|${tam}`;
  if (moldesEnviando === chave) return '<td class="molde-celula"><span class="pix-ajuda">enviando…</span></td>';
  if (!m) {
    return `<td class="molde-celula"><button type="button" class="secundario" data-molde="${escAttr(chave)}|enviar">+ EPS</button></td>`;
  }
  const dim = EPS.tamanhoMmDoBbox(m.bbox);
  const img = m.previaUrl
    ? `<img src="${escAttr(m.previaUrl)}" alt="" loading="lazy" />`
    : `<button type="button" class="link-inline" data-molde="${escAttr(chave)}|previa">sem prévia — enviar PNG</button>`;
  return `<td class="molde-celula" title="${escAttr(m.nomeArquivo || "")}">
    ${img}
    <div class="molde-medida">${dim.w.toFixed(0)} × ${dim.h.toFixed(0)} mm${!m.contorno
      ? ' · <span title="Sem o contorno, a arte não é recortada no formato do molde (fica retangular)">⚠️ sem contorno</span>'
      : pecaId !== "gola" && contornoRetangular(m.contorno)
        ? ' · <span title="O contorno lido é um retângulo: use Reler contornos. Se continuar, o EPS não tem a linha de corte como traço.">⚠️ contorno retangular</span>'
        : ""}</div>
    <div class="molde-acoes">
      <button type="button" class="secundario" data-molde="${escAttr(chave)}|enviar">Trocar</button>
      <button type="button" class="perigo" data-molde="${escAttr(chave)}|remover" title="Remover">×</button>
    </div></td>`;
}

async function acaoMolde(pecaId, tam, acao) {
  if (acao === "remover") {
    if (!confirm(`Remover o molde de ${nomePecaProducao(pecaId)} ${tam}?`)) return;
    delete moldesConfig.pecas[pecaId][tam];
    await gravarMoldes();
    return;
  }
  if (!exigirDriveProducao()) return;
  if (acao === "previa") {
    const file = await escolherArquivos("image/png,image/jpeg");
    if (!file) return;
    try {
      avisoProducao("Enviando prévia…");
      const { url } = await enviarArquivoDrive(driveScriptUrl, file, `molde-${pecaId}-${tam}-previa`);
      moldesConfig.pecas[pecaId][tam].previaUrl = url;
      delete moldesConfig.pecas[pecaId][tam].semPrevia;
      await gravarMoldes();
    } catch (e) {
      alert(e.message || "Não foi possível enviar a prévia.");
    } finally {
      avisoProducao("");
    }
    return;
  }
  const file = await escolherArquivos(".eps,.ps,application/postscript");
  if (!file) return;
  await enviarMolde(pecaId, tam, file);
}

async function enviarMolde(pecaId, tam, file) {
  moldesEnviando = `${pecaId}|${tam}`;
  renderizarMoldes();
  try {
    const dados = await enviarEpsComPrevia(file, `molde-${pecaId}-${tam}`, 1200, true);
    moldesConfig.pecas[pecaId] = moldesConfig.pecas[pecaId] || {};
    moldesConfig.pecas[pecaId][tam] = dados;
    // Sem escolha do usuário, o base é o M (tamanho do meio, onde as artes
    // costumam ser feitas); sem M, o primeiro molde enviado.
    if (!moldesConfig.tamanhoBase || moldesConfig.baseAutomatica) {
      moldesConfig.tamanhoBase = tam === "M" ? "M" : moldesConfig.tamanhoBase || tam;
      moldesConfig.baseAutomatica = true;
    }
    await gravarMoldes();
    return dados;
  } finally {
    moldesEnviando = "";
    avisoProducao("");
    renderizarMoldes();
  }
}

async function enviarVariosMoldes() {
  if (!exigirDriveProducao()) return;
  const arquivos = await escolherArquivos(".eps,.ps,application/postscript", true);
  if (!arquivos || !arquivos.length) return;
  const ok = [], naoReconhecidos = [], falhas = [], semPrevia = [];
  const plano = arquivos.map((f) => ({ f, peca: pecaPeloNome(f.name), tam: tamanhoPeloNome(f.name) }));
  plano.filter((x) => !x.peca || !x.tam).forEach((x) => naoReconhecidos.push(x.f.name));
  const validos = plano.filter((x) => x.peca && x.tam);
  if (!validos.length) {
    alert("Nenhum arquivo reconhecido. O nome precisa ter a peça (frente, costas, manga esq/dir, gola) e o tamanho (ex.: costas-M.eps).");
    return;
  }
  if (!confirm(`Enviar ${validos.length} molde(s)?\n\n` + validos.map((x) =>
    `${x.f.name} → ${nomePecaProducao(x.peca)} ${x.tam}${moldeDe(x.peca, x.tam) ? " (substitui)" : ""}`).join("\n") +
    (naoReconhecidos.length ? `\n\nNão reconhecidos (ficam de fora):\n${naoReconhecidos.join("\n")}` : ""))) return;

  for (let i = 0; i < validos.length; i++) {
    const x = validos[i];
    try {
      avisoProducao(`Molde ${i + 1} de ${validos.length}: ${x.f.name}`);
      const d = await enviarMolde(x.peca, x.tam, x.f);
      ok.push(x.f.name);
      if (d && d.semPrevia) semPrevia.push(x.f.name);
    } catch (e) {
      falhas.push(`${x.f.name}: ${e.message || e}`);
    }
  }
  avisoProducao("");
  alert(`${ok.length} molde(s) enviado(s).` +
    (semPrevia.length ? `\n\nSem prévia (envie um PNG na célula): ${semPrevia.join(", ")}` : "") +
    (falhas.length ? `\n\nFalharam:\n${falhas.join("\n")}` : "") +
    (naoReconhecidos.length ? `\n\nNão reconhecidos:\n${naoReconhecidos.join("\n")}` : ""));
}

// Contorno que é só um retângulo (4 lados retos): numa manga ou no corpo, é
// sinal de que o formato não foi lido direito.
function contornoRetangular(c) {
  return /^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+){3,4} Z$/.test(String(c || "").trim());
}

// Lê de novo o contorno de TODOS os moldes enviados (corrige os que ficaram
// sem contorno ou quadrados numa versão anterior da leitura).
async function lerContornosPendentes() {
  if (!exigirDriveProducao()) return;
  const lista = [];
  PECAS_PRODUCAO.forEach((p) => TODOS_TAMANHOS.forEach((t) => {
    const m = moldeDe(p.id, t);
    if (m) lista.push({ p, t, m });
  }));
  let ok = 0;
  const falhas = [];
  for (let i = 0; i < lista.length; i++) {
    const { p, t, m } = lista[i];
    avisoProducao(`Lendo contornos ${i + 1} de ${lista.length}: ${p.nome} ${t}…`);
    try {
      const bytes = await baixarArquivoDrive(driveScriptUrl, m.partes || m.epsId);
      const c = await PreviaEps.contorno(EPS.extrairPostScript(bytes));
      if (c) {
        m.contorno = c;
        delete m.semContorno;
        ok++;
        if (p.id !== "gola" && contornoRetangular(c)) falhas.push(`${p.nome} ${t}: contorno retangular (o EPS não tem a linha de corte como traço?)`);
      } else {
        m.semContorno = true;
        falhas.push(`${p.nome} ${t}`);
      }
    } catch (e) {
      falhas.push(`${p.nome} ${t}: ${e.message || e}`);
    }
  }
  await gravarMoldes();
  avisoProducao("");
  alert(`${ok} contorno(s) lido(s).` + (falhas.length
    ? `\n\nSem contorno (a arte dessas peças fica retangular):\n${falhas.join("\n")}` : ""));
}
