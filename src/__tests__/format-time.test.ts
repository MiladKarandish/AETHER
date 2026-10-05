import { describe, expect, it } from "vitest";
import { formatTime } from "@/components/queue-list";
import { TRACKS } from "@/lib/tracks";

describe("formatTime", () => {
  it("formats whole seconds as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(3661)).toBe("61:01");
    expect(formatTime(600)).toBe("10:00");
  });

  it("zero-pads seconds but never the minutes", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(3600)).toBe("60:00");
  });

  it("truncates rather than rounds fractional seconds", () => {
    expect(formatTime(9.5)).toBe("0:09");
    expect(formatTime(59.9)).toBe("0:59");
    expect(formatTime(61.9)).toBe("1:01");
    expect(formatTime(119.99)).toBe("1:59");
  });

  it("clamps negatives to zero", () => {
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(-0.5)).toBe("0:00");
  });

  it("clamps non-finite input to zero", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-Infinity)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });

  it("never renders a seconds field outside 00-59", () => {
    for (const t of TRACKS) {
      expect(formatTime(t.duration)).toMatch(/^\d+:[0-5]\d$/);
    }
  });

  it("is monotonic and exact at minute boundaries", () => {
    expect(formatTime(59)).toBe("0:59");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(86399)).toBe("1439:59");
  });
});