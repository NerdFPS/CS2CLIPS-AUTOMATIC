# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "faster-whisper==1.2.1",
#   "av>=14,<15",
#   "nvidia-cublas-cu12; sys_platform == 'win32' or sys_platform == 'linux'",
#   "nvidia-cudnn-cu12>=9,<10; sys_platform == 'win32' or sys_platform == 'linux'",
# ]
# ///
"""Transcrição local (Whisper via faster-whisper), com tempo de cada palavra.

uso: uv run --no-build transcribe.py <video_ou_audio> --out transcript.json [--lang pt] [--model large-v3-turbo]
       [--track N] [--start S --end E] [--ffmpeg caminho]

- Extrai o áudio com o ffmpeg (trilha --track; útil quando o OBS grava o microfone separado).
- GPU NVIDIA (CUDA 12) quando existir; senão CPU int8.
- Saída: {"lang", "model", "device", "offset", "segments": [{"start","end","text","words":[{"s","e","w"}]}]}
  Tempos absolutos (já somam --start).
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
import time


def add_cuda_dlls():
    # As wheels nvidia-* trazem as DLLs do CUDA 12, mas o ctranslate2 não as procura sozinho no Windows.
    dirs = [p for p in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")) if os.path.isdir(p)]
    dirs += [p for p in glob.glob(os.path.join(sys.prefix, "lib", "python*", "site-packages", "nvidia", "*", "lib")) if os.path.isdir(p)]
    for d in dirs:
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(d)
    os.environ["PATH"] = os.pathsep.join(dirs + [os.environ.get("PATH", "")])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lang", default="pt")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--track", type=int, default=None)
    ap.add_argument("--start", type=float, default=None)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--cpu", action="store_true")
    a = ap.parse_args()

    add_cuda_dlls()
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    from faster_whisper import WhisperModel

    tmp = tempfile.mkdtemp(prefix="tac-whisper-")
    wav = os.path.join(tmp, "a.wav")
    cmd = [a.ffmpeg, "-hide_banner", "-nostdin", "-v", "error"]
    if a.start is not None:
        cmd += ["-ss", str(a.start)]
    if a.end is not None:
        cmd += ["-to", str(a.end)] if a.start is None else ["-t", str(a.end - a.start)]
    cmd += ["-i", a.media]
    cmd += ["-map", f"0:a:{a.track}"] if a.track is not None else ["-map", "0:a:0"]
    cmd += ["-ac", "1", "-ar", "16000", "-y", wav]
    subprocess.run(cmd, check=True)

    model, device = None, None
    for dev, ct in ([] if a.cpu else [("cuda", "float16")]) + [("cpu", "int8")]:
        try:
            model = WhisperModel(a.model, device=dev, compute_type=ct)
            device = dev
            break
        except Exception as e:  # sem CUDA → CPU
            print(f"[transcribe] {dev} indisponível ({e}); tentando o próximo", file=sys.stderr)
    t0 = time.time()
    segs, info = model.transcribe(wav, language=a.lang, word_timestamps=True, vad_filter=True,
                                  vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False)
    off = a.start or 0.0
    out = []
    last = 0
    for s in segs:
        out.append({"start": round(s.start + off, 2), "end": round(s.end + off, 2), "text": s.text.strip(),
                    "words": [{"s": round(w.start + off, 2), "e": round(w.end + off, 2), "w": w.word.strip()} for w in (s.words or [])]})
        if s.end - last > 300:
            last = s.end
            print(f"[transcribe] {int(s.end // 60)} min transcritos ({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"lang": a.lang, "model": a.model, "device": device, "offset": off, "duration": info.duration, "segments": out}, f, ensure_ascii=False)
    print(f"[transcribe] {len(out)} trechos em {time.time() - t0:.0f} s ({device})", file=sys.stderr)
    try:
        os.remove(wav)
        os.rmdir(tmp)
    except OSError:
        pass


if __name__ == "__main__":
    main()
