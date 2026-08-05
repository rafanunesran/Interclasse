// ============================================================
// PÁGINA DE LOGIN (admin.html)
// Autentica com o Firebase Authentication (e-mail/senha) e, ao entrar
// com a conta administradora, redireciona para o Super Admin.
// ============================================================

const DESTINO_SUPER_ADMIN = "superadmin.html";

const elFormLogin = document.getElementById("formLogin");
const elMsgLogin = document.getElementById("msgLogin");

// Se já houver uma sessão da conta admin (o Firebase mantém o login salvo),
// pula o formulário e vai direto para o Super Admin.
auth.onAuthStateChanged((user) => {
  if (ehContaAdmin(user)) {
    window.location.replace(DESTINO_SUPER_ADMIN);
  }
});

elFormLogin.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderMensagem(elMsgLogin);

  const email = document.getElementById("emailAdmin").value.trim();
  const senha = document.getElementById("senhaAdmin").value;
  const botao = elFormLogin.querySelector("button[type=submit]");
  botao.disabled = true;

  try {
    const cred = await auth.signInWithEmailAndPassword(email, senha);
    if (ehContaAdmin(cred.user)) {
      window.location.replace(DESTINO_SUPER_ADMIN);
    } else {
      // Conta válida no Firebase, mas não é a conta administradora.
      await auth.signOut();
      mostrarMensagem(elMsgLogin, "Esta conta não tem acesso administrativo.", "erro");
    }
  } catch (erro) {
    console.error(erro);
    let msg = "Não foi possível entrar. Confira o e-mail e a senha.";
    if (erro.code === "auth/operation-not-allowed") {
      msg = "O login por e-mail/senha ainda não foi ativado no Firebase (Authentication > Sign-in method).";
    } else if (erro.code === "auth/too-many-requests") {
      msg = "Muitas tentativas seguidas. Aguarde um pouco e tente novamente.";
    }
    mostrarMensagem(elMsgLogin, msg, "erro");
  } finally {
    botao.disabled = false;
  }
});
