# World direction: the new references and the swing storyboard

October 2026. The new Midjourney sets in `world-reference/` (63 images, three families) and the
storyboard `Memory-at-the-Empty-Swing.png`, read against the game as it stands and its canon.
References are named by their Midjourney job (the 8-character id) and variant.

## What the references bring

**Astral desert** (`7619dcf9`, `f9ff553b`, `fe3b5a64`). Pale dunes under a clear sky; masses of
rock hanging in the air, veined with cyan crystal; a vast ring of light (a swirling vortex in
`f9ff553b_0/3`, a glass sphere in `fe3b5a64_0/1`); pillars of light falling from the sky
(`f9ff553b_2`).

**Astral forest** (`79c99c57`, `b3821236`). Giant old trees whose crowns are luminous: cyan motes
instead of leaves, light dripping through them into still water, pale flowers in the foreground.

**Astral ruins** (most of the set). Classical and gothic ruins, columns, a cathedral spire, half
sunk in still water and overgrown; whole buildings hanging upside down in the sky; crystal
erupting out of the stone in sheets and wings (`0d910b36_3`, `f2a07fae_*`); light pillars again;
a few with fire and embers (`59d6a06b`, `21b6dfc4_2/3`, `297dd90b`).

Common to all: a low camera, wet ground and puddles that mirror everything, cyan sparkle, a lone
figure small against something vast.

## The happy medium

The storyboard is the anchor: it is truer to AFTERIMAGE than the world sets. Warm low sun through
haze, wet ground, ruin given back to plants, rust, her ceramic and cyan, the yellow coat. The
world sets are a palette of *ideas*, mostly too blue, too clean and too high-fantasy to take as
they are.

**Keep from them (they fit the canon and extend what's already in the game):**
1. **The ring as a vortex.** The game's ring of light (`world/ring.ts`) could become what
   `f9ff553b_0/3` and `f3e2ac2e_3` show: a slow spiral of light and crystal dust drawn into
   it, not a clean torus. It is the strongest image in the set and the game already points at it.
2. **Memory as crystal.** Cyan crystal growing out of ruin (`0d910b36_3`, `f2a07fae_*`,
   `09fcda74_*`) is her colour: what she remembers, made solid. The far shard (`landmarkShard.ts`)
   and the memory panes are already this. It could also show at each afterimage site once found:
   a small growth of crystal where her echo stood.
3. **Light pillars as guidance.** A beam falling from the sky onto a place (`f9ff553b_2`,
   `0d910b36_0`, `8907aa21_2`) points the way without any UI. That fits "searching, not being
   told". Use one at a time, faint until she's lost.
4. **Dead trees that remember.** The luminous crowns of the forest set, used sparingly: the
   grove stays dead and thorned, but a tree at a found afterimage carries a few motes of cyan
   light in its branches afterward. The world answers what she recovers.
5. **The upside-down world.** Hanging buildings and rock (`fe3b5a64_*`, `229553e9_*`) extend the
   inverted grove already in the sky: ruins of the arcade and the city hanging there too.
6. **Still water that mirrors ruins.** Already central; the sets confirm it. More shallow sheets
   of water across ruin floors.

**Adapt, don't copy:**
- **Palette.** Keep the warm haze as the world's base. The teal and blue skies belong to *other*
  places: the other side (chapter VI's night), inside memories, or near the ring. The contrast
  between them would then carry meaning: warm is the present, cool is memory.
- **Architecture.** Gothic and cathedral scale reads as another world's history. Prefer what the
  storyboard shows, ordinary concrete: blocks of flats, poles and wires, a playground, the
  refuge's industrial gate and arcade. Use a classical column or spire only as distant
  silhouette.

**Leave out:** the robed and eared figures (other characters, not her), the burning city (unless
the story calls for it: it reads as war, not collapse), lush green undergrowth near the path.

## The storyboard: "Memory at the Empty Swing"

Nine panels:
1. She walks alone down an overgrown street of abandoned flats toward a playground.
2. She stands by a rusted swing set; one seat still sways.
3. She kneels and reaches for a weathered photograph on the wet ground.
4. Close on her hand lifting it: in the photo, she and the child hold hands by this swing.
5. Over her shoulder, the photo held in both hands.
6. A memory: the child's small hand in a yellow sleeve takes hers.
7. Close on her face, the red line on her cheek.
8. She sits on the swing, the photo held to her chest.
9. She walks away down the street, seen through the swing's chains.

**Canon check.** The child appears only in the photo and in a memory flash (her hand and sleeve),
never in the present; that holds. Nothing is narrated; it can stay wordless, under music.

**As a chapter.** It fits after the crossing and the still pool, or as an optional afterimage
off the way out. It's a place she was happy, found by following the strip, and it gives her a
reason to keep going. Proposed:
- **Arrival.** The strip leans toward the city edge. A street opens between ruined blocks
  (panel 1). One swing seat moving with no wind is the cue; its creak carries.
- **The photo.** It lies face down in a puddle. She kneels to it (hold E, as at the pool), lifts
  it and turns it over (panels 3–5). It joins her memory panes: the first pane that is a real
  photograph, not a kept frame.
- **The memory.** Closing her eyes (the game's existing gesture) brings the flash: the small
  hand taking hers (panel 6), as a fractured memory insert like Part II's past. That needs either
  a short new film clip or an in-engine shot of the hand and sleeve only (the child's model
  exists; her hand alone keeps canon).
- **The swing.** She sits; the player rocks it gently (forward and back, like the beam's lean but
  calm). The camera holds on her with the photo to her chest (panel 8). The music comes forward
  here, perhaps the main theme's quiet close.
- **Leaving.** She stands and walks away; the camera stays with the empty swing (panel 9).

**What it needs:**
- **Blender:** a rusted swing set with hanging chains (swinging, so rigged or simulated in
  three.js); a bench; low walls and fences; modular concrete blocks of flats (broken windows,
  balconies, overgrown); utility poles and wires; ivy and weeds; the photo as a card prop.
- **three.js:** the street as a small new area (its own path, haze, puddles); the swing physics;
  the photo's texture (cropped from the storyboard's panel 4 to start); the memory insert; a
  music cue.
- **Story:** where it sits in the chapter order, and whether the photo changes anything after:
  e.g. the album, or her pause at the gate.

## Suggested order

1. **The ring as a vortex**, and **light pillars as guidance**: both three.js only, and they lift
   every chapter.
2. **Crystal at found sites** and **dead trees that remember**: small, and they make recovering
   memories visible in the world.
3. **The swing chapter**: the Blender kit first (playground, street blocks), then the scene.
4. **More of the world hanging upside down** in the sky, from the new street kit.
