// ============================================================
// PASTA ONDE AS FOLHAS GERADAS SÃO SALVAS
// ============================================================
// No Chrome/Edge o site pode gravar direto numa pasta do computador
// (File System Access API): a pasta é escolhida uma vez e lembrada (o
// "handle" fica no IndexedDB deste computador). No Firefox não existe —
// os arquivos vão para os Downloads, como sempre.

const PastaSaida = (function () {
  const suportado = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const BANCO = "interclasse", LOJA = "pastas", CHAVE = "pastaFolhas";
  const CHAVE_SUBPASTA = "interclasse.pastaFolhas.subpasta";
  let handle = null;       // pasta lembrada (carregada na abertura da página)
  let carregando = null;

  function abrirBanco() {
    return new Promise((ok, erro) => {
      const req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
  }
  async function lerGuardado() {
    const db = await abrirBanco();
    try {
      return await new Promise((ok, erro) => {
        const req = db.transaction(LOJA, "readonly").objectStore(LOJA).get(CHAVE);
        req.onsuccess = () => ok(req.result || null);
        req.onerror = () => erro(req.error);
      });
    } finally { db.close(); }
  }
  async function guardar(valor) {
    const db = await abrirBanco();
    try {
      await new Promise((ok, erro) => {
        const loja = db.transaction(LOJA, "readwrite").objectStore(LOJA);
        const req = valor ? loja.put(valor, CHAVE) : loja.delete(CHAVE);
        req.onsuccess = () => ok();
        req.onerror = () => erro(req.error);
      });
    } finally { db.close(); }
  }

  // Lê a pasta lembrada (uma vez). Falha no IndexedDB = sem pasta.
  function carregar() {
    if (!suportado) return Promise.resolve(null);
    if (!carregando) {
      carregando = lerGuardado()
        .then((h) => (handle = h && h.kind === "directory" ? h : null))
        .catch((e) => { console.warn("Pasta das folhas:", e); return null; });
    }
    return carregando;
  }

  // Abre o seletor de pasta (precisa do clique do usuário) e lembra a escolha.
  async function escolher() {
    const h = await window.showDirectoryPicker({ id: "folhas", mode: "readwrite" });
    handle = h;
    try { await guardar(h); } catch (e) { console.warn("Não guardei a pasta:", e); }
    return h;
  }

  async function esquecer() {
    handle = null;
    try { await guardar(null); } catch (e) { console.warn(e); }
  }

  // Permissão de gravar na pasta (o navegador pergunta de novo a cada
  // sessão). Chamar no clique do usuário. Sem os métodos: permitido.
  async function pedirPermissao(h) {
    if (!h) return false;
    try {
      const op = { mode: "readwrite" };
      if (!h.queryPermission || (await h.queryPermission(op)) === "granted") return true;
      return h.requestPermission ? (await h.requestPermission(op)) === "granted" : false;
    } catch (e) {
      console.warn("Permissão da pasta:", e);
      return false;
    }
  }

  // Grava `blob` em pasta[/subpasta]/nome (substitui se já existir).
  async function salvar(h, subpasta, nome, blob) {
    const dir = subpasta ? await h.getDirectoryHandle(subpasta, { create: true }) : h;
    const arq = await dir.getFileHandle(nome, { create: true });
    const w = await arq.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (_) { /* nada */ }
      throw e;
    }
  }

  function usarSubpasta() {
    try { return localStorage.getItem(CHAVE_SUBPASTA) !== "0"; } catch (e) { return true; }
  }
  function definirSubpasta(sim) {
    try { localStorage.setItem(CHAVE_SUBPASTA, sim ? "1" : "0"); } catch (e) { /* nada */ }
  }

  // Destino pronto para a geração ({ handle, subpasta, rotulo }) ou null
  // (Downloads). `nomeLote`: nome da subpasta, se a opção estiver ligada.
  async function destino(nomeLote) {
    await carregar();
    if (!handle || !(await pedirPermissao(handle))) return null;
    const subpasta = usarSubpasta() && nomeLote ? nomeLote : "";
    return { handle, subpasta, rotulo: handle.name + (subpasta ? "/" + subpasta : "") };
  }

  return {
    suportado, carregar, escolher, esquecer, pedirPermissao, salvar, destino,
    usarSubpasta, definirSubpasta,
    get atual() { return handle; }
  };
})();

if (typeof window !== "undefined") PastaSaida.carregar();
