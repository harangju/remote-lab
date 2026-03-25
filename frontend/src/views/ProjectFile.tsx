import React, { useCallback, useEffect } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { FilePanel } from "../components/FilePanel";
import { FileFinder } from "../components/FileFinder";
import { usePanel } from "../hooks/usePanel";
import { createConvo, listConvos, getConvo, type ConvoMeta } from "../api";

export function ProjectFile() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { closeMobileNavigator } = useOutletContext<{ closeMobileNavigator: () => void }>();
  const panel = usePanel(projectId);

  const openFromQuery = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path");
    if (path && (!panel.file || panel.file.path !== path)) {
      panel.openFile(path);
    }
  }, [panel.file, panel.openFile]);

  useEffect(() => {
    openFromQuery();
  }, [openFromQuery]);

  const handleClose = useCallback(() => {
    if (panel.dirty && !window.confirm("You have unsaved changes. Discard?")) return;
    navigate(`/${projectId}`);
  }, [navigate, panel.dirty, projectId]);

  const handleToggleEdit = useCallback(() => {
    if (panel.editMode && panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
      panel.cancelEdit();
    } else {
      panel.setEditMode(!panel.editMode);
    }
  }, [panel.dirty, panel.editMode, panel.cancelEdit, panel.setEditMode]);

  const handleOpenFile = useCallback((path: string) => {
    if (panel.dirty && !window.confirm("You have unsaved changes. Discard and open another file?")) return;
    navigate(`/${projectId}/file?path=${encodeURIComponent(path)}`);
    panel.openFile(path);
  }, [navigate, panel.dirty, panel.openFile, projectId]);

  const [conversationOptions, setConversationOptions] = React.useState<ConvoMeta[]>([]);
  const [conversationOptionLabel, setConversationOptionLabel] = React.useState("Recent conversations using this file");

  useEffect(() => {
    let cancelled = false;
    const loadConversationOptions = async () => {
      if (!projectId || !panel.file) {
        if (!cancelled) {
          setConversationOptions([]);
          setConversationOptionLabel("Recent conversations using this file");
        }
        return;
      }
      const path = panel.file.path;
      const convos = await listConvos(projectId);
      const active = convos.filter((c) => !c.archived_at).sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
      const matches: ConvoMeta[] = [];
      for (const convo of active) {
        try {
          const detail = await getConvo(convo.id);
          const lastEventAt = [...detail.messages]
            .reverse()
            .find((message: any) => typeof message?.timestamp === "string")?.timestamp as string | undefined;
          const convoWithLastEvent = { ...convo, last_event_at: lastEventAt || convo.updated_at };
          const hasFile = detail.messages.some((message: any) => {
            if (Array.isArray(message.attachments) && message.attachments.some((attachment: any) => attachment?.path === path)) return true;
            const content = typeof message.content === "string" ? message.content : "";
            const input = typeof message.input === "string" ? message.input : "";
            const output = typeof message.output === "string" ? message.output : "";
            return content.includes(path) || input.includes(path) || output.includes(path);
          });
          if (hasFile) matches.push(convoWithLastEvent);
          if (matches.length >= 4) break;
        } catch {}
      }
      if (cancelled) return;
      if (matches.length > 0) {
        setConversationOptions(matches);
        setConversationOptionLabel("Recent conversations using this file");
      } else {
        const recentWithLastEvent: ConvoMeta[] = [];
        for (const convo of active.slice(0, 4)) {
          try {
            const detail = await getConvo(convo.id);
            const lastEventAt = [...detail.messages]
              .reverse()
              .find((message: any) => typeof message?.timestamp === "string")?.timestamp as string | undefined;
            recentWithLastEvent.push({ ...convo, last_event_at: lastEventAt || convo.updated_at });
          } catch {
            recentWithLastEvent.push(convo);
          }
        }
        setConversationOptions(recentWithLastEvent);
        setConversationOptionLabel("Recent conversations");
      }
    };
    void loadConversationOptions();
    return () => {
      cancelled = true;
    };
  }, [panel.file, projectId]);

  const handleStartConversation = useCallback(async () => {
    if (!projectId || !panel.file) return;
    const convo = await createConvo(projectId, `About ${panel.file.path}`);
    navigate(`/${projectId}/${convo.id}?path=${encodeURIComponent(panel.file.path)}`);
  }, [navigate, panel.file, projectId]);

  const handleOpenConversationOption = useCallback((convoId: string) => {
    if (!projectId || !panel.file) return;
    navigate(`/${projectId}/${convoId}?path=${encodeURIComponent(panel.file.path)}&prefill=${encodeURIComponent(`@${panel.file.path} `)}`);
  }, [navigate, panel.file, projectId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {panel.file ? (
          <>
            <div className="app-shell-mobile-menu-inline" style={{ position: "fixed", top: 12, left: 12, zIndex: 90 }}>
              <button onClick={() => closeMobileNavigator()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 9, width: 34, height: 34, color: "var(--text-muted)" }}>
                ☰
              </button>
            </div>
            <FilePanel
              file={panel.file}
              editMode={panel.editMode}
              dirty={panel.dirty}
              saving={panel.saving}
              saveError={panel.saveError}
              externalChange={panel.externalChange}
              onToggleEdit={handleToggleEdit}
              onContentChange={panel.updateContent}
              onSave={panel.saveFile}
              onCancel={panel.cancelEdit}
              onClose={handleClose}
              onReload={panel.reloadFile}
              onDismissExternal={panel.dismissExternalChange}
              onOpenFileFinder={panel.toggleFileFinder}
              canGoBack={panel.canGoBack}
              canGoForward={panel.canGoForward}
              onGoBack={() => {
                const p = panel.goBack();
                if (p) navigate(`/${projectId}/file?path=${encodeURIComponent(p)}`, { replace: true });
              }}
              onGoForward={() => {
                const p = panel.goForward();
                if (p) navigate(`/${projectId}/file?path=${encodeURIComponent(p)}`, { replace: true });
              }}
              onStartConversation={() => {
                void handleStartConversation();
              }}
              conversationDisabled={!panel.file}
              conversationOptions={conversationOptions.map((convo) => ({ id: convo.id, title: convo.title, updated_at: convo.last_event_at || convo.updated_at }))}
              conversationOptionsLabel={conversationOptionLabel}
              conversationModal
              onOpenConversationOption={handleOpenConversationOption}
            />
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Open a file to begin.
          </div>
        )}
      </div>

      {panel.showFileFinder && (
        <FileFinder
          files={panel.fileList || []}
          loading={panel.fileListLoading}
          touchedFiles={[]}
          recentlyViewed={panel.recentlyViewed}
          onSelect={handleOpenFile}
          onClose={panel.toggleFileFinder}
          onRemoveRecent={panel.removeFromRecent}
        />
      )}
    </div>
  );
}
