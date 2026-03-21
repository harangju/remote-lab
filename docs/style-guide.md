# Frontend style guide

This frontend uses **inline React styles plus shared tokens/primitives** from `frontend/src/styles.ts`.
The goal is not to invent a large design system; it is to keep the UI visually coherent and make styling changes cheap.

## Core rule

When adding or changing UI:

- prefer **semantic tokens** from `styles.ts`
- prefer **shared primitives** over repeating style objects
- avoid raw hex values in component files unless the case is truly one-off
- if a style pattern appears in 2+ places, promote it into `styles.ts`

## Design tokens

Defined in `frontend/src/styles.ts`.

### Colors

Use semantic colors, not literal values:

- `colors.bg`
- `colors.bgSurface`
- `colors.bgSurfaceHover`
- `colors.border`
- `colors.borderStrong`
- `colors.text`
- `colors.textMuted`
- `colors.accent`
- `colors.accentSoft`
- `colors.success`
- `colors.successSoft`
- `colors.warning`
- `colors.warningSoft`
- `colors.danger`
- `colors.dangerSoft`
- `colors.overlay`
- `colors.codeBg`

Guideline:
- use `success/warning/danger` for status meaning
- use `accent` for primary product emphasis
- use `textMuted` for secondary text/icons
- use `bgSurface` for cards, panels, chips, headers, popovers

### Radius

Use shared radius tokens:

- `radius.sm`
- `radius.md`
- `radius.lg`
- `radius.xl`
- `radius.pill`

Default mapping:
- small inline affordances: `sm`
- buttons/inputs/chips: `md`
- cards/attachment pills: `lg`
- modals/popovers/banners: `xl`
- circular or rounded controls: `pill`

### Shadow

- `shadow.overlay` — modal/popover elevation
- `shadow.focus` — active drag/focus halo treatment

### Sizing / layering / motion

- `controlSize.icon`
- `zIndex.overlayBackdrop`
- `zIndex.overlayPanel`
- `zIndex.tooltip`
- `transition.fast`
- `transition.button`

## Shared primitives

Use these before inventing local styles:

### Buttons

- `btnPrimary` — main solid action
- `btnSubtle` — secondary outlined/subtle action
- `btnIcon` — standard icon-only control

Guideline:
- don’t hand-roll icon button dimensions in component files
- if you need a variant, compose from `btnIcon`

### Inputs / cards

- `input`
- `card`
- `container`

### Overlay primitives

- `overlayBackdrop`
- `overlayPanel`
- `overlayHeader`

Use these for:
- modals
- pickers
- anchored popovers
- command palettes / file finders

### Rows

- `interactiveRow(selected?)`

Use for clickable list rows in menus, pickers, and modal lists.

## Component-level conventions

### Chat / tool UI

- tool chips should use shared surface/border tokens
- diff/status colors should come from semantic success/warning/danger tokens
- approval controls should use `btnPrimary` / `btnSubtle`

### Popovers / modals

- use `overlayPanel` and `overlayHeader`
- don’t hardcode separate modal shadows/borders unless necessary
- keep overlay surfaces visually consistent across file finder, list modal, and anchored menus

### File / conversation rows

- use `interactiveRow()` for clickable rows
- use `colors.textMuted` for secondary metadata/icons
- use semantic status dots instead of raw hex colors

## What to avoid

Avoid this in component files unless unavoidable:

- raw hex colors like `#c4554d`
- repeated `boxShadow` strings
- repeated overlay z-index values
- repeated border-radius literals for common controls
- ad hoc success/warning/error colors that bypass semantic tokens

## When to add a new token or primitive

Add to `styles.ts` when:

- a literal value appears repeatedly
- a visual pattern repeats across surfaces
- the value expresses semantic meaning, not just one component’s implementation

Do **not** add a token for every one-off value.
Keep the layer small and practical.

## Current styling architecture

This project intentionally stays with:

- inline `React.CSSProperties`
- CSS variables injected by `injectTheme()`
- a small shared token/primitives layer in `styles.ts`

So the standard is:

1. use inline styles for local layout
2. use shared tokens for visual language
3. extract only repeated patterns

## Quick checklist for PRs

Before finishing a frontend styling change, check:

- Are colors semantic instead of literal?
- Are repeated button/panel styles using shared primitives?
- Did I introduce a pattern that belongs in `styles.ts`?
- Does the change still work in light and dark mode?
- Did I rebuild the frontend?
