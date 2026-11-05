// Estilo padrão. O estilo.json do modelo só precisa conter o que for diferente disto.
export const DEFAULT_STYLE = {
  name: 'highlight',
  music: { file: null, start: 0, volume: 1.0, fadeOut: 2.0 },
  pacing: {
    beatSync: true,      // alinhar o 1º kill de cada clipe a um beat e o fim do clipe a outro beat
    preRoll: 1.2,        // segundos (na saída) antes do 1º kill
    minPreRoll: 0.4,
    postRoll: 0.6,       // segundos depois do último kill
    maxGap: 2.5,         // kills mais distantes que isto viram trechos separados (corta o tempo morto)
    arc: false,          // true: jogadas mais longas no começo e mais curtas rumo ao clímax
  },
  audio: { gameVolume: 0.55, slowmoGameAudio: 'stretch', loudnorm: true, muffleSlowmo: false }, // slowmoGameAudio: stretch | mute; muffleSlowmo: true ou Hz (passa-baixa na música durante o slow-mo)
  color: { contrast: 1.08, saturation: 1.2, brightness: 0.0, gamma: 1.0, lut: null, vignette: false, sharpen: 0.0, warmth: 0.0, tealOrange: 0.0, grain: 0 }, // grain 0–1: grão de filme // tealOrange 0–0.5: sombras azul-petróleo/realces laranja // warmth: -0.3 (frio) a 0.3 (quente/dourado)
  motionBlur: 0, // quadros misturados (0 = desligado, 3 = leve, 5 = forte): o "smooth" de edits de CS
  effects: {
    // "on": none | all | first | last | headshots   (cada kill pode sobrescrever com kill.fx)
    slowmo: { on: 'last', speed: 0.4, before: 0.15, after: 0.45, interpolate: 'none', letterbox: false, rampOut: null, ease: false }, // ease: degrau intermediário antes do slow (rampa suave) // rampOut: {speed: 1.8, duration: 0.4} acelera depois do slow (velocity) // interpolate: none | blend | mci; letterbox: true ou fração da altura (barras de cinema no slow-mo)
    zoom: { on: 'all', amount: 0.12, duration: 0.35 },
    shake: { on: 'all', px: 12, duration: 0.25, rot: 0 }, // rot: graus de rotação na tremida (1–3 = mais realista)
    flash: { on: 'none', opacity: 0.6, duration: 0.08, maxPerMin: null }, // maxPerMin: orçamento (os mais vistos: ~3–4/min)
    rgbsplit: { on: 'none', px: 8, duration: 0.12 },
    bloom: { on: 'none', amount: 0.3, duration: 0.25 }, // estouro de luz no kill
    beatBump: { on: false, amount: 0.035, minStrength: 0.55, duration: 0.18 }, // pulso de zoom nos beats fortes
  },
  transitions: { type: 'cut', duration: 0.0, flashOnCut: false, blurIn: false }, // blurIn: o plano entra borrado e foca // type: cut ou um nome do xfade (fade, fadewhite, slideleft, zoomin, radial, pixelize...)
  text: {
    font: null,            // caminho de .ttf; vazio = Impact/Arial do sistema
    color: '#FFFFFF', border: '#000000', borderW: 4, shadow: 3,
    size: 0.085,           // fração da altura do vídeo
    position: 'center',    // center | bottom | top | upper
    killCounter: true, counterFormat: '{n}K', counterPosition: 'bottom', counterSize: 0.06, counterDuration: 0.6,
    labels: true, labelDuration: 1.2,
    // Legendas de "comentário" (estilo YouTuber: branco, contorno, embaixo, frases curtas)
    captionSize: 0.05, captionColor: '#FFFFFF', captionBorder: '#000000', captionBorderW: 3, captionPosition: 'caption', captionDuration: 1.3,
  },
  coldOpen: null,   // {text, before: 0.45, after: 0.4, speed: 0.45}: abre com flash do kill-herói em slow-mo (gancho dos 1–2 s)
  outroCard: null,  // {made, handle, music (auto do .credito.txt), duration: 2.5}: créditos no fim sobre preto
  watermark: null,  // {text: "@nick", position: "br", size: 0.03, opacity: 0.55}
  titleCard: null, // {text, sub, duration, size, color}: cartão de título sobre preto antes do 1º clipe (música já toca)
  words: null,     // {list: [...], from: 0, every: 1, size: 0.2, opacity: 0.85}: uma palavra grande por beat
  sfx: null,       // {whoosh: 0.35, impact: 0.8, riser: 0.5, riserDuration: 1.8, duckHero: 0.5}: efeitos sonoros sintetizados
  intro: null,
  outro: null,
  logo: { file: null, position: 'tl', scale: 0.12, opacity: 0.85 }, // tl: sobre o radar; tr cobriria o killfeed
  output: {
    fps: 60, width: 1920, height: 1080, crf: 18,
    formats: ['16x9', '9x16'],
    vertical: 'crop+killfeed', // crop | crop+killfeed | blur
    fadeIn: 0, fadeOut: 0,     // segundos de fade do/para o preto no começo e no fim
    youtube1440: false,        // também gera <nome>_youtube1440.mp4 (upload no YouTube com VP9/bitrate maior)
    killfeed: { x: 0.62, y: 0.04, w: 0.38, h: 0.24 },
    dir: null, name: null,
  },
};

export function deepMerge(base, over) {
  if (over === undefined || over === null) return structuredClone(base);
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : structuredClone(v);
  }
  return out;
}
