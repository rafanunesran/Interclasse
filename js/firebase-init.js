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

// Login anônimo para as PÁGINAS PÚBLICAS (início e turma): necessário para
// gravar dados (ver firestore.rules). É automático e silencioso, não pede
// nada ao usuário. Retorna uma Promise que resolve quando há sessão.
//
// A página de administração NÃO usa isto: ela faz login com e-mail/senha
// pelo Firebase Authentication (ver js/admin.js).
function entrarAnonimo() {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged((user) => {
      if (user) resolve(user);
    });
    if (!auth.currentUser) {
      auth.signInAnonymously().catch((erro) => {
        console.error("Erro no login anônimo do Firebase:", erro);
        reject(erro);
      });
    }
  });
}
