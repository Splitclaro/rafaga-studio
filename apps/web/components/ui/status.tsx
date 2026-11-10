import Icon from "../Icon";

/** Estados visibles de una pieza. «Listo» = generado; «Aprobado» = revisado y aprobado EN SU VERSIÓN ACTUAL. Nunca se mezclan. */
export type PieceStatus = "preparing" | "generating" | "ready" | "to_review" | "changes" | "approved" | "failed" | "cancelled";
const META: Record<PieceStatus, { label: string; icon: string; cls: string }> = {
  preparing: { label: "Preparando", icon: "clock", cls: "text-[var(--muted)] bg-[var(--hover)]" },
  generating: { label: "Generando", icon: "bolt", cls: "text-[var(--muted)] bg-[var(--hover)]" },
  ready: { label: "Listo", icon: "check", cls: "text-[var(--text)] bg-[var(--hover)]" },
  to_review: { label: "Por revisar", icon: "clock", cls: "text-[var(--text)] bg-white ring-1 ring-inset ring-[#bdbdbd]" },
  changes: { label: "Cambios solicitados", icon: "wand", cls: "text-[var(--text)] bg-white ring-1 ring-inset ring-[#111] [&]:ring-dashed" },
  approved: { label: "Aprobado", icon: "check", cls: "text-white bg-[var(--ink)]" },
  failed: { label: "Fallido", icon: "x", cls: "text-[var(--text)] bg-white ring-2 ring-inset ring-[#111]" },
  cancelled: { label: "Cancelado", icon: "x", cls: "text-[var(--muted)] bg-[var(--hover)]" },
};
export const STATUS_LABEL = (s: PieceStatus) => META[s].label;

export function StatusLabel({ status, note, className = "" }: { status: PieceStatus; note?: string; className?: string }) {
  const m = META[status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls} ${className}`} title={note}><Icon n={m.icon} className="h-3 w-3" />{m.label}</span>;
}

export type ReviewFields = { review_status: string; approved_version: number | null; current_version: number; hasRender: boolean; failed?: boolean };
/** Estado efectivo: la aprobación solo cuenta si corresponde a la versión actual del clip. */
export function pieceStatus(c: ReviewFields): { status: PieceStatus; note?: string } {
  if (c.failed) return { status: "failed" };
  if (!c.hasRender) return { status: "generating" };
  if (c.review_status === "approved") return c.approved_version === c.current_version ? { status: "approved" } : { status: "to_review", note: `Aprobada la v${c.approved_version}; el clip va por la v${c.current_version}: necesita nueva revisión` };
  if (c.review_status === "changes_requested") return { status: "changes" };
  return { status: "to_review" };
}
export const fmtDur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`; };
