import { useRef, useState } from "react";
import { Upload, X, Loader2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</div>
      {value ? (
        <div className="relative overflow-hidden rounded-xl border border-gold/20 bg-background/40">
          {preview === "video" ? (
            <video src={value} controls className="max-h-56 w-full" />
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
        placeholder="или вставьте ссылку"
        className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-xs text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
      />
    </div>
  );
}
