---
name: cs2-highlight-editor
description: Edita automaticamente vídeos de highlight/montagem de CS2 (Counter-Strike 2, também CS:GO e outros FPS) a partir de clipes (Medal, ShadowPlay, Outplayed...), copiando o estilo de uma referência — um vídeo, um link (YouTube, Instagram Reel, TikTok) ou um canal inteiro do YouTube (analisa os últimos N vídeos) — ou de um preset pronto (zuhn, reel rápido, frag movie). Acha os kills do jogador pelo killfeed, escolhe material na biblioteca do Medal (ex.: clipes "3K"), busca música livre de direitos (NCS) e começa no drop, e monta o vídeo com cortes no beat ou pela jogada, slow-motion com barras de cinema, zoom, tremida, flash, motion blur, legendas de comentário e textos ("ACE", "4K"), em 16:9 e 9:16, com cópia leve para celular. Use sempre que o usuário quiser editar, montar ou renderizar clipes, frags, jogadas, aces, clutches ou um highlight/montage/edit de CS2, CS:GO, Valorant ou outro FPS — inclusive "faz no estilo do canal X", "usa meus clipes do Medal", "testa duas versões" — mesmo sem falar em "skill" ou "modelo".
---

# Editor de highlights de CS2

A skill transforma clipes brutos num highlight pronto, imitando uma referência. Os scripts fazem a parte mecânica (baixar, medir, detectar, cortar, renderizar com ffmpeg). Você faz a parte que exige olho: ler a referência, conferir os kills, escolher e ordenar o material, escrever legendas.

Scripts em `scripts/` (Node.js ≥ 22, sem npm). Rode com `node <skill>/scripts/<script>.mjs`. Precisam de `ffmpeg`/`ffprobe`; `yt-dlp` só para baixar referências e músicas. No Windows, os scripts acham as versões do winget mesmo fora do PATH. GPU NVIDIA (h264_nvenc) é usada sozinha quando existe.

| Script | Para quê |
|---|---|
| `fetch-reference.mjs` | baixa um vídeo de referência (link) ou os últimos N de um canal |
| `analyze-reference.mjs` | analisa UMA referência: cortes, BPM, beat, flashes, cor, folhas de imagens |
| `analyze-channel.mjs` | roda o anterior em vários vídeos e agrega (estilo de um canal) |
| `analyze-batch.mjs` | estudo rápido de dezenas/centenas de refs: métricas, percentis, correlação com views, mosaicos |
| `medal-titles.mjs` | lista clipes do Medal pelo título automático ("👊3K - Mirage") |
| `find-multikills.mjs` | varre muitos clipes e dá os tempos dos kills (moldura vermelha) |
| `analyze-clips.mjs` | análise detalhada de poucos clipes + rascunho de `kills.json` |
| `verify-kills.mjs` | tiras de imagem do killfeed em cada kill + avisos de suspeitos |
| `get-music.mjs` | busca/baixa música NCS, BPM, drops, crédito |
| `build-plan.mjs` | monta o `plan.json` (cortes, beat, slow-mo, efeitos, textos) |
| `render.mjs` | renderiza 16:9 e 9:16 (`--preview` para prévia rápida) |
| `export-small.mjs` | cópia que cabe no limite do celular/WhatsApp (padrão 28 MB) |
| `make-cover.mjs` | capa/thumbnail (16:9 ou 9:16) com o quadro do kill-herói e título grande |

## Estrutura de trabalho

```
modelo/                  ← reutilizado entre vídeos
  referencia.mp4         ou: link/canal (baixe com fetch-reference)
  musica.mp3             opcional (senão, get-music)
  estilo.json            gerado por você; pode herdar um preset: {"preset": "zuhn", ...}
  intro.mp4 / outro.mp4 / logo.png / fonte.ttf / lut.cube / notas.txt   opcionais
clipes/                  ← clipes da vez (ou uma lista vinda do Medal)
```
Os nomes não precisam ser exatos; se faltar referência ou clipes, pergunte. Clipes do Medal: `Videos\Medal\Clips\Counter-Strike 2\`. `notas.txt` tem prioridade sobre o que você inferir.

## Fluxo

### 0. Pré-requisitos
`ffmpeg -version` (e `yt-dlp --version` se for baixar algo). Se faltar, **peça permissão** antes de instalar: `winget install Gyan.FFmpeg` / `winget install yt-dlp.yt-dlp` (macOS: brew; Linux: apt/pipx).

### 1. Estilo
Escolha o caminho conforme o pedido:

- **Preset** (o usuário citou um estilo conhecido ou quer algo rápido): `presets/zuhn.json` (YouTuber de gameplay), `zuhn-montagem.json` (zuhn + cortes no beat), `frogling-velocity.json` (edit musical rápido com speed ramp, ≤1 min, ótimo para 4K/ACE), `frogling-cinema.json` (frogling + zuhn), `completo.json` (vitrine com todos os recursos: título, palavras no beat, efeitos sonoros, arco, velocity...; troque o nick), `reel-rapido.json` (Reel/TikTok rápido e quente), `frag-movie.json` (montagem agressiva clássica). Leia o `_sobre` de cada um e `references/channel-notes.md` (o que já se sabe de cada referência). Crie `estilo.json` com `{"preset": "<nome>", "music": {"file": "..."}}` e só o que mudar.
- **Um vídeo de referência** (arquivo ou link): `fetch-reference.mjs <url> --out modelo` se for link (Instagram privado: abra no navegador embutido, recuse cookies opcionais e baixe o MP4 do primeiro `video_versions` do HTML). Depois `analyze-reference.mjs modelo/referencia.mp4`.
- **Um canal** ("no estilo do canal X", "analisa os últimos 20 vídeos"): `fetch-reference.mjs https://youtube.com/@canal --last 20 --out refs/canal` (360p basta; `--shorts` para a aba Shorts), depois `analyze-channel.mjs refs/canal`. Leia `channel-summary.json` (traz `hints`) e **olhe as amostras** em `_analise/_amostras/` (início e meio de alguns vídeos). Vídeos longos levam alguns minutos cada; rode em segundo plano.

