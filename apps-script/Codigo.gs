/**
 * Interclasse — Uploader de imagem da camiseta (Google Apps Script)
 *
 * Recebe uma imagem (base64) do site, salva no Google Drive numa pasta,
 * deixa o arquivo público (qualquer um com o link pode ver) e devolve a
 * URL para exibir no <img>. Também guarda os arquivos das artes de
 * produção (EPS, PNG em alta, fontes) e os devolve ao site (doGet). Serve como alternativa gratuita ao Firebase
 * Storage (que exige plano pago).
 *
 * Mais abaixo, neste mesmo arquivo, fica o BACKUP DIÁRIO dos dados.
 *
 * Como publicar: veja apps-script/README.md.
 */

// Versão deste código. Abrindo a URL do app da Web (/exec) no navegador, ela
// aparece na resposta — é o jeito de conferir se a implantação está atualizada.
var VERSAO_SCRIPT = "2026-10-08-nuvem";

// Nome da pasta no seu Drive onde as imagens ficam (criada automaticamente).
var NOME_PASTA = "Interclasse Camisetas";

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    // Ações do backup (aba Backup do Super Admin) — ver a parte de backup, mais abaixo.
    if (dados.acao && String(dados.acao).indexOf("backup") === 0) return json_(rotearBackup_(dados));
    // Geração na nuvem (js/nuvem.js e a máquina do GitHub) — ver o fim do arquivo.
    if (dados.acao === "nuvem") return json_(dispararNuvem_(dados));
    if (dados.acao === "sessaoUpload") return json_(sessaoUpload_(dados));
    if (dados.acao === "compartilhar") return json_(compartilhar_(dados));
    if (!dados.dataBase64) return json_({ ok: false, erro: "Sem imagem." });

    var pasta = obterPasta_();
    var bytes = Utilities.base64Decode(dados.dataBase64);
    var blob = Utilities.newBlob(bytes, dados.mimeType || "image/jpeg", dados.nome || "camiseta.jpg");
    var arquivo = pasta.createFile(blob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var id = arquivo.getId();
    var url = "https://drive.google.com/thumbnail?id=" + id + "&sz=w1000";
    return json_({ ok: true, fileId: id, url: url });
  } catch (err) {
    return json_({ ok: false, erro: String(err) });
  }
}

