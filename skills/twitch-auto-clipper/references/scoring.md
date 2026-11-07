# Nota viral — como é calculada e como mexer

A nota ordena momentos de uma VOD pelos sinais que, no estudo (`viral-notes.md`), acompanham os clipes de live de CS2 que viralizam. **Não é probabilidade**: uma nota 80 não quer dizer "80% de chance". Quer dizer "mais sinais fortes juntos do que uma nota 50 nesta mesma VOD". Notas de VODs diferentes são comparáveis só aproximadamente.

## Sinais (por segundo da VOD)
| Sinal | Como é medido | Componente 0–1 no candidato |
|---|---|---|
| **kills** | Linhas do killfeed com moldura vermelha **e fundo escuro** (seu kill ou assistência), a 10 qps, em blocos de 5 min (`ownKillfeedEvents` em `lib.mjs`). A linha da sua morte também tem moldura vermelha, mas fundo vermelho saturado: vira `deaths` em `kills.json` e não conta. Só valem bordas encostadas na direita e contínuas (menus e inventário ficam de fora); kill a ±0,5 s de uma morte é descartado. Kills a ≤ 25 s um do outro formam uma rajada; mais de 5 em 30 s = aquecimento/deathmatch (quase não pontua) | 1 kill 0,15 · 2K 0,40 · 3K 0,65 · 4K 0,85 · 5K/ACE 1,0 (kills entre ápice−30 s e ápice+3 s) |
| **voice** | Volume RMS na faixa 200–3500 Hz, a cada 0,5 s, menos a mediana móvel de 2 min (que não desce mais de 8 dB abaixo da mediana da live), em unidades de 4 dB. Com `micTrack`, usa só o microfone | (z máx. entre ápice−3 s e ápice+6 s − 2) / 5 → +8 dB = 0, +28 dB = 1 |
| **chat** | Mensagens por segundo (sem bots), suavizadas em 5 s, e "reações" (risada: KEKW/LUL/kkkk; hype: Pog/W/🔥; espanto: ???/WTF; "clip"; fail: F/RIP), em z contra a mediana móvel de 5 min. **Deslocadas para trás pelo atraso do chat**, estimado por VOD (o atraso que mais alinha o chat aos picos de voz, entre 2 e 25 s; padrão 8 s) | (0,6·z_msgs + 0,4·z_reações, máx. entre ápice−2 s e ápice+12 s − 1,5) / 5 |
| **keywords** | Na transcrição do Whisper: "não acredito", "que isso", "meu deus", "clipa", palavrão, "ace/clutch/1v3", "kkkk", exclamações, palavra repetida 3× ou mais ("caramba caramba caramba") | soma dos pesos entre ápice−10 s e ápice+8 s, ÷ 3 |
| **scene** | Score de mudança de cena do ffmpeg a 2 qps | máx. entre ápice−5 s e ápice+2 s, ÷ 0,5 |

## Candidatos e ápice
- **Âncoras:** cada rajada de kills, mais os picos da "ativação" (voz + chat + palavras + cena), com distância mínima de 40 s entre eles.
- **Ápice:** numa rajada, o último kill; se a voz explode logo depois (até +5 s), o ápice é a reação. Sem kills, é o maior pico de voz perto da âncora.
- **Recorte:** de ápice−12 s até ápice+7 s (`config.clip.pre/post`).
  - Recua para incluir o 1º kill da rajada (−3 s).
  - Encaixa no início de uma frase e no fim da reação.
  - Fica entre 15 e 60 s.
  - Com mais de 50% de sobreposição entre candidatos, fica o de maior nota.

## Fórmula
nota = 100 × Σ (peso_s / Σ pesos disponíveis) × componente_s, com estes ajustes:
- **+5** se dois ou mais componentes passam de 0,6;
- **−10** se os 2 primeiros segundos do recorte não têm fala nem voz alta (gancho fraco).

O resultado é limitado a 0–100. Os pesos iniciais (`config.weights`) vêm do estudo: kills 0,30 · voice 0,25 · chat 0,25 · keywords 0,15 · scene 0,05.

## Calibrar
1. `report.mjs` registra cada clipe gerado em `<dataDir>/calibracao.jsonl`, com os componentes.
2. Depois de postar: `calibrate.mjs --set <vod>:<rank> --views N --platform tiktok`.
3. `calibrate.mjs` mostra a correlação de Spearman de cada sinal com log(views) e sugere pesos (metade peso atual, metade pela correlação). `--apply` só grava com 15 ou mais clipes.

Não troque pesos com base em 2 ou 3 clipes: as views variam muito por horário, título e algoritmo.

## Limites conhecidos (seja honesto com o usuário)
- O killfeed só vê o HUD padrão do CS2 numa posição padrão. Medido numa live de 1h33 conferida linha a linha (gabarito de 97 detecções): o detector acha ~90% dos kills, com ~15% de falsos (quase todos a linha da própria morte na tela vermelha), e conta **assistências como kill**. O detector da cs2-highlight-editor (feito para clipes do Medal) acertava só 27% numa live inteira, porque contava a própria morte e menus. Clutch não é detectado diretamente, só pela rajada de kills.
- Chat fraco (< 1 msg/min em média) é ignorado e o peso vai para os outros sinais. A voz é medida em dB acima da base (piso de −60 dB, para silêncio digital não inflar a fala seguinte).
- Num VOD da Twitch a voz vem misturada com o jogo: tiros e música também sobem o volume. A trilha separada do microfone resolve.
- O Whisper erra palavras, principalmente gírias e nomes. Revise as legendas antes de postar.
- Menus e inventário sem reação podem aparecer se houver um pico de chat. Confira os quadros.
