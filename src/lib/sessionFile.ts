const MAGIC = "TLIWB-M1";
const MEDIA_ID = /^[\w-]+$/;

interface Manifest {
  sessionSize: number;
  media: { id: string; size: number; type: string }[];
}

/**
 * Fichier .iwb d'une session avec vidéos :
 * MAGIC | taille du manifeste (u32) | manifeste JSON | session JSON | vidéos à la suite.
 * Le Blob composé ne recopie pas les vidéos en mémoire. Sans vidéo, un .iwb reste du JSON pur.
 */
export function encodeSessionFile(session: string, media: { id: string; blob: Blob }[]): string | Blob {
  if (!media.length) return session;
  const enc = new TextEncoder();
  const sessionBytes = enc.encode(session);
  const manifest: Manifest = {
    sessionSize: sessionBytes.length,
    media: media.map(({ id, blob }) => ({ id, size: blob.size, type: blob.type })),
  };
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, manifestBytes.length, true);
  return new Blob([enc.encode(MAGIC), len, manifestBytes, sessionBytes, ...media.map((m) => m.blob)]);
}

export async function decodeSessionFile(file: Blob): Promise<{ text: string; media: Map<string, Blob> }> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC) {
    return { text: await file.text(), media: new Map() };
  }

  const corrupt = () => new Error("Fichier illisible : la session est incomplète ou endommagée.");
  if (head.length < MAGIC.length + 4) throw corrupt();
  const manifestLen = new DataView(head.buffer).getUint32(MAGIC.length, true);
  let at = head.length;
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await file.slice(at, at + manifestLen).text());
  } catch {
    throw corrupt();
  }
  at += manifestLen;
  if (!Number.isSafeInteger(manifest?.sessionSize) || manifest.sessionSize < 0 || !Array.isArray(manifest.media)) throw corrupt();
  const text = await file.slice(at, at + manifest.sessionSize).text();
  at += manifest.sessionSize;

  const media = new Map<string, Blob>();
  for (const m of manifest.media) {
    if (!MEDIA_ID.test(m?.id) || !Number.isSafeInteger(m.size) || m.size < 0 || at + m.size > file.size) throw corrupt();
    media.set(m.id, file.slice(at, at + m.size, typeof m.type === "string" ? m.type : ""));
    at += m.size;
  }
  return { text, media };
}
