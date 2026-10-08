/**
 * Interclasse - Uploader de imagem da camiseta (Google Apps Script)
 *
 * Recebe uma imagem (base64) do site, salva no Google Drive numa pasta,
 * deixa o arquivo publico (qualquer um com o link pode ver) e devolve a
 * URL para exibir no <img>. Tambem guarda os arquivos das artes de
 * producao (EPS, PNG em alta, fontes) e os devolve ao site (doGet). Serve como alternativa gratuita ao Firebase
 * Storage (que exige plano pago).
 *
 * Mais abaixo, neste mesmo arquivo, fica o BACKUP DIARIO dos dados.
 *
 * Como publicar: veja apps-script/README.md.
 */

// Versao deste codigo. Abrindo a URL do app da Web (/exec) no navegador, ela
// aparece na resposta - e o jeito de conferir se a implantacao esta atualizada.
var VERSAO_SCRIPT = "2026-10-09-copia";

// Nome da pasta no seu Drive onde as imagens ficam (criada automaticamente).
var NOME_PASTA = "Interclasse Camisetas";

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    // Acoes do backup (aba Backup do Super Admin) - ver a parte de backup, mais abaixo.
    if (dados.acao && String(dados.acao).indexOf("backup") === 0) return json_(rotearBackup_(dados));
    // Geracao na nuvem (js/nuvem.js e a maquina do GitHub) - ver o fim do arquivo.
    if (dados.acao === "nuvem") return json_(dispararNuvem_(dados));
    if (dados.acao === "sessaoUpload") return json_(sessaoUpload_(dados));
    if (dados.acao === "compartilhar") return json_(compartilhar_(dados));
    // Copia no Drive do que foi gerado no computador (js/nuvem.js).
    if (dados.acao === "copiaSessao") return json_(copiaSessao_(dados));
    if (dados.acao === "copiaPedaco") return json_(copiaPedaco_(dados));
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

// GET sem parametros: so confirma que o script esta no ar.
// GET ?acao=arquivo&id=ID: devolve o arquivo em base64. E assim que o site le
// os bytes das artes (EPS, PNG em alta, fontes) para montar a folha de
// impressao - o Drive nao deixa o navegador baixar o arquivo direto (CORS).
// So entrega arquivos da pasta do site, nunca outro arquivo do seu Drive.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.acao !== "arquivo") {
    // "versao" mostra qual codigo esta publicado (abra a URL /exec no navegador).
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
// BACKUP DIARIO
// ============================================================================
// ============================================================================

/**
 * Interclasse - Backup diario do Firestore (Google Apps Script)
 *
 * Todo dia o script le TODOS os dados do site no Firestore (times, camisetas,
 * clientes, configuracoes, levas de producao, cobrancas...) e salva uma copia
 * em JSON numa pasta PRIVADA do seu Google Drive ("Interclasse Backups").
 *
 * Regras de guarda:
 *   * o script NUNCA apaga um backup sozinho;
 *   * os backups dos ultimos 30 dias sao o historico protegido: nem com
 *     confirmacao eles podem ser apagados pelo site;
 *   * os mais antigos que 30 dias so saem quando o administrador confirma no
 *     Super Admin (aba Backup) - e vao para a LIXEIRA do Drive, onde ainda
 *     ficam recuperaveis por 30 dias. Enquanto houver backup antigo esperando
 *     confirmacao, o script manda um e-mail de aviso (no maximo 1 por semana).
 *
 * O acesso ao Firestore usa a SUA conta Google (a dona do projeto Firebase),
 * pelo token do proprio Apps Script - nao ha chave nem senha no codigo.
 *
 * Como ativar: veja apps-script/README.md (secao "Backup diario").
 */

// ---------------- Configuracao ----------------

var BACKUP_PROJETO = "interclasse-e2854";              // projectId do Firebase (js/firebase-config.js)
var BACKUP_API_KEY = "AIzaSyDK-jn3ksbaJiKrI6b_i0Yl0OUzSzBX2AY"; // apiKey do Firebase (e publica)
var BACKUP_EMAIL_ADMIN = "rafaelnf93@gmail.com";      // igual ao MASTER_EMAIL do site
var BACKUP_PASTA = "Interclasse Backups";
var BACKUP_DIAS_PROTEGIDOS = 30;
var BACKUP_HORA_DIARIA = 3;                           // 3h da manha (fuso do projeto)

