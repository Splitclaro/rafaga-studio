// Catálogo de destinos (38). ORIENTATIVO: requisitos y métodos resumidos de conocimiento general y marcados
// `verified:false` hasta comprobarlos contra la documentación oficial vigente. Ningún conector está implementado todavía.
export type Cap = "identity" | "import" | "publish" | "schedule" | "metrics" | "liveOut" | "liveIn" | "notify";
export const CAPS: Record<Cap, string> = { identity: "Identidad", import: "Importar medios", publish: "Publicar vídeo", schedule: "Programar (nuestra cola)", metrics: "Leer métricas", liveOut: "Emitir en directo", liveIn: "Recibir directo", notify: "Notificar" };
export type Method = "oauth" | "apikey" | "streamkey" | "protocol" | "own" | "none";
export const METHOD: Record<Method, string> = { oauth: "OAuth", apikey: "Token o clave de API", streamkey: "Clave de emisión (RTMP)", protocol: "Protocolo de emisión", own: "Funcionalidad propia", none: "Sin API pública conocida" };
export interface Platform { id: string; name: string; group: "Redes de vídeo" | "Directos" | "Protocolos y propios" | "Mensajería" | "Otros"; caps: Cap[]; method: Method; needs: string; docs?: string; verified: boolean; shortVideo: boolean }

const P = (id: string, name: string, group: Platform["group"], caps: Cap[], method: Method, needs: string, o: { docs?: string; verified?: boolean; shortVideo?: boolean } = {}): Platform => ({ id, name, group, caps, method, needs, docs: o.docs, verified: o.verified ?? false, shortVideo: o.shortVideo ?? false });

