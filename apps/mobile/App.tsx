import type { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  authCallbackUrl,
  subscribeToAuthDeepLinks,
} from "./src/auth/deep-link";
import { supabase } from "./src/auth/supabase";
import { ToolIntegrationControl } from "./src/integrations/linear-control";
import { useVoiceSession } from "./src/realtime/use-voice-session";

const labels = {
  authenticating: "AUTHENTICATING",
  connected: "ONLINE",
  connecting: "LINKING",
  disconnected: "OFFLINE",
  error: "FAULT",
  idle: "READY",
  listening: "LISTENING",
  reconnecting: "RECONNECTING",
  speaking: "SPEAKING",
  thinking: "THINKING",
} as const;
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
function AppContent() {
  const [session, setSession] = useState<Session | null>();
  const [authError, setAuthError] = useState<string>();
  useEffect(() => {
    const unsubscribeDeepLinks = subscribeToAuthDeepLinks(setAuthError);
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, next) => setSession(next)
    );
    return () => {
      unsubscribeDeepLinks();
      authSubscription.subscription.unsubscribe();
    };
  }, []);
  if (session === undefined)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#e8ff58" />
        <StatusBar style="light" />
      </View>
    );
  return session ? (
    <VoiceScreen email={session.user.email ?? "authenticated"} />
  ) : (
    <AuthScreen initialMessage={authError} />
  );
}

