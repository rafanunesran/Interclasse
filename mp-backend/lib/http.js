// Libera CORS para o site (GitHub Pages) chamar a função de criar pagamento.
// Defina SITE_ORIGIN nas env vars para restringir à origem do seu site;
// se não definir, libera para qualquer origem ("*").
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.SITE_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { setCors };
