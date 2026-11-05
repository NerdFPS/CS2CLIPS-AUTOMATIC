# Guia: da referência para o `estilo.json`

## Índice
1. Como ler a análise
2. Tabela observação → parâmetro
3. Esquema completo (com padrões)
4. Exemplos de estilos típicos

## 1. Como ler a análise

`reference-analysis.json` traz:
- `shots.median` / `cutsPerMinute`: o ritmo. **Atenção**: cortes escondidos em giros de câmera com motion blur (muito comuns em edits de CS) não são detectados. Conte as jogadas olhando as folhas de contato (mudança de mapa, arma, HUD ou munição) e use essa contagem para definir o ritmo. Montagens de CS costumam ter planos de 1,5 a 4 s. Planos abaixo de 0,3 s geralmente são flashes ou efeitos detectados como corte, não cortes de clipe.
- `music.bpm`, `cutsOnBeatRatio`: acima de ~0,5, a referência corta no beat, então use `pacing.beatSync: true`. Abaixo de 0,25, os cortes são livres; mesmo assim, manter o beat sync costuma ficar melhor.
- `music.medianBeatsPerShot`: quantos beats cada plano dura. Use para calibrar `preRoll` + `postRoll` (duração por kill ≈ beats × `beatPeriod`).
- `flashes`: flashes brancos frequentes nos cortes indicam `transitions.flashOnCut: true`. Se coincidem com kills (meio do plano), use `effects.flash.on: "all"`.
- `look`: compare com `look` de `clips-analysis.json`. Saturação da referência ÷ saturação dos clipes ≈ `color.saturation` (limite 0,8 a 1,6). Contraste maior na referência → `contrast` de 1,05 a 1,25. Brilho bem menor → `brightness` negativo (−0,03 a −0,08) ou `gamma` < 1.

Nas imagens, procure:
- **Texto**: há texto? Onde (centro, embaixo)? Qual cor? Tem contorno? Fonte pesada (Impact/condensada) ou fina? Aparece contador ("2K", "3K") ou só o rótulo final ("ACE")?
- **Zoom e tremida**: planos em quadros seguidos com o enquadramento "mais fechado" perto do kill indicam zoom punch. Borrão de movimento e enquadramento deslocado indicam shake.
- **RGB split**: bordas com vermelho e azul separados.
- **Slow-motion**: na folha de contato, vários quadros seguidos quase idênticos perto do kill, ou um plano bem mais longo que a mediana terminando num kill.
- **Grade**: tons frios/azulados, quentes, alto contraste, preto esmagado, vinheta.
- **Transições**: quadros misturados (fade), deslocados (slide), girados, um quadro todo branco (flash).
- **Intro/outro**: logo ou tela de título no começo/fim. Só use se o usuário fornecer os arquivos.

## 2. Observação → parâmetro

