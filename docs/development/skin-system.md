# Skin system

> Updated: 2026-10-17
> Status: architecture approved by the author on 2026-10-17; slice 13 settles the native skins

A skin changes how VUA looks and moves without changing what it does. VUA ships the current
purple style as its default skin and the author's two briefs (Y2K, Jirai-kei) as native skins;
the same format can later admit community skins. The [current plan](current-plan.md) schedules
the skin work as slice 13; this document fixes the architecture now so the screens built before
then are ready for it. The [design standard](../design/design-standard.md) keeps the
community-skin direction.

## What a skin can change

| Layer | Contents | How the app consumes it |
| --- | --- | --- |
| Color | surfaces, text, borders, the two module accents, the four room colors, status colors, per dark and light | CSS custom properties (`--vua-*`) |
| Type | font families (bundled WOFF2 with its license), the type scale | `--vua-font-*` shorthands, used with `font:`; the default families follow a skin's fonts for any glyph they lack, so all four UI languages render |
| Shape | corner style (cut, round, scalloped, lace edge), radii, border weights | shape tokens; clip-path and mask presets chosen by name |
| Motion | durations, easing, camera flight time, ambient motion strength | `--vua-motion-*` tokens and the scene engine |
| Effects | glow, gradients, surface textures, background pattern | existing `--vua-glow-*`, `--vua-aurora-*`, `--vua-shine` plus a pattern slot |
| Motifs | decorative images in named slots: page corners, room plates, empty states, dialog headers, the base-map frame | `data-skin-slot` elements that render a skin's image or nothing |
| Icons | an optional replacement icon set | the `Icon` component looks up the skin's sanitized SVG before the default |
| Factory scenes | the base map's room interiors: backdrops, props, characters, particles | a scene pack: sprites plus a declarative layer description (below) |
| Sound | reserved for later | — |

A skin never changes text, layout order, controls, focus behavior or what a screen shows. High
contrast and Windows forced colors override every skin, and resource-saving mode stills every
skin's motion, so the accessibility gates hold for all skins.

## Package format

A skin is a folder or a `.vuaskin` zip with a manifest:

- `manifest.json`: `schemaVersion`, `id`, `version`, names and descriptions in the four UI
  languages, author, SPDX license and a rights statement for every asset, minimum VUA version,
  preview images;
- `tokens.dark.json` and/or `tokens.light.json`: values for the documented token set only, each
  typed (color, length, duration, easing, enum) and range-checked; a skin omits what it keeps
  from the default. A skin may provide one mode only (Y2K is light only); while it is active,
  Appearance shows the theme switch locked to that mode and Windows' theme does not change it;
- `motifs/`, `icons/`, `fonts/`, `scenes/`: images (PNG, WebP, sanitized SVG), WOFF2 fonts,
  scene packs.

The contract lives in a versioned protocol document (`docs/protocols/skin-v0.1.md`, Candidate) with
a JSON Schema under `schemas/skin/v0.1/`. Native skins use the same format, so the format is proven
by VUA's own skins before anyone else uses it.

## Safety for community skins

A skin is data. It carries no JavaScript and no raw CSS:

- token values are parsed by type and written as custom properties; a value cannot carry `url()`,
  `@import` or a selector;
- SVG passes a sanitizer (no scripts, event attributes, `foreignObject` or external references);
- assets load from a local `vua-skin://` protocol under the renderer's content security policy,
  never from the network;
- size limits per file and per skin; image dimensions are capped;
- contrast is computed for every text/background pair the token set defines, in dark and light,
  with the same rules as `check-contrast`; a skin below WCAG AA does not apply and the player
  sees which pairs failed.

Installation starts with local import (Appearance → Import skin, or dropping the file). A shared
catalog, signing and review are a later decision; the format already records author, license and
rights so a catalog can rely on them.

## Factory scene packs

The base map's interiors are drawn by a scene engine in a 400 × 190 space aligned to the room's
bottom, with live room facts (Recipe count, package count, line stations, the latest finished
Avatar). Today each room is drawn in code. The engine gains a declarative path:

- a scene is a list of layers: images or sprite-sheet animations with a position, size, anchor
  and depth;
- motion is one of a fixed set: bob, sway, blink, scroll, walk a path, rotate, frame sequence,
  particles (with count, life and spread);
- bindings connect layers to facts: repeat a prop for each package (up to a cap), place the crate
  at the active station, light a lamp by station state, show the finished Avatar on the stage;
- slots name the places a pack fills, so a pack can replace only the workers or only the backdrop.

The current code-drawn scenes become the default pack's fallback. Resource-saving mode draws one
frame. A pack that fails validation falls back to the default scene for that room.

## Native skins

| Skin | Color | Shape and motifs | Motion |
| --- | --- | --- | --- |
| **Default** | the current purple and orange | cut corners, grid canvas | current |
| **Y2K** | aqua and white | flat, rounded pill shapes; bandages, pills, angel wings | light, bouncy |
| **Jirai-kei** | pink and black | lace edges, leather textures, energy drinks; dimensional | slower, softer |

Each needs the author's design session (slice 13) for the exact values, motifs and scene art.

## What to do before slice 13

Rules for every screen built from now on, including the control center and release work in
progress:

1. Colors, radii, shadows, font sizes and durations come from tokens; new screens add tokens
   instead of literals. Fonts use the shorthand tokens with `font:`.
2. Room colors get their own tokens (`--vua-room-control`, `--vua-room-materials`,
   `--vua-room-workshop`, `--vua-room-release`). Status colors keep their meaning and are not used
   as room colors.
3. Shapes come from named presets (`--vua-shape-*` with clip-path classes) instead of inline
   polygons.
4. Decorative extras sit in `data-skin-slot` elements; a screen works and reads the same with
   every slot empty.
5. Canvas and WebGL drawing reads its colors from tokens through one palette helper and keeps its
   motion parameters in one place, so the scene engine and packs can take them over.
6. Motion honors resource-saving mode through one hook; scripted motion does not rely on CSS
   transitions.

Work in order:

1. Room color, shape and motion tokens (in place since 2026-10-17: `--vua-room-*`,
   `--vua-shape-*`, `--vua-motion-*`, `--vua-scene-*`); the factory, workshop, control center and
   release pages move to them; fix the `font-size: var(--vua-font-*)` uses (a shorthand is not a size).
2. A token linter: new literal colors, durations and radii in CSS fail the check, with an
   allowlist for the remaining legacy files that shrinks over time.
3. The skin loader with the default skin expressed as a package, the schema, validation and the
   contrast gate; Appearance shows the default only.
4. Slice 13: the design session, Y2K and Jirai-kei as packages, one-click switching in Appearance
   and the command palette, the scene engine's declarative path.
5. Community import once the author decides the distribution model.

## Decisions

The author decided on 2026-10-17:

- A skin may recolor the two module accents; each skin still gives the two modules distinct
  accents, checked for contrast pair by pair.
- Community skins start with local import; a shared catalog with review is decided later.
- Community skins may replace the factory scenes through scene packs.

- A skin may bring its own fonts; VUA's default font families stay behind them as fallbacks for
  missing glyphs, and the four-language review checks each skin's text.
- A skin may support one mode only; the theme switch is then locked to that mode.
