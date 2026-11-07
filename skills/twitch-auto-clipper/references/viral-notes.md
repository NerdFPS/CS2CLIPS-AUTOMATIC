# O que faz um clipe de live de CS2 viralizar — estudo (2026-11)

Base para os pesos da nota viral e para o formato dos clipes. Separe sempre **tendência forte** (aparece nos números e nas imagens, com amostra razoável) de **palpite** (pouca amostra, correlação fraca ou só de fontes externas). A nota viral é uma **ordenação por sinais**, não uma probabilidade: recalibre com as views reais dos clipes postados (`calibracao.jsonl`).

## Amostra e método
- **Twitch, 100 clipes brutos de CS2** (categoria Counter-Strike, criados depois de 27/09/2023), os mais vistos de 20 canais (ohnePixel, s1mple, Gaules, buster, fl0m, Anomaly, NiKo, Evelone192, pashaBiceps, Stewie2K, JASONR, liminhag0d, des0ut, n0thing, EliGE...), em dois períodos: de todos os tempos e dos últimos 30 dias. Views: 101 a 499 mil (mediana ~12 mil). Coletados com o `yt-dlp` (lista de clipes de cada canal, com views, data e categoria); dá para trocar pela Helix `Get Clips?game_id=32399` quando houver credenciais.
- **55 versões verticais** desses mesmos clipes, que a própria Twitch gera (`portrait-*`).
- **107 Shorts do YouTube** das abas Shorts de streamers de CS (ohnePixel, tarik, fl0m, Gaules, shroud, coldzera, ZywOo, mch_agg, n0thing, tck10, JasonR...) e de canais de cortes; **75 são de CS** e 32 de outros jogos (usados só para comparar o layout). Views: 3 a 15 milhões (mediana de CS ~110 mil).
- **Ferramentas:**
  - `analyze-batch.mjs` (cs2-highlight-editor) em todos;
  - medição do ápice (pico de volume com janela de 0,5 s, primeiro momento alto, energia dos 2 primeiros segundos);
  - detector de killfeed da cs2-highlight-editor nos clipes 16:9;
  - watch-skill (quadros, OCR e transcrição local com Whisper) numa amostra de 50 (os 25 mais vistos de cada fonte);
  - revisão visual das folhas de mosaicos e rótulo manual de cada clipe (`estudo-viral/rotulos.txt`: tipo de momento, facecam, layout).
- **Limites:**
  - As views dependem muito do canal (a ohnePixel domina os mais vistos).
  - Twitch e YouTube não são comparáveis em escala.
  - Quem rotulou foi uma só pessoa.
  - Não há chat nos clipes, então o peso do chat vem de fontes externas.
  - Correlações com views são fracas (|r| ≤ 0,3), como no estudo de edits.

## Tendências fortes

### 1. Que tipo de momento vira clipe
| Tipo | Twitch (n=100) | Shorts de CS (n=75) | Observação |
|---|---|---|---|
| Jogada (multikill, clutch, ace, tiro absurdo) | 31% | 33% | O maior grupo nas duas fontes. Em 19 dos 31 clipes de jogada da Twitch o detector achou kills do POV |
| Reação do streamer a pro/torneio (watch party) | 10% | 27% | Enorme nos Shorts (tarik, fl0m, Gaules, mch). Não se aplica a quem joga a própria partida |
| Engraçado (troll, situação absurda, fail) | 18% | 8% | Nos Shorts, os poucos que existem têm views altas (mediana 725 mil) |
| Caixa, faca ou skin | 16% | 9% | Views altas, mas quase tudo é da ohnePixel e da Anomaly (efeito de canal) |
| Conversa (história, opinião, "hot take") | 13% | 12% | |
| Rage | 3% | 1% | Raro entre os mais vistos |
| Config, dica, evento | 11% | 9% | |

