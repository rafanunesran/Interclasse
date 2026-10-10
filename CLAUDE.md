# Instruções para o Claude

## Git

- **Sempre faça o commit no `main`** e envie (`git push origin HEAD:main`) ao terminar cada
  mudança, sem esperar o pedido. Se a sessão tiver um branch próprio, envie para ele também,
  mas o `main` é o destino.
- Antes de enviar, traga o `main` (`git fetch origin main`) e junte o que houver de novo.
- A cada mudança em JS/CSS, suba a versão dos scripts (`?v=AAAAMMDDx` nos `.html` e
  `VERSAO_MOCKUP3D` em `js/time.js` e `js/artes.js`) para o navegador não usar a cópia antiga.
