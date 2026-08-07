# Imagem da camiseta via Google Drive + Apps Script

Alternativa **gratuita** ao Firebase Storage (que exige plano pago) para guardar a imagem da
camiseta de cada turma. O Apps Script recebe a imagem do site, salva no seu Google Drive
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

No **Super Admin → aba Inicial**, em cada turma há o botão **"Enviar imagem da camiseta"**.
Ao escolher uma foto, ela é enviada ao seu Drive e passa a aparecer:
- no **card da turma** (tela inicial),
- na **página da turma** (referência para os alunos),
- no próprio card do Super Admin.

O site reduz a imagem para no máximo ~1200px antes de enviar (fica leve). As imagens ficam numa
pasta chamada **"Interclasse Camisetas"** no seu Drive.

## Observações

- Só a **URL** da imagem é guardada no Firestore (a imagem em si fica no seu Drive) — nada de
  plano pago do Firebase.
- Se um dia trocar o Apps Script, atualize a URL nas Configurações. Imagens já enviadas continuam
  funcionando (a URL aponta direto para o arquivo no Drive).