**Para a skill (live jogando CS2):** os candidatos fortes são **jogada** (killfeed), **engraçado/fail/rage** (pico de voz e risada, emotes de risada no chat) e **fala marcante** (transcrição). Caixa e skin entram se você abrir caixas na live. "Reação a pro" só vale se você fizer watch party.

### 2. Duração
- **Clipe bruto da Twitch:** mediana de 21 s (p25 12 s, p75 30 s). Teto da Twitch: 60 s.
- **Short:** mediana de 31 s (p25 21 s, p75 40 s); quase nenhum passa de 60 s.
- **Regra:** Short de **20–40 s** (alvo ~30 s); nada acima de 60 s.

### 3. Onde fica o ápice e quanto contexto vem antes
O ápice foi medido como o maior pico de volume (grito, risada, tiros, narração):
- **Twitch:** o pico fica em 6,8 s (mediana; p25 3,3 s, p75 15 s), mais ou menos no meio do clipe (50%). Depois dele vêm ~7 s nos clipes mais vistos contra ~11 s nos menos vistos: **clipe bom termina logo depois do ápice**.
- **Shorts:** o pico fica em 16,6 s (mediana), por volta de 60% do vídeo, com ~8,6 s depois. Nos mais vistos o pico vem mais cedo (12,8 s contra 17,3 s).
- **Regra:** **10–15 s de contexto antes do ápice e 5–8 s depois** (reação e risada). Encerre até ~8 s depois do pico.

### 4. Gancho no primeiro segundo
- **Fala logo de cara:** 24 de 25 Shorts têm fala já no primeiro segundo (Twitch: 20 de 25). Não existe abertura em silêncio.
- **Texto:** os Shorts abrem com texto na tela, uma frase-gancho ou título fixo ("cancel him", "Bro is losing his mind 😭", "The Mac-10 Incident 😬", "insane craft animation").
- **A primeira frase arma a expectativa:** "I accidentally screamed at a little kid", "If Martin 1v3s here, you'll be the MVP", "How much did you make winning a CS major?".
- **Regra:** começar numa fala ou ação, nunca em tempo morto, e com **título fixo curto + emoji** na emenda entre a facecam e o jogo. Se o contexto for longo, um *cold open* de 1–2 s com o ápice antes do contexto é uma alternativa (ver palpites).

### 5. Formato e facecam
- **Facecam:** 85% dos Shorts de CS têm facecam.
- **Layout empilhado:** facecam em cima (~35–40% da altura) e jogo embaixo em 69% (73% contando todos os jogos). Variações minoritárias: facecam em círculo sobre o jogo (4%, coldzera) ou clipe 16:9 com fundo (11%, canais de terceiros).
- **Twitch:** 97% dos clipes brutos têm facecam, quase sempre pequena num canto.
- **A versão vertical da Twitch quase sempre é um corte central:** perde a facecam e o killfeed. **A skill precisa montar o layout empilhado ela mesma**, recortando a facecam pela posição dela no stream.
- **Reação visível importa:** nas folhas, o momento-chave quase sempre mostra o rosto reagindo (mão na cabeça, grito, risada). Em clipes de jogada, o jogo ocupa a parte maior.

### 6. Texto, legenda e edição leve
- **Estilos de texto:** a maioria dos Shorts revisados (~4 em 5, contagem visual) usa um destes:
  - legenda grande da fala, em frases de 1 a 4 palavras, centralizada na emenda facecam/jogo, branca ou amarela, fonte pesada com contorno, às vezes uma palavra colorida;
  - título fixo no topo da área do jogo durante o clipe todo, com emoji.
- **Edição:** mínima, 3,9 cortes/min (mediana; o 1º corte por volta de 9 s). Os destaques são acentos pontuais: zoom no rosto na reação, freeze em preto e branco com 💀 no fail, meme rápido, replay.
- **Música:** quase nunca. O som é a voz e o jogo.