export const PLATFORMS: Platform[] = [
  P("youtube", "YouTube", "Redes de vídeo", ["identity", "publish", "schedule", "metrics", "liveOut"], "oauth", "App en Google Cloud con YouTube Data API; verificación de la app para publicar en público; cuota diaria; canal autorizado.", { docs: "https://developers.google.com/youtube/v3", shortVideo: true }),
  P("tiktok", "TikTok", "Redes de vídeo", ["identity", "publish", "schedule", "metrics"], "oauth", "App en TikTok for Developers con Content Posting API; sin auditoría solo publicaciones privadas; scopes y revisión de la plataforma.", { docs: "https://developers.tiktok.com/doc/content-posting-api-get-started", shortVideo: true }),
  P("instagram", "Instagram", "Redes de vídeo", ["identity", "publish", "schedule", "metrics"], "oauth", "Cuenta profesional vinculada a una página de Facebook y app de Meta con revisión para publicar Reels.", { docs: "https://developers.facebook.com/docs/instagram-platform", shortVideo: true }),
  P("facebook", "Facebook", "Redes de vídeo", ["identity", "publish", "schedule", "metrics", "liveOut"], "oauth", "App de Meta con revisión; solo páginas donde seas administrador (no perfiles personales).", { docs: "https://developers.facebook.com/docs/pages-api", shortVideo: true }),
  P("linkedin", "LinkedIn", "Redes de vídeo", ["identity", "publish", "schedule", "metrics"], "oauth", "App con productos de LinkedIn aprobados; perfil u organización según rol.", { docs: "https://learn.microsoft.com/linkedin/", shortVideo: true }),
  P("x", "X", "Redes de vídeo", ["identity", "publish", "schedule", "metrics"], "oauth", "Acceso a la API de X con el nivel que permita publicar medios (puede ser de pago).", { docs: "https://developer.x.com", shortVideo: true }),
  P("dailymotion", "Dailymotion", "Redes de vídeo", ["identity", "publish", "metrics"], "oauth", "Por verificar: API con OAuth para subir vídeos.", { shortVideo: true }),
  P("rumble", "Rumble", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión RTMP; API de subida no confirmada."),
  P("twitch", "Twitch", "Directos", ["identity", "metrics", "liveOut"], "oauth", "App en Twitch Developers; emisión por clave RTMP. No ofrece subida de vídeos cortos por API.", { docs: "https://dev.twitch.tv/docs/" }),
  P("kick", "Kick", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión RTMP; alcance de su API pública."),
  P("amazonlive", "Amazon Live", "Directos", ["liveOut"], "none", "Por verificar vigencia del servicio y su método de entrada."),
  P("soop", "SOOP", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("naver", "Naver TV", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("vaughn", "Vaughn Live", "Directos", ["liveOut"], "streamkey", "Por verificar vigencia y método."),
  P("nimo", "Nimo TV", "Directos", ["liveOut"], "streamkey", "Por verificar vigencia y método."),
  P("picarto", "Picarto.TV", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("fc2", "FC2 Live", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("breakers", "Breakers.TV", "Directos", ["liveOut"], "streamkey", "Por verificar vigencia y método."),
  P("bilibili", "Bilibili", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión y requisitos de cuenta."),
  P("nonolive", "Nonolive", "Directos", ["liveOut"], "streamkey", "Por verificar vigencia y método."),
  P("kakaotv", "kakaoTV", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("mlg", "Major League Gaming", "Directos", ["liveOut"], "none", "Por verificar vigencia del servicio."),
  P("douyu", "Douyu", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("huya", "Huya", "Directos", ["liveOut"], "streamkey", "Por verificar: clave de emisión de la plataforma."),
  P("zhanqi", "Zhanqi.tv", "Directos", ["liveOut"], "none", "Por verificar vigencia del servicio."),
  P("steam", "Steam", "Directos", ["liveOut"], "none", "Por verificar: Steam Broadcasting no tiene API pública de emisión conocida."),
  P("rtmp", "RTMP personalizado", "Protocolos y propios", ["liveOut"], "protocol", "Requiere un worker de distribución en directo con supervisión por destino (no implementado)."),
  P("srt", "SRT personalizado", "Protocolos y propios", ["liveOut", "liveIn"], "protocol", "Host, puerto, streamid, latencia y cifrado; requiere worker de distribución (no implementado)."),
  P("whip", "WHIP personalizado", "Protocolos y propios", ["liveOut"], "protocol", "Endpoint WebRTC, autorización y ciclo de sesión; requiere worker de distribución (no implementado)."),
  P("hls", "HLS personalizado", "Protocolos y propios", ["liveIn", "liveOut"], "protocol", "Entrada: captura de playlist y segmentos (planificada en «En vivo»). Salida: segmentación y publicación (no implementado)."),
  P("embed", "Reproductor incrustable", "Protocolos y propios", ["publish"], "own", "Funcionalidad propia: reproductor sobre tus medios con control de acceso (no implementado)."),
  P("webinar", "Página de webinar", "Protocolos y propios", ["publish"], "own", "Funcionalidad propia: página pública con tu emisión (no implementado)."),
  P("mux", "Mux", "Otros", ["import", "publish", "liveIn"], "apikey", "Cuenta de Mux con token de acceso; subida directa y emisión en directo.", { docs: "https://docs.mux.com" }),
  P("patreon", "Patreon", "Otros", ["identity", "publish"], "oauth", "Por verificar: API v2 de Patreon y si permite publicar vídeo."),
  P("substack", "Substack", "Otros", [], "none", "Por verificar: no se conoce API pública de publicación."),
  P("mixcloud", "Mixcloud", "Otros", ["identity", "publish"], "oauth", "Por verificar: API con OAuth; orientada a audio."),
  P("telegram", "Telegram", "Mensajería", ["notify", "publish"], "apikey", "Bot creado con BotFather (token) añadido a tu canal o grupo; límite de tamaño por archivo.", { docs: "https://core.telegram.org/bots/api" }),
  P("slack", "Slack", "Mensajería", ["notify", "publish"], "oauth", "App de Slack con permisos de mensajes y archivos en tu espacio de trabajo.", { docs: "https://api.slack.com" }),
];
export const PUBLISH_TARGETS = PLATFORMS.filter((p) => p.caps.includes("publish") && p.shortVideo).map((p) => p.name);
