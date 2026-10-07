// ============================================================
// MÁQUINA DA GERAÇÃO NA NUVEM (GitHub Actions)
// ============================================================
// Roda em .github/workflows/gerar-folhas.yml, disparado pelo Apps Script
// quando o admin clica em "☁️ Gerar na nuvem" (js/nuvem.js):
//   1. serve este repositório (o próprio site) em http://localhost:8765;
//   2. abre o Super Admin num Chromium sem tela e entra com a conta da
//      máquina (MAQUINA_EMAIL / MAQUINA_SENHA);
//   3. chama executarTrabalhoNuvem(TRABALHO): a MESMA geração do botão; os
//      arquivos saem como downloads;
//   4. desenha uma prévia PNG de cada folha (Ghostscript) e envia tudo para
//      o Drive (Apps Script "sessaoUpload" + envio retomável direto ao Google);
//   5. grava o resultado (links, prévias) no trabalho, que o site mostra.
//
// Variáveis: TRABALHO, MAQUINA_EMAIL, MAQUINA_SENHA, WORKER_TOKEN, RUN_URL;
// opcionais: SITE_URL (em vez do servidor local), SAIDA (pasta dos
// arquivos), PREPARAR (módulo de teste que instala rotas no navegador).

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const RAIZ = path.resolve(__dirname, "../..");
const ENV = process.env;
const SAIDA = path.resolve(ENV.SAIDA || path.join(RAIZ, "saida-nuvem"));
const PEDACO = (Number(ENV.PEDACO_KB) || 65536) * 1024; // múltiplo de 256 KB (exigência do Drive)

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".otf": "font/otf",
  ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".ico": "image/x-icon", ".txt": "text/plain"
};

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

// Servidor estático do repositório (o site é só HTML/JS).
function servir(porta) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const arq = path.join(RAIZ, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); res.end("não encontrado"); return;
    }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((ok) => srv.listen(porta, "127.0.0.1", () => ok(srv)));
}

async function chamarScript(url, corpo) {
  let ultimo;
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(url, { method: "POST", body: JSON.stringify(corpo), redirect: "follow" });
      const dados = await r.json();
      if (dados && dados.ok) return dados;
      ultimo = new Error((dados && dados.erro) || "Apps Script sem resposta");
      if (/token/i.test(ultimo.message)) break; // senha errada: repetir não adianta
    } catch (e) {
      ultimo = e;
    }
    await new Promise((ok) => setTimeout(ok, 2000 * t));
  }
  throw new Error("Apps Script (" + corpo.acao + "): " + (ultimo && ultimo.message));
}

