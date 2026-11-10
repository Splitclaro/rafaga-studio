#!/usr/bin/env python3
"""Detección de caras por muestreo (Haar de OpenCV). Entrada: vídeo, inicio y duración del tramo. Salida: JSON por stdout.
Una cara = {cx, cy, w, h, s} normalizados al fotograma; s = peso de confianza del detector (≈0..10+).
Limitación conocida: Haar es mejor con caras frontales o casi; para perfiles se prueba también el cascade de perfil."""
import argparse, json, subprocess, sys
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("--start", type=float, default=0); ap.add_argument("--dur", type=float, required=True)
ap.add_argument("--fps", type=float, default=3); ap.add_argument("--width", type=int, default=640)
a = ap.parse_args()

probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", a.video]))["streams"][0]
sw, sh = int(probe["width"]), int(probe["height"])
w = a.width - (a.width % 2); h = int(round(w * sh / sw / 2) * 2)
cmd = ["ffmpeg", "-v", "error", "-ss", str(a.start), "-t", str(a.dur), "-i", a.video, "-vf", f"fps={a.fps},scale={w}:{h},format=gray", "-f", "rawvideo", "-"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
front = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
prof = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
if front.empty() or prof.empty():
    print("cascade no disponible", file=sys.stderr); sys.exit(2)
min_side = max(24, int(h * 0.06))
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def detect(g):
    out = []
    boxes, _, weights = front.detectMultiScale3(g, scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side), outputRejectLevels=True)
    for (x, y, bw, bh), s in zip(boxes, weights): out.append((x, y, bw, bh, float(s)))
    if not out:   # perfil (y su reflejo)
        for flip in (False, True):
            gg = cv2.flip(g, 1) if flip else g
            boxes, _, weights = prof.detectMultiScale3(gg, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side), outputRejectLevels=True)
            for (x, y, bw, bh), s in zip(boxes, weights):
                out.append((w - x - bw if flip else x, y, bw, bh, float(s) * 0.8))
    return out

samples = []; i = 0; size = w * h
while True:
    buf = proc.stdout.read(size)
    if not buf or len(buf) < size: break
    g = np.frombuffer(buf, dtype=np.uint8).reshape((h, w))
    g = clahe.apply(g)
    faces = [{"cx": round((x + bw / 2) / w, 4), "cy": round((y + bh / 2) / h, 4), "w": round(bw / w, 4), "h": round(bh / h, 4), "s": round(s, 2)} for (x, y, bw, bh, s) in detect(g)]
    samples.append({"t": round(i / a.fps, 3), "faces": faces}); i += 1
proc.wait()
print(json.dumps({"w": sw, "h": sh, "fps": a.fps, "samples": samples}))
