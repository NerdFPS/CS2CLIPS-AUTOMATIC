---
name: twitch-auto-clipper
description: >-
  Transforma as VODs (transmissões anteriores) da Twitch do usuário em clipes curtos prontos para postar, de forma autônoma: baixa a VOD e o replay do chat, analisa a live inteira (picos de chat e emotes como KEKW/Pog, grito/risada na voz, palavras-chave na fala com Whisper local, multikills/ACE no killfeed do CS2, mudança de cena), dá uma nota viral 0–100 a cada momento, corta os melhores em 15–60 s começando perto do ápice, monta o vertical 9:16 com facecam em cima e jogo embaixo e o 16:9, com legendas automáticas, título sugerido, capa e cópia leve, e entrega um relatório com o link de cada momento na VOD. Também roda sozinho (comando único ou agendamento quando a live termina). Use sempre que o usuário falar em cortar/clipar a live, VOD ou stream da Twitch, achar os melhores momentos da live, fazer cortes/shorts/TikToks/Reels da live, "pega minha última live", highlights de stream, clipes automáticos, nota viral de momentos, ou automatizar cortes depois que a live termina — mesmo sem dizer "skill". Para montar um edit/montagem a partir de clipes do Medal, use a cs2-highlight-editor.
---

# twitch-auto-clipper

Da VOD da Twitch aos clipes prontos para postar. Os scripts fazem o trabalho mecânico (Twitch, chat, sinais, nota, cortes, render). Você faz a parte que exige olho: conferir os candidatos, corrigir legendas e títulos e decidir o que vale renderizar.

Scripts em `scripts/` (Node ≥ 22, sem npm; a transcrição é `transcribe.py`, executada pelo `uv`). Eles **reutilizam a cs2-highlight-editor** (ffmpeg, detector de killfeed, fontes, encoder com GPU, `make-cover`, `export-small`, `build-plan`/`render` dos presets). Ela precisa estar instalada ao lado.

| Script | Para quê |
|---|---|
| `setup.mjs` | estado das ferramentas e credenciais; grava canal, facecam, trilha do mic etc. em `config.json`; `--frame` gera um quadro com grade para achar a facecam |
| `list-vods.mjs` | VODs do canal (Helix com credenciais; yt-dlp sem login) |
| `fetch-vod.mjs` | cópia leve da VOD (~480p, só para analisar) + replay do chat (TwitchDownloaderCLI); aceita arquivo local do OBS |
| `analyze-vod.mjs` | sinais por segundo + nota viral → `candidates.json` (+ `transcript.json`, `kills.json`, `signals.json`) |
| `make-clips.mjs` | corta da fonte em alta só o trecho e renderiza 9:16 + 16:9, legenda, título, capa e cópia leve; `--plan-only` grava as legendas para revisão; `--edit zuhn` faz também a versão edit das jogadas |
| `report.mjs` | `report.md` com tempo, nota, motivo e link do momento na VOD; registra os clipes para calibração |
| `auto.mjs` | modo autônomo: VOD mais recente de ponta a ponta (`--if-new` para o agendador) |
| `schedule.mjs` | agenda o `auto.mjs` no Agendador de Tarefas (a cada 30 min ou diário) |
| `calibrate.mjs` | anota as views reais dos clipes postados e sugere novos pesos |

Os arquivos ficam em `config.dataDir` (padrão `~/Videos/TwitchAutoClipper/<id-da-vod>/`).

## Regras que não mudam
- **Só lives do próprio usuário** ou com autorização do dono do canal. Se pedirem para cortar a live de outra pessoa, pergunte se há autorização.
- **Nunca postar** em rede nenhuma e **nunca criar clipe oficial na Twitch** sem confirmação explícita. A skill só gera arquivos e o relatório.
- **Credenciais só no `.env` fora do repositório** (`~/.config/twitch-auto-clipper/.env`). Nunca peça para o usuário colar senha, Client Secret ou token no chat. Guie a criação do app com `references/setup-twitch.md`; ele mesmo cola os valores no arquivo.
- **Música:** só do NCS, com crédito (`get-music.mjs` da cs2-highlight-editor). Nunca a música que tocou na live: ela costuma ser licenciada só para a transmissão e derruba o clipe nas redes.
- A nota é uma **ordenação por sinais, não uma probabilidade**. Deixe isso claro ao falar dela; os relatórios já trazem o aviso.

