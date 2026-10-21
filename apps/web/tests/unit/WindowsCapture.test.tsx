import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WindowsCapture } from "@/components/live/WindowsCapture";
import { windowsCapture } from "@/lib/windows-capture";

vi.mock("@/lib/windows-capture", () => ({ windowsCapture: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: { default_model: "turbo" } }) }));
vi.mock("@/hooks/useJobProgress", () => ({ useJobProgress: () => ({ job: null, newSegments: [], provisionalSegments: [] }) }));
const idle = { version: "1", recording: false, level: 0, sleep_protected: false, pending_total: 0, recovery_errors: 0 };
const inputs = { outputs: [{ id: "5", name: "Alto-falante de teste" }], microphones: [{ id: "2", name: "Microfone de teste" }] };
afterEach(() => vi.resetAllMocks());

it("uses the selected Windows output and starts recording independently of the browser", async () => {
  vi.mocked(windowsCapture).mockImplementation(async (path) => path === "/devices" ? inputs : path === "/start" ? { ...idle, recording: true, job_id: "windows-job", sleep_protected: true } : idle);
  const active = vi.fn();
  const busy = vi.fn();
  const { unmount } = render(<WindowsCapture onRecordingChange={active} onBusyChange={busy} />);
  const start = await screen.findByRole("button", { name: "Iniciar no Windows" });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.change(screen.getByRole("textbox", { name: "Título da gravação no Windows" }), { target: { value: "Reunião" } });
  fireEvent.change(screen.getByLabelText("Saída do desktop"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Microfone / entrada"), { target: { value: "2" } });
  fireEvent.click(start);
  await screen.findByRole("button", { name: "Encerrar no Windows" });
  expect(windowsCapture).toHaveBeenCalledWith("/start", expect.objectContaining({ source: "mixed", title: "Reunião", output: "5", microphone: "2", prevent_sleep: true }));
  expect(active).toHaveBeenLastCalledWith(true);
  expect(screen.getByText(/pode fechar o navegador/)).toBeVisible();
  expect(screen.getByText(/Proteção contra suspensão automática ativa/)).toBeVisible();
  unmount();
});

it("restores a running capture without requesting a new microphone and can stop it", async () => {
  vi.mocked(windowsCapture).mockImplementation(async (path) => path === "/devices" ? inputs : { ...idle, recording: path !== "/stop", job_id: "restored-job", duration: 20, pending_total: 2 });
  const { unmount } = render(<WindowsCapture onRecordingChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Encerrar no Windows" }));
  await screen.findByRole("button", { name: "Iniciar no Windows" });
  expect(windowsCapture).toHaveBeenCalledWith("/stop", {});
  expect(windowsCapture).not.toHaveBeenCalledWith("/start", expect.anything());
  expect(screen.getByRole("link", { name: /Abrir transcrição/ })).toHaveAttribute("href", "/jobs/restored-job");
  expect(screen.getByText(/2 trechos salvos/)).toBeVisible();
  unmount();
});

it("shows installation and connection recovery when the local agent is unavailable", async () => {
  vi.mocked(windowsCapture).mockRejectedValue(new TypeError("Failed to fetch"));
  const { unmount } = render(<WindowsCapture onRecordingChange={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/não está conectado/);
  expect(screen.getByText(/Start-Capturador.ps1/)).toBeVisible();
  vi.mocked(windowsCapture).mockImplementation(async (path) => path === "/devices" ? inputs : idle);
  fireEvent.click(screen.getByRole("button", { name: "Conectar capturador" }));
  expect(await screen.findByRole("button", { name: "Iniciar no Windows" })).toBeVisible();
  unmount();
});

it("retains a failed operation message and does not pretend recording started", async () => {
  vi.mocked(windowsCapture).mockImplementation(async (path) => {
    if (path === "/start") throw new Error("Entrada indisponível");
    return path === "/devices" ? inputs : idle;
  });
  const { unmount } = render(<WindowsCapture onRecordingChange={vi.fn()} />);
  const start = await screen.findByRole("button", { name: "Iniciar no Windows" });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: /Áudio do desktop/ }));
  expect(screen.queryByLabelText("Microfone / entrada")).not.toBeInTheDocument();
  fireEvent.click(start);
  expect(await screen.findByRole("alert")).toHaveTextContent("Entrada indisponível");
  expect(screen.queryByRole("button", { name: "Encerrar no Windows" })).not.toBeInTheDocument();
  unmount();
});
