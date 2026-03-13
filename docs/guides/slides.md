# Slides

Remote Lab can build [Marp](https://marp.app/) slide decks from Markdown and serve them as HTML presentations.

## How it works

Slide source files are Markdown with Marp front matter. Marp CLI compiles them to self-contained HTML files in `public/`, which Caddy serves as static files.

## Building slides

Marp CLI is installed globally via `bun install -g @marp-team/marp-cli`. It works from any working directory:

```bash
# Build a single deck
marp --html slides.md -o /srv/remote-lab/public/slides.html

# Build all decks in a directory
marp --html slides/ -o /srv/remote-lab/public/
```

## Slide format

A minimal Marp slide deck:

```markdown
---
marp: true
title: My Presentation
---

# Slide 1

Content here.

---

# Slide 2

More content.
```

Key Marp features:

- `---` separates slides
- `marp: true` in front matter enables Marp processing
- Supports standard Markdown plus Marp directives (`theme`, `paginate`, `header`, `footer`, etc.)
- Images, code blocks, and math (KaTeX) all work

See the [Marp documentation](https://marpit.marp.app/markdown) for the full directive reference.

## Viewing slides

Built HTML files in `public/` are served at the site root. For example, `public/week1.html` is accessible at `/week1.html`.
