import { describe, expect, it } from "vitest";
import { decodeSessionFile, encodeSessionFile } from "./sessionFile";

describe("encodeSessionFile / decodeSessionFile", () => {
  it("garde du JSON pur quand il n'y a pas de vidéo", async () => {
    expect(encodeSessionFile('{"a":1}', [])).toBe('{"a":1}');
    const { text, media } = await decodeSessionFile(new Blob(['{"é":1}']));
    expect(text).toBe('{"é":1}');
    expect(media.size).toBe(0);
  });

  it("retrouve la session et chaque vidéo à l'identique", async () => {
    const a = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
    const b = new Blob([new Uint8Array([4, 5])], { type: "video/webm" });
    const file = encodeSessionFile('{"é":1}', [{ id: "a", blob: a }, { id: "b_-1", blob: b }]) as Blob;
    const { text, media } = await decodeSessionFile(file);
    expect(text).toBe('{"é":1}');
    expect(media.get("a")!.type).toBe("video/mp4");
    expect([...new Uint8Array(await media.get("a")!.arrayBuffer())]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(await media.get("b_-1")!.arrayBuffer())]).toEqual([4, 5]);
  });

  it("refuse un fichier tronqué", async () => {
    const file = encodeSessionFile("{}", [{ id: "a", blob: new Blob([new Uint8Array(100)]) }]) as Blob;
    await expect(decodeSessionFile(file.slice(0, file.size - 1))).rejects.toThrow(/endommagée/);
  });

  it("refuse un identifiant de vidéo qui sortirait du dossier de récupération", async () => {
    const manifest = new TextEncoder().encode(JSON.stringify({ sessionSize: 0, media: [{ id: "../x", size: 0, type: "" }] }));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, manifest.length, true);
    await expect(decodeSessionFile(new Blob(["TLIWB-M1", len, manifest]))).rejects.toThrow(/endommagée/);
  });
});
