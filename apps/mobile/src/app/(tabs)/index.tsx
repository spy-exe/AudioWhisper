import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { connectionFor, useCompanion, useTranscript } from "../../core/controller";
import { duration, sessionStatus } from "../../core/presentation";
import type { Source } from "../../core/types";
import { Action, Body, Field, FormViewport, Heading, Icon, layout, Meter, Notice, Panel, Pill, useNarrowLayout, WaveMark } from "../../ui/primitives";
import { TranscriptView } from "../../ui/TranscriptView";
import { colors as c, fonts as f } from "../../ui/theme";

function defaultTitle() { return "Gravação " + new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()); }
export default function RecordScreen() {
  const controller = useCompanion();
  const narrow = useNarrowLayout();
  const { snapshot, current, ready, busy, error, nativeAvailable } = controller;
  const [title, setTitle] = useState(defaultTitle);
  const [source, setSource] = useState<Source>("microphone");
  const [lastId, setLastId] = useState<string | null>(null);
  const active = snapshot.sessions.find(item => item.id === snapshot.active_id);
  const session = active ?? snapshot.sessions.find(item => item.id === lastId);
  const destination = active ? connectionFor(active, controller.connections) : current;
  const transcript = useTranscript(session?.id ?? null, useIsFocused());
  const status = session ? sessionStatus(session) : null;
  const start = async () => { const next = await controller.start(title, source); if (next) { setLastId(next.id); setTitle(defaultTitle()); } };
  const sources: { value: Source; label: string; icon: "mic" | "screen" }[] = [
    { value: "microphone", label: "Microfone", icon: "mic" }, { value: "system", label: "Apps", icon: "screen" }, { value: "mixed", label: "Ambos", icon: "mic" },
  ];
  return <SafeAreaView style={layout.page} edges={["top", "left", "right"]}>
    <FormViewport><ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={[layout.content, active && { paddingBottom: 110 }]}>
      <View style={[layout.between, { flexWrap: "wrap" }]}><View style={layout.row}><WaveMark small /><Text style={s.brand}>AudioWhisper</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Configurar conexão com o PC" onPress={() => router.navigate("/(tabs)/connection")} style={s.connection}>
          <View style={[s.connectionDot, { backgroundColor: destination ? c.primary : c.muted }]} /><Text numberOfLines={1} style={s.connectionName}>{destination?.name ?? "Conectar PC"}</Text><Icon name="chevron" size={14} />
        </Pressable>
      </View>
      <View style={{ gap: 5 }}><Heading>Gravar e transcrever</Heading><Body>O celular captura. Seu PC transcreve.</Body></View>
      {!nativeAvailable && <Notice tone="primary">Esta prévia mostra a interface. Instale o APK para gravar em segundo plano e conectar ao PC.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel style={{ alignItems: "center", paddingVertical: 24 }}>
        <Text accessibilityLabel={`Duração ${duration(active?.duration ?? 0)}`} style={s.clock}>{duration(active?.duration ?? 0)}</Text>
        <Meter level={snapshot.level} recording={Boolean(active)} />
        {active ? <Pill label="Gravando neste aparelho" tone="warning" /> : <Pressable accessibilityRole="button" accessibilityLabel="Iniciar gravação"
          accessibilityState={{ disabled: !current || busy || !nativeAvailable || !ready, busy }} disabled={!current || busy || !nativeAvailable || !ready}
          onPress={() => void start()} style={({ pressed }) => [s.recordButton, (!current || !nativeAvailable) && { opacity: .4 }, pressed && { transform: [{ scale: .96 }] }]}>
          <View style={s.recordDot} /><Text style={s.recordLabel}>{busy ? "Preparando…" : "Iniciar gravação"}</Text>
        </Pressable>}
        <Text style={s.localNote}>{active ? active.source === "microphone" ? "Você pode bloquear a tela ou usar outros aplicativos." : "Você pode usar outros apps. Bloquear a tela pode encerrar a captura do áudio deles." : current ? "Áudio salvo no celular antes de cada envio." : "Conecte seu PC para começar. A fila funciona sem rede."}</Text>
      </Panel>
      {!active && <>
        <Field label="Título da gravação" value={title} onChangeText={setTitle} maxLength={500} />
        <View style={{ gap: 9 }}><Text style={s.label}>Fonte do áudio</Text><View style={{ flexDirection: narrow ? "column" : "row", gap: 9 }}>
          {sources.map(item => {
            const disabled = item.value !== "microphone" && Platform.OS !== "android";
            return <Pressable key={item.value} accessibilityRole="radio" accessibilityLabel={item.value === "system" ? "Áudio dos aplicativos" : item.value === "mixed" ? "Microfone e áudio dos aplicativos" : item.label}
              accessibilityState={{ checked: source === item.value, disabled }} disabled={disabled} onPress={() => setSource(item.value)}
              style={[s.source, narrow && { flex: 0, flexDirection: "row", minHeight: 58, justifyContent: "flex-start", gap: 14 }, source === item.value && s.sourceSelected, disabled && { opacity: .4 }]}>
              <Icon name={item.icon} color={source === item.value ? c.primary : c.muted} /><Text style={[s.sourceText, source === item.value && { color: c.primary }]}>{item.label}</Text>
            </Pressable>;
          })}
        </View><Text style={s.sourceHint}>{source === "microphone" ? "Microfone do celular, inclusive com a tela apagada." : source === "system" ? "O Android pedirá permissão de captura de tela. Só o áudio dos apps que permitem captura é salvo." : "Sua voz e o áudio dos aplicativos. Use fones para reduzir o eco."}</Text></View>
      </>}
      {session && <View style={{ gap: 11 }}>
        <View style={[layout.between, narrow && { flexDirection: "column", alignItems: "flex-start" }]}><Heading small>Transcrição</Heading>{status && <Pill {...status} />}</View>
        {session.error && <Notice>{session.error}</Notice>}
        {session.capture_notice && <Notice>{session.capture_notice}</Notice>}
        <TranscriptView transcript={transcript} recording={Boolean(active)} />
        <Text style={s.localNote}>{transcript.online ? "Trechos confirmados pelo PC. O tempo de resposta depende da fila e da GPU." : "O texto é atualizado quando o PC responde."}</Text>
        {!active && <Action label="Abrir gravação" icon="arrow" secondary onPress={() => router.push(`/recording/${session.id}`)} />}
      </View>}
    </ScrollView></FormViewport>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  brand: { color: c.text, fontFamily: f.heading, fontSize: 19 },
  connection: { minHeight: 44, maxWidth: "48%", flexDirection: "row", alignItems: "center", gap: 6 },
  connectionDot: { width: 6, height: 6, borderRadius: 3 }, connectionName: { color: c.secondary, fontFamily: f.medium, fontSize: 14, flexShrink: 1 },
  clock: { color: c.text, fontFamily: f.heading, fontSize: 47, lineHeight: 60, fontVariant: ["tabular-nums"] },
  recordButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: c.amber, minHeight: 58, borderRadius: 32, paddingHorizontal: 25, alignSelf: "stretch" },
  recordDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: c.background }, recordLabel: { color: c.background, fontFamily: f.medium, fontSize: 18 },
  localNote: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 21, textAlign: "center" },
  label: { color: c.secondary, fontFamily: f.medium, fontSize: 15 }, source: { flex: 1, alignItems: "center", gap: 8, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface, minHeight: 80 },
  sourceSelected: { borderColor: c.primary, backgroundColor: c.raised }, sourceText: { color: c.secondary, fontFamily: f.medium, fontSize: 16 },
  sourceHint: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 21, minHeight: 43 },
});
