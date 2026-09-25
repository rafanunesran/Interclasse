/**
 * Interclasse — Uploader de imagem da camiseta (Google Apps Script)
 *
 * Recebe uma imagem (base64) do site, salva no Google Drive numa pasta,
 * deixa o arquivo público (qualquer um com o link pode ver) e devolve a
 * URL para exibir no <img>. Também guarda os arquivos das artes de
 * produção (EPS, PNG em alta, fontes) e os devolve ao site (doGet). Serve como alternativa gratuita ao Firebase
 * Storage (que exige plano pago).
 *
 * Como publicar: veja apps-script/README.md.
 */

// Nome da pasta no seu Drive onde as imagens ficam (criada automaticamente).
var NOME_PASTA = "Interclasse Camisetas";

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
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
    return json_({ ok: true, msg: "Interclasse - uploader de imagem ativo." });
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
