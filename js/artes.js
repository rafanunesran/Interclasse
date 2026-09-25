// ============================================================
// ABA ARTES — moldes, arte e posições para a folha EPS (Super Admin)
// ============================================================
// Cada MODELO de camiseta (o mesmo nome usado na aba Produção) ganha uma
// "arte de produção":
//   - as PEÇAS (Frente, Costas, Manga...), cada uma com o MOLDE de cada
//     tamanho (EPS + um PNG de prévia, porque o navegador não desenha EPS);
//   - os ELEMENTOS de cada peça: partes da arte (PNG em alta ou EPS vetorial)
//     e os campos de texto (nome/apelido, número), com fonte, cor CMYK e
//     contorno;
//   - as posições, marcadas arrastando as caixas em cima do molde do tamanho
//     base. Nos outros tamanhos elas acompanham a proporção do molde, e dá
//     para fazer um ajuste fino em qualquer tamanho.
// Na aba Produção, o botão "Folha EPS" de cada modelo usa tudo isso para
// montar a folha de impressão com as camisetas da leva (js/eps.js).
//
// Os arquivos ficam no Drive (Apps Script, como as imagens dos times); aqui
// no Firestore (coleção `artes`) só vão os ids e as posições.
//
// Carregado depois de js/admin.js (usa driveScriptUrl, escapeHtmlAdmin…) e
// de js/eps.js.

// ---------------- Estado ----------------

const estadoArtes = {};   // arteId -> documento
let artesIniciado = false;
let arteEdit = null;      // cópia em edição da arte aberta (fonte da verdade na tela)
let arteEditId = "";
let pecaAbertaId = "";
let tamanhoEditor = "";   // tamanho mostrado no editor
let elementoSelId = "";
let salvarArteTimer = null;
let arteSalvando = false;
const amostraArte = { nomeCamiseta: "JOÃO PEDRO", nome: "João Pedro Silva", numero: "10" };

const fontesCarregadas = {}; // fileId -> Promise<fonte opentype>

// Blocos recolhíveis do editor abertos/fechados (o editor é redesenhado a
// cada mudança, e sem isto eles voltariam ao padrão a cada envio).
const blocosArteAbertos = {};
function blocoRecolhivel(chave, abertoPadrao) {
  const bloco = document.createElement("details");
  bloco.className = "arte-bloco";
  bloco.open = chave in blocosArteAbertos ? blocosArteAbertos[chave] : abertoPadrao;
  bloco.addEventListener("toggle", () => (blocosArteAbertos[chave] = bloco.open));
  return bloco;
}

const elListaArtes = document.getElementById("listaArtes");
const elEditorArte = document.getElementById("editorArte");
const elFormNovaArte = document.getElementById("formNovaArte");
const elModeloNovaArte = document.getElementById("modeloNovaArte");
const elSugestoesModelo = document.getElementById("sugestoesModeloArte");

// Bibliotecas usadas só aqui (carregadas na primeira vez que precisar).
const LIBS_ARTES = {
  opentype: "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js",
  pako: "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako_deflate.min.js",
  JSZip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
};
const libsCarregando = {};

function carregarLib(nome) {
  if (window[nome]) return Promise.resolve(window[nome]);
  if (!libsCarregando[nome]) {
    libsCarregando[nome] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIBS_ARTES[nome];
      s.onload = () => (window[nome] ? resolve(window[nome]) : reject(new Error("Biblioteca " + nome + " não carregou.")));
      s.onerror = () => {
        delete libsCarregando[nome];
        reject(new Error("Não foi possível carregar a biblioteca " + nome + " (sem internet?)."));
      };
      document.head.appendChild(s);
    });
  }
  return libsCarregando[nome];
}

