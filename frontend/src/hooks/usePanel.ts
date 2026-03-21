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
  closePanel: () => boolean;
  setEditMode: (on: boolean) => void;
  updateContent: (content: string) => void;
  saveFile: (content?: string) => Promise<void>;
  cancelEdit: () => string;
  toggleFileFinder: () => void;
  setShowHiddenFiles: (on: boolean) => void;
  applyExternalChange: (path: string) => Promise<string | null>;
  reloadFile: () => Promise<string | null>;
  dismissExternalChange: () => void;
  upsertFileInList: (path: string) => void;
  forceClose: () => void;
}

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

function isPreviewOnlyPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".html") || lower.endsWith(".htm");
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
  const originalContentRef = useRef("");
  const latestContentRef = useRef("");
  const fileRef = useRef<PanelFile | null>(null);
  const dirtyRef = useRef(false);
  const openRequestIdRef = useRef(0);

  useEffect(() => {
    fileRef.current = file;
    if (!dirtyRef.current) {
      latestContentRef.current = file?.content ?? "";
    }
  }, [file]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!file) return;
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
  }, [file?.path]);

  const openFile = useCallback((path: string) => {
    if (!projectId) return;
    const requestId = ++openRequestIdRef.current;

    if (isPreviewOnlyPath(path)) {
      setFile({ projectId, path, content: "", language: langFromPath(path) });
      originalContentRef.current = "";
      latestContentRef.current = "";
      setEditModeRaw(false);
      setDirty(false);
      setSaveError(null);
      setExternalChange(false);
      return;
    }

    readFile(projectId, path)
      .then((res) => {
        if (openRequestIdRef.current !== requestId) return;
        setFile({ projectId, path: res.path, content: res.content, language: langFromPath(path) });
        originalContentRef.current = res.content;
        latestContentRef.current = res.content;
        setEditModeRaw(false);
        setDirty(false);
        setSaveError(null);
        setExternalChange(false);
      })
      .catch((err) => {
        if (openRequestIdRef.current !== requestId) return;
        setFile({ projectId, path, content: `Error: ${err.message}`, language: "text" });
        originalContentRef.current = "";
        latestContentRef.current = "";
        setEditModeRaw(false);
        setDirty(false);
        setSaveError(null);
        setExternalChange(false);
      });
  }, [projectId]);

  const closePanel = useCallback((): boolean => {
    if (dirty) return false;
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
    setDirty(content !== originalContentRef.current);
    setSaveError(null);
  }, []);

  const saveFile = useCallback(async (content?: string) => {
    const currentFile = fileRef.current;
    if (!projectId || !currentFile) return;
    const latestContent = content ?? latestContentRef.current;
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
    setDirty(false);
    setSaveError(null);
    setEditModeRaw(false);
    return originalContentRef.current;
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

  const applyExternalChange = useCallback(async (path: string): Promise<string | null> => {
    upsertFileInList(path);
    const currentFile = fileRef.current;
    if (!currentFile || currentFile.path !== path) return null;
    if (dirtyRef.current) {
      setExternalChange(true);
      return null;
    }
    if (!projectId) return null;
    try {
      const res = await readFile(projectId, path);
      if (fileRef.current?.path !== path) return null;
      setFile((prev) => prev && prev.path === path
        ? { ...prev, content: res.content, language: langFromPath(path) }
        : prev);
      originalContentRef.current = res.content;
      latestContentRef.current = res.content;
      setSaveError(null);
      setExternalChange(false);
      setDirty(false);
      return res.content;
    } catch {
      setExternalChange(true);
      return null;
    }
  }, [projectId, upsertFileInList]);

  const reloadFile = useCallback(async (): Promise<string | null> => {
    const currentFile = fileRef.current;
    if (!projectId || !currentFile) return null;
    const requestId = ++openRequestIdRef.current;

    if (isPreviewOnlyPath(currentFile.path)) {
      if (openRequestIdRef.current !== requestId || fileRef.current?.path !== currentFile.path) return null;
      setFile((prev) => prev && prev.path === currentFile.path
        ? { ...prev, content: "", language: langFromPath(currentFile.path) }
        : prev);
      originalContentRef.current = "";
      latestContentRef.current = "";
      setEditModeRaw(false);
      setDirty(false);
      setSaveError(null);
      setExternalChange(false);
      return "";
    }

    try {
      const res = await readFile(projectId, currentFile.path);
      if (openRequestIdRef.current !== requestId || fileRef.current?.path !== currentFile.path) return null;
      setFile((prev) => prev && prev.path === currentFile.path
        ? { ...prev, content: res.content, language: langFromPath(currentFile.path) }
        : prev);
      originalContentRef.current = res.content;
      latestContentRef.current = res.content;
      setEditModeRaw(false);
      setDirty(false);
      setSaveError(null);
      setExternalChange(false);
      return res.content;
    } catch (err: any) {
      setSaveError(err?.message || "Could not reload this file.");
      return null;
    }
  }, [projectId]);

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
