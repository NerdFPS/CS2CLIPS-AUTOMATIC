# twitch-auto-clipper

**Da VOD da Twitch aos cortes prontos para postar, com o Claude Code.**

Você termina a live e diz "pega minha última live e faz os cortes". O Claude baixa a VOD e o replay do chat, analisa a live inteira e dá uma **nota de 0 a 100** a cada momento. Depois corta os melhores trechos em clipes de 15 a 60 s e entrega para cada um:
- o **vertical 9:16** (TikTok, Shorts, Reels);
- o **16:9**;
- **legendas** da sua fala;
- **título sugerido**;
- **capa**;
- **cópia leve para o celular**;
- um **relatório** com o link de cada momento na VOD.

Também roda sozinha: um comando processa a live mais recente, ou um agendamento faz isso quando a live acaba.

É uma *skill* do [Claude Code](https://claude.com/claude-code) e faz par com a [cs2-highlight-editor](../cs2-highlight-editor), deste mesmo repositório: reaproveita o FFmpeg, as fontes, o encoder com GPU, as capas, a cópia leve e os presets de edição dela.

> Feita para CS2 em português do Brasil. Os sinais de voz, chat e fala servem para qualquer jogo; o de kills é específico do HUD do CS2.

---

## O que ela faz

**Busca a live**
- Lista as VODs do canal. Sem login, usa o yt-dlp; com credenciais, a API Helix oficial da Twitch, que também avisa quando a live ainda está no ar.
- Baixa uma **cópia leve (480p)** só para analisar e o **replay do chat** com o [TwitchDownloaderCLI](https://github.com/lay295/TwitchDownloader).
- Aceita também um **arquivo gravado pelo OBS**. Com o microfone numa trilha separada, o sinal de voz fica bem mais limpo.

**Dá a nota de cada momento**

| Sinal | Como é medido | Peso inicial |
|---|---|---|
| **Kills** | Lê o killfeed do CS2 e separa a linha do **seu kill** (moldura vermelha, fundo escuro) da linha da **sua morte** (fundo vermelho). Ignora menus e inventário, e marca rajadas (2K, 3K, 4K, ACE) | 30 |
| **Voz** | Volume da sua voz acima da base da própria live, em dB (grito, risada) | 25 |
| **Chat** | Mensagens e emotes de reação (KEKW, Pog, "clip", ???) acima do normal. O atraso do chat é estimado em cada VOD | 25 |
| **Fala** | Palavras-chave na transcrição feita localmente pelo Whisper: "não acredito", "clipa", ACE, palavra repetida | 15 |
| **Cena** | Mudança brusca de imagem | 5 |

Os pesos vêm de um estudo de **175 clipes de CS2 que viralizaram** (Twitch, Shorts e verticais da Twitch), em [`references/viral-notes.md`](references/viral-notes.md). Faltando algum sinal (chat fraco, sem transcrição), o peso dele vai para os outros.

> **A nota é uma ordenação por sinais, não a chance real de viralizar.** O relatório deixa isso claro. Depois de postar, anote as views com `calibrate.mjs`: com 15 clipes ou mais, ele ajusta os pesos para o seu público.

**Corta e monta**
- O corte vai de ~12 s antes do ápice a ~7 s depois dele, encaixado no começo de uma frase e no fim da reação. O estudo mostrou que o pico de áudio fica no meio dos clipes que viralizam.
- Do vídeo original, ela baixa **só o trecho do clipe em 1080p**, sem baixar a VOD inteira em alta.
- **Vertical com facecam:** a câmera em cima e o jogo embaixo, layout de 69% dos Shorts de CS no estudo. O killfeed aparece por cima nas jogadas.
- **Vertical sem facecam:** um corte central grande do jogo, com fundo desfocado só no topo e no rodapé.
- **Versão edit** opcional das jogadas, com os presets `zuhn` ou `frogling-velocity` da cs2-highlight-editor. Música só do NCS, com crédito.

---

## Instalação

### 1. Requisitos

Tudo da cs2-highlight-editor (Node.js 22+, FFmpeg, yt-dlp), mais:

| Programa | Para quê | Windows | macOS / Linux |
|---|---|---|---|
| [uv](https://docs.astral.sh/uv/) | roda a transcrição (Whisper local, sem conta) | `winget install astral-sh.uv` | `brew install uv` / `pipx install uv` |
| [TwitchDownloaderCLI](https://github.com/lay295/TwitchDownloader/releases) | replay do chat | baixe o `.zip` da release e ponha o `.exe` em `~/.local/share/twitch-auto-clipper/bin/` | idem, binário Linux/macOS |

Uma GPU NVIDIA é opcional: acelera o Whisper e o render. Sem ela, tudo roda na CPU, mais devagar.

### 2. Instalar as duas skills
```bash
npx skills add NerdFPS/CS2CLIPS-AUTOMATIC -g -y
```
Ou copie `skills/cs2-highlight-editor` e `skills/twitch-auto-clipper` para `~/.claude/skills/`.

### 3. Primeira vez
```bash
node ~/.claude/skills/twitch-auto-clipper/scripts/setup.mjs --channel SEU_CANAL
```
O comando mostra o que falta. No painel da Twitch, ligue **Configurações → Transmissão → Armazenar transmissões anteriores**. A Twitch apaga as VODs depois de 7 dias (afiliados: 14; parceiros: 60).

**Credenciais são opcionais.** Para usar a API oficial, siga [`references/setup-twitch.md`](references/setup-twitch.md):
- crie um app em dev.twitch.tv;
- cole o Client ID e o Secret num `.env` em `~/.config/twitch-auto-clipper/`, fora de qualquer repositório;
- nenhuma permissão (escopo) é pedida;
- nunca cole token ou senha no chat.

---

## Como usar

Basta pedir ao Claude:
- *"pega minha última live e faz os cortes para o TikTok"*
- *"acha os melhores momentos da live de ontem"*
- *"faz o corte do ACE em vertical com legenda"*
- *"roda isso sozinho toda vez que a live acabar"*

No fluxo normal, o Claude:
1. analisa a live e **olha os quadros** dos melhores candidatos para descartar falsos positivos;
2. **revisa as legendas**, porque o Whisper erra gírias e nomes;
3. reescreve os títulos e gera os clipes;
4. mostra o relatório.

**Nada é postado em rede nenhuma, nem vira clipe oficial na Twitch, sem a sua confirmação.**

### Scripts (dá para usar sem o Claude)
| Script | Para quê |
|---|---|
| `setup.mjs` | estado das ferramentas; grava canal, facecam (`--facecam x,y,w,h`, ou `--frame` para achar a posição), trilha do mic, layout do vertical (`--vertical zoom\|inteiro`) |
| `list-vods.mjs` | VODs do canal |
| `fetch-vod.mjs <id\|link\|arquivo>` | cópia leve + chat |
| `analyze-vod.mjs <id>` | sinais e nota → `candidates.json` |
| `make-clips.mjs <id> --top 6` | clipes 9:16 + 16:9; `--plan-only` grava as legendas para revisar; `--edit zuhn` faz a versão edit |
| `report.mjs <id>` | `report.md` |
| `auto.mjs` | tudo de ponta a ponta na VOD mais recente |
| `schedule.mjs --every 30` | agenda o `auto.mjs` no Agendador de Tarefas (Windows) |
| `calibrate.mjs --set <vod>:<rank> --views N` | anota as views reais e sugere novos pesos |

Os arquivos ficam em `~/Videos/TwitchAutoClipper/<vod>/`.

---

## Testado em
Uma live real de 1h33 (partidas FACEIT e Premier), 1080p60, analisada inteira em **~9 min** numa RTX 4060:
- 7 min para ler o vídeo (killfeed e cena);
- 2 min para transcrever a fala na GPU;
- 4 clipes gerados em ~2,5 min.

O detector de kills foi conferido linha a linha num gabarito de 97 detecções dessa live: acha **26 de 29 kills**, com 6 falsos (2 no aquecimento). Um detector ingênuo, que conta toda moldura vermelha, acertava só 27%, porque contava a própria morte e menus.

## Limitações (leia)
- **Assistências contam como kill.** Para separar, seria preciso ler os nomes.
- **Killfeed** só no HUD padrão do CS2, na posição padrão. Overlays por cima atrapalham.
- **Voz numa VOD da Twitch** vem misturada com o jogo: tiros também sobem o volume. A gravação do OBS com o mic numa trilha separada resolve.
- **Chat fraco** (menos de 1 mensagem por minuto) é ignorado.
- **O Whisper erra** palavras e às vezes desalinha o tempo. Revise as legendas antes de postar (o relatório avisa quando não foram revisadas).
- **Live sem grande jogada dá notas baixas.** Isso é esperado: a nota compara os momentos daquela live.
- Só processe **lives suas** ou com autorização do dono do canal.
- **Música:** nunca use a que tocou na live, porque ela costuma ser licenciada só para a transmissão. Use o NCS, com crédito.

## Licença
MIT, como o resto do repositório.
