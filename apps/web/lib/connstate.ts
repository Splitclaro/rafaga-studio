// Estado real de las conexiones para las pantallas Conexiones e Inicio (B-02/B-03): nada de contadores fijos ni «próximamente» donde ya hay función.

export type AccountLike = { status: string };
export type PublicationLike = { state: string };

/** Estados en los que TikTok ya tiene el vídeo (publicado o borrador en su bandeja). */
const DELIVERED = new Set(["published", "private_pending_review"]);

export type TikTokState = { connected: number; total: number; needsAttention: number; delivered: number; label: string };

export function tiktokState(accounts: AccountLike[] | null, pubs: PublicationLike[] | null): TikTokState {
  const list = accounts ?? [];
  const connected = list.filter((a) => a.status === "connected").length;
  const needsAttention = list.length - connected;
  const delivered = (pubs ?? []).filter((p) => DELIVERED.has(p.state)).length;
  const label = !list.length ? "Sin conectar" : needsAttention ? `${connected} conectada${connected === 1 ? "" : "s"} · ${needsAttention} por revisar` : `${connected} cuenta${connected === 1 ? "" : "s"} conectada${connected === 1 ? "" : "s"}`;
  return { connected, total: list.length, needsAttention, delivered, label };
}

/** Cuentas de almacenamiento (Drive/Dropbox) realmente conectadas. */
export function storageConnected(conns: { provider: string; status: string }[] | null): number {
  return (conns ?? []).filter((c) => (c.provider === "google" || c.provider === "dropbox") && c.status === "connected").length;
}
