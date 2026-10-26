import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import capture from "../../modules/companion-capture";
import * as Sharing from "expo-sharing";
import { connectionUrl } from "./presentation";
import type { Connection, Connections, Recording, Snapshot, Source, Transcript } from "./types";

const empty: Snapshot = { active_id: null, sessions: [], level: 0 };
const noConnections: Connections = { current: "", profiles: [] };
function useController() {
  const [snapshot, setSnapshot] = useState(empty);
  const [connections, setConnections] = useState(noConnections);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const current = connections.profiles.find(profile => profile.id === connections.current);
  const refresh = useCallback(async () => {
    if (!capture) { setReady(true); return; }
    const [snapshot, profiles] = await Promise.all([capture.snapshot(), capture.connections()]);
    setSnapshot(JSON.parse(snapshot)); setConnections(JSON.parse(profiles)); setReady(true);
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (disposed) return;
      if (AppState.currentState === "active") {
        try { await refresh(); } catch { setError("Não foi possível ler as gravações locais. Reabra o aplicativo para tentar novamente."); setReady(true); }
      }
      if (!disposed) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, [refresh]);
  const operate = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { return await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível concluir. Seus arquivos continuam salvos."); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  const connect = (url: string, token: string, name: string) => operate(async () => {
    if (!capture) throw new Error("Instale o aplicativo nativo para conectar este aparelho ao PC.");
    const origin = connectionUrl(url);
    const profiles: Connections = JSON.parse(await capture.connect(JSON.stringify({ url: origin, token, name: name.trim() || "Meu PC" })));
    setConnections(profiles); return true;
  });
  const start = (title: string, source: Source) => operate(async () => {
    if (!capture) throw new Error("A gravação em segundo plano exige o aplicativo instalado.");
    if (!current) throw new Error("Configure a conexão com o PC antes de gravar.");
    if (Platform.OS === "android") {
      const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      if (Number(Platform.Version) >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      const result = await PermissionsAndroid.requestMultiple(permissions);
      if (result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== "granted") throw new Error("Autorize a permissão de áudio para iniciar a gravação.");
    }
    const session: Recording = JSON.parse(await capture.start(JSON.stringify({ title: title.trim() || "Gravação no celular", source, connection_id: current.id })));
    await refresh(); return session;
  });
  const stop = () => operate(async () => {
    if (!capture) return;
    await capture.stop();
    for (let attempt = 0; attempt < 20; attempt++) {
      const next: Snapshot = JSON.parse(await capture.snapshot());
      setSnapshot(next);
      if (!next.active_id) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
  const sync = () => operate(async () => { await capture?.sync(); await refresh(); });
  const share = (id: string) => operate(async () => {
    if (!capture || !await Sharing.isAvailableAsync()) throw new Error("O compartilhamento de arquivos não está disponível neste aparelho.");
    const file = await capture.exportAudio(id);
    await Sharing.shareAsync(file, { mimeType: "audio/wav", UTI: "com.microsoft.waveform-audio", dialogTitle: "Compartilhar áudio original" });
  });
  return { snapshot, connections, current, ready, busy, error, nativeAvailable: Boolean(capture), connect, start, stop, sync, share, clearError: () => setError(null) };
}
type Controller = ReturnType<typeof useController>;
const Context = createContext<Controller | null>(null);
export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const controller = useController();
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useCompanion() { const value = useContext(Context); if (!value) throw new Error("CompanionProvider ausente"); return value; }
export function useTranscript(id: string | null, visible: boolean): Transcript {
  const [state, setState] = useState<Transcript>({ segments: [], online: false, status: "local" });
  useEffect(() => {
    let disposed = false;
    setState({ segments: [], online: false, status: "local" });
    if (id && capture) void capture.cachedTranscript(id).then(raw => { if (!disposed) setState(JSON.parse(raw)); }).catch(() => {});
    return () => { disposed = true; };
  }, [id]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || !id || !capture || !visible) return;
      if (AppState.currentState === "active") {
        try { const next = JSON.parse(await capture.transcript(id)); if (!stopped) setState(next); }
        catch { if (!stopped) setState(previous => ({ ...previous, online: false })); }
      }
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, visible]);
  return state;
}
export function connectionFor(recording: Recording, connections: Connections): Connection | undefined {
  return connections.profiles.find(profile => profile.id === recording.connection_id);
}