var BACKUP_BASE = "https://firestore.googleapis.com/v1/projects/" + BACKUP_PROJETO +
  "/databases/(default)/documents";

// ============================================================
// FUNCOES PARA RODAR NO EDITOR (menu > Executar)
// ============================================================

// Rode UMA vez para ligar o backup diario (e autorizar o acesso).
function instalarBackupDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "backupDiario") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupDiario").timeBased().everyDays(1).atHour(BACKUP_HORA_DIARIA).create();
  Logger.log("Backup di\u00e1rio ligado (todo dia por volta das " + BACKUP_HORA_DIARIA + "h).");
}

// Faz um backup na hora (bom para testar).
function backupAgora() {
  var r = fazerBackup_("manual");
  Logger.log("Backup salvo: " + r.nome + " (" + r.totalDocumentos + " documentos)");
}

// EMERGENCIA - restaurar sem o site: escreva o nome do arquivo (como aparece
// na pasta "Interclasse Backups") e rode esta funcao. Antes de restaurar, o
// script salva um backup "antes-de-restaurar" do estado atual.
function restaurarPeloEditor() {
  var NOME_DO_ARQUIVO = ""; // ex.: "backup-interclasse-2026-09-25_0300-diario.json"
  if (!NOME_DO_ARQUIVO) throw new Error("Preencha NOME_DO_ARQUIVO dentro da fun\u00e7\u00e3o restaurarPeloEditor.");
  var it = obterPastaBackup_().getFilesByName(NOME_DO_ARQUIVO);
  if (!it.hasNext()) throw new Error("Arquivo n\u00e3o encontrado na pasta " + BACKUP_PASTA + ".");
  var r = restaurar_(lerBackupDoArquivo_(it.next()), "tudo");
  Logger.log("Restaurados " + r.restaurados + " documentos. Backup de seguran\u00e7a: " + r.backupSeguranca);
}

// Chamada pelo gatilho diario.
function backupDiario() {
  try {
    fazerBackup_("diario");
  } catch (err) {
    avisarPorEmail_(
      "\u26a0\ufe0f Backup do Interclasse FALHOU",
      "O backup di\u00e1rio do site n\u00e3o foi feito.\n\nErro: " + err + "\n\n" +
      "Abra o Apps Script e rode a fun\u00e7\u00e3o backupAgora para ver o detalhe."
    );
    throw err;
  }
  avisarBackupsAntigos_();
}

// ============================================================
// ENDPOINTS (chamados pelo Super Admin, via doPost em Codigo.gs)
// ============================================================

// Toda acao de backup exige o token de login da conta administradora.
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
    if (dados.confirmacao !== "RESTAURAR") throw new Error("Restaura\u00e7\u00e3o n\u00e3o confirmada.");
    var backup = dados.conteudo
      ? validarBackup_(JSON.parse(dados.conteudo))
      : lerBackupDoArquivo_(arquivoDeBackup_(dados.id));
    var res = restaurar_(backup, dados.escopo || "tudo");
    return { ok: true, restaurados: res.restaurados, backupSeguranca: res.backupSeguranca };
  }
  if (acao === "backupExcluirAntigos") {
    if (dados.confirmacao !== "EXCLUIR") throw new Error("Exclus\u00e3o n\u00e3o confirmada.");
    return excluirAntigos_(dados.ids || []);
  }
  throw new Error("A\u00e7\u00e3o de backup desconhecida: " + acao);
}

