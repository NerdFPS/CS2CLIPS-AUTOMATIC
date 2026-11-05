# Anotações de referências já analisadas

Use como ponto de partida quando o usuário citar estes estilos (ou parecidos). Os números vêm de `analyze-channel.mjs`; as observações, das folhas de imagens.

## zuhn (YouTube, gameplay comentado) — 20 vídeos, 2026-11
- ~11 cortes/min, plano mediano 3,3 s (média 5,9 s): mostra a jogada inteira com contexto.
- Só 32% dos cortes no beat → corta pela jogada; áudio do jogo na frente, música de fundo.
- Legendas de comentário: branco, contorno preto, embaixo, minúsculas, frases curtas ("my bad", "crazy plant spot"), às vezes uma palavra colorida.
- Destaque: replay em câmera lenta com barras de cinema (letterbox). Cor natural, um pouco viva. Fade do preto no início.
- Falsos sinais na análise: mira da AWP entrando/saindo vira "corte" e "flash".
- Preset: `zuhn`, `zuhn-montagem`.

## frogling (YouTube, edits musicais de CS2 ~1:30) — 30 vídeos, 2026-11
- Um edit por música (phonk, Kompa, rock/rap famosos), ~1–2 min.
- ~19 cortes/min (plano ~1,85 s); 25% dos planos < 1 s.
- ~17 "flashes"/min: flash branco em cortes e impactos, estouro de luz (bloom/overexposure).
- Saturação média muito baixa (~8 contra ~20 do zuhn): grade lavada/cinema, alto contraste, sombras frias e realces quentes; algumas seções quase P&B.
- Velocity edits: câmera lenta curta no kill e aceleração logo depois; motion blur forte nos giros; transições whip/zoom, torção/glitch, flash.
- "Só 23% dos cortes no beat" engana: os cortes ficam escondidos em giros borrados e no flash, onde o detector não pega. Visualmente o edit acompanha a música → use `beatSync: true`.
- Quase sem texto. Alguns têm intro cinematográfica com renders 3D de agentes (não reproduzível com clipes do Medal).
- Presets: `frogling-velocity` (rápido, ≤1 min, ótimo para 4K/ACE), `frogling-cinema` (mistura com zuhn).

## Estudo grande — 121 edits de CS2/CS:GO, 90 canais (2026-11, `analyze-batch.mjs`)
Busca no YouTube com 25 termos (cs2 edit/montage/velocity/fragmovie/awp/deagle/ace/phonk/4k, edits de s1mple, donk, m0NESY, ZywOo, NiKo...), 15 s–4 min, sem cheat/HvH, tutoriais ou compilações; 2,8 mil a 4,3 milhões de views.
- Mediana geral: 43 s, 16 cortes/min, plano 1,7 s, 29% dos planos < 1 s, 25% > 4 s, 2 flashes/min, saturação 13,5 (lavada), BPM ~117, 38% dos cortes no beat. 17% usam barras de cinema, 17% começam no preto, 50% terminam em fade/preto, 45% desaceleram no último terço.
- Correlações com views são fracas (|r| ≤ 0,3; muitos clássicos antigos de CS:GO). Por isso o que vale é a comparação dentro de grupos:
  - **Só CS2 (61 vídeos), terço mais visto × menos visto:** 13,7 × 23,6 cortes/min; plano 2,5 × 1,6 s; planos > 4 s 41% × 16%; flashes 3,1 × 0,6/min; cortes no beat 44% × 36%; contraste um pouco maior.
  - **Curtos ≤ 60 s (76 vídeos):** 15,8 × 21,9 cortes/min; planos > 4 s 25% × 13%; flashes 4,2 × 0/min; contraste 104 × 91; mais cortes no beat.
  - **Lição:** os mais vistos cortam MENOS e deixam a jogada respirar, mas pontuam com ~3–4 flashes/min e acertam mais o beat. Picotar cada kill (20+ cortes/min) é traço dos menos vistos.
