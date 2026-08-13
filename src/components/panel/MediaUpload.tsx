import { useRef, useState } from "react";
import { Upload, X, Loader2, Download, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getVideoEmbedUrl, isDirectVideoFile } from "@/lib/video-embed";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export function MediaUpload({
  label,
  value,
  onChange,
  accept,
  folder,
  preview = "image",
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  accept: string;
  folder: string;
  preview?: "image" | "video";
}) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handle = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("media")
      .upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
    if (upErr) {
      setBusy(false);
      return toast.error(upErr.message);
    }
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(path, TEN_YEARS);
    setBusy(false);
    if (error || !data) return toast.error(error?.message ?? "Не удалось получить ссылку");
    onChange(data.signedUrl);
    toast.success("Файл загружен");
  };

  const embedUrl = value && preview === "video" ? getVideoEmbedUrl(value) : null;
  const isFile = value && preview === "video" ? isDirectVideoFile(value) : false;

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</div>
      {value ? (
        <div className="relative overflow-hidden rounded-xl border border-gold/20 bg-background/40">
          {preview === "video" ? (
            embedUrl ? (
              <iframe
                src={embedUrl}
                title={label}
                className="aspect-video max-h-56 w-full border-0"
                allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
                allowFullScreen
              />
            ) : isFile ? (
              <video src={value} controls className="max-h-56 w-full" />
            ) : (
              <div className="flex max-h-56 min-h-[140px] flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-xs text-warm-gray">Превью недоступно для этой ссылки</p>
                <a
                  href={value}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Открыть видео
                </a>
              </div>
            )
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="max-h-56 w-full object-cover" />
          )}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 rounded-full bg-background/80 p-1 text-ivory hover:bg-coral/70"
            aria-label="Удалить"
          >
            <X className="h-4 w-4" />
          </button>
          {!embedUrl && (
            <a
              href={value}
              download
              target="_blank"
              rel="noreferrer"
              className="absolute right-10 top-2 rounded-full bg-background/80 p-1 text-ivory hover:bg-gold/70"
              aria-label="Скачать"
              title="Скачать"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gold/30 bg-background/40 px-4 py-6 text-sm text-warm-gray transition-colors hover:border-gold/60 hover:text-ivory disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Загрузка…" : "Загрузить файл"}
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
          e.target.value = "";
        }}
      />
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={
          preview === "video"
            ? "или вставьте ссылку YouTube / Rutube / mp4"
            : "или вставьте ссылку"
        }
        className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-xs text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
      />
    </div>
  );
}
