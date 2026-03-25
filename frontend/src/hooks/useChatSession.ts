import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { connectSSE, connectVoiceWs, getConvo, listFiles, listProjectAgents, listSkills, postApprove, postMessage, postStop, updateConvo, uploadFiles, type AgentConfig, type Attachment, type Skill, type SseEvent } from "../api";
import { buildDisplayMessages, messageIdentity, type ApprovalScope, type DisplayMessage, type MetaInfo, type StreamBlock } from "../chatState";
import type { ComposerAttachment } from "../chatComposer";
import { getBottomSlackPx, getUserMessageTopOffsetPx } from "../chatSessionState";

const INITIAL_HISTORY_PAGE_SIZE = 100;
const OLDER_HISTORY_PAGE_SIZE = 100;

export function useChatSession(projectId?: string, convId?: string) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [waitingForModel, setWaitingForModel] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [autonomousToolsEnabled, setAutonomousToolsEnabled] = useState(false);
  const [savingAutonomy, setSavingAutonomy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [title, setTitle] = useState("Untitled");
  const [sseAttempt, setSseAttempt] = useState(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const mentionRefreshInFlightRef = useRef(false);
  const [activeAgent, setActiveAgent] = useState<{ id: string; name: string; color?: string; model?: string } | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [voiceUiActive, setVoiceUiActive] = useState(false);
  const [voiceElapsedSec, setVoiceElapsedSec] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceBaseText, setVoiceBaseText] = useState("");
  const [voiceTranscriptText, setVoiceTranscriptText] = useState("");
  const [voiceStatusText, setVoiceStatusText] = useState("Listening…");

  const activeAgentRef = useRef<{ id: string; name: string; color?: string; model?: string } | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const sseRef = useRef<{ close: () => void } | null>(null);
  const voiceWsRef = useRef<WebSocket | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const lastSentMessageRef = useRef<HTMLDivElement | null>(null);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<StreamBlock[]>([]);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const voiceTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceBaseTextRef = useRef("");
  const hasConnectedRef = useRef(false);
  const replayingRef = useRef(false);
  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const prependScrollRestoreRef = useRef<number | null>(null);

  const savedScrollKeyRef = useRef<string | null>(null);

  const getUserMessageTopOffset = useCallback(() => getUserMessageTopOffsetPx(window.innerHeight), []);

  const bottomSlackPx = useMemo(() => {
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    return getBottomSlackPx(viewportHeight);
  }, []);

  const scrollUserMessageNearTop = useCallback((messageEl: HTMLDivElement | null, behavior: ScrollBehavior = "smooth") => {
    const container = messageListRef.current;
    if (!container || !messageEl) return;
    const targetTop = messageEl.offsetTop - getUserMessageTopOffset();
    container.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, [getUserMessageTopOffset]);

  const setCurrentRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  useLayoutEffect(() => {
    if (prependScrollRestoreRef.current != null && messageListRef.current) {
      const container = messageListRef.current;
      const prevHeight = prependScrollRestoreRef.current;
      const nextHeight = container.scrollHeight;
      container.scrollTop += nextHeight - prevHeight;
      prependScrollRestoreRef.current = null;
      return;
    }
    if (!pendingScrollMessageIdRef.current) return;
    const messageEl = lastSentMessageRef.current;
    if (!messageEl || messageEl.dataset.messageId !== pendingScrollMessageIdRef.current) return;
    scrollUserMessageNearTop(messageEl);
    pendingScrollMessageIdRef.current = null;
  }, [messages, scrollUserMessageNearTop]);

  // Persist scroll position to sessionStorage so it restores on refresh or chat switch
  useEffect(() => {
    if (!convId) return;
    const key = `remote-lab:scroll:${convId}`;
    savedScrollKeyRef.current = key;
    const saveScroll = () => {
      const container = messageListRef.current;
      if (container) sessionStorage.setItem(key, String(container.scrollTop));
    };
    window.addEventListener("beforeunload", saveScroll);
    return () => {
      // Save scroll when switching away from this chat (convId change) or on unmount
      saveScroll();
      window.removeEventListener("beforeunload", saveScroll);
    };
  }, [convId]);

  useLayoutEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0 || messageListRef.current == null) return;
    requestAnimationFrame(() => {
      const container = messageListRef.current;
      if (!container) return;
      const key = savedScrollKeyRef.current;
      const saved = typeof key === "string" ? sessionStorage.getItem(key) : null;
      if (saved != null) {
        container.scrollTop = Number(saved);
        if (typeof key === "string") sessionStorage.removeItem(key);
      } else {
        const latestUserMessage = latestUserMessageRef.current;
        if (latestUserMessage) {
          scrollUserMessageNearTop(latestUserMessage, "auto");
        } else {
          container.scrollTop = container.scrollHeight;
        }
      }
      initialScrollDoneRef.current = true;
    });
  }, [messages.length, scrollUserMessageNearTop]);

  const refreshMentionFiles = useCallback(async () => {
    if (!projectId || mentionRefreshInFlightRef.current) return;
    mentionRefreshInFlightRef.current = true;
    try {
      const res = await listFiles(projectId, { hidden: true });
      setProjectFiles(res.files);
    } catch {}
    finally {
      mentionRefreshInFlightRef.current = false;
    }
  }, [projectId]);

  const reloadConversation = useCallback(async () => {
    if (!convId || !projectId) return;
    const [detail, agentRes] = await Promise.all([getConvo(convId, { limit: INITIAL_HISTORY_PAGE_SIZE }), listProjectAgents(projectId)]);
    const agentList = agentRes.agents;
    setAgents(agentList);
    const rebuilt = buildDisplayMessages(detail, agentList);
    setTitle(rebuilt.title);
    setAutonomousToolsEnabled(rebuilt.autonomousToolsEnabled);
    setHasMoreHistory(detail.has_more);
    setHistoryCursor(detail.next_before);
    setMessages(rebuilt.messages);
    setMeta(rebuilt.meta);
    blocksRef.current = [];
    setStreamBlocks([]);
    activeAgentRef.current = null;
    setActiveAgent(null);
    initialScrollDoneRef.current = false;
  }, [convId, projectId]);

  const loadOlderHistory = useCallback(async () => {
    if (!convId || loadingOlder || !hasMoreHistory || historyCursor == null) return;
    setLoadingOlder(true);
    try {
      const detail = await getConvo(convId, { before: historyCursor, limit: OLDER_HISTORY_PAGE_SIZE });
      const rebuilt = buildDisplayMessages(detail, agents);
      if (messageListRef.current) prependScrollRestoreRef.current = messageListRef.current.scrollHeight;
      setMessages((prev) => {
        const prevIds = new Set(prev.map(messageIdentity));
        const olderOnly = rebuilt.messages.filter((msg) => !prevIds.has(messageIdentity(msg)));
        return [...olderOnly, ...prev];
      });
      setHasMoreHistory(detail.has_more);
      setHistoryCursor(detail.next_before);
    } catch (e: any) {
      setError(e.message || "Failed to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  }, [convId, loadingOlder, hasMoreHistory, historyCursor, agents]);

  const addComposerFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({ file, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined }));
    setComposerAttachments((prev) => [...prev, ...next]);
  }, []);

  const removeComposerAttachment = useCallback((idx: number) => {
    setComposerAttachments((prev) => {
      const item = prev[idx];
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    listFiles(projectId, { hidden: true }).then((res) => setProjectFiles(res.files)).catch(() => setProjectFiles([]));
    listSkills(projectId).then(setSkills).catch(() => setSkills([]));
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !convId) return;
    reloadConversation().catch((e) => setError(e.message));
  }, [projectId, convId, reloadConversation]);

  // ---------------------------------------------------------------------------
  // SSE connection (replaces WebSocket)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!convId || !projectId) return;
    // Reset run state so a previous chat's "running" doesn't bleed into the new one.
    setBusy(false);
    setWaitingForModel(false);
    setCurrentRunId(null);
    blocksRef.current = [];
    setStreamBlocks([]);
    activeAgentRef.current = null;
    setActiveAgent(null);
    replayingRef.current = false;
    hasConnectedRef.current = false;

    const handleEvent = (data: SseEvent) => {
      switch (data.type) {
        case "sync":
          setConnected(true);
          // Flush suppressed renders from reconnect replay.
          if (replayingRef.current) {
            replayingRef.current = false;
            setStreamBlocks([...blocksRef.current]);
          }
          // On reconnect with no active run, reload to pick up any
          // state changes (e.g. run finished while disconnected).
          if (hasConnectedRef.current && !data.running) {
            reloadConversation().catch(() => {});
          }
          hasConnectedRef.current = true;
          break;
        case "running": {
          const isReconnect = data.run_id === activeRunIdRef.current;
          setCurrentRunId(data.run_id); setBusy(true); setWaitingForModel(true);
          if (convId) window.dispatchEvent(new CustomEvent("convo-status-changed", { detail: { convoId: convId, status: "running" } }));
          blocksRef.current = [];
          if (isReconnect) {
            replayingRef.current = true;
          } else {
            replayingRef.current = false;
            setStreamBlocks([]);
          }
          break;
        }
        case "agent-start": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const ag = { id: data.agent_id, name: data.agent_name, color: data.agent_color, model: data.agent_model };
          activeAgentRef.current = ag; setActiveAgent(ag);
          if (data.agent_model) setMeta((prev) => prev ? { ...prev, model: data.agent_model } : { turns: 0, context_tokens: 0, context_limit: 0, model: data.agent_model });
          break;
        }
        case "thinking-delta": break;
        case "text-delta": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(false);
          const blocks = blocksRef.current; const last = blocks[blocks.length - 1];
          if (last && last.type === "text") last.content += data.delta; else blocks.push({ type: "text", content: data.delta });
          blocksRef.current = [...blocks]; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-use": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(false);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              blocks[i] = { ...b, input: data.input ?? b.input, awaitingApproval: false, approvalStatus: b.approvalStatus === "denied" ? b.approvalStatus : undefined, canAllowProject: b.canAllowProject };
              matched = true; break;
            }
          }
          if (!matched) blocks.push({ type: "tool", name: data.name, input: data.input, tool_call_id: data.tool_call_id, run_id: data.run_id });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-output": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const oBlocks = [...blocksRef.current];
          for (let i = oBlocks.length - 1; i >= 0; i--) {
            const b = oBlocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) { oBlocks[i] = { ...b, liveOutput: (b.liveOutput || "") + data.output }; break; }
          }
          blocksRef.current = oBlocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-result": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(true);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) { blocks[i] = { ...b, output: b.liveOutput || data.output, diff: data.diff ?? b.diff, liveOutput: undefined }; matched = true; break; }
          }
          if (!matched) blocks.push({ type: "tool", name: data.name, output: data.output, diff: data.diff, tool_call_id: data.tool_call_id, run_id: data.run_id });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "file-changed": setProjectFiles((prev) => prev.includes(data.path) ? prev : [...prev, data.path].sort()); break;
        case "tool-confirm": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(false);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && b.tool_call_id === data.tool_call_id) { blocks[i] = { ...b, name: data.name, input: data.args ?? b.input, awaitingApproval: true, approvalStatus: "pending", canAllowProject: data.can_allow_project !== false, canTurnOnAuto: data.can_turn_on_auto !== false }; matched = true; break; }
          }
          if (!matched) blocks.push({ type: "tool", tool_call_id: data.tool_call_id, run_id: data.run_id, name: data.name, input: data.args, awaitingApproval: true, approvalStatus: "pending", canAllowProject: data.can_allow_project !== false, canTurnOnAuto: data.can_turn_on_auto !== false });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "done": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          replayingRef.current = false;
          const status = data.status || "ok";
          if (status === "error" && data.error_message) setError(data.error_message);
          const finalBlocks = blocksRef.current;
          if (finalBlocks.length > 0) {
            const ag = activeAgentRef.current;
            const onlyBashOutput = finalBlocks.length > 0 && finalBlocks.every((b) => b.type === "tool" && b.name === "bash" && !!b.output);
            const finalMessage: DisplayMessage = { role: "assistant", blocks: [...finalBlocks], agent_id: data.agent_id || ag?.id, agent_name: ag?.name, agent_color: ag?.color, defaultExpandedTools: onlyBashOutput };
            setMessages((msgs) => msgs.some((msg) => messageIdentity(msg) === messageIdentity(finalMessage)) ? msgs : [...msgs, finalMessage]);
          }
          blocksRef.current = []; setStreamBlocks([]); setWaitingForModel(false); activeAgentRef.current = null; setActiveAgent(null);
          if (data.context_limit > 0) setMeta((prev) => ({ turns: data.turns, context_tokens: data.context_tokens, context_limit: data.context_limit, model: prev?.model }));
          setBusy(false); setCurrentRunId(null);
          if (convId) { const s = status === "error" ? "error" : "done"; window.dispatchEvent(new CustomEvent("convo-status-changed", { detail: { convoId: convId, status: s } })); }
          break;
        }
        case "compacted": setMeta((prev) => prev ? { ...prev, context_tokens: data.new_tokens } : prev); setMessages((msgs) => [...msgs, { role: "assistant", blocks: [{ type: "tool", name: "compact", input: `${(data.old_tokens / 1000).toFixed(1)}k → ${(data.new_tokens / 1000).toFixed(1)}k tokens` }] }]); setWaitingForModel(false); setBusy(false); break;
        case "skill-result": setMessages((msgs) => [...msgs, { role: "assistant", blocks: [{ type: "tool", name: data.skill, input: data.output }] }]); setWaitingForModel(false); setBusy(false); break;
        case "title-updated": setTitle(data.title); break;
        case "error":
          if (data.run_id && activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setError(data.message);
          if (!data.run_id) {
            blocksRef.current = []; setStreamBlocks([]); setWaitingForModel(false); setBusy(false); setCurrentRunId(null);
          }
          break;
      }
    };

    const sse = connectSSE(convId, handleEvent, () => setConnected(false));
    sseRef.current = sse;

    return () => {
      clearTimeout(reconnectTimer.current);
      sse.close();
    };
  }, [convId, sseAttempt, reloadConversation, setCurrentRunId, projectId]);

  // ---------------------------------------------------------------------------
  // Voice timer
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!voiceUiActive) {
      if (voiceTimerRef.current !== null) { window.clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
      setVoiceElapsedSec(0); return;
    }
    voiceTimerRef.current = window.setInterval(() => setVoiceElapsedSec((prev) => prev + 1), 1000);
    return () => {
      if (voiceTimerRef.current !== null) { window.clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
    };
  }, [voiceUiActive]);

  // ---------------------------------------------------------------------------
  // Actions (REST-based)
  // ---------------------------------------------------------------------------

  const stop = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (runId && convId) postStop(convId, runId).catch(() => {});
    setBusy(false); setWaitingForModel(false);
  }, [convId]);

  const handleToolApproval = useCallback(async (toolCallId: string, approved: boolean, scope: ApprovalScope = "once") => {
    if (approved && scope === "auto" && convId) {
      setSavingAutonomy(true);
      try {
        const updated = await updateConvo(convId, { autonomous_tools_enabled: true });
        setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled);
      } catch (e: any) {
        setError(e.message || "Failed to enable auto mode"); setSavingAutonomy(false); return;
      }
      setSavingAutonomy(false);
    }
    const runId = activeRunIdRef.current;
    if (runId && convId) {
      postApprove(convId, runId, toolCallId, approved, scope).catch(() => {});
    }
    const blocks = blocksRef.current.map((b) => b.type === "tool" && b.tool_call_id === toolCallId ? { ...b, approvalStatus: approved ? "approved" as const : "denied" as const, approvedScope: approved ? scope : undefined, awaitingApproval: approved ? false : true } : b);
    blocksRef.current = blocks; setStreamBlocks([...blocks]);
  }, [convId]);

  const sendText = useCallback(async (text: string) => {
    if ((!text && composerAttachments.length === 0) || busy || uploadingAttachments || !connected || !projectId || !convId) {
      setError("Disconnected — reconnecting"); return false;
    }
    let uploaded: Attachment[] = [];
    if (composerAttachments.length > 0) {
      setUploadingAttachments(true);
      try { uploaded = await uploadFiles(projectId, composerAttachments.map((a) => a.file)); }
      catch (e: any) { setError(e.message || "Upload failed"); setUploadingAttachments(false); return false; }
      setUploadingAttachments(false);
    }

    const message_id = crypto.randomUUID();
    // Optimistic UI update
    setMessages((prev) => [...prev, { role: "user", blocks: [{ type: "text", content: text }], message_id, pending: false, attachments: uploaded, bashMode: text.startsWith("!") }]);
    pendingScrollMessageIdRef.current = message_id;
    setBusy(true);
    setWaitingForModel(true);
    setError(null);

    try {
      await postMessage(convId, text, message_id, uploaded);
    } catch (e: any) {
      setError(e.message || "Failed to send message");
      setBusy(false);
      setWaitingForModel(false);
      return false;
    }

    setComposerAttachments((prev) => { for (const item of prev) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); return []; });
    return true;
  }, [busy, composerAttachments, connected, projectId, convId, uploadingAttachments]);

  const resend = useCallback((text: string) => { void sendText(text); }, [sendText]);

  // ---------------------------------------------------------------------------
  // Voice (separate WebSocket, on-demand)
  // ---------------------------------------------------------------------------

  const stopVoiceCapture = useCallback(() => {
    setVoiceStatusText("Finishing…"); mediaRecorderRef.current?.stop(); mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null;
    const ws = voiceWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "voice-stop" }));
    // Close voice WS after stopping
    setTimeout(() => { voiceWsRef.current?.close(); voiceWsRef.current = null; }, 500);
  }, []);

  const startVoiceCapture = useCallback(async () => {
    if (!convId || busy || voiceUiActive) return;
    setVoiceError(null); setVoiceBaseText(input.trim()); voiceBaseTextRef.current = input.trim(); setVoiceTranscriptText("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Open voice WS on demand
      const ws = connectVoiceWs(convId);
      voiceWsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("message", function onMsg(event) {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "auth-ok") { ws.removeEventListener("message", onMsg); resolve(); }
            if (data.type === "error") { ws.removeEventListener("message", onMsg); reject(new Error(data.message)); }
          } catch { /* ignore */ }
        });
        ws.addEventListener("error", () => reject(new Error("Voice connection failed")));
        setTimeout(() => reject(new Error("Voice connection timeout")), 5000);
      });

      // Listen for voice events on the voice WS
      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "voice-state") {
            if (data.state === "starting") { setVoiceError(null); setVoiceStatusText("Starting microphone…"); setVoiceUiActive(true); }
            else if (data.state === "listening") { setVoiceStatusText("Listening…"); setVoiceUiActive(true); }
            else if (data.state === "stopped") { setVoiceStatusText("Listening…"); setVoiceUiActive(false); }
          } else if (data.type === "voice-transcript") {
            const base = voiceBaseTextRef.current;
            setVoiceTranscriptText(data.text);
            setInput(`${base}${base && data.text ? " " : ""}${data.text}`);
          } else if (data.type === "error") {
            setVoiceError(data.message); setVoiceUiActive(false);
          }
        } catch { /* ignore */ }
      });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", async (event) => {
        if (!event.data || event.data.size === 0) return;
        const buf = await event.data.arrayBuffer(); const bytes = new Uint8Array(buf); let binary = ""; const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        const b64 = btoa(binary); const socket = voiceWsRef.current; if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "voice-audio", audio: b64 }));
      });
      ws.send(JSON.stringify({ type: "voice-start" })); recorder.start(250); setVoiceUiActive(true);
    } catch (e: any) {
      setVoiceError(e?.name === "NotAllowedError" ? "Microphone access was denied" : "Voice input failed. Your existing draft was preserved.");
      setVoiceStatusText("Listening…"); mediaRecorderRef.current = null; mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null; setVoiceUiActive(false);
      voiceWsRef.current?.close(); voiceWsRef.current = null;
    }
  }, [busy, convId, input, voiceUiActive]);

  const toggleAutonomy = useCallback(async () => {
    if (!convId || savingAutonomy) return;
    const next = !autonomousToolsEnabled; setSavingAutonomy(true);
    try { const updated = await updateConvo(convId, { autonomous_tools_enabled: next }); setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled); }
    catch (e: any) { setError(e.message || "Failed to update autonomous mode"); }
    finally { setSavingAutonomy(false); }
  }, [convId, autonomousToolsEnabled, savingAutonomy]);

  return {
    messages, streamBlocks, waitingForModel, input, setInput, busy, meta, setMeta,
    autonomousToolsEnabled, savingAutonomy, error, connected, title, setTitle,
    agents, projectFiles, skills, activeAgent, hasMoreHistory, loadingOlder,
    composerAttachments, uploadingAttachments, voiceUiActive, voiceElapsedSec,
    voiceError, voiceStatusText, messageListRef, pendingScrollMessageIdRef,
    lastSentMessageRef, latestUserMessageRef, bottomSlackPx,
    refreshMentionFiles, loadOlderHistory, addComposerFiles, removeComposerAttachment,
    handleToolApproval, sendText, resend, stop, stopVoiceCapture, startVoiceCapture,
    toggleAutonomy, setError, setProjectFiles,
  };
}
