import { openAuthSessionAsync } from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  beginToolConnection,
  getToolConnections,
  getToolkitTools,
  searchToolCatalog,
  setToolApprovalPolicy,
  setToolkitPreferences,
  type ToolAccount,
  type ToolApprovalPolicy,
  type ToolConnection,
  type ToolSettings,
  updateToolAccount,
} from "../api/client";

const integrationCallbackUrl = "tooledvoice://integrations/composio";

const toolkitPrefixPattern = /^[A-Z]+_/;

const underscorePattern = /_/g;

const firstCharacterPattern = /^./;

export function ToolIntegrationControl() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [accounts, setAccounts] = useState<ToolAccount[]>([]);
  const [settings, setSettings] = useState<ToolSettings>({});

  const [approvalPolicy, setApprovalPolicy] =
    useState<ToolApprovalPolicy>("ask");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionMessage, setConnectionMessage] = useState<string>();

  const refresh = useCallback(async () => {
    const state = await getToolConnections();

    setConfigured(state.configured);
    setConnections(state.connections);
    setAccounts(state.accounts);
    setSettings(state.settings);
    setApprovalPolicy(state.approvalPolicy);
    setError(undefined);

    return state;
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(message(reason)));

    const restoreInitialConnection = async () => {
      try {
        const value = await Linking.getInitialURL();

        if (value?.startsWith(integrationCallbackUrl)) {
          setOpen(true);

          setConnectionMessage(
            "Connection returned. Refreshing account status…"
          );

          await refresh();
          setConnectionMessage("Account status refreshed.");
        }
      } catch (reason) {
        setError(message(reason));
      }
    };

    restoreInitialConnection().catch((reason) => setError(message(reason)));
  }, [refresh]);

  const connected =
    accounts.filter((account) => account.active).length ||
    connections.filter((connection) => connection.connected).length;

  const openManager = useCallback(() => setOpen(true), []);
  const closeManager = useCallback(() => setOpen(false), []);

  return (
    <>
      <Pressable
        accessibilityLabel="Manage connected tools"
        accessibilityRole="button"
        onPress={openManager}
        style={launchStyle}
      >
        <View>
          <Text style={styles.eyebrow}>TOOLS / CONNECTIONS</Text>
          <Text style={styles.launchTitle}>
            {connected
              ? `${connected} connection${connected === 1 ? "" : "s"} live`
              : "Connect your tools"}
          </Text>
        </View>
        <Text style={styles.launchAction}>MANAGE →</Text>
      </Pressable>
      <Modal animationType="slide" onRequestClose={closeManager} visible={open}>
        <ToolManager
          accounts={accounts}
          approvalPolicy={approvalPolicy}
          busy={busy}
          configured={configured}
          connectionMessage={connectionMessage}
          connections={connections}
          error={error}
          onClose={closeManager}
          onRefresh={refresh}
          setApprovalPolicy={setApprovalPolicy}
          setBusy={setBusy}
          setConnectionMessage={setConnectionMessage}
          setError={setError}
          setSettings={setSettings}
          settings={settings}
        />
      </Modal>
    </>
  );
}