// GET sem parâmetros: só confirma que o script está no ar.
// GET ?acao=arquivo&id=ID: devolve o arquivo em base64. É assim que o site lê
// os bytes das artes (EPS, PNG em alta, fontes) para montar a folha de
// impressão — o Drive não deixa o navegador baixar o arquivo direto (CORS).
// Só entrega arquivos da pasta do site, nunca outro arquivo do seu Drive.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.acao !== "arquivo") {
    // "versao" mostra qual código está publicado (abra a URL /exec no navegador).
    return json_({ ok: true, msg: "Interclasse - uploader de imagem ativo.", versao: VERSAO_SCRIPT, backup: true });
  }
  try {
    var arquivo = DriveApp.getFileById(p.id);
    if (!estaNaPasta_(arquivo)) return json_({ ok: false, erro: "Arquivo fora da pasta do site." });
    var blob = arquivo.getBlob();
    return json_({
      ok: true,
      nome: arquivo.getName(),
      mimeType: blob.getContentType(),
      dataBase64: Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    return json_({ ok: false, erro: String(err) });
  }
}

function estaNaPasta_(arquivo) {
  var pais = arquivo.getParents();
  while (pais.hasNext()) {
    if (pais.next().getName() === NOME_PASTA) return true;
  }
  return false;
}

function obterPasta_() {
  var it = DriveApp.getFoldersByName(NOME_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOME_PASTA);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// ============================================================================
// BACKUP DIÁRIO
// ============================================================================
// ============================================================================

/**
 * Interclasse — Backup diário do Firestore (Google Apps Script)
 *
 * Todo dia o script lê TODOS os dados do site no Firestore (times, camisetas,
 * clientes, configurações, levas de produção, cobranças...) e salva uma cópia
 * em JSON numa pasta PRIVADA do seu Google Drive ("Interclasse Backups").
 *
 * Regras de guarda:
 *   • o script NUNCA apaga um backup sozinho;
 *   • os backups dos últimos 30 dias são o histórico protegido: nem com
 *     confirmação eles podem ser apagados pelo site;
 *   • os mais antigos que 30 dias só saem quando o administrador confirma no
 *     Super Admin (aba Backup) — e vão para a LIXEIRA do Drive, onde ainda
 *     ficam recuperáveis por 30 dias. Enquanto houver backup antigo esperando
 *     confirmação, o script manda um e-mail de aviso (no máximo 1 por semana).
 *
 * O acesso ao Firestore usa a SUA conta Google (a dona do projeto Firebase),
 * pelo token do próprio Apps Script — não há chave nem senha no código.
 *
 * Como ativar: veja apps-script/README.md (seção "Backup diário").
 */

// ---------------- Configuração ----------------

var BACKUP_PROJETO = "interclasse-e2854";              // projectId do Firebase (js/firebase-config.js)
var BACKUP_API_KEY = "AIzaSyDK-jn3ksbaJiKrI6b_i0Yl0OUzSzBX2AY"; // apiKey do Firebase (é pública)
var BACKUP_EMAIL_ADMIN = "rafaelnf93@gmail.com";      // igual ao MASTER_EMAIL do site
var BACKUP_PASTA = "Interclasse Backups";
var BACKUP_DIAS_PROTEGIDOS = 30;
var BACKUP_HORA_DIARIA = 3;                           // 3h da manhã (fuso do projeto)

var BACKUP_BASE = "https://firestore.googleapis.com/v1/projects/" + BACKUP_PROJETO +
  "/databases/(default)/documents";

// ============================================================
// FUNÇÕES PARA RODAR NO EDITOR (menu ▶ Executar)
// ============================================================

// Rode UMA vez para ligar o backup diário (e autorizar o acesso).
function instalarBackupDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "backupDiario") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupDiario").timeBased().everyDays(1).atHour(BACKUP_HORA_DIARIA).create();
  Logger.log("Backup diário ligado (todo dia por volta das " + BACKUP_HORA_DIARIA + "h).");
}

// Faz um backup na hora (bom para testar).
function backupAgora() {
  var r = fazerBackup_("manual");
  Logger.log("Backup salvo: " + r.nome + " (" + r.totalDocumentos + " documentos)");
}

// EMERGÊNCIA — restaurar sem o site: escreva o nome do arquivo (como aparece
// na pasta "Interclasse Backups") e rode esta função. Antes de restaurar, o
// script salva um backup "antes-de-restaurar" do estado atual.
function restaurarPeloEditor() {
  var NOME_DO_ARQUIVO = ""; // ex.: "backup-interclasse-2026-09-25_0300-diario.json"
  if (!NOME_DO_ARQUIVO) throw new Error("Preencha NOME_DO_ARQUIVO dentro da função restaurarPeloEditor.");
  var it = obterPastaBackup_().getFilesByName(NOME_DO_ARQUIVO);
  if (!it.hasNext()) throw new Error("Arquivo não encontrado na pasta " + BACKUP_PASTA + ".");
  var r = restaurar_(lerBackupDoArquivo_(it.next()), "tudo");
  Logger.log("Restaurados " + r.restaurados + " documentos. Backup de segurança: " + r.backupSeguranca);
}

// Chamada pelo gatilho diário.
function backupDiario() {
  try {
    fazerBackup_("diario");
  } catch (err) {
    avisarPorEmail_(
      "⚠️ Backup do Interclasse FALHOU",
      "O backup diário do site não foi feito.\n\nErro: " + err + "\n\n" +
      "Abra o Apps Script e rode a função backupAgora para ver o detalhe."
    );
    throw err;
  }
  avisarBackupsAntigos_();
}

