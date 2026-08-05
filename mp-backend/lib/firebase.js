// Inicializa o Firebase Admin SDK com as credenciais da service account,
// lidas das variáveis de ambiente da Vercel. O Admin SDK grava no Firestore
// com privilégios totais (ignora firestore.rules) — por isso as credenciais
// ficam SÓ aqui no backend, nunca no site.
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // A chave privada vem com "\n" escapados nas env vars; desfazemos aqui.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

module.exports = { admin, db };
