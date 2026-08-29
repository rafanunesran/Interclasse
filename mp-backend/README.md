# Backend de pagamento (Mercado Pago) — Interclasse

Backend serverless que dá **confirmação automática de PIX**: quando o pagamento cai, o
Mercado Pago avisa este backend (webhook), que marca o aluno como **Pago** no Firestore.
O site então atualiza o status sozinho, sem recarregar.

Roda de graça na **Vercel** (plano Hobby, sem cartão). Funções:

- `api/criar-preferencia.js` — **Checkout Pro** (padrão): cria uma preferência e devolve a URL
  da página hospedada do Mercado Pago; o site redireciona o pagador para lá (com o layout do MP,
  QR gerado pelo próprio MP). O valor é calculado aqui pelo tamanho do aluno e pelo time
  dele — a tabela geral `config/geral.precosPorGrupo` com o preço próprio do time
  (`config/geral.precosPorTime[timeId]`) por cima —, nunca vindo do cliente.
- `api/webhook-mp.js` — recebe o aviso do Mercado Pago (payment e merchant_order), valida a
  assinatura e grava `pago: true` nas camisetas da cobrança. Aproveita a mesma consulta para
  guardar a **taxa** do Mercado Pago e o valor líquido de cada camiseta (ver abaixo).
- `api/criar-pagamento.js` — alternativa "transparente" (QR dentro do próprio site). Não é usada
  pelo padrão atual, fica disponível se quiser trocar.
- `lib/itens.js` — monta a lista de camisetas da cobrança (uma ou o carrinho inteiro),
  busca cada aluno, calcula os preços e registra a cobrança.

### Carrinho: uma cobrança com várias camisetas, de vários times

Os dois endpoints de cobrança aceitam três formatos no corpo, do mais novo para o mais
antigo — e todos continuam funcionando:

```jsonc
{ "itens": [ { "timeId": "3o-ano-a", "alunoId": "abc" },
             { "timeId": "1o-ano-b", "alunoId": "def" } ] }   // carrinho (pode cruzar times)
{ "timeId": "3o-ano-a", "alunoIds": ["abc", "def"] }          // carrinho de um time só
{ "timeId": "3o-ano-a", "alunoId": "abc" }                    // uma camiseta
```

Sai **uma** cobrança, com um item por camiseta — o pagador vê a lista na tela do Mercado
Pago —, e o webhook marca **todas** como pagas. Cada camiseta é cobrada pelo preço do
**seu** time (a tabela geral ou a própria do time), e não pelo preço de um time só: é isso
que deixa um responsável com filhos em times diferentes pagar tudo junto.

Como o `external_reference` do Mercado Pago é curto demais para levar uma lista de ids, a
lista (com o time de cada camiseta) fica num documento da coleção **`cobrancas`** do
Firestore e a referência vira `lote:<id-da-cobrança>`. O webhook lê esse documento para
saber quem marcar. Ele também entende os dois formatos anteriores: cobranças gravadas com
`timeId` + `alunoIds` e referências `<timeId>__<alunoId>`, então nada criado antes desta
versão deixa de ser confirmado.

### Taxa do Mercado Pago no Financeiro

O pagamento consultado no MP traz `fee_details` (a tarifa cobrada de quem recebe) e
`transaction_details.net_received_amount` (o que cai na conta). O webhook usa os dois — um
completa o outro quando algum falta — e grava em cada camiseta da cobrança:

| Campo no aluno      | O que é                                            |
| ------------------- | -------------------------------------------------- |
| `pagamentoBruto`    | a parte do valor bruto correspondente à camiseta    |
| `pagamentoTaxa`     | a parte da tarifa do Mercado Pago                   |
| `pagamentoLiquido`  | o que sobrou dessa camiseta depois da tarifa        |

Numa cobrança com várias camisetas, a taxa é **rateada na proporção do preço de cada uma** (a
sobra dos centavos vai para a última, para a soma bater com o valor informado pelo MP); por isso
`cobrancas.itens` guarda o valor de cada camiseta. O documento da cobrança também recebe
`valorBruto`, `taxa` e `valorLiquido`. Se o MP não informar nem a tarifa nem o líquido, os campos
não são gravados — melhor ficar sem o dado do que registrar taxa zero num pagamento que teve taxa.
Nada disso impede a confirmação: a camiseta é marcada como paga de qualquer jeito.

O limite é de **60 camisetas por cobrança** (`MAX_ITENS` em `lib/itens.js`), só para uma
requisição estranha não virar centenas de leituras no Firestore.

> ⚠️ **Use as credenciais de PRODUÇÃO** (`MP_ACCESS_TOKEN`) para receber pagamentos de verdade.
> Com o **Access Token de teste**, o QR/cobrança só pode ser pago por um **usuário de teste** do
> Mercado Pago (sandbox) — o app de um banco real acusa **"não encontrado"**. Para testar sem
> dinheiro, use um usuário de teste do MP; para valer, troque para produção e refaça o deploy.

> As credenciais (Access Token do MP, secret do webhook, chave da service account do
> Firebase) ficam **só nas variáveis de ambiente da Vercel** — nunca no site nem no Git.

## Passo a passo

### 1. Mercado Pago
1. Crie a aplicação (Online payments → Checkout Transparente → Orders API), em
   https://www.mercadopago.com.br/developers/panel/app
2. Copie o **Access Token** (use o de **teste** para validar; o de **produção** para valer).
3. Em **Webhooks → Configurar notificações**, cadastre a URL
   `https://SEU-PROJETO.vercel.app/api/webhook-mp`, marque o evento **Pagamentos** e salve.
   Copie o **secret** gerado.

### 2. Firebase (service account)
1. Console do Firebase → **Configurações do projeto → Contas de serviço**.
2. **Gerar nova chave privada** → baixa um JSON com `project_id`, `client_email` e `private_key`.

### 3. Deploy na Vercel
1. Em https://vercel.com (login com GitHub, sem cartão), **Add New → Project** e importe este
   repositório.
2. Em **Root Directory**, selecione `mp-backend`.
3. Em **Environment Variables**, cadastre (ver `.env.example`):
   `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` (cole a chave inteira, com os `\n`). Opcionais: `SITE_ORIGIN`,
   `MP_EMAIL_PAGADOR`.
4. **Deploy**. Anote a URL final (ex.: `https://interclasse-mp.vercel.app`).

### 4. Ligar no site
No **Super Admin → aba Pagamentos**, marque **"Ativar confirmação automática (Mercado Pago)"**
e cole a **URL da Vercel**. Salve. Pronto — o botão "Pagar (PIX)" passa a usar o Mercado Pago
e o status vira "Pago" automaticamente.

## Testar (sandbox)
Use o **Access Token de teste** e um **usuário de teste** do MP para simular um PIX aprovado
sem dinheiro real. Feche um pedido de teste, clique em "Pagar (PIX)", pague no sandbox e veja
o status virar **Pago** sozinho. Os logs das funções aparecem no painel da Vercel.

## Custos
- API e webhooks do Mercado Pago: grátis.
- Taxa do MP por PIX recebido: ~0,99% (0% nos primeiros 30 dias/R$5.000 de conta nova).
- Vercel Hobby: grátis, sem cartão.

Para voltar ao PIX estático direto (grátis, sem taxa), basta **desmarcar** "Ativar Mercado
Pago" no Super Admin.
