# CS2CLIPS AUTOMATIC

**Edição automática de highlights de Counter-Strike 2 com o Claude Code.**

Você aponta seus clipes (Medal, ShadowPlay, Outplayed...) e diz o estilo. O Claude acha os seus kills sozinho, escolhe a ordem, busca música livre de direitos, corta no beat e renderiza o vídeo pronto em **16:9 (YouTube)**, **9:16 (Shorts/TikTok/Reels)**, **1440p para upload no YouTube**, com **capa** e **cópia leve para celular**.

É uma *skill* do [Claude Code](https://claude.com/claude-code): um pacote de instruções + scripts que o Claude usa quando você pede para editar clipes. Os scripts fazem a parte mecânica (medir, detectar, cortar e renderizar com FFmpeg); o Claude faz a parte que exige olho (ler a referência, conferir os kills nas imagens, ordenar, escrever legendas).

> Feito em português do Brasil. Funciona no Windows, macOS e Linux. GPU NVIDIA é opcional (acelera o render).

---

## O que ela faz

**Entende o seu material**
- Acha **os seus kills** pelo killfeed do CS2 (as linhas em que você mata têm moldura vermelha) — sem marcar nada à mão.
- Gera **tiras de imagens** do killfeed em cada kill para conferência rápida e avisa dos suspeitos (sua morte no fim do clipe, kills duplicados).
- Lê a **biblioteca do Medal**: lista seus clipes pelo título automático (`👊3K - Mirage`, `🔥4K`, `♠️Ace`...) e varre centenas de clipes atrás de multikills.
- Corta o **tempo morto** sozinho: kills distantes viram trechos separados do mesmo clipe.

**Copia um estilo**
- De **um vídeo** (arquivo ou link do YouTube, Instagram Reel, TikTok).
- De **um canal inteiro** (analisa os últimos N vídeos e tira a média do estilo).
- De **um preset pronto** (veja abaixo).
- Mede ritmo de cortes, BPM, cortes no beat, flashes, cor, barras de cinema, início/fim — e gera folhas de imagens para o Claude olhar o que os números não pegam.

**Música**
- Busca e baixa músicas do **NoCopyrightSounds (NCS)** — livres para o YouTube com crédito — e salva o crédito pronto para a descrição.
- Detecta **BPM, beats e o drop**; o vídeo começa de modo que **o primeiro kill caia no drop**.

**Edição** (tudo configurável por um `estilo.json`)
- Cortes **no beat** ou **pela jogada**, com **arco de energia** (jogadas mais longas no início, mais curtas no clímax).
- **Cold open**: abre com o melhor kill em câmera lenta (gancho dos primeiros 1–2 s).
- **Velocity / speed ramp** (lento no kill, acelera depois) com rampa suave e interpolação.
- **Slow-motion com barras de cinema** (letterbox) e **música abafada** durante o lento.
- **Zoom punch, tremida com rotação, flash, RGB split, bloom (estouro de luz), pulso de zoom no grave**.
- **Motion blur**, **grade de cor** (contraste, saturação, tom quente/frio, azul-petróleo/laranja, LUT, vinheta, grão).
- **Transições**: corte seco, blur-in, ou xfade (zoom, borrão, flash branco, radial...), alternadas.
- **Textos**: cartão de título, palavras no beat, legendas de comentário (estilo YouTuber), contador 2K/3K/4K, rótulos ("ACE", "4 ONE TAPS"), marca d'água e **créditos no fim** (com a música).
- **Efeitos sonoros sintetizados** (sem samples, sem direitos): whoosh nos cortes, impact no kill-herói, riser até o drop, com *ducking* da música.
- Volume final em **−14 LUFS** (padrão de YouTube/TikTok).

**Saída**
- `*_16x9.mp4` (1080p60), `*_9x16.mp4` (vertical: corte central, killfeed ampliado ou o jogo inteiro numa janela sobre fundo desfocado), `*_youtube1440.mp4`, capa `.jpg` e `*_celular.mp4` (cabe no limite de envio).
- Antes de renderizar, o plano é **comparado com um estudo de 121 edits de CS2** e avisa o que destoa (cortes demais, jogadas picotadas, flash demais, gancho tarde, texto na zona dos botões do Shorts).

---

## Instalação

### 1. Requisitos
| Programa | Para quê | Windows | macOS | Linux |
|---|---|---|---|---|
| [Claude Code](https://claude.com/claude-code) | usa a skill | app ou CLI | app ou CLI | CLI |
| Node.js **22+** | roda os scripts (sem `npm install`) | `winget install OpenJS.NodeJS` | `brew install node` | gerenciador de pacotes |
| FFmpeg | análise e render | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `apt install ffmpeg` |
| yt-dlp *(opcional)* | baixar referências e músicas | `winget install yt-dlp.yt-dlp` | `brew install yt-dlp` | `pipx install yt-dlp` |

No Windows, os scripts acham o FFmpeg e o yt-dlp instalados pelo winget mesmo se o terminal ainda não enxergar o PATH.

### 2. Instalar a skill
**Opção A — com o instalador de skills:**
```bash
npx skills add NerdFPS/CS2CLIPS-AUTOMATIC -g -y
```

**Opção B — manual:** copie a pasta `skills/cs2-highlight-editor` para a pasta de skills do Claude:
- Windows: `C:\Users\<você>\.claude\skills\cs2-highlight-editor`
- macOS/Linux: `~/.claude/skills/cs2-highlight-editor`

```bash
git clone https://github.com/NerdFPS/CS2CLIPS-AUTOMATIC
cp -r CS2CLIPS-AUTOMATIC/skills/cs2-highlight-editor ~/.claude/skills/
```

Abra uma conversa nova no Claude Code; a skill aparece sozinha quando você pede para editar clipes.

---

## Como usar

É só pedir em linguagem normal. Exemplos:

- *"Edita meus clipes que estão em `Videos/Medal/Clips/Counter-Strike 2` no estilo velocity, até 1 minuto."*
- *"Pega os clipes do Medal que têm 4K e ACE e faz dois vídeos curtos, um cinematográfico e um pra Shorts."*
- *"Faz um highlight igual a esse Reel: https://www.instagram.com/reel/..."*
- *"Analisa os últimos 20 vídeos do canal https://youtube.com/@canal e aplica o estilo nos meus clipes."*
- *"Usa os 5 vídeos `highlight 1..5` e gera 4 edits diferentes."*
- *"Deixa o texto maior e tira a tremida"* — ajustes viram uma mudança no `estilo.json` e um novo render.

O Claude segue o fluxo da skill: pré-requisitos → estilo → material (kills) → música → plano → prévia → render final → capa e cópias.

### Usando os scripts direto (sem o Claude)
Todos ficam em `skills/cs2-highlight-editor/scripts/` e rodam com `node <script>.mjs`. O fluxo mínimo:

```bash
S=skills/cs2-highlight-editor/scripts
node $S/analyze-clips.mjs clipes/                 # acha os kills → clipes/_analise_clipes/kills.json (confira!)
node $S/verify-kills.mjs clipes/_analise_clipes/kills.json   # tiras para conferir cada kill
node $S/get-music.mjs --search "phonk"            # músicas NCS
node $S/get-music.mjs --get <id> --out musicas
node $S/build-plan.mjs --style estilo.json --kills clipes/_analise_clipes/kills.json --out plan.json
node $S/render.mjs plan.json --preview            # prévia 540p
node $S/render.mjs plan.json                      # final
node $S/make-cover.mjs saida/<nome>_16x9.mp4 --plan plan.json --title "ACE"
node $S/export-small.mjs saida/<nome>_16x9.mp4 --mb 28
```

Veja `examples/` para um `estilo.json` e um `kills.json` comentados.

---

## Scripts

| Script | Para quê |
|---|---|
| `fetch-reference.mjs` | baixa um vídeo de referência (link) ou os últimos N de um canal |
| `analyze-reference.mjs` | analisa uma referência: cortes, BPM, beat, flashes, cor, folhas de imagens |
| `analyze-channel.mjs` | analisa vários vídeos de um canal e agrega |
| `analyze-batch.mjs` | estudo rápido de dezenas/centenas de refs: percentis e correlação com views |
| `medal-titles.mjs` | lista clipes do Medal pelo título automático (lê o banco numa cópia, só leitura) |
| `find-multikills.mjs` | varre muitos clipes e dá os tempos dos kills |
| `analyze-clips.mjs` | análise detalhada de poucos clipes + rascunho de `kills.json` |
| `verify-kills.mjs` | tiras do killfeed em cada kill + suspeitos |
| `get-music.mjs` | busca/baixa música NCS, BPM, drops, crédito |
| `build-plan.mjs` | monta o `plan.json` e compara com as referências |
| `render.mjs` | renderiza 16:9, 9:16 e 1440p (`--preview` para prévia) |
| `make-cover.mjs` | capa/thumbnail 16:9 ou 9:16 |
| `export-small.mjs` | cópia que cabe no limite do celular/WhatsApp |

## Presets

| Preset | Estilo |
|---|---|
| `completo` | vitrine com todos os recursos, calibrada pelo estudo de 121 edits |
| `frogling-velocity` | edit musical rápido com speed ramp, cor lavada (≤ 1 min, ótimo para 4K/ACE) |
| `frogling-cinema` | cinematográfico: cortes no beat, grade quente, replay com barras |
| `zuhn` | YouTuber de gameplay: jogadas inteiras, legendas de comentário, música de fundo |
| `zuhn-montagem` | zuhn + cortes no beat e música em destaque |
| `reel-rapido` | Reel/TikTok curto, tom quente, motion blur |
| `frag-movie` | montagem agressiva clássica |

Use no `estilo.json`: `{"preset": "frogling-velocity", "music": {"file": "musica.mp3", "start": "drop"}}` e só o que quiser mudar. Todas as opções estão em `skills/cs2-highlight-editor/references/style-guide.md`.

---

## Em que ela se baseia

O ritmo e os padrões não foram chutados:
- **Estudo de 121 edits de CS2/CS:GO** de 90 canais no YouTube (`analyze-batch.mjs`). Entre os edits **só de CS2**, o terço mais visto corta **13,7 vezes/min** contra 23,6 do terço menos visto, tem plano mediano de **2,5 s** (contra 1,6 s), **41%** de planos longos (contra 16%) e **~3 flashes/min** (contra 0,6). Resumo: os mais vistos deixam a jogada respirar e usam flash como pontuação. São tendências (correlações fracas), não regras.
- Análise de canais e edits populares (estilo YouTuber de gameplay, edits musicais curtos, Reels).
- Guias de edição, retenção de Shorts/TikTok e upload no YouTube, e outras skills de edição (beat sync, sound design, montagens de gameplay).

Os detalhes estão em `references/channel-notes.md`.

---

## Limitações (leia)

- **Detecção de kills**: funciona pela moldura vermelha do killfeed do CS2 e acerta a grande maioria, mas pode perder um kill quando a linha cai sobre um painel escuro (net graph) e pode marcar a tela vermelha da sua morte como kill. Por isso a skill sempre gera as tiras de conferência — o Claude olha cada kill antes de montar. HUDs muito diferentes podem precisar de `--killfeed x,y,w,h`.
- **Câmera de cinema (HLAE/terceira pessoa)** e intros 3D não são possíveis com clipes gravados em primeira pessoa.
- O Claude **não ouve** o vídeo: o volume é medido (−14 LUFS), mas o equilíbrio entre música, jogo e efeitos é você quem julga.
- Os números de zona segura do Shorts/TikTok e o truque do upload em 1440p vêm de guias de criadores, não de documentação oficial.

## Música e direitos

A skill só baixa automaticamente músicas do canal oficial **NoCopyrightSounds**, que podem ser usadas no YouTube **com crédito na descrição** — o crédito é salvo num `.credito.txt` ao lado da música e aparece no cartão final do vídeo. Música de outros canais só com `--force`, se você tiver direito de uso. Nenhuma música ou vídeo é distribuído neste repositório.

## Licença

[MIT](LICENSE).
