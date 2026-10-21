import { expect, it } from "vitest";
import { replaceTranscriptText } from "@/lib/transcript-text";
it("replaces only matching literal text and keeps replacement characters intact", () => {
  expect(replaceTranscriptText("a.b e aXb; A.B", "a.b", "$1")).toBe("$1 e aXb; $1");
  expect(replaceTranscriptText("revisar [backup] e [backup]", "[backup]", "cópias")).toBe("revisar cópias e cópias");
});
