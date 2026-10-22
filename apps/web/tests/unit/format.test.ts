import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, formatTimestamp, statusLabel } from "@/lib/format";

describe("formatTimestamp", () => {
  it("formats seconds under a minute", () => {
    expect(formatTimestamp(5)).toBe("00:05");
  });
  it("formats minutes and seconds", () => {
    expect(formatTimestamp(125)).toBe("02:05");
  });
  it("formats hours when needed", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });
  it("clamps invalid input", () => {
    expect(formatTimestamp(-5)).toBe("00:00");
    expect(formatTimestamp(NaN)).toBe("00:00");
  });
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m05s");
  });
  it("handles null", () => {
    expect(formatDuration(null)).toBe("Não disponível");
  });
});

describe("formatBytes", () => {
  it("formats bytes under 1024 as B", () => {
    expect(formatBytes(500)).toBe("500 B");
  });
  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
  it("formats megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("statusLabel", () => {
  it("maps known statuses to Portuguese labels", () => {
    expect(statusLabel("transcribing")).toBe("Transcrevendo");
    expect(statusLabel("completed")).toBe("Concluído");
  });
  it("falls back to the raw value for unknown statuses", () => {
    expect(statusLabel("something_else")).toBe("something_else");
  });
});
