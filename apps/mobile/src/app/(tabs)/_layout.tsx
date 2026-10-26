import { Tabs } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCompanion } from "../../core/controller";
import { duration } from "../../core/presentation";
import { Icon } from "../../ui/primitives";
import { colors as c, fonts as f } from "../../ui/theme";

export default function TabsLayout() {
  const controller = useCompanion();
  const insets = useSafeAreaInsets();
  const active = controller.snapshot.sessions.find(item => item.id === controller.snapshot.active_id);
  return <View style={{ flex: 1 }}><Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.muted,
    tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, paddingTop: 7, paddingBottom: insets.bottom, height: 67 + insets.bottom },
    tabBarLabelStyle: { fontFamily: f.medium, fontSize: 13, marginTop: 3 }, sceneStyle: { backgroundColor: c.background } }}>
    <Tabs.Screen name="index" options={{ title: "Gravar", tabBarIcon: ({ color }) => <Icon name="mic" color={color} /> }} />
    <Tabs.Screen name="recordings" options={{ title: "Gravações", tabBarIcon: ({ color }) => <Icon name="files" color={color} /> }} />
    <Tabs.Screen name="connection" options={{ title: "Conexão", tabBarIcon: ({ color }) => <Icon name="pc" color={color} /> }} />
  </Tabs>{active && <View style={[s.capture, { bottom: insets.bottom + 66 }]}>
    <View style={{ gap: 2, flex: 1 }}><Text style={s.label}>Gravando</Text><Text style={s.time}>{duration(active.duration)}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Encerrar gravação" accessibilityState={{ busy: controller.stopping, disabled: controller.stopping }} disabled={controller.stopping}
      onPress={() => void controller.stop()} style={s.stop}>{controller.stopping ? <ActivityIndicator color={c.background} /> : <View style={s.square} />}<Text style={s.stopText}>Encerrar</Text></Pressable>
  </View>}</View>;
}
const s = StyleSheet.create({ capture: { position: "absolute", left: 16, right: 16, borderRadius: 14, padding: 12, paddingLeft: 18, flexDirection: "row", alignItems: "center", backgroundColor: c.raised, borderWidth: 1, borderColor: c.border, elevation: 8, boxShadow: "0px 8px 30px #00000055" },
  label: { fontFamily: f.body, fontSize: 13, color: c.secondary }, time: { fontFamily: f.medium, fontSize: 19, color: c.text, fontVariant: ["tabular-nums"] },
  stop: { minHeight: 48, paddingHorizontal: 17, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: c.amber }, stopText: { fontFamily: f.medium, fontSize: 16, color: c.background }, square: { height: 10, width: 10, borderRadius: 2, backgroundColor: c.background } });