function novoIdArte(prefixo) {
  return prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// O Firestore não aceita `undefined`: a ida e volta pelo JSON limpa tudo.
function limparParaFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------- Leitura do Firestore ----------------

function escutarArtes() {
  if (artesIniciado || !elListaArtes) return;
  artesIniciado = true;
  db.collection(COL_ARTES).onSnapshot(
    (snap) => {
      Object.keys(estadoArtes).forEach((id) => delete estadoArtes[id]);
      snap.forEach((doc) => (estadoArtes[doc.id] = { id: doc.id, ...doc.data() }));
      // A arte aberta foi excluída em outra aba: fecha o editor.
      if (arteEditId && !estadoArtes[arteEditId] && !arteSalvando) fecharEditorArte();
      renderizarListaArtes();
    },
    (erro) => console.error("Erro ao carregar as artes:", erro)
  );
}

// Arte de um modelo. O goleiro ("<arte> — goleiro") usa a arte própria, se
// houver; senão, a do modelo base (com aviso, porque a cor muda).
function arteDoModelo(modelo) {
  const artes = Object.values(estadoArtes);
  const achar = (m) => artes.find((a) => normalizarTexto(a.modelo || "") === normalizarTexto(m || ""));
  const direta = achar(modelo);
  if (direta) return { arte: direta, aviso: "" };
  if (String(modelo).endsWith(SUFIXO_MODELO_GOLEIRO)) {
    const base = achar(String(modelo).slice(0, -SUFIXO_MODELO_GOLEIRO.length));
    if (base) {
      return { arte: base, aviso: `O modelo "${modelo}" não tem arte própria: usei a de "${base.modelo}". Crie a arte do goleiro na aba Artes se a cor for outra.` };
    }
  }
  return { arte: null, aviso: "" };
}

// ---------------- Lista ----------------

function renderizarListaArtes() {
  if (!elListaArtes) return;

  // Sugestões: os modelos dos times (mais a variação do goleiro) que ainda
  // não têm arte.
  if (elSugestoesModelo) {
    const comArte = new Set(Object.values(estadoArtes).map((a) => normalizarTexto(a.modelo || "")));
    const nomes = new Set();
    Object.values(estadoTimes).forEach((e) => {
      const m = modeloDoTime(e.time);
      nomes.add(m);
      if (e.alunos.some(ehGoleiro)) nomes.add(modeloComGoleiro(m, true));
    });
    elSugestoesModelo.innerHTML = [...nomes]
      .filter((n) => !comArte.has(normalizarTexto(n)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((n) => `<option value="${escAttr(n)}"></option>`)
      .join("");
  }

  const artes = Object.values(estadoArtes).sort((a, b) =>
    String(a.modelo).localeCompare(String(b.modelo), "pt-BR"));
  if (artes.length === 0) {
    elListaArtes.innerHTML = "<p>Nenhuma arte cadastrada ainda. Crie a primeira acima, com o mesmo nome do modelo usado na aba Produção.</p>";
    return;
  }
  elListaArtes.innerHTML = "";
  artes.forEach((a) => {
    const linha = document.createElement("div");
    linha.className = "arte-linha" + (a.id === arteEditId ? " ativa" : "");
    const pecas = a.pecas || [];
    const nMoldes = pecas.reduce((s, p) => s + Object.keys(p.moldes || {}).length, 0);
    linha.innerHTML =
      `<div><strong>${escapeHtmlAdmin(a.modelo)}</strong>` +
      `<div class="pix-ajuda">${pecas.length} peça(s) · ${nMoldes} molde(s) · ${(a.fontes || []).length} fonte(s)</div></div>`;
    const acoes = document.createElement("div");
    const abrir = document.createElement("button");
    abrir.className = "primario";
    abrir.textContent = a.id === arteEditId ? "Aberta" : "Abrir";
    abrir.disabled = a.id === arteEditId;
    abrir.onclick = () => abrirEditorArte(a.id);
    const excluir = document.createElement("button");
    excluir.className = "perigo";
    excluir.textContent = "Excluir";
    excluir.onclick = async () => {
      if (!confirm(`Excluir a arte do modelo "${a.modelo}"? Os arquivos continuam no Drive.`)) return;
      if (a.id === arteEditId) fecharEditorArte();
      await db.collection(COL_ARTES).doc(a.id).delete();
    };
    acoes.appendChild(abrir);
    acoes.appendChild(excluir);
    linha.appendChild(acoes);
    elListaArtes.appendChild(linha);
  });
}

if (elFormNovaArte) {
  elFormNovaArte.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const modelo = elModeloNovaArte.value.trim();
    if (!modelo) return;
    if (Object.values(estadoArtes).some((a) => normalizarTexto(a.modelo) === normalizarTexto(modelo))) {
      alert(`Já existe uma arte para o modelo "${modelo}".`);
      return;
    }
    const id = (slugify(modelo) || "arte") + "-" + Date.now().toString(36);
    const arte = {
      modelo,
      fontes: [],
      pecas: [{ id: novoIdArte("p"), nome: "Costas", tamanhoBase: "", moldes: {}, elementos: [] }],
      folha: { larguraCm: 150, espacoMm: 10, alturaMaxCm: 0, molde: "frente", etiqueta: true },
      criadaEmMs: Date.now()
    };
    await db.collection(COL_ARTES).doc(id).set(arte);
    elModeloNovaArte.value = "";
    estadoArtes[id] = { id, ...arte };
    abrirEditorArte(id);
  });
}

// ---------------- Editor ----------------

function abrirEditorArte(id) {
  const a = estadoArtes[id];
  if (!a) return;
  arteEditId = id;
  arteEdit = limparParaFirestore(a);
  delete arteEdit.id;
  arteEdit.pecas = arteEdit.pecas || [];
  arteEdit.fontes = arteEdit.fontes || [];
  pecaAbertaId = (arteEdit.pecas[0] && arteEdit.pecas[0].id) || "";
  tamanhoEditor = "";
  elementoSelId = "";
  renderizarListaArtes();
  renderizarEditorArte();
  (arteEdit.fontes || []).forEach((f) => obterFonte(f.fileId).then(() => renderizarPalco()).catch(() => {}));
  elEditorArte.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fecharEditorArte() {
  arteEditId = "";
  arteEdit = null;
  if (elEditorArte) {
    elEditorArte.innerHTML = "";
    elEditorArte.classList.add("oculto");
  }
  renderizarListaArtes();
}

// Grava a arte aberta (com um pequeno atraso, para juntar as mudanças de um
// arraste em uma escrita só).
function salvarArte(imediato) {
  if (!arteEdit || !arteEditId) return;
  mostrarEstadoSalvar("Salvando…");
  clearTimeout(salvarArteTimer);
  const gravar = async () => {
    arteSalvando = true;
    try {
      await db.collection(COL_ARTES).doc(arteEditId).set(limparParaFirestore(arteEdit));
      mostrarEstadoSalvar("✓ Salvo");
    } catch (e) {
      console.error(e);
      mostrarEstadoSalvar("⚠️ Erro ao salvar");
    } finally {
      arteSalvando = false;
    }
  };
  if (imediato) gravar();
  else salvarArteTimer = setTimeout(gravar, 700);
}

function mostrarEstadoSalvar(texto) {
  const el = document.getElementById("arteEstadoSalvar");
  if (el) el.textContent = texto;
}

function pecaAberta() {
  return arteEdit && arteEdit.pecas.find((p) => p.id === pecaAbertaId);
}

function elementoSel() {
  const p = pecaAberta();
  return p && (p.elementos || []).find((e) => e.id === elementoSelId);
}

// Exige a URL do Apps Script antes de qualquer envio.
function exigirDrive() {
  if (!driveScriptUrl) {
    alert("Configure a URL do Apps Script na aba Configurações antes de enviar arquivos.");
    return false;
  }
  return true;
}

// Prévia maior do que a miniatura padrão (melhor para posicionar).
function urlPrevia(url) {
  return url ? String(url).replace(/sz=w\d+/, "sz=w2000") : "";
}

function ehEps(file) {
  return /\.(eps|ps|ai)$/i.test(file.name) || /postscript/i.test(file.type);
}

async function lerBytesDoArquivo(file) {
  return new Uint8Array(await file.arrayBuffer());
}

// Escolher arquivo sem precisar de um <input> fixo na tela.
function escolherArquivo(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    // Alguns navegadores (Safari) só abrem o seletor com o input na página.
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.onchange = () => {
      resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      inp.remove();
    };
    inp.click();
  });
}

async function comEnvio(texto, fn) {
  mostrarEstadoSalvar(texto);
  try {
    await fn();
  } catch (e) {
    console.error(e);
    alert(e.message || "Não foi possível enviar o arquivo.");
    mostrarEstadoSalvar("");
  }
}

function renderizarEditorArte() {
  if (!elEditorArte || !arteEdit) return;
  elEditorArte.classList.remove("oculto");
  elEditorArte.innerHTML = "";

  const a = arteEdit;
  const topo = document.createElement("div");
  topo.className = "arte-topo";
  topo.innerHTML = `
    <h2>Arte do modelo</h2>
    <input type="text" class="arte-modelo" value="${escAttr(a.modelo)}" title="Tem que ser igual ao nome do modelo na aba Produção" />
    <span id="arteEstadoSalvar" class="pix-ajuda"></span>
    <button type="button" class="secundario" data-fechar>Fechar</button>`;
  topo.querySelector(".arte-modelo").onchange = (ev) => {
    a.modelo = ev.target.value.trim() || a.modelo;
    salvarArte(true);
  };
  topo.querySelector("[data-fechar]").onclick = fecharEditorArte;
  elEditorArte.appendChild(topo);

  elEditorArte.appendChild(criarBlocoFontes());
  elEditorArte.appendChild(criarBlocoFolha());
  elEditorArte.appendChild(criarAbasPecas());

  const p = pecaAberta();
  if (p) {
    elEditorArte.appendChild(criarBlocoMoldes(p));
    const area = document.createElement("div");
    area.className = "arte-area";
    area.innerHTML = `
      <div class="arte-palco-col">
        <div class="arte-barra-palco" id="arteBarraPalco"></div>
        <div class="arte-palco-wrap"><div id="artePalco" class="arte-palco"></div></div>
      </div>
      <div class="arte-painel" id="artePainel"></div>`;
    elEditorArte.appendChild(area);
    renderizarBarraPalco();
    renderizarPalco();
    renderizarPainelElemento();
  }
}

// ----- Fontes -----

