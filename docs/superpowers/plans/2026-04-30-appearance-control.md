# Appearance Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add varied appearance presets plus advanced color control that recolors the full HidroConvert interface through shared theme tokens.

**Architecture:** Backend owns preset definitions and compatibility defaults. Frontend owns live theme composition, derived CSS variables, contrast repair, advanced color editing, and token-based rendering. Existing saved themes remain valid by merging missing keys with defaults.

**Tech Stack:** Python backend config module, React 18, TypeScript, Vitest, Testing Library, Tailwind CSS variables.

---

### Task 1: Backend Preset Coverage

**Files:**
- Modify: `tests/test_config_theme.py`
- Modify: `backend/core/config_theme.py`

- [ ] **Step 1: Write the failing test**

Add tests that every preset has every required theme key and that the preset list includes new expressive styles:

```python
from backend.core.config_theme import DEFAULT_THEME, get_preset_names, load_preset


def test_all_presets_define_required_theme_keys() -> None:
    required = set(DEFAULT_THEME)
    for name in get_preset_names():
        preset = load_preset(name)
        assert required.issubset(preset.keys()), name


def test_preset_list_includes_varied_appearance_styles() -> None:
    names = set(get_preset_names())
    assert {"Solar Claro", "Bosque Operativo", "Amanecer Ambar", "Neon Grid"}.issubset(names)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_config_theme.py -v`

Expected: FAIL because the new preset names do not exist.

- [ ] **Step 3: Implement backend presets**

Add complete preset dictionaries to `PRESETS` in `backend/core/config_theme.py`, keeping every key from `DEFAULT_THEME`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_config_theme.py -v`

Expected: PASS.

### Task 2: Frontend Theme Variable Coverage

**Files:**
- Modify: `frontend/src/components/settings/AppearanceView.test.tsx`
- Modify: `frontend/src/components/settings/AppearanceView.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Write failing tests**

Add tests that preset application sets base, elevated, input, border, legacy alias, scrollbar, selection, and status variables, and that advanced color controls update CSS variables before save.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/settings/AppearanceView.test.tsx`

Expected: FAIL because the new controls and variables are missing.

- [ ] **Step 3: Implement full CSS variable application**

Extend theme composition to derive `--bg-elevated`, `--bg-input`, full text variables, border variables, status colors, scrollbar colors, selection colors, and all existing `--mc-*` compatibility aliases.

- [ ] **Step 4: Add advanced color controls**

Add an “Editor avanzado” section in `AppearanceView` with color input plus text input for core tokens. Edits update local theme state immediately and apply live; save persists the composed theme.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/settings/AppearanceView.test.tsx`

Expected: PASS.

### Task 3: Shared Interface Token Cleanup

**Files:**
- Modify: `frontend/src/index.css`
- Modify only if needed: shared components under `frontend/src/components/ui/`
- Modify only if needed: `frontend/src/components/layout/Header.tsx`
- Modify only if needed: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Search for fixed shell colors**

Run: `rg "#[0-9A-Fa-f]{6}|rgba\\(" frontend/src/components/layout frontend/src/components/ui frontend/src/index.css`

- [ ] **Step 2: Replace fixed shell colors needed for theme coverage**

Use shared CSS variables for app shell, shared controls, focus rings, scrollbars, selection, and component surfaces. Do not refactor layout.

- [ ] **Step 3: Verify compile surface**

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- All files changed above

- [ ] **Step 1: Run targeted backend tests**

Run: `python -m pytest tests/test_config_theme.py -v`

Expected: PASS.

- [ ] **Step 2: Run targeted frontend tests**

Run: `cd frontend && npx vitest run src/components/settings/AppearanceView.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 4: Review diff**

Run: `git diff -- backend/core/config_theme.py tests/test_config_theme.py frontend/src/components/settings/AppearanceView.tsx frontend/src/components/settings/AppearanceView.test.tsx frontend/src/index.css`

Expected: Only appearance-control changes are present.
