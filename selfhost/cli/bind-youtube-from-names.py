#!/usr/bin/env python3
"""Fill exercise_media_bindings from YouTube IDs embedded in exercise names/slugs + sheet JSON.
Does not mutate published snapshots.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
import urllib.parse
from pathlib import Path

import psycopg2

YT_IN_NAME = re.compile(r"^Упражнение\s+([\w-]{11})$", re.I)
YT_IN_SLUG = re.compile(r"(?:^|-)([a-zA-Z0-9_-]{11})$")


def nfkd_key(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.replace("\u00a0", " "))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("ё", "е").replace("Ё", "Е")
    return " ".join(s.lower().split())


def yt_bind(url_or_id: str) -> dict | None:
    vid = None
    if re.fullmatch(r"[\w-]{11}", url_or_id or ""):
        vid = url_or_id
    else:
        try:
            u = urllib.parse.urlparse(url_or_id)
            host = (u.hostname or "").replace("www.", "")
            if host == "youtu.be":
                vid = u.path.lstrip("/").split("/")[0]
            elif "youtube" in host:
                qs = urllib.parse.parse_qs(u.query)
                vid = (qs.get("v") or [None])[0]
                if not vid:
                    m = re.search(r"/(?:embed|shorts)/([\w-]{11})", u.path or "")
                    vid = m.group(1) if m else None
        except Exception:
            return None
    if not vid or not re.fullmatch(r"[\w-]{11}", vid):
        return None
    return {
        "provider": "youtube",
        "source_url": f"https://www.youtube.com/watch?v={vid}",
        "embed_url": f"https://www.youtube.com/embed/{vid}",
        "status": "ok",
    }


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
    parser.add_argument("--input", default=os.getenv("PANOVAPRO_COACH_SHEET_INPUT"))
    parser.add_argument("--database-url-file", default=os.getenv("PANOVAPRO_DATABASE_URL_FILE"))
    args = parser.parse_args()
    if not args.input:
        parser.error("provide --input or PANOVAPRO_COACH_SHEET_INPUT")
    sheet_path = Path(args.input)
    sheet = json.loads(sheet_path.read_text(encoding="utf-8")) if sheet_path.exists() else {"rows": []}
    url_by_norm = {}
    url_by_yt = {}
    for row in sheet.get("rows") or []:
        name = " ".join((row.get("name") or "").split()).strip()
        url = row.get("url") or ""
        if not url:
            continue
        v = yt_bind(url)
        if v:
            url_by_yt[v["source_url"].rsplit("v=", 1)[-1]] = v
        if name and not name.isdigit():
            url_by_norm.setdefault(nfkd_key(name), url)

    dburl = os.getenv("DATABASE_URL")
    if not dburl and args.database_url_file:
        dburl = Path(args.database_url_file).read_text(encoding="utf-8").strip()
    if not dburl:
        parser.error("set DATABASE_URL or --database-url-file")
    conn = psycopg2.connect(dburl)
    cur = conn.cursor()
    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), ''))
           FROM training_program_versions WHERE status='published'"""
    )
    before = cur.fetchone()

    cur.execute("SELECT id, name, slug FROM exercises")
    exercises = cur.fetchall()
    added = 0
    from_name = 0
    from_sheet = 0

    for eid, name, slug in exercises:
        cur.execute(
            "SELECT 1 FROM exercise_media_bindings WHERE exercise_id=%s AND status='ok' AND source_url ILIKE '%%youtu%%'",
            (eid,),
        )
        if cur.fetchone():
            continue

        video = None
        m = YT_IN_NAME.match(name or "")
        if m:
            video = yt_bind(m.group(1))
            if video:
                from_name += 1

        if not video and slug:
            # slug like sheet-uprazhnenie-7eknssuhvbi
            sm = re.search(r"uprazhnenie-([a-z0-9_-]{11})$", slug or "", re.I)
            if sm:
                video = yt_bind(sm.group(1))
                if video:
                    from_name += 1

        if not video:
            key = nfkd_key(name or "")
            sheet_url = url_by_norm.get(key)
            if sheet_url:
                video = yt_bind(sheet_url)
                # also rutube later
                if not video and "rutube" in sheet_url:
                    # minimal rutube
                    try:
                        u = urllib.parse.urlparse(sheet_url)
                        rm = re.search(r"/video/(?:private/)?([a-f0-9]{32})", u.path or "", re.I)
                        if rm:
                            rid = rm.group(1).lower()
                            qs = urllib.parse.parse_qs(u.query)
                            p = (qs.get("p") or [None])[0]
                            embed = f"https://rutube.ru/play/embed/{rid}/?skinColor=000000"
                            if p:
                                embed = f"https://rutube.ru/play/embed/{rid}/?p={urllib.parse.quote(p)}&skinColor=000000"
                            video = {
                                "provider": "rutube",
                                "source_url": sheet_url,
                                "embed_url": embed,
                                "status": "ok",
                            }
                    except Exception:
                        video = None
                if video:
                    from_sheet += 1

        if video:
            upsert(cur, eid, video, name)
            added += 1

    conn.commit()
    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), ''))
           FROM training_program_versions WHERE status='published'"""
    )
    after = cur.fetchone()
    cur.execute("SELECT count(*) FROM exercise_media_bindings WHERE status='ok'")
    ok = cur.fetchone()[0]
    conn.close()
    print(
        json.dumps(
            {
                "bindingsAddedOrUpdated": added,
                "fromYoutubeNameOrSlug": from_name,
                "fromSheetExactName": from_sheet,
                "bindingsOkTotal": ok,
                "publishedUnchanged": before == after,
                "published": {"n": after[0], "h": after[1]},
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