function criarBlocoFontes() {
  const bloco = blocoRecolhivel("fontes", arteEdit.fontes.length === 0);
  bloco.innerHTML = `<summary>🔤 Fontes <span class="badge">${arteEdit.fontes.length}</span></summary>`;
  const lista = document.createElement("div");
  arteEdit.fontes.forEach((f) => {
    const l = document.createElement("div");
    l.className = "arte-item-linha";
    l.innerHTML = `<span>${escapeHtmlAdmin(f.nome)}</span>`;
    const rem = document.createElement("button");
    rem.className = "secundario";
    rem.textContent = "Remover";
    rem.onclick = () => {
      const usada = arteEdit.pecas.some((p) => (p.elementos || []).some((e) => e.fonteId === f.id));
      if (usada && !confirm("Esta fonte está em uso por um campo de texto. Remover mesmo assim?")) return;
      arteEdit.fontes = arteEdit.fontes.filter((x) => x.id !== f.id);
      salvarArte(true);
      renderizarEditorArte();
    };
    l.appendChild(rem);
    lista.appendChild(l);
  });
  bloco.appendChild(lista);
  const add = document.createElement("button");
  add.className = "secundario";
  add.textContent = "+ Enviar fonte (.ttf / .otf)";
  add.onclick = async () => {
    if (!exigirDrive()) return;
    const file = await escolherArquivo(".ttf,.otf,font/ttf,font/otf");
    if (!file) return;
    await comEnvio("Enviando fonte…", async () => {
      const bytes = await lerBytesDoArquivo(file);
      const opentype = await carregarLib("opentype");
      opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); // valida antes de enviar
      const { fileId } = await enviarArquivoDrive(driveScriptUrl, file, "fonte");
      cacheArquivosDrive[fileId] = Promise.resolve(bytes);
      arteEdit.fontes.push({ id: novoIdArte("f"), nome: file.name.replace(/\.(ttf|otf)$/i, ""), fileId });
      salvarArte(true);
      renderizarEditorArte();
    });
  };
  bloco.appendChild(add);
  bloco.insertAdjacentHTML("beforeend",
    '<p class="pix-ajuda">A fonte do nome e do número. No arquivo final as letras saem convertidas em curvas — a gráfica não precisa ter a fonte instalada.</p>');
  return bloco;
}

function obterFonte(fileId) {
  if (!fontesCarregadas[fileId]) {
    fontesCarregadas[fileId] = Promise.all([carregarLib("opentype"), baixarArquivoDrive(driveScriptUrl, fileId)])
      .then(([opentype, bytes]) => opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      .catch((e) => {
        delete fontesCarregadas[fileId];
        throw e;
      });
  }
  return fontesCarregadas[fileId];
}

// Fonte já carregada (síncrono, para a prévia); null enquanto não chega.
const fontesProntas = {};
function fontePronta(fonteId) {
  const f = arteEdit && arteEdit.fontes.find((x) => x.id === fonteId);
  if (!f) return null;
  if (fontesProntas[f.fileId]) return fontesProntas[f.fileId];
  obterFonte(f.fileId).then((fonte) => {
    fontesProntas[f.fileId] = fonte;
    renderizarPalco();
  }).catch((e) => console.warn("Fonte não carregou:", e));
  return null;
}

// ----- Folha -----

function criarBlocoFolha() {
  const f = arteEdit.folha || (arteEdit.folha = {});
  const bloco = blocoRecolhivel("folha", false);
  bloco.innerHTML = `
    <summary>📄 Folha de impressão <span class="pix-ajuda">${escapeHtmlAdmin(String(f.larguraCm || 150))} cm de largura</span></summary>
    <div class="arte-grade">
      <label>Largura da folha/rolo (cm)<input type="number" min="10" step="1" data-k="larguraCm" value="${escAttr(f.larguraCm || 150)}" /></label>
      <label>Espaço entre peças (mm)<input type="number" min="0" step="1" data-k="espacoMm" value="${escAttr(f.espacoMm == null ? 10 : f.espacoMm)}" /></label>
      <label>Altura máxima por folha (cm, 0 = sem limite)<input type="number" min="0" step="1" data-k="alturaMaxCm" value="${escAttr(f.alturaMaxCm || 0)}" /></label>
      <label>Contorno do molde
        <select data-k="molde">
          <option value="frente">Por cima da arte (linha de corte visível)</option>
          <option value="fundo">Por baixo da arte</option>
          <option value="nenhum">Não incluir</option>
        </select></label>
      <label class="checkbox-inline"><input type="checkbox" data-k="etiqueta" ${f.etiqueta !== false ? "checked" : ""} /> Etiqueta com nome · nº · tamanho · peça embaixo de cada peça</label>
    </div>`;
  bloco.querySelector('[data-k="molde"]').value = f.molde || "frente";
  bloco.querySelectorAll("[data-k]").forEach((inp) => {
    inp.onchange = () => {
      const k = inp.dataset.k;
      f[k] = inp.type === "checkbox" ? inp.checked : inp.tagName === "SELECT" ? inp.value : Number(inp.value) || 0;
      salvarArte(true);
    };
  });
  return bloco;
}

// ----- Peças -----

function criarAbasPecas() {
  const nav = document.createElement("div");
  nav.className = "arte-abas-pecas";
  arteEdit.pecas.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fin-subaba" + (p.id === pecaAbertaId ? " ativa" : "");
    b.textContent = p.nome;
    b.onclick = () => {
      pecaAbertaId = p.id;
      elementoSelId = "";
      tamanhoEditor = "";
      renderizarEditorArte();
    };
    nav.appendChild(b);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "secundario";
  add.textContent = "+ Peça";
  add.onclick = () => {
    const nome = prompt("Nome da peça (ex.: Frente, Costas, Manga esquerda):");
    if (!nome || !nome.trim()) return;
    const p = { id: novoIdArte("p"), nome: nome.trim(), tamanhoBase: "", moldes: {}, elementos: [] };
    arteEdit.pecas.push(p);
    pecaAbertaId = p.id;
    salvarArte(true);
    renderizarEditorArte();
  };
  nav.appendChild(add);
  const p = pecaAberta();
  if (p) {
    const ren = document.createElement("button");
    ren.type = "button";
    ren.className = "secundario";
    ren.textContent = "Renomear peça";
    ren.onclick = () => {
      const nome = prompt("Novo nome da peça:", p.nome);
      if (!nome || !nome.trim()) return;
      p.nome = nome.trim();
      salvarArte(true);
      renderizarEditorArte();
    };
    const rem = document.createElement("button");
    rem.type = "button";
    rem.className = "perigo";
    rem.textContent = "Excluir peça";
    rem.onclick = () => {
      if (!confirm(`Excluir a peça "${p.nome}" com os moldes e elementos dela?`)) return;
      arteEdit.pecas = arteEdit.pecas.filter((x) => x.id !== p.id);
      pecaAbertaId = (arteEdit.pecas[0] && arteEdit.pecas[0].id) || "";
      salvarArte(true);
      renderizarEditorArte();
    };
    nav.appendChild(ren);
    nav.appendChild(rem);
  }
  return nav;
}

// ----- Moldes da peça -----

function criarBlocoMoldes(p) {
  const n = Object.keys(p.moldes || {}).length;
  const bloco = blocoRecolhivel("moldes-" + p.id, n === 0);
  bloco.innerHTML = `<summary>📐 Moldes de "${escapeHtmlAdmin(p.nome)}" <span class="badge">${n}/${TODOS_TAMANHOS.length}</span></summary>
    <p class="pix-ajuda">Para cada tamanho: o <strong>EPS do molde</strong> (é ele que vai para a folha, no tamanho real) e um <strong>PNG de prévia</strong> exportado da mesma página/área do EPS (só para ver na tela). O <strong>tamanho base</strong> é onde você marca as posições; os outros acompanham a proporção.</p>`;
  const tabela = document.createElement("table");
  tabela.className = "arte-moldes";
  tabela.innerHTML = "<thead><tr><th>Tamanho</th><th>Base</th><th>EPS do molde</th><th>Prévia (PNG)</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  TODOS_TAMANHOS.forEach((t) => {
    const m = (p.moldes || {})[t];
    const tr = document.createElement("tr");
    const dim = m && m.bbox ? EPS.tamanhoMmDoBbox(m.bbox) : null;
    tr.innerHTML = `
      <td><strong>${escapeHtmlAdmin(t)}</strong></td>
      <td><input type="radio" name="base-${escAttr(p.id)}" ${p.tamanhoBase === t ? "checked" : ""} ${m ? "" : "disabled"} /></td>
      <td>${dim ? `✓ ${dim.w.toFixed(0)} × ${dim.h.toFixed(0)} mm` : '<span class="pix-ajuda">—</span>'}</td>
      <td>${m && m.previewUrl ? "✓" : '<span class="pix-ajuda">—</span>'}</td>
      <td class="arte-moldes-acoes"></td>`;
    tr.querySelector('input[type="radio"]').onchange = () => {
      p.tamanhoBase = t;
      tamanhoEditor = t;
      salvarArte(true);
      renderizarEditorArte();
    };
    const acoes = tr.querySelector(".arte-moldes-acoes");
    const bEps = document.createElement("button");
    bEps.className = "secundario";
    bEps.textContent = m ? "Trocar EPS" : "Enviar EPS";
    bEps.onclick = async () => {
      if (!exigirDrive()) return;
      const file = await escolherArquivo(".eps,.ps,application/postscript");
      if (!file) return;
      await comEnvio(`Enviando molde ${t}…`, async () => {
        const bytes = await lerBytesDoArquivo(file);
        const bbox = EPS.lerBoundingBox(bytes);
        const { fileId } = await enviarArquivoDrive(driveScriptUrl, file, `molde-${t}`);
        cacheArquivosDrive[fileId] = Promise.resolve(bytes);
        p.moldes = p.moldes || {};
        p.moldes[t] = { ...(p.moldes[t] || {}), epsId: fileId, bbox, nomeArquivo: file.name };
        if (!p.tamanhoBase) p.tamanhoBase = t;
        salvarArte(true);
        renderizarEditorArte();
      });
    };
    acoes.appendChild(bEps);
    if (m) {
      const bPng = document.createElement("button");
      bPng.className = "secundario";
      bPng.textContent = m.previewUrl ? "Trocar prévia" : "Enviar prévia";
      bPng.onclick = async () => {
        if (!exigirDrive()) return;
        const file = await escolherArquivo("image/png,image/jpeg");
        if (!file) return;
        await comEnvio(`Enviando prévia ${t}…`, async () => {
          const { url } = await enviarArquivoDrive(driveScriptUrl, file, `molde-${t}-previa`);
          m.previewUrl = url;
          salvarArte(true);
          renderizarEditorArte();
        });
      };
      acoes.appendChild(bPng);
      const bRem = document.createElement("button");
      bRem.className = "perigo";
      bRem.textContent = "×";
      bRem.title = "Remover o molde deste tamanho";
      bRem.onclick = () => {
        if (!confirm(`Remover o molde ${t}?`)) return;
        delete p.moldes[t];
        if (p.tamanhoBase === t) p.tamanhoBase = Object.keys(p.moldes)[0] || "";
        if (tamanhoEditor === t) tamanhoEditor = "";
        salvarArte(true);
        renderizarEditorArte();
      };
      acoes.appendChild(bRem);
    }
    tbody.appendChild(tr);
  });
  tabela.appendChild(tbody);
  bloco.appendChild(tabela);
  return bloco;
}

