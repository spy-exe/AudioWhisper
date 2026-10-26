import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Tone } from "../core/types";
import { colors as c, fonts as f } from "./theme";

export function Icon({ name, color = c.secondary, size = 22 }: { name: "mic" | "screen" | "files" | "pc" | "arrow" | "back" | "retry" | "eye" | "check" | "plus" | "chevron"; color?: string; size?: number }) {
  const paths = {
    mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
    screen: "M3 4h18v13H3zM12 17v4M8 21h8M6 9h3l2 4 3-6 2 4h2",
    files: "M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h5",
    pc: "M3 4h18v13H3zM12 17v4M8 21h8",
    arrow: "M5 12h14M13 6l6 6-6 6",
    back: "M19 12H5M11 6l-6 6 6 6",
    retry: "M20 7v5h-5M20 12a8 8 0 1 0-1 5M20 7V3",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
    check: "M5 12l4 4L20 5", plus: "M12 5v14M5 12h14", chevron: "M9 5l7 7-7 7",
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d={paths[name]} /></Svg>;
}
export function WaveMark({ small = false }: { small?: boolean }) {
  return <View accessible={false} style={{ flexDirection: "row", alignItems: "center", gap: small ? 3 : 4, height: small ? 24 : 36 }}>
    {[10, 22, 34, 18, 9].map((height, index) => <View key={index} style={{ width: small ? 2 : 3, height: small ? height * .65 : height, borderRadius: 2, backgroundColor: c.primary }} />)}
  </View>;
}
export function Body({ children, muted = false, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.body, muted && { color: c.muted }, style]}>{children}</Text>;
}
export function Heading({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return <Text accessibilityRole="header" style={[s.heading, small && { fontSize: 21, lineHeight: 29 }]}>{children}</Text>;
}
export function Pill({ label, tone = "primary" }: { label: string; tone?: Tone }) {
  const color = tone === "muted" ? c.muted : c[tone];
  return <View style={[s.pill, { borderColor: color + "55" }]}><View style={[s.dot, { backgroundColor: color }]} /><Text style={[s.pillText, { color }]}>{label}</Text></View>;
}
export function Action({ label, onPress, busy = false, disabled = false, secondary = false, icon, accessibilityLabel }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean;
  icon?: React.ComponentProps<typeof Icon>["name"]; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [s.action, secondary && s.secondary, (disabled || busy) && { opacity: .5 }, pressed && { transform: [{ scale: .985 }] }]}>
    {busy ? <ActivityIndicator color={secondary ? c.primary : c.background} /> : icon ? <Icon name={icon} color={secondary ? c.primary : c.background} size={19} /> : null}
    <Text style={[s.actionText, secondary && { color: c.primary }]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ gap: 7 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={c.muted} selectionColor={c.primary} style={s.input} {...props} />{hint && <Text style={s.hint}>{hint}</Text>}</View>;
}
export function Notice({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "danger" | "primary" }) {
  return <View accessibilityLiveRegion="polite" style={[s.notice, { borderLeftColor: c[tone] }]}><Text style={[s.body, { color: c[tone] }]}>{children}</Text></View>;
}
export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[s.panel, style]}>{children}</View>; }
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduced); const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced); return () => listener.remove(); }, []);
  return reduced;
}
export function Meter({ level, recording }: { level: number; recording: boolean }) {
  const value = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: recording ? level : 0, duration: reduced ? 0 : 180, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [value, level, recording, reduced]);
  return <View accessible accessibilityLabel={recording ? "Nível do áudio capturado" : "Medidor de áudio inativo"} style={s.meter}>
    {Array.from({ length: 33 }, (_, i) => <Animated.View key={i} style={{ width: 3, height: 40 - Math.abs(16 - i) * 1.6, borderRadius: 3, backgroundColor: recording ? c.amber : c.border,
      transform: [{ scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [.12, .6 + ((i * 7) % 13) / 13] }) }] }} />)}
  </View>;
}
export const layout = StyleSheet.create({ page: { flex: 1, backgroundColor: c.background }, content: { padding: 22, paddingBottom: 32, gap: 22, width: "100%", maxWidth: 680, alignSelf: "center" }, row: { flexDirection: "row", alignItems: "center", gap: 12 }, between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 } });
const s = StyleSheet.create({
  body: { fontFamily: f.body, fontSize: 17, lineHeight: 25, color: c.secondary },
  heading: { fontFamily: f.heading, fontSize: 30, lineHeight: 39, color: c.text },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 20, alignSelf: "flex-start", flexShrink: 1 },
  pillText: { fontFamily: f.medium, fontSize: 13, lineHeight: 19, flexShrink: 1 }, dot: { width: 6, height: 6, borderRadius: 3 },
  action: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: c.primary, padding: 13, borderRadius: 12 },
  secondary: { backgroundColor: c.interactive }, actionText: { fontFamily: f.medium, fontSize: 17, lineHeight: 25, color: c.background },
  label: { fontFamily: f.medium, fontSize: 15, lineHeight: 22, color: c.secondary },
  input: { fontFamily: f.body, fontSize: 17, minHeight: 54, borderWidth: 1, borderColor: c.border, borderRadius: 11, padding: 13, backgroundColor: c.surface, color: c.text },
  hint: { fontFamily: f.body, fontSize: 14, lineHeight: 21, color: c.muted },
  notice: { borderLeftWidth: 3, borderRadius: 8, padding: 13, backgroundColor: c.surface },
  panel: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 17, padding: 19, gap: 15 },
  meter: { flexDirection: "row", height: 56, alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" },
});
