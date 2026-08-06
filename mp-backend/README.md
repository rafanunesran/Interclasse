# Backend de pagamento (Mercado Pago) — Interclasse

Backend serverless que dá **confirmação automática de PIX**: quando o pagamento cai, o
Mercado Pago avisa este backend (webhook), que marca o aluno como **Pago** no Firestore.
O site então atualiza o status sozinho, sem recarregar.

Roda de graça na **Vercel** (plano Hobby, sem cartão). Funções:

- `api/criar-preferencia.js` — **Checkout Pro** (padrão): cria uma preferência e devolve a URL
  da página hospedada do Mercado Pago; o site redireciona o pagador para lá (com o layout do MP,
  QR gerado pelo próprio MP). O valor é calculado aqui pelo tamanho do aluno (nunca vem do cliente).
- `api/webhook-mp.js` — recebe o aviso do Mercado Pago (payment e merchant_order), valida a
  assinatura e grava `pago: true` no aluno.
- `api/criar-pagamento.js` — alternativa "transparente" (QR dentro do próprio site). Não é usada
  pelo padrão atual, fica disponível se quiser trocar.
- `api/status.js` — health check. A raiz `/` é redirecionada para cá (via `vercel.json`), então
  abrir a URL base mostra um JSON confirmando que o backend está no ar (em vez de um 404).

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

### 3.1. Conferir se o deploy funcionou
Abra a **URL base** no navegador (ex.: `https://interclasse-mp.vercel.app/`). Deve aparecer
um JSON de status, tipo:

```json
{ "ok": true, "service": "interclasse-mp-backend", "env": { "MP_ACCESS_TOKEN": true, ... } }
```

- Se aparecer esse JSON, o backend está no ar. Confira que as variáveis em `env` estão
  `true` (as que estiverem `false` não foram cadastradas nas Environment Variables).
- Se aparecer o **404 NOT_FOUND da Vercel**, quase sempre o **Root Directory** não está como
  `mp-backend`. Corrija em **Project → Settings → Build & Deployment → Root Directory =
  `mp-backend`** e refaça o deploy.

> Um jeito rápido de testar as funções por fora: `curl -X POST .../api/criar-preferencia`
> (sem corpo) deve responder **400** ("Informe turmaId e alunoId."). Se responder **404**, o
> Root Directory está errado.

### 4. Ligar no site
No **Super Admin → aba Pagamentos**, marque **"Ativar confirmação automática (Mercado Pago)"**
e cole a **URL da Vercel**. Use só a **URL base** (`https://seu-projeto.vercel.app`), **sem**
`/api/...` no final — o site já acrescenta o caminho. Salve. Pronto — o botão "Pagar (PIX)"
passa a usar o Mercado Pago e o status vira "Pago" automaticamente.

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
