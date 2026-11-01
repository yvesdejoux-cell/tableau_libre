import { describe, expect, it } from "vitest";
import { dirOf, joinPath, safeMediaName } from "./mediaFiles";

describe("chemins des médias", () => {
  it("ne garde que le nom de fichier d'un nom venu d'un .iwb", () => {
    expect(safeMediaName("film.mp4")).toBe("film.mp4");
    expect(safeMediaName("..\\..\\Windows\\win.ini")).toBe("win.ini");
    expect(safeMediaName("/etc/passwd")).toBe("passwd");
    expect(safeMediaName("a:b?.mp3")).toBe("a_b_.mp3");
    expect(safeMediaName("..")).toBeNull();
    expect(safeMediaName("  ")).toBeNull();
  });

  it("découpe et assemble les chemins Windows", () => {
    expect(dirOf("C:\\cours\\a.iwb")).toBe("C:\\cours");
    expect(joinPath("C:\\cours", "a.mp4")).toBe("C:\\cours\\a.mp4");
  });
});