// ============================================================
// ENDPOINTS (chamados pelo Super Admin, via doPost em Codigo.gs)
// ============================================================

// Toda ação de backup exige o token de login da conta administradora.
function rotearBackup_(dados) {
  verificarAdmin_(dados.idToken);
  var acao = dados.acao;

  if (acao === "backupListar") return listarBackups_();
  if (acao === "backupAgora") {
    var r = fazerBackup_("manual");
    return { ok: true, nome: r.nome, totalDocumentos: r.totalDocumentos };
  }
  if (acao === "backupAtivarDiario") {
    instalarBackupDiario();
    return { ok: true };
  }
  if (acao === "backupBaixar") {
    var arq = arquivoDeBackup_(dados.id);
    return { ok: true, nome: arq.getName(), conteudo: arq.getBlob().getDataAsString("UTF-8") };
  }
  if (acao === "backupResumo") {
    return { ok: true, resumo: resumoDetalhado_(lerBackupDoArquivo_(arquivoDeBackup_(dados.id))) };
  }
  if (acao === "backupRestaurar") {
    if (dados.confirmacao !== "RESTAURAR") throw new Error("Restauração não confirmada.");
    var backup = dados.conteudo
      ? validarBackup_(JSON.parse(dados.conteudo))
      : lerBackupDoArquivo_(arquivoDeBackup_(dados.id));
    var res = restaurar_(backup, dados.escopo || "tudo");
    return { ok: true, restaurados: res.restaurados, backupSeguranca: res.backupSeguranca };
  }
  if (acao === "backupExcluirAntigos") {
    if (dados.confirmacao !== "EXCLUIR") throw new Error("Exclusão não confirmada.");
    return excluirAntigos_(dados.ids || []);
  }
  throw new Error("Ação de backup desconhecida: " + acao);
}

// Confere o token do Firebase Authentication e o e-mail da conta.
function verificarAdmin_(idToken) {
  if (!idToken) throw new Error("Faça login como administrador.");
  var r = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + BACKUP_API_KEY,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true }
  );
  var dados = JSON.parse(r.getContentText() || "{}");
  var usuario = dados.users && dados.users[0];
  if (r.getResponseCode() !== 200 || !usuario ||
      String(usuario.email || "").toLowerCase() !== BACKUP_EMAIL_ADMIN.toLowerCase()) {
    throw new Error("Acesso negado: só a conta administradora mexe nos backups.");
  }
}

// ============================================================
// FAZER O BACKUP
// ============================================================

function fazerBackup_(tipo) {
  var documentos = [];
  lerColecoes_("", 0, documentos);

  var porColecao = {};
  documentos.forEach(function (d) {
    var chave = d.caminho.split("/").filter(function (_, i) { return i % 2 === 0; }).join("/*/");
    porColecao[chave] = (porColecao[chave] || 0) + 1;
  });

  var agora = new Date();
  var backup = {
    formato: "interclasse-backup",
    versao: 1,
    projeto: BACKUP_PROJETO,
    tipo: tipo,
    criadoEm: agora.toISOString(),
    resumo: { totalDocumentos: documentos.length, porColecao: porColecao },
    documentos: documentos
  };

  var fuso = Session.getScriptTimeZone() || "America/Sao_Paulo";
  var nome = "backup-interclasse-" + Utilities.formatDate(agora, fuso, "yyyy-MM-dd_HHmm") + "-" + tipo + ".json";
  var blob = Utilities.newBlob(JSON.stringify(backup), "application/json", nome);
  var arquivo = obterPastaBackup_().createFile(blob);
  arquivo.setDescription(tipo + " · " + documentos.length + " documentos");
  return { nome: nome, id: arquivo.getId(), totalDocumentos: documentos.length };
}

