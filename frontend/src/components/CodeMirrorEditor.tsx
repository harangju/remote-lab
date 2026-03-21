import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment, Annotation, Transaction } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap } from "@codemirror/search";

import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";

interface CodeMirrorEditorProps {
  code: string;
  language: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

export interface CodeMirrorEditorHandle {
  getValue: () => string;
  replaceContent: (value: string, options?: { addToHistory?: boolean }) => void;
}

const langExtensions: Record<string, () => ReturnType<typeof javascript>> = {
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  css: () => css(),
  html: () => html(),
  json: () => json(),
  markdown: () => markdown(),
};

const externalChangeAnnotation = Annotation.define<boolean>();

function getThemeExtension(isDark: boolean) {
  if (isDark) return oneDark;
  return EditorView.theme({
    "&": {
      backgroundColor: "var(--bg)",
      color: "var(--text)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-surface)",
      color: "var(--text-muted)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--border)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(0,0,0,0.03)",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "var(--text)",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(0,0,0,0.1)",
    },
    ".cm-selectionBackground": {
      backgroundColor: "rgba(0,0,0,0.08)",
    },
  });
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor(
  { code, language, readOnly, onChange, onSave },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableComp = useRef(new Compartment());
  const readOnlyComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [isDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? "",
    replaceContent: (value: string, options?: { addToHistory?: boolean }) => {
      const view = viewRef.current;
      if (!view) return;
      const currentDoc = view.state.doc.toString();
      if (currentDoc === value) return;
      const annotations = [externalChangeAnnotation.of(true)];
      if (options?.addToHistory === false) {
        annotations.push(Transaction.addToHistory.of(false));
      }
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
        annotations,
        userEvent: options?.addToHistory === false ? "input.external" : "input",
      });
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = langExtensions[language]?.() || [];
    const saveKeymap = keymap.of([{ key: "Mod-s", run: () => { onSaveRef.current?.(); return true; } }]);

    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        saveKeymap,
        langExt,
        getThemeExtension(isDark),
        editableComp.current.of(EditorView.editable.of(!readOnly)),
        readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.some((tr) => tr.annotation(externalChangeAnnotation))) return;
          onChangeRef.current?.(update.state.doc.toString());
        }),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", fontSize: "0.85rem" },
          ".cm-scroller": { overflow: "auto", fontFamily: "monospace" },
          ".cm-content": { maxWidth: "100%" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [code, language, isDark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        editableComp.current.reconfigure(EditorView.editable.of(!readOnly)),
        readOnlyComp.current.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [readOnly]);

  return <div ref={containerRef} style={{ height: "100%", overflow: "hidden" }} />;
});
