export type VideoLink =
  | { kind: "embed"; src: string } // lecteur du site, dans un cadre
  | { kind: "direct"; src: string } // fichier vidéo en ligne
  | { kind: "page"; src: string }; // site inconnu : s'ouvre dans le navigateur

/** Domaines autorisés dans `frame-src` (voir tauri.conf.json). */
const YOUTUBE_ID = /^[\w-]{6,}$/;
const DIRECT = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

/** « 90 », « 90s » ou « 1h2m3s » → secondes. */
function seconds(t: string | null): number {
  if (!t) return 0;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(id: string | null | undefined, u: URL): string | null {
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ""}`;
}

/** Analyse une adresse saisie par l'utilisateur ; null si ce n'est pas une adresse web. */
export function parseVideoLink(raw: string): VideoLink | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) return null;

  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let embed: string | null = null;

  if (host === "youtu.be") embed = youtube(parts[0], u);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    embed = parts[0] === "watch" ? youtube(u.searchParams.get("v"), u)
      : ["shorts", "live", "embed", "v"].includes(parts[0]) ? youtube(parts[1], u)
      : null;
  } else if (host === "vimeo.com" && /^\d+$/.test(parts[0] ?? "")) {
    const hash = /^[\da-f]+$/i.test(parts[1] ?? "") ? `?h=${parts[1]}` : "";
    embed = `https://player.vimeo.com/video/${parts[0]}${hash}`;
  } else if (host === "player.vimeo.com" && parts[0] === "video" && /^\d+$/.test(parts[1] ?? "")) {
    embed = `https://player.vimeo.com/video/${parts[1]}`;
  } else if ((host === "dailymotion.com" && parts[0] === "video") || host === "dai.ly") {
    const id = host === "dai.ly" ? parts[0] : parts[1];
    if (id && /^\w+$/.test(id)) embed = `https://geo.dailymotion.com/player.html?video=${id}`;
  }

  if (embed) return { kind: "embed", src: embed };
  return { kind: DIRECT.test(u.pathname) ? "direct" : "page", src: u.href };
}
