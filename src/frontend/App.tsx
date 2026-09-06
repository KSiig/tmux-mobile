import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { themes } from "./themes";
import { reconnectDelayMs, shouldReconnect, socketsNeedReconnect } from "./reconnect";
import {
  isScrolledToLatest,
  scrollElementToLatest,
  shouldExitHistory
} from "./history-gesture";
import { attachTerminalGestures, cellFromPoint, encodeSgrWheel } from "./terminal-gestures";
import {
  applyModifiers as applyModifiersPure,
  clearStickyModifiers as clearStickyModifiersPure,
  type ModifierKey,
  type ModifierMode
} from "./modifiers";
import {
  readMousePreference,
  resolveMouseEnabled,
  writeMousePreference
} from "./mouse-preference";
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readFontSize,
  resolveFontSize,
  writeFontSize
} from "./font-size";
import {
  isPhoneMatch,
  readHintSeen,
  readImmersive,
  resolveImmersive,
  writeHintSeen,
  writeImmersive
} from "./immersive-mode";
import type {
  ControlServerMessage,
  TmuxPaneState,
  TmuxSessionState,
  TmuxSessionSummary,
  TmuxStateSnapshot,
  TmuxWindowState
} from "./types/protocol";

interface ServerConfig {
  passwordRequired: boolean;
  scrollbackLines: number;
  pollIntervalMs: number;
}


declare global {
  interface Window {
    __tmuxMobileDebugEvents?: Array<{
      at: string;
      event: string;
      payload?: unknown;
    }>;
    __tmuxMobileDebugState?: unknown;
    __tmuxMobileDebugSockets?: {
      control?: WebSocket;
      terminal?: WebSocket;
    };
  }
}

const query = new URLSearchParams(window.location.search);
const token = query.get("token") ?? "";
const debugMode = query.get("debug") === "1";

