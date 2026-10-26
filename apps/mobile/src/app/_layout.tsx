import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import IBMPlexSans_400Regular from "@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf";
import IBMPlexSans_500Medium from "@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf";
import Manrope_700Bold from "@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, View } from "react-native";
import { CompanionProvider, useCompanion } from "../core/controller";
import { colors } from "../ui/theme";
import { useReducedMotion } from "../ui/primitives";

export default function RootLayout() {
  const [loaded, error] = useFonts({ IBMPlexSans_400Regular, IBMPlexSans_500Medium, Manrope_700Bold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.primary} accessibilityLabel="Carregando o AudioWhisper" /></View>;
  return <SafeAreaProvider><CompanionProvider><StatusBar style="light" /><Application /></CompanionProvider></SafeAreaProvider>;
}
function Application() {
  const { ready } = useCompanion();
  const reduced = useReducedMotion();
  return ready ? <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: reduced ? "none" : "fade" }} /> : <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.primary} accessibilityLabel="Lendo gravações locais" /></View>;
}
