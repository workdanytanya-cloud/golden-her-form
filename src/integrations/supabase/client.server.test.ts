import { describe, expect, it } from "vitest";
import { resolveDefaultTrainingProgram } from "@/lib/coach-sheet-program";
import { persistProgramWithDaysForClient } from "@/lib/training-persist";
import { defaultFaq } from "@/lib/training";

describe("supabaseAdmin server client", () => {
  it("generates and persists Anna program", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ANNA_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
    const COURSE_ID = "67923ead-4764-46a1-917c-9df62e678f52";

    const { data: exercises, error: exErr } = await supabaseAdmin.from("exercises").select("*");
    expect(exErr).toBeNull();

    const input = {
      sessions_per_week: 3 as const,
      goal: "tone" as const,
      level: "beginner" as const,
      has_injuries: false,
      injuries_details: null,
      equipment: [] as string[],
      location: null,
      weight_kg: 62.3,
      gender: "female" as const,
    };

    const plan = resolveDefaultTrainingProgram(exercises ?? [], input);
    expect(plan.days.length).toBeGreaterThanOrEqual(21);

    const rows = plan.days.map((d) => ({
      week_index: d.week_index ?? 0,
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

    const { programId, multiWeek } = await persistProgramWithDaysForClient(
      supabaseAdmin,
      ANNA_ID,
      COURSE_ID,
      {
        user_id: ANNA_ID,
        course_id: COURSE_ID,
        sessions_per_week: input.sessions_per_week,
        goal: input.goal,
        level: input.level,
        has_injuries: input.has_injuries,
        injuries_details: null,
        equipment: [],
        location: null,
        notes: plan.coachNotes,
        faq: defaultFaq(input) as never,
        targets_manual: true,
        generated_at: new Date().toISOString(),
      },
      plan.programWeeks,
      rows,
      { skipRpc: true },
    );

    expect(multiWeek).toBe(true);
    const { count } = await supabaseAdmin
      .from("training_program_days")
      .select("*", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(plan.days.length);
  }, 120_000);
});
