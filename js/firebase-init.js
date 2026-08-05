// ============================================================
// INICIALIZAÇÃO DO FIREBASE
// Carregado depois de firebase-config.js e dos scripts do SDK
// (ver tags <script> no <head> de cada página HTML).
// ============================================================

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Google Analytics (opcional). Só é inicializado se o SDK de analytics
// estiver carregado na página. Em ambientes sem suporte (ex.: abrir o
// arquivo via file://) ele pode falhar, então protegemos com try/catch.
let analytics = null;
if (typeof firebase.analytics === "function") {
  try {
    analytics = firebase.analytics();
  } catch (erro) {
    console.warn("Firebase Analytics não pôde ser inicializado:", erro);
  }
}

// Login anônimo: necessário para poder gravar dados (ver firestore.rules).
// Isso não pede nada ao usuário, é automático e silencioso.
const authPronta = new Promise((resolve, reject) => {
  auth.onAuthStateChanged((user) => {
    if (user) {
      resolve(user);
    }
  });
  auth.signInAnonymously().catch((erro) => {
    console.error("Erro no login anônimo do Firebase:", erro);
    reject(erro);
  });
});
