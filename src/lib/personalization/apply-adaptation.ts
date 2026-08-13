import { supabase } from "@/integrations/supabase/client";
import type { AdaptationDecision } from "@/lib/personalization/types";
import type { ExerciseSet } from "@/lib/training";

type DayBlocks = {
  warmup: ExerciseSet[];
  exercises: ExerciseSet[];
  cooldown: ExerciseSet[];
};

function patchSets(
  blocks: DayBlocks,
  exerciseId: string,
  patch: (set: ExerciseSet) => ExerciseSet,
): DayBlocks {
  const mapBlock = (arr: ExerciseSet[]) =>
    arr.map((s) => (s.exercise_id === exerciseId ? patch(s) : s));
  return {
    warmup: mapBlock(blocks.warmup),
    exercises: mapBlock(blocks.exercises),
    cooldown: mapBlock(blocks.cooldown),
  };
}

/**
 * Автопрогрессия по feedback — меняет преимущественно ОДНУ переменную (sets).
 * Не применяется при REVIEW или KEEP.
 */
export async function applyWorkoutAdaptation(params: {
  userId: string;
  weekIndex: number;
  dayIndex: number;
  decision: AdaptationDecision;
  tooEasyIds: string[];
  tooHardIds: string[];
}): Promise<boolean> {
  if (params.decision === "KEEP" || params.decision === "REVIEW") return false;

  const { data: program } = await supabase
    .from("training_programs")
    .select("id, targets_manual")
    .eq("user_id", params.userId)
    .maybeSingle();
  if (!program || program.targets_manual) return false;

  const { data: dayRow } = await supabase
    .from("training_program_days")
    .select("id, warmup, exercises, cooldown")
    .eq("program_id", program.id)
    .eq("week_index", params.weekIndex)
    .eq("day_index", params.dayIndex)
    .maybeSingle();

  if (!dayRow) return false;

  let blocks: DayBlocks = {
    warmup: (dayRow.warmup ?? []) as ExerciseSet[],
    exercises: (dayRow.exercises ?? []) as ExerciseSet[],
    cooldown: (dayRow.cooldown ?? []) as ExerciseSet[],
  };

  if (params.decision === "PROGRESS") {
    for (const id of params.tooEasyIds) {
      blocks = patchSets(blocks, id, (s) => ({
        ...s,
        sets: Math.min(10, s.sets + 1),
        note: s.note ?? "Прогрессия: +1 подход (вы отметили упражнение как лёгкое).",
      }));
    }
  }

  if (params.decision === "REDUCE") {
    for (const id of params.tooHardIds) {
      blocks = patchSets(blocks, id, (s) => ({
        ...s,
        sets: Math.max(1, s.sets - 1),
        rest_seconds: Math.min(300, s.rest_seconds + 15),
        note: s.note ?? "Снижение нагрузки: −1 подход, +15 с отдыха.",
      }));
    }
  }

  if (params.decision === "RECOVER") {
    for (const id of [...blocks.warmup, ...blocks.exercises, ...blocks.cooldown].map(
      (s) => s.exercise_id,
    )) {
      blocks = patchSets(blocks, id, (s) => ({
        ...s,
        sets: Math.max(1, s.sets - 1),
      }));
    }
  }

  const { error } = await supabase
    .from("training_program_days")
    .update({
      warmup: blocks.warmup as unknown as never,
      exercises: blocks.exercises as unknown as never,
      cooldown: blocks.cooldown as unknown as never,
    })
    .eq("id", dayRow.id);

  return !error;
}
