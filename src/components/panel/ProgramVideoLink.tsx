import { useState } from "react";
import { toast } from "sonner";
import { SafeExerciseVideo } from "@/components/panel/SafeExerciseVideo";
import { normalizeExerciseVideo, type ExerciseVideo } from "@/lib/exercise-video";
import { selfhostSetProgramExerciseVideo } from "@/lib/selfhost/client-api";

type Props = {
  programId: string;
  exerciseId: string;
  hasVideo: boolean;
  onSaved: (video: ExerciseVideo) => void;
};

export function ProgramVideoLink({ programId, exerciseId, hasVideo, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [checked, setChecked] = useState<ExerciseVideo | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setOpen(false);
    setUrl("");
    setChecked(null);
    setSaving(false);
  };

  const check = () => {
    const video = normalizeExerciseVideo({ url });
    if (video.provider !== "rutube" || !video.embed_url) {
      setChecked(null);
      toast.error("Нужна полная ссылка RUTUBE, включая ролик «Только по ссылке».");
      return;
    }
    setChecked(video);
  };

  const save = async () => {
    if (!checked?.url) return;
    setSaving(true);
    try {
      const video = await selfhostSetProgramExerciseVideo(programId, exerciseId, checked.url);
      onSaved(video);
      toast.success("Ссылка сохранена только в этой программе");
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ссылка не сохранена");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-widest text-gold hover:bg-gold/10"
      >
        {hasVideo ? "Изменить ссылку" : "Добавить видео"}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-gold/20 bg-background/40 p-3">
      <p className="text-xs font-medium text-ivory">Только в этой программе</p>
      <input
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setChecked(null);
        }}
        placeholder="Полная ссылка RUTUBE"
        className="w-full rounded-xl border border-gold/20 bg-background/50 px-3 py-2 text-sm text-ivory outline-none focus:border-gold/60"
      />
      {checked?.embed_url ? (
        <div className="space-y-2">
          <div className="aspect-video overflow-hidden rounded-xl bg-black">
            <SafeExerciseVideo url={checked.url} video={checked} label="Предпросмотр" className="h-full w-full" />
          </div>
          <a
            href={checked.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-gold underline"
          >
            Открыть видео
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={check}
          className="rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-widest text-gold"
        >
          Проверить видео
        </button>
        <button
          type="button"
          disabled={!checked || saving}
          onClick={() => void save()}
          className="rounded-full bg-gold px-3 py-1.5 text-[11px] uppercase tracking-widest text-background disabled:opacity-40"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-gold/20 px-3 py-1.5 text-[11px] uppercase tracking-widest text-warm-gray"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
