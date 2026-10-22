import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";

afterEach(() => vi.useRealTimers());

it("aborts stale queries and prevents older results from replacing the current scope", async () => {
  let resolve!: (value: string) => void;
  const old = new Promise<string>((done) => {
    resolve = done;
  });
  const loader = vi
    .fn<(signal: AbortSignal) => Promise<string>>()
    .mockReturnValueOnce(old)
    .mockResolvedValue("Projeto atual");
  const view = renderHook(({ scope }) => useWorkspaceResource(loader, scope), {
    initialProps: { scope: "old" },
  });
  const signal = loader.mock.calls[0]![0];
  view.rerender({ scope: "new" });
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(view.result.current.data).toBe("Projeto atual"));
  await act(async () => resolve("Dados antigos"));
  expect(view.result.current.data).toBe("Projeto atual");
});

it("offers a loading state on retry and preserves successful data during background refresh", async () => {
  let resolve!: (value: string) => void;
  const loader = vi
    .fn<(signal: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue("Atualizado");
  const view = renderHook(() => useWorkspaceResource(loader, "tasks"));
  await waitFor(() => expect(view.result.current.error).toBe("Offline"));
  act(() => view.result.current.refresh());
  expect(view.result.current.loading).toBe(true);
  await act(async () => resolve("Salvo"));
  expect(view.result.current.data).toBe("Salvo");
  act(() => view.result.current.refresh());
  expect(view.result.current.data).toBe("Salvo");
  await waitFor(() => expect(view.result.current.data).toBe("Atualizado"));
});

it("times out a stalled request with a recoverable error", async () => {
  vi.useFakeTimers();
  const view = renderHook(() =>
    useWorkspaceResource(
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
      "slow",
    ),
  );
  await act(async () => vi.advanceTimersByTime(30000));
  expect(view.result.current.error).toContain("demorou demais");
  expect(view.result.current.loading).toBe(false);
});

it("blocks duplicate mutations and exposes failures without discarding the caller's draft", async () => {
  let reject!: (error: Error) => void;
  const operation = vi.fn(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const view = renderHook(() => useWorkspaceMutation());
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.execute(operation, "Salvo");
  });
  expect(view.result.current.busy).toBe(true);
  expect(await view.result.current.execute(operation, "Duplicado")).toBe(false);
  await act(async () => {
    reject(new Error("Conflito"));
    await pending;
  });
  expect(operation).toHaveBeenCalledOnce();
  expect(view.result.current.error).toBe("Conflito");
  expect(view.result.current.busy).toBe(false);
});
