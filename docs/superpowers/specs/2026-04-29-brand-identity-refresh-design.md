# HidroConvert Brand Identity Refresh Design

## Goal

Refresh HidroConvert with a professional `Precision Linear` identity inspired by the user's selected direction from getdesign.md references: dark, minimal, exact, and technical, with indigo and teal accents.

## Brand Direction

The identity should feel like a serious desktop productivity tool for image conversion, batch renaming, PDF formats, padrones, volantes, database work, and history review. It should move away from the current warm Mastercard-like orange system and toward a sharper operational system.

The logo will use an abstract `HC` monogram with a subtle conversion cue. It should avoid a literal busy icon and instead work as a compact app mark, sidebar mark, and SVG asset.

## Visual System

- Base surfaces: near-black graphite values for the app shell and panels.
- Primary accent: indigo for selection, focus, active state, and progress.
- Secondary accent: teal for conversion/completion hints and gradient depth.
- Type: keep the existing Inter-based stack, with clean weight and no decorative typography.
- Shape language: reduce overly soft rounded shapes where practical, keeping compact radii that match a professional desktop tool.

## Implementation Scope

This pass updates the global brand constants, app logo asset, sidebar brand lockup, common accent variables, Tailwind color aliases, and documentation references. The change must preserve existing app behavior and avoid broad layout refactors.

## Testing And Verification

Add a focused frontend component test for the new brand mark/lockup. Run the targeted test, then run the frontend typecheck/build command that proves the React/Tailwind changes compile.