// ----- Palco (molde + caixas dos elementos) -----

function tamanhoAtualEditor(p) {
  const moldes = p.moldes || {};
  if (tamanhoEditor && moldes[tamanhoEditor]) return tamanhoEditor;
  if (p.tamanhoBase && moldes[p.tamanhoBase]) return p.tamanhoBase;
  return Object.keys(moldes)[0] || "";
}

function renderizarBarraPalco() {
  const barra = document.getElementById("arteBarraPalco");
  const p = pecaAberta();
  if (!barra || !p) return;
  const tam = tamanhoAtualEditor(p);
  const tamanhos = TODOS_TAMANHOS.filter((t) => (p.moldes || {})[t]);
  barra.innerHTML = `
    <label>Tamanho <select data-tam>${tamanhos.map((t) =>
      `<option value="${escAttr(t)}"${t === tam ? " selected" : ""}>${escapeHtmlAdmin(t)}${t === p.tamanhoBase ? " (base)" : ""}</option>`).join("")}</select></label>
    <label>Apelido de teste <input type="text" data-amostra="nomeCamiseta" value="${escAttr(amostraArte.nomeCamiseta)}" /></label>
    <label>Número <input type="text" data-amostra="numero" value="${escAttr(amostraArte.numero)}" style="width:60px" /></label>
    <span class="arte-botoes-add"></span>`;
  const sel = barra.querySelector("[data-tam]");
  if (sel) sel.onchange = () => { tamanhoEditor = sel.value; renderizarPalco(); renderizarPainelElemento(); };
  barra.querySelectorAll("[data-amostra]").forEach((inp) => {
    inp.oninput = () => { amostraArte[inp.dataset.amostra] = inp.value; renderizarPalco(); };
  });

  const add = barra.querySelector(".arte-botoes-add");
  const botao = (texto, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secundario";
    b.textContent = texto;
    b.onclick = fn;
    add.appendChild(b);
  };
  botao("+ Nome/apelido", () => adicionarTexto("nomeCamiseta"));
  botao("+ Número", () => adicionarTexto("numero"));
  botao("+ Imagem PNG", adicionarPng);
  botao("+ Vetor EPS", adicionarEpsElemento);
  botao("⬇ EPS de teste", baixarEpsDeTeste);
}

// Caixa inicial no meio do molde base.
function caixaInicial(p, proporcao) {
  const base = p.moldes[p.tamanhoBase];
  const dim = base ? EPS.tamanhoMmDoBbox(base.bbox) : { w: 500, h: 700 };
  let w = dim.w * 0.5;
  let h = proporcao ? w / proporcao : dim.h * 0.1;
  if (h > dim.h * 0.5) { h = dim.h * 0.5; w = proporcao ? h * proporcao : w; }
  return { x: (dim.w - w) / 2, y: (dim.h - h) / 3, w, h };
}