Ao olhar as imagens, procure o que os números não pegam: legendas/textos (posição, cor, fonte, tom), replays em câmera lenta e barras de cinema, zoom/tremida no kill, motion blur, grade de cor, transições, intro/fim. Cuidado com falsos sinais: a mira da AWP entrando/saindo e replays geram "cortes" e "flashes" na análise.

Escreva `modelo/estilo.json` seguindo `references/style-guide.md` (tabela observação → parâmetro e esquema completo). Inclua `"_observacoes"` com 3 a 6 linhas do que viu.

### 2. Material
- **Pasta pequena / clipes escolhidos pelo usuário**: `analyze-clips.mjs clipes/` → rascunho `_analise_clipes/kills.json` + folhas `killfeed_*.jpg`/`overview_*.jpg`.
- **Biblioteca grande** ("meus clipes do Medal", "os que têm 3K"): `medal-titles.mjs --match 3K --out medal_3k.json` (lê o banco do Medal numa cópia, somente leitura) e `find-multikills.mjs medal_3k.json --min 3 --jobs 3` (retoma se interrompido; ~3 s por clipe com GPU). Prefira clipes em que o número detectado bate com o título (3 kills num "3K"). Varie mapas e armas, e não repita clipes entre vídeos diferentes nem entre vídeos já entregues.

**Como os kills são detectados:** no CS2, as linhas do killfeed em que **o próprio jogador mata** têm moldura vermelha; as mortes dele não têm. O detector conta essas molduras. Acerta a grande maioria, mas: (a) às vezes perde um kill quando a linha cai sobre um painel escuro (net graph); (b) a tela vermelha da morte do jogador pode virar um kill falso perto do fim do clipe. Por isso rode `verify-kills.mjs kills.json` e **olhe as tiras** (cada linha = 1 s antes a 1,5 s depois do kill), começando pelos "suspeitos" que ele lista. O nick do jogador aparece nas linhas com moldura e no cartão de MVP. Se o HUD for diferente, use `--killfeed x,y,w,h` (frações da tela).

Clipes do Medal/ShadowPlay têm várias trilhas de áudio; usa-se a primeira (mistura do jogo). Kills espaçados viram trechos separados do mesmo clipe (`pacing.maxGap`), então não precisa recortar tempo morto.

Edite `kills.json`:
- **Ordem**: abertura forte (cai no drop da música), o melhor (ACE, clutch, mais kills, pouca vida) no fim, alternando mapas e armas.
- **label**: "ACE", "4K", "1v3", "CLUTCH" quando fizer sentido.
- `headshot: true` quando o ícone aparecer; `"fx": {"slowmo": true}` sobrescreve a regra do estilo.
- **Legendas de comentário** (estilo YouTuber): `"texts": [{"t": 6.2, "text": "eles nem viram"}]`, `t` no tempo do clipe. Escreva como fala: minúsculas, 1 a 4 palavras, reagindo ao momento (antes do kill gera expectativa; depois, reage). Uma a cada 1 ou 2 clipes. Idioma do público do usuário. Se o clipe tiver a voz do jogador na trilha do microfone, prefira transcrever o que ele disse.

Só pergunte ao usuário o que for realmente ambíguo.

### 3. Música
Se o usuário não deu música: `get-music.mjs --search "phonk"` (só lista faixas do canal oficial **NCS**, livres para YouTube com crédito), escolha pelo clima (phonk/brazilian phonk/funk para montagem; phonk mais calmo para gameplay estilo YouTuber) e `get-music.mjs --get <id> --out musicas`. Ele salva o `.credito.txt`: **passe o crédito ao usuário** para a descrição do vídeo. Nunca use música de outros canais sem o usuário confirmar que pode. `get-music.mjs --analyze arquivo.mp3` mostra BPM, energia e drops de qualquer música. No estilo, `"music": {"start": "drop"}` faz o 1º kill cair no drop.

