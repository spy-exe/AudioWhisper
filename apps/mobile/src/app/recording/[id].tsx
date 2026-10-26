import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { connectionFor, useCompanion, useTranscript } from "../../core/controller";
import { duration, sessionStatus, sourceLabel } from "../../core/presentation";
import { Action, Body, Heading, Icon, layout, Notice, Panel, Pill } from "../../ui/primitives";
import { TranscriptView } from "../../ui/TranscriptView";
import { colors as c, fonts as f } from "../../ui/theme";

export default function RecordingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const controller = useCompanion();
  const item = controller.snapshot.sessions.find(item => item.id === id);
  const transcript = useTranscript(item?.id ?? null, useIsFocused());
  const connection = item ? connectionFor(item, controller.connections) : undefined;
  return <SafeAreaView style={layout.page}><ScrollView contentContainerStyle={layout.content}>
    <Pressable accessibilityRole="button" accessibilityLabel="Voltar para gravações" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/recordings")} style={s.back}><Icon name="back" /><Text style={s.link}>Gravações</Text></Pressable>
    {!item ? <Panel><Heading small>Gravação indisponível</Heading><Body>Volte para a lista de arquivos guardados neste aparelho.</Body></Panel> : <>
      <Heading>{item.title}</Heading><Pill {...sessionStatus(item)} />
      <Panel><View style={layout.between}><Body>{sourceLabel[item.source]}</Body><Text style={s.duration}>{duration(item.duration)}</Text></View><Body muted>Destino: {connection?.name ?? "PC da gravação"}</Body><Body muted>{item.uploaded_chunks} de {item.chunks} trechos recebidos pelo PC.</Body></Panel>
      {item.interrupted && <Notice>O sistema interrompeu esta gravação. Os trechos disponíveis foram recuperados sem reativar o microfone.</Notice>}
      {item.capture_notice && <Notice>{item.capture_notice}</Notice>}
      {item.error && <Notice>{item.error}</Notice>}
      {item.remote_status === "failed" && <Notice tone="danger">{item.remote_error || "O processamento no PC falhou. O áudio continua salvo; abra o Studio para recuperar a transcrição."}</Notice>}
      <View style={layout.between}><Heading small>Transcrição</Heading><Body muted>{transcript.online ? "Atualizada pelo PC" : "Cópia disponível"}</Body></View>
      <TranscriptView transcript={transcript} recording={item.state === "recording"} />
      {item.uploaded_chunks < item.chunks && <Action label="Tentar enviar agora" icon="retry" secondary busy={controller.busy} onPress={() => void controller.sync()} />}
      {item.state === "recording" && <Action label="Encerrar gravação" onPress={() => void controller.stop()} busy={controller.busy} />}
      {item.state !== "recording" && item.frames > 0 && <Action label="Compartilhar áudio original" secondary busy={controller.busy} onPress={() => void controller.share(item.id)} />}
      {controller.error && <Notice tone="danger">{controller.error}</Notice>}
      <Body muted>O áudio original permanece no armazenamento privado deste aplicativo.</Body>
    </>}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ back: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8 }, link: { fontFamily: f.medium, fontSize: 16, color: c.primary }, duration: { fontFamily: f.heading, fontSize: 24, color: c.text, fontVariant: ["tabular-nums"] } });
