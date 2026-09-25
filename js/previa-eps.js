// ============================================================
// PRÉVIA DE EPS NO NAVEGADOR (Ghostscript em WebAssembly)
// ============================================================
// O navegador não desenha EPS. Para mostrar o molde de corte e o brasão no
// editor, o próprio site roda o Ghostscript (compilado para WebAssembly) e
// gera um PNG de prévia na hora do envio. Esse PNG vai para o Drive junto com
// o EPS; depois disso o editor só usa o PNG — o Ghostscript (~16 MB) só é
// baixado quando alguém envia um EPS.
//
// Ghostscript: © Artifex, licença AGPL-3.0, usado sem modificações a partir
// do pacote npm @jspawn/ghostscript-wasm (código-fonte público).

const PreviaEps = (function () {
  const BASE = "https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/";
  let prontos = null; // Promise<{ fabrica, modulo }>

  function carregarScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não foi possível carregar o Ghostscript (sem internet?)."));
      document.head.appendChild(s);
    });
  }

  function carregar() {
    if (!prontos) {
      prontos = (async () => {
        const antes = window.Module;
        await carregarScript(BASE + "gs.js");
        // gs.js declara a fábrica numa variável global "Module".
        const fabrica = window.Module;
        if (antes === undefined) delete window.Module; else window.Module = antes;
        if (typeof fabrica !== "function") throw new Error("Ghostscript não carregou.");
        const resp = await fetch(BASE + "gs.wasm");
        if (!resp.ok) throw new Error("Não foi possível baixar o Ghostscript.");
        const modulo = await WebAssembly.compile(await resp.arrayBuffer());
        return { fabrica, modulo };
      })().catch((e) => {
        prontos = null;
        throw e;
      });
    }
    return prontos;
  }

  // Renderiza o EPS (bytes) num PNG com fundo transparente, com cerca de
  // `larguraPx` pixels de largura. Devolve um Blob image/png.
  async function gerar(bytesEps, bbox, larguraPx) {
    const { fabrica, modulo } = await carregar();
    const erros = [];
    const gs = await fabrica({
      noInitialRun: true,
      print: () => {},
      printErr: (t) => erros.push(t),
      instantiateWasm: (imports, ok) => {
        WebAssembly.instantiate(modulo, imports).then((inst) => ok(inst));
        return {};
      }
    });
    const larguraPt = Math.max(1, bbox.x2 - bbox.x1);
    const dpi = Math.max(10, Math.min(300, ((larguraPx || 1200) / larguraPt) * 72));
    gs.FS.writeFile("/in.eps", bytesEps);
    const rc = gs.callMain([
      "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-dEPSCrop",
      "-sDEVICE=pngalpha", "-r" + dpi.toFixed(2),
      "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
      "-sOutputFile=/out.png", "/in.eps"
    ]);
    let png = null;
    try {
      png = gs.FS.readFile("/out.png");
    } catch (e) {
      png = null;
    }
    if (rc !== 0 || !png || !png.length) {
      throw new Error("O Ghostscript não conseguiu desenhar este EPS." +
        (erros.length ? " " + erros.slice(-3).join(" ") : ""));
    }
    return new Blob([png], { type: "image/png" });
  }

  return { carregar, gerar };
})();