- Visual (mosaicos): marca do canal fixa no canto, logo/intro curta, cartão de créditos no fim (MADE BY / MUSIC / @redes), telas "inscreva-se", textos-meme pontuais, facecam/entrevistas em edits de pro player, trechos com cor neon/estilizada.
- Web (retenção de Shorts/TikTok): os primeiros 1–3 s decidem; começar pelo ápice, sem tela parada/preta, texto forte no início. Daí o `coldOpen`.
- O `build-plan` imprime essa comparação para todo plano (cortes/min, plano mediano, % longos, flashes/min, 1ª ação, duração).

## Edits populares de CS2 no YouTube — 10 vídeos, 2026-11
NEVERMORE 2 (fuze, 2,6 M views), lorebg (777 k), After Dark (597 k), Don't Stop the Music (186 k), Boom Clap, TAK TAK, AWP edit, Let The World Burn, Velocity Study, e a paródia "Every cringe fragmovies be like" (2,7 M).
- Média: ~23 cortes/min, plano mediano ~2 s, 31% dos planos < 1 s; saturação ~21 (vivo), contra ~8 do frogling (lavado). Duas escolas: **vivo/saturado** (Don't Stop, After Dark) e **lavado/cinema** (frogling, lorebg).
- lorebg: cartão de título grande sobre preto (vermelho, esticado), tom quente superexposto, câmera em terceira pessoa feita no HLAE (não dá com clipes do Medal), logos no fim.
- Don't Stop the Music: palavras da letra, uma por beat, enormes e centralizadas, no começo do edit.
- After Dark: cores vivas, whips com borrão, muitas jogadas de AWP com zoom de mira.
- Paródia dos clichês (o que EVITAR): esperar inspecionando faca, tempo morto, jogada sem ação, efeito em tudo.
- Guias (web) concordam: corte é a melhor transição; efeitos com moderação (flash/tremida/zoom em excesso atrapalham ler a jogada); grade consistente no vídeo todo; speed ramp com interpolação; som do jogo em destaque nos momentos-chave.

## Skills lidas (2026-11)
- *editing-gameplay-montages* (montagens de Valorant/CS2): cada evento num ataque medido da música; o inimigo aparece ≥14 quadros antes de morrer e morre dentro do trecho; zoom só como acento curto; blur-in nos cortes; vertical com o jogo inteiro numa janela sobre fundo desfocado; capa.
- *beat-sync-editing*: arco estabelecer → desenvolver → clímax → resolver; o maior momento no drop; ramp com o quadro mais lento no beat; corte seco é o padrão.
- *sound-design*: whoosh nos cortes, um impact no momento-herói, um riser que termina no hit, música abaixa sob o herói, −14 LUFS.

## Reel "GRUDA" (Instagram, 12 s) — 2026-11
- ~1,7 s por jogada, cortes escondidos em giros com motion blur, tom quente/dourado, fade do/para o preto, nick em dourado com fonte gótica após um kill.
- Preset: `reel-rapido`.

## Pesquisa web extra (2026-11)
- Slow-mo: passa-baixa na música (500–2000 Hz, "debaixo d'água") destaca o momento lento — implementado em `audio.muffleSlowmo`.
- YouTube: subir em 1440p (mesmo ampliado de 1080p) faz o YouTube usar VP9/bitrate maior; bitrate de exportação ~1,2–1,5× o recomendado; a qualidade só aparece depois do processamento do HD (consenso de criadores, não regra oficial) — `output.youtube1440`.
- Tremida realista: posição + rotação pequena (1–3°) + desfoque de movimento + zoom para esconder bordas; com moderação — `effects.shake.rot`.
- Shorts/TikTok: as zonas seguras variam muito entre fontes; regra prática: texto importante fora dos ~400 px de baixo e da lateral direita, centro ~870×1160.
