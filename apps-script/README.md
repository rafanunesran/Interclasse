# Imagem da camiseta via Google Drive + Apps Script

Alternativa **gratuita** ao Firebase Storage (que exige plano pago) para guardar a imagem da
camiseta de cada time. O Apps Script recebe a imagem do site, salva no seu Google Drive
(arquivo público) e devolve a URL que o site usa para exibir.

## Publicar o Apps Script

1. Acesse **https://script.google.com** → **Novo projeto**.
2. Apague o conteúdo e cole o código de [`Codigo.gs`](Codigo.gs). Salve.
3. Clique em **Implantar → Nova implantação**.
4. Em **Tipo**, escolha **App da Web**.
5. Configure:
   - **Executar como:** Eu (sua conta).
   - **Quem tem acesso:** **Qualquer pessoa**.
6. Clique em **Implantar** e **autorize** o acesso ao seu Drive (é normal aparecer um aviso do
   Google; avance em "Avançado → Acessar o projeto").
7. Copie a **URL do app da Web** (termina em `/exec`).

## Ligar no site

No **Super Admin → aba Configurações**, cole essa URL no campo **"URL do Apps Script (imagens)"**
e salve.

## Como usar

No **Super Admin → aba Inicial**, em cada time há o botão **"Enviar imagem da camiseta"**.
Ao escolher uma foto, ela é enviada ao seu Drive e passa a aparecer:
- no **card do time** (tela inicial),
- na **página do time** (referência para os alunos),
- no próprio card do Super Admin.

O site reduz a imagem para no máximo ~1200px antes de enviar (fica leve). As imagens ficam numa
pasta chamada **"Interclasse Camisetas"** no seu Drive.

## Observações

- Só a **URL** da imagem é guardada no Firestore (a imagem em si fica no seu Drive) — nada de
  plano pago do Firebase.
- Se um dia trocar o Apps Script, atualize a URL nas Configurações. Imagens já enviadas continuam
  funcionando (a URL aponta direto para o arquivo no Drive).

## Folha EPS (moldes, artes e fontes)

O mesmo script guarda os arquivos da **folha EPS** (moldes de corte, artes PNG 600 dpi, brasões
e fontes), **sem reduzir nada**, e os devolve ao site na hora de montar a folha
(`doGet?acao=arquivo&id=...`). Ele só entrega arquivos da pasta **"Interclasse Camisetas"**.
Arquivo maior que 20 MB vai em partes (cada parte é um arquivo `….parteNdeM` na pasta) — não
apague essas partes.

Se o seu script foi publicado antes dessa função, **atualize-o**: cole o `Codigo.gs` novo, e em
**Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. Assim
a URL continua a mesma e não precisa mudar nada nas Configurações.

## Backup diário dos dados

O mesmo projeto do Apps Script faz, **todo dia**, uma cópia de **todos** os dados do site no
Firestore — times, camisetas, pagamentos, clientes, preços, tamanhos, configurações, layout,
levas de produção e cobranças — e salva um arquivo `.json` na pasta **privada**
**"Interclasse Backups"** do seu Drive (ela não fica pública, ao contrário da pasta das imagens).

**Guarda (nunca apaga sem confirmar):**
- o script **nunca apaga** um backup sozinho;
- os backups dos **últimos 30 dias** são protegidos: nem pelo site dá para apagá-los;
- os com **mais de 30 dias** continuam guardados; você recebe um e-mail de aviso (no máximo um
  por semana) e decide no **Super Admin → aba Backup**, marcando e confirmando (é preciso
  digitar `EXCLUIR`). Mesmo assim eles vão para a **lixeira do Drive**, recuperáveis por mais
  30 dias;
- se o backup diário falhar, chega um e-mail avisando.

### Ativar (uma vez só)

1. Abra o seu projeto em **https://script.google.com**.
2. Em **Configurações do projeto** (engrenagem), marque **"Mostrar o arquivo de manifesto
   appsscript.json no editor"**.
3. No editor, o projeto fica com **só dois arquivos**: substitua todo o conteúdo de `Codigo.gs`
   pelo de [`Codigo.gs`](Codigo.gs) (imagens + backup, tudo junto) e o de `appsscript.json` pelo
   de [`appsscript.json`](appsscript.json). Se você já tinha criado um `Backup.gs` no projeto,
   **exclua-o** (senão as funções ficam duplicadas e dá erro). Salve.
4. No topo, escolha a função **`instalarBackupDiario`** e clique em **▶ Executar**. Autorize os
   acessos pedidos (Drive, Firestore, e-mail e gatilhos). Isso liga o backup todo dia por volta
   das 3h.
5. Rode também **`backupAgora`** para fazer o primeiro backup e conferir que funciona (a pasta
   "Interclasse Backups" aparece no Drive).
6. **Atualize a implantação** para o site enxergar o backup: **Implantar → Gerenciar
   implantações → editar (lápis) → Versão: Nova versão → Implantar**. A URL continua a mesma.

> O acesso ao Firestore usa a **sua conta Google**, que precisa ser a dona (ou editora) do
> projeto Firebase `interclasse-e2854` — é a conta que criou o projeto. Não há chave nem senha
> no código. Se o `backupAgora` der erro dizendo que a **Cloud Firestore API** não está ativada
> num projeto com outro número, vá em **Configurações do projeto → Projeto do Google Cloud** e
> troque para o número do projeto do Firebase (Firebase → Configurações do projeto → "Número do
> projeto").

### Restaurar

- **Pelo site:** Super Admin → aba **Backup** → **Restaurar…** no backup desejado. Dá para
  restaurar **tudo** ou **só um time** (com as camisetas dele). É preciso digitar `RESTAURAR`.
  Antes de gravar, o script faz um backup **"antes de restaurar"** do estado atual — dá para
  desfazer. Os dados escolhidos voltam a ser como no backup; o que foi criado depois não é
  apagado.
- **De um arquivo baixado:** botão **Restaurar de um arquivo…** na mesma aba (útil se o Drive
  tiver algum problema — por isso vale baixar um backup de vez em quando pelo botão **Baixar**).
- **Sem o site (emergência):** no editor do Apps Script, abra `Codigo.gs`, preencha o nome do
  arquivo em `restaurarPeloEditor` e rode essa função.

> Os arquivos de arte, moldes e imagens já ficam no seu Drive (pasta "Interclasse Camisetas");
> o backup guarda as referências a eles. Não apague essa pasta.
