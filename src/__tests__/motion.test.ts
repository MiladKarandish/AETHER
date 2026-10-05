import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

/** Property names that force layout or paint rather than compositor-only work. */
const PAINT_TRIGGERING = [
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
  "padding",
  "box-shadow",
  "filter",
  "background",
  "background-color",
];

function keyframeBodies(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // walk braces to find the matching close
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    out.set(m[1], source.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

describe("motion system", () => {
  const frames = keyframeBodies(css);

  it("only animates compositor-friendly properties", () => {
    // Animating width/height/top/filter forces layout or paint on every frame.
    // These animations are compositor-only on purpose: the page already runs
    // two canvas render loops, so per-frame main-thread work is expensive.
    const offenders: string[] = [];
    for (const [name, body] of frames) {
      const props = new Set(
        [...body.matchAll(/^\s{2,}([a-z-]+)\s*:/gm)].map((m) => m[1]),
      );
      const bad = [...props].filter((p) => PAINT_TRIGGERING.includes(p));
      if (bad.length) offenders.push(`${name}: ${bad.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("provides an exit animation for every entry animation", () => {
    // Without a matching `-out`, overlays would pop out of existence.
    const names = [...frames.keys()];
    const pairs: [string, string][] = [
      ["backdrop-in", "backdrop-out"],
      ["sheet-in", "sheet-out"],
      ["dialog-in", "dialog-out"],
    ];
    for (const [enter, exit] of pairs) {
      expect(names, `missing ${enter}`).toContain(enter);
      expect(names, `missing ${exit} — ${enter} has no exit`).toContain(exit);
    }
  });

  it("gates every animation under prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}", start));
    // every anim-* class must appear in the reduced-motion block
    const animClasses = [
      ...new Set([...css.matchAll(/\.(anim-[\w-]+)/g)].map((m) => m[1])),
    ];
    expect(animClasses.length).toBeGreaterThan(0);
    for (const cls of animClasses) {
      expect(block, `${cls} is not gated by prefers-reduced-motion`).toContain(
        `.${cls}`,
      );
    }
  });

  it("defines shared duration and easing tokens", () => {
    for (const token of ["--dur-fast", "--dur-base", "--dur-sheet", "--ease-out"]) {
      expect(css, `missing motion token ${token}`).toContain(`${token}:`);
    }
  });

  it("does not leave will-change permanently on one-shot animations", () => {
    // A permanent will-change pins a compositor layer for the element's whole
    // lifetime. Browsers promote during the animation without it.
    const sheet = css.slice(css.indexOf(".anim-sheet {"), css.indexOf(".anim-sheet.closing"));
    expect(sheet).not.toContain("will-change");
  });
});