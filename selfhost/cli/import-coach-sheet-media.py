#!/usr/bin/env python3
"""Import coach sheet videos into exercise_media_bindings. Idempotent upsert."""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
import urllib.parse
from collections import defaultdict
from pathlib import Path

import psycopg2
import psycopg2.extras

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)


def normalize_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.replace("\u00a0", " "))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("ё", "е").replace("Ё", "Е")
    s = " ".join(s.lower().split()).strip()
    return s


def youtube_id(url: str) -> str | None:
    try:
        u = urllib.parse.urlparse(url)
        host = u.hostname.replace("www.", "") if u.hostname else ""
        if host == "youtu.be":
            vid = u.path.lstrip("/").split("/")[0]
            return vid if re.fullmatch(r"[\w-]{11}", vid or "") else None
        if "youtube" in host:
            qs = urllib.parse.parse_qs(u.query)
            if "v" in qs and re.fullmatch(r"[\w-]{11}", qs["v"][0]):
                return qs["v"][0]
            m = re.search(r"/(?:embed|shorts)/([\w-]{11})", u.path or "")
            return m.group(1) if m else None
    except Exception:
        return None
    return None


def rutube_id(url: str) -> tuple[str | None, str | None]:
    try:
        u = urllib.parse.urlparse(url)
        host = u.hostname.replace("www.", "") if u.hostname else ""
        if host not in ("rutube.ru", "rutube.com"):
            return None, None
        m = re.search(r"/video/(?:private/)?([a-f0-9]{32})", u.path or "", re.I) or re.search(
            r"/play/embed/([a-f0-9]{32})", u.path or "", re.I
        )
        if not m:
            return None, None
        qs = urllib.parse.parse_qs(u.query)
        return m.group(1).lower(), (qs.get("p") or [None])[0]
    except Exception:
        return None, None


