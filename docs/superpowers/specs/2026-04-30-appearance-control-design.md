# Appearance Control Design

## Goal

Expand the Appearance settings into a complete theme control system. Users should get more varied visual styles and every appearance change should recolor the full application shell and interface, not only the Appearance screen.

## Selected Direction

Use the `Control completo` direction: keep ready-made presets, add a practical advanced color editor, and apply theme changes live through shared CSS variables.

The user also explored the more expressive preset direction before selecting full control, so the new presets should feel visually distinct. They should include professional options with clear changes in background, surfaces, sidebar/header feel, border treatment, and accent behavior.

## Current Context

The app already has:

- `frontend/src/components/settings/AppearanceView.tsx` for appearance controls and live CSS variable application.
- `backend/core/config_theme.py` for default theme storage and preset definitions.
- `frontend/src/index.css` with global CSS tokens such as `--bg-base`, `--bg-surface`, `--accent-primary`, and legacy `--mc-*` aliases.
- Tests around `AppearanceView` and backend theme identity.

Some app areas still use fixed hex colors or module-specific variables. Those areas can visually resist theme changes unless they are moved to shared tokens or covered by compatibility variables.

## Design

### Theme Model

Extend the theme payload without breaking existing saved configs. Existing keys remain valid:

- `bg`
- `bg_secondary`
- `fg`
- `fg_muted`
- `fg_secondary`
- `fg_tertiary`
- `accent`
- `accent_light`
- `accent_hover`
- `accent_dark`
- `border`
- `blue_hover`
- `error`
- `warning`
- `success`
- `orange`

The frontend should derive missing UI tokens from these values where necessary, including elevated surface, input background, active border, accent glow, text on accent, and scrollbar colors. Saved older themes should continue to load by merging with defaults.

### Presets

Add more preset variety in `backend/core/config_theme.py`. The preset list should cover:

- deep technical dark
- clean professional light
- graphite or carbon
- blue/cyan focus
- green/teal operations
- amber or warm utility
- high contrast
- at least two new expressive presets that visibly recolor the full app

Each preset must include all theme keys used by the frontend so switching styles is deterministic.

### Appearance UI

Update `AppearanceView` to expose:

- preset cards with richer previews
- mode selection: dark, light, system
- accent shortcuts
- advanced color controls for core tokens
- live preview that reflects the selected preset and custom edits
- reset and save actions

Advanced editing should update the local visible theme immediately and only persist when the user saves, matching the current save behavior.

### Global Application

`applyThemeToCSS` should set the complete variable surface:

- base, surface, elevated, input backgrounds
- primary, secondary, muted, tertiary text
- accent, hover, light, dark, glow, and readable on-accent text
- subtle and medium borders
- status colors
- legacy `--mc-*` aliases
- scrollbar thumb and selection colors

The root app shell, sidebar, header, main content, cards, form controls, dialogs, toasts, command palette, and shared buttons should use those variables. Where app modules currently use fixed colors, implementation should replace only the colors needed for theme coverage and avoid unrelated layout refactors.

### Compatibility

Saved theme files from earlier versions should keep working. Unknown string keys may pass through, but missing known keys should be filled from `DEFAULT_THEME`.

Mode and density metadata should remain optional strings so existing backend validation still accepts them.

### Accessibility

The existing contrast repair behavior should stay. Text colors must be corrected when a user creates a low-contrast combination. `text-on-accent` should be derived from the selected accent so light accents remain readable.

## Testing And Verification

Add or update focused tests for:

- backend preset list includes the new styles and every preset has required keys
- selecting a preset updates base, surface, accent, border, text, legacy aliases, and scrollbar/selection variables
- advanced color edits update the visible CSS variables before save
- low-contrast themes still repair text color
- light accent colors use dark on-accent text

Run targeted frontend tests for `AppearanceView`, backend theme tests, and frontend typecheck/build if the touched UI changes compile beyond the unit test surface.