function ToolManager(props: {
  configured: boolean;
  connections: ToolConnection[];
  accounts: ToolAccount[];
  settings: ToolSettings;
  approvalPolicy: ToolApprovalPolicy;
  busy: boolean;
  error: string | undefined;
  connectionMessage: string | undefined;
  onClose: () => void;
  onRefresh: () => Promise<{
    connections: ToolConnection[];
    accounts: ToolAccount[];
  }>;
  setBusy: (value: boolean) => void;
  setError: (value: string | undefined) => void;
  setConnectionMessage: (value: string | undefined) => void;
  setApprovalPolicy: (value: ToolApprovalPolicy) => void;
  setSettings: (value: ToolSettings) => void;
}) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ToolConnection[]>(props.connections);
  const [selected, setSelected] = useState<ToolConnection>();

  const [tools, setTools] = useState<
    Array<{ slug: string; description: string }>
  >([]);

  const [toolsBusy, setToolsBusy] = useState(false);

  useEffect(() => {
    if (!props.configured) {
      setCatalog(props.connections);

      return;
    }

    const timer = setTimeout(() => {
      searchToolCatalog(query.trim())
        .then((result) => setCatalog(result.items))
        .catch((reason) => props.setError(message(reason)));
    }, 250);

    return () => clearTimeout(timer);
  }, [query, props.configured, props.connections, props.setError]);

  const selectedAccounts = useMemo(
    () =>
      selected
        ? props.accounts.filter(
            (account) =>
              account.toolkit.toLowerCase() === selected.slug.toLowerCase()
          )
        : [],
    [props.accounts, selected]
  );

  const setting = useMemo(
    () => (selected ? (props.settings[selected.slug] ?? {}) : {}),
    [props.settings, selected]
  );

  const disabled = useMemo(
    () => new Set(setting.disabledTools ?? []),
    [setting.disabledTools]
  );

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      props.setBusy(true);
      props.setError(undefined);

      try {
        await action();
        await props.onRefresh();
      } catch (reason) {
        props.setError(message(reason));
      } finally {
        props.setBusy(false);
      }
    },
    [props]
  );

  const connect = useCallback(
    async (toolkit: string) => {
      props.setBusy(true);
      props.setError(undefined);
      props.setConnectionMessage("Waiting for authentication in your browser…");

      try {
        const { authorizationUrl, connectionId } =
          await beginToolConnection(toolkit);

        const result = await openAuthSessionAsync(
          authorizationUrl,
          integrationCallbackUrl,
          {
            enableDefaultShareMenuItem: false,
            secondaryToolbarColor: base,
            showTitle: true,
            toolbarColor: base,
          }
        );

        props.setConnectionMessage(
          result.type === "success"
            ? "Authentication returned. Checking account status…"
            : "Checking whether the connection completed…"
        );

        const state = await props.onRefresh();

        const account = connectionId
          ? state.accounts.find((candidate) => candidate.id === connectionId)
          : undefined;

        const toolkitConnected = state.connections.some(
          (candidate) => candidate.slug === toolkit && candidate.connected
        );

        if (account?.active || (!connectionId && toolkitConnected)) {
          props.setConnectionMessage("Connection complete.");
        } else if (
          account &&
          ["FAILED", "EXPIRED", "REVOKED"].includes(account.status)
        ) {
          props.setConnectionMessage(
            `Connection failed: ${account.status.toLowerCase()}. Try again when ready.`
          );
        } else if (result.type === "success") {
          props.setConnectionMessage(
            "Authentication returned, but the connection is still pending."
          );
        } else {
          props.setConnectionMessage(
            "Connection was not completed. You can try again when ready."
          );
        }
      } catch (reason) {
        props.setConnectionMessage(undefined);
        props.setError(message(reason));
      } finally {
        props.setBusy(false);
      }
    },
    [props]
  );

  const choose = useCallback(
    async (connection: ToolConnection) => {
      setSelected(connection);
      setTools([]);

      if (!props.configured) {
        return;
      }

      setToolsBusy(true);

      try {
        setTools((await getToolkitTools(connection.slug)).tools);
      } catch (reason) {
        props.setError(message(reason));
      } finally {
        setToolsBusy(false);
      }
    },
    [props.configured, props.setError]
  );

  const save = useCallback(
    async (patch: Partial<Required<typeof setting>>) => {
      if (!selected) {
        return;
      }

      const next = {
        approvalPolicy:
          patch.approvalPolicy ??
          setting.approvalPolicy ??
          props.approvalPolicy,
        connectedAccountIds:
          patch.connectedAccountIds ??
          setting.connectedAccountIds ??
          selectedAccounts
            .filter((account) => account.active)
            .map((account) => account.id),
        disabledTools: patch.disabledTools ?? setting.disabledTools ?? [],
        enabled: patch.enabled ?? setting.enabled ?? true,
      };

      props.setSettings({ ...props.settings, [selected.slug]: next });
      await run(() => setToolkitPreferences(selected.slug, next));
    },
    [props, run, selected, selectedAccounts, setting]
  );

  const activeAccounts = selectedAccounts.filter((account) => account.active);

  const pendingAccounts = selectedAccounts.filter(
    (account) => account.status === "INITIATED"
  );

  let connectionStatus = "NOT CONNECTED";
  let connectLabel = "CONNECT ACCOUNT";

  if (activeAccounts.length) {
    connectionStatus = `${activeAccounts.length} ACCOUNT${activeAccounts.length === 1 ? "" : "S"} LIVE`;
    connectLabel = "ADD ANOTHER ACCOUNT";
  } else if (pendingAccounts.length) {
    connectionStatus = "CONNECTION PENDING";
    connectLabel = "TRY CONNECTION AGAIN";
  }

  const clearSelection = useCallback(() => setSelected(undefined), []);

  const connectSelected = useCallback(
    () => (selected ? connect(selected.slug) : Promise.resolve()),
    [connect, selected]
  );

  const toggleEnabled = useCallback(
    () => save({ enabled: setting.enabled === false }),
    [save, setting.enabled]
  );

  const requireApproval = useCallback(
    () => save({ approvalPolicy: "ask" }),
    [save]
  );

  const allowChanges = useCallback(
    () => save({ approvalPolicy: "automatic" }),
    [save]
  );

  const setDefaultApproval = useCallback(
    (approvalPolicy: ToolApprovalPolicy) =>
      run(async () => {
        const result = await setToolApprovalPolicy(approvalPolicy);

        props.setApprovalPolicy(result.approvalPolicy);
      }),
    [props.setApprovalPolicy, run]
  );

  const requireDefaultApproval = useCallback(
    () => setDefaultApproval("ask"),
    [setDefaultApproval]
  );

  const allowDefaultChanges = useCallback(
    () => setDefaultApproval("automatic"),
    [setDefaultApproval]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View>
          <Text style={styles.eyebrow}>TOOLED / DIRECTORY</Text>
          <Text style={styles.title}>Your tools.</Text>
        </View>
        <Pressable onPress={props.onClose}>
          <Text style={styles.close}>CLOSE</Text>
        </Pressable>
      </View>
      {props.connectionMessage ? (
        <View style={styles.connectionNotice}>
          <ActivityIndicator animating={props.busy} color={acid} size="small" />
          <Text style={styles.connectionNoticeText}>
            {props.connectionMessage}
          </Text>
        </View>
      ) : null}
      {selected ? (
        <ScrollView contentContainerStyle={styles.detail}>
          <Pressable onPress={clearSelection}>
            <Text style={styles.back}>← ALL TOOLS</Text>
          </Pressable>
          <Text style={styles.detailTitle}>{selected.name}</Text>
          <Text style={styles.detailMeta}>{connectionStatus}</Text>
          <Pressable
            disabled={props.busy}
            onPress={connectSelected}
            style={[styles.primary, props.busy && styles.primaryDisabled]}
          >
            <Text style={styles.primaryText}>{connectLabel}</Text>
          </Pressable>
          {selectedAccounts.map((account) => (
            <AccountRow
              account={account}
              key={account.id}
              run={run}
              toolkitName={selected.name}
            />
          ))}
          <Section label="AVAILABLE IN VOICE">
            <Choice
              active={setting.enabled !== false}
              label={setting.enabled === false ? "DISABLED" : "ENABLED"}
              onPress={toggleEnabled}
            />
          </Section>
          <Section label="CHANGES">
            <View style={styles.choices}>
              <Choice
                active={
                  (setting.approvalPolicy ?? props.approvalPolicy) === "ask"
                }
                label="ASK ME"
                onPress={requireApproval}
              />
              <Choice
                active={
                  (setting.approvalPolicy ?? props.approvalPolicy) ===
                  "automatic"
                }
                label="ALLOW"
                onPress={allowChanges}
              />
            </View>
          </Section>
          <Section label="TOOLS">
            <Text style={styles.hint}>
              Tap to include or exclude individual actions from new voice
              sessions.
            </Text>
            {toolsBusy ? (
              <ActivityIndicator color="#e8ff58" style={styles.loader} />
            ) : (
              tools.map((tool) => (
                <ToolRow
                  disabled={disabled.has(tool.slug)}
                  disabledTools={disabled}
                  key={tool.slug}
                  onError={props.setError}
                  save={save}
                  tool={tool}
                />
              ))
            )}
          </Section>
        </ScrollView>
      ) : (
        <>
          <View style={styles.policy}>
            <Text style={styles.policyLabel}>DEFAULT FOR CHANGES</Text>
            <View style={styles.choices}>
              <Choice
                active={props.approvalPolicy === "ask"}
                label="ASK ME"
                onPress={requireDefaultApproval}
              />
              <Choice
                active={props.approvalPolicy === "automatic"}
                label="ALLOW"
                onPress={allowDefaultChanges}
              />
            </View>
          </View>
          <TextInput
            autoCapitalize="none"
            onChangeText={setQuery}
            placeholder="SEARCH 1000+ SERVICES"
            placeholderTextColor="#62645a"
            style={styles.search}
            value={query}
          />
          <ScrollView contentContainerStyle={styles.catalog}>
            {catalog.map((connection) => (
              <CatalogRow
                connection={connection}
                key={connection.slug}
                select={choose}
              />
            ))}
          </ScrollView>
        </>
      )}
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </View>
  );
}