// Lê recursivamente as coleções a partir de `pai` ("" = raiz).
function lerColecoes_(pai, profundidade, saida) {
  if (profundidade > 6) return;
  listarIdsDeColecoes_(pai).forEach(function (colecao) {
    var caminhoColecao = (pai ? pai + "/" : "") + colecao;
    var token = "";
    do {
      var url = BACKUP_BASE + "/" + caminhoColecao + "?pageSize=300&showMissing=true" +
        (token ? "&pageToken=" + encodeURIComponent(token) : "");
      var r = firestore_("get", url);
      (r.documents || []).forEach(function (doc) {
        var caminho = doc.name.split("/documents/")[1];
        // Documento "fantasma" (só existe por ter subcoleção): não tem campos.
        if (doc.fields || doc.createTime) {
          saida.push({ caminho: caminho, campos: doc.fields || {}, atualizadoEm: doc.updateTime || "" });
        }
        // Cobranças não têm subcoleções: pular poupa centenas de chamadas.
        if (colecao !== "cobrancas") lerColecoes_(caminho, profundidade + 1, saida);
      });
      token = r.nextPageToken || "";
    } while (token);
  });
}

function listarIdsDeColecoes_(pai) {
  var ids = [];
  var token = "";
  do {
    var r = firestore_("post", BACKUP_BASE + (pai ? "/" + pai : "") + ":listCollectionIds",
      { pageSize: 100, pageToken: token || undefined });
    ids = ids.concat(r.collectionIds || []);
    token = r.nextPageToken || "";
  } while (token);
  return ids;
}

// Chamada à API REST do Firestore com a conta dona do script. A cota vai para
// o projeto do Firebase (x-goog-user-project); se a conta não puder usar esse
// cabeçalho, tenta de novo sem ele.
function firestore_(metodo, url, corpo, semProjeto) {
  var headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  if (!semProjeto) headers["x-goog-user-project"] = BACKUP_PROJETO;
  var op = { method: metodo, headers: headers, muteHttpExceptions: true };
  if (corpo) {
    op.contentType = "application/json";
    op.payload = JSON.stringify(corpo);
  }
  var r = UrlFetchApp.fetch(url, op);
  var texto = r.getContentText();
  if (r.getResponseCode() >= 300) {
    if (!semProjeto && r.getResponseCode() === 403 && /USER_PROJECT_DENIED|serviceusage|user project/i.test(texto)) {
      return firestore_(metodo, url, corpo, true);
    }
    throw new Error("Firestore respondeu " + r.getResponseCode() + ": " + texto.slice(0, 400));
  }
  return texto ? JSON.parse(texto) : {};
}

// ============================================================
// LISTAR / GUARDA DE 30 DIAS
// ============================================================

function obterPastaBackup_() {
  var it = DriveApp.getFoldersByName(BACKUP_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_PASTA);
}

function arquivosDeBackup_() {
  var lista = [];
  var it = obterPastaBackup_().getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/^backup-interclasse-.*\.json$/.test(f.getName())) lista.push(f);
  }
  lista.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  return lista;
}

function idadeEmDias_(arquivo) {
  return (Date.now() - arquivo.getDateCreated().getTime()) / 86400000;
}

function arquivoDeBackup_(id) {
  var f = DriveApp.getFileById(id);
  var pais = f.getParents();
  while (pais.hasNext()) {
    if (pais.next().getName() === BACKUP_PASTA) return f;
  }
  throw new Error("Esse arquivo não é um backup do Interclasse.");
}

