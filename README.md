# Camisetas Interclasse

Site para representantes de time cadastrarem a lista de camisetas do interclasse (nome do estudante, tamanho, número e nome na camiseta), conferirem e fecharem o pedido. O administrador acompanha todos os times e exporta um CSV geral para usar no CorelDraw.

Os pedidos são **separados por cliente**: cada cliente (uma escola, uma empresa, uma organização) tem os seus próprios times, e um seletor no topo do painel mostra um cliente de cada vez — lista, Kanban, financeiro e CSVs, tudo junto. Veja [Clientes](#clientes-separação-dos-pedidos).

Funciona 100% no navegador (HTML/CSS/JS puro) hospedado no GitHub Pages, usando o **Firebase (Firestore)** como banco de dados na nuvem, gratuito.

## Como funciona

- **`index.html`** — a **loja**: todos os times em andamento numa vitrine (imagem da camiseta, preço e situação do pedido), com **filtro por escola/cliente** e busca pelo nome. O filtro vai para o endereço (`index.html?cliente=ID-DO-CLIENTE`), então o link de um cliente já abre só os times dele.
- **`time.html?id=NOME-DO-TIME`** — a **página do pedido**: imagem, preço, prazo e status no topo, e as abas **Lista** (com o botão **Pagar** e o carrinho) e **Tamanhos e preços** (tabela de medidas). O representante entra pela **engrenagem ⚙️** no canto superior direito, com a senha do time, e ganha as abas **+ Adicionar camiseta** e **Configurações** (data limite e sair do modo representante).
- **`admin.html`** — página de **login** do administrador (e-mail/senha do Firebase Authentication). O acesso fica num link discreto no rodapé de cada página ("Área administrativa"). Ao entrar com a conta administradora, o site leva automaticamente para o Super Admin.
- **`turma.html`** — endereço antigo da página do pedido, mantido só como redirecionamento para `time.html` (os links já compartilhados com os representantes continuam funcionando).
- **`superadmin.html`** — **Super Admin**: cadastra os clientes, cria times (com senha própria para cada um e o contato do representante), controla o **status do pedido** (Aberto → Fechado → Pagamento em andamento → Pagamento encerrado → Impressão → Costura → Logística → Entregue ao representante) por um seletor em cada time, edita qualquer time e exporta os CSVs gerais (produção e conferência). Na aba **Produção** dá para montar **levas** — escolher camiseta por camiseta, de times e clientes diferentes, acrescentar unidades avulsas (professores, reposição) e baixar **um CSV por modelo de camiseta** (ver [Aba Produção](#aba-produção-levas-e-um-csv-por-modelo)). Só o Super Admin muda o status (a única exceção é o fechamento automático pela data limite). Também é onde se ajustam os **preços** (geral e o preço próprio de cada time), os **tamanhos de camiseta** e as **configurações gerais** (título do evento, texto do rodapé e um interruptor para abrir/fechar os cadastros de todos os times de uma vez). É uma página protegida: quem não estiver logado como administrador é mandado de volta para o login.

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
6. No painel admin, acompanhe o status de todos os times (use o seletor **Cliente** no topo para ver um cliente por vez e a caixa **🔎 Buscar** para achar um pedido pelo time, pelo nome do estudante ou pelo apelido da camiseta). Faltou alguém na lista? O botão **+ Adicionar camiseta** (time aberto → aba Lista) resolve na hora, mesmo com o pedido fechado. Ao mover o pedido para **Impressão**, a lista se separa entre o que foi pago (vai para a produção) e o que não foi (fica pendente). Clique em **Exportar CSV de produção** para baixar, num arquivo só, as camisetas pagas de todos os times no padrão do programa de impressão.

## Aba Inicial do Super Admin (times)

A aba **Inicial** mostra só o essencial de cada pedido: o **nome do time** e o **representante**
(com o WhatsApp clicável), agrupados por cliente, com o status e avisos pequenos à direita
(ajustes pedidos, PIX a confirmar, camisetas achadas pela busca). **+ Novo time** abre o
formulário de criação; o time criado já abre na Configuração.

Clicar num time abre o pedido, com o status (seletor) sempre no topo e três abas:

- **Lista** — as camisetas, com **editar**, **registrar pagamento** (seletor por linha),
  aplicar/dispensar ajustes, excluir, **+ Adicionar camiseta** e os CSVs do time.
- **Configuração** — **representante** (nome, WhatsApp e **senha do time**, com os atalhos
  *Copiar link do pedido* e *Enviar link e senha no WhatsApp*), **data limite de pagamento**,
  nome/cliente/modelo do time, a **tabela especial de preço** e a exclusão do time. O que se
  digita fica como rascunho até **Salvar configuração**.
- **Arquivos de produção** — os arquivos da folha EPS (artes PNG, brasão e fonte), a
  **Prévia da arte** — *Arte (sem simulação)*, cada peça no molde com o layout da aba Artes, ou
  *Mockup na camiseta*, as peças vestidas numa camiseta (frente e costas, com a cor da malha
  escolhida) — e as imagens que o cliente vê na loja e na página do pedido.

O time aberto fica no endereço (`superadmin.html#time=ID&aba=config`): recarregar mantém a
tela e o "voltar" do navegador volta para a lista. No **Kanban**, clicar no nome do time abre
ele.

## Backup diário (aba Backup)

Todo dia o Apps Script salva uma cópia de **todos os dados** do site na pasta privada
**"Interclasse Backups"** do seu Google Drive. Os backups dos últimos **30 dias** são protegidos
e os mais antigos **nunca são apagados sem a sua confirmação**. No **Super Admin → Backup** dá
para ver a lista, fazer um backup na hora, baixar e **restaurar** (tudo ou só um time; antes de
restaurar é feito um backup de segurança). Como ativar e restaurar em caso de emergência:
[`apps-script/README.md`](apps-script/README.md#backup-diário-dos-dados).

## Contato do representante (WhatsApp)

Cada time pode guardar **quem responde por ele** — nome e WhatsApp — para a organização
falar com essa pessoa em um clique, sem procurar o telefone em outro lugar.

- **Onde cadastrar:** Super Admin → aba **Inicial**. No formulário **+ Novo time** (os
  campos são opcionais) ou depois, abrindo o time → **Configuração**.
- **Como usar:** no card do pedido, o **nome** e o **número** viram links — clicar em
  qualquer um dos dois abre a conversa no WhatsApp com a mensagem já escrita, citando o
  time e a situação atual do pedido (ex.: *"Olá, Ana! Aqui é da organização do interclasse,
  sobre o pedido de camisetas do time 3º Ano A (situação: Fechado)."*).
- O mesmo atalho aparece no card do **Kanban**, que é onde se acompanha o andamento dos
  pedidos — clicar no link não atrapalha o arraste do card.
- Informe o número **com DDD** (ex.: `(11) 91234-5678`). Se o número não servir para o
  WhatsApp, o contato aparece como texto simples, marcado com *(sem WhatsApp)* — melhor do
  que um link que não abre.

> O contato fica no próprio time (`representanteNome` e `representanteTelefone`) e é
> **visível só no painel administrativo**: a página pública do pedido não mostra o telefone
> de ninguém.

## Clientes (separação dos pedidos)

Cada **time** pertence a um **cliente** — quem faz o pedido. É assim que os pedidos de
clientes diferentes ficam separados, sem se misturarem em nenhuma tela.

- **Cadastrar:** Super Admin → aba **Clientes** → *Novo cliente* (nome e, se quiser, um
  contato). Dá para editar e excluir depois. A exclusão só é permitida quando o cliente
  não tem mais nenhum time — mova os times antes, pela **Configuração** do time.
- **Vincular um time:** o cliente é escolhido no formulário **Criar novo time** e pode ser
  trocado a qualquer momento na **Configuração** do time. Time sem cliente continua funcionando e
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

## Busca de pedidos (Super Admin)

A caixa **🔎 Buscar**, no topo do painel (logo acima do menu de abas, junto do seletor de
cliente), acha um pedido sem precisar abrir time por time.

- **Onde procura:** no **time** (nome, cliente, modelo e representante) e, dentro dele, em
  cada camiseta — **nome do estudante**, **apelido** (nome na camiseta) e **número**. A
  palavra `goleiro` junta todos os [goleiros](#goleiro-camiseta-de-cor-especial) de uma vez.
- **Onde vale:** na lista de times da aba **Inicial** e no **Kanban** — as telas de pedidos.
  As abas **Financeiro**, **Produção** e **Pagamentos** e as exportações continuam seguindo
  só o seletor **Cliente**, para os totais não mudarem por causa de uma busca.
- **Como escreve:** sem se preocupar com acentos nem com maiúsculas — `joao` acha "João" e
  `3o ano` acha "3º Ano A". Com **mais de uma palavra**, todas precisam bater, e elas podem
  vir de lugares diferentes: `3o maria` acha a Maria do 3º Ano A.
- **O que aparece:** só os pedidos que combinam. Quando quem combinou foi uma camiseta, o
  time aparece marcado com 🔎 e, ao abrir, a aba Lista mostra só as camisetas encontradas, com o aviso *"Mostrando 1
  de 3 camiseta(s)"* — o botão **Ver lista completa** abre o time inteiro, com as linhas
  encontradas em destaque. O resumo ao lado da caixa conta quantos pedidos e quantas
  camisetas a busca achou.
- **Para limpar:** o botão **Limpar**, o **×** do próprio campo ou a tecla **Esc**.

> A busca **soma** com o seletor **Cliente**: com um cliente escolhido, ela procura só
> dentro dos pedidos dele.

## Adicionar uma camiseta pelo Super Admin

O cadastro normal é feito pelo representante, na página do time, com a senha. Mas quase
sempre aparece **o nome que faltou** — e quase sempre depois de o pedido fechar. Para isso,
o card de cada time (aba **Inicial**) tem o botão **+ Adicionar camiseta**.

- Abre um formulário curto: **nome** e **tamanho** obrigatórios; número, nome na camiseta e
  a marca de [goleiro](#goleiro-camiseta-de-cor-especial) são opcionais. Deixando o *nome na
  camiseta* em branco, vai estampado o nome do estudante.
- **Funciona em qualquer status** — inclusive com o pedido fechado, suspenso ou bloqueado,
  que é justamente quando o esquecido aparece. Se o pedido já estiver em produção
  (Impressão em diante), o formulário avisa: a camiseta nova entra como pendente e **não
  está nos CSVs já exportados**.
- Se o **número** já for de outra pessoa do time, aparece um aviso na hora da digitação
  (dizendo de quem é) — mas não trava o cadastro, igual à conferência da página do time.
- Depois de salvar, o formulário **continua aberto e limpo**, para cadastrar um atrás do
  outro; o tamanho volta para *Selecione...* de propósito, para ninguém repetir sem querer
  o tamanho do anterior. Fecha no **×**, no **Esc** ou clicando fora.
- A camiseta entra como **pendente**; o pagamento se marca na coluna *Pagamento* da lista.

## Status do pedido

Cada time tem um **status**, mudado pelo Super Admin no card do pedido (aba **Inicial**) ou
arrastando o card no **Kanban**. A ordem normal é a linha do tempo do pedido:

**Aberto** → **Fechado** → **Pagamento em andamento** → **Pagamento encerrado** →
**Impressão** → **Costura** → **Logística** → **Entregue ao representante** → **Finalizado**

- O representante **cadastra e edita** nomes em *Aberto*, *Fechado* e *Pagamento em
  andamento*; a lista trava de vez a partir de *Pagamento encerrado*.
- O **pagamento** é aceito em *Fechado* e *Pagamento em andamento*.
- Da **Impressão** em diante o pedido está em produção: o que foi pago entra, o que não foi
  fica pendente e fora da leva.
- O time também fecha sozinho (*Aberto* → *Fechado*) quando passa a **data limite**.

Fora dessa linha existem dois status que **travam o pedido** — sem cadastrar ou editar
nomes e sem receber pagamento:

- **Suspenso** ⏸ — pausa temporária da organização. A página do time avisa que o pedido
  está suspenso e pede para tentar mais tarde.
- **Bloqueado** 🚫 — trava por decisão da organização (pendência com o cliente, pedido em
  disputa...). A página do time avisa que o pedido está bloqueado e manda falar com a
  coordenação.

Para destravar, é só devolver o pedido ao status em que ele estava — nada se perde no
caminho: a lista, os pagamentos e o histórico continuam como estavam.

### Finalizado (arquivo)

**Finalizado** é a última etapa: o pedido acabou e vai para o **arquivo**. Ele sai da lista
principal da aba **Inicial** (fica na seção recolhível **📦 Arquivados**, no fim da página),
do **Kanban** (a coluna *Finalizado* só recebe cards — arraste um pedido para lá para
arquivá-lo — e mostra quantos há) e da **tela inicial** do site. Continua contando no
**Financeiro**, e o link direto do time segue abrindo, só para consulta. Para tirar um pedido
do arquivo, é só mudar o status dele.

## Goleiro (camiseta de cor especial)

O goleiro joga com uma camiseta de **cor diferente**, para ser identificado em quadra. Na
lista isso é uma marca na camiseta — e ela acompanha o pedido até a impressão.

- **Quem marca:** o **Super Admin**, na lista de qualquer time (aba Inicial), e **quem
  administra a lista do time** com a senha, na página do pedido. Nos dois lugares é a
  coluna **Goleiro**: um clique na caixa marca ou desmarca, e já fica salvo.
- **Ao cadastrar:** o formulário da página do time tem a opção *🧤 É goleiro (camiseta de
  cor especial)* — dá para marcar na hora ou depois, na lista.
- **Quando pode mudar:** o representante marca enquanto a lista aceita nomes (Aberto,
  Fechado ou Pagamento em andamento, com os cadastros gerais abertos); o Super Admin
  marca **sempre**, mesmo com o pedido já fechado. Quem só está olhando a lista, sem a
  senha, vê a marca 🧤 mas não altera nada.
- **Onde aparece:** contagem de goleiros no resumo da página do time, no card do time e no
  resumo da aba Pagamentos; marca 🧤 nas listas da aba Produção; e a busca do topo do
  painel encontra todos de uma vez com a palavra `goleiro`.

**Na impressão, a cor diferente vira arquivo diferente** — não dá para misturar as duas
cores no mesmo arquivo:

- **CSV de produção** (aba Inicial e Configurações): sai o arquivo de sempre, com o mesmo
  nome e o mesmo formato, e — **só quando houver goleiro** — um segundo arquivo
  `...-goleiros.csv` com eles. Sem nenhum goleiro na lista, nada muda em relação a antes.
- **Aba Produção (levas):** o goleiro vira uma variação do modelo, `<arte> — goleiro`, e
  ganha o seu próprio CSV no *Baixar CSVs por modelo*.
- **CSVs de conferência:** coluna `Goleiro` (Sim/Nao) em todos eles.

> A marca fica no campo `goleiro` da camiseta. Camisetas cadastradas antes desta versão
> entram como "não goleiro", sem nada a corrigir.

## Prof (camiseta de professor)

Marca **só para organização**: indica quais camisetas são de professor, para separar e
entregar. Não muda nada na impressão — a camiseta sai no mesmo CSV de produção e na mesma
leva das demais.

- **Quem marca:** igual ao goleiro — o **Super Admin** (sempre) e quem administra a lista do
  time com a senha (enquanto a lista aceita nomes), na coluna **Prof**. Também dá para marcar
  ao cadastrar (*🎓 É camiseta de professor*).
- **Onde aparece:** contagem 🎓 no resumo da página do time, no card do time e no resumo da
  aba Pagamentos; marca 🎓 nas listas da aba Produção; coluna `Prof` (Sim/Nao) nos CSVs de
  conferência; a busca do topo do painel encontra todos com a palavra `prof`.

> A marca fica no campo `prof` da camiseta. Camisetas antigas entram como "não prof".

## Aba Financeiro (Super Admin)

A aba **Financeiro** tem cinco visões, escolhidas pelas sub-abas no topo. Todas usam o preço em vigor em cada time (a tabela geral da aba **Pagamentos** ou o [preço personalizado do time](#preço-personalizado-por-time)) e os custos de impressão/costureira por grupo (aba **Tamanhos**), e atualizam em tempo real conforme os pagamentos entram.

- **Visão geral** — previsto, recebido e a receber; percentual recebido; custos, taxas do Mercado Pago e lucro (previsto e realizado); quanto entrou hoje e nos últimos 7 dias; e o resumo por time. Os cards **Custos previstos** e **Lucro realizado** abrem um detalhe ao clique: o primeiro quebra o custo em impressão e costureira; o segundo mostra a conta inteira — receita recebida, os **custos realizados** (impressão + costureira das camisetas já pagas) e as taxas do Mercado Pago e o custo das **camisetas internas** (que não têm receita, mas são produzidas). Na tabela por time, a coluna *Custo prev.* também abre o detalhe daquele time.
- **Extrato diário** — o que entrou em cada dia, com quantidade, PIX, dinheiro, total do dia, taxa do Mercado Pago e acumulado no período. Clique num dia para abrir a lista de pagamentos daquele dia (hora, aluno, time, tamanho, forma, taxa e líquido).
- **Evolução** — hoje, ontem, últimos 7 dias (com a variação em relação aos 7 anteriores), gráfico de entradas por dia, fechamento por semana e a projeção de quando o valor em aberto termina de entrar, no ritmo atual.
- **A receber** — fila de conferência dos alunos que avisaram que pagaram (com botão para confirmar o recebimento), tempo em aberto das pendências por faixa (até 3 dias, 4 a 7, 8 a 15, mais de 15), pendências por time e as maiores pendências individuais.
- **Resultado (DRE)** — demonstrativo da receita menos os custos (impressão, costureira, as camisetas internas e as taxas do Mercado Pago), lucro previsto e realizado, margem, ticket médio, custo médio unitário e a rentabilidade por time e por grupo de tamanho.

O **Extrato diário** e a **Evolução** têm filtro de período (hoje, 7 dias, 30 dias, tudo ou um intervalo personalizado) e filtro por time; a visão **A receber** tem só o filtro por time, porque mostra sempre a situação de hoje.

O botão **Exportar CSV da visão** baixa exatamente a visão aberta: resumo por time (`financeiro-interclasse.csv`), extrato analítico com uma linha por pagamento (`extrato-recebimentos.csv`), consolidado por dia (`recebimentos-por-dia.csv`), pendências (`a-receber-interclasse.csv`) ou o DRE completo (`resultado-interclasse.csv`).

### Taxas do Mercado Pago

Quando a [confirmação automática](#confirmação-automática-mercado-pago--opcional) está ligada, o
aviso que o Mercado Pago manda ao aprovar o pagamento **já traz a tarifa cobrada** (`fee_details`)
e o valor líquido (`transaction_details.net_received_amount`). O webhook grava os dois em cada
camiseta da cobrança — rateando a taxa na proporção do preço de cada uma, quando a cobrança tem
mais de uma —, então o Financeiro mostra o que de fato caiu na conta, sem ninguém digitar nada:

- **Visão geral** — card *Taxas do Mercado Pago* (com o percentual médio sobre o que veio online),
  o líquido ao lado do recebido e o *Lucro realizado* já descontando as taxas.
- **Extrato diário** — coluna de taxa por dia e, no detalhe, taxa e líquido de cada pagamento.
- **Resultado (DRE)** — linha `(-) Taxas do Mercado Pago` entre a receita recebida e o lucro realizado.
- Os CSVs do resumo por time, do extrato, do consolidado por dia e do DRE trazem as colunas de
  taxa e líquido.

O **previsto** continua sem taxa: ela só existe depois que o pagamento acontece, e varia com o
meio de pagamento. Pagamento em dinheiro ou PIX marcado na mão não tem taxa — e marcar um
pagamento manualmente no Super Admin apaga a taxa que porventura estivesse gravada naquela
camiseta. Cobranças pagas antes desta versão ficam sem taxa registrada (entram como zero).

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
- Havendo [goleiro](#goleiro-camiseta-de-cor-especial) na lista, os goleiros saem num
  arquivo irmão (`producao-<time>-goleiros.csv`), porque a camiseta deles é de outra cor.
- A aba **Produção** usa exatamente este formato, mas com um arquivo **por modelo de camiseta**:
  `producao-<leva>-<modelo>.csv` — e o goleiro entra como o modelo `<arte> — goleiro`. Lá o que entra é o que você escolheu, pago ou não — ver
  [Aba Produção](#aba-produção-levas-e-um-csv-por-modelo).

```csv
ANINHA,10,M
"Carla, a Craque",3,P
BRUNO,7,G
```

> Valores com vírgula ou aspas saem entre aspas, como manda o padrão CSV.

### CSV de conferência (a lista completa)

Para conferir o pedido e os pagamentos.

- Colunas: `Cliente`, `Time`, `Nome do Estudante`, `Tamanho`, `Numero`,
  `Nome na Camiseta`, `Goleiro`, `Pago`, `Forma Pagto`.
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

> Isso vale para os CSVs **do pedido** (aba Inicial e Configurações). Na aba **Produção**, quem
> escolhe o que entra é você, camiseta por camiseta — é por lá que se adianta a impressão de uma
> camiseta ainda não paga.

## Aba Produção (levas e um CSV por modelo)

O CSV da aba **Inicial** exporta um pedido inteiro (e só o que foi pago). A aba
**Produção** faz o contrário: você **monta a leva** escolhendo camiseta por camiseta.
É o caminho para adiantar um pedaço de um pedido junto com outro — algumas unidades de
professores saindo na mesma impressão das camisetas de outro time, por exemplo.

Uma **leva** é o que vai para a impressão de uma vez. Cada camiseta dela carrega o seu
**modelo** (a arte que será impressa) e, na exportação, a leva sai **dividida por modelo**:
um arquivo para cada arte, porque cada uma é uma abertura diferente no programa de impressão.

### Como se usa

1. **Crie a leva** (nome e, se quiser, uma observação). Ex.: *"Leva 1 — professores + 3º Ano A"*.
2. **Escolha as camisetas** no card *Escolher camisetas*: marque uma a uma ou use os atalhos
   **Marcar todas** / **Marcar só as pagas** de cada time. Filtre por time, pagamento, tamanho
   ou pelo nome; o seletor **Cliente** do topo vale aqui também.
3. Clique em **Enviar para a produção** e escolha a leva de destino (ou crie uma na hora).
4. **Acrescente as avulsas**, se houver: dentro da leva, em *"+ Acrescentar camisetas avulsas"*,
   informe o modelo e cadastre uma a uma (com quantidade) ou **cole uma lista** — uma camiseta
   por linha, no formato `nome, número, tamanho`.
5. **Baixe os CSVs**: **Baixar CSVs por modelo** gera um arquivo para cada arte da leva; ou use
   **CSV deste modelo** no bloco de um modelo só. O **CSV de conferência** traz a leva inteira
   num arquivo, com time, cliente, modelo e pagamento.

A leva tem uma situação própria — **Em montagem**, **Enviada para impressão** e **Concluída** —,
que é só do controle interno da produção e **não** mexe no status do pedido de nenhum time.

### O modelo (o que divide os arquivos)

O modelo de cada camiseta vinda de um pedido é, por padrão, o **nome do time** (cada time tem a
sua arte). Para mudar, use a **Configuração** do time → **Modelo da camiseta (arte)**:

- dois times que usam a **mesma arte**: dê a eles o mesmo nome de modelo e eles saem
  **num arquivo só**;
- um time cuja arte é diferente da dos outros: um nome de modelo próprio o separa.

Dentro da leva, cada linha ainda tem um seletor de modelo — dá para mover uma camiseta
específica para outra arte (ou para uma nova, pela opção *"Outro modelo…"*) sem mexer no time.

### Pago x não pago

Diferente do CSV da aba Inicial, a leva **não filtra por pagamento**: quem decide o que entra é
você. É isso que permite adiantar a produção de camisetas ainda não pagas. A tela mostra a
situação de pagamento de cada linha, e o aviso na hora de enviar diz quantas ainda não foram
pagas.

### Camisetas que mudam depois de entrar na leva

O que vai para o CSV é sempre o **cadastro de agora**: se o nome for corrigido depois de a
camiseta entrar na leva, o arquivo sai com o nome corrigido (a linha fica marcada como
*"Mudou no pedido depois de entrar na leva"*). A leva também guarda uma **cópia** do que estava
valendo na hora de enviar — ela só é usada se a camiseta for apagada do pedido, e nesse caso a
linha aparece destacada como *"Já não existe no pedido"*, para você conferir antes de imprimir.

> Vários downloads de uma vez: **Baixar CSVs por modelo** dispara um arquivo por modelo, em
> fila. Na primeira vez o navegador costuma pedir permissão para baixar vários arquivos do site.

> No Firestore as levas ficam na coleção `producao` (uma leva por documento) e as camisetas
> escolhidas na subcoleção `itens`. É controle interno, então **nem a leitura é pública**: só a
> conta administradora entra. Depois de atualizar, **republique o `firestore.rules`** no console
> do Firebase — a versão anterior não conhecia a coleção `producao`.

## Folha EPS CMYK personalizada (produção)

Em vez de montar nome e número camiseta por camiseta no CorelDRAW, o site monta a **folha de
impressão** de cada pedido em **EPS CMYK**: cada peça de cada camiseta com o **molde de corte**
do tamanho dela, a **arte do time** adaptada ao tamanho, o **brasão** e o nome/número em
**curvas**, encaixadas para aproveitar a folha. São três lugares:

### 1. Moldes de corte (aba **Tamanhos**)

Um **EPS por peça em cada tamanho** — Frente, Costas, Manga esquerda, Manga direita (cada manga
tem a sua faca de corte) e **Gola** —, no tamanho real (lido do `%%BoundingBox`). Em **Enviar vários**,
escolha todos de uma vez: o site reconhece a peça e o tamanho pelo nome do arquivo
(`costas-M.eps`, `manga esq GG.eps`, `manga dir P.eps`, `gola M.eps`). A **prévia** de cada molde é desenhada pelo
próprio site (Ghostscript no navegador, ~16 MB baixados só na primeira vez); se não der, a
célula oferece enviar um PNG. Escolha o **tamanho base** (padrão: M) — é nele que o layout é
marcado e é para ele que as artes são feitas.

O site também lê o **contorno** de cada molde (a linha de corte: o maior desenho do EPS,
convertido pelo Ghostscript num PDF simples — funciona com EPS do Corel, do Illustrator...). É
com ele que a arte é **recortada no formato da peça**. Moldes enviados antes disso aparecem com
"⚠️ sem contorno" ou "⚠️ contorno retangular": use **Reler contornos** no topo da tabela (relê
todos os moldes). O contorno é a **linha de corte traçada** do EPS; o fundo preenchido do tamanho
da página e os caminhos de recorte são ignorados. Sem contorno, a arte daquela peça sai
retangular (a geração avisa).

### 2. Arquivos do time (time aberto → **Arquivos de produção**)

- A **arte de cada peça em PNG 600 dpi**. Em cada tamanho ela é **esticada para cobrir o molde
  inteiro** (largura e altura, cada uma no seu, mais a sangria), então não sobra nenhuma fresta
  branca; quem dá o formato é o recorte no contorno do molde. PNG 8 bits (RGB/RGBA, com
  transparência), sem entrelaçamento.
- **Mangas**: uma arte só serve para **as duas** (menos arquivo no Drive). Se a manga direita
  for diferente, marque **"Manga direita com arte diferente"** e envie a dela.
- **Detalhe da manga** (PNG): um elemento posicionado na manga, como o brasão (bandeira,
  símbolo da turma...). Também um só para as duas mangas; **"Detalhe diferente na manga
  direita"** libera um segundo arquivo.
- O **brasão em EPS** (entra intacto, vetorial).
- A **fonte** (`.ttf`/`.otf`) do nome e do número.

O selo mostra **pronto ✓** ou o que falta. Arquivos grandes vão ao Drive em partes de 20 MB.

### 3. Layout (aba **Artes**)

Em cima do molde de cada peça, marque o **brasão**, o **logo da empresa**, o **detalhe da manga**
(**+ Detalhe**) e as caixas do **nome** e do **número**. Brasão, logo e detalhe mantêm a proporção;
desmarque **"Manter proporção"** no painel para esticá-los na largura e na altura quando precisar
(arrastar, alça do canto ou X/Y/largura/altura em mm). A caixa é o **limite**: nome ou número
comprido **encolhe** (ou é **comprimido** na largura) e nunca sai dela. No texto: cor **CMYK**,
**contorno**, alinhamento, maiúsculas. Nos outros tamanhos as caixas acompanham a proporção do
molde (dá para ajustar um tamanho específico).

O layout **geral** vale para todos os times. Em **Editando**, escolha um time para um **ajuste
próprio** dele (só a posição; **Voltar ao layout geral** desfaz). **⬇ EPS de teste** baixa a peça
aberta com o apelido e o número de teste, usando os arquivos do time.

### Logo da empresa (aba **Configurações**)

O seu logo em **EPS**, o mesmo para todos os times, para usar como detalhe das camisetas. Na
aba Artes, **+ Logo** coloca uma caixa dele em qualquer peça (proporção mantida, ajuste por time
como o brasão). O EPS entra intacto na folha.

### Prévia do time (time aberto → Arquivos de produção)

- **Arte (sem simulação)**: as peças planas, no formato do molde e com a arte recortada, como na
  folha de corte — gola em cima, mangas no meio, frente e costas embaixo.
- **Mockup**: a arte **vestida numa foto** de camiseta branca num manequim (vistas **Cena**, com a
  frente e as costas, **Frente** e **Costas**). Cada peça é deformada para a perspectiva da foto e
  multiplicada pelas sombras do tecido, então as dobras continuam aparecendo; a gola recebe a
  cor da arte da gola. **Baixar PNG** salva a imagem para mandar ao cliente. As fotos base ficam
  em `img/mockup/` e as regiões (corpo, mangas, gola) de cada foto em `js/mockup.js`.

### Gerar (aba **Produção**)

**Folhas EPS (CMYK)** na leva (ou **Folha EPS** no bloco de um modelo) pergunta:

- **largura da folha/rolo** e **distância entre peças**;
- a **sangria** para fora da linha de corte (padrão 2 mm; 0 = a arte para exatamente no contorno);
- se o fornecedor deixa **girar** as peças (90° quando aproveitar melhor) ou não;
- a **resolução** das artes (600 dpi original, 300 ou 150 para prova);
- contorno do molde por cima/por baixo/fora, altura máxima por folha e o marcador da costureira.

Cada peça leva um **marcador para a costureira** dentro da área de impressão:
**`Time-Tamanho-Peça`** (ex.: `7B-P-Frente`), com **4 mm** de altura, centralizado a **1 mm da
base** da peça. Na **gola** o marcador vai na **lateral esquerda, na vertical** (lendo de baixo
para cima), também a 1 mm da borda e com 4 mm. Dá para desligar no diálogo.

Sai **um EPS por time** (camisetas avulsas vão para o time do mesmo modelo; os goleiros saem num
arquivo à parte), num `.zip` quando há mais de um. O encaixe é por "melhor espaço livre"
(MaxRects), com as maiores peças primeiro.

### Como o arquivo é feito

- EPS enviados (moldes, brasão e logo) entram **intactos**, embutidos no arquivo.
- A arte, o brasão, o logo e os textos de cada peça ficam **recortados no contorno do molde**
  (com a sangria escolhida); a linha de corte do molde vai por cima (ou por baixo/fora, conforme
  a opção).
- As artes PNG são lidas **linha a linha** (uma arte de 600 dpi não caberia na memória do
  navegador inteira) e convertidas para **CMYK** com a fórmula simples (K = 1 − máx(R,G,B)); a
  transparência vira máscara (menos de 50% de opacidade não imprime). Cada arte entra **uma vez**
  por arquivo, mesmo aparecendo em várias camisetas. Tons muito saturados podem ficar um pouco
  diferentes de uma conversão com perfil ICC.
- PostScript nível 3. Em 600 dpi o arquivo fica grande (centenas de MB numa leva cheia); o site
  avisa acima de ~500 MB — gere em 300 dpi se o programa não abrir.

Os arquivos ficam no seu **Google Drive**, pelo mesmo Apps Script das imagens — **reimplante o
script** com o `Codigo.gs` atual (ver [`apps-script/README.md`](apps-script/README.md)) e publique
o `firestore.rules` atualizado (`config/moldes` e `config/layout`).

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

1. No **Super Admin → Inicial**, abra o time → **Configuração** → **Tabela especial de preço**.
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

**O carrinho vale para o site inteiro, não para um time só.** Um responsável com filhos em
times diferentes abre o pedido de cada time, marca as camisetas de cada um e paga **tudo
junto**: a barra acompanha entre as páginas e mostra de quantos times é o carrinho. A barra
aparece também na tela inicial, com um botão que leva de volta ao pagamento.

- **Sem login e sem cadastro.** O carrinho é só uma lista guardada no navegador de quem
  está pagando (`localStorage`), então cada pessoa tem o seu: dois pais pagando pelo mesmo
  link, cada um no seu celular, não se atrapalham. Ele sobrevive a recarregar a página e
  some sozinho quando as camisetas são pagas.
- **PIX (padrão):** sai **um** QR Code / copia e cola com a **soma** das camisetas
  escolhidas, mesmo que sejam de times diferentes (cada uma pelo preço do seu time). O
  botão **"Já paguei as N camisetas"** avisa a organização de todas de uma vez — elas ficam
  *Aguardando confirmação* na lista de cada time, e você confirma no Super Admin.
- **Mercado Pago (opcional):** sai **uma** cobrança com um item por camiseta — o pagador vê
  a lista na tela do Mercado Pago. Quando o PIX cai, o webhook marca **todas** como pagas,
  em todos os times envolvidos.
- O botão **Pagar** de cada linha continua ali para quem quer pagar só aquela camiseta.
- Uma camiseta só entra no carrinho se puder ser paga agora: pedido na fase de pagamento,
  nem suspenso nem bloqueado, ainda não paga e **sem ajuste pendente** (ajuste em aberto
  trava o pagamento, como antes).
- O carrinho é **reconferido no banco** ao abrir a página e antes de cobrar: o que mudou de
  situação (pagou por outro caminho, ganhou um ajuste, o pedido mudou de etapa) sai da lista
  com um aviso, e preço/tamanho são atualizados. Ninguém paga um valor desatualizado.

> Com o Mercado Pago ligado, a lista de camisetas de cada cobrança — com o time de cada uma
> — fica em `cobrancas` no Firestore, porque o campo de referência do Mercado Pago é curto
> demais para levar todos os ids. Essa coleção é **fechada para o site**
> (`firestore.rules`): só o backend escreve e lê nela, pelo Admin SDK. Cobranças criadas
> antes desta versão continuam sendo reconhecidas.

### Status de pagamento

Cada aluno tem um status: **Pendente**, **Aguardando confirmação** ou **Pago (PIX/dinheiro)**.

- **Pagamento em dinheiro:** você marca manualmente no Super Admin, na lista do time (aba **Inicial** → abra o time → aba **Lista**), pelo seletor de pagamento de cada linha.
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

O Super Admin é organizado em abas: **Inicial** (criar times e lista de times), **Clientes**, **Kanban**, **Produção**, **Financeiro**, **Tamanhos**, **Pagamentos** e **Configurações** (gerais + exportar). A barra de identificação e as abas ficam **fixas no topo** enquanto você rola a página, então dá para trocar de aba de qualquer altura, sem voltar até o começo (em telas estreitas, as abas rolam para o lado).

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
