import { describe, expect, it } from "vitest";
import { parseVideoLink } from "./videoLinks";

const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0";

describe("parseVideoLink", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["youtube.com/watch?list=abc&v=dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=xyz"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["  https://www.youtube.com/live/dQw4w9WgXcQ  "],
  ])("reconnaît YouTube : %s", (url) => {
    expect(parseVideoLink(url)).toEqual({ kind: "embed", src: YT });
  });

  it.each([
    ["https://youtu.be/dQw4w9WgXcQ?t=90", 90],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", 90],
  ])("garde l'instant de départ : %s", (url, start) => {
    expect(parseVideoLink(url)?.src).toBe(`${YT}&start=${start}`);
  });

  it("reconnaît Vimeo et Dailymotion", () => {
    expect(parseVideoLink("https://vimeo.com/76979871")?.src).toBe("https://player.vimeo.com/video/76979871");
    expect(parseVideoLink("https://vimeo.com/76979871/abc123")?.src).toBe("https://player.vimeo.com/video/76979871?h=abc123");
    expect(parseVideoLink("https://www.dailymotion.com/video/x8abc")?.src).toBe("https://geo.dailymotion.com/player.html?video=x8abc");
    expect(parseVideoLink("https://dai.ly/x8abc")?.src).toBe("https://geo.dailymotion.com/player.html?video=x8abc");
  });

  it("distingue un fichier en ligne d'une page quelconque", () => {
    expect(parseVideoLink("https://exemple.org/film.MP4?x=1")).toEqual({ kind: "direct", src: "https://exemple.org/film.MP4?x=1" });
    expect(parseVideoLink("https://exemple.org/page")?.kind).toBe("page");
    expect(parseVideoLink("https://www.youtube.com/@chaine")?.kind).toBe("page");
  });

  it.each([[""], ["bonjour tout le monde"], ["bonjour"], ["javascript:alert(1)"], ["file:///c:/a.mp4"]])(
    "refuse : %s",
    (text) => {
      expect(parseVideoLink(text)).toBeNull();
    }
  );
});