function exigirMoldeBase(p) {
  if (!p.tamanhoBase || !p.moldes[p.tamanhoBase]) {
    alert("Envie primeiro o EPS do molde (tabela de moldes acima). As posições são marcadas em cima dele.");
    return false;
  }
  return true;
}

function adicionarElemento(el) {
  const p = pecaAberta();
  ["x", "y", "w", "h"].forEach((k) => (el.caixa[k] = Math.round(el.caixa[k] * 10) / 10));
  p.elementos = p.elementos || [];
  p.elementos.push(el);
  elementoSelId = el.id;
  salvarArte(true);
  renderizarPalco();
  renderizarPainelElemento();
}

function adicionarTexto(campo) {
  const p = pecaAberta();
  if (!p || !exigirMoldeBase(p)) return;
  if (!arteEdit.fontes.length) {
    alert("Envie uma fonte primeiro (bloco Fontes, no topo).");
    return;
  }
  // Nome no alto das costas e número logo abaixo, como na maioria das
  // camisetas — é só um ponto de partida para arrastar.
  const dim = EPS.tamanhoMmDoBbox(p.moldes[p.tamanhoBase].bbox);
  const caixa = campo === "numero"
    ? { x: dim.w * 0.3, y: dim.h * 0.3, w: dim.w * 0.4, h: dim.h * 0.25 }
    : { x: dim.w * 0.2, y: dim.h * 0.18, w: dim.w * 0.6, h: dim.h * 0.07 };
  adicionarElemento({
    id: novoIdArte("e"), tipo: "texto", campo,
    fonteId: arteEdit.fontes[0].id,
    corCmyk: [0, 0, 0, 100], contornoMm: 0, contornoCmyk: [0, 0, 0, 0],
    alinhamento: "centro", ajuste: "encolher", maiusculas: true, espacamento: 0,
    usarNomeSeVazio: true, caixa
  });
}

async function adicionarPng() {
  const p = pecaAberta();
  if (!p || !exigirMoldeBase(p) || !exigirDrive()) return;
  const file = await escolherArquivo("image/png");
  if (!file) return;
  await comEnvio("Enviando imagem…", async () => {
    const bmp = await createImageBitmap(file);
    const larguraPx = bmp.width, alturaPx = bmp.height;
    bmp.close && bmp.close();
    const { fileId, url } = await enviarArquivoDrive(driveScriptUrl, file, "arte");
    adicionarElemento({
      id: novoIdArte("e"), tipo: "png", nome: file.name,
      arquivo: { fileId, previewUrl: url, larguraPx, alturaPx },
      caixa: caixaInicial(p, larguraPx / alturaPx)
    });
    mostrarEstadoSalvar("✓ Imagem enviada");
  });
}

async function adicionarEpsElemento() {
  const p = pecaAberta();
  if (!p || !exigirMoldeBase(p) || !exigirDrive()) return;
  const file = await escolherArquivo(".eps,.ps,application/postscript");
  if (!file) return;
  await comEnvio("Enviando vetor…", async () => {
    const bytes = await lerBytesDoArquivo(file);
    const bbox = EPS.lerBoundingBox(bytes);
    const { fileId } = await enviarArquivoDrive(driveScriptUrl, file, "arte");
    cacheArquivosDrive[fileId] = Promise.resolve(bytes);
    const dim = EPS.tamanhoMmDoBbox(bbox);
    // O vetor entra no tamanho real dele (se couber no molde).
    const caixa = caixaInicial(p, dim.w / dim.h);
    const base = EPS.tamanhoMmDoBbox(p.moldes[p.tamanhoBase].bbox);
    if (dim.w <= base.w && dim.h <= base.h) {
      caixa.w = dim.w; caixa.h = dim.h;
      caixa.x = (base.w - dim.w) / 2;
    }
    adicionarElemento({
      id: novoIdArte("e"), tipo: "eps", nome: file.name,
      arquivo: { fileId, bbox, previewUrl: "" },
      caixa
    });
    mostrarEstadoSalvar("✓ Vetor enviado — envie também um PNG de prévia dele (painel ao lado)");
  });
}

function cmykParaCss(c) {
  const [C, M, Y, K] = (c || [0, 0, 0, 100]).map((v) => (Number(v) || 0) / 100);
  const r = Math.round(255 * (1 - C) * (1 - K));
  const g = Math.round(255 * (1 - M) * (1 - K));
  const b = Math.round(255 * (1 - Y) * (1 - K));
  return `rgb(${r},${g},${b})`;
}

function caminhoSvg(comandos, s) {
  return comandos.map((c) => {
    if (c.type === "M" || c.type === "L") return `${c.type}${(c.x * s).toFixed(2)} ${(c.y * s).toFixed(2)}`;
    if (c.type === "Q") return `Q${(c.x1 * s).toFixed(2)} ${(c.y1 * s).toFixed(2)} ${(c.x * s).toFixed(2)} ${(c.y * s).toFixed(2)}`;
    if (c.type === "C") {
      return `C${(c.x1 * s).toFixed(2)} ${(c.y1 * s).toFixed(2)} ${(c.x2 * s).toFixed(2)} ${(c.y2 * s).toFixed(2)} ${(c.x * s).toFixed(2)} ${(c.y * s).toFixed(2)}`;
    }
    return "Z";
  }).join("");
}

// Escala do palco (px por mm) e medidas do molde no tamanho mostrado.
function medidasPalco(p) {
  const tam = tamanhoAtualEditor(p);
  const molde = p.moldes[tam];
  const dim = EPS.tamanhoMmDoBbox(molde.bbox);
  const base = p.moldes[p.tamanhoBase] ? EPS.tamanhoMmDoBbox(p.moldes[p.tamanhoBase].bbox) : dim;
  const palco = document.getElementById("artePalco");
  const larguraDisp = Math.min(620, (palco && palco.parentElement.clientWidth) || 620);
  const s = Math.min(larguraDisp / dim.w, 700 / dim.h);
  return { tam, molde, dim, base, s };
}

function renderizarPalco() {
  const palco = document.getElementById("artePalco");
  const p = pecaAberta();
  if (!palco || !p) return;
  palco.innerHTML = "";
  const tam = tamanhoAtualEditor(p);
  if (!tam) {
    palco.style.width = "";
    palco.style.height = "";
    palco.innerHTML = '<p class="arte-palco-vazio">Envie o EPS do molde de algum tamanho para começar a marcar as posições.</p>';
    return;
  }
  const { molde, dim, base, s } = medidasPalco(p);
  palco.style.width = dim.w * s + "px";
  palco.style.height = dim.h * s + "px";
  if (molde.previewUrl) {
    const img = document.createElement("img");
    img.className = "arte-palco-molde";
    img.src = urlPrevia(molde.previewUrl);
    img.alt = "";
    img.draggable = false;
    palco.appendChild(img);
  } else {
    palco.insertAdjacentHTML("beforeend", '<p class="arte-palco-vazio">Sem PNG de prévia deste molde (o retângulo é o tamanho real do EPS).</p>');
  }

  (p.elementos || []).forEach((el) => {
    const c = EPS.caixaNoTamanho(el, tam, base, dim);
    const div = document.createElement("div");
    div.className = "arte-el arte-el-" + el.tipo + (el.id === elementoSelId ? " selecionado" : "");
    div.style.left = c.x * s + "px";
    div.style.top = c.y * s + "px";
    div.style.width = c.w * s + "px";
    div.style.height = c.h * s + "px";
    div.dataset.id = el.id;
    preencherPreviaElemento(div, el, c, s);
    const alca = document.createElement("span");
    alca.className = "arte-el-alca";
    div.appendChild(alca);
    ligarArraste(div, alca, el, p);
    palco.appendChild(div);
  });
}

