// ============================================================
// INICIALIZAÇÃO DO FIREBASE
// Carregado depois de firebase-config.js e dos scripts do SDK
// (ver tags <script> no <head> de cada página HTML).
// ============================================================

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

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
