#!/usr/bin/env python3
"""Bind remaining Anna-like orphans via aliases + local stock mp4 fallbacks."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import unicodedata
import urllib.parse
from pathlib import Path

import psycopg2

# unbound exercise name (nfkd) -> stock file under OLD_ASSETS/*/name.mp4 OR absolute path
LOCAL_FALLBACKS = {
    "подъем гантелеи на бицепс в наклоне": "db-biceps-curl.mp4",
    "подъемы гантелеи на бицепс в наклоне": "db-biceps-curl.mp4",
    "отжимания со среднеи постановкои рук": "pushup.mp4",
    "фразцузский жим гантели из-за головы": None,  # prefer youtube alias below
}

SHEET_ALIASES = {
    "фразцузский жим гантели из-за головы": "французский жим лежа",
    "отжимания с колен": "отжимания с колен на трицепс",
}

FIRST_SEGMENT_MIN = 8


def nfkd(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").replace("\u00a0", " "))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("ё", "е").replace("Ё", "Е")
    return " ".join(s.lower().split())


def compact(s: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", "", nfkd(s))


def first_segment(name: str) -> str:
    return re.split(r"\s*[\/+]\s*", name.strip())[0].strip()


def yt_or_rt(url: str):
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
        m = re.search(r"/video/(?:private/)?([a-f0-9]{32})", u.path or "", re.I)
        if not m:
            return None
        rid = m.group(1).lower()
        p = (urllib.parse.parse_qs(u.query).get("p") or [None])[0]
        embed = f"https://rutube.ru/play/embed/{rid}/?skinColor=000000"
        if p:
            embed = f"https://rutube.ru/play/embed/{rid}/?p={urllib.parse.quote(p)}&skinColor=000000"
        return {"provider": "rutube", "source_url": url, "embed_url": embed, "status": "ok"}
    return None


def find_stock(old_assets: Path, filename: str) -> Path | None:
    for p in old_assets.glob(f"*/{filename}"):
        return p
    return None


def upsert(cur, eid, video, title):
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
        (eid, video["provider"], video["source_url"], video.get("embed_url"), title, video["status"]),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url-file", default=os.getenv("PANOVAPRO_DATABASE_URL_FILE"))
    parser.add_argument("--sheet-data-dir", default=os.getenv("PANOVAPRO_COACH_SHEET_DATA_DIR"))
    parser.add_argument("--media-root", default=os.getenv("SELFHOST_MEDIA_ROOT"))
    parser.add_argument("--old-assets", default=os.getenv("PANOVAPRO_OLD_ASSETS_ROOT"))
    args = parser.parse_args()
    dburl = os.getenv("DATABASE_URL")
    if not dburl and args.database_url_file:
        dburl = Path(args.database_url_file).read_text(encoding="utf-8").strip()
    if not dburl:
        parser.error("set DATABASE_URL or --database-url-file")
    for name in ("sheet_data_dir", "media_root", "old_assets"):
        if not getattr(args, name):
            parser.error(f"set --{name.replace('_', '-')} or its documented environment variable")
    fallback_dir = Path(args.media_root) / "exercises" / "fallback"
    old_assets = Path(args.old_assets)
    fallback_dir.mkdir(parents=True, exist_ok=True)
    conn = psycopg2.connect(dburl)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash,',' ORDER BY id::text),''))
           FROM training_program_versions WHERE status='published'"""
    )
    before = cur.fetchone()

    # url maps from sheets + bindings
    url_by = {}
    for path in Path(args.sheet_data_dir).glob("parsed*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for row in data.get("rows") or []:
            name = " ".join((row.get("name") or "").split()).strip()
            url = row.get("url") or ""
            if name and url and not name.isdigit():
                url_by.setdefault(nfkd(name), url)
                url_by.setdefault(compact(name), url)
    cur.execute(
        "SELECT e.name, b.source_url FROM exercise_media_bindings b JOIN exercises e ON e.id=b.exercise_id WHERE b.status='ok'"
    )
    for name, url in cur.fetchall():
        url_by.setdefault(nfkd(name), url)
        url_by.setdefault(compact(name), url)

    for src, dst in SHEET_ALIASES.items():
        if nfkd(dst) in url_by:
            url_by[nfkd(src)] = url_by[nfkd(dst)]

    cur.execute(
        """SELECT e.id::text, e.name FROM exercises e
           LEFT JOIN exercise_media_bindings b ON b.exercise_id=e.id AND b.status='ok'
           WHERE b.exercise_id IS NULL"""
    )
    unbound = cur.fetchall()
    added = []
    for eid, name in unbound:
        kn = nfkd(name)
        video = None
        method = None
        url = url_by.get(kn) or url_by.get(compact(name))
        if url:
            video = yt_or_rt(url)
            method = "name"
        if not video:
            seg = first_segment(name)
            if len(nfkd(seg)) >= FIRST_SEGMENT_MIN:
                url = url_by.get(nfkd(seg)) or url_by.get(compact(seg))
                # also try prefix match in sheet keys
                if not url:
                    for k, u in url_by.items():
                        if isinstance(k, str) and " " in k and (nfkd(seg) in k or k.startswith(nfkd(seg))):
                            # only if seg is substantial part
                            if abs(len(k) - len(nfkd(seg))) <= 20 or k.startswith(nfkd(seg)):
                                url = u
                                break
                if url:
                    video = yt_or_rt(url)
                    method = "segment"
        if not video and kn in LOCAL_FALLBACKS and LOCAL_FALLBACKS[kn]:
            src = find_stock(old_assets, LOCAL_FALLBACKS[kn])
            if src and src.exists():
                dest = fallback_dir / LOCAL_FALLBACKS[kn]
                if not dest.exists():
                    shutil.copy2(src, dest)
                rel = f"exercises/fallback/{LOCAL_FALLBACKS[kn]}"
                video = {
                    "provider": "external",
                    "source_url": f"/api/selfhost/media?p={urllib.parse.quote(rel, safe='/')}",
                    "embed_url": None,
                    "status": "ok",
                }
                method = "local_fallback"
        if not video and "фразцуз" in kn:
            url = url_by.get("французский жим лежа")
            video = yt_or_rt(url) if url else None
            method = "typo"
        if not video and kn in LOCAL_FALLBACKS:
            # french typo handled; skip
            pass
        # keyword local fallbacks for remaining compound circuits: use jumpings / pushup stock only if name contains
        if not video:
            stock = None
            if "джампинг" in kn or "джамп" in kn:
                stock = "jumping-jack.mp4"
            elif "отжимани" in kn:
                stock = "pushup.mp4"
            elif "выпад" in kn:
                stock = "reverse-lunge.mp4"
            elif "присед" in kn and "ладон" in kn:
                stock = "bodyweight-squat.mp4"
            elif "присед" in kn and "носк" in kn:
                stock = "bodyweight-squat.mp4"
            elif "бицепс" in kn:
                stock = "db-biceps-curl.mp4"
            if stock:
                src = find_stock(stock)
                if src and src.exists():
                    dest = FALLBACK_DIR / stock
                    if not dest.exists():
                        shutil.copy2(src, dest)
                    rel = f"exercises/fallback/{stock}"
                    video = {
                        "provider": "external",
                        "source_url": f"/api/selfhost/media?p={urllib.parse.quote(rel, safe='/')}",
                        "embed_url": None,
                        "status": "ok",
                    }
                    method = f"local_kw:{stock}"
        if not video:
            continue
        upsert(cur, eid, video, name)
        added.append({"name": name, "method": method, "url": video["source_url"][:90]})

    cur.execute(
        """SELECT count(*)::int, md5(coalesce(string_agg(content_hash,',' ORDER BY id::text),''))
           FROM training_program_versions WHERE status='published'"""
    )
    after = cur.fetchone()
    if before != after:
        conn.rollback()
        raise SystemExit("published changed")
    conn.commit()
    cur.execute("SELECT count(*) FROM exercise_media_bindings WHERE status='ok'")
    print(json.dumps({"added": len(added), "ok": cur.fetchone()[0], "sample": added}, ensure_ascii=False, indent=2))
    conn.close()


if __name__ == "__main__":
    main()
