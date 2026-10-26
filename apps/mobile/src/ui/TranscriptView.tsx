import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Transcript } from "../core/types";
import { duration } from "../core/presentation";
import { Body, Icon } from "./primitives";
import { colors as c, fonts as f } from "./theme";

export function TranscriptView({ transcript, recording = false }: { transcript: Transcript; recording?: boolean }) {
  const scroll = useRef<ScrollView>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const [visibleCount, setVisibleCount] = useState(150);
  const last = transcript.segments.at(-1);
  useEffect(() => { if (follow.current) scroll.current?.scrollToEnd({ animated: false }); }, [last?.id]);
  return <View style={s.container}>
    {transcript.segments.length === 0 ? <View style={s.empty}>
      <Icon name="files" size={28} color={c.muted} />
      <Body style={{ color: c.text }}>{recording ? "O texto aparece aqui conforme o PC processa o áudio." : "A transcrição aparecerá aqui depois do envio ao PC."}</Body>
      <Body muted>O áudio continua salvo neste aparelho quando a conexão cai.</Body>
    </View> : <>
      <ScrollView ref={scroll} style={{ maxHeight: 430 }} contentContainerStyle={s.segments} onContentSizeChange={() => { if (follow.current) scroll.current?.scrollToEnd({ animated: false }); }}
        nestedScrollEnabled
        scrollEventThrottle={100} onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 90;
          follow.current = near; setAway(!near);
        }}>
        {transcript.segments.length > visibleCount && <Pressable accessibilityRole="button" onPress={() => { follow.current = false; setVisibleCount(count => count + 150); }} style={s.follow}><Text style={s.followText}>Mostrar trechos anteriores</Text></Pressable>}
        {transcript.segments.slice(-visibleCount).map(segment => <View key={segment.id} style={s.segment}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <Text style={s.timestamp}>{duration(segment.start)}</Text>
            {segment.speaker_id && <Text style={s.speaker}>{segment.speaker_id}</Text>}
          </View>
          <Text selectable style={s.text}>{segment.text.trim()}</Text>
        </View>)}
      </ScrollView>
      {away && <Pressable accessibilityRole="button" onPress={() => { follow.current = true; setAway(false); scroll.current?.scrollToEnd({ animated: false }); }} style={s.follow}><Text style={s.followText}>Seguir texto ao vivo ↓</Text></Pressable>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  container: { borderColor: c.border, borderWidth: 1, borderRadius: 17, backgroundColor: c.surface, overflow: "hidden" },
  empty: { padding: 22, minHeight: 205, justifyContent: "center", gap: 12 }, segments: { padding: 20, gap: 22 },
  segment: { gap: 7 }, timestamp: { color: c.primary, fontFamily: f.medium, fontSize: 13, fontVariant: ["tabular-nums"] },
  speaker: { color: c.muted, fontFamily: f.body, fontSize: 13 }, text: { color: c.text, fontFamily: f.body, fontSize: 19, lineHeight: 29 },
  follow: { minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: c.interactive }, followText: { color: c.primary, fontFamily: f.medium, fontSize: 15 },
});