## Fluxo interativo

### 0. Primeira vez
`node scripts/setup.mjs` mostra o que falta. Se o canal não estiver gravado: `setup.mjs --channel <login>`.
- **Sem credenciais:** dá para seguir, porque o yt-dlp lista as VODs públicas. A Helix só é necessária para algo mais robusto (detectar a live no ar no modo autônomo). Ofereça o guia `references/setup-twitch.md`.
- **Sem VODs no canal:** "Armazenar transmissões anteriores" está desligado ou as VODs expiraram (7 dias; afiliados 14; parceiros 60). Explique, ou use um arquivo gravado localmente (`fetch-vod.mjs C:\caminho\live.mkv`).
- **Facecam:** rode `setup.mjs --frame <vod> --at 900`, **olhe** o `quadro_grade.jpg` (a grade amarela marca cada 10%) e grave `setup.mjs --facecam x,y,w,h` com uma pequena folga em volta do rosto. Sem facecam, o vertical usa um corte central 4:5 grande do jogo (onde fica a mira) com fundo desfocado só em cima e embaixo (`verticalSemCam: zoom`, padrão); `setup.mjs --vertical inteiro` volta para o jogo inteiro numa faixa (mostra todo o HUD, mas fica pequeno no celular).
- **Gravação local com o microfone numa trilha separada** (OBS, gravação com várias trilhas): `setup.mjs --mic-track 1`. O sinal de voz fica muito mais limpo, sem tiros e música misturados.

### 1. Escolher e baixar a VOD
`list-vods.mjs`, e depois `fetch-vod.mjs <id|link>`. Ele recusa VOD ainda ao vivo. A cópia leve de uma live de 4 h tem uns 2–3 GB e leva alguns minutos; rode em segundo plano.

### 2. Analisar
`analyze-vod.mjs <id>`. Rode em segundo plano: uma VOD de 4 h leva por volta de 10–25 min (o killfeed lê o vídeo inteiro; o Whisper na GPU é rápido). Ele imprime o ranking. Depois, **confira os candidatos de verdade** antes de renderizar:
- Leia `candidates.json`: `reasons`, `quote` (o que foi dito perto do ápice), `components` (0–1 por sinal) e `killTimes`.
- Para os 3–6 melhores, extraia 2–3 quadros perto do ápice (`ffmpeg -ss <apex> -i proxy.mp4 -frames:v 1`) e olhe. Corte o que for falso positivo: grito por outro motivo, kill falso na tela de morte, menu ou inventário sem reação.
- **Kills:** o detector separa a linha do seu kill (fundo escuro) da linha da sua morte (fundo vermelho), e grava as mortes em `kills.json` (`deaths`). Assistências ainda contam como kill. Se algo parecer errado, recorte o killfeed nos tempos (`crop=iw*0.38:ih*0.24:iw*0.62:ih*0.04`), olhe e grave a lista certa em `kills_verificados.json` (`{"kills":[...]}`) na pasta da VOD; o `analyze-vod` usa essa lista no lugar da detecção.
- Ajuste `start`/`end` se o gancho estiver fraco. Pelo estudo, o clipe deve abrir numa fala ou ação, com ~10–15 s de contexto antes do ápice, e terminar ~5–8 s depois dele.

### 3. Títulos e legendas
- **Títulos:** os automáticos são só um rascunho. Reescreva no campo `title` do `candidates.json` no estilo dos virais: curto, tom de reação ou história, nome ou número quando houver ("4K com 120 de ping 😳", "eu não acredito nisso 💀"), em pt-BR ou no idioma do público. O emoji fica no título do post; no vídeo ele é removido, porque a fonte não tem emoji.
- **Legendas:** `make-clips.mjs <id> --plan-only --top N` grava `captions` em cada candidato. Leia e **corrija os erros do Whisper**: nomes, gírias, termos de CS ("ACE", "um contra três", "bala") e principalmente palavras ouvidas errado que mudam o sentido ou constrangem. Apague as legendas sem sentido. Use blocos curtos de 1–4 palavras.