function AuthScreen({
  initialMessage,
}: {
  initialMessage: string | undefined;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const passwordInput = useRef<TextInput>(null);
  const scrollView = useRef<ScrollView>(null);
  useEffect(() => {
    if (initialMessage) setMessage(initialMessage);
  }, [initialMessage]);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  async function submit(create = false) {
    Keyboard.dismiss();
    setBusy(true);
    setMessage(undefined);
    const result = create
      ? await supabase.auth.signUp({
          email: email.trim(),
          options: { emailRedirectTo: authCallbackUrl },
          password,
        })
      : await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (create && !result.data.session)
      setMessage("Check your inbox to confirm your account.");
  }
  const disabled = busy || !email.trim() || password.length < 6;
  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={styles.safe}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.authKeyboard}
      >
        <ScrollView
          contentContainerStyle={[
            styles.authContent,
            keyboardVisible && styles.authContentKeyboard,
          ]}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          ref={scrollView}
          showsVerticalScrollIndicator={false}
          style={styles.authScroll}
        >
          <View style={keyboardVisible ? styles.heroKeyboard : styles.hero}>
            <Text style={styles.eyebrow}>TOOLED / VOICE</Text>
            <Text style={keyboardVisible ? styles.titleKeyboard : styles.title}>
              {keyboardVisible ? (
                "Speak. Delegate. Done."
              ) : (
                <>
                  Speak.{"\n"}Delegate.{"\n"}Done.
                </>
              )}
            </Text>
            {keyboardVisible ? null : (
              <Text style={styles.intro}>
                A private voice line to your tools.
              </Text>
            )}
          </View>
          <View style={styles.form}>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              blurOnSubmit={false}
              keyboardType="email-address"
              onChangeText={setEmail}
              onFocus={() =>
                requestAnimationFrame(() =>
                  scrollView.current?.scrollToEnd({ animated: true })
                )
              }
              onSubmitEditing={() => passwordInput.current?.focus()}
              placeholder="EMAIL"
              placeholderTextColor="#77796e"
              returnKeyType="next"
              style={styles.input}
              textContentType="emailAddress"
              value={email}
            />
            <TextInput
              accessibilityLabel="Password"
              autoComplete="password"
              onChangeText={setPassword}
              onFocus={() =>
                requestAnimationFrame(() =>
                  scrollView.current?.scrollToEnd({ animated: true })
                )
              }
              onSubmitEditing={() => {
                if (!disabled) void submit();
              }}
              placeholder="PASSWORD"
              placeholderTextColor="#77796e"
              ref={passwordInput}
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              textContentType="password"
              value={password}
            />
            {message ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                style={styles.error}
              >
                {message}
              </Text>
            ) : null}
            <Pressable
              accessibilityLabel="Sign in"
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.primary,
                disabled && styles.primaryDisabled,
                pressed && !disabled && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#11130e" />
              ) : (
                <Text style={styles.primaryText}>ENTER VOICE LINK</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="Create account"
              accessibilityRole="button"
              disabled={busy || !email.trim() || password.length < 6}
              onPress={() => void submit(true)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.secondary}>CREATE ACCOUNT</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function VoiceScreen({ email }: { email: string }) {
  const voice = useVoiceSession();
  const history = useRef<ScrollView>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const active = ["connected", "listening", "thinking", "speaking"].includes(
    voice.state
  );
  const pending = ["authenticating", "connecting", "reconnecting"].includes(
    voice.state
  );
  const liveLabel = voice.muted
    ? "MUTED"
    : voice.state === "listening"
      ? "LISTENING"
      : voice.state === "speaking"
        ? "SPEAKING"
        : voice.state === "thinking"
          ? "THINKING"
          : "LIVE";
  const metric = (event: string) =>
    voice.diagnostics.find((item) => item.event === event)?.elapsedMs;
  const metricValue = (event: string) => {
    const value = metric(event);
    return value === undefined ? "—" : `${value}ms`;
  };
  const labMetrics = [
    ["CONNECTION", metricValue("channel_open")],
    ["TURN RESPONSE", metricValue("response_created")],
    ["FIRST AUDIO", metricValue("first_audio")],
    ["LATEST TOOL", metricValue("tool_finished")],
    [
      "INTERRUPTIONS",
      String(
        voice.diagnostics.filter(
          (item) => item.event === "interruption_detected"
        ).length
      ),
    ],
  ];
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>TOOLED / VOICE</Text>
          <Text style={styles.identity}>{email}</Text>
        </View>
        <Pressable onPress={() => void supabase.auth.signOut()}>
          <Text style={styles.signout}>SIGN OUT</Text>
        </Pressable>
      </View>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor:
                voice.state === "error"
                  ? "#ff5d43"
                  : active
                    ? "#e8ff58"
                    : "#77796e",
            },
          ]}
        />
        <Text style={styles.status}>
          {voice.muted && active ? "MUTED" : labels[voice.state]}
        </Text>
        <Pressable
          accessibilityLabel="Toggle voice diagnostics"
          accessibilityRole="button"
          onPress={() => setShowDiagnostics((value) => !value)}
          style={styles.labButton}
        >
          <Text style={styles.labButtonText}>VOICE LAB</Text>
        </Pressable>
      </View>
      {showDiagnostics ? (
        <View style={styles.diagnostics}>
          <View style={styles.diagnosticsHeader}>
            <Text style={styles.diagnosticsTitle}>VOICE LAB / LIVE</Text>
            <Pressable onPress={() => setShowDiagnostics(false)}>
              <Text style={styles.diagnosticsClose}>CLOSE</Text>
            </Pressable>
          </View>
          <Text style={styles.diagnosticsSummary}>
            ROUTE {voice.route.toUpperCase()} · VAD{" "}
            {voice.vadEagerness.toUpperCase()}
          </Text>
          <View style={styles.metricGrid}>
            {labMetrics.map(([label, value]) => (
              <View key={label} style={styles.metricCell}>
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={styles.metricValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <ToolIntegrationControl />
      {voice.mcpApproval ? (
        <View accessibilityLiveRegion="assertive" style={styles.approval}>
          <Text style={styles.approvalEyebrow}>TOOL ACTION</Text>
          <Text style={styles.approvalTitle}>
            {friendlyToolName(voice.mcpApproval.name)}
          </Text>
          <Text style={styles.approvalBody}>
            {summarizeToolArguments(voice.mcpApproval.arguments)}
          </Text>
          <View style={styles.approvalActions}>
            <Pressable
              accessibilityLabel="Deny tool action"
              accessibilityRole="button"
              onPress={voice.rejectMcpAction}
              style={({ pressed }) => [
                styles.approvalSecondary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.approvalSecondaryText}>DENY</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Allow tool action"
              accessibilityRole="button"
              onPress={voice.approveMcpAction}
              style={({ pressed }) => [
                styles.approvalPrimary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.approvalPrimaryText}>ALLOW</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.historyContent}
        onContentSizeChange={() =>
          history.current?.scrollToEnd({ animated: true })
        }
        ref={history}
        style={styles.history}
      >
        {voice.history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIndex}>01</Text>
            <Text style={styles.emptyTitle}>
              {active ? "Live line open." : "Start a live voice."}
              {"\n"}
              {active ? "Just start talking." : "Stay in the conversation."}
            </Text>
            <Text style={styles.emptyBody}>
              {active
                ? "Speak naturally, pause when you are done, and interrupt at any time."
                : "Connect once for a continuous, hands-free conversation with your tools."}
            </Text>
          </View>
        ) : (
          voice.history.map((item) => (
            <View
              key={item.id}
              style={[
                styles.line,
                item.role === "assistant" && styles.assistant,
              ]}
            >
              <Text style={styles.role}>
                {item.role === "user" ? "YOU" : "VOICE"}
              </Text>
              <Text style={styles.transcript}>{item.text}</Text>
            </View>
          ))
        )}
      </ScrollView>
      {voice.error ? <Text style={styles.error}>{voice.error}</Text> : null}
      <View style={styles.controls}>
        {active ? (
          <>
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.liveOrb,
                voice.state === "speaking" && styles.liveOrbSpeaking,
                voice.muted && styles.liveOrbMuted,
              ]}
            >
              <View
                style={[styles.liveCore, voice.muted && styles.liveCoreMuted]}
              >
                <Text
                  style={[styles.liveText, voice.muted && styles.liveTextMuted]}
                >
                  {liveLabel}
                </Text>
              </View>
            </View>
            <View style={styles.liveActions}>
              <Pressable
                accessibilityLabel={
                  voice.muted ? "Unmute microphone" : "Mute microphone"
                }
                accessibilityRole="button"
                onPress={voice.toggleMuted}
                style={({ pressed }) => [
                  styles.liveAction,
                  voice.muted && styles.liveActionActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.liveActionText,
                    voice.muted && styles.liveActionTextActive,
                  ]}
                >
                  {voice.muted ? "UNMUTE" : "MUTE"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={
                  voice.speaker ? "Use earpiece" : "Use speaker"
                }
                accessibilityRole="button"
                onPress={voice.toggleSpeaker}
                style={({ pressed }) => [
                  styles.liveAction,
                  voice.speaker && styles.liveActionActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.liveActionText,
                    voice.speaker && styles.liveActionTextActive,
                  ]}
                >
                  {voice.speaker ? "SPEAKER" : "EARPIECE"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="End live voice session"
                accessibilityRole="button"
                onPress={voice.disconnect}
                style={({ pressed }) => [
                  styles.liveAction,
                  styles.endAction,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.endActionText}>END</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityLabel="Toggle voice response speed"
              accessibilityRole="button"
              onPress={voice.toggleVadEagerness}
            >
              <Text style={styles.vadToggle}>
                TURN SPEED ·{" "}
                {voice.vadEagerness === "high" ? "FAST" : "NATURAL"}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityLabel="Start live voice"
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void voice.connect()}
            style={[styles.connect, pending && styles.primaryDisabled]}
          >
            <Text style={styles.connectText}>
              {pending ? "OPENING LIVE LINE…" : "START LIVE VOICE"}
            </Text>
          </Pressable>
        )}
        <Text style={styles.hint}>
          {active
            ? voice.muted
              ? "MICROPHONE OFF · TAP UNMUTE TO CONTINUE"
              : "LIVE MIC · SPEAK NATURALLY · INTERRUPT ANY TIME"
            : "ONE CONNECTION · CONTINUOUS CONVERSATION"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const ink = "#f0f1e8",
  base = "#11130e",
  acid = "#e8ff58",
  muted = "#9b9d91";
const styles = StyleSheet.create({
  approval: {
    backgroundColor: "#191b15",
    borderColor: acid,
    borderWidth: 1,
    elevation: 14,
    left: 14,
    padding: 18,
    position: "absolute",
    right: 14,
    shadowColor: "#000",
    shadowOpacity: 0.75,
    shadowRadius: 20,
    top: 150,
    zIndex: 12,
  },
  approvalActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  approvalBody: { color: muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  approvalEyebrow: {
    color: acid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
  },
  approvalPrimary: {
    alignItems: "center",
    backgroundColor: acid,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  approvalPrimaryText: {
    color: base,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  approvalSecondary: {
    alignItems: "center",
    borderColor: "#74443c",
    borderWidth: 1,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  approvalSecondaryText: {
    color: "#ff765f",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  approvalTitle: {
    color: ink,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29,
    marginTop: 10,
  },
  assistant: { paddingLeft: 28 },
  authContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingBottom: 24,
    paddingTop: 52,
  },
  authContentKeyboard: {
    gap: 18,
    justifyContent: "flex-start",
    paddingBottom: 16,
    paddingTop: 14,
  },
  authKeyboard: { flex: 1 },
  authScroll: { flex: 1 },
  connect: {
    alignItems: "center",
    borderColor: acid,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: "100%",
  },
  connectText: { color: acid, fontWeight: "900", letterSpacing: 2 },
  controls: { alignItems: "center", paddingBottom: 22 },
  diagnostics: {
    backgroundColor: "#191b15",
    borderColor: acid,
    borderWidth: 1,
    elevation: 12,
    left: 14,
    padding: 14,
    position: "absolute",
    right: 14,
    shadowColor: "#000",
    shadowOpacity: 0.7,
    shadowRadius: 18,
    top: 118,
    zIndex: 10,
  },
  diagnosticsClose: {
    color: muted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.2,
    padding: 5,
  },
  diagnosticsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  diagnosticsSummary: {
    color: ink,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 7,
    marginTop: 9,
  },
  diagnosticsTitle: {
    color: acid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  dot: { borderRadius: 4, height: 8, width: 8 },
  empty: {
    borderColor: "#303229",
    borderTopWidth: 1,
    flex: 1,
    justifyContent: "center",
  },
  emptyBody: {
    color: muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 18,
    maxWidth: 290,
  },
  emptyIndex: { color: acid, fontSize: 12, fontWeight: "800" },
  emptyTitle: {
    color: ink,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1.1,
    lineHeight: 41,
    marginTop: 14,
  },
  endAction: { borderColor: "#74443c" },
  endActionText: {
    color: "#ff765f",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  error: { color: "#ff765f", fontSize: 13, lineHeight: 18 },
  eyebrow: { color: acid, fontSize: 11, fontWeight: "800", letterSpacing: 2.8 },
  form: { flexShrink: 0, gap: 12 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 22,
  },
  hero: { flexShrink: 0 },
  heroKeyboard: {
    borderBottomWidth: 1,
    borderColor: "#303229",
    flexShrink: 0,
    paddingBottom: 16,
  },
  hint: {
    color: "#77796e",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginTop: 16,
  },
  history: { flex: 1, marginTop: 10 },
  historyContent: { flexGrow: 1, paddingVertical: 24 },
  identity: { color: muted, fontSize: 11, marginTop: 8 },
  input: {
    borderBottomWidth: 1,
    borderColor: "#5a5c52",
    color: ink,
    fontSize: 16,
    height: 54,
    letterSpacing: 1.3,
    paddingHorizontal: 0,
  },
  intro: { color: muted, fontSize: 17, marginTop: 18 },
  labButton: {
    borderColor: "#5a5c52",
    borderWidth: 1,
    marginLeft: "auto",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  labButtonText: {
    color: muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  line: {
    borderColor: "#303229",
    borderTopWidth: 1,
    paddingRight: 34,
    paddingVertical: 20,
  },
  liveAction: {
    alignItems: "center",
    borderColor: "#5a5c52",
    borderWidth: 1,
    flex: 1,
    height: 42,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  liveActionActive: { borderColor: acid },
  liveActions: { flexDirection: "row", gap: 8, marginTop: 14, width: "100%" },
  liveActionText: {
    color: ink,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  liveActionTextActive: { color: acid },
  liveCore: {
    alignItems: "center",
    backgroundColor: acid,
    borderRadius: 49,
    height: 98,
    justifyContent: "center",
    width: 98,
  },
  liveCoreMuted: { backgroundColor: "#303229" },
  liveOrb: {
    alignItems: "center",
    borderColor: acid,
    borderRadius: 63,
    borderWidth: 1,
    height: 126,
    justifyContent: "center",
    width: 126,
  },
  liveOrbMuted: { borderColor: "#5a5c52" },
  liveOrbSpeaking: { borderWidth: 4 },
  liveText: {
    color: base,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  liveTextMuted: { color: muted },
  loading: {
    alignItems: "center",
    backgroundColor: base,
    flex: 1,
    justifyContent: "center",
  },
  metricCell: {
    borderBottomWidth: 1,
    borderColor: "#303229",
    borderRightWidth: 1,
    padding: 10,
    width: "50%",
  },
  metricGrid: {
    borderColor: "#303229",
    borderLeftWidth: 1,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metricLabel: {
    color: muted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  metricValue: { color: ink, fontSize: 17, fontWeight: "800", marginTop: 4 },
  pressed: { opacity: 0.72 },
  primary: {
    alignItems: "center",
    backgroundColor: acid,
    height: 56,
    justifyContent: "center",
    marginTop: 10,
  },
  primaryDisabled: { opacity: 0.38 },
  primaryText: {
    color: base,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  role: {
    color: acid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },
  safe: { backgroundColor: base, flex: 1, paddingHorizontal: 22 },
  secondary: {
    color: ink,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    padding: 11,
    textAlign: "center",
  },
  signout: {
    color: muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  status: { color: ink, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    marginTop: 34,
  },
  title: {
    color: ink,
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 56,
    marginTop: 24,
  },
  titleKeyboard: {
    color: ink,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 30,
    marginTop: 8,
  },
  transcript: { color: ink, fontSize: 18, lineHeight: 27 },
  vadToggle: {
    color: "#77796e",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.1,
    paddingTop: 12,
  },
});

function friendlyToolName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function summarizeToolArguments(raw: string) {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const summary = Object.entries(value)
      .slice(0, 4)
      .map(
        ([key, item]) =>
          `${friendlyToolName(key)}: ${typeof item === "string" ? item : JSON.stringify(item)}`
      )
      .join("\n");
    return summary || "Allow this change in your Linear workspace?";
  } catch {
    return "Allow this change in your Linear workspace?";
  }
}
