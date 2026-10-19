// ============================================================
// APP INSTALÁVEL (PWA) — botão "Instalar app" no topo das páginas
// ============================================================
// Chrome, Edge e Android avisam que o site pode ser instalado
// (beforeinstallprompt): guardamos o aviso e mostramos o botão. No iPhone e
// iPad (Safari) não existe esse aviso: o botão explica o caminho pelo menu
// Compartilhar. Já aberto como app, o botão não aparece.

(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker não registrado.", e));
    });
  }

  const jaInstalado = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (jaInstalado) return;

  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let aviso = null;
  let botao = null;

  function criarBotao() {
    if (botao) return botao;
    const nav = document.querySelector("header.topo nav");
    if (!nav) return null;
    botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn-instalar";
    botao.innerHTML = (typeof icone === "function" ? icone("download") : "⬇") + " Instalar app";
    botao.title = "Instalar o site como aplicativo neste aparelho";
    botao.onclick = async () => {
      if (aviso) {
        aviso.prompt();
        const escolha = await aviso.userChoice.catch(() => null);
        if (escolha && escolha.outcome === "accepted") botao.remove();
        aviso = null;
        return;
      }
      if (ehIOS) {
        alert("Para instalar no iPhone/iPad:\n\n1. Abra este site no Safari.\n2. Toque em Compartilhar (o quadrado com a seta para cima).\n3. Escolha \"Adicionar à Tela de Início\".");
      }
    };
    nav.appendChild(botao);
    return botao;
  }

  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    aviso = ev;
    criarBotao();
  });

  window.addEventListener("appinstalled", () => {
    aviso = null;
    if (botao) botao.remove();
  });

  if (ehIOS) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", criarBotao);
    else criarBotao();
  }
})();
