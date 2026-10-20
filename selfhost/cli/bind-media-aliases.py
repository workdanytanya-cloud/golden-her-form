#!/usr/bin/env python3
"""Bind remaining exercises via safe aliases / first-segment / typo fixes.
Uses sheet JSON + already-bound catalog URLs. Does not mutate published snapshots.
"""
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

# catalog_name_nfkd -> sheet_or_catalog_name_nfkd
ALIASES = {
    "французский жим сидя": "французский жим сидя на стуле",
    "французскии жим сидя": "французский жим сидя на стуле",
    "подъем на носки стоя": "подъем на носки",
    "махи гантелеи в стороны": "махи через стороны попеременно",
    "подъем гантели+отведение ноги": "отведение ноги назад+подъем гантели над головой",
    "приседания на стул на однои ноге": "приседания с акцентом на одну ногу",
    "фразцузский жим гантели из-за головы": "французский жим лежа",
}


def nfkd_key(name: str) -> str:
    s = unicodedata.normalize("NFKD", (name or "").replace("\u00a0", " "))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("ё", "е").replace("Ё", "Е")
    return " ".join(s.lower().split())


def compact(name: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", "", nfkd_key(name))


def first_segment(name: str) -> str:
    parts = re.split(r"\s*[\/+]\s*", name.strip())
    return parts[0].strip() if parts else name


def yt_or_rt(url: str) -> dict | None:
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").replace("www.", "")
    except Exception:
        return None
    if "youtu" in host:
        vid = None
        if host == "youtu.be":
            vid = u.path.lstrip("/").split("/")[0]
        else:
            qs = urllib.parse.parse_qs(u.query)
            vid = (qs.get("v") or [None])[0]
            if not vid:
                m = re.search(r"/(?:embed|shorts)/([\w-]{11})", u.path or "")
                vid = m.group(1) if m else None
        if not vid or not re.fullmatch(r"[\w-]{11}", vid):
            return None
        return {
            "provider": "youtube",
            "source_url": f"https://www.youtube.com/watch?v={vid}",
            "embed_url": f"https://www.youtube.com/embed/{vid}",
            "status": "ok",
        }
    if "rutube" in host:
        m = re.search(r"/video/(?:private/)?([a-f0-9]{32})", u.path or "", re.I) or re.search(
            r"/play/embed/([a-f0-9]{32})", u.path or "", re.I
        )
        if not m:
            return None
        rid = m.group(1).lower()
        p = (urllib.parse.parse_qs(u.query).get("p") or [None])[0]
        embed = f"https://rutube.ru/play/embed/{rid}/?skinColor=000000"
        if p:
            embed = f"https://rutube.ru/play/embed/{rid}/?p={urllib.parse.quote(p)}&skinColor=000000"
        return {"provider": "rutube", "source_url": url, "embed_url": embed, "status": "ok"}
    return None


def upsert(cur, exercise_id, video, title):
    cur.execute("SELECT source_url FROM exercise_media_bindings WHERE exercise_id=%s", (exercise_id,))
    old = cur.fetchone()
    old_url = old[0] if old else None
    cur.execute(
        """
        INSERT INTO exercise_media_bindings
          (exercise_id, provider, source_url, embed_url, title, status, fallback_text, updated_by)
        VALUES (%s,%s,%s,%s,%s,%s,NULL,NULL)
        ON CONFLICT (exercise_id) DO UPDATE SET
          provider=EXCLUDED.provider,
          source_url=EXCLUDED.source_url,
          embed_url=EXCLUDED.embed_url,
          title=EXCLUDED.title,
          status=EXCLUDED.status
        """,
        (
            exercise_id,
            video["provider"],
            video["source_url"],
            video["embed_url"],
            title,
            video["status"],
        ),
    )
    if old_url != video["source_url"]:
        cur.execute(
            """INSERT INTO exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
               VALUES (%s,%s,%s,NULL)""",
            (exercise_id, old_url, video["source_url"]),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url-file", default=os.getenv("PANOVAPRO_DATABASE_URL_FILE"))
    parser.add_argument(
        "--sheet-input",
        action="append",
        default=None,
        help="Parsed sheet JSON; repeat for multiple inputs (or set PANOVAPRO_COACH_SHEET_INPUTS with os.pathsep separators)",
    )
    args = parser.parse_args()
    sheet_inputs = args.sheet_input
    if not sheet_inputs:
        sheet_inputs = [p for p in os.getenv("PANOVAPRO_COACH_SHEET_INPUTS", "").split(os.pathsep) if p]
    if not sheet_inputs:
        parser.error("provide --sheet-input or PANOVAPRO_COACH_SHEET_INPUTS")
    url_by_norm: dict[str, str] = {}
    url_by_compact: dict[str, str] = {}
    for path in map(Path, sheet_inputs):
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for row in data.get("rows") or []:
            name = " ".join((row.get("name") or "").split()).strip()
            url = row.get("url") or ""
            if not name or not url or name.isdigit() or len(name) < 3:
                continue
            if name.lower() in {"тренировка", "разминка", "заминка"} and "rutube" not in url:
                pass
            kn, kc = nfkd_key(name), compact(name)
            url_by_norm.setdefault(kn, url)
            url_by_compact.setdefault(kc, url)

    dburl = os.getenv("DATABASE_URL")
    if not dburl and args.database_url_file:
        dburl = Path(args.database_url_file).read_text(encoding="utf-8").strip()
    if not dburl:
        parser.error("set DATABASE_URL or --database-url-file")
    conn = psycopg2.connect(dburl)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), ''))
           FROM training_program_versions WHERE status='published'"""
    )
    before = cur.fetchone()

    # seed from existing ok bindings too
    cur.execute(
        """SELECT e.name, b.source_url FROM exercise_media_bindings b
           JOIN exercises e ON e.id=b.exercise_id WHERE b.status='ok'"""
    )
    for name, url in cur.fetchall():
        kn, kc = nfkd_key(name), compact(name)
        url_by_norm.setdefault(kn, url)
        url_by_compact.setdefault(kc, url)

    # also alias targets
    for src, dst in list(ALIASES.items()):
        if dst in url_by_norm:
            url_by_norm.setdefault(src, url_by_norm[dst])

    cur.execute(
        """SELECT e.id::text, e.name FROM exercises e
           LEFT JOIN exercise_media_bindings b ON b.exercise_id=e.id AND b.status='ok'
           WHERE b.exercise_id IS NULL"""
    )
    unbound = cur.fetchall()

    added = []
    skipped = []
    for eid, name in unbound:
        kn, kc = nfkd_key(name), compact(name)
        url = url_by_norm.get(kn) or url_by_compact.get(kc)
        method = "exact" if url and kn in url_by_norm else ("compact" if url else None)
        if not url and kn in ALIASES:
            url = url_by_norm.get(ALIASES[kn]) or url_by_compact.get(compact(ALIASES[kn]))
            method = "alias"
        if not url:
            seg = first_segment(name)
            if seg and nfkd_key(seg) != kn and len(nfkd_key(seg)) >= 10:
                url = url_by_norm.get(nfkd_key(seg)) or url_by_compact.get(compact(seg))
                method = "first_segment" if url else None
        # typo french
        if not url and "фразцуз" in kn:
            url = url_by_norm.get("французский жим лежа")
            method = "typo" if url else None
        if not url:
            skipped.append(name)
            continue
        video = yt_or_rt(url)
        if not video:
            skipped.append(name)
            continue
        upsert(cur, eid, video, name)
        added.append({"name": name, "method": method, "url": video["source_url"][:80]})

    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), ''))
           FROM training_program_versions WHERE status='published'"""
    )
    after = cur.fetchone()
    if before != after:
        conn.rollback()
        raise SystemExit(f"published hash changed {before} -> {after}")

    conn.commit()
    cur.execute("SELECT count(*) FROM exercise_media_bindings WHERE status='ok'")
    ok = cur.fetchone()[0]
    print(
        json.dumps(
            {
                "added": len(added),
                "skipped": len(skipped),
                "ok_bindings": ok,
                "publishedUnchanged": True,
                "addedSample": added[:40],
                "skippedSample": skipped[:40],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    conn.close()


if __name__ == "__main__":
    main()