### 7. Títulos
Curtos, em tom de reação ou de história, nome próprio quando há ("Ropz Moving Like a DEMON 💀", "ZywOo Makes a 1v5 look EASY", "I Couldn't Finish the Job 😭", "1x2 SURREAL DO YOUNG!"). Emojis 💀 😭 😳 🤯 são os mais comuns. Os títulos de clipe da Twitch são ainda mais curtos (uma palavra ou piada interna).

## Palpites (evidência fraca ou externa)
- **Pico de volume maior → mais views:** a diferença foi pequena (14,3 contra 13,2 dB acima da base nos mais vistos da Twitch; nos Shorts, o inverso).
- **Cold open (ápice antes do contexto):** recomendado por guias e ferramentas de clipe, mas nesta amostra os Shorts mais vistos mostram o contexto primeiro e seguram a atenção com o título e a primeira frase. Testar A/B.
- **Picos de chat:** o volume de chat acima da linha de base do próprio stream (média móvel/EWMA) e os emotes de reação marcam bem os momentos (patente de highlight por chat, projeto twitch-highlight-finder, ferramentas comerciais). **O chat chega atrasado:** os picos aparecem uns 5–20 s depois do evento (atraso do stream mais tempo para digitar), então é preciso deslocar a janela para trás. O valor exato desse atraso deve ser medido na VOD.
- **Legenda palavra por palavra é melhor do que frase:** é consenso de ferramentas como Opus, Submagic e StreamLadder, mas eu não medi.
- **Shorts de 30–55 s versus 15–30 s no TikTok:** fontes de ferramentas divergem; a amostra aponta 20–40 s.

## Pesos iniciais da nota viral (0–100)
Ponto de partida derivado do estudo; recalibre com as views reais.
| Sinal | Peso | Por quê |
|---|---|---|
| Kills do POV no killfeed (2K = baixo, 3K médio, 4K/ACE alto; clutch pela contagem de vivos, se houver) | 30 | "Jogada" é o maior grupo nas duas fontes |
| Pico de voz/volume sobre a base do stream (grito, risada) | 25 | Todo ápice medido é um pico de áudio; a reação visível é central |
| Pico de chat (mensagens/s acima da EWMA, emotes de risada e espanto, deslocado ~5–20 s para trás) | 25 | Forte na literatura; mede a reação do público ao vivo |
| Palavras-chave na transcrição ("não acredito", "olha isso", "clipa", "meu deus", palavrão, risada) | 15 | Ganchos de fala abrem quase todo Short |
| Mudança brusca de cena (sair do menu para o jogo, troca de câmera) | 5 | Sinal fraco; serve mais para não cortar no meio de um menu |

**Bônus e penalidades:**
- −15 se mais de 60% do trecho for menu, inventário ou loading (salvo abertura de caixa com reação);
- −10 se não houver fala nem pico de áudio nos primeiros 2 s do recorte;
- +5 se dois sinais fortes coincidirem em até 4 s.

## Regras de corte que saem do estudo
1. **Duração:** 20–40 s (alvo ~30 s, máximo 60 s). O recorte vai de ~12 s antes do ápice até ~7 s depois, ajustado para começar no início de uma frase e terminar depois da reação.
2. **Abertura:** na primeira frase ou ação, nunca em silêncio. Título fixo curto com emoji na emenda facecam/jogo.
3. **Vertical 9:16:** facecam em cima (~35–40% da altura) e jogo embaixo (corte central, com o killfeed ampliado quando for jogada; preset `crop+killfeed` da cs2-highlight-editor). Sem facecam: `blur` ou `crop+killfeed`.
4. **Legenda:** a fala vem do Whisper, em frases de 1 a 4 palavras, grandes, na emenda, fora dos ~400 px de baixo e da lateral direita.
5. **Edição simples:** no máximo um acento por clipe (zoom no rosto na reação, slow-mo no kill decisivo); preset `zuhn` para clipes de live e `frogling-velocity` só para montagens de jogada.
6. **Som:** voz na frente. Música só NCS, baixa ou nenhuma; nunca a música que tocou na live.
