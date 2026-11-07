# Conectar a Twitch (o usuário faz; você só guia)

Nunca peça o Client Secret, um token ou senha no chat. O usuário cola os valores direto no arquivo `.env`; os scripts só leem o arquivo.

## Precisa mesmo?
- **Para listar e baixar as VODs públicas do próprio canal:** não. O yt-dlp faz isso sem login.
- **Com credenciais (API Helix) fica melhor:** a lista de VODs é oficial e estável, e o modo autônomo sabe se a live ainda está no ar antes de processar.
- **Escopo:** nenhum. Um token de **app** (client credentials) basta para ler vídeos e lives públicos. Escopos de usuário (ex.: `clips:edit`) só seriam necessários para criar clipes oficiais na Twitch, o que a skill não faz sem confirmação. Por isso não pedimos token de usuário: menos permissões, menos risco.

## Passo a passo (5 min)
1. Entre em https://dev.twitch.tv/console/apps com a conta da Twitch e clique em **Register Your Application**. A Twitch exige verificação em duas etapas (2FA) ligada na conta para registrar apps.
2. Preencha:
   - **Name:** algo único, ex. `twitch-auto-clipper-<seu-nick>`
   - **OAuth Redirect URLs:** `http://localhost:3000` (não é usado, mas o campo é obrigatório)
   - **Category:** Application Integration
   - **Client Type:** Confidential
3. Clique em **Create**, depois em **Manage** no app criado. Copie o **Client ID** e clique em **New Secret** para gerar o **Client Secret**. Ele só aparece uma vez.
4. Crie o arquivo `C:\Users\<você>\.config\twitch-auto-clipper\.env` (no macOS/Linux, `~/.config/twitch-auto-clipper/.env`) com:
   ```
   TWITCH_CLIENT_ID=cole_aqui
   TWITCH_CLIENT_SECRET=cole_aqui
   ```
   No Windows, pelo Bloco de Notas: Salvar como → Tipo "Todos os arquivos" → nome `.env`.
5. Teste: `node scripts/setup.mjs`. A linha de credenciais deve dizer "OK (token de app)".

O arquivo fica fora de qualquer repositório. O token gerado é guardado em `app-token.json`, na mesma pasta, e renovado sozinho. Para revogar tudo: dev.twitch.tv → app → Manage → New Secret (o antigo deixa de valer).

## VODs
- Ligue **Armazenar transmissões anteriores** em twitch.tv/dashboard/settings/stream (ou Configurações → Transmissão).
- Depois de 7 dias (afiliados 14, parceiros/Turbo 60) a Twitch apaga a VOD. O modo autônomo agendado evita perder lives.
- Se a VOD for só para inscritos, o yt-dlp não baixa sem login. Use a gravação local do OBS.

## Gravação local (opcional, melhor qualidade de sinal)
No OBS, em Configurações → Saída → Gravação, marque mais de uma trilha de áudio e deixe o microfone sozinho numa delas (ex.: trilha 2). Depois:
- rode `setup.mjs --mic-track 1` (o índice começa em 0);
- e `fetch-vod.mjs arquivo.mkv --vod-id <id da VOD na Twitch>`, para baixar também o chat daquela live.
