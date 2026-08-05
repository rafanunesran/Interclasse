// ============================================================
// IDENTIDADE DA CONTA ADMINISTRADORA (compartilhado)
// ============================================================
// E-mail da conta "super admin" (master). É apenas um identificador; a
// segurança vem da senha, guardada no Firebase Authentication (não no
// código). Deve ser o mesmo e-mail usado na função ehAdmin() de
// firestore.rules.
const MASTER_EMAIL = "rafaelnf93@gmail.com";

// Verdadeiro apenas quando o usuário logado é a conta administradora
// (não anônimo e com o e-mail master).
function ehContaAdmin(user) {
  return !!user && !user.isAnonymous && user.email === MASTER_EMAIL;
}
