import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useCompanion } from "../../core/controller";
import { Action, Body, Field, FormViewport, Heading, Icon, layout, Notice, Panel, Pill } from "../../ui/primitives";
import { colors as c, fonts as f } from "../../ui/theme";

export default function ConnectionScreen() {
  const controller = useCompanion();
  const { current, snapshot, busy, error, nativeAvailable } = controller;
  const [url, setUrl] = useState(current?.url ?? "");
  const [name, setName] = useState(current?.name ?? "Meu PC");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [edit, setEdit] = useState(!current);
  const [advanced, setAdvanced] = useState(false);
  const [help, setHelp] = useState(false);
  const save = async () => { if (await controller.connect(url, token, name)) { setToken(""); setEdit(false); } };
  return <SafeAreaView style={layout.page} edges={["top", "left", "right"]}><FormViewport><ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={[layout.content, snapshot.active_id && { paddingBottom: 110 }]}>
    <View style={{ gap: 6 }}><Heading>Conexão com o PC</Heading><Body>Use a rede local ou o endereço da sua VPN.</Body></View>
    {error && <Notice tone="danger">{error}</Notice>}
    {current && !edit && <Panel><View style={layout.between}><Icon name="pc" size={28} color={c.primary} /><Pill label="PC configurado" tone="success" /></View>
      <Heading small>{current.name}</Heading><Text selectable style={s.address}>{current.url}</Text>
      <Body muted>{current.defaults.device.toUpperCase()} · {current.defaults.model_name} · configuração do Studio</Body>
      <Action label="Ir para gravação" icon="mic" onPress={() => router.navigate("/(tabs)")} />
      <Action label="Abrir Studio no navegador" icon="arrow" secondary onPress={() => { void Linking.openURL(current.url).catch(() => undefined); }} />
      <Pressable accessibilityRole="button" onPress={() => { setUrl(current.url); setName(current.name); setEdit(true); }} style={s.textButton}><Text style={s.link}>Alterar conexão</Text></Pressable>
    </Panel>}
    {edit && <Panel>
      <Field label="Endereço do PC" placeholder="http://192.168.1.20:8080" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
        hint="No PC, use o IPv4 mostrado pelo ipconfig. Pela VPN, use o IP fornecido por ela." />
      <Field label="Nome desta conexão" value={name} onChangeText={setName} maxLength={80} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(value => !value)} style={s.textButton}><Text style={s.link}>{advanced ? "▾" : "▸"} Token de acesso</Text></Pressable>
      {advanced && <View style={{ gap: 8 }}><Field label="Token configurado no PC" value={token} onChangeText={setToken} secureTextEntry={!showToken} autoCapitalize="none" autoCorrect={false} textContentType="password"
        hint="Preencha somente se o Studio usa ACCESS_TOKEN. O valor fica no armazenamento seguro do aparelho." />
        <Pressable accessibilityRole="button" accessibilityLabel={showToken ? "Ocultar token" : "Mostrar token"} onPress={() => setShowToken(value => !value)} style={[layout.row, { minHeight: 44 }]}><Icon name="eye" size={19} /><Text style={s.link}>{showToken ? "Ocultar" : "Mostrar"}</Text></Pressable></View>}
      <Action label="Testar e conectar" busy={busy} disabled={!nativeAvailable || !url.trim()} icon="pc" onPress={() => void save()} />
      {current && <Action label="Cancelar edição" secondary disabled={busy} onPress={() => setEdit(false)} />}
    </Panel>}
    <View style={{ gap: 8 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: help }} onPress={() => setHelp(value => !value)} style={s.textButton}><Text style={s.link}>{help ? "▾" : "▸"} Como encontrar o PC</Text></Pressable>{help && <><Body>Deixe o AudioWhisper aberto no PC e permita a porta 8080 no firewall da rede privada. Celular e PC precisam conseguir se alcançar.</Body><Body muted>Uma VPN funciona pelo mesmo endereço configurável. Ao perder a conexão, o app continua guardando o áudio e retoma o envio.</Body></>}</View>
  </ScrollView></FormViewport></SafeAreaView>;
}
const s = StyleSheet.create({ address: { color: c.primary, fontFamily: f.body, fontSize: 17, lineHeight: 25 }, link: { color: c.primary, fontFamily: f.medium, fontSize: 16 }, textButton: { minHeight: 44, justifyContent: "center" } });