// Confere o token do Firebase Authentication e o e-mail da conta.
function verificarAdmin_(idToken) {
  if (!idToken) throw new Error("Fa\u00e7a login como administrador.");
  var r = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + BACKUP_API_KEY,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true }
  );
  var dados = JSON.parse(r.getContentText() || "{}");
  var usuario = dados.users && dados.users[0];
  if (r.getResponseCode() !== 200 || !usuario ||
      String(usuario.email || "").toLowerCase() !== BACKUP_EMAIL_ADMIN.toLowerCase()) {
    throw new Error("Acesso negado: s\u00f3 a conta administradora mexe nos backups.");
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
  arquivo.setDescription(tipo + " \u00b7 " + documentos.length + " documentos");
  return { nome: nome, id: arquivo.getId(), totalDocumentos: documentos.length };
}

// Le recursivamente as colecoes a partir de `pai` ("" = raiz).
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
        // Documento "fantasma" (so existe por ter subcolecao): nao tem campos.
        if (doc.fields || doc.createTime) {
          saida.push({ caminho: caminho, campos: doc.fields || {}, atualizadoEm: doc.updateTime || "" });
        }
        // Cobrancas nao tem subcolecoes: pular poupa centenas de chamadas.
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

// Chamada a API REST do Firestore com a conta dona do script. A cota vai para
// o projeto do Firebase (x-goog-user-project); se a conta nao puder usar esse
// cabecalho, tenta de novo sem ele.
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
  throw new Error("Esse arquivo n\u00e3o \u00e9 um backup do Interclasse.");
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

// So apaga (manda para a lixeira) backups com MAIS de 30 dias, e so os ids
// que o administrador confirmou. Os do historico protegido sao recusados.
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

// E-mail (no maximo 1 por semana) quando ha backups alem dos 30 dias
// esperando a confirmacao do administrador.
function avisarBackupsAntigos_() {
  var antigos = arquivosDeBackup_().filter(function (f) { return idadeEmDias_(f) > BACKUP_DIAS_PROTEGIDOS; });
  if (antigos.length === 0) return;
  var props = PropertiesService.getScriptProperties();
  var ultimo = Number(props.getProperty("avisoAntigosEm") || 0);
  if (Date.now() - ultimo < 7 * 86400000) return;
  avisarPorEmail_(
    "Interclasse: " + antigos.length + " backup(s) com mais de " + BACKUP_DIAS_PROTEGIDOS + " dias",
    "H\u00e1 " + antigos.length + " backup(s) com mais de " + BACKUP_DIAS_PROTEGIDOS + " dias na pasta \"" + BACKUP_PASTA + "\".\n\n" +
    "Eles N\u00c3O foram apagados. Se quiser liberar espa\u00e7o, confirme a exclus\u00e3o no Super Admin \u2192 aba Backup.\n" +
    "Se n\u00e3o fizer nada, eles continuam guardados."
  );
  props.setProperty("avisoAntigosEm", String(Date.now()));
}

function avisarPorEmail_(assunto, texto) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail() || BACKUP_EMAIL_ADMIN, assunto, texto);
  } catch (e) {
    Logger.log("N\u00e3o foi poss\u00edvel enviar o e-mail de aviso: " + e);
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
    throw new Error("Arquivo n\u00e3o \u00e9 um backup do Interclasse.");
  }
  return b;
}

