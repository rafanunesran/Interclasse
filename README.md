# Camisetas Interclasse

Site para representantes de time cadastrarem a lista de camisetas do interclasse (nome do estudante, tamanho, número e nome na camiseta), conferirem e fecharem o pedido. O administrador acompanha todos os times e exporta um CSV geral para usar no CorelDraw.

Os pedidos são **separados por cliente**: cada cliente (uma escola, uma empresa, uma organização) tem os seus próprios times, e um seletor no topo do painel mostra um cliente de cada vez — lista, Kanban, financeiro e CSVs, tudo junto. Veja [Clientes](#clientes-separação-dos-pedidos).

Funciona 100% no navegador (HTML/CSS/JS puro) hospedado no GitHub Pages, usando o **Firebase (Firestore)** como banco de dados na nuvem, gratuito.

## Como funciona

- **`index.html`** — lista os clientes; ao escolher um (`index.html?cliente=ID-DO-CLIENTE`), mostra os times daquele cliente. Sem nenhum cliente cadastrado, lista direto todos os times.
- **`time.html?id=NOME-DO-TIME`** — página do representante: digita a senha do time, cadastra/edita/remove alunos, vê o resumo por tamanho, exporta CSV e fecha o pedido.
- **`admin.html`** — página de **login** do administrador (e-mail/senha do Firebase Authentication). O acesso fica num link discreto no rodapé de cada página ("Área administrativa"). Ao entrar com a conta administradora, o site leva automaticamente para o Super Admin.
- **`turma.html`** — endereço antigo da página do pedido, mantido só como redirecionamento para `time.html` (os links já compartilhados com os representantes continuam funcionando).
- **`superadmin.html`** — **Super Admin**: cadastra os clientes, cria times (com senha própria para cada um), controla o **status do pedido** (Aberto → Fechado → Pagamento em andamento → Pagamento encerrado → Impressão → Costura → Logística → Entregue ao representante) por um seletor em cada time, edita qualquer time e exporta os CSVs gerais (produção e conferência). Só o Super Admin muda o status (a única exceção é o fechamento automático pela data limite). Também é onde se ajustam os **preços** (geral e o preço próprio de cada time), os **tamanhos de camiseta** e as **configurações gerais** (título do evento, texto do rodapé e um interruptor para abrir/fechar os cadastros de todos os times de uma vez). É uma página protegida: quem não estiver logado como administrador é mandado de volta para o login.

O **painel administrativo** é protegido por login de verdade (Firebase Authentication, e-mail/senha), e as regras do Firestore só deixam a conta administradora criar times e alterar tamanhos/configurações. Já a **senha de cada time** é uma proteção simples conferida no site, apenas para evitar edições por engano ou por curiosos — não é um sistema com dados sigilosos.

## Passo a passo da configuração

### 1. Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e crie um projeto novo (pode desativar o Google Analytics, não é necessário).
2. No menu lateral, vá em **Compilação > Firestore Database** → **Criar banco de dados** → escolha **modo de produção** → selecione uma localização (ex: `southamerica-east1`).
3. Ainda no menu lateral, vá em **Compilação > Authentication** → aba **Sign-in method** e ative **dois** provedores:
   - **Anônimo** — usado automaticamente pelas páginas do aluno (início e time) para gravar os pedidos.
   - **E-mail/senha** — usado no login do painel administrativo.

### 2. Conectar o site ao seu projeto Firebase

1. No console do Firebase, clique no ícone de engrenagem → **Configurações do projeto**.
2. Em **Seus aplicativos**, clique no ícone `</>` (Web) para registrar um app da Web. Dê um nome qualquer (ex: "site interclasse") e clique em registrar.
3. O Firebase vai mostrar um objeto `firebaseConfig` com `apiKey`, `authDomain`, `projectId`, etc.
4. Abra o arquivo **`js/firebase-config.js`** deste projeto e substitua os valores de exemplo pelos valores reais que o Firebase mostrou.

### 3. Publicar as regras de segurança

1. No console do Firebase, vá em **Firestore Database > Regras**.
2. Apague o conteúdo e cole o conteúdo do arquivo **`firestore.rules`** deste projeto.
3. Clique em **Publicar**.

### 4. Criar a conta do administrador (e-mail/senha)

O painel administrativo usa o **login do Firebase Authentication** (e-mail/senha). A senha fica guardada com segurança no Firebase — nunca no código do site. Crie a conta uma única vez:

1. No console do Firebase, vá em **Compilação > Authentication > Users**.
2. Clique em **Adicionar usuário**.
3. Informe o **e-mail** e a **senha** do administrador e salve.
4. Esse e-mail precisa ser o mesmo em dois lugares do projeto (já configurado neste repositório, mas confira se você mudar de e-mail):
   - a constante `MASTER_EMAIL` em **`js/admin.js`**;
   - a função `ehAdmin()` em **`firestore.rules`** (e republique as regras depois de alterar).

> Para trocar a senha depois, use **Authentication > Users** (menu de cada usuário) ou o link "Esqueci a senha". Não há senha no código para editar.

### 5. Publicar no GitHub Pages

1. Crie um repositório novo no GitHub e suba todos os arquivos deste projeto (`index.html`, `time.html`, `admin.html`, `superadmin.html`, as pastas `css/` e `js/`).
2. No repositório, vá em **Settings > Pages**.
3. Em **Source**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`. Salve.
4. Aguarde alguns minutos — o GitHub vai mostrar o link do site publicado (algo como `https://seuusuario.github.io/nome-do-repositorio/`).

### 6. Criar os clientes, os times e começar a usar

1. Acesse `SEU-SITE/admin.html` (ou clique em "Área administrativa" no rodapé) e entre com o **e-mail e a senha** do administrador (a conta que você criou no passo 4). O site leva você automaticamente para o **Super Admin** (`superadmin.html`).
2. Na aba **Clientes**, cadastre quem está fazendo o pedido (ex: "Colégio Santa Rita"). Se você atende um cliente só, dá para pular — sem clientes cadastrados o site funciona como antes.
3. Em **Criar novo time**, cadastre cada time com um nome (ex: "3º Ano A - Manhã"), uma senha própria para ele e o cliente a que ele pertence.
4. Compartilhe com cada representante o link do time (`SEU-SITE/time.html?id=ID-DO-TIME`, mostrado após criar) e a senha correspondente. Eles também conseguem chegar lá pela página inicial (`index.html`) — que lista os clientes — ou direto pelo link do cliente (`SEU-SITE/index.html?cliente=ID-DO-CLIENTE`).
5. Cada representante cadastra os alunos e confere a lista (o site avisa se houver números de camiseta duplicados). O representante pode definir uma **data limite para pagamento**: ao passar dessa data, o pedido **fecha automaticamente**. Se não definir data, o time fica **Aberto** até o Super Admin fechar/avançar o status.
6. No painel admin, acompanhe o status de todos os times (use o seletor **Cliente** no topo para ver um cliente por vez). Ao mover o pedido para **Impressão**, a lista se separa entre o que foi pago (vai para a produção) e o que não foi (fica pendente). Clique em **Exportar CSV de produção** para baixar, num arquivo só, as camisetas pagas de todos os times no padrão do programa de impressão.

## Clientes (separação dos pedidos)

Cada **time** pertence a um **cliente** — quem faz o pedido. É assim que os pedidos de
clientes diferentes ficam separados, sem se misturarem em nenhuma tela.

- **Cadastrar:** Super Admin → aba **Clientes** → *Novo cliente* (nome e, se quiser, um
  contato). Dá para editar e excluir depois. A exclusão só é permitida quando o cliente
  não tem mais nenhum time — mova os times antes, pelo botão **Editar time**.
- **Vincular um time:** o cliente é escolhido no formulário **Criar novo time** e pode ser
  trocado a qualquer momento em **Editar time**. Time sem cliente continua funcionando e
  aparece agrupado como **Sem cliente**.
- **Ver um cliente de cada vez:** o seletor **Cliente**, no topo do painel, vale para o
  Super Admin inteiro — lista de times, Kanban, Financeiro, resumo de pagamentos e as
  exportações. Com um cliente escolhido, os CSVs saem só com os dados dele e o nome do
  arquivo ganha o cliente no fim (ex.: `producao-interclasse-geral-colegio-alfa.csv`).
- **Link do cliente:** `index.html?cliente=ID-DO-CLIENTE` abre a tela inicial já com os
  times daquele cliente — é o link para compartilhar com ele. Sem o parâmetro, a tela
  inicial mostra a lista de clientes para escolher.
- **No Financeiro**, com mais de um cliente na conta, a *Visão geral* ganha o quadro
  **Por cliente** (previsto, recebido, a receber, % e lucro) e a tabela por time ganha a
  coluna do cliente. Os CSVs do Financeiro e o de conferência também trazem o cliente.

> No Firestore os times continuam na coleção `turmas` (o nome antigo), para não quebrar os
> dados já cadastrados; os clientes ficam em `clientes`. O nome da coleção fica isolado na
> constante `COL_TIMES` (`js/utils.js` e `mp-backend/lib/firebase.js`). Depois de atualizar,
> **republique o `firestore.rules`** no console do Firebase — a versão anterior não conhecia
> a coleção `clientes`.

## Aba Financeiro (Super Admin)

A aba **Financeiro** tem cinco visões, escolhidas pelas sub-abas no topo. Todas usam o preço em vigor em cada time (a tabela geral da aba **Pagamentos** ou o [preço personalizado do time](#preço-personalizado-por-time)) e os custos de impressão/costureira por grupo (aba **Tamanhos**), e atualizam em tempo real conforme os pagamentos entram.

- **Visão geral** — previsto, recebido e a receber; percentual recebido; custos e lucro (previsto e realizado); quanto entrou hoje e nos últimos 7 dias; e o resumo por time.
- **Extrato diário** — o que entrou em cada dia, com quantidade, PIX, dinheiro, total do dia e acumulado no período. Clique num dia para abrir a lista de pagamentos daquele dia (hora, aluno, time, tamanho e forma).
- **Evolução** — hoje, ontem, últimos 7 dias (com a variação em relação aos 7 anteriores), gráfico de entradas por dia, fechamento por semana e a projeção de quando o valor em aberto termina de entrar, no ritmo atual.
- **A receber** — fila de conferência dos alunos que avisaram que pagaram (com botão para confirmar o recebimento), tempo em aberto das pendências por faixa (até 3 dias, 4 a 7, 8 a 15, mais de 15), pendências por time e as maiores pendências individuais.
- **Resultado (DRE)** — demonstrativo da receita menos os custos (impressão, costureira e as camisetas internas), lucro previsto e realizado, margem, ticket médio, custo médio unitário e a rentabilidade por time e por grupo de tamanho.

O **Extrato diário** e a **Evolução** têm filtro de período (hoje, 7 dias, 30 dias, tudo ou um intervalo personalizado) e filtro por time; a visão **A receber** tem só o filtro por time, porque mostra sempre a situação de hoje.

O botão **Exportar CSV da visão** baixa exatamente a visão aberta: resumo por time (`financeiro-interclasse.csv`), extrato analítico com uma linha por pagamento (`extrato-recebimentos.csv`), consolidado por dia (`recebimentos-por-dia.csv`), pendências (`a-receber-interclasse.csv`) ou o DRE completo (`resultado-interclasse.csv`).

> O extrato por dia usa a data em que o pagamento foi confirmado. Pagamentos confirmados antes de o sistema passar a gravar essa data aparecem num aviso à parte, fora do agrupamento por dia (mas continuam somando no total recebido).

## Sobre os CSVs exportados

São dois formatos, com finalidades diferentes.

### CSV de produção (o que vai para a impressão)

É o arquivo que o programa de impressão importa. **Só entram as camisetas pagas** — ver
[Produção: pago x pendente](#produção-pago-x-pendente) logo abaixo.

- **Sem linha de cabeçalho**: a primeira linha já é a primeira camiseta.
- Coluna **A: nome na camiseta** (o que vai estampado nas costas; se estiver vazio, usa o
  nome do estudante), **B: número**, **C: tamanho**.
- Separador **vírgula**, UTF-8 **sem BOM** — o BOM grudaria no primeiro nome do arquivo.
- Arquivos: `producao-<time>.csv` (por time) e `producao-interclasse-geral.csv` (todos).

```csv
ANINHA,10,M
"Carla, a Craque",3,P
BRUNO,7,G
```

> Valores com vírgula ou aspas saem entre aspas, como manda o padrão CSV.

### CSV de conferência (a lista completa)

Continua igual ao de antes, para conferir o pedido e os pagamentos.

- Colunas: `Cliente`, `Time`, `Nome do Estudante`, `Tamanho`, `Numero`,
  `Nome na Camiseta`, `Pago`, `Forma Pagto`.
- Separador `;` e codificação UTF-8 com BOM — abre corretamente no Excel, sem problemas de
  acentuação.
- É o que o representante baixa na página do time, e o que o Super Admin baixa nos botões
  **CSV de conferência**.

## Produção: pago x pendente

Quando o Super Admin move o pedido para **Impressão** (e nas etapas seguintes — Costura,
Logística, Entregue), a lista se separa em duas:

- **Em produção**: quem já pagou (a camiseta *interna* conta como paga).
- **Fora da produção**: quem não pagou fica **pendente** e não é produzido nesta leva. A
  linha aparece marcada e esmaecida na lista, tanto na página do time quanto no Super
  Admin, e a página do time explica a situação num aviso.

A separação é sempre calculada na hora, a partir do pagamento: se um pendente pagar depois
(o Super Admin confirma o pagamento na lista), ele entra na produção e passa a sair no CSV
na próxima exportação.

## Tamanhos disponíveis

Tamanhos padrão (usados enquanto nada foi salvo no painel):

- Infantil: 10, 12, 14, 16
- Normal: P, M, G, GG
- Plus Size: G1, G2, G3, G4

Para alterar essa lista, use a seção **Tamanhos de camiseta** no painel administrativo (`admin.html`): dá para criar/remover grupos, adicionar/remover tamanhos e restaurar o padrão. O que for salvo fica em `config/tamanhos` no Firestore e passa a valer no cadastro de todos os times. O array `TAMANHOS_PADRAO` em `js/utils.js` continua servindo como fallback caso nada tenha sido salvo ainda.

### Imagem de referência de medidas (por grupo)

Cada grupo (Infantil, Normal, Plus Size…) pode ter uma **imagem de referência de medidas**
— normalmente a tabela de medidas daquele grupo. Ela é enviada no próprio grupo, na aba
**Tamanhos**, e fica guardada em `config/tamanhos` (campo `imagemUrl` do grupo).

- Precisa da URL do Apps Script configurada (a mesma das imagens da camiseta).
- O envio para o Drive acontece na hora, mas o vínculo com o grupo **só vale depois de
  clicar em "Salvar tamanhos"** — o botão salva o editor inteiro de uma vez.
- Na página de cada pedido, essas imagens entram na **galeria do topo**, logo depois da
  simulação e da arte, com o nome do grupo e seus tamanhos na legenda. Grupos sem imagem
  simplesmente não aparecem.
- A tabela de medidas **nunca** recebe marca d'água: ela é informação para o aluno escolher
  o tamanho.

> **Importante:** o painel grava em `config/geral` e `config/tamanhos`. Se você configurou o Firestore antes desta versão, republique as regras (`firestore.rules`) no console do Firebase — a versão anterior bloqueava toda escrita em `config/`.

## Pagamento por PIX

Nos times com o **pedido fechado**, cada linha (ainda não paga) ganha um botão **"Pagar"** que abre o pagamento PIX com o valor da camiseta. Para pagar várias de uma vez, use o [carrinho](#carrinho-pagar-várias-camisetas-de-uma-vez) — sem login, sem cadastro.

Para configurar, entre no **Super Admin → Pagamento (PIX)** e preencha:

- **Chave PIX** — e-mail, telefone, CPF/CNPJ ou chave aleatória da conta que vai receber.
- **Nome do recebedor** (máx. 25 caracteres) e **Cidade** (máx. 15) — como no seu cadastro bancário.
- **Preço por grupo de tamanho (geral)** — um valor para cada grupo (ex.: Normal R$ 45, Plus Size R$ 55). O valor cobrado em cada linha é o do grupo do tamanho daquele aluno. Se um grupo ficar sem preço, o PIX é gerado sem valor (o pagador digita no app). Esse é o preço **padrão**, usado por todos os times que não tiverem um preço próprio — ver [Preço personalizado por time](#preço-personalizado-por-time).

### Preço personalizado por time

Dá para cobrar um valor diferente em um time específico (patrocínio, tecido
diferente, time que fechou em outra data…), sem mexer no preço dos outros.

1. No **Super Admin → Inicial**, abra o card do time e clique em **"Preço da camiseta neste time"**.
2. Preencha só os grupos que devem mudar (ex.: Normal R$ 50) e clique em **Salvar preços do time**.
3. Os grupos deixados **em branco** continuam usando o preço geral da aba Pagamentos — cada campo mostra qual é esse valor ("Geral: R$ 45,00").

O botão **"Usar a tabela geral"** apaga os preços próprios do time de uma vez.
Ao excluir um time, os preços dele são apagados junto.

O preço personalizado vale em todo o sistema:

- no **PIX** (estático e Mercado Pago) gerado na página do time — o valor no botão "Pagar" já é o do time;
- no **Financeiro** inteiro (previsto, recebido, a receber, extrato, DRE, rentabilidade por time);
- na página do pedido, numa linha logo abaixo do status ("Valor da camiseta — Normal: R$ 50,00 · …").

Para conferir tudo de uma vez, a aba **Pagamentos** tem a tabela **"Preço em vigor por time"**:
uma linha por time, uma coluna por grupo, com os preços próprios em destaque e os da tabela
geral em cinza.

> Onde ficam guardados: em `config/geral`, no campo `precosPorTime` (`{ "id-do-time": { "Normal": 50 } }`).
> É de propósito: `config/geral` só pode ser gravado pela conta administradora, então o
> representante do time não consegue alterar o próprio preço — nem no site, nem na cobrança
> do Mercado Pago, que também calcula o valor a partir desse documento.
>
> O campo se chamava `precosPorTurma` antes da renomeação. O site continua **lendo** o nome
> antigo (para não perder o que já foi salvo) e **grava nos dois**, para o backend do
> Mercado Pago ainda não republicado continuar cobrando o valor certo.

### Carrinho: pagar várias camisetas de uma vez

Quem vai pagar não precisa fazer uma cobrança por camiseta. Na lista do pedido, cada
camiseta ainda não paga tem a caixinha **"somar"** na coluna **Carrinho**: marque quantas
quiser e a barra no rodapé mostra a quantidade e o total, com o botão **Pagar**.

- **Sem login e sem cadastro.** O carrinho é só uma lista guardada no navegador de quem
  está pagando (`localStorage`), então cada pessoa tem o seu: dois pais pagando pelo mesmo
  link, cada um no seu celular, não se atrapalham. Ele sobrevive a recarregar a página e
  some sozinho quando as camisetas são pagas.
- **PIX (padrão):** sai **um** QR Code / copia e cola com a **soma** das camisetas
  escolhidas. O botão **"Já paguei as N camisetas"** avisa a organização de todas de uma
  vez (elas ficam *Aguardando confirmação*, e você confirma cada uma no Super Admin).
- **Mercado Pago (opcional):** sai **uma** cobrança com um item por camiseta — o pagador vê
  a lista na tela do Mercado Pago. Quando o PIX cai, o webhook marca **todas** como pagas.
- O botão **Pagar** de cada linha continua ali para quem quer pagar só aquela camiseta.
- Uma camiseta só entra no carrinho se puder ser paga agora: pedido na fase de pagamento,
  não suspenso, ainda não paga e **sem ajuste pendente** (ajuste em aberto trava o
  pagamento, como antes).

> Com o Mercado Pago ligado, a lista de camisetas de cada cobrança fica em `cobrancas` no
> Firestore — o campo de referência do Mercado Pago é curto demais para levar todos os ids.
> Essa coleção é **fechada para o site** (`firestore.rules`): só o backend escreve e lê
> nela, pelo Admin SDK. Cobranças criadas antes desta versão continuam sendo reconhecidas.

### Status de pagamento

Cada aluno tem um status: **Pendente**, **Aguardando confirmação** ou **Pago (PIX/dinheiro)**.

- **Pagamento em dinheiro:** você marca manualmente no Super Admin, na lista do time (aba **Inicial** → "Ver lista"), pelo seletor de pagamento de cada linha.
- **Pagamento por PIX:** como o PIX estático não avisa o site automaticamente, o pagante clica em **"Já fiz o pagamento"** no modal do PIX (fica *Aguardando confirmação*); você confere na sua conta e confirma marcando **Pago (PIX)** no seletor. Se ele pagou várias de uma vez pelo [carrinho](#carrinho-pagar-várias-camisetas-de-uma-vez), todas ficam aguardando juntas — confirme uma a uma na lista.
- O CSV exportado inclui as colunas `Pago` e `Forma Pagto`.

### Confirmação automática (Mercado Pago) — opcional

Dá para o status virar **Pago** sozinho quando o PIX cai, sem clique. Para isso há um backend
serverless em [`mp-backend/`](mp-backend/README.md) (roda de graça na Vercel, sem cartão) que
cria a cobrança no **Mercado Pago** e recebe o **webhook** de confirmação, gravando o
pagamento no Firestore.

- Ative em **Super Admin → Pagamentos** marcando "Ativar confirmação automática (Mercado
  Pago)" e informando a URL do backend na Vercel. O passo a passo completo (Mercado Pago,
  service account do Firebase e deploy na Vercel) está em `mp-backend/README.md`.
- **Desligado** (padrão), continua tudo como antes: PIX estático direto (grátis, sem taxa) +
  auto-declaração + confirmação manual.
- **Ligado**, o Mercado Pago cobra ~0,99% por PIX recebido e o dinheiro passa pela conta MP.

O Super Admin é organizado em abas: **Inicial** (criar times e lista de times), **Clientes**, **Kanban**, **Financeiro**, **Tamanhos**, **Pagamentos** e **Configurações** (gerais + exportar).

Detalhes técnicos:

- O código PIX ("copia e cola") é gerado **no próprio site** (padrão EMV/BR Code do Banco Central, com CRC16) — nenhum dado de pagamento passa por terceiros.
- A **imagem** do QR Code é renderizada por um serviço externo (`api.qrserver.com`) apenas para desenhar o quadradinho; se preferir 100% offline, dá para trocar por uma biblioteca embutida — é só pedir.
- Os dados de pagamento ficam em `config/geral` (só o admin grava; leitura é pública, como o resto).

## Imagens da camiseta (Google Drive)

Cada time pode ter **duas imagens** de referência, que aparecem na página do time (e a
primeira delas também no card da tela inicial):

- **Simulação na camiseta** (campo `imagemUrl`) — a foto/mockup do que será produzido.
- **Arte (sem simulação)** (campo `arteUrl`) — a arte pura, do jeito que foi desenhada, sem
  a camiseta em volta.

As duas são independentes: dá para ter só uma, as duas ou nenhuma. Se o time tiver apenas a
arte, ela é usada como capa no card da tela inicial. Como o Firebase Storage exige plano pago,
as imagens ficam no **seu Google Drive** via um **Google Apps Script** gratuito.

Na página do pedido elas ficam numa **galeria deslizante** junto com as imagens de medidas
de cada grupo de tamanhos (ver [Imagem de referência de medidas](#imagem-de-referência-de-medidas-por-grupo)):
arrasta para o lado no celular, setas no computador.

- Publique o Apps Script e cole a URL em **Super Admin → Configurações**. Passo a passo em
  [`apps-script/README.md`](apps-script/README.md).
- Depois, em cada time (Super Admin → Inicial), use **"Enviar simulação da camiseta"** e/ou
  **"Enviar arte (sem simulação)"**.
- No Firestore fica guardada só a **URL** de cada imagem; os arquivos ficam no seu Drive
  (`camiseta-<time>.jpg` e `arte-<time>.jpg`).
- A **marca d'água de referência** é um único interruptor por time e vale para as duas
  imagens. Ela é apenas uma camada sobreposta na exibição — os arquivos enviados não são
  alterados.
- Na página do pedido, **clicar em qualquer imagem abre ela ampliada** (fecha no ×, clicando
  fora ou com Esc; passa de uma para outra pelas setas na tela ou pelas setas ← → do
  teclado). A marca d'água acompanha a ampliação, então ampliar não é um jeito de contornar
  a proteção.

## Limitações conhecidas

- A proteção por senha de time/admin é feita no site (não no banco de dados), então é uma barreira de conveniência, não uma segurança forte. Não cadastre informações sensíveis além do necessário para o pedido.
- A separação por cliente é **organizacional**, não é controle de acesso: a leitura continua pública, então quem tiver o link consegue abrir a lista de clientes e ver os times de qualquer um deles. Ela serve para organizar o trabalho (e os relatórios) de cada cliente, não para esconder um cliente do outro.
- Exclusão de aluno **pelo representante** (na página do time) é sempre "suave" (o registro fica marcado como removido, mas não desaparece do banco) — isso é proposital, para evitar perda de dados por engano.
- No Super Admin dá para **editar** (nome e senha) e **excluir** um time. A exclusão do time é definitiva: apaga o time e todas as camisetas cadastradas nele (essa exclusão de verdade só é permitida para a conta administradora).
- O plano gratuito do Firebase (Spark) é mais do que suficiente para o volume de um interclasse escolar.