function listarBackups_() {
  var diarioAtivo = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "backupDiario";
  });
  var backups = arquivosDeBackup_().map(function (f) {
    var tipo = (f.getName().match(/-(diario|manual|antes-de-restaurar)\.json$/) || [])[1] || "";
    var idade = idadeEmDias_(f);
    return {
      id: f.getId(),
      nome: f.getName(),
      tamanho: f.getSize(),
      criadoEm: f.getDateCreated().toISOString(),
      tipo: tipo,
      descricao: f.getDescription() || "",
      idadeDias: Math.floor(idade),
      protegido: idade <= BACKUP_DIAS_PROTEGIDOS
    };
  });
  return { ok: true, diarioAtivo: diarioAtivo, diasProtegidos: BACKUP_DIAS_PROTEGIDOS, backups: backups };
}

// Só apaga (manda para a lixeira) backups com MAIS de 30 dias, e só os ids
// que o administrador confirmou. Os do histórico protegido são recusados.
function excluirAntigos_(ids) {
  var excluidos = [];
  var recusados = [];
  ids.forEach(function (id) {
    var f = arquivoDeBackup_(id);
    if (idadeEmDias_(f) <= BACKUP_DIAS_PROTEGIDOS) {
      recusados.push(f.getName());
      return;
    }
    f.setTrashed(true);
    excluidos.push(f.getName());
  });
  return { ok: true, excluidos: excluidos, recusados: recusados };
}

// E-mail (no máximo 1 por semana) quando há backups além dos 30 dias
// esperando a confirmação do administrador.
function avisarBackupsAntigos_() {
  var antigos = arquivosDeBackup_().filter(function (f) { return idadeEmDias_(f) > BACKUP_DIAS_PROTEGIDOS; });
  if (antigos.length === 0) return;
  var props = PropertiesService.getScriptProperties();
  var ultimo = Number(props.getProperty("avisoAntigosEm") || 0);
  if (Date.now() - ultimo < 7 * 86400000) return;
  avisarPorEmail_(
    "Interclasse: " + antigos.length + " backup(s) com mais de " + BACKUP_DIAS_PROTEGIDOS + " dias",
    "Há " + antigos.length + " backup(s) com mais de " + BACKUP_DIAS_PROTEGIDOS + " dias na pasta \"" + BACKUP_PASTA + "\".\n\n" +
    "Eles NÃO foram apagados. Se quiser liberar espaço, confirme a exclusão no Super Admin → aba Backup.\n" +
    "Se não fizer nada, eles continuam guardados."
  );
  props.setProperty("avisoAntigosEm", String(Date.now()));
}

function avisarPorEmail_(assunto, texto) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail() || BACKUP_EMAIL_ADMIN, assunto, texto);
  } catch (e) {
    Logger.log("Não foi possível enviar o e-mail de aviso: " + e);
  }
}

// ============================================================
// RESTAURAR
// ============================================================

function lerBackupDoArquivo_(arquivo) {
  return validarBackup_(JSON.parse(arquivo.getBlob().getDataAsString("UTF-8")));
}

function validarBackup_(b) {
  if (!b || b.formato !== "interclasse-backup" || !Array.isArray(b.documentos)) {
    throw new Error("Arquivo não é um backup do Interclasse.");
  }
  return b;
}

// O que tem no backup: contagem por coleção e a lista de times.
function resumoDetalhado_(b) {
  var alunosPorTime = {};
  var times = [];
  b.documentos.forEach(function (d) {
    var p = d.caminho.split("/");
    if (p[0] === "turmas" && p.length === 2) {
      times.push({ id: p[1], nome: valorTexto_(d.campos.nome) || p[1] });
    } else if (p[0] === "turmas" && p[2] === "alunos") {
      var ex = d.campos.excluido && d.campos.excluido.booleanValue === true;
      if (!ex) alunosPorTime[p[1]] = (alunosPorTime[p[1]] || 0) + 1;
    }
  });
  times.forEach(function (t) { t.camisetas = alunosPorTime[t.id] || 0; });
  times.sort(function (a, c) { return a.nome.localeCompare(c.nome); });
  return { criadoEm: b.criadoEm, tipo: b.tipo, resumo: b.resumo, times: times };
}