function AccountRow({
  account,
  run,
  toolkitName,
}: {
  account: ToolAccount;
  run: (action: () => Promise<unknown>) => Promise<void>;
  toolkitName: string;
}) {
  const reconnect = useCallback(
    () => run(() => updateToolAccount(account.id, "refresh")),
    [account.id, run]
  );

  const toggle = useCallback(
    () =>
      run(() =>
        updateToolAccount(account.id, account.active ? "disable" : "enable")
      ),
    [account.active, account.id, run]
  );

  return (
    <View style={styles.account}>
      <View>
        <Text style={styles.accountName}>
          {account.alias || `${toolkitName} account`}
        </Text>
        <Text style={[styles.accountStatus, account.active && styles.active]}>
          {account.status}
        </Text>
      </View>
      {account.status === "INITIATED" ? null : (
        <View style={styles.rowActions}>
          {account.active ? null : (
            <Pressable onPress={reconnect}>
              <Text style={styles.smallAction}>RECONNECT</Text>
            </Pressable>
          )}
          <Pressable onPress={toggle}>
            <Text style={styles.smallAction}>
              {account.active ? "PAUSE" : "ENABLE"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ToolRow({
  disabled,
  disabledTools,
  onError,
  save,
  tool,
}: {
  disabled: boolean;
  disabledTools: Set<string>;
  onError: (value: string | undefined) => void;
  save: (patch: { disabledTools: string[] }) => Promise<void>;
  tool: { slug: string; description: string };
}) {
  const toggle = useCallback(() => {
    const next = new Set(disabledTools);

    if (next.has(tool.slug)) {
      next.delete(tool.slug);
    } else {
      next.add(tool.slug);
    }

    return save({ disabledTools: [...next] }).catch((reason) =>
      onError(message(reason))
    );
  }, [disabledTools, onError, save, tool.slug]);

  return (
    <Pressable onPress={toggle} style={styles.toolRow}>
      <View style={[styles.check, !disabled && styles.checkActive]} />
      <View style={styles.toolCopy}>
        <Text style={styles.toolName}>{humanize(tool.slug)}</Text>
        <Text numberOfLines={2} style={styles.toolDescription}>
          {tool.description}
        </Text>
      </View>
    </Pressable>
  );
}

function CatalogRow({
  connection,
  select,
}: {
  connection: ToolConnection;
  select: (connection: ToolConnection) => Promise<void>;
}) {
  const choose = useCallback(() => select(connection), [connection, select]);

  return (
    <Pressable onPress={choose} style={styles.catalogRow}>
      <View>
        <Text style={styles.catalogName}>{connection.name}</Text>
        <Text
          style={[styles.catalogStatus, connection.connected && styles.active]}
        >
          {connection.connected ? "CONNECTED" : "AVAILABLE"}
        </Text>
      </View>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Choice({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const humanize = (value: string) =>
  value
    .replace(toolkitPrefixPattern, "")
    .replace(underscorePattern, " ")
    .toLowerCase()
    .replace(firstCharacterPattern, (letter) => letter.toUpperCase());

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "TOOLS_UNAVAILABLE";

const launchStyle = ({ pressed }: { pressed: boolean }) => [
  styles.launch,
  pressed && styles.pressed,
];

const acid = "#e8ff58",
  ink = "#f0f1e8",
  base = "#11130e",
  muted = "#929488",
  line = "#303229";

const styles = StyleSheet.create({
  account: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: line,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
  },
  accountName: { color: ink, fontSize: 13, fontWeight: "800" },
  accountStatus: {
    color: muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 4,
  },
  active: { color: acid },
  arrow: { color: acid, fontSize: 19 },
  back: {
    color: muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    paddingVertical: 18,
  },
  catalog: { paddingBottom: 40 },
  catalogName: { color: ink, fontSize: 17, fontWeight: "800" },
  catalogRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: line,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 67,
  },
  catalogStatus: {
    color: muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 5,
  },
  check: {
    borderColor: "#55574e",
    borderWidth: 1,
    height: 14,
    marginTop: 2,
    width: 14,
  },
  checkActive: { backgroundColor: acid, borderColor: acid },
  choice: {
    alignItems: "center",
    borderColor: "#55574e",
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 12,
  },
  choiceActive: { backgroundColor: "#25281d", borderColor: acid },
  choices: { flexDirection: "row", gap: 8 },
  choiceText: {
    color: muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  choiceTextActive: { color: acid },
  close: {
    color: muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
    padding: 8,
  },
  connectionNotice: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: line,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
  },
  connectionNoticeText: {
    color: muted,
    flex: 1,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    lineHeight: 15,
  },
  detail: { paddingBottom: 50 },
  detailMeta: {
    color: acid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 8,
  },
  detailTitle: {
    color: ink,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  error: {
    backgroundColor: "#211815",
    bottom: 18,
    color: "#ff765f",
    fontSize: 10,
    left: 20,
    padding: 10,
    position: "absolute",
    right: 20,
  },
  eyebrow: { color: acid, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  hint: { color: muted, fontSize: 11, lineHeight: 17, marginBottom: 8 },
  launch: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: line,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
    paddingVertical: 14,
  },
  launchAction: {
    color: muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  launchTitle: { color: ink, fontSize: 14, fontWeight: "800", marginTop: 5 },
  loader: { margin: 20 },
  policy: { borderBottomWidth: 1, borderColor: line, paddingVertical: 16 },
  policyLabel: {
    color: muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  pressed: { opacity: 0.65 },
  primary: {
    alignItems: "center",
    backgroundColor: acid,
    height: 50,
    justifyContent: "center",
    marginTop: 18,
  },
  primaryDisabled: { opacity: 0.55 },
  primaryText: {
    color: base,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  rowActions: { flexDirection: "row", gap: 14 },
  screen: {
    backgroundColor: base,
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  search: {
    borderBottomWidth: 1,
    borderColor: acid,
    color: ink,
    fontSize: 14,
    fontWeight: "700",
    height: 54,
    letterSpacing: 1.1,
  },
  section: {
    borderColor: line,
    borderTopWidth: 1,
    marginTop: 22,
    paddingTop: 18,
  },
  sectionLabel: {
    color: acid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 12,
  },
  smallAction: {
    color: acid,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  title: {
    color: ink,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -1.5,
    lineHeight: 45,
    marginTop: 10,
  },
  toolCopy: { flex: 1 },
  toolDescription: { color: muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  toolName: { color: ink, fontSize: 12, fontWeight: "800" },
  toolRow: {
    borderBottomWidth: 1,
    borderColor: line,
    flexDirection: "row",
    gap: 12,
    paddingVertical: 13,
  },
  top: {
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderColor: line,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 22,
  },
});