// O que tem no backup: contagem por colecao e a lista de times.
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
// criados depois do backup NAO sao apagados. Antes de tudo, salva um backup
// "antes-de-restaurar" do estado atual - da para desfazer a restauracao.
//   escopo: "tudo" | "time:<id>"
function restaurar_(backup, escopo) {
  var docs = backup.documentos;
  if (escopo && escopo.indexOf("time:") === 0) {
    var id = escopo.slice(5);
    docs = docs.filter(function (d) {
      return d.caminho === "turmas/" + id || d.caminho.indexOf("turmas/" + id + "/") === 0;
    });
    if (docs.length === 0) throw new Error("Esse time n\u00e3o existe no backup.");
  } else if (escopo !== "tudo") {
    throw new Error("Escopo de restaura\u00e7\u00e3o inv\u00e1lido.");
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
// GERACAO NA NUVEM (folhas de impressao)
// ============================================================================
// ============================================================================
//
// O site cria um pedido (Firestore, colecao "trabalhos") e chama a acao
// "nuvem": aqui o pedido vira um disparo do GitHub Actions (workflow
// gerar-folhas.yml). A maquina do GitHub gera as folhas e, para cada arquivo,
// pede "sessaoUpload": este script cria a pasta
// "Interclasse Camisetas/Impressao/<lote>" e abre um envio retomavel no Drive;
// a maquina manda os bytes direto ao Google (arquivos grandes demais para
// passar por aqui). "sessaoUpload" e "compartilhar" exigem o WORKER_TOKEN.
//
// Propriedades do script (engrenagem -> Propriedades do script):
//   GITHUB_TOKEN  chave do GitHub (fine-grained, so o repositorio, Actions: leitura e escrita)
//   WORKER_TOKEN  senha da maquina - igual ao segredo WORKER_TOKEN do GitHub
//   GITHUB_REPO   (opcional) dono/repositorio - padrao rafanunesran/interclasse
//   GITHUB_REF    (opcional) branch - padrao main
// As chaves ficam SO nas Propriedades, nunca neste codigo.
//
// Depois de colar: rode testarNuvem (> Executar) e reimplante
// (Implantar -> Gerenciar implantacoes -> Editar -> Nova versao).

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

// Pedido do site: liga a maquina do GitHub para o trabalho informado.
function dispararNuvem_(dados) {
  try {
    var id = String(dados.trabalhoId || "");
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return { ok: false, erro: "Trabalho inv\u00e1lido." };
    var cfg = propsNuvem_();
    if (!cfg.githubToken) {
      return { ok: false, erro: "Falta a propriedade GITHUB_TOKEN no Apps Script (engrenagem \u2192 Propriedades do script)." };
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
    throw new Error("Token da m\u00e1quina inv\u00e1lido (confira o WORKER_TOKEN aqui e no GitHub).");
  }
}

// Pedido da maquina: abre o envio de um arquivo na pasta do lote.
function sessaoUpload_(dados) {
  try {
    exigirWorker_(dados);
    return abrirSessaoDrive_(dados.lote, dados.nome, dados.mimeType, dados.tamanho, "");
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// Cria a pasta "Impressao/<lote>" e abre um envio retomavel no Drive.
// `origem`: endereco do site, quando o proprio navegador manda os bytes
// (o Google libera o envio direto so para a origem informada aqui).
function abrirSessaoDrive_(lote, nome, mimeType, tamanho, origem) {
  lote = String(lote || "lote").replace(/[\\/]/g, "-").slice(0, 120);
  var pasta = subpasta_(subpasta_(obterPasta_(), "Impress\u00e3o"), lote);
  // Visivel por link: as previas em PNG aparecem no site.
  pasta.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var mime = String(mimeType || "application/octet-stream");
  var cab = { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": mime };
  if (tamanho) cab["X-Upload-Content-Length"] = String(tamanho);
  if (origem) cab.Origin = String(origem);
  var resp = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    payload: JSON.stringify({ name: String(nome || "arquivo"), parents: [pasta.getId()], mimeType: mime }),
    headers: cab,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    return { ok: false, erro: "Drive (" + resp.getResponseCode() + "): " + resp.getContentText().slice(0, 300) };
  }
  var h = resp.getAllHeaders();
  var url = h.Location || h.location;
  if (!url) return { ok: false, erro: "O Drive n\u00e3o devolveu o endere\u00e7o do envio." };
  return { ok: true, uploadUrl: url, pastaId: pasta.getId(), pastaUrl: pasta.getUrl() };
}

// ---------------- Copia no Drive (geracao no computador) ----------------
// O site gera o arquivo no navegador e guarda uma copia aqui. So o admin
// (token de login do Firebase, como no backup). O navegador manda os bytes
// direto ao Google; se o navegador bloquear, manda cada pedaco por aqui
// (copiaPedaco), que repassa ao Google.

function copiaSessao_(dados) {
  try {
    verificarAdmin_(dados.idToken);
    var origem = String(dados.origem || "");
    if (origem && !/^https?:\/\/[A-Za-z0-9.:-]+$/.test(origem)) origem = "";
    return abrirSessaoDrive_(dados.lote, dados.nome, dados.mimeType, dados.tamanho, origem);
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

function copiaPedaco_(dados) {
  try {
    verificarAdmin_(dados.idToken);
    var url = String(dados.uploadUrl || "");
    if (url.indexOf("https://www.googleapis.com/upload/drive/") !== 0) throw new Error("Endere\u00e7o de envio inv\u00e1lido.");
    var bytes = Utilities.base64Decode(dados.dataBase64 || "");
    var inicio = Number(dados.inicio) || 0;
    var total = Number(dados.total) || 0;
    var resp = UrlFetchApp.fetch(url, {
      method: "put",
      contentType: "application/octet-stream",
      payload: bytes,
      headers: { "Content-Range": "bytes " + inicio + "-" + (inicio + bytes.length - 1) + "/" + total },
      muteHttpExceptions: true
    });
    var codigo = resp.getResponseCode();
    if (codigo === 308) return { ok: true, status: 308 };
    if (codigo === 200 || codigo === 201) return { ok: true, status: codigo, id: JSON.parse(resp.getContentText() || "{}").id };
    return { ok: false, erro: "Drive (" + codigo + "): " + resp.getContentText().slice(0, 300) };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// Pedido da maquina: deixa os arquivos (previas) visiveis por link.
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

// Jeito facil de criar as Propriedades: cole as duas chaves entre as aspas,
// rode configurarChavesNuvem (> Executar) UMA vez e depois APAGUE as chaves
// daqui de novo (deixe as aspas vazias) e salve. As chaves ficam guardadas nas
// Propriedades do script, fora do codigo.
function configurarChavesNuvem() {
  var GITHUB_TOKEN = ""; // a chave do GitHub (comeca com github_pat_)
  var WORKER_TOKEN = ""; // a mesma senha do segredo WORKER_TOKEN do GitHub
  var props = PropertiesService.getScriptProperties();
  if (GITHUB_TOKEN) props.setProperty("GITHUB_TOKEN", GITHUB_TOKEN.trim());
  if (WORKER_TOKEN) props.setProperty("WORKER_TOKEN", WORKER_TOKEN.trim());
  if (!GITHUB_TOKEN && !WORKER_TOKEN) {
    Logger.log("Nada mudou: cole as chaves entre as aspas antes de executar.");
    return;
  }
  Logger.log("Chaves guardadas. Agora apague as chaves deste codigo, salve e rode testarNuvem.");
  testarNuvem();
}

// Rode no editor (> Executar -> testarNuvem) depois de criar as Propriedades.
// Nao dispara nada: so confere se as chaves estao la e se o GitHub aceita a
// chave. O resultado aparece no "Registro de execucao".
function testarNuvem() {
  var cfg = propsNuvem_();
  Logger.log("GITHUB_TOKEN: " + (cfg.githubToken ? "ok" : "FALTANDO"));
  Logger.log("WORKER_TOKEN: " + (cfg.workerToken ? "ok (" + cfg.workerToken.length + " caracteres)" : "FALTANDO"));
  Logger.log("Reposit\u00f3rio: " + cfg.repo + " \u00b7 branch: " + cfg.ref);
  if (!cfg.githubToken) return;
  var resp = UrlFetchApp.fetch("https://api.github.com/repos/" + cfg.repo + "/actions/workflows", {
    headers: cabecalhosGithub_(cfg.githubToken),
    muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  if (codigo !== 200) {
    Logger.log("GitHub: ERRO " + codigo + " \u2014 confira a chave (reposit\u00f3rio certo e Actions: Read and write). " +
      resp.getContentText().slice(0, 200));
    return;
  }
  var nomes = (JSON.parse(resp.getContentText()).workflows || []).map(function (w) { return w.path; });
  Logger.log("GitHub: chave ok. Workflows: " + nomes.join(", "));
  Logger.log(nomes.indexOf(".github/workflows/gerar-folhas.yml") >= 0
    ? "gerar-folhas.yml encontrado \u2014 tudo pronto."
    : "gerar-folhas.yml ainda n\u00e3o est\u00e1 no reposit\u00f3rio (normal at\u00e9 a pr\u00f3xima atualiza\u00e7\u00e3o do site).");
}
