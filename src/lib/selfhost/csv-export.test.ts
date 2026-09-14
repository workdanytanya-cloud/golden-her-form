import { describe, expect, it } from "vitest";
import { parseClientExportCsv } from "@/lib/selfhost/csv-export";
import { normalizeExportPayload } from "@/lib/selfhost/import-client";

const SYNTHETIC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NUT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function syntheticEmergency() {
  return {
    ok: true,
    match_count: 1,
    profile: { full_name: "Synthetic Client" },
    client_access: { status: "active" },
    active_course: {
      id: COURSE_ID,
      client_id: SYNTHETIC_ID,
      title: "Test course",
      start_date: "2026-01-01",
      end_date: "2026-01-28",
      status: "active",
      created_by: SYNTHETIC_ID,
    },
    assignments: {
      nutrition: {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        client_id: SYNTHETIC_ID,
        kind: "nutrition",
        course_id: COURSE_ID,
        active_version_id: NUT_ID,
        updated_by: SYNTHETIC_ID,
      },
      training: {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        client_id: SYNTHETIC_ID,
        kind: "training",
        course_id: COURSE_ID,
        active_version_id: TR_ID,
      },
    },
    published_nutrition: {
      id: NUT_ID,
      client_id: SYNTHETIC_ID,
      course_id: COURSE_ID,
      version: 1,
      status: "published",
      snapshot: { kind: "constructor", note: "line1\nline2" },
      content_hash: "hash-nut-synth",
      created_by: SYNTHETIC_ID,
      published_by: SYNTHETIC_ID,
    },
    published_training: {
      id: TR_ID,
      client_id: SYNTHETIC_ID,
      course_id: COURSE_ID,
      version: 1,
      status: "published",
      snapshot: {
        days: [
          {
            week_index: 0,
            day_index: 0,
            is_rest: false,
            title: "A",
            focus: null,
            description: null,
            warmup: [],
            exercises: [
              {
                exercise_id: SYNTHETIC_ID,
                exercise: {
                  id: SYNTHETIC_ID,
                  slug: "squat",
                  name: "Squat",
                  video_url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
                },
              },
              {
                exercise_id: null,
                exercise: { id: "", slug: "legacy", name: "Legacy move" },
              },
            ],
            cooldown: [],
            day_note: null,
          },
        ],
      },
      content_hash: "hash-tr-synth",
      published_by: SYNTHETIC_ID,
    },
  };
}

function toSqlEditorCsv(payload: unknown): string {
  const json = JSON.stringify(payload, null, 2);
  const quoted = `"${json.replaceAll('"', '""')}"`;
  return `client_export_json\n${quoted}\n`;
}

describe("CSV client export", () => {
  it("разбирает quoting и переносы строк в client_export_json", () => {
    const csv = toSqlEditorCsv(syntheticEmergency());
    expect(csv).toContain("\n");
    const rows = parseClientExportCsv(csv);
    expect(rows).toHaveLength(1);
    const parsed = rows[0] as { match_count: number; published_nutrition: { snapshot: { note: string } } };
    expect(parsed.match_count).toBe(1);
    expect(parsed.published_nutrition.snapshot.note).toBe("line1\nline2");
  });

  it("нормализует emergency CSV без plaintext и actor-полей", () => {
    const [client] = normalizeExportPayload(parseClientExportCsv(toSqlEditorCsv(syntheticEmergency()))[0], {
      email: "synth@localhost",
    });
    expect(client.matchCount).toBe(1);
    expect(client.user.email).toBe("synth@localhost");
    expect(client.courses).toHaveLength(1);
    expect(client.nutrition_versions).toHaveLength(1);
    expect(client.training_versions).toHaveLength(1);
    expect(client.assignments).toHaveLength(2);
    expect(client.nutrition_versions?.[0]).not.toHaveProperty("created_by");
    expect(client.nutrition_versions?.[0]).not.toHaveProperty("published_by");
    expect(client.courses?.[0]).not.toHaveProperty("created_by");
    expect(() =>
      normalizeExportPayload({
        user: { email: "synth@localhost", password: "secret" },
      }),
    ).toThrow(/plaintext/);
  });

  it("требует колонку client_export_json", () => {
    expect(() => parseClientExportCsv("foo,bar\n1,2\n")).toThrow(/client_export_json/);
  });
});
