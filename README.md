# Camisetas Interclasse

Site para representantes de turma cadastrarem a lista de camisetas do interclasse (nome do estudante, tamanho, número e nome na camiseta), conferirem e fecharem o pedido. O administrador acompanha todas as turmas e exporta um CSV geral para usar no CorelDraw.

Funciona 100% no navegador (HTML/CSS/JS puro) hospedado no GitHub Pages, usando o **Firebase (Firestore)** como banco de dados na nuvem, gratuito.

## Como funciona

- **`index.html`** — lista as turmas cadastradas.
- **`turma.html?id=NOME-DA-TURMA`** — página do representante: digita a senha da turma, cadastra/edita/remove alunos, vê o resumo por tamanho, exporta CSV e fecha o pedido.
- **`admin.html`** — painel do administrador: cria turmas (com senha própria para cada uma), acompanha status, reabre pedidos fechados, edita qualquer turma e exporta o CSV geral de todas as turmas.

Nenhuma senha aqui é criptografada — é uma proteção simples para evitar edições por engano ou por curiosos, adequada para esse tipo de uso (não é um sistema com dados sigilosos).

## Passo a passo da configuração

### 1. Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e crie um projeto novo (pode desativar o Google Analytics, não é necessário).
2. No menu lateral, vá em **Compilação > Firestore Database** → **Criar banco de dados** → escolha **modo de produção** → selecione uma localização (ex: `southamerica-east1`).
3. Ainda no menu lateral, vá em **Compilação > Authentication** → aba **Sign-in method** → ative o provedor **Anônimo**.

### 2. Conectar o site ao seu projeto Firebase

1. No console do Firebase, clique no ícone de engrenagem → **Configurações do projeto**.
2. Em **Seus aplicativos**, clique no ícone `</>` (Web) para registrar um app da Web. Dê um nome qualquer (ex: "site interclasse") e clique em registrar.
3. O Firebase vai mostrar um objeto `firebaseConfig` com `apiKey`, `authDomain`, `projectId`, etc.
4. Abra o arquivo **`js/firebase-config.js`** deste projeto e substitua os valores de exemplo pelos valores reais que o Firebase mostrou.

### 3. Publicar as regras de segurança

1. No console do Firebase, vá em **Firestore Database > Regras**.
2. Apague o conteúdo e cole o conteúdo do arquivo **`firestore.rules`** deste projeto.
3. Clique em **Publicar**.

### 4. Criar a senha do administrador

As regras impedem que a senha do admin seja criada pelo próprio site (por segurança), então você cria manualmente uma única vez:

1. No console do Firebase, vá em **Firestore Database > Dados**.
2. Clique em **Iniciar coleção**. ID da coleção: `config`.
3. ID do documento: `admin`.
4. Adicione um campo: nome `senha`, tipo `string`, valor = a senha que você quer usar no painel administrativo (ex: `interclasse2026`).
5. Salve.

### 5. Publicar no GitHub Pages

1. Crie um repositório novo no GitHub e suba todos os arquivos deste projeto (`index.html`, `turma.html`, `admin.html`, as pastas `css/` e `js/`).
2. No repositório, vá em **Settings > Pages**.
3. Em **Source**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`. Salve.
4. Aguarde alguns minutos — o GitHub vai mostrar o link do site publicado (algo como `https://seuusuario.github.io/nome-do-repositorio/`).

### 6. Criar as turmas e começar a usar

1. Acesse `SEU-SITE/admin.html`, entre com a senha do administrador (a que você criou no passo 4).
2. Em **Criar nova turma**, cadastre cada turma com um nome (ex: "3º Ano A - Manhã") e uma senha própria para ela.
3. Compartilhe com cada representante o link da turma (`SEU-SITE/turma.html?id=ID-DA-TURMA`, mostrado após criar) e a senha correspondente. Eles também conseguem chegar lá pela página inicial (`index.html`), que lista todas as turmas.
4. Cada representante cadastra os alunos, confere a lista (o site avisa se houver números de camiseta duplicados) e clica em **Fechar pedido da turma** quando terminar.
5. No painel admin, acompanhe o status de todas as turmas. Quando todas estiverem fechadas (ou quando quiser), clique em **Exportar CSV geral** para baixar um único arquivo com todos os pedidos.

## Sobre o CSV exportado

- Colunas: `Turma` (só no CSV geral), `Nome do Estudante`, `Tamanho`, `Numero`, `Nome na Camiseta`.
- Separador `;` e codificação UTF-8 com BOM — abre corretamente no Excel e pode ser importado no CorelDraw para mala direta / automações, sem problemas de acentuação.

## Tamanhos disponíveis

- Infantil: 10, 12, 14, 16
- Normal: P, M, G, GG
- Plus Size: G1, G2, G3, G4

Para alterar essa lista, edite o array `GRUPOS_TAMANHO` no arquivo `js/utils.js`.

## Limitações conhecidas

- A proteção por senha de turma/admin é feita no site (não no banco de dados), então é uma barreira de conveniência, não uma segurança forte. Não cadastre informações sensíveis além do necessário para o pedido.
- Exclusão de aluno é sempre "suave" (o registro fica marcado como removido, mas não desaparece do banco) — isso é proposital, para evitar perda de dados por engano, e simplifica as regras de segurança.
- O plano gratuito do Firebase (Spark) é mais do que suficiente para o volume de um interclasse escolar.