| Você vê na referência | Parâmetro |
|---|---|
| Cortes rápidos, quase 1 kill por plano | `pacing.preRoll` 0,6–0,9, `postRoll` 0,3–0,5 |
| Planos com "respiro", mostra o round | `preRoll` 1,8–3,0, `postRoll` 0,8–1,2 |
| Slow-mo dramático no último kill | `effects.slowmo.on: "last"`, `speed` 0,3–0,5 |
| Speed ramp em todo kill | `slowmo.on: "all"`, `speed` 0,5–0,6, `before` 0,08, `after` 0,25 |
| Sem câmera lenta | `slowmo.on: "none"` |
| Zoom forte no kill | `zoom.amount` 0,15–0,25, `duration` 0,3 |
| Zoom sutil | `zoom.amount` 0,05–0,08 |
| Tela treme no tiro/kill | `shake.on: "all"`, `px` 10–20 |
| Flash branco no kill | `flash.on: "all"` (ou `"headshots"`), `opacity` 0,4–0,8 |
| Flash branco entre clipes | `transitions.flashOnCut: true` |
| Aberração cromática | `rgbsplit.on: "headshots"` ou `"all"` |
| Fade entre clipes | `transitions: {type: "fade", duration: 0.25}` |
| Outras transições | `type`: `fadewhite`, `slideleft`, `slideup`, `zoomin`, `radial`, `pixelize`, `circleopen`, `smoothleft`… (nomes do filtro xfade do ffmpeg) |
| Texto grande central | `text.position: "center"`, `size` 0,08–0,12 |
| Contador "2K/3K" embaixo | `killCounter: true`, `counterPosition: "bottom"` |
| Sem textos | `killCounter: false`, `labels: false` |
| Visual frio/azulado | um `.cube` em `color.lut` funciona melhor; sem LUT, `saturation` ~1,1 e `gamma` 0,95 |
| Vinheta | `color.vignette: true` |
| Rastro/borrão em todo giro de câmera ("smooth", RSMB) | `motionBlur`: 3 (leve) a 5 (forte) |
| Cortes escondidos em giros de câmera borrados (whip) | `transitions: {type: "hblur", duration: 0.2}` |
| Tons quentes/dourados | `color.warmth` 0,15–0,3 (negativo = frio/azulado) |
| Começa/termina no preto | `output.fadeIn` / `output.fadeOut` 0,3–0,8 |
| Replay em câmera lenta com barras pretas (cinema) | `effects.slowmo.letterbox: true` (ou a fração da altura, ex. 0,12) |
| Velocity / speed ramp (lento no kill, acelera depois) | `effects.slowmo.rampOut: {speed: 1.6–2.0, duration: 0.3–0.4}` com slow-mo curto (`before` 0,08, `after` 0,2) |
| Estouro de luz / overexposure no impacto | `effects.bloom: {on: "last" ou "all", amount: 0.2–0.4, duration: 0.25}` |
| Grade de cinema (sombras azul-petróleo, realces laranja) | `color.tealOrange` 0,1–0,3 (+ `saturation` < 1 para o look lavado) |
| Transições variadas (whip, zoom, flash, glitch) | `transitions: {type: ["zoomin","hblur","fadewhite","radial"], duration: 0.15}` (alterna a cada corte) |
| Música "debaixo d'água" no slow-mo | `audio.muffleSlowmo: 900` (Hz do passa-baixa; 500–2000) — só durante os trechos lentos |
| Tremida mais realista | `effects.shake.rot: 1.5–2.5` (graus de rotação; zoom extra esconde os cantos) |
| Melhor qualidade no YouTube | `output.youtube1440: true` (ou `render --yt1440`): gera `_youtube1440.mp4` (2560×1440, ~30 Mbps) para upload — o YouTube usa VP9 em ≥1440p |
| Gancho: abrir com o melhor momento (retenção) | `coldOpen: {text: "ACE", before: 0.5, after: 0.45, speed: 0.45}` — slow-mo do kill-herói com barras, antes de tudo |
| Créditos no fim (MADE BY / MUSIC / @) | `outroCard: {made: "NICK", handle: "@nick", duration: 2.5}` — MUSIC vem sozinho do `.credito.txt` da música |
| Marca do canal no canto | `watermark: {text: "@nick", position: "br", opacity: 0.55}` (só durante o corpo) |
| Flash como pontuação, sem exagero | `effects.flash.maxPerMin: 4` (os mais vistos: ~3–4/min) |
| Jogada inteira (não picotar) | `pacing.maxGap` 3,5–4,5: só separa kills com tempo morto grande |
| Abre com nome/título sobre preto (lorebg) | `titleCard: {text, sub, duration: 1.5–2, size: 0.2–0.28}` — a música já toca embaixo |
| Palavras grandes no beat (letra/hype, "Don't Stop the Music") | `words: {list: ["NO","MERCY"], from: 0, every: 1, size: 0.2, opacity: 0.8}` — poucas palavras, de preferência antes do 1º kill |
| Corte que "entra borrado e foca" | `transitions.blurIn: true` |
| Grão de filme | `color.grain` 0,2–0,4 |
| Pulso de zoom no bumbo | `effects.beatBump: {on: true, amount: 0.03, minStrength: 0.4–0.6}` |
| Speed ramp sem tranco | `effects.slowmo.ease: true` (degrau intermediário antes do slow) |
| Energia crescendo até o clímax | `pacing.arc: true` + ordem dos clipes do mais fraco ao mais forte |
| Whoosh nos cortes, estrondo no kill-herói, riser até o drop | `sfx: {whoosh: 0.3, impact: 0.8, riser: 0.45, riserDuration: 1.7, duckHero: 0.5}` (sintetizados, sem direitos) |
| Vertical sem cortar o HUD | `output.vertical: "blur"` (jogo inteiro numa janela sobre fundo desfocado) |
| Capa/thumbnail | `make-cover.mjs video.mp4 --plan plan.json --title "ACE" --sub "..." [--vertical]` |
| Vídeo com duração máxima (ex.: ≤ 1 min) | escolha menos clipes e `pacing` curto (preRoll 0,7–1,0, postRoll 0,35–0,5, maxGap 1,6–2,2); o resumo do plano mostra a duração |
| Legendas de comentário embaixo (YouTuber) | `texts` por clipe no kills.json; aparência em `text.caption*` |
| Cortes pela jogada, não pela música (vlog/gameplay) | `pacing.beatSync: false`, `preRoll` 2–3, música com `volume` 0,4–0,6 e `audio.gameVolume` 1,0 |
| Muitos "flashes" ou planos < 1 s na análise | costuma ser a mira da AWP entrando/saindo (gera cortes falsos) ou um replay; confira nas imagens antes de concluir |
| Imagem nítida/"crispy" | `color.sharpen` 0,5–1,0 |
| Áudio do jogo baixo sob a música | `audio.gameVolume` 0,3–0,5 |
| Áudio do jogo em destaque | `gameVolume` 0,8–1,0 |
| Slow-mo em silêncio | `audio.slowmoGameAudio: "mute"` |