### 4. Plano e render
```
node scripts/build-plan.mjs --style modelo/estilo.json --kills kills.json --out plan.json
node scripts/render.mjs plan.json --preview      # 540p rápido
node scripts/render.mjs plan.json                # final 1080p60: <nome>_16x9.mp4 e _9x16.mp4
```
Leia o resumo do plano (trechos > ~8 s ou curtos demais → ajuste `pacing` ou edite `plan.json`, que tem `pieces` e `events` legíveis). Na prévia, calcule os tempos de alguns eventos (some `outDuration` dos segmentos + `t` do evento) e extraia quadros ali: legenda legível e dentro da tela? Slow-mo mostra o kill (não a tela de morte)? Cor parecida com a referência? Corrija e só então faça o final.

### 5. Testes A/B
Quando o usuário quiser "testar" estilos ou pedir mais de um vídeo: faça variações que mudem uma ideia clara (ex.: cortes pela jogada × no beat; música baixa × em destaque), cada uma com seu `estilo.json`, em pastas `A/`, `B/`. Use clipes diferentes em cada vídeo se forem publicados separados. Explique em uma tabela o que muda entre eles.

### 6. Entrega
`export-small.mjs <video...>` gera cópias que cabem no limite de envio (o arquivo final em 1080p60 pode passar de 100 MB). Informe caminhos, duração, quantos clipes/kills, decisões (ordem, labels, legendas, onde há slow-mo), créditos de música e o que não foi conferido. Ajustes como "mais rápido", "sem legenda" ou "texto maior" = mudar `estilo.json` + novo render (sem refazer a análise).

## Regras de ofício (de editores, guias, skills e do estudo de 121 edits)
- **Não picote**: os edits de CS2 mais vistos cortam ~13–16 vezes por minuto, com plano mediano ≥ 2 s e 25–40% dos planos com mais de 4 s. Os menos vistos cortam 20+/min. O `build-plan` mostra essa comparação: leia e corrija os ⚠.
- **Gancho nos primeiros 1–2 s**: comece pelo ápice (`coldOpen`) e nunca com tela preta parada. Título curto (≤ 1 s) ou nenhum.
- **Flash é pontuação**: ~3–4 por minuto (`effects.flash.maxPerMin`).
- **Créditos e marca**: `outroCard` (crédito da música no próprio vídeo) e `watermark`.
- **Slow-mo com som**: abafe a música no trecho lento (`audio.muffleSlowmo`) para o tiro do jogo aparecer.
- **Upload no YouTube**: entregue também a versão 1440p (`output.youtube1440`); diga ao usuário que a qualidade final só aparece depois que o YouTube termina de processar o HD.
- **Shorts/TikTok**: nada importante nos ~400 px de baixo nem na lateral direita (botões e título do app). Com legendas, use `output.vertical: "blur"`; o `build-plan` avisa.
- **O inimigo aparece antes de morrer e morre dentro do trecho**: `minPreRoll` ≥ 0,3 s e `postRoll` ≥ 0,35 s. Nunca um kill 4 quadros depois do corte.
- **O maior momento no drop**, e o melhor clipe no fim. Use arco (`pacing.arc`) e ordene do mais fraco ao mais forte.
- **Corte seco é a melhor transição**: transições e efeitos são acento, não regra. Flash/tremida/zoom em todo kill cansam e escondem a jogada; prefira `"last"` (o kill decisivo de cada clipe).
- **Zoom só como acento curto** (entra e sai), nunca parado enlarguecendo a imagem.
- **Uma cor no vídeo inteiro** (grade consistente).
- **Som**: a música não pode engolir o tiro decisivo (`sfx.duckHero`); um impact por vídeo, um riser até o drop, whoosh discreto nos cortes; −14 LUFS.
- **Evite os clichês** (paródia "every cringe fragmovie"): tempo morto, girar faca esperando, jogada sem kill, efeito em tudo.
- **Vertical**: se o killfeed/HUD importa, `vertical: "blur"` (janela sobre fundo desfocado) em vez de cortar.

## Erros comuns
- **ffmpeg falhou**: o erro mostra o comando e as últimas linhas. Textos vão por arquivo (sem problema com `'`/`:`). Se `h264_nvenc` falhar, `CS2HL_NO_GPU=1`.
- **Slow-motion picotado**: use `slowmo.interpolate: "blend"` (leve) ou `"mci"` (suave, lento de renderizar).
- **Vertical cortando texto ou killfeed poluído** (net graph no HUD): `output.vertical: "crop"`; mantenha textos centralizados.
- **Volume abaixo de −14 LUFS**: a música tem picos altos e o limitador protege contra distorção; esperado.
- **Nome de arquivo começando com "-"** (IDs do YouTube): em shell, use `./arquivo` ou listas por `printf '%s\n' ./*.mp4`.