// Envia um arquivo ao Drive: o Apps Script abre a sessão; os bytes vão direto
// ao Google em pedaços. Devolve { id, pastaUrl }.
async function enviarAoDrive(scriptUrl, lote, arquivo, mime) {
  const tamanho = fs.statSync(arquivo).size;
  const s = await chamarScript(scriptUrl, {
    acao: "sessaoUpload", token: ENV.WORKER_TOKEN, nome: path.basename(arquivo), mimeType: mime, tamanho, lote
  });
  const fd = fs.openSync(arquivo, "r");
  try {
    let inicio = 0;
    for (;;) {
      const n = Math.min(PEDACO, tamanho - inicio);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, inicio);
      const fim = inicio + n - 1;
      let r;
      for (let t = 1; ; t++) {
        try {
          r = await fetch(s.uploadUrl, {
            method: "PUT", body: buf,
            headers: { "Content-Range": tamanho ? `bytes ${inicio}-${fim}/${tamanho}` : "bytes */0" }
          });
          if (r.status < 500) break;
        } catch (e) {
          if (t >= 4) throw e;
        }
        if (t >= 4) break;
        await new Promise((ok) => setTimeout(ok, 2000 * t));
      }
      if (r.status === 200 || r.status === 201) {
        const dados = await r.json();
        return { id: dados.id, pastaUrl: s.pastaUrl };
      }
      if (r.status !== 308) throw new Error(`Drive recusou ${path.basename(arquivo)} (${r.status}): ${(await r.text()).slice(0, 200)}`);
      inicio = fim + 1;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Prévias PNG (folha inteira reduzida) com o Ghostscript.
function gerarPrevias(arquivo, larguraCm) {
  const pasta = path.join(SAIDA, "previas");
  fs.mkdirSync(pasta, { recursive: true });
  const r = Math.max(4, Math.min(40, Math.round(1600 / ((larguraCm || 150) / 2.54))));
  const base = path.basename(arquivo).replace(/\.[^.]+$/, "");
  const ext = path.extname(arquivo).toLowerCase();
  const gs = (entrada, saida, eps) => execFileSync("gs", [
    "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", `-r${r}`, "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
    ...(eps ? ["-dEPSCrop"] : []), `-sOutputFile=${saida}`, entrada
  ], { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const lista = [];
  if (ext === ".pdf") {
    gs(arquivo, path.join(pasta, `previa-${base}-p%02d.png`), false);
    fs.readdirSync(pasta).filter((f) => f.startsWith(`previa-${base}-p`)).sort()
      .forEach((f, i, todos) => lista.push({ arq: path.join(pasta, f), rotulo: base + (todos.length > 1 ? ` · página ${i + 1}` : "") }));
  } else if (ext === ".eps") {
    const saida = path.join(pasta, `previa-${base}.png`);
    gs(arquivo, saida, true);
    lista.push({ arq: saida, rotulo: base });
  } else if (ext === ".zip") {
    const dir = path.join(SAIDA, "zip-" + base);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-o", "-q", arquivo, "-d", dir]);
    fs.readdirSync(dir).filter((f) => /\.eps$/i.test(f)).sort().forEach((f) => {
      const b = f.replace(/\.eps$/i, "");
      const saida = path.join(pasta, `previa-${b}.png`);
      gs(path.join(dir, f), saida, true);
      lista.push({ arq: saida, rotulo: b });
    });
  }
  return lista;
}

function nomeDoLote(nomeBase) {
  const d = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${nomeBase} - ${p.day}-${p.month}-${p.year} ${p.hour}h${p.minute}`;
}

async function principal() {
  const id = ENV.TRABALHO;
  if (!id) throw new Error("Falta TRABALHO.");
  fs.mkdirSync(SAIDA, { recursive: true });
  let srv = null;
  const site = ENV.SITE_URL || (srv = await servir(8765), "http://localhost:8765/");
  const navegador = await chromium.launch({ args: ["--js-flags=--max-old-space-size=12288"] });
  const contexto = await navegador.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => {
    const t = m.text();
    if ((m.type() === "error" || m.type() === "warning") && !/ainda não carregada/.test(t)) log("[site]", t.slice(0, 300));
  });
  pagina.on("pageerror", (e) => log("[site] erro:", e.message));
  if (ENV.PREPARAR) await require(path.resolve(ENV.PREPARAR))(pagina, contexto);

  const downloads = [];
  pagina.on("download", (d) => {
    const destino = path.join(SAIDA, d.suggestedFilename());
    downloads.push(d.saveAs(destino).then(() => { log("arquivo:", path.basename(destino)); return destino; }));
  });

  let logado = false;
  const gravar = (dados) => pagina.evaluate(([i, d]) => db.collection(COL_TRABALHOS).doc(i).update(d), [id, dados]);
  try {
    log("abrindo o site", site);
    await pagina.goto(new URL("superadmin.html", site).href, { waitUntil: "load" });
    await pagina.waitForFunction(() => typeof auth !== "undefined" && typeof executarTrabalhoNuvem === "function", null, { timeout: 120000 });
    await pagina.evaluate(async ([email, senha]) => {
      if (!auth.currentUser || auth.currentUser.email !== email) await auth.signInWithEmailAndPassword(email, senha);
    }, [ENV.MAQUINA_EMAIL, ENV.MAQUINA_SENHA]);
    logado = true;
    log("logado; gerando o trabalho", id);
    const res = await pagina.evaluate(([i, run]) => executarTrabalhoNuvem(i, run), [id, ENV.RUN_URL || ""]);
    const arquivos = await Promise.all(downloads);
    log(`${arquivos.length} arquivo(s) gerado(s)`);
    if (!arquivos.length) {
      await gravar({ avisos: res.avisos || [] });
      throw new Error("Nenhum arquivo foi gerado. Veja os avisos.");
    }

    const scriptUrl = await pagina.evaluate(() => driveScriptUrl);
    const lote = nomeDoLote(res.nomeBase || "lote");
    const enviados = [];
    const previas = [];
    let pastaUrl = "";
    for (const arq of arquivos) {
      await gravar({ etapa: `Enviando ${path.basename(arq)} para o Google Drive…` });
      const ext = path.extname(arq).toLowerCase();
      const mime = ext === ".pdf" ? "application/pdf" : ext === ".zip" ? "application/zip" : "application/postscript";
      const r = await enviarAoDrive(scriptUrl, lote, arq, mime);
      pastaUrl = r.pastaUrl || pastaUrl;
      enviados.push({ nome: path.basename(arq), id: r.id, bytes: fs.statSync(arq).size });
      log("enviado:", path.basename(arq));
      await gravar({ etapa: `Desenhando a prévia de ${path.basename(arq)}…` });
      let lista = [];
      try {
        lista = gerarPrevias(arq, res.larguraCm);
      } catch (e) {
        log("prévia falhou:", e.message);
        (res.avisos = res.avisos || []).push(`Prévia de ${path.basename(arq)} não gerada: ${String(e.message).slice(0, 200)}`);
      }
      for (const p of lista) {
        const rp = await enviarAoDrive(scriptUrl, lote, p.arq, "image/png");
        previas.push({ nome: path.basename(p.arq), id: rp.id, rotulo: p.rotulo });
      }
    }
    if (previas.length) {
      await chamarScript(scriptUrl, { acao: "compartilhar", token: ENV.WORKER_TOKEN, ids: previas.map((p) => p.id) })
        .catch((e) => log("compartilhar:", e.message));
    }
    await gravar({
      status: "pronto", arquivos: enviados, previas, pastaUrl, avisos: res.avisos || [], pct: 1,
      etapa: `${enviados.length} arquivo(s) no Drive, pasta "Impressão/${lote}".`, fimMs: Date.now()
    });
    log("pronto");
  } catch (e) {
    let msg = String(e.message || e).replace(/^page\.evaluate: (Error: )?/, "");
    if (/token/i.test(msg)) msg += " — o segredo WORKER_TOKEN do GitHub tem de ser igual ao do Apps Script.";
    log("ERRO:", msg);
    if (logado) {
      await gravar({ status: "erro", erro: msg.slice(0, 1000), fimMs: Date.now() })
        .catch((x) => log("não consegui gravar o erro:", x.message));
    }
    process.exitCode = 1;
  } finally {
    await navegador.close();
    if (srv) srv.close();
  }
}

principal().catch((e) => { console.error(e); process.exit(1); });
