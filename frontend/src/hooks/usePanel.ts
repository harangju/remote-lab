import { useState, useCallback, useEffect, useRef } from "react";
import { readFile, writeFile, listFiles } from "../api";


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
  const [externalChange, setExternalChange] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [fileList, setFileList] = useState<string[] | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const originalContentRef = useRef<string>("");
  const fileRef = useRef<PanelFile | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    fileRef.current = file;
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
        setExternalChange(false);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [file?.path]); // only re-run when a different file opens

  const openFile = useCallback((path: string) => {
    if (!projectId) return;
    readFile(projectId, path)
      .then((res) => {
        setFile({ projectId, path: res.path, content: res.content, language: langFromPath(path) });
        originalContentRef.current = res.content;
        setEditModeRaw(false);
        setDirty(false);
        setExternalChange(false);
      })
      .catch((err) => {
        setFile({ projectId, path, content: `Error: ${err.message}`, language: "text" });
        originalContentRef.current = "";
      });
  }, [projectId]);

  const closePanel = useCallback((): boolean => {
    if (dirty) return false; // caller should confirm
    setFile(null);
    setEditModeRaw(false);
    setDirty(false);
    setExternalChange(false);
    return true;
  }, [dirty]);

  const forceClose = useCallback(() => {
    setFile(null);
    setEditModeRaw(false);
    setDirty(false);
    setExternalChange(false);
  }, []);

  const setEditMode = useCallback((on: boolean) => {
    setEditModeRaw(on);
  }, []);

  const updateContent = useCallback((content: string) => {
    setFile((prev) => prev ? { ...prev, content } : null);
    setDirty(content !== originalContentRef.current);
  }, []);

  const saveFile = useCallback(async () => {
    if (!projectId || !file) return;
    setSaving(true);
    try {
      await writeFile(projectId, file.path, file.content);
      originalContentRef.current = file.content;
      setDirty(false);
      setEditModeRaw(false);
    } finally {
      setSaving(false);
    }
  }, [projectId, file]);

  const cancelEdit = useCallback(() => {
    setFile((prev) => prev ? { ...prev, content: originalContentRef.current } : null);
    setDirty(false);
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
    file, editMode, dirty, saving, externalChange,
    showFileFinder, fileList, fileListLoading, showHiddenFiles: false,
    openFile, closePanel, setEditMode, updateContent,
    saveFile, cancelEdit, toggleFileFinder,
    setShowHiddenFiles: () => {},
    applyExternalChange, reloadFile, dismissExternalChange, upsertFileInList, forceClose,
  };
}
