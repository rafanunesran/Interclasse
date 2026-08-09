// GET /api/status (e raiz "/" via rewrite no vercel.json)
// Health check do backend: confirma que o deploy está no ar e mostra quais
// variáveis de ambiente estão presentes (sem vazar os valores). Útil para
// diferenciar "deploy quebrado" de "raiz sem página" (404 esperado da Vercel).
const { setCors } = require("../lib/http");

module.exports = (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  return res.status(200).json({
    ok: true,
    service: "interclasse-mp-backend",
    endpoints: ["/api/criar-preferencia", "/api/criar-pagamento", "/api/webhook-mp"],
    env: {
      MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
      MP_WEBHOOK_SECRET: !!process.env.MP_WEBHOOK_SECRET,
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY
    }
  });
};