const wsOrigin = (() => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}`;
})();

const PHONE_MEDIA_QUERY = "(max-width: 768px), (pointer: coarse)";

const isPhoneViewport = (): boolean => window.matchMedia(PHONE_MEDIA_QUERY).matches;

const getInitialStickyZoom = (): boolean => {
  const stored = localStorage.getItem("tmux-mobile-sticky-zoom");
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return window.matchMedia("(max-width: 768px)").matches;
};

const parseMessage = (raw: string): ControlServerMessage | null => {
  try {
    return JSON.parse(raw) as ControlServerMessage;
  } catch {
    return null;
  }
};

const debugLog = (event: string, payload?: unknown): void => {
  if (!debugMode) {
    return;
  }
  const entry = {
    at: new Date().toISOString(),
    event,
    payload
  };
  const current = window.__tmuxMobileDebugEvents ?? [];
  current.push(entry);
  if (current.length > 500) {
    current.splice(0, current.length - 500);
  }
  window.__tmuxMobileDebugEvents = current;
  console.log("[tmux-mobile-debug]", entry.at, event, payload ?? "");
};

export const App = () => {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTransitionRef = useRef<boolean>(false);
  const controlSocketRef = useRef<WebSocket | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const passwordRef = useRef("");
  const needsPasswordRef = useRef(false);
  const unmountedRef = useRef(false);
  const hadConnectedRef = useRef(false);
  const terminalKeyboardEnabledRef = useRef(false);
  const authFailedRef = useRef(false);
  const socketGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const scheduleReconnectRef = useRef<
    (options: { immediate?: boolean; closeCode?: number; generation: number }) => void
  >(() => undefined);

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [password, setPassword] = useState(localStorage.getItem("tmux-mobile-password") ?? "");
  const [needsPasswordInput, setNeedsPasswordInput] = useState(false);
  const [passwordErrorMessage, setPasswordErrorMessage] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [connectionPhase, setConnectionPhase] = useState<"connecting" | "connected" | "reconnecting">(
    "connecting"
  );

  const [snapshot, setSnapshot] = useState<TmuxStateSnapshot>({ sessions: [], capturedAt: "" });
  const [attachedSession, setAttachedSession] = useState<string>("");
  const [sessionChoices, setSessionChoices] = useState<TmuxSessionSummary[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composeEnabled, setComposeEnabled] = useState(true);
  const [composeText, setComposeText] = useState("");

  const [scrollbackVisible, setScrollbackVisible] = useState(false);
  const [scrollbackText, setScrollbackText] = useState("");
  const [scrollbackLines, setScrollbackLines] = useState(1000);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyText, setHistoryText] = useState("");
  const [mouseEnabled, setMouseEnabled] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() =>
    resolveFontSize(readFontSize(localStorage), isPhoneViewport())
  );
  const fontSizeRef = useRef<number>(fontSize);
  const [immersive, setImmersiveState] = useState<boolean>(() =>
    resolveImmersive(readImmersive(localStorage), isPhoneViewport())
  );
  const immersiveRef = useRef<boolean>(immersive);
  const immersiveInitializedRef = useRef<boolean>(false);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const immersiveHandleRef = useRef<HTMLButtonElement | null>(null);
  const immersiveCloseRef = useRef<HTMLButtonElement | null>(null);
  const immersiveHintRef = useRef<HTMLDivElement | null>(null);
  const immersiveHintTimerRef = useRef<number | null>(null);
  const historyPreRef = useRef<HTMLPreElement | null>(null);
  const historyGestureRef = useRef<{ x: number; y: number } | null>(null);
  const mouseEnabledRef = useRef(false);
  const historyVisibleRef = useRef(false);
  const scrollbackVisibleRef = useRef(false);
  const activePaneRef = useRef<TmuxPaneState | undefined>(undefined);
  const mousePreferenceAppliedRef = useRef(false);

  const [modifiers, setModifiers] = useState<Record<ModifierKey, ModifierMode>>({
    ctrl: "off",
    alt: "off",
    shift: "off",
    meta: "off"
  });
  const modifierTapRef = useRef<{ key: ModifierKey; at: number } | null>(null);

  const [theme, setTheme] = useState(localStorage.getItem("tmux-mobile-theme") ?? "midnight");
  const [toolbarExpanded, setToolbarExpanded] = useState(
    localStorage.getItem("tmux-mobile-toolbar-expanded") === "true"
  );
  const [toolbarDeepExpanded, setToolbarDeepExpanded] = useState(false);
  const [stickyZoom, setStickyZoom] = useState(getInitialStickyZoom);

  const activeSession: TmuxSessionState | undefined = useMemo(() => {
    const selected = snapshot.sessions.find((session) => session.name === attachedSession);
    if (selected) {
      return selected;
    }
    return snapshot.sessions.find((session) => session.attached) ?? snapshot.sessions[0];
  }, [snapshot.sessions, attachedSession]);

  const activeWindow: TmuxWindowState | undefined = useMemo(() => {
    if (!activeSession) {
      return undefined;
    }
    return activeSession.windowStates.find((window) => window.active) ?? activeSession.windowStates[0];
  }, [activeSession]);

  const activePane: TmuxPaneState | undefined = useMemo(() => {
    if (!activeWindow) {
      return undefined;
    }
    return activeWindow.panes.find((pane) => pane.active) ?? activeWindow.panes[0];
  }, [activeWindow]);

  const topStatus = useMemo(() => {
    if (errorMessage) {
      return { kind: "error", label: errorMessage };
    }
    if (statusMessage.toLowerCase().includes("disconnected")) {
      return { kind: "warn", label: statusMessage };
    }
    if (statusMessage.toLowerCase().includes("connected")) {
      return { kind: "ok", label: statusMessage };
    }
    if (statusMessage) {
      return { kind: "pending", label: statusMessage };
    }
    if (authReady) {
      return { kind: "ok", label: "connected" };
    }
    return { kind: "pending", label: "connecting" };
  }, [authReady, errorMessage, statusMessage]);

  const sendControl = (payload: Record<string, unknown>): void => {
    if (controlSocketRef.current?.readyState !== WebSocket.OPEN) {
      debugLog("send_control.blocked", {
        payload,
        readyState: controlSocketRef.current?.readyState
      });
      setErrorMessage("control websocket disconnected");
      return;
    }
    setErrorMessage("");
    debugLog("send_control", payload);
    controlSocketRef.current.send(JSON.stringify(payload));
  };

  const clearStickyModifiers = (): void => {
    setModifiers((previous) => clearStickyModifiersPure(previous));
  };

  const applyModifiers = (input: string): string => {
    const { output, consumedSticky } = applyModifiersPure(modifiers, input);
    if (consumedSticky) {
      clearStickyModifiers();
    }
    return output;
  };

  // xterm.js's `onData` subscription lives for the entire component lifetime.
  // The subscription is registered inside a useEffect with empty deps so it
  // captures the initial-render `sendTerminal` closure, which in turn captures
  // the initial `modifiers` state. Route every call through these refs so the
  // subscription always sees the latest closure (and therefore the latest
  // active modifier toggles).
  const sendTerminalRef = useRef<(input: string, withModifiers?: boolean) => void>(
    () => {}
  );
  const sendTerminalResizeRef = useRef<() => void>(() => {});

  const sendTerminal = (input: string, withModifiers = true): void => {
    const socket = terminalSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      debugLog("send_terminal.blocked", {
        readyState: socket?.readyState,
        withModifiers,
        bytes: input.length
      });
      return;
    }
    const output = withModifiers ? applyModifiers(input) : input;
    debugLog("send_terminal", { withModifiers, inputBytes: input.length, outputBytes: output.length });
    socket.send(output);
  };

  const sendTerminalResize = (): void => {
    const socket = terminalSocketRef.current;
    const terminal = terminalRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !terminal) {
      debugLog("send_terminal_resize.blocked", {
        socketReadyState: socket?.readyState,
        hasTerminal: Boolean(terminal)
      });
      return;
    }
    const last = lastSentResizeRef.current;
    if (last && last.cols === terminal.cols && last.rows === terminal.rows) {
      debugLog("send_terminal_resize.deduped", { cols: terminal.cols, rows: terminal.rows });
      return;
    }
    debugLog("send_terminal_resize", { cols: terminal.cols, rows: terminal.rows });
    socket.send(
      JSON.stringify({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows
      })
    );
    lastSentResizeRef.current = { cols: terminal.cols, rows: terminal.rows };
  };

  // Keep the refs pointing at the latest closures so the xterm subscription
  // (registered once on mount) can route through the current state. Done in
  // a useLayoutEffect (not inline during render) so that an interrupted
  // render in React's concurrent mode cannot leak an uncommitted closure.
  useLayoutEffect(() => {
    sendTerminalRef.current = sendTerminal;
    sendTerminalResizeRef.current = sendTerminalResize;
  });

  const toggleModifier = (key: ModifierKey): void => {
    const now = Date.now();
    const isDoubleTap =
      modifierTapRef.current &&
      modifierTapRef.current.key === key &&
      now - modifierTapRef.current.at <= 300;

    modifierTapRef.current = { key, at: now };

    setModifiers((previous) => {
      const current = previous[key];
      let next: ModifierMode;

      if (current === "locked") {
        next = "off";
      } else if (isDoubleTap) {
        next = "locked";
      } else {
        next = current === "sticky" ? "off" : "sticky";
      }

      return {
        ...previous,
        [key]: next
      };
    });
  };

  const requestScrollback = (lines: number, intent: "overlay" | "history" = "overlay"): void => {
    if (!activePane) {
      return;
    }
    setScrollbackLines(lines);
    sendControl({ type: "capture_scrollback", paneId: activePane.id, lines, intent });
  };

  const requestHistory = (): void => {
    const pane = activePaneRef.current;
    if (!pane) {
      return;
    }
    sendControl({
      type: "capture_scrollback",
      paneId: pane.id,
      lines: serverConfig?.scrollbackLines ?? 1000,
      intent: "history"
    });
  };

  const toggleMouse = (): void => {
    if (!attachedSession) {
      return;
    }
    const next = !mouseEnabled;
    writeMousePreference(localStorage, next);
    setMouseEnabled(next);
    if (next) {
      setHistoryVisible(false);
    }
    sendControl({ type: "set_mouse", enabled: next });
  };

  const changeFontSize = (delta: number): void => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    const next = Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, fontSizeRef.current + delta)
    );
    if (next === fontSizeRef.current) {
      return;
    }
    writeFontSize(localStorage, next);
    setFontSize(next);
    fontSizeRef.current = next;
    terminal.options.fontSize = next;
    fitAddon.fit();
    sendTerminalResize();
  };

  const setImmersive = (next: boolean): void => {
    if (immersiveRef.current === next) {
      return;
    }
    // Suppress PTY resize messages emitted from the existing ResizeObserver
    // callback while the chrome-driven layout change is settling. The
    // explicit rAF refit inside the immersive effect owns the single
    // resize message for this transition. Clear the flag once the layout
    // has settled so subsequent genuine resizes (orientation, viewport)
    // continue to flow through.
    debugLog("setImmersive", { next });
    resizeTransitionRef.current = true;
    let cleared = false;
    const clearFlag = (): void => {
      if (cleared) {
        return;
      }
      cleared = true;
      resizeTransitionRef.current = false;
      debugLog("setImmersive.clearedTransition");
    };
    // Clear after a generous window so the existing ResizeObserver does
    // not fire duplicate resize messages for the in-flight layout change.
    // Genuine viewport/orientation resizes that arrive while the flag is
    // set are deferred -- the xterm on-screen size will be re-fitted on
    // the next genuine window resize.
    window.setTimeout(clearFlag, 1000);
    setImmersiveState(next);
  };

  const onTerminalHostPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    // Exclude taps that landed on the xterm synthetic input textarea so
    // they do not both hide chrome and type a character.
    const targetIsHelperTextarea =
      target?.classList.contains("xterm-helper-textarea") ?? false;
    if (targetIsHelperTextarea) {
      return;
    }
    event.stopPropagation();
    if (!immersiveRef.current) {
      setImmersive(true);
    }
  };

  const onTerminalHostKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && immersiveRef.current) {
      event.stopPropagation();
      setImmersive(false);
      immersiveHandleRef.current?.focus();
    }
  };

  const onImmersiveHandleActivate = (): void => setImmersive(false);

  const onImmersiveHandleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setImmersive(false);
    }
  };

  const onImmersiveHintDismiss = (): void => {
    writeHintSeen(localStorage, true);
    if (immersiveHintRef.current) {
      immersiveHintRef.current.dataset.visible = "false";
    }
    if (immersiveHintTimerRef.current !== null) {
      window.clearTimeout(immersiveHintTimerRef.current);
      immersiveHintTimerRef.current = null;
    }
  };

  const formatPasswordError = (reason: string): string => {
    if (reason === "invalid password") {
      return "Wrong password. Try again.";
    }
    return reason;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const markConnected = (): void => {
    reconnectAttemptRef.current = 0;
    setConnectionPhase("connected");
    setStatusMessage("terminal connected");
  };

  const openTerminalSocket = (passwordValue: string, clientId: string, generation: number): void => {
    debugLog("terminal_socket.open.begin", { hasPassword: Boolean(passwordValue) });
    terminalSocketRef.current?.close();

    const socket = new WebSocket(`${wsOrigin}/ws/terminal`);
    socket.onopen = () => {
      debugLog("terminal_socket.onopen");
      if (hadConnectedRef.current) {
        terminalRef.current?.reset();
      }
      socket.send(
        JSON.stringify({ type: "auth", token, password: passwordValue || undefined, clientId })
      );
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
      }
      sendTerminalResize();
      hadConnectedRef.current = true;
      markConnected();
    };

    socket.onmessage = (event) => {
      debugLog("terminal_socket.onmessage", {
        type: typeof event.data,
        bytes: typeof event.data === "string" ? event.data.length : 0
      });
      terminalRef.current?.write(typeof event.data === "string" ? event.data : "");
    };

    socket.onclose = (event) => {
      debugLog("terminal_socket.onclose", { code: event.code, reason: event.reason });
      if (event.code === 4001) {
        authFailedRef.current = true;
        setErrorMessage("terminal authentication failed");
      }
      setStatusMessage("terminal disconnected");
      scheduleReconnectRef.current({ closeCode: event.code, generation });
    };
    socket.onerror = () => {
      debugLog("terminal_socket.onerror");
      setErrorMessage("terminal websocket error");
    };

    terminalSocketRef.current = socket;
    if (debugMode) {
      window.__tmuxMobileDebugSockets = {
        ...(window.__tmuxMobileDebugSockets ?? {}),
        terminal: socket
      };
    }
  };

  const openControlSocket = (passwordValue: string): void => {
    debugLog("control_socket.open.begin", { hasPassword: Boolean(passwordValue) });
    clearReconnectTimer();
    const generation = ++socketGenerationRef.current;
    controlSocketRef.current?.close();
    terminalSocketRef.current?.close();

    const socket = new WebSocket(`${wsOrigin}/ws/control`);

    socket.onopen = () => {
      debugLog("control_socket.onopen");
      socket.send(JSON.stringify({ type: "auth", token, password: passwordValue || undefined }));
    };

    socket.onmessage = (event) => {
      debugLog("control_socket.onmessage.raw", { bytes: String(event.data).length });
      const message = parseMessage(String(event.data));
      if (!message) {
        debugLog("control_socket.onmessage.parse_error", { raw: String(event.data) });
        return;
      }
      debugLog("control_socket.onmessage", { type: message.type });

      switch (message.type) {
        case "auth_ok":
          debugLog("control_socket.auth_ok", {
            clientId: message.clientId,
            requiresPassword: message.requiresPassword
          });
          setErrorMessage("");
          setPasswordErrorMessage("");
          setAuthReady(true);
          setNeedsPasswordInput(false);
          authFailedRef.current = false;
          if (message.requiresPassword && passwordValue) {
            localStorage.setItem("tmux-mobile-password", passwordValue);
          } else {
            localStorage.removeItem("tmux-mobile-password");
          }
          openTerminalSocket(passwordValue, message.clientId, generation);
          return;
        case "auth_error":
          debugLog("control_socket.auth_error", { reason: message.reason });
          setErrorMessage(message.reason);
          setAuthReady(false);
          authFailedRef.current = true;
          const passwordAuthFailed =
            message.reason === "invalid password" || Boolean(serverConfig?.passwordRequired);
          if (passwordAuthFailed) {
            setNeedsPasswordInput(true);
            setPasswordErrorMessage(formatPasswordError(message.reason));
            localStorage.removeItem("tmux-mobile-password");
          }
          return;
        case "attached":
          debugLog("control_socket.attached", { session: message.session });
          mousePreferenceAppliedRef.current = false;
          setAttachedSession(message.session);
          setSessionChoices(null);
          setDrawerOpen(false);
          setStatusMessage(`attached: ${message.session}`);
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
          sendTerminalResize();
          return;
        case "session_picker":
          debugLog("control_socket.session_picker", {
            sessions: message.sessions.map((session) => ({
              name: session.name,
              attached: session.attached,
              windows: session.windows
            }))
          });
          setSessionChoices(message.sessions);
          return;
        case "tmux_state":
          debugLog("control_socket.tmux_state", {
            capturedAt: message.state.capturedAt,
            sessionCount: message.state.sessions.length,
            sessions: message.state.sessions.map((session) => {
              const activeWindow =
                session.windowStates.find((windowState) => windowState.active) ?? session.windowStates[0];
              const activePane = activeWindow?.panes.find((pane) => pane.active) ?? activeWindow?.panes[0];
              return {
                name: session.name,
                attached: session.attached,
                activeWindow: activeWindow ? `${activeWindow.index}:${activeWindow.name}` : null,
                activePane: activePane?.id ?? null,
                activePaneZoomed: activePane?.zoomed ?? null
              };
            })
          });
          setSnapshot(message.state);
          return;
        case "scrollback":
          debugLog("control_socket.scrollback", {
            paneId: message.paneId,
            lines: message.lines,
            bytes: message.text.length,
            intent: message.intent
          });
          if (message.intent === "history") {
            setHistoryText(message.text);
            setHistoryVisible(true);
            setScrollbackVisible(false);
            return;
          }
          setScrollbackText(message.text);
          setScrollbackVisible(true);
          return;
        case "mouse":
          debugLog("control_socket.mouse", { enabled: message.enabled });
          if (!mousePreferenceAppliedRef.current) {
            mousePreferenceAppliedRef.current = true;
            const stored = readMousePreference(localStorage);
            const desired = resolveMouseEnabled(stored, message.enabled);
            setMouseEnabled(desired);
            if (desired !== message.enabled) {
              sendControl({ type: "set_mouse", enabled: desired });
            }
            if (desired) {
              setHistoryVisible(false);
            }
            return;
          }
          setMouseEnabled(message.enabled);
          if (message.enabled) {
            setHistoryVisible(false);
          }
          return;
        case "error":
          debugLog("control_socket.error", { message: message.message });
          setErrorMessage(message.message);
          return;
        case "info":
          debugLog("control_socket.info", { message: message.message });
          setStatusMessage(message.message);
          return;
      }
    };

    socket.onclose = (event) => {
      debugLog("control_socket.onclose", { code: event.code, reason: event.reason });
      setAuthReady(false);
      scheduleReconnectRef.current({ closeCode: event.code, generation });
    };

    controlSocketRef.current = socket;
    if (debugMode) {
      window.__tmuxMobileDebugSockets = {
        ...(window.__tmuxMobileDebugSockets ?? {}),
        control: socket
      };
    }
  };

  const scheduleReconnect = (options: {
    immediate?: boolean;
    closeCode?: number;
    generation: number;
  }): void => {
    if (
      !shouldReconnect({
        closeCode: options.closeCode,
        socketGeneration: options.generation,
        currentGeneration: socketGenerationRef.current,
        unmounted: unmountedRef.current,
        needsPassword: needsPasswordRef.current,
        hasToken: Boolean(token),
        authFailed: authFailedRef.current
      })
    ) {
      return;
    }

    if (options.immediate) {
      const connecting =
        controlSocketRef.current?.readyState === WebSocket.CONNECTING ||
        terminalSocketRef.current?.readyState === WebSocket.CONNECTING;
      if (
        connecting ||
        !socketsNeedReconnect(
          controlSocketRef.current?.readyState,
          terminalSocketRef.current?.readyState
        )
      ) {
        return;
      }
    }

    clearReconnectTimer();
    setConnectionPhase("reconnecting");
    setStatusMessage("reconnecting");
    setErrorMessage("");
    const delay = reconnectDelayMs(reconnectAttemptRef.current, Boolean(options.immediate));
    const scheduledGeneration = socketGenerationRef.current;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (unmountedRef.current || scheduledGeneration !== socketGenerationRef.current) {
        return;
      }
      reconnectAttemptRef.current += 1;
      debugLog("reconnect.attempt", {
        attempt: reconnectAttemptRef.current,
        delay,
        immediate: Boolean(options.immediate)
      });
      openControlSocket(passwordRef.current);
    }, delay);
  };

  useEffect(() => {
    passwordRef.current = password;
    needsPasswordRef.current = needsPasswordInput;
  }, [password, needsPasswordInput]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  });

  useEffect(() => {
    if (!token) {
      setErrorMessage("Missing token in URL");
      return;
    }

    debugLog("config.fetch.begin");
    fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`config request failed: ${response.status}`);
        }
        const config = (await response.json()) as ServerConfig;
        debugLog("config.fetch.ok", config);
        setServerConfig(config);

        if (config.passwordRequired && !password) {
          debugLog("config.fetch.password_required");
          setNeedsPasswordInput(true);
          setPasswordErrorMessage("");
          return;
        }

        openControlSocket(password);
      })
      .catch((error: Error) => {
        debugLog("config.fetch.error", { message: error.message });
        setErrorMessage(error.message);
      });
  }, []);

  // Theme effect: apply data-theme attribute, persist, update xterm theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tmux-mobile-theme", theme);
    const themeConfig = themes[theme];
    if (themeConfig && terminalRef.current) {
      terminalRef.current.options.theme = themeConfig.xterm;
    }
  }, [theme]);

  // Immersive mode: mirror state to <body data-immersive>, persist to
  // localStorage, and refit xterm + notify the PTY through one rAF so the
  // CSS-driven layout has flushed before FitAddon measures.
  useEffect(() => {
    document.body.dataset.immersive = immersive ? "true" : "false";
    // Skip the persist call on the very first run when the storage slot
    // was empty; the hint effect needs to see readImmersive() === null so
    // it can render the first-run hint on a fresh phone.
    if (immersiveInitializedRef.current || readImmersive(localStorage) !== null) {
      writeImmersive(localStorage, immersive);
    }
    immersiveInitializedRef.current = true;
    immersiveRef.current = immersive;
    // The ResizeObserver on terminal-host fires whenever the chrome
    // collapses/expands and sends one resize message. Avoid a second one
    // here unless the renderer dimensions actually changed since the last
    // send so that exactly one PTY resize is emitted per transition.
    const lastCols = terminalRef.current?.cols ?? null;
    const lastRows = terminalRef.current?.rows ?? null;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      // The ResizeObserver-driven fitAndNotifyResize is suppressed while
      // resizeTransitionRef is true, so this rAF owns the transition's PTY
      // resize message. setImmersive controls the flag's lifetime. We
      // intentionally do NOT steal focus here: the user just typed into
      // the terminal helper, and moving focus to the × would mean their
      // next keystroke exits immersive instead of reaching the terminal.
      // The × and the handle remain Tab-reachable for keyboard users.
      if (resizeTransitionRef.current) {
        sendTerminalResize();
      }
    });
    // Belt-and-braces: force a second fit on a setTimeout so the layout
    // has fully settled before FitAddon measures, in case the rAF fired
    // before the chrome-driven height change had been committed.
    window.setTimeout(() => {
      fitAddonRef.current?.fit();
    }, 60);
  }, [immersive]);

  // First-run hint: show once on a phone when immersive has never been
  // chosen and the user has not dismissed the hint.
  useEffect(() => {
    const mql = window.matchMedia(PHONE_MEDIA_QUERY);
    const phone = isPhoneMatch(mql);
    const hintEl = immersiveHintRef.current;
    if (!hintEl) {
      return;
    }
    const hide = (): void => {
      hintEl.dataset.visible = "false";
      if (immersiveHintTimerRef.current !== null) {
        window.clearTimeout(immersiveHintTimerRef.current);
        immersiveHintTimerRef.current = null;
      }
    };
    if (!phone || readImmersive(localStorage) !== null || readHintSeen(localStorage) === true) {
      hide();
      return;
    }
    hintEl.dataset.visible = "true";
    immersiveHintTimerRef.current = window.setTimeout(() => {
      writeHintSeen(localStorage, true);
      hide();
    }, 4000);
    return () => {
      if (immersiveHintTimerRef.current !== null) {
        window.clearTimeout(immersiveHintTimerRef.current);
        immersiveHintTimerRef.current = null;
      }
    };
  }, [immersive]);

  useEffect(() => {
    if (!terminalContainerRef.current || terminalRef.current) {
      return;
    }

    const initialFontSize = fontSize;
    const themeConfig = themes[theme];
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'MesloLGS NF', 'MesloLGM NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', 'DejaVu Sans Mono Nerd Font', 'Symbols Nerd Font Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize: initialFontSize,
      theme: themeConfig?.xterm ?? {
        background: "#0d1117",
        foreground: "#d1e4ff",
        cursor: "#93c5fd"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    requestAnimationFrame(() => {
      fitAddon.fit();
      const textarea = terminalContainerRef.current?.querySelector("textarea");
      if (textarea && window.matchMedia("(pointer: coarse)").matches) {
        terminalKeyboardEnabledRef.current = false;
        textarea.inputMode = "none";
        textarea.readOnly = true;
        textarea.blur();
        textarea.addEventListener("focus", () => {
          if (!terminalKeyboardEnabledRef.current) {
            textarea.inputMode = "none";
            textarea.readOnly = true;
            textarea.blur();
          }
        });
      } else {
        terminal.focus();
      }
    });

    const disposable = terminal.onData((data) => {
      sendTerminalRef.current(data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitAndNotifyResize = () => {
      const resolved = resolveFontSize(readFontSize(localStorage), isPhoneViewport());
      if (terminal.options.fontSize !== resolved) {
        terminal.options.fontSize = resolved;
        fontSizeRef.current = resolved;
        setFontSize(resolved);
      }
      fitAddon.fit();
      // Skip the PTY send while an immersive transition is in flight so
      // the explicit rAF refit owns this transition's resize message. The
      // flag is cleared by the immersive effect on the next frame after
      // the chrome layout has settled (see setImmersive).
      if (resizeTransitionRef.current) {
        debugLog("fitAndNotifyResize.suppressedByTransition");
        return;
      }
      sendTerminalResizeRef.current();
    };

    const onResize = () => {
      fitAndNotifyResize();
    };

    window.addEventListener("resize", onResize);
    const resizeObserver = new ResizeObserver(() => {
      fitAndNotifyResize();
    });
    resizeObserver.observe(terminalContainerRef.current);
    resizeObserverRef.current = resizeObserver;

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      disposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      socketGenerationRef.current += 1;
      clearReconnectTimer();
      controlSocketRef.current?.close();
      terminalSocketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const maybeReconnect = (): void => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (!hadConnectedRef.current) {
        return;
      }
      scheduleReconnectRef.current({
        immediate: true,
        generation: socketGenerationRef.current
      });
    };

    document.addEventListener("visibilitychange", maybeReconnect);
    window.addEventListener("online", maybeReconnect);
    window.addEventListener("pageshow", maybeReconnect);
    return () => {
      document.removeEventListener("visibilitychange", maybeReconnect);
      window.removeEventListener("online", maybeReconnect);
      window.removeEventListener("pageshow", maybeReconnect);
    };
  }, []);

  // Persist toolbar expanded state
  useEffect(() => {
    localStorage.setItem("tmux-mobile-toolbar-expanded", toolbarExpanded ? "true" : "false");
  }, [toolbarExpanded]);

  // Persist sticky zoom state
  useEffect(() => {
    localStorage.setItem("tmux-mobile-sticky-zoom", stickyZoom ? "true" : "false");
  }, [stickyZoom]);

  useEffect(() => {
    mouseEnabledRef.current = mouseEnabled;
  }, [mouseEnabled]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    historyVisibleRef.current = historyVisible;
  }, [historyVisible]);

  useEffect(() => {
    scrollbackVisibleRef.current = scrollbackVisible;
  }, [scrollbackVisible]);

  useEffect(() => {
    activePaneRef.current = activePane;
  }, [activePane]);

  useEffect(() => {
    const host = terminalContainerRef.current;
    if (!host) {
      return;
    }
    return attachTerminalGestures(host, {
      isMouseEnabled: () => mouseEnabledRef.current,
      isBlocked: () => historyVisibleRef.current || scrollbackVisibleRef.current,
      onEnterHistory: () => requestHistory(),
      onMouseWheel: (clientX, clientY, ticks) => {
        const terminal = terminalRef.current;
        const rect = terminal?.element?.getBoundingClientRect();
        const cell =
          terminal && rect
            ? cellFromPoint(clientX, clientY, rect, terminal.cols, terminal.rows)
            : { col: 1, row: 1 };
        sendTerminal(encodeSgrWheel(ticks, cell.col, cell.row), false);
      }
    });
  }, []);

  useEffect(() => {
    if (!historyVisible || !historyPreRef.current) {
      return;
    }
    scrollElementToLatest(historyPreRef.current);
  }, [historyVisible, historyText]);

  useEffect(() => {
    if (!debugMode) {
      return;
    }
    const sessionSummary = snapshot.sessions.map((session) => {
      const activeWindow =
        session.windowStates.find((windowState) => windowState.active) ?? session.windowStates[0];
      const activePane = activeWindow?.panes.find((pane) => pane.active) ?? activeWindow?.panes[0];
      return {
        name: session.name,
        attached: session.attached,
        activeWindow: activeWindow ? `${activeWindow.index}:${activeWindow.name}` : null,
        activePane: activePane?.id ?? null,
        activePaneZoomed: activePane?.zoomed ?? null
      };
    });
    const derived = {
      attachedSession,
      activeSession: activeSession?.name ?? null,
      activeWindow: activeWindow ? `${activeWindow.index}:${activeWindow.name}` : null,
      activePane: activePane?.id ?? null,
      activePaneZoomed: activePane?.zoomed ?? null,
      topStatus,
      snapshotCapturedAt: snapshot.capturedAt,
      sessions: sessionSummary
    };
    window.__tmuxMobileDebugState = derived;
    debugLog("derived_state", derived);
  }, [attachedSession, activeSession, activeWindow, activePane, snapshot, topStatus]);

  const submitPassword = (): void => {
    setPasswordErrorMessage("");
    authFailedRef.current = false;
    openControlSocket(password);
  };

  const createSession = (): void => {
    const name = window.prompt("Session name", "main");
    if (!name) {
      return;
    }
    sendControl({ type: "new_session", name });
  };

  const copySelection = async (): Promise<void> => {
    const selected = window.getSelection()?.toString() || scrollbackText;
    await navigator.clipboard.writeText(selected);
    setStatusMessage("Copied to clipboard");
  };

  const focusTerminal = (): void => {
    terminalRef.current?.focus();
  };

  const terminalTextarea = (): HTMLTextAreaElement | null => {
    return terminalContainerRef.current?.querySelector("textarea") ?? null;
  };

  const hideTerminalKeyboard = (): void => {
    terminalKeyboardEnabledRef.current = false;
    const textarea = terminalTextarea();
    if (!textarea) {
      return;
    }
    textarea.inputMode = "none";
    textarea.readOnly = true;
    textarea.blur();
  };

  const showTerminalKeyboard = (): void => {
    terminalKeyboardEnabledRef.current = true;
    const textarea = terminalTextarea();
    if (!textarea) {
      return;
    }
    textarea.readOnly = false;
    textarea.inputMode = "text";
    textarea.focus();
  };

  const onToolbarMouseUp = (): void => {
    if (window.matchMedia("(pointer: coarse)").matches) {
      hideTerminalKeyboard();
      return;
    }
    focusTerminal();
  };

  const onHistoryPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary) {
      return;
    }
    historyGestureRef.current = { x: event.clientX, y: event.clientY };
  };

  const onHistoryPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = historyGestureRef.current;
    historyGestureRef.current = null;
    if (!start) {
      return;
    }
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const atLatest = historyPreRef.current ? isScrolledToLatest(historyPreRef.current) : true;
    if (
      shouldExitHistory({
        atLatest,
        deltaX,
        deltaY,
        totalMovePx: Math.hypot(deltaX, deltaY)
      })
    ) {
      setHistoryVisible(false);
    }
  };

  const bindHistoryPre = (element: HTMLPreElement | null): void => {
    historyPreRef.current = element;
    if (element) {
      scrollElementToLatest(element);
    }
  };

  const selectWindow = (windowState: TmuxWindowState): void => {
    if (!activeSession) {
      return;
    }
    sendControl({
      type: "select_window",
      session: activeSession.name,
      windowIndex: windowState.index,
      ...(stickyZoom && !windowState.active ? { stickyZoom: true } : {})
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          onClick={() => setDrawerOpen((value) => !value)}
          className="icon-btn"
          data-testid="drawer-toggle"
        >
          =
        </button>
        <div className="top-title">
          Window: {activeWindow ? `${activeWindow.index}: ${activeWindow.name}` : "-"}
        </div>
        <div className="top-actions">
          <button
            className="top-btn font-size-stepper"
            data-testid="font-size-decrease"
            aria-label="Decrease font size"
            onClick={() => changeFontSize(-1)}
            disabled={fontSize <= MIN_FONT_SIZE}
          >
            A−
          </button>
          <span
            className="font-size-value"
            data-testid="font-size-value"
            aria-label={`Font size ${fontSize}`}
          >
            {fontSize}
          </span>
          <button
            className="top-btn font-size-stepper"
            data-testid="font-size-increase"
            aria-label="Increase font size"
            onClick={() => changeFontSize(1)}
            disabled={fontSize >= MAX_FONT_SIZE}
          >
            A+
          </button>
          <span
            className={`top-status ${topStatus.kind}`}
            title={topStatus.label}
            aria-label={`Status: ${topStatus.label}`}
            data-testid="top-status-indicator"
          />
          <button
            className={`top-zoom-indicator${activePane?.zoomed ? " on" : ""}`}
            title={activePane?.zoomed ? "Active pane is zoomed" : "Active pane is not zoomed"}
            aria-label={`Pane zoom: ${activePane?.zoomed ? "on" : "off"}`}
            data-testid="top-zoom-indicator"
            onClick={() => activePane && sendControl({ type: "zoom_pane", paneId: activePane.id })}
            disabled={!activePane || !activeWindow || activeWindow.paneCount <= 1}
          >
            🔍
          </button>
          <button className="top-btn" onClick={() => requestScrollback(serverConfig?.scrollbackLines ?? 1000)}>
            Scroll
          </button>
          <button
            className={`top-btn${mouseEnabled ? " on" : ""}`}
            data-testid="mouse-toggle"
            aria-pressed={mouseEnabled}
            aria-label={mouseEnabled ? "Mouse on" : "Mouse off"}
            onClick={toggleMouse}
            disabled={!attachedSession}
          >
            {mouseEnabled ? "Mouse" : "Mouse off"}
          </button>
          <button className="top-btn" onClick={() => setComposeEnabled((value) => !value)}>
            {composeEnabled ? "Compose On" : "Compose Off"}
          </button>
          {!composeEnabled && (
            <button
              className="top-btn"
              data-testid="keyboard-toggle"
              onClick={showTerminalKeyboard}
            >
              KB
            </button>
          )}
        </div>
      </header>

      <main
        className="terminal-wrap"
        onKeyDown={onTerminalHostKeyDown}
      >
        <div
          className={`terminal-host${mouseEnabled ? " mouse-on" : " mouse-off"}`}
          ref={terminalContainerRef}
          data-testid="terminal-host"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={onTerminalHostPointerDown}
        />
        {historyVisible && (
          <div
            className="history-surface"
            data-testid="history-surface"
            onPointerDown={onHistoryPointerDown}
            onPointerUp={onHistoryPointerUp}
            onPointerCancel={() => {
              historyGestureRef.current = null;
            }}
          >
            <pre className="history-text" data-testid="history-text" ref={bindHistoryPre}>
              {historyText}
            </pre>
          </div>
        )}
        <div
          className="first-run-hint"
          data-testid="immersive-hint"
          role="status"
          aria-live="polite"
          ref={immersiveHintRef}
          data-visible="false"
        >
          <span className="first-run-hint-text">
            Tip — Tap the terminal to hide the toolbar. Swipe up to bring it back.
          </span>
          <button
            type="button"
            className="first-run-hint-dismiss"
            data-testid="immersive-hint-dismiss"
            aria-label="Dismiss immersive hint"
            onClick={onImmersiveHintDismiss}
          >
            ×
          </button>
        </div>
        {immersive && (
          <>
            <button
              type="button"
              className="immersive-close"
              data-testid="immersive-close"
              role="button"
              aria-label="Exit immersive mode"
              tabIndex={0}
              ref={immersiveCloseRef}
              onClick={onImmersiveHandleActivate}
              onKeyDown={onImmersiveHandleKeyDown}
            >
              ×
            </button>
            <button
              type="button"
              className="bottom-handle"
              data-testid="immersive-handle"
              role="button"
              aria-label="Show toolbar"
              tabIndex={0}
              ref={immersiveHandleRef}
              onClick={onImmersiveHandleActivate}
              onKeyDown={onImmersiveHandleKeyDown}
            />
          </>
        )}
      </main>

      <section className="toolbar" onMouseUp={onToolbarMouseUp}>
        {/* Row 1: Esc, Ctrl, Alt, Cmd, Meta, /, @, Hm, ↑, Ed */}
        <div className="toolbar-main">
          <button onClick={() => sendTerminal("\u001b")}>Esc</button>
          <button className={`modifier ${modifiers.ctrl}`} onClick={() => toggleModifier("ctrl")}>Ctrl</button>
          <button className={`modifier ${modifiers.alt}`} onClick={() => toggleModifier("alt")}>Alt</button>
          <button className={`modifier ${modifiers.meta}`} onClick={() => toggleModifier("meta")}>Cmd</button>
          <button onClick={() => sendTerminal("\u001b")}>Meta</button>
          <button onClick={() => sendTerminal("/")}>/</button>
          <button onClick={() => sendTerminal("@")}>@</button>
          <button onClick={() => sendTerminal("\u001b[H")}>Hm</button>
          <button onClick={() => sendTerminal("\u001b[A")}>↑</button>
          <button onClick={() => sendTerminal("\u001b[F")}>Ed</button>
        </div>

        {/* Row 2: ^C, ^B, ^R, Sft, Tab, Enter, ..., ←, ↓, → */}
        <div className="toolbar-main">
          <button className="danger" onClick={() => sendTerminal("\u0003", false)}>^C</button>
          <button onClick={() => sendTerminal("\u0002", false)}>^B</button>
          <button onClick={() => sendTerminal("\u0012", false)}>^R</button>
          <button className={`modifier ${modifiers.shift}`} onClick={() => toggleModifier("shift")}>Sft</button>
          <button onClick={() => sendTerminal("\t")}>Tab</button>
          <button onClick={() => sendTerminal("\r")}>Enter</button>
          <button
            className="toolbar-expand-btn"
            onClick={() => {
              setToolbarExpanded((v) => !v);
              if (toolbarExpanded) {
                setToolbarDeepExpanded(false);
              }
            }}
          >
            {toolbarExpanded ? "..." : "..."}
          </button>
          <button onClick={() => sendTerminal("\u001b[D")}>←</button>
          <button onClick={() => sendTerminal("\u001b[B")}>↓</button>
          <button onClick={() => sendTerminal("\u001b[C")}>→</button>
        </div>

        {/* Expanded section (collapsible) */}
        <div className={`toolbar-row-secondary ${toolbarExpanded ? "expanded" : ""}`}>
          <button onClick={() => sendTerminal("\u0004", false)}>^D</button>
          <button onClick={() => sendTerminal("\u000c", false)}>^L</button>
          <button
            onClick={async () => {
              const clip = await navigator.clipboard.readText();
              sendTerminal(clip, false);
            }}
          >
            Paste
          </button>
          <button onClick={() => sendTerminal("\u001b[3~")}>Del</button>
          <button onClick={() => sendTerminal("\u001b[2~")}>Insert</button>
          <button onClick={() => sendTerminal("\u001b[5~")}>PgUp</button>
          <button onClick={() => sendTerminal("\u001b[6~")}>PgDn</button>
          <button onClick={() => sendTerminal("")}>CapsLk</button>
          <button
            className="toolbar-expand-btn"
            onClick={() => setToolbarDeepExpanded((v) => !v)}
          >
            {toolbarDeepExpanded ? "F-Keys ▲" : "F-Keys ▼"}
          </button>
        </div>

        {/* F-keys row (collapsible from within expanded) */}
        {toolbarExpanded && (
          <div className={`toolbar-row-deep ${toolbarDeepExpanded ? "expanded" : ""}`}>
            <div className="toolbar-row-deep-fkeys">
              {[
                "\u001bOP", "\u001bOQ", "\u001bOR", "\u001bOS",
                "\u001b[15~", "\u001b[17~", "\u001b[18~", "\u001b[19~",
                "\u001b[20~", "\u001b[21~", "\u001b[23~", "\u001b[24~"
              ].map((seq, i) => (
                <button key={`f${i + 1}`} onClick={() => sendTerminal(seq, false)}>
                  F{i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {composeEnabled && (
        <section className="compose-bar">
          <input
            value={composeText}
            onChange={(event) => setComposeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendControl({ type: "send_compose", text: composeText });
                setComposeText("");
              }
            }}
            onFocus={hideTerminalKeyboard}
            placeholder="Compose command"
            inputMode="text"
            enterKeyHint="send"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" data-testid="keyboard-toggle" onClick={showTerminalKeyboard}>
            KB
          </button>
          <button
            type="button"
            onClick={() => {
              sendControl({ type: "send_compose", text: composeText });
              setComposeText("");
            }}
          >
            Send
          </button>
        </section>
      )}

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          data-testid="drawer-backdrop"
        >
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <button
              className="drawer-close"
              onClick={() => setDrawerOpen(false)}
              data-testid="drawer-close"
              aria-label="Close drawer"
            >
              ←
            </button>

            <h3>Sessions</h3>
            <ul data-testid="sessions-list">
              {snapshot.sessions.map((session) => (
                <li key={session.name}>
                  <button
                    onClick={() => sendControl({ type: "select_session", session: session.name })}
                    className={session.name === (attachedSession || activeSession?.name) ? "active" : ""}
                  >
                    {session.name} {session.attached ? "*" : ""}
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="drawer-section-action"
              onClick={createSession}
              data-testid="new-session-button"
            >
              + New Session
            </button>

            <h3>Windows ({activeSession?.name ?? "-"})</h3>
            <ul data-testid="windows-list">
              {activeSession
                ? activeSession.windowStates.map((windowState) => (
                    <li key={`${activeSession.name}-${windowState.index}`}>
                      <button
                        onClick={() => selectWindow(windowState)}
                        className={windowState.active ? "active" : ""}
                      >
                        {windowState.index}: {windowState.name} {windowState.active ? "*" : ""}
                      </button>
                    </li>
                  ))
                : null}
            </ul>
            <button
              className="drawer-section-action"
              onClick={() =>
                activeSession && sendControl({ type: "new_window", session: activeSession.name })
              }
              disabled={!activeSession}
              data-testid="new-window-button"
            >
              + New Window
            </button>

            <h3>Panes ({activeWindow ? `${activeWindow.index}` : "-"})</h3>
            <ul>
              {activeWindow
                ? activeWindow.panes.map((pane) => (
                    <li key={pane.id}>
                      <button
                        onClick={() => sendControl({
                          type: "select_pane",
                          paneId: pane.id,
                          ...(stickyZoom && !pane.active ? { stickyZoom: true } : {})
                        })}
                        className={pane.active ? "active" : ""}
                      >
                        %{pane.index}: {pane.currentCommand} {pane.active ? "*" : ""}
                        {pane.active && pane.zoomed ? (
                          <span
                            className="pane-zoom-indicator on"
                            title="Active pane is zoomed"
                            aria-label="Pane zoom: on"
                            data-testid="active-pane-zoom-indicator"
                          >
                            🔍
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))
                : null}
            </ul>
            <div className="drawer-grid">
              <button
                onClick={() =>
                  activePane &&
                  sendControl({ type: "split_pane", paneId: activePane.id, orientation: "h" })
                }
                disabled={!activePane}
              >
                Split H
              </button>
              <button
                onClick={() =>
                  activePane &&
                  sendControl({ type: "split_pane", paneId: activePane.id, orientation: "v" })
                }
                disabled={!activePane}
              >
                Split V
              </button>
            </div>
            <button
              className="drawer-section-action"
              onClick={() =>
                activePane && sendControl({ type: "zoom_pane", paneId: activePane.id })
              }
              disabled={!activePane || !activeWindow || activeWindow.paneCount <= 1}
            >
              Zoom Pane
            </button>
            <button
              className={`drawer-section-action${stickyZoom ? " active" : ""}`}
              onClick={() => setStickyZoom((v) => !v)}
              data-testid="sticky-zoom-toggle"
            >
              Sticky Zoom: {stickyZoom ? "On" : "Off"}
            </button>

            <button
              className="drawer-section-action"
              onClick={() => activePane && sendControl({ type: "kill_pane", paneId: activePane.id })}
              disabled={!activePane}
            >
              Close Pane
            </button>
            <button
              className="drawer-section-action"
              onClick={() =>
                activeSession &&
                activeWindow &&
                sendControl({
                  type: "kill_window",
                  session: activeSession.name,
                  windowIndex: activeWindow.index
                })
              }
              disabled={!activeSession || !activeWindow}
            >
              Kill Window
            </button>

            <h3>Appearance</h3>
            <div className="theme-picker" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              {Object.entries(themes).map(([key, config]) => (
                <button
                  key={key}
                  className={theme === key ? "active" : ""}
                  onClick={() => setTheme(key)}
                >
                  {config.name}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      {sessionChoices && (
        <div className="overlay" data-testid="session-picker-overlay">
          <div className="card">
            <h2>Select Session</h2>
            {sessionChoices.map((session) => (
              <button
                key={session.name}
                onClick={() => sendControl({ type: "select_session", session: session.name })}
              >
                {session.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {scrollbackVisible && (
        <div className="overlay">
          <div className="card scrollback-card">
            <div className="scrollback-actions">
              <button onClick={() => setScrollbackVisible(false)}>Close</button>
              <button onClick={() => requestScrollback(scrollbackLines + 1000)}>Load More</button>
              <button onClick={() => void copySelection()}>Copy</button>
            </div>
            <pre className="scrollback-text">{scrollbackText}</pre>
          </div>
        </div>
      )}

      {needsPasswordInput && (
        <div className="overlay">
          <div className="card">
            <h2>Password Required</h2>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordErrorMessage) {
                  setPasswordErrorMessage("");
                }
              }}
              placeholder="Enter password"
            />
            {passwordErrorMessage && (
              <p className="password-error" data-testid="password-error">
                {passwordErrorMessage}
              </p>
            )}
            <button onClick={submitPassword}>Connect</button>
          </div>
        </div>
      )}

      {token && !needsPasswordInput && connectionPhase !== "connected" && (
        <div className="overlay" data-testid="reconnect-overlay">
          <div className="card">
            <h2>{connectionPhase === "reconnecting" ? "Reconnecting…" : "Connecting…"}</h2>
          </div>
        </div>
      )}

      {!token && (
        <div className="overlay">
          <div className="card">URL missing `token` query parameter.</div>
        </div>
      )}
    </div>
  );
};
