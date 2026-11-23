"use client";
// Reproductor y exportador de la línea de tiempo en el navegador (el trabajo ocurre en el equipo del usuario).
// UN reloj, UNA función de dibujo (`drawFrame`) para la vista previa y para el archivo: lo que se ve es lo que se graba.
// Exportación: canvas.captureStream + audio mezclado con WebAudio → MediaRecorder (MP4 si el navegador lo permite, WebM si no).
import { TL_ASPECTS, TEXT_SIZE, timelineAt, timelineDuration, type TimelineDoc, type TlAspect, type MediaRef, type VideoItem, type AudioItem } from "@rafaga/composition";

export type Resolve = (ref: MediaRef) => Promise<string>;
type El = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
const isMedia = (e: El): e is HTMLVideoElement | HTMLAudioElement => e instanceof HTMLMediaElement;

/** Elige el formato de grabación: MP4 (H.264/AAC) si el navegador lo soporta; si no, WebM. */
export function pickRecorderMime(): { mime: string; ext: "mp4" | "webm" } {
  const T = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  for (const m of ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"]) if (T?.isTypeSupported(m)) return { mime: m, ext: "mp4" };
  for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (T?.isTypeSupported(m)) return { mime: m, ext: "webm" };
  return { mime: "", ext: "webm" };
}

export class TimelinePlayer {
  private els = new Map<string, El>(); private ctx: AudioContext | null = null; private dest: MediaStreamAudioDestinationNode | null = null; private gains = new Map<string, GainNode>();
  private raf = 0; private t0 = 0; private from = 0; private _t = 0; playing = false;
  onTime: (t: number) => void = () => {}; onEnd: () => void = () => {};
  constructor(public canvas: HTMLCanvasElement, private getDoc: () => TimelineDoc, private getAspect: () => TlAspect, private resolve: Resolve, private scale = 0.5) { this.fit(); }

  fit() { const a = TL_ASPECTS[this.getAspect()]; this.canvas.width = Math.round((a.width * this.scale) / 2) * 2; this.canvas.height = Math.round((a.height * this.scale) / 2) * 2; }
  get time() { return this._t; }
  get duration() { return timelineDuration(this.getDoc()); }

  private async el(item: VideoItem | AudioItem): Promise<El | null> {
    const key = item.id + "|" + item.src.id; let e = this.els.get(key); if (e) return e;
    const url = await this.resolve(item.src).catch(() => ""); if (!url) return null;
    if (item.src.media === "image") { const im = new Image(); im.crossOrigin = "anonymous"; im.src = url; await im.decode().catch(() => {}); e = im; }
    else {
      const m = document.createElement(item.src.media === "audio" || item.src.kind === "song" ? "audio" : "video"); m.crossOrigin = "anonymous"; m.preload = "auto"; (m as HTMLVideoElement).playsInline = true; m.src = url;
      await new Promise<void>((ok) => { m.onloadeddata = () => ok(); m.onerror = () => ok(); setTimeout(ok, 8000); }); e = m;
    }
    this.els.set(key, e); return e;
  }
  /** Prepara los medios de la línea de tiempo (descarga los metadatos) antes de reproducir o exportar. */
  async preload() { const d = this.getDoc(); for (const tr of d.tracks) if (tr.kind !== "text") for (const it of tr.items) await this.el(it as VideoItem | AudioItem); }

  private graph(m: HTMLMediaElement, key: string, volume: number) {
    if (!this.ctx) { this.ctx = new AudioContext(); this.dest = this.ctx.createMediaStreamDestination(); }
    let g = this.gains.get(key);
    if (!g) { const src = this.ctx.createMediaElementSource(m); g = this.ctx.createGain(); src.connect(g); g.connect(this.dest!); g.connect(this.ctx.destination); this.gains.set(key, g); }
    g.gain.value = volume;
  }

  /** Dibuja el instante `t`: fondo negro, plano activo (relleno o ajustado) y textos. Misma función en vista previa y exportación. */
  async drawFrame(t: number) {
    const c = this.canvas, g = c.getContext("2d")!, d = this.getDoc(), W = c.width, H = c.height, s = timelineAt(d, t);
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (s.video) {
      const v = s.video, e = await this.el(v);
      if (e) {
        const w = e instanceof HTMLVideoElement ? e.videoWidth : e instanceof HTMLImageElement ? e.naturalWidth : 0, h = e instanceof HTMLVideoElement ? e.videoHeight : e instanceof HTMLImageElement ? e.naturalHeight : 0;
        if (w && h) { const k = v.fit === "fit" ? Math.min(W / w, H / h) : Math.max(W / w, H / h), dw = w * k, dh = h * k; g.drawImage(e as CanvasImageSource, (W - dw) / 2, (H - dh) / 2, dw, dh); }
      }
    }
    const k = this.getAspect() === "16:9" ? H / TL_ASPECTS["16:9"].height : H / TL_ASPECTS[this.getAspect()].height;
    for (const x of s.texts) {
      const fs = Math.round(TEXT_SIZE[x.size] * TL_ASPECTS[this.getAspect()].height * k);
      g.font = `700 ${fs}px Inter, "Helvetica Neue", Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = Math.max(2, fs / 9); g.strokeStyle = "#000"; g.fillStyle = x.color;
      const lines = x.text.split("\n"); lines.forEach((ln, i) => { const y = x.y * H + (i - (lines.length - 1) / 2) * fs * 1.2; g.strokeText(ln, W / 2, y); g.fillText(ln, W / 2, y); });
    }
    return s;
  }

  /** Sincroniza los medios con el instante: sitúa y reproduce el plano activo y las pistas de audio, pausa el resto. */
  private async sync(t: number, play: boolean) {
    const s = timelineAt(this.getDoc(), t), active = new Map<string, { e: HTMLMediaElement; time: number; vol: number }>();
    if (s.video && s.video.src.media !== "image") { const e = await this.el(s.video); if (e && isMedia(e)) active.set(s.video.id + "|" + s.video.src.id, { e, time: s.video.srcTime, vol: s.video.volume }); }
    for (const a of s.audio) { const e = await this.el(a); if (e && isMedia(e)) active.set(a.id + "|" + a.src.id, { e, time: a.srcTime, vol: a.volume }); }
    for (const [key, e] of this.els) if (isMedia(e) && !active.has(key)) e.pause();
    for (const [key, a] of active) {
      if (Math.abs(a.e.currentTime - a.time) > 0.25 || !play) a.e.currentTime = a.time;
      if (play) { this.graph(a.e, key, a.vol); if (a.e.paused) void a.e.play().catch(() => {}); } else a.e.pause();
    }
  }

  async seek(t: number) { this._t = Math.max(0, Math.min(t, this.duration)); this.onTime(this._t); await this.sync(this._t, false); await this.drawFrame(this._t); }

  async play(from = this._t) {
    if (this.playing) return; if (this.ctx?.state === "suspended") await this.ctx.resume();
    this.playing = true; this.from = from >= this.duration ? 0 : from; this.t0 = performance.now();
    const tick = async () => {
      if (!this.playing) return;
      const t = this.from + (performance.now() - this.t0) / 1000;
      if (t >= this.duration) { this.pause(); await this.seek(this.duration); this.onEnd(); return; }
      this._t = t; await this.sync(t, true); await this.drawFrame(t); this.onTime(t); this.raf = requestAnimationFrame(() => void tick());
    };
    this.raf = requestAnimationFrame(() => void tick());
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); for (const e of this.els.values()) if (isMedia(e)) e.pause(); }
  dispose() { this.pause(); for (const e of this.els.values()) if (isMedia(e)) { e.removeAttribute("src"); e.load(); } this.els.clear(); void this.ctx?.close(); }

  /** Exporta el proyecto completo a un archivo: reproduce de 0 al final grabando el canvas y el audio mezclado. */
  async exportFile(o: { fps?: number; scale?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<{ blob: Blob; ext: "mp4" | "webm"; mime: string; seconds: number }> {
    const { mime, ext } = pickRecorderMime(); if (!mime) throw new Error("Este navegador no puede grabar vídeo. Usa Chrome, Edge o Safari actualizados.");
    const D = this.duration; if (D <= 0.05) throw new Error("La línea de tiempo está vacía.");
    const keepScale = this.scale; if (o.scale) { this.scale = o.scale; this.fit(); }
    this.pause(); await this.preload(); await this.seek(0);
    if (!this.ctx) { this.ctx = new AudioContext(); this.dest = this.ctx.createMediaStreamDestination(); }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const stream = this.canvas.captureStream(o.fps ?? 30); for (const tr of this.dest!.stream.getAudioTracks()) stream.addTrack(tr);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 }), chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((ok) => { rec.onstop = () => ok(); });
    const prev = this.onTime; this.onTime = (t) => { prev(t); o.onProgress?.(Math.min(1, t / D)); };
    const ended = new Promise<void>((ok) => { this.onEnd = ok; });
    rec.start(250); await this.play(0);
    const abort = new Promise<never>((_, no) => o.signal?.addEventListener("abort", () => no(new Error("cancelado"))));
    try { await Promise.race([ended, abort]); await new Promise((r) => setTimeout(r, 300)); } finally { this.pause(); if (rec.state !== "inactive") rec.stop(); this.onTime = prev; }
    await done; if (o.scale) { this.scale = keepScale; this.fit(); }
    return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext, mime, seconds: D };
  }
}