### 4. Gerar
`make-clips.mjs <id> --top N` (ou `--ranks 1,3,4`). Cada clipe sai em `clips/NN_titulo/` com `_9x16.mp4`, `_16x9.mp4`, as capas e `_9x16_celular.mp4` (≤ 28 MB).
- **Versão edit das jogadas** (2K ou mais): `--edit zuhn` (clipe de live comentado) ou `--edit frogling-velocity` (jogada com speed ramp). Com música: busque no NCS (`get-music.mjs` da cs2-highlight-editor), passe `--music arquivo.mp3` e repasse o crédito ao usuário.
- **Confira um quadro do 9:16** no ápice e um no começo. A legenda tem que estar legível, fora dos ~400 px de baixo; a facecam enquadrada; o killfeed visível nas jogadas.

### 5. Relatório
`report.mjs <id>` gera o `report.md`. Mostre ao usuário a tabela (momento com link, nota, motivo, título e arquivos), diga o que não foi conferido e lembre que nada foi postado. Se ele postar, use `calibrate.mjs --set <vod>:<rank> --views N --platform tiktok` depois de alguns dias; com 15 ou mais clipes, `calibrate.mjs --apply` ajusta os pesos.

## Modo autônomo
- **Uma vez:** `node scripts/auto.mjs` processa a VOD mais recente que não está ao vivo: baixa, analisa, gera os `topN` clipes, faz o relatório e mostra um aviso na área de trabalho. As legendas e os títulos ficam automáticos e o relatório avisa que não foram revisados. Sugira ao usuário revisar com você antes de postar.
- **Agendado** (só com o "sim" do usuário, porque cria uma tarefa no Windows): `schedule.mjs --every 30` checa a cada 30 min se a live acabou e há VOD nova (`--if-new`). Também dá para usar `--daily 04:00`. `--status` mostra e `--remove` desfaz. O log fica em `<dataDir>/auto.log`.
- **Nada é postado nem criado na Twitch**, nem no modo autônomo.

## Como a nota funciona
Detalhes e pesos em `references/scoring.md`; a base é o estudo de 175 clipes virais em `references/viral-notes.md`. Em resumo:

nota = 100 × Σ peso × sinal (0–1)

| Sinal | Peso inicial |
|---|---|
| Kills do POV (2K, 3K, 4K, ACE) | 30 |
| Voz acima da base do stream | 25 |
| Chat acima do normal, mais emotes de reação, deslocado pelo atraso estimado | 25 |
| Palavras-chave da fala | 15 |
| Mudança de cena | 5 |

Ajustes na nota:
- +5 quando dois sinais fortes coincidem;
- −10 quando o começo do recorte é parado.

Se faltar algum sinal (sem chat, sem transcrição), os pesos são redistribuídos entre os que existem, e o relatório diz quais foram usados.

## Problemas comuns
- **Transcrição falhou ou caiu na CPU:** o `transcribe.py` usa o `uv run --no-build` com Python 3.12, faster-whisper 1.2.1, `av<15` e as DLLs do CUDA 12 (wheels `nvidia-*`). "Visual C++ required" = faltou o `--no-build` ou o Python 3.12. `--no-transcript` analisa sem a fala.
- **Nenhum kill detectado:** HUD diferente, overlay em cima do killfeed ou resolução baixa demais. Ajuste `setup.mjs --killfeed x,y,w,h` olhando um quadro, ou use `--no-killfeed`.
- **Chat vazio:** destaques e reruns não têm chat, e às vezes o chat ficou desativado. A nota segue sem esse sinal.
- **VOD exclusiva para inscritos:** o yt-dlp precisa de cookies da conta; peça ao usuário para deixar a VOD pública ou usar a gravação local.
- **Clipe começa no meio da frase ou corta a reação:** ajuste `start`/`end` no `candidates.json` e rode `make-clips` de novo com `--ranks`.
