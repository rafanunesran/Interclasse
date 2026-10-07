// ============================================================
// IDENTIDADE DA CONTA ADMINISTRADORA (compartilhado)
// ============================================================
// E-mail da conta "super admin" (master). É apenas um identificador; a
// segurança vem da senha, guardada no Firebase Authentication (não no
// código). Deve ser o mesmo e-mail usado na função ehAdmin() de
// firestore.rules.
const MASTER_EMAIL = "rafaelnf93@gmail.com";

// Conta da máquina da geração na nuvem (tools/nuvem/worker.js, GitHub
// Actions). Igual a ehMaquina() em firestore.rules: só lê os lotes, grava a
// metragem e o andamento dos trabalhos.
const MAQUINA_EMAIL = "maquina.interclasse@gmail.com";
function ehContaMaquina(user) {
  return !!user && !user.isAnonymous && user.email === MAQUINA_EMAIL;
}

// Verdadeiro apenas quando o usuário logado é a conta administradora
// (não anônimo e com o e-mail master).
function ehContaAdmin(user) {
  return !!user && !user.isAnonymous && user.email === MASTER_EMAIL;
}

// Sessão do admin: continua logada enquanto houver uso e cai depois de 24h
// sem nenhuma atividade (clique, tecla, rolagem) em nenhuma aba do Super
// Admin. A última atividade fica no localStorage, compartilhada entre abas.
const LIMITE_INATIVIDADE_ADMIN_MS = 24 * 60 * 60 * 1000;
const CHAVE_ATIVIDADE_ADMIN = "interclasse.adminUltimaAtividade";

function registrarAtividadeAdmin() {
  try {
    localStorage.setItem(CHAVE_ATIVIDADE_ADMIN, String(Date.now()));
  } catch (e) { /* sem localStorage: vale só o login do Firebase */ }
}

// Verdadeiro quando a última atividade registrada passou do limite.
function sessaoAdminExpirada() {
  try {
    const ultima = Number(localStorage.getItem(CHAVE_ATIVIDADE_ADMIN));
    return ultima > 0 && Date.now() - ultima > LIMITE_INATIVIDADE_ADMIN_MS;
  } catch (e) {
    return false;
  }
}