function valorTexto_(v) {
  return v && v.stringValue != null ? v.stringValue : "";
}

// Grava de volta os documentos do backup (sobrescreve cada um). Documentos
// criados depois do backup NÃO são apagados. Antes de tudo, salva um backup
// "antes-de-restaurar" do estado atual — dá para desfazer a restauração.
//   escopo: "tudo" | "time:<id>"
function restaurar_(backup, escopo) {
  var docs = backup.documentos;
  if (escopo && escopo.indexOf("time:") === 0) {
    var id = escopo.slice(5);
    docs = docs.filter(function (d) {
      return d.caminho === "turmas/" + id || d.caminho.indexOf("turmas/" + id + "/") === 0;
    });
    if (docs.length === 0) throw new Error("Esse time não existe no backup.");
  } else if (escopo !== "tudo") {
    throw new Error("Escopo de restauração inválido.");
  }

  var seguranca = fazerBackup_("antes-de-restaurar");
  var prefixo = "projects/" + BACKUP_PROJETO + "/databases/(default)/documents/";
  for (var i = 0; i < docs.length; i += 400) {
    var writes = docs.slice(i, i + 400).map(function (d) {
      return { update: { name: prefixo + d.caminho, fields: d.campos || {} } };
    });
    firestore_("post", BACKUP_BASE + ":commit", { writes: writes });
  }
  return { restaurados: docs.length, backupSeguranca: seguranca.nome };
}


// ============================================================================
// ============================================================================
// GERAÇÃO NA NUVEM (folhas de impressão)
// ============================================================================
// ============================================================================
//
// O site cria um pedido (Firestore, coleção "trabalhos") e chama a ação
// "nuvem": aqui o pedido vira um disparo do GitHub Actions (workflow
// gerar-folhas.yml). A máquina do GitHub gera as folhas e, para cada arquivo,
// pede "sessaoUpload": este script cria a pasta
// "Interclasse Camisetas/Impressão/<lote>" e abre um envio retomável no Drive;
// a máquina manda os bytes direto ao Google (arquivos grandes demais para
// passar por aqui). "sessaoUpload" e "compartilhar" exigem o WORKER_TOKEN.
//
// Propriedades do script (engrenagem → Propriedades do script):
//   GITHUB_TOKEN  chave do GitHub (fine-grained, só o repositório, Actions: leitura e escrita)
//   WORKER_TOKEN  senha da máquina — igual ao segredo WORKER_TOKEN do GitHub
//   GITHUB_REPO   (opcional) dono/repositório — padrão rafanunesran/interclasse
//   GITHUB_REF    (opcional) branch — padrão main
// As chaves ficam SÓ nas Propriedades, nunca neste código.
//
// Depois de colar: rode testarNuvem (▶ Executar) e reimplante
// (Implantar → Gerenciar implantações → Editar → Nova versão).

function propsNuvem_() {
  var p = PropertiesService.getScriptProperties();
  return {
    githubToken: p.getProperty("GITHUB_TOKEN"),
    workerToken: p.getProperty("WORKER_TOKEN"),
    repo: p.getProperty("GITHUB_REPO") || "rafanunesran/interclasse",
    ref: p.getProperty("GITHUB_REF") || "main"
  };
}

function cabecalhosGithub_(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

// Pedido do site: liga a máquina do GitHub para o trabalho informado.
function dispararNuvem_(dados) {
  try {
    var id = String(dados.trabalhoId || "");
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return { ok: false, erro: "Trabalho inválido." };
    var cfg = propsNuvem_();
    if (!cfg.githubToken) {
      return { ok: false, erro: "Falta a propriedade GITHUB_TOKEN no Apps Script (engrenagem → Propriedades do script)." };
    }
    var resp = UrlFetchApp.fetch(
      "https://api.github.com/repos/" + cfg.repo + "/actions/workflows/gerar-folhas.yml/dispatches", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ ref: cfg.ref, inputs: { trabalho: id } }),
        headers: cabecalhosGithub_(cfg.githubToken),
        muteHttpExceptions: true
      });
    var codigo = resp.getResponseCode();
    if (codigo !== 204) {
      return { ok: false, erro: "O GitHub recusou o disparo (" + codigo + "): " + resp.getContentText().slice(0, 300) };
    }
    return { ok: true, actionsUrl: "https://github.com/" + cfg.repo + "/actions/workflows/gerar-folhas.yml" };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