function preencherPreviaElemento(div, el, c, s) {
  if (el.tipo === "texto") {
    const fonte = fontePronta(el.fonteId);
    if (!fonte) {
      div.insertAdjacentHTML("afterbegin", `<span class="arte-el-rotulo">${el.campo === "numero" ? "Nº" : "Nome"} (carregando fonte…)</span>`);
      return;
    }
    const lay = EPS.layoutTexto(fonte, EPS.textoDoCampo(el, amostraArte), { w: c.w, h: c.h }, el);
    const contorno = el.contornoMm > 0
      ? ` stroke="${cmykParaCss(el.contornoCmyk)}" stroke-width="${(el.contornoMm * 2 * s).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"`
      : "";
    div.insertAdjacentHTML("afterbegin",
      `<svg class="arte-el-svg" width="${c.w * s}" height="${c.h * s}" overflow="visible">` +
      `<path d="${caminhoSvg(lay.comandos, s)}" fill="${cmykParaCss(el.corCmyk)}"${contorno}/></svg>`);
  } else {
    const url = el.arquivo && el.arquivo.previewUrl;
    if (url) {
      div.insertAdjacentHTML("afterbegin", `<img src="${escAttr(urlPrevia(url))}" alt="" draggable="false" />`);
    } else {
      div.insertAdjacentHTML("afterbegin", `<span class="arte-el-rotulo">${escapeHtmlAdmin(el.nome || "EPS")}<br>(sem prévia)</span>`);
    }
  }
}

// Arrastar (mover) e a alça do canto (redimensionar). Imagens e vetores
// mantêm a proporção; o texto é livre.
function ligarArraste(div, alca, el, p) {
  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const redimensionar = ev.target === alca;
    if (elementoSelId !== el.id) {
      elementoSelId = el.id;
      document.querySelectorAll("#artePalco .arte-el").forEach((d) => d.classList.toggle("selecionado", d === div));
      renderizarPainelElemento();
    }
    const { tam, dim, base, s } = medidasPalco(p);
    const ini = EPS.caixaNoTamanho(el, tam, base, dim);
    const x0 = ev.clientX, y0 = ev.clientY;
    const proporcao = ini.w / ini.h;
    let atual = { ...ini };
    div.setPointerCapture(ev.pointerId);

    const mover = (e) => {
      const dx = (e.clientX - x0) / s, dy = (e.clientY - y0) / s;
      if (redimensionar) {
        let w = Math.max(2, ini.w + dx);
        let h = Math.max(2, ini.h + dy);
        if (el.tipo !== "texto") h = w / proporcao;
        atual = { x: ini.x, y: ini.y, w, h };
      } else {
        atual = { x: ini.x + dx, y: ini.y + dy, w: ini.w, h: ini.h };
      }
      div.style.left = atual.x * s + "px";
      div.style.top = atual.y * s + "px";
      div.style.width = atual.w * s + "px";
      div.style.height = atual.h * s + "px";
    };
    const soltar = () => {
      div.removeEventListener("pointermove", mover);
      div.removeEventListener("pointerup", soltar);
      div.removeEventListener("pointercancel", soltar);
      if (atual.x === ini.x && atual.y === ini.y && atual.w === ini.w && atual.h === ini.h) return;
      gravarCaixa(el, p, tam, atual);
      renderizarPalco();
      renderizarPainelElemento();
    };
    div.addEventListener("pointermove", mover);
    div.addEventListener("pointerup", soltar);
    div.addEventListener("pointercancel", soltar);
  });
}

// No tamanho base, a posição é a do elemento; nos outros, vira um ajuste
// fino só daquele tamanho.
function gravarCaixa(el, p, tam, caixa) {
  const arred = (v) => Math.round(v * 10) / 10;
  const c = { x: arred(caixa.x), y: arred(caixa.y), w: arred(caixa.w), h: arred(caixa.h) };
  if (tam === p.tamanhoBase) el.caixa = c;
  else {
    el.ajustes = el.ajustes || {};
    el.ajustes[tam] = c;
  }
  salvarArte();
}

// ----- Painel do elemento selecionado -----