def normalize_video(url: str, title: str | None):
    yt = youtube_id(url)
    if yt:
        return {
            "provider": "youtube",
            "source_url": f"https://www.youtube.com/watch?v={yt}",
            "embed_url": f"https://www.youtube.com/embed/{yt}",
            "title": title,
            "status": "ok",
            "fallback_text": None,
        }
    rt, p = rutube_id(url)
    if rt:
        embed = f"https://rutube.ru/play/embed/{rt}/?skinColor=000000"
        if p:
            embed = f"https://rutube.ru/play/embed/{rt}/?p={urllib.parse.quote(p)}&skinColor=000000"
        return {
            "provider": "rutube",
            "source_url": url,
            "embed_url": embed,
            "title": title,
            "status": "ok",
            "fallback_text": None,
        }
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--database-url-file", default=os.getenv("PANOVAPRO_DATABASE_URL_FILE"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    dry = args.dry_run
    input_path = args.input
    data = json.loads(Path(input_path).read_text(encoding="utf-8"))
    buckets: dict[str, dict] = {}
    skipped = 0
    url_best_name: dict[str, str] = {}
    for row in data.get("rows") or []:
        name = " ".join((row.get("name") or "").split()).strip()
        if name and not name.isdigit():
            url_best_name.setdefault(row["url"], name)

    for row in data.get("rows") or []:
        name = " ".join((row.get("name") or "").split()).strip()
        if not name or name.isdigit():
            name = url_best_name.get(row["url"], "")
        if not name:
            skipped += 1
            continue
        norm = normalize_name(name)
        b = buckets.get(norm)
        if not b:
            b = {"name": name, "urls": defaultdict(int), "sheets": set(), "idHint": row.get("idHint")}
            buckets[norm] = b
        b["urls"][row["url"]] += 1
        b["sheets"].add(row.get("sheet") or "")
        if not b["idHint"] and row.get("idHint"):
            b["idHint"] = row["idHint"]

    candidates = []
    url_conflicts = []
    for b in buckets.values():
        ranked = sorted(b["urls"].items(), key=lambda x: -x[1])
        if len(ranked) > 1:
            url_conflicts.append({"name": b["name"], "urls": [u for u, _ in ranked]})
        candidates.append(
            {
                "name": b["name"],
                "norm": normalize_name(b["name"]),
                "url": ranked[0][0],
                "idHint": b["idHint"],
                "sheets": sorted(b["sheets"]),
            }
        )

    dburl = os.getenv("DATABASE_URL")
    if not dburl and args.database_url_file:
        dburl = Path(args.database_url_file).read_text(encoding="utf-8").strip()
    if not dburl:
        parser.error("set DATABASE_URL or --database-url-file")
    conn = psycopg2.connect(dburl)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        """SELECT count(*)::int AS n,
                  md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
             FROM public.training_program_versions WHERE status='published'"""
    )
    before_pub = dict(cur.fetchone())
    cur.execute(
        """SELECT count(*)::int AS n,
                  md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
             FROM public.training_program_versions"""
    )
    before_all = dict(cur.fetchone())

    cur.execute("SELECT id, name FROM public.exercises")
    exercises = cur.fetchall()
    by_id = {str(r["id"]).lower(): r for r in exercises}
    by_name: dict[str, list] = defaultdict(list)
    for r in exercises:
        by_name[normalize_name(r["name"])].append(r)

    report = {
        "dryRun": dry,
        "sheetVideoCells": data.get("totalVideoCells") or len(data.get("rows") or []),
        "uniqueNames": len(candidates),
        "skippedNoName": skipped,
        "matched": 0,
        "bindingsUpserted": 0,
        "ambiguous": [],
        "unmatched": [],
        "unavailable": [],
        "urlConflicts": len(url_conflicts),
        "urlConflictSample": url_conflicts[:20],
    }

    for cand in candidates:
        video = normalize_video(cand["url"], cand["name"])
        if not video:
            report["unavailable"].append({"name": cand["name"], "url": cand["url"]})
            continue
        targets = []
        hint = cand.get("idHint")
        if hint and UUID_RE.match(str(hint)) and str(hint).lower() in by_id:
            targets = [by_id[str(hint).lower()]]
        else:
            hits = by_name.get(cand["norm"]) or []
            if len(hits) == 1:
                targets = hits
            elif len(hits) > 1:
                # Exact same normalized name in DB (duplicates) — bind URL to all clones.
                targets = hits
            else:
                targets = []
        if not targets:
            report["unmatched"].append(
                {"name": cand["name"], "url": cand["url"], "sheets": cand["sheets"]}
            )
            continue
        report["matched"] += 1
        for target in targets:
            if not dry:
                cur.execute(
                    "SELECT source_url FROM public.exercise_media_bindings WHERE exercise_id=%s",
                    (target["id"],),
                )
                old = cur.fetchone()
                old_url = old["source_url"] if old else None
                cur.execute(
                    """
                    INSERT INTO public.exercise_media_bindings
                      (exercise_id, provider, source_url, embed_url, title, status, fallback_text, updated_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,NULL)
                    ON CONFLICT (exercise_id) DO UPDATE SET
                      provider=EXCLUDED.provider,
                      source_url=EXCLUDED.source_url,
                      embed_url=EXCLUDED.embed_url,
                      title=EXCLUDED.title,
                      status=EXCLUDED.status,
                      fallback_text=EXCLUDED.fallback_text
                    """,
                    (
                        target["id"],
                        video["provider"],
                        video["source_url"],
                        video["embed_url"],
                        video["title"] or target["name"],
                        video["status"],
                        video["fallback_text"],
                    ),
                )
                if old_url != video["source_url"]:
                    cur.execute(
                        """INSERT INTO public.exercise_media_change_log
                             (exercise_id, old_url, new_url, changed_by)
                           VALUES (%s,%s,%s,NULL)""",
                        (target["id"], old_url, video["source_url"]),
                    )
            report["bindingsUpserted"] += 1

    if not dry:
        conn.commit()
    else:
        conn.rollback()

    cur.execute(
        """SELECT count(*)::int AS n,
                  md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
             FROM public.training_program_versions WHERE status='published'"""
    )
    after_pub = dict(cur.fetchone())
    cur.execute(
        """SELECT count(*)::int AS n,
                  md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
             FROM public.training_program_versions"""
    )
    after_all = dict(cur.fetchone())
    cur.execute(
        "SELECT count(*)::int AS n FROM public.exercise_media_bindings WHERE coalesce(source_url,'')<>''"
    )
    bindings = cur.fetchone()["n"]
    conn.close()

    report.update(
        {
            "bindingsInDb": bindings,
            "ambiguousCount": len(report["ambiguous"]),
            "unmatchedCount": len(report["unmatched"]),
            "unavailableCount": len(report["unavailable"]),
            "publishedProgramsUnchanged": before_pub == after_pub and before_all == after_all,
            "beforePublished": before_pub,
            "afterPublished": after_all and after_pub,
            "unmatchedSample": report["unmatched"][:40],
        }
    )
    out = Path(input_path).with_name("import-coach-sheet-media-report.json")
    out.write_text(
        json.dumps({"summary": report, "ambiguous": report["ambiguous"], "unmatched": report["unmatched"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # compact stdout
    compact = {k: report[k] for k in report if k not in ("unmatched", "ambiguous", "urlConflictSample", "unmatchedSample")}
    compact["ambiguousList"] = report["ambiguous"]
    compact["unmatchedSample"] = report["unmatched"][:30]
    compact["urlConflictSample"] = report["urlConflictSample"]
    print(json.dumps(compact, ensure_ascii=False, indent=2))
    print("Report:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
