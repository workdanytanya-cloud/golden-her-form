/** Convert hosted video page URLs into playable embed URLs. */

export function getVideoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "rutube.ru" || host === "rutube.com") {
      const m = u.pathname.match(/\/video\/(?:private\/)?([a-f0-9]{32})\/?/i);
      if (!m) return null;
      const p = u.searchParams.get("p");
      const embed = new URL(`https://rutube.ru/play/embed/${m[1]}/`);
      if (p) embed.searchParams.set("p", p);
      return embed.toString();
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id =
        u.searchParams.get("v") ||
        u.pathname.match(/\/embed\/([^/?#]+)/)?.[1] ||
        u.pathname.match(/\/shorts\/([^/?#]+)/)?.[1];
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}`;
    }

    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}`;
    }

    return null;
  } catch {
    return null;
  }
}

export function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}
