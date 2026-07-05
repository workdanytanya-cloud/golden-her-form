import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { TrainingView } from "@/components/panel/TrainingView";
import { supabase } from "@/integrations/supabase/client";
import {
  loadExercises,
  loadProgramFor,
  loadProgramProfile,
  createOrReplaceProgram,
  updateDayPatch,
  updateProgramPatch,
  type ProgramRow,
  type DayRow,
  type Exercise,
} from "@/lib/training-repo";
import {
  type ProgramDay,
  type ProgramGoal,
  type ProgramLevel,
  type ProgramInput,
  type FaqItem,
  GOAL_LABEL,
} from "@/lib/training";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/training")({
  component: AdminTrainingPage,
});

function AdminTrainingPage() {
  const { id } = Route.useParams();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [profile, setProfile] = useState<{
    sessions_per_week: 3 | 4;
    goal: ProgramGoal;
    level: ProgramLevel;
    has_injuries: boolean;
    injuries_details: string | null;
    equipment: string[];
    location: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const [ex, p, prof, profRow] = await Promise.all([
      loadExercises(),
      loadProgramFor(id),
      loadProgramProfile(id),
      supabase.from("profiles").select("full_name").eq("id", id).maybeSingle(),
    ]);
    setExercises(ex);
    setProgram(p.program);
    setDays(p.days);
    setProfile({
      sessions_per_week: prof.sessions_per_week,
      goal: prof.goal,
      level: prof.level,
      has_injuries: prof.has_injuries,
      injuries_details: prof.injuries_details,
      equipment: prof.equipment,
      location: prof.location,
    });
    setProfileName(profRow.data?.full_name ?? "Клиент");
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleRegenerate = async (overrides?: Partial<ProgramInput>) => {
    if (!profile) return;
    const input: ProgramInput = {
      sessions_per_week: profile.sessions_per_week,
      goal: profile.goal,
      level: profile.level,
      has_injuries: profile.has_injuries,
      injuries_details: profile.injuries_details,
      equipment: profile.equipment,
      location: profile.location,
      ...overrides,
    };
    try {
      await createOrReplaceProgram({
        userId: id,
        input,
        exercises,
        preserveNotes: program?.notes ?? null,
        preserveFaq: program?.faq ?? null,
        targetsManual: overrides ? true : program?.targets_manual,
      });
      await reload();
      toast.success("Программа собрана заново");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDayPatch = async (dayIndex: number, patch: Partial<ProgramDay>) => {
    if (!program) return;
    await updateDayPatch(program.id, dayIndex, patch);
    setDays((cur) =>
      cur.map((d) => (d.day_index === dayIndex ? { ...d, ...(patch as Partial<DayRow>) } : d)),
    );
  };

  const handleProgramPatch = async (patch: { notes?: string | null; faq?: FaqItem[] }) => {
    if (!program) return;
    await updateProgramPatch(program.id, patch);
    setProgram((p) => (p ? { ...p, ...patch, faq: patch.faq ?? p.faq } : p));
  };

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем…</div>;

  const programDays: ProgramDay[] = days.map((d) => ({
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup,
    exercises: d.exercises,
    cooldown: d.cooldown,
    day_note: d.day_note,
  }));

  return (
    <div className="space-y-8">
      <Link
        to="/admin/clients/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-sm text-warm-gray hover:text-ivory"
      >
        <ArrowLeft className="h-4 w-4" /> К карточке клиента
      </Link>

      <PanelHeader
        eyebrow="Программа тренировок"
        title={profileName}
        description="Меняй упражнения, подходы, повторы и комментарии. Клиент видит изменения сразу."
      />

      {program && profile && (
        <ParamsEditor
          program={program}
          profile={profile}
          onSaveTargets={async (sessions, goal, level) => {
            await handleRegenerate({ sessions_per_week: sessions, goal, level });
          }}
          onSaveNotes={async (notes) => {
            await handleProgramPatch({ notes });
            toast.success("Комментарий сохранён");
          }}
        />
      )}

      {!program ? (
        <div className="rounded-3xl border border-gold/15 bg-surface/40 p-8 text-center">
          <p className="text-warm-gray">У клиента ещё нет программы.</p>
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background"
          >
            <Sparkles className="h-4 w-4" /> Сгенерировать программу
          </button>
        </div>
      ) : (
        <TrainingView
          exercises={exercises}
          days={programDays}
          goal={(program.goal ?? "maintain") as ProgramGoal}
          level={program.level as ProgramLevel}
          sessionsPerWeek={program.sessions_per_week}
          notes={program.notes}
          faq={program.faq}
          editable={true}
          onDayPatch={handleDayPatch}
          onProgramPatch={handleProgramPatch}
          onRegenerate={() => handleRegenerate()}
        />
      )}
    </div>
  );
}

function ParamsEditor({
  program,
  profile,
  onSaveTargets,
  onSaveNotes,
}: {
  program: ProgramRow;
  profile: {
    sessions_per_week: 3 | 4;
    goal: ProgramGoal;
    level: ProgramLevel;
  };
  onSaveTargets: (sessions: 3 | 4, goal: ProgramGoal, level: ProgramLevel) => Promise<void>;
  onSaveNotes: (notes: string | null) => Promise<void>;
}) {
  const [sessions, setSessions] = useState<3 | 4>(program.sessions_per_week as 3 | 4);
  const [goal, setGoal] = useState<ProgramGoal>((program.goal ?? "maintain") as ProgramGoal);
  const [level, setLevel] = useState<ProgramLevel>(program.level as ProgramLevel);
  const [notes, setNotes] = useState(program.notes ?? "");

  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">
            Параметры программы
          </p>
          <p className="mt-1 text-sm text-warm-gray">
            Из анкеты: {profile.sessions_per_week} тренировки в неделю · {GOAL_LABEL[profile.goal]}{" "}
            · {profile.level}
          </p>
        </div>
        {program.targets_manual && (
          <span className="rounded-full bg-gold/15 px-3 py-1 text-[10px] uppercase tracking-widest text-gold">
            Зафиксировано вручную
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Тренировок в неделю
          </span>
          <select
            value={sessions}
            onChange={(e) => setSessions(Number(e.target.value) as 3 | 4)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Цель
          </span>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as ProgramGoal)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            {(Object.keys(GOAL_LABEL) as ProgramGoal[]).map((g) => (
              <option key={g} value={g}>
                {GOAL_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Уровень
          </span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ProgramLevel)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            <option value="beginner">Новичок</option>
            <option value="intermediate">Средний</option>
            <option value="advanced">Продвинутый</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onSaveTargets(sessions, goal, level)}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background"
        >
          <Sparkles className="h-3.5 w-3.5" /> Пересобрать под эти параметры
        </button>
      </div>

      <label className="mt-6 block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
          Комментарий тренера ко всей программе
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          placeholder="Например: 4-ю неделю переходим к прогрессии, добавляем вес"
        />
      </label>
      <button
        type="button"
        onClick={() => void onSaveNotes(notes || null)}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
      >
        <Save className="h-3.5 w-3.5" /> Сохранить комментарий
      </button>
    </section>
  );
}
