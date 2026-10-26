import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useCompanion } from "../../core/controller";
import { duration, pendingCount, sessionStatus, sourceLabel } from "../../core/presentation";
import { Action, Body, Heading, Icon, layout, Notice, Panel, Pill } from "../../ui/primitives";
import { colors as c, fonts as f } from "../../ui/theme";

export default function RecordingsScreen() {
  const controller = useCompanion();
  const { snapshot, busy, error } = controller;
  const pending = pendingCount(snapshot.sessions);
  return <SafeAreaView edges={["top", "left", "right"]} style={layout.page}><ScrollView contentContainerStyle={[layout.content, snapshot.active_id && { paddingBottom: 110 }]}>
    <View style={{ gap: 6 }}><Heading>Gravações</Heading><Body>Áudio guardado neste aparelho e texto do seu PC.</Body></View>
    {error && <Notice tone="danger">{error}</Notice>}
    {pending > 0 && <Panel><Text style={s.pending}>{pending} {pending === 1 ? "gravação com envio pendente" : "gravações com envio pendente"}</Text><Body muted>O áudio permanece no aparelho durante a reconexão.</Body><Action label="Tentar enviar agora" icon="retry" secondary busy={busy} onPress={() => void controller.sync()} /></Panel>}
    {snapshot.sessions.length === 0 ? <Panel style={{ paddingVertical: 32, alignItems: "flex-start" }}><Icon name="files" size={33} /><Heading small>Sua primeira gravação</Heading><Body>Comece pelo microfone ou capture o áudio de um aplicativo no Android.</Body><View style={{ alignSelf: "stretch" }}><Action label="Ir para gravação" icon="mic" onPress={() => router.navigate("/(tabs)")} /></View></Panel> :
      <View style={s.list}>{snapshot.sessions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Abrir ${item.title}`} onPress={() => router.push(`/recording/${item.id}`)} style={({ pressed }) => [s.item, pressed && { backgroundColor: c.raised }]}>
        <View style={layout.between}><Text numberOfLines={2} style={s.title}>{item.title}</Text><Icon name="chevron" size={18} /></View>
        <Text style={s.meta}>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(item.created_at)} · {duration(item.duration)}</Text>
        <View style={layout.between}><Text style={s.source}>{sourceLabel[item.source]}</Text><Pill {...sessionStatus(item)} /></View>
      </Pressable>)}</View>}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  pending: { color: c.warning, fontFamily: f.medium, fontSize: 18, lineHeight: 26 },
  list: { borderWidth: 1, borderColor: c.border, borderRadius: 17, overflow: "hidden" }, item: { padding: 18, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface },
  title: { color: c.text, fontFamily: f.medium, fontSize: 18, lineHeight: 26, flex: 1 }, meta: { color: c.muted, fontFamily: f.body, fontSize: 14 }, source: { color: c.secondary, fontFamily: f.body, fontSize: 14, flexShrink: 1 },
});