## 3. Esquema completo

Inclua no seu `estilo.json` só o que mudar. O resto vem destes padrões (`scripts/defaults.mjs`). Caminhos relativos são resolvidos a partir da pasta do `estilo.json`.

```json
{
  "name": "highlight",
  "_observacoes": ["texto livre: o que você viu na referência"],
  "music": { "file": "musica.mp3", "start": 0, "volume": 1.0, "fadeOut": 2.0 },
  "pacing": { "beatSync": true, "preRoll": 1.2, "minPreRoll": 0.4, "postRoll": 0.6, "maxGap": 2.5 },
  "audio": { "gameVolume": 0.55, "slowmoGameAudio": "stretch", "loudnorm": true },
  "color": { "contrast": 1.08, "saturation": 1.2, "brightness": 0.0, "gamma": 1.0, "lut": null, "vignette": false, "sharpen": 0.0, "warmth": 0.0 },
  "motionBlur": 0,
  "effects": {
    "slowmo":   { "on": "last", "speed": 0.4, "before": 0.15, "after": 0.45, "interpolate": "none" },
    "zoom":     { "on": "all",  "amount": 0.12, "duration": 0.35 },
    "shake":    { "on": "all",  "px": 12, "duration": 0.25 },
    "flash":    { "on": "none", "opacity": 0.6, "duration": 0.08 },
    "rgbsplit": { "on": "none", "px": 8, "duration": 0.12 }
  },
  "transitions": { "type": "cut", "duration": 0.0, "flashOnCut": false },
  "text": {
    "font": null, "color": "#FFFFFF", "border": "#000000", "borderW": 4, "shadow": 3,
    "size": 0.085, "position": "center",
    "killCounter": true, "counterFormat": "{n}K", "counterPosition": "bottom", "counterSize": 0.06, "counterDuration": 0.6,
    "labels": true, "labelDuration": 1.2
  },
  "intro": null, "outro": null,
  "logo": { "file": null, "position": "tl", "scale": 0.12, "opacity": 0.85 },
  "output": {
    "fps": 60, "width": 1920, "height": 1080, "crf": 18,
    "formats": ["16x9", "9x16"], "vertical": "crop+killfeed", "fadeIn": 0, "fadeOut": 0,
    "killfeed": { "x": 0.62, "y": 0.04, "w": 0.38, "h": 0.24 },
    "dir": null, "name": null
  }
}
```

`logo.position`: `tl` (padrão, sobre o radar), `tr`, `bl` ou `br`. Evite `tr`: cobre o killfeed e aparece duplicado no vertical `crop+killfeed`.
`audio.loudnorm`: normaliza em duas passadas para −14 LUFS. Se a música tiver picos muito altos, o resultado fica um pouco abaixo disso, porque o limitador protege contra distorção; é esperado.
Valores de `on`: `none`, `all`, `first`, `last` (último kill de cada clipe), `headshots`.
`music.start`: segundo da música em que o vídeo começa. Use-o para pular uma intro longa ou fazer o drop coincidir com o melhor clipe (o vídeo começa no 1º beat após esse ponto).
`output.vertical`: `crop` (corte central, a mira fica no meio), `crop+killfeed` (corte central + killfeed ampliado no topo, o melhor para CS) ou `blur` (quadro inteiro sobre fundo desfocado).

## 4. Exemplos

**Frag movie "agressivo"** (cortes no beat, muito efeito):
```json
{ "pacing": {"preRoll": 0.8, "postRoll": 0.4},
  "effects": {"slowmo": {"on": "last", "speed": 0.35}, "zoom": {"amount": 0.18}, "shake": {"px": 16}, "flash": {"on": "headshots"}, "rgbsplit": {"on": "headshots"}},
  "transitions": {"flashOnCut": true}, "color": {"contrast": 1.15, "saturation": 1.3} }
```

**Highlight "limpo"** (estilo pro/YouTube, pouco efeito):
```json
{ "pacing": {"preRoll": 2.0, "postRoll": 1.0},
  "effects": {"slowmo": {"on": "none"}, "zoom": {"amount": 0.05}, "shake": {"on": "none"}},
  "transitions": {"type": "fade", "duration": 0.2}, "text": {"killCounter": false} }
```

**Shorts/TikTok** (curto e vertical):
```json
{ "pacing": {"preRoll": 0.7, "postRoll": 0.35}, "output": {"formats": ["9x16"], "vertical": "crop+killfeed"},
  "text": {"size": 0.1, "position": "upper"} }
```
