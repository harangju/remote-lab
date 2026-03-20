import { useState, useCallback, useEffect, useRef } from "react";
import { readFile, writeFile, listFiles } from "../api";

class FileSaveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileSaveConflictError";
  }
}


export interface PanelFile {
  projectId: string;
  path: string;
  content: string;
  language: string;
}

export interface PanelState {
  file: PanelFile | null;
  editMode: boolean;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  externalChange: boolean;
  showFileFinder: boolean;
  fileList: string[] | null;
  fileListLoading: boolean;
  showHiddenFiles: boolean;
}

export interface PanelActions {
  openFile: (path: string) => void;
  closePanel: () => boolean; // returns false if blocked by dirty state
  setEditMode: (on: boolean) => void;
  updateContent: (content: string) => void;
  saveFile: () => Promise<void>;
  cancelEdit: () => void;
  toggleFileFinder: () => void;
  setShowHiddenFiles: (on: boolean) => void;
  applyExternalChange: (path: string) => void;
  reloadFile: () => void;
  dismissExternalChange: () => void;
  upsertFileInList: (path: string) => void;
  forceClose: () => void;
}

/** Guess language from file extension. */
export function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", rb: "ruby",
    java: "java", cpp: "cpp", c: "c", h: "c",
    css: "css", scss: "css", html: "html", xml: "xml",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", sh: "bash", zsh: "bash", bash: "bash",
    sql: "sql", graphql: "graphql",
  };
  return map[ext] || "text";
}

export function usePanel(projectId: string | undefined): PanelState & PanelActions {
  const [file, setFile] = useState<PanelFile | null>(null);
  const [editMode, setEditModeRaw] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [fileList, setFileList] = useState<string[] | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const originalContentRef = useRef<string>("");
  const latestContentRef = useRef<string>("");
  const fileRef = useRef<PanelFile | null>(null);
  const dirtyRef = useRef(false);
  const openRequestIdRef = useRef(0);

  useEffect(() => {
    fileRef.current = file;
    latestContentRef.current = file?.content ?? "";
  }, [file]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // beforeunload guard when dirty
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Mobile back button support
  useEffect(() => {
    if (!file) return;
    // Push a state entry when panel opens
    history.pushState({ panel: true }, "");
    const handler = (e: PopStateEvent) => {
      if (e.state?.panel || file) {
        setFile(null);
        setEditModeRaw(false);
        setDirty(false);
        setSaveError(null);
        setExternalChange(false);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [file?.path]); // only re-run when a different file opens

  const openFile = useCallback((path: string) => {
    if (!projectId) return;
    const requestId = ++openRequestIdRef.current;
    readFile(projectId, path)
      .then((res) => {
        if (openRequestIdRef.current !== requestId) return;
        setFile({ projectId, path: res.path, content: res.content, language: langFromPath(path) });
        originalContentRef.current = res.content;
        latestContentRef.current = res.content;
        setEditModeRaw(false);
        setDirty(false);
        setExternalChange(false);
      })
      .catch((err) => {
        if (openRequestIdRef.current !== requestId) return;
        setFile({ projectId, path, content: `Error: ${err.message}`, language: "text" });
        originalContentRef.current = "";
        latestContentRef.current = "";
        setSaveError(null);
      });
  }, [projectId]);

  const closePanel = useCallback((): boolean => {
    if (dirty) return false; // caller should confirm
    setFile(null);
    setEditModeRaw(false);
    setDirty(false);
    setSaveError(null);
    setExternalChange(false);
    return true;
  }, [dirty]);

  const forceClose = useCallback(() => {
    openRequestIdRef.current += 1;
    setFile(null);
    setEditModeRaw(false);
    setDirty(false);
    setSaveError(null);
    setExternalChange(false);
  }, []);

  const setEditMode = useCallback((on: boolean) => {
    setEditModeRaw(on);
  }, []);

  const updateContent = useCallback((content: string) => {
    latestContentRef.current = content;
    setFile((prev) => prev ? { ...prev, content } : null);
    setDirty(content !== originalContentRef.current);
    setSaveError(null);
  }, []);

  const saveFile = useCallback(async () => {
    const currentFile = fileRef.current;
    if (!projectId || !currentFile) return;
    const latestContent = latestContentRef.current;
    setSaving(true);
    try {
      const diskFile = await readFile(projectId, currentFile.path);
      if (diskFile.content !== originalContentRef.current) {
        setExternalChange(true);
        throw new FileSaveConflictError("Could not save because the file changed on disk and your editor is no longer aligned. Reload and try again.");
      }
      await writeFile(projectId, currentFile.path, latestContent);
      originalContentRef.current = latestContent;
      latestContentRef.current = latestContent;
      setFile((prev) => prev && prev.path === currentFile.path ? { ...prev, content: latestContent } : prev);
      setDirty(false);
      setEditModeRaw(false);
      setSaveError(null);
      setExternalChange(false);
    } catch (err: any) {
      setSaveError(err?.message || "Could not save this file.");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [projectId]);

  const cancelEdit = useCallback(() => {
    latestContentRef.current = originalContentRef.current;
    setFile((prev) => prev ? { ...prev, content: originalContentRef.current } : null);
    setDirty(false);
    setSaveError(null);
    setEditModeRaw(false);
  }, []);

  const refreshFileList = useCallback(() => {
    if (!projectId) return;
    setFileListLoading(true);
    listFiles(projectId, { hidden: true })
      .then((res) => setFileList(res.files))
      .catch(() => setFileList([]))
      .finally(() => setFileListLoading(false));
  }, [projectId]);

  const toggleFileFinder = useCallback(() => {
    if (!fileList && !fileListLoading && projectId) {
      refreshFileList();
    }
    setShowFileFinder((v) => !v);
  }, [fileList, fileListLoading, projectId, refreshFileList]);

  useEffect(() => {
    if (showFileFinder) refreshFileList();
  }, [refreshFileList, showFileFinder]);

  const upsertFileInList = useCallback((path: string) => {
    setFileList((prev) => {
      if (!prev) return prev;
      if (prev.includes(path)) return prev;
      return [...prev, path].sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const applyExternalChange = useCallback((path: string) => {
    upsertFileInList(path);
    const currentFile = fileRef.current;
    if (currentFile && currentFile.path === path) {
      if (dirtyRef.current) {
        setExternalChange(true);
      } else if (projectId) {
        readFile(projectId, path)
          .then((res) => {
            setFile((prev) => prev && prev.path === path
              ? { ...prev, content: res.content, language: langFromPath(path) }
              : prev);
            originalContentRef.current = res.content;
            latestContentRef.current = res.content;
            setSaveError(null);
            setExternalChange(false);
            setDirty(false);
          })
          .catch(() => {
            setExternalChange(true);
          });
      }
    }
  }, [projectId, upsertFileInList]);

  const reloadFile = useCallback(() => {
    if (file) {
      openFile(file.path);
    }
  }, [file, openFile]);

  const dismissExternalChange = useCallback(() => {
    setExternalChange(false);
  }, []);

  return {
    file, editMode, dirty, saving, saveError, externalChange,
    showFileFinder, fileList, fileListLoading, showHiddenFiles: false,
    openFile, closePanel, setEditMode, updateContent,
    saveFile, cancelEdit, toggleFileFinder,
    setShowHiddenFiles: () => {},
    applyExternalChange, reloadFile, dismissExternalChange, upsertFileInList, forceClose,
  };
}