function subpasta_(pai, nome) {
  var it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

function exigirWorker_(dados) {
  var cfg = propsNuvem_();
  if (!cfg.workerToken || String(dados.token || "") !== cfg.workerToken) {
    throw new Error("Token da máquina inválido (confira o WORKER_TOKEN aqui e no GitHub).");
  }
}

// Pedido da máquina: abre o envio de um arquivo na pasta do lote.
function sessaoUpload_(dados) {
  try {
    exigirWorker_(dados);
    var lote = String(dados.lote || "lote").replace(/[\\/]/g, "-").slice(0, 120);
    var pasta = subpasta_(subpasta_(obterPasta_(), "Impressão"), lote);
    // Visível por link: as prévias em PNG aparecem no site.
    pasta.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var mime = String(dados.mimeType || "application/octet-stream");
    var cab = { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": mime };
    if (dados.tamanho) cab["X-Upload-Content-Length"] = String(dados.tamanho);
    var resp = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify({ name: String(dados.nome || "arquivo"), parents: [pasta.getId()], mimeType: mime }),
      headers: cab,
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      return { ok: false, erro: "Drive (" + resp.getResponseCode() + "): " + resp.getContentText().slice(0, 300) };
    }
    var h = resp.getAllHeaders();
    var url = h.Location || h.location;
    if (!url) return { ok: false, erro: "O Drive não devolveu o endereço do envio." };
    return { ok: true, uploadUrl: url, pastaId: pasta.getId(), pastaUrl: pasta.getUrl() };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// Pedido da máquina: deixa os arquivos (prévias) visíveis por link.
function compartilhar_(dados) {
  try {
    exigirWorker_(dados);
    (dados.ids || []).forEach(function (id) {
      DriveApp.getFileById(String(id)).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// Rode no editor (▶ Executar → testarNuvem) depois de criar as Propriedades.
// Não dispara nada: só confere se as chaves estão lá e se o GitHub aceita a
// chave. O resultado aparece no "Registro de execução".
function testarNuvem() {
  var cfg = propsNuvem_();
  Logger.log("GITHUB_TOKEN: " + (cfg.githubToken ? "ok" : "FALTANDO"));
  Logger.log("WORKER_TOKEN: " + (cfg.workerToken ? "ok (" + cfg.workerToken.length + " caracteres)" : "FALTANDO"));
  Logger.log("Repositório: " + cfg.repo + " · branch: " + cfg.ref);
  if (!cfg.githubToken) return;
  var resp = UrlFetchApp.fetch("https://api.github.com/repos/" + cfg.repo + "/actions/workflows", {
    headers: cabecalhosGithub_(cfg.githubToken),
    muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  if (codigo !== 200) {
    Logger.log("GitHub: ERRO " + codigo + " — confira a chave (repositório certo e Actions: Read and write). " +
      resp.getContentText().slice(0, 200));
    return;
  }
  var nomes = (JSON.parse(resp.getContentText()).workflows || []).map(function (w) { return w.path; });
  Logger.log("GitHub: chave ok. Workflows: " + nomes.join(", "));
  Logger.log(nomes.indexOf(".github/workflows/gerar-folhas.yml") >= 0
    ? "gerar-folhas.yml encontrado — tudo pronto."
    : "gerar-folhas.yml ainda não está no repositório (normal até a próxima atualização do site).");
}
