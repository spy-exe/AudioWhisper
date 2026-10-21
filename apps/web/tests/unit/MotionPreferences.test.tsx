import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MotionPreferences } from "@/components/ui/MotionPreferences";
import { useMotionPreference } from "@/hooks/useMotionPreference";

const config = vi.hoisted(() => ({ visual_effects_enabled: true }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: config }) }));
function Probe() { return <p>{useMotionPreference() ? "reduzido" : "completo"}</p>; }
afterEach(() => { vi.unstubAllGlobals(); config.visual_effects_enabled = true; delete document.documentElement.dataset.reducedMotion; });

it("reacts to OS motion changes without a reload", async () => {
  let listener!: (event: { matches: boolean }) => void;
  const remove = vi.fn();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, removeEventListener: remove, addListener: vi.fn(), removeListener: vi.fn() })));
  const { unmount } = render(<MotionPreferences><Probe /></MotionPreferences>);
  expect(screen.getByText("completo")).toBeVisible();
  act(() => listener({ matches: true }));
  await waitFor(() => expect(document.documentElement.dataset.reducedMotion).toBe("true"));
  expect(screen.getByText("reduzido")).toBeVisible();
  unmount();
  expect(remove).toHaveBeenCalled();
});

it("the application setting can reduce motion even when the OS allows it", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  config.visual_effects_enabled = false;
  render(<MotionPreferences><Probe /></MotionPreferences>);
  expect(screen.getByText("reduzido")).toBeVisible();
  expect(document.documentElement.dataset.reducedMotion).toBe("true");
});
