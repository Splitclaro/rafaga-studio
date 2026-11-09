import SubtitleEditor from "../../../components/SubtitleEditor";
import type { Word } from "@rafaga/composition";

// Mismo fixture sintético que scripts/spike-subs.ts (solo desarrollo).
const words: Word[] = [
  { text: "Mañana", start: 0.0, end: 0.5 }, { text: "empieza", start: 0.5, end: 1.0 },
  { text: "tu", start: 1.0, end: 1.2 }, { text: "canción", start: 1.2, end: 1.9 },
  { text: "número", start: 1.9, end: 2.4 }, { text: "uno.", start: 2.4, end: 3.0 },
];

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Editor de subtítulos</h1>
      <SubtitleEditor initialWords={words} duration={3.2} />
    </main>
  );
}
