import { useCallback, useEffect, useState } from "react";
import { Archive, Download, Eye, FileUp, Send } from "lucide-react";
import { toast } from "sonner";
import {
  nutritionDocumentUrl,
  selfhostArchiveNutritionDocument,
  selfhostNutritionDocuments,
  selfhostPublishNutritionDocument,
  selfhostUploadNutritionDocument,
  type NutritionDocument,
} from "@/lib/selfhost/client-api";

export function NutritionDocumentsPanel({
  clientId,
  courseId,
  readonly = false,
}: {
  clientId: string;
  courseId: string | null | undefined;
  readonly?: boolean;
}) {
  const [items, setItems] = useState<NutritionDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayMode, setDisplayMode] = useState<"supplement" | "primary">("supplement");
  const [file, setFile] = useState<File | null>(null);
  const load = useCallback(async () => {
    if (!courseId) {
      setItems([]);
      return;
    }
    setItems(await selfhostNutritionDocuments(clientId, courseId));
  }, [clientId, courseId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!courseId)
    return (
      <div className="rounded-2xl border border-gold/15 p-5 text-sm text-warm-gray">
        Сначала выберите курс.
      </div>
    );
  const upload = async () => {
    if (!file || !title.trim()) return toast.error("Укажите название и выберите PDF или DOCX");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("clientId", clientId);
      form.set("courseId", courseId);
      form.set("title", title.trim());
      form.set("description", description.trim());
      form.set("displayMode", displayMode);
      form.set("file", file);
      await selfhostUploadNutritionDocument(form);
      setTitle("");
      setDescription("");
      setFile(null);
      await load();
      toast.success("Черновик загружен. Клиент его пока не видит.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-3xl border border-gold/15 bg-surface/30 p-6">
      <div>
        <p className="eyebrow">Меню от тренера</p>
        <h2 className="mt-1 font-display text-xl">
          {readonly ? "Готовые документы" : "Загрузить готовое меню"}
        </h2>
      </div>
      {!readonly && (
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название"
            maxLength={200}
            className="rounded-xl border border-gold/20 bg-background px-3 py-2"
          />
          <select
            value={displayMode}
            onChange={(e) => setDisplayMode(e.target.value as "supplement" | "primary")}
            className="rounded-xl border border-gold/20 bg-background px-3 py-2"
          >
            <option value="supplement">Дополнение к текущему меню</option>
            <option value="primary">Показывать как основное меню</option>
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Пояснение (необязательно)"
            maxLength={2000}
            className="rounded-xl border border-gold/20 bg-background px-3 py-2 md:col-span-2"
          />
          <input
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void upload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gold px-4 py-2 text-background disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" />
            Загрузить черновик
          </button>
          <p className="text-xs text-warm-gray md:col-span-2">
            PDF или DOCX, до 10 МБ. Старый DOC не принимается: сохраните файл как DOCX или PDF.
          </p>
        </div>
      )}
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-warm-gray">Опубликованных документов пока нет.</p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-gold/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{item.title}</h3>
                  <p className="text-xs text-warm-gray">
                    Версия {item.version} · {item.status} ·{" "}
                    {new Date(item.published_at ?? item.created_at).toLocaleDateString("ru-RU")}
                  </p>
                  {item.description && (
                    <p className="mt-2 text-sm text-warm-gray">{item.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={nutritionDocumentUrl(item.id, "view", readonly ? undefined : clientId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gold/25 px-3 py-1.5 text-xs"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Открыть меню
                  </a>
                  <a
                    href={nutritionDocumentUrl(
                      item.id,
                      "original",
                      readonly ? undefined : clientId,
                    )}
                    className="inline-flex items-center gap-1 rounded-lg border border-gold/25 px-3 py-1.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать оригинал
                  </a>
                  {!readonly && item.status === "draft" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await selfhostPublishNutritionDocument(item.id);
                            await load();
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-gold px-3 py-1.5 text-xs text-background"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Опубликовать
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await selfhostArchiveNutritionDocument(item.id);
                            await load();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-coral/25 px-3 py-1.5 text-xs"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Архив
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
