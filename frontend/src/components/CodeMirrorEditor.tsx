import React, { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap } from "@codemirror/search";

// Language imports — loaded statically since CodeMirror is already lazy-loaded at the panel level
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

function getThemeExtension(isDark: boolean) {
  if (isDark) return oneDark;
  // Light theme — minimal custom styling to match app theme
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

export function CodeMirrorEditor({ code, language, readOnly, onChange, onSave }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableComp = useRef(new Compartment());
  const readOnlyComp = useRef(new Compartment());
  const [isDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = langExtensions[language]?.() || [];
    const saveKeymap = onSave
      ? keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }])
      : [];

    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search(),
        keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
        saveKeymap,
        langExt,
        getThemeExtension(isDark),
        editableComp.current.of(EditorView.editable.of(!readOnly)),
        readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString());
          }
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
  }, [language, isDark]); // Recreate on language or theme change

  // Update readOnly without recreating
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

  // Update content when code changes externally (file switch, reload)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== code) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: code },
      });
    }
  }, [code]);

  return <div ref={containerRef} style={{ height: "100%", overflow: "hidden" }} />;
}
