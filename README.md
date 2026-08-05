# Camisetas Interclasse

Site para representantes de turma cadastrarem a lista de camisetas do interclasse (nome do estudante, tamanho, número e nome na camiseta), conferirem e fecharem o pedido. O administrador acompanha todas as turmas e exporta um CSV geral para usar no CorelDraw.

Funciona 100% no navegador (HTML/CSS/JS puro) hospedado no GitHub Pages, usando o **Firebase (Firestore)** como banco de dados na nuvem, gratuito.

## Como funciona

- **`index.html`** — lista as turmas cadastradas.
- **`turma.html?id=NOME-DA-TURMA`** — página do representante: digita a senha da turma, cadastra/edita/remove alunos, vê o resumo por tamanho, exporta CSV e fecha o pedido.
- **`admin.html`** — página de **login** do administrador (e-mail/senha do Firebase Authentication). O acesso fica num link discreto no rodapé de cada página ("Área administrativa"). Ao entrar com a conta administradora, o site leva automaticamente para o Super Admin.
- **`superadmin.html`** — **Super Admin**: cria turmas (com senha própria para cada uma), acompanha status, reabre pedidos fechados, edita qualquer turma e exporta o CSV geral. Também é onde se ajustam os **tamanhos de camiseta** e as **configurações gerais** (título do evento, texto do rodapé e um interruptor para abrir/fechar os cadastros de todas as turmas de uma vez). É uma página protegida: quem não estiver logado como administrador é mandado de volta para o login.

O **painel administrativo** é protegido por login de verdade (Firebase Authentication, e-mail/senha), e as regras do Firestore só deixam a conta administradora criar turmas e alterar tamanhos/configurações. Já a **senha de cada turma** é uma proteção simples conferida no site, apenas para evitar edições por engano ou por curiosos — não é um sistema com dados sigilosos.

## Passo a passo da configuração

### 1. Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e crie um projeto novo (pode desativar o Google Analytics, não é necessário).
2. No menu lateral, vá em **Compilação > Firestore Database** → **Criar banco de dados** → escolha **modo de produção** → selecione uma localização (ex: `southamerica-east1`).
3. Ainda no menu lateral, vá em **Compilação > Authentication** → aba **Sign-in method** e ative **dois** provedores:
   - **Anônimo** — usado automaticamente pelas páginas do aluno (início e turma) para gravar os pedidos.
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

1. Crie um repositório novo no GitHub e suba todos os arquivos deste projeto (`index.html`, `turma.html`, `admin.html`, `superadmin.html`, as pastas `css/` e `js/`).
2. No repositório, vá em **Settings > Pages**.
3. Em **Source**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`. Salve.
4. Aguarde alguns minutos — o GitHub vai mostrar o link do site publicado (algo como `https://seuusuario.github.io/nome-do-repositorio/`).

### 6. Criar as turmas e começar a usar

1. Acesse `SEU-SITE/admin.html` (ou clique em "Área administrativa" no rodapé) e entre com o **e-mail e a senha** do administrador (a conta que você criou no passo 4). O site leva você automaticamente para o **Super Admin** (`superadmin.html`).
2. Em **Criar nova turma**, cadastre cada turma com um nome (ex: "3º Ano A - Manhã") e uma senha própria para ela.
3. Compartilhe com cada representante o link da turma (`SEU-SITE/turma.html?id=ID-DA-TURMA`, mostrado após criar) e a senha correspondente. Eles também conseguem chegar lá pela página inicial (`index.html`), que lista todas as turmas.
4. Cada representante cadastra os alunos, confere a lista (o site avisa se houver números de camiseta duplicados) e clica em **Fechar pedido da turma** quando terminar.
5. No painel admin, acompanhe o status de todas as turmas. Quando todas estiverem fechadas (ou quando quiser), clique em **Exportar CSV geral** para baixar um único arquivo com todos os pedidos.

## Sobre o CSV exportado

- Colunas: `Turma` (só no CSV geral), `Nome do Estudante`, `Tamanho`, `Numero`, `Nome na Camiseta`.
- Separador `;` e codificação UTF-8 com BOM — abre corretamente no Excel e pode ser importado no CorelDraw para mala direta / automações, sem problemas de acentuação.

