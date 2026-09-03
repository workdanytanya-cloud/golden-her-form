/** node --env-file=.env scripts/_test-admin-regenerate.mjs */
import { resolveDefaultTrainingProgram } from "../src/lib/coach-sheet-program.ts";
import { persistProgramWithDaysForClient } from "../src/lib/training-persist.ts";
import { defaultFaq } from "../src/lib/training.ts";

const { supabaseAdmin } = await import("../src/integrations/supabase/client.server.ts");

const ANNA_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
const COURSE_ID = "67923ead-4764-46a1-917c-9df62e678f52";

const { data: exercises, error: exErr } = await supabaseAdmin.from("exercises").select("*");
if (exErr) throw exErr;

const input = {
  sessions_per_week: 3,
  goal: "tone",
  level: "beginner",
  has_injuries: false,
  injuries_details: null,
  equipment: [],
  location: null,
  weight_kg: 62.3,
  gender: "female",
};

const plan = resolveDefaultTrainingProgram(exercises ?? [], input);
console.log("plan", plan.days.length, "days", plan.programWeeks, "weeks");

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
    faq: defaultFaq(input),
    targets_manual: true,
    generated_at: new Date().toISOString(),
  },
  plan.programWeeks,
  rows,
  { skipRpc: true },
);

const { count } = await supabaseAdmin
  .from("training_program_days")
  .select("*", { count: "exact", head: true })
  .eq("program_id", programId);

console.log("saved", programId, "days", count, "multiWeek", multiWeek);