function renderizarPainelElemento() {
  const painel = document.getElementById("artePainel");
  const p = pecaAberta();
  if (!painel || !p) return;
  const el = elementoSel();
  const lista = (p.elementos || []).map((e) =>
    `<li class="${e.id === elementoSelId ? "ativo" : ""}" data-id="${escAttr(e.id)}">${escapeHtmlAdmin(rotuloElemento(e))}</li>`).join("");
  painel.innerHTML = `
    <h4>Elementos da peça</h4>
    <ol class="arte-lista-el">${lista || '<li class="pix-ajuda">Nenhum ainda — use os botões acima do molde.</li>'}</ol>
    <p class="pix-ajuda">O de cima da lista fica por baixo na impressão.</p>
    <div id="artePainelEl"></div>`;
  painel.querySelectorAll(".arte-lista-el li[data-id]").forEach((li) => {
    li.onclick = () => { elementoSelId = li.dataset.id; renderizarPalco(); renderizarPainelElemento(); };
  });
  if (!el) return;

  const { tam, dim, base } = medidasPalco(p);
  const c = EPS.caixaNoTamanho(el, tam, base, dim);
  const ehBase = tam === p.tamanhoBase;
  const temAjuste = !!(el.ajustes && el.ajustes[tam]);
  const box = document.getElementById("artePainelEl");
  let html = `
    <h4>${escapeHtmlAdmin(rotuloElemento(el))}</h4>
    <p class="pix-ajuda">${ehBase ? `Posição no tamanho base (${escapeHtmlAdmin(tam)}).`
      : temAjuste ? `Ajuste próprio do tamanho ${escapeHtmlAdmin(tam)}.`
        : `Tamanho ${escapeHtmlAdmin(tam)}: proporcional ao base. Mexer aqui cria um ajuste só deste tamanho.`}</p>
    ${temAjuste && !ehBase ? '<button type="button" class="secundario" data-acao="semAjuste">Voltar ao proporcional</button>' : ""}
    <div class="arte-grade arte-grade-4">
      <label>X (mm)<input type="number" step="0.5" data-cx="x" value="${c.x.toFixed(1)}" /></label>
      <label>Y (mm)<input type="number" step="0.5" data-cx="y" value="${c.y.toFixed(1)}" /></label>
      <label>Largura<input type="number" step="0.5" min="1" data-cx="w" value="${c.w.toFixed(1)}" /></label>
      <label>Altura<input type="number" step="0.5" min="1" data-cx="h" value="${c.h.toFixed(1)}" /></label>
    </div>
    <button type="button" class="secundario" data-acao="centralizar">Centralizar na largura</button>`;

  if (el.tipo === "texto") {
    const fontes = arteEdit.fontes.map((f) =>
      `<option value="${escAttr(f.id)}"${f.id === el.fonteId ? " selected" : ""}>${escapeHtmlAdmin(f.nome)}</option>`).join("");
    const cmyk = (nome, v) => `<div class="arte-cmyk" data-cor="${nome}">` +
      ["C", "M", "Y", "K"].map((l, i) =>
        `<label>${l}<input type="number" min="0" max="100" step="1" data-i="${i}" value="${Number((v || [])[i]) || 0}" /></label>`).join("") +
      `<span class="arte-amostra-cor" style="background:${cmykParaCss(v)}"></span></div>`;
    html += `
      <div class="arte-grade">
        <label>Campo
          <select data-p="campo">
            <option value="nomeCamiseta">Nome na camiseta (apelido)</option>
            <option value="numero">Número</option>
            <option value="nome">Nome completo do estudante</option>
          </select></label>
        <label>Fonte<select data-p="fonteId">${fontes}</select></label>
        <label>Alinhamento
          <select data-p="alinhamento">
            <option value="centro">Centro</option><option value="esquerda">Esquerda</option><option value="direita">Direita</option>
          </select></label>
        <label>Texto grande demais
          <select data-p="ajuste">
            <option value="encolher">Encolher tudo</option><option value="comprimir">Comprimir na largura</option>
          </select></label>
        <label>Espaço entre letras<input type="number" step="0.01" data-p="espacamento" value="${Number(el.espacamento) || 0}" /></label>
        <label>Contorno (mm, 0 = sem)<input type="number" step="0.5" min="0" data-p="contornoMm" value="${Number(el.contornoMm) || 0}" /></label>
        <label class="checkbox-inline"><input type="checkbox" data-p="maiusculas" ${el.maiusculas !== false ? "checked" : ""} /> MAIÚSCULAS</label>
        ${el.campo === "nomeCamiseta" ? `<label class="checkbox-inline"><input type="checkbox" data-p="usarNomeSeVazio" ${el.usarNomeSeVazio !== false ? "checked" : ""} /> Sem apelido, usar o nome</label>` : ""}
      </div>
      <p class="arte-rotulo-cor">Cor (CMYK %)</p>${cmyk("corCmyk", el.corCmyk)}
      <p class="arte-rotulo-cor">Cor do contorno (CMYK %)</p>${cmyk("contornoCmyk", el.contornoCmyk)}`;
  } else {
    html += `<p class="pix-ajuda">Arquivo: ${escapeHtmlAdmin(el.nome || "")}` +
      (el.tipo === "png" && el.arquivo ? ` · ${el.arquivo.larguraPx} × ${el.arquivo.alturaPx} px` +
        ` · ${Math.round((el.arquivo.larguraPx / c.w) * 25.4)} dpi neste tamanho` : "") + "</p>";
    if (el.tipo === "eps") {
      html += `<button type="button" class="secundario" data-acao="previaEps">${el.arquivo.previewUrl ? "Trocar" : "Enviar"} PNG de prévia</button>`;
    }
  }
  html += `
    <div class="arte-botoes-el">
      <button type="button" class="secundario" data-acao="subir" title="Mais para baixo na impressão">▲</button>
      <button type="button" class="secundario" data-acao="descer" title="Mais para cima na impressão">▼</button>
      <button type="button" class="secundario" data-acao="duplicar">Duplicar</button>
      <button type="button" class="perigo" data-acao="excluir">Excluir</button>
    </div>`;
  box.innerHTML = html;

  box.querySelectorAll("[data-cx]").forEach((inp) => {
    inp.onchange = () => {
      const nova = { ...c, [inp.dataset.cx]: Number(inp.value) || 0 };
      if (el.tipo !== "texto" && (inp.dataset.cx === "w" || inp.dataset.cx === "h")) {
        const prop = c.w / c.h;
        if (inp.dataset.cx === "w") nova.h = nova.w / prop; else nova.w = nova.h * prop;
      }
      gravarCaixa(el, p, tam, nova);
      renderizarPalco();
      renderizarPainelElemento();
    };
  });
  box.querySelectorAll("[data-p]").forEach((inp) => {
    if (inp.tagName === "SELECT") inp.value = el[inp.dataset.p] || inp.options[0].value;
    inp.onchange = () => {
      const k = inp.dataset.p;
      el[k] = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? Number(inp.value) || 0 : inp.value;
      salvarArte();
      renderizarPalco();
      renderizarPainelElemento();
    };
  });
  box.querySelectorAll("[data-cor]").forEach((grupo) => {
    grupo.querySelectorAll("input").forEach((inp) => {
      inp.onchange = () => {
        const k = grupo.dataset.cor;
        el[k] = [0, 1, 2, 3].map((i) =>
          Math.max(0, Math.min(100, Number(grupo.querySelector(`[data-i="${i}"]`).value) || 0)));
        salvarArte();
        renderizarPalco();
        renderizarPainelElemento();
      };
    });
  });
  box.querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = () => acaoElemento(b.dataset.acao, el, p, tam, c, dim);
  });
}

function rotuloElemento(e) {
  if (e.tipo === "texto") {
    return e.campo === "numero" ? "Número" : e.campo === "nome" ? "Nome completo" : "Nome na camiseta";
  }
  return (e.tipo === "png" ? "PNG · " : "EPS · ") + (e.nome || "arquivo");
}

async function acaoElemento(acao, el, p, tam, c, dim) {
  const lista = p.elementos;
  const i = lista.indexOf(el);
  if (acao === "excluir") {
    if (!confirm(`Excluir "${rotuloElemento(el)}"?`)) return;
    lista.splice(i, 1);
    elementoSelId = "";
  } else if (acao === "subir" && i > 0) {
    [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]];
  } else if (acao === "descer" && i < lista.length - 1) {
    [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]];
  } else if (acao === "duplicar") {
    const copia = limparParaFirestore(el);
    copia.id = novoIdArte("e");
    copia.caixa = { ...copia.caixa, x: copia.caixa.x + 10, y: copia.caixa.y + 10 };
    lista.splice(i + 1, 0, copia);
    elementoSelId = copia.id;
  } else if (acao === "centralizar") {
    gravarCaixa(el, p, tam, { ...c, x: (dim.w - c.w) / 2 });
  } else if (acao === "semAjuste") {
    delete el.ajustes[tam];
  } else if (acao === "previaEps") {
    if (!exigirDrive()) return;
    const file = await escolherArquivo("image/png,image/jpeg");
    if (!file) return;
    await comEnvio("Enviando prévia…", async () => {
      const { url } = await enviarArquivoDrive(driveScriptUrl, file, "arte-previa");
      el.arquivo.previewUrl = url;
    });
  } else {
    return;
  }
  salvarArte(true);
  renderizarPalco();
  renderizarPainelElemento();
}

// ============================================================
// GERAÇÃO DA FOLHA EPS
// ============================================================

