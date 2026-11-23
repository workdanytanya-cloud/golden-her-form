import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import { SafeExerciseVideo } from "@/components/panel/SafeExerciseVideo";

export type RutubeManualItem = {
  exerciseId: string;
  label: string;
  note: string | null;
  url: string;
};

type Props = {
  title: string;
  hint: string;
  items: RutubeManualItem[];
  onSave?: (item: RutubeManualItem) => Promise<void>;
  moveLabel?: string;
  onMove?: (item: RutubeManualItem) => Promise<void>;
  addLabel?: string;
  onAdd?: (input: { label: string; url: string }) => Promise<void>;
};

type ScrollMark = { node: HTMLElement; top: number };

function scrollParent(start: HTMLElement | null): HTMLElement | null {
  let node = start?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 8) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

function PreviewPane({ item, onClose }: { item: RutubeManualItem; onClose: () => void }) {
  const video = normalizeExerciseVideo({ url: item.url, title: item.label });

  return (
    <div data-rutube-preview={item.exerciseId} className="mt-3 space-y-2 rounded-xl border border-gold/20 bg-background/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-widest text-gold">Предпросмотр</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-gold/30 px-3 py-1 text-[11px] uppercase tracking-widest text-warm-gray"
        >
          Закрыть предпросмотр
        </button>
      </div>
      {video.status !== "ok" ? (
        <p className="text-[11px] text-warm-gray">Ссылка добавлена · не проверено</p>
      ) : null}
      <div className="aspect-video max-h-[40vh] overflow-hidden rounded-xl bg-black">
        <SafeExerciseVideo url={item.url} title={item.label} className="h-full w-full" />
      </div>
    </div>
  );
}

export function RutubeManualLibrary({
  title,
  hint,
  items,
  onSave,
  moveLabel,
  onMove,
  addLabel,
  onAdd,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const scrollMark = useRef<ScrollMark | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  function openPreview(exerciseId: string, anchor: HTMLElement) {
    if (!previewId) {
      const node = scrollParent(anchor);
      if (node) scrollMark.current = { node, top: node.scrollTop };
    }
    setPreviewId(exerciseId);
  }

  function closePreview() {
    setPreviewId(null);
    const mark = scrollMark.current;
    requestAnimationFrame(() => {
      if (mark) mark.node.scrollTop = mark.top;
    });
  }

  useEffect(() => {
    if (!previewId) return;
    previewRef.current?.querySelector("[data-rutube-preview]")?.scrollIntoView({ block: "nearest" });
  }, [previewId]);

  return (
    <div className="space-y-3 rounded-2xl border border-gold/20 bg-background/40 p-3">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gold">{title}</p>
        <p className="mt-1 text-xs text-warm-gray">{hint}</p>
      </div>
      {onAdd ? (
        <div className="space-y-2 rounded-xl border border-gold/15 bg-surface/30 p-3">
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">
            {addLabel ?? "Добавить тренировку"}
          </p>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Название"
            className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory outline-none focus:border-gold/60"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Ссылка RUTUBE"
            className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory outline-none focus:border-gold/60"
          />
          <button
            type="button"
            disabled={adding || !newLabel.trim() || !newUrl.trim()}
            onClick={() => {
              setAdding(true);
              void onAdd({ label: newLabel.trim(), url: newUrl.trim() })
                .then(() => {
                  setNewLabel("");
                  setNewUrl("");
                  toast.success("Добавлено в папку");
                })
                .catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : "Не удалось добавить");
                })
                .finally(() => setAdding(false));
            }}
            className="rounded-full bg-gold px-3 py-1.5 text-[11px] uppercase tracking-widest text-background disabled:opacity-40"
          >
            {adding ? "Добавляем…" : "Добавить"}
          </button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-warm-gray">В подборке пока нет роликов.</p>
      ) : (
        items.map((item) => (
          <div
            key={item.exerciseId}
            ref={item.exerciseId === previewId ? previewRef : undefined}
            className="rounded-xl border border-gold/10 bg-surface/40 p-3"
          >
            <p className="break-words text-sm text-ivory">{item.label}</p>
            {item.note ? <p className="mt-1 text-xs text-gold">{item.note}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={(event) => openPreview(item.exerciseId, event.currentTarget)}
                className="rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-widest text-gold"
              >
                Предпросмотр
              </button>
              {onSave ? (
                <button
                  type="button"
                  disabled={savingId === item.exerciseId}
                  onClick={() => {
                    setSavingId(item.exerciseId);
                    void onSave(item)
                      .catch((error: unknown) => {
                        toast.error(error instanceof Error ? error.message : "Черновик не изменён");
                      })
                      .finally(() => setSavingId(null));
                  }}
                  className="rounded-full bg-gold px-3 py-1.5 text-[11px] uppercase tracking-widest text-background disabled:opacity-40"
                >
                  {savingId === item.exerciseId ? "Сохраняем…" : "Сохранить в черновик"}
                </button>
              ) : null}
              {onMove && moveLabel ? (
                <button
                  type="button"
                  disabled={movingId === item.exerciseId}
                  onClick={() => {
                    setMovingId(item.exerciseId);
                    void onMove(item)
                      .then(() => toast.success("Перенесено"))
                      .catch((error: unknown) => {
                        toast.error(error instanceof Error ? error.message : "Не удалось перенести");
                      })
                      .finally(() => setMovingId(null));
                  }}
                  className="rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-widest text-warm-gray hover:text-ivory disabled:opacity-40"
                >
                  {movingId === item.exerciseId ? "Переносим…" : moveLabel}
                </button>
              ) : null}
            </div>
            {previewId === item.exerciseId ? <PreviewPane item={item} onClose={closePreview} /> : null}
          </div>
        ))
      )}
    </div>
  );
}