## Tamanhos disponíveis

Tamanhos padrão (usados enquanto nada foi salvo no painel):

- Infantil: 10, 12, 14, 16
- Normal: P, M, G, GG
- Plus Size: G1, G2, G3, G4

Para alterar essa lista, use a seção **Tamanhos de camiseta** no painel administrativo (`admin.html`): dá para criar/remover grupos, adicionar/remover tamanhos e restaurar o padrão. O que for salvo fica em `config/tamanhos` no Firestore e passa a valer no cadastro de todas as turmas. O array `TAMANHOS_PADRAO` em `js/utils.js` continua servindo como fallback caso nada tenha sido salvo ainda.

> **Importante:** o painel grava em `config/geral` e `config/tamanhos`. Se você configurou o Firestore antes desta versão, republique as regras (`firestore.rules`) no console do Firebase — a versão anterior bloqueava toda escrita em `config/`.

## Pagamento por PIX

Nas turmas com o **pedido fechado**, cada linha ganha um botão **"Pagar (PIX)"** que abre um QR Code + o código "copia e cola", já com o valor da camiseta.

Para configurar, entre no **Super Admin → Pagamento (PIX)** e preencha:

- **Chave PIX** — e-mail, telefone, CPF/CNPJ ou chave aleatória da conta que vai receber.
- **Nome do recebedor** (máx. 25 caracteres) e **Cidade** (máx. 15) — como no seu cadastro bancário.
- **Preço por grupo de tamanho** — um valor para cada grupo (ex.: Normal R$ 45, Plus Size R$ 55). O valor cobrado em cada linha é o do grupo do tamanho daquele aluno. Se um grupo ficar sem preço, o PIX é gerado sem valor (o pagador digita no app).

### Status de pagamento

Cada aluno tem um status: **Pendente**, **Aguardando confirmação** ou **Pago (PIX/dinheiro)**.

- **Pagamento em dinheiro:** você marca manualmente no Super Admin, na lista da turma (aba **Inicial** → "Ver lista"), pelo seletor de pagamento de cada linha.
- **Pagamento por PIX:** como o PIX estático não avisa o site automaticamente, o pagante clica em **"Já fiz o pagamento"** no modal do PIX (fica *Aguardando confirmação*); você confere na sua conta e confirma marcando **Pago (PIX)** no seletor.
- O CSV exportado inclui as colunas `Pago` e `Forma Pagto`.

> Confirmação **automática** de PIX (sem clique) exige um provedor de pagamento (Mercado Pago, Efí etc.) com PIX dinâmico + webhook e um backend (Firebase Cloud Functions, plano Blaze). É um projeto à parte.

O Super Admin é organizado em abas: **Inicial** (criar turmas e lista de turmas), **Tamanhos**, **Pagamentos** e **Configurações** (gerais + exportar).

Detalhes técnicos:

- O código PIX ("copia e cola") é gerado **no próprio site** (padrão EMV/BR Code do Banco Central, com CRC16) — nenhum dado de pagamento passa por terceiros.
- A **imagem** do QR Code é renderizada por um serviço externo (`api.qrserver.com`) apenas para desenhar o quadradinho; se preferir 100% offline, dá para trocar por uma biblioteca embutida — é só pedir.
- Os dados de pagamento ficam em `config/geral` (só o admin grava; leitura é pública, como o resto).

## Limitações conhecidas

- A proteção por senha de turma/admin é feita no site (não no banco de dados), então é uma barreira de conveniência, não uma segurança forte. Não cadastre informações sensíveis além do necessário para o pedido.
- Exclusão de aluno **pelo representante** (na página da turma) é sempre "suave" (o registro fica marcado como removido, mas não desaparece do banco) — isso é proposital, para evitar perda de dados por engano.
- No Super Admin dá para **editar** (nome e senha) e **excluir** uma turma. A exclusão da turma é definitiva: apaga a turma e todas as camisetas cadastradas nela (essa exclusão de verdade só é permitida para a conta administradora).
- O plano gratuito do Firebase (Spark) é mais do que suficiente para o volume de um interclasse escolar.