// Painel pequeno de progresso (a geração leva alguns segundos com PNG grande).
function progressoEps(texto) {
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

const esperarTela = () => new Promise((r) => setTimeout(r, 0));

// PNG → CMYK (pixels crus, sem gerenciamento de cor, para não "lavar" as cores).
async function imagemCmykDeBytes(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }),
    { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const dados = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close && bmp.close();
  return EPS.cmykDeRgba(canvas.width, canvas.height, dados);
}

// Carrega tudo o que a arte usa: fontes, EPS (moldes e vetores) e imagens.
async function carregarRecursosArte(arte, tamanhosUsados, aviso) {
  const rec = { fontes: {}, eps: {}, imagens: {} };
  const tarefas = [];
  const fontesUsadas = new Set();
  (arte.pecas || []).forEach((p) => {
    tamanhosUsados.forEach((t) => {
      const m = p.moldes && p.moldes[t];
      if (m && m.epsId) tarefas.push({ tipo: "eps", fileId: m.epsId, bbox: m.bbox });
    });
    (p.elementos || []).forEach((e) => {
      if (e.tipo === "texto") fontesUsadas.add(e.fonteId);
      else if (e.tipo === "eps") tarefas.push({ tipo: "eps", fileId: e.arquivo.fileId, bbox: e.arquivo.bbox });
      else if (e.tipo === "png") tarefas.push({ tipo: "png", fileId: e.arquivo.fileId });
    });
  });
  // A etiqueta usa a primeira fonte da arte.
  if (arte.fontes && arte.fontes[0] && (arte.folha || {}).etiqueta !== false) fontesUsadas.add(arte.fontes[0].id);
  (arte.fontes || []).filter((f) => fontesUsadas.has(f.id))
    .forEach((f) => tarefas.push({ tipo: "fonte", fileId: f.fileId, id: f.id }));

  const vistos = new Set();
  let n = 0;
  const unicas = tarefas.filter((t) => {
    const k = t.tipo + t.fileId + (t.id || "");
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  for (const t of unicas) {
    n++;
    aviso(`Baixando arquivos da arte (${n}/${unicas.length})…`);
    await esperarTela();
    if (t.tipo === "fonte") {
      rec.fontes[t.id] = await obterFonte(t.fileId);
    } else if (t.tipo === "eps") {
      const bytes = await baixarArquivoDrive(driveScriptUrl, t.fileId);
      rec.eps[t.fileId] = { bytes: EPS.extrairPostScript(bytes), bbox: t.bbox || EPS.lerBoundingBox(bytes) };
    } else {
      const bytes = await baixarArquivoDrive(driveScriptUrl, t.fileId);
      aviso(`Convertendo imagem para CMYK (${n}/${unicas.length})…`);
      await esperarTela();
      rec.imagens[t.fileId] = await imagemCmykDeBytes(bytes);
    }
  }
  return rec;
}

// Gera as folhas de UM modelo. Devolve [{ nome, blob }] e os avisos.
async function gerarFolhasDoModelo(modelo, camisetas, nomeBase) {
  const { arte, aviso: avisoArte } = arteDoModelo(modelo);
  if (!arte) {
    return { arquivos: [], avisos: [`O modelo "${modelo}" não tem arte cadastrada (aba Artes) — ficou de fora.`] };
  }
  const pako = await carregarLib("pako");
  const tamanhos = [...new Set(camisetas.map((c) => c.tamanho))];
  const rec = await carregarRecursosArte(arte, tamanhos, progressoEps);
  progressoEps(`Montando a folha de "${modelo}"…`);
  await esperarTela();
  const { folhas, avisos } = EPS.montarFolhas(arte, camisetas, rec);
  if (avisoArte) avisos.unshift(avisoArte);
  const arquivos = folhas.map((f, i) => {
    const sufixo = folhas.length > 1 ? `-folha${i + 1}` : "";
    const nome = `${nomeBase}${sufixo}.eps`;
    const partes = EPS.escreverEps(f, rec, (d) => pako.deflate(d), `${modelo}${sufixo}`);
    return { nome, blob: new Blob(partes, { type: "application/postscript" }) };
  });
  return { arquivos, avisos };
}

function baixarBlob(nome, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Ponto de entrada da aba Produção: grupos = [{ modelo, camisetas }].
// Um arquivo só sai como .eps; mais de um, num .zip.
async function baixarFolhasEps(grupos, nomeZip) {
  if (!driveScriptUrl) {
    alert("Configure a URL do Apps Script na aba Configurações (é de lá que vêm os arquivos das artes).");
    return;
  }
  const semNumero = grupos.flatMap((g) => g.camisetas).filter((c) => !String(c.numero || "").trim()).length;
  try {
    progressoEps("Preparando…");
    const arquivos = [];
    const avisos = [];
    for (const g of grupos) {
      const r = await gerarFolhasDoModelo(g.modelo, g.camisetas, slugify(`${nomeZip}-${g.modelo}`) || "folha");
      arquivos.push(...r.arquivos);
      avisos.push(...r.avisos);
    }
    if (semNumero > 0) avisos.push(`${semNumero} camiseta(s) sem número.`);
    if (arquivos.length === 0) {
      progressoEps("");
      alert("Nenhuma folha gerada.\n\n" + avisos.join("\n"));
      return;
    }
    if (arquivos.length === 1) {
      baixarBlob(arquivos[0].nome, arquivos[0].blob);
    } else {
      progressoEps("Compactando…");
      const JSZip = await carregarLib("JSZip");
      const zip = new JSZip();
      arquivos.forEach((a) => zip.file(a.nome, a.blob));
      baixarBlob((slugify(nomeZip) || "folhas") + "-eps.zip", await zip.generateAsync({ type: "blob" }));
    }
    progressoEps("");
    if (avisos.length) alert("Folha(s) gerada(s), com avisos:\n\n• " + avisos.join("\n• "));
  } catch (e) {
    console.error(e);
    progressoEps("");
    alert("Não foi possível gerar a folha EPS: " + (e.message || e));
  }
}

// Botão "EPS de teste" do editor: a peça aberta, no tamanho mostrado, com o
// nome e o número de teste.
async function baixarEpsDeTeste() {
  const p = pecaAberta();
  if (!p) return;
  const tam = tamanhoAtualEditor(p);
  if (!tam) { alert("Envie o molde primeiro."); return; }
  salvarArte(true);
  const arte = { ...limparParaFirestore(arteEdit), pecas: [limparParaFirestore(p)] };
  try {
    const pako = await carregarLib("pako");
    const rec = await carregarRecursosArte(arte, [tam], progressoEps);
    const { folhas, avisos } = EPS.montarFolhas(arte, [{ ...amostraArte, tamanho: tam }], rec);
    progressoEps("");
    if (!folhas.length) { alert(avisos.join("\n") || "Nada para gerar."); return; }
    const partes = EPS.escreverEps(folhas[0], rec, (d) => pako.deflate(d), "Teste");
    baixarBlob(slugify(`teste-${arteEdit.modelo}-${p.nome}-${tam}`) + ".eps", new Blob(partes, { type: "application/postscript" }));
    if (avisos.length) alert(avisos.join("\n"));
  } catch (e) {
    console.error(e);
    progressoEps("");
    alert("Não foi possível gerar o EPS de teste: " + (e.message || e));
  }
}
