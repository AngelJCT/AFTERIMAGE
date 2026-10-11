# AFTERIMAGE — playable

A linear, third-person three.js (WebGPU, with WebGL2 fallback) adaptation of the AFTERIMAGE films.

```bash
npm install
npm run dev      # http://localhost:5180
```

Dev URL flags:
- `?inspect=still`: development-only character/reference viewer. Also accepts `walk`, `run`, `start-stop`, `walk-run`, `turns`, and `slope`; older `scene` / `portrait` links still work. Locked cameras, lighting presets, source artwork, overlays, timeline seeking and frame stepping bypass the story without changing saved progress. **Save comparison** downloads a labelled PNG pair and saves a clean frame in `.shots/`. **Copy view link** preserves the camera, light, time, reference and alignment. See [the comparison guide](docs/movement-reference.md).
- `?inspect=still&view=artwork&ref=artwork&q=high`: the [flooded grove visual milestone](docs/art-milestone.md), with a fixed 65 mm camera and depth of field for comparing shipped assets with the key artwork.
- The [layered armor study](docs/layered-armor.md) documents the overlapping ceramic geometry, matched before/after images, and rebuild command.
- The [opening grove and pool pass](docs/environment-pass.md) compares the revised ground, shorelines, trees, water and lighting, with validation and rendering costs.
- The [grove composition and refuge gate pass](docs/gate-approach-pass.md) refines the undergrowth, masonry, paving and arcade details, with matched daylight/overcast comparisons and gate mechanism checks.
- The [lighting and atmospheric depth pass](docs/lighting-depth-pass.md) balances the wake-to-gate route, adds contact shading on high quality, and makes sun glow and surface sparkle follow the weather.
- The [landmark geometry pass](docs/landmark-geometry-pass.md) gives trees a stronger taper, branching roots and smaller mineral growth, and adds fractured rock beds with clear pool approaches.
- `?beat=<name>` jumps straight to a beat: `coldOpen`, `lying`, `eyesClosed`, `rise`, `explore`, `reflection`, `ending`, `grove`, `gate`, `memory`, `trace`
- Dev builds show a **skip ›** button (top-right, or press N). It skips the current cutscene: in the grove it counts the next afterimage as found and resumes after it; elsewhere it moves on to the next beat.
- `?q=high` or `?q=low` forces a quality tier (by default touch devices get `low`)
- `?body=placeholder` uses the stand-in body instead of the rigged character
- `?fixedres` turns off the adaptive resolution

Dev console (`src/debug.ts`, dev builds only): `__freeze()`, `__step(n, dt = 1/60)`, `__snap(n)`, `__resume()`, `await __drive(seconds, until?)` (runs game time by hand when the tab is hidden and rAF is paused, yielding so story beats advance), `await __begin()`, `__shot(pos, target, lens)`, and `await __save(name, width)`, which saves the current pose without advancing time to `game/.shots/<name>.jpg`. `__render()` redraws without advancing the simulation. `game` is the live Game.

**Playthrough check:** `await __autoplay(seconds)` plays on by itself:
- It walks to the guide's goal, the compass target or the grove's waypoint, and keeps to chapter VI's causeway.
- It holds the action while a prompt shows (and after a "hold" one), taps E for press prompts, and holds S to lower the hand.
- It balances on chapter V's beam, holds forward through the squeeze, and holds ← in the chase.
- It returns the beats it passed and any errors, and saves `.shots/auto_<n>_<beat>.jpg` at each new beat.
- Run it in chunks of about 25 s (the browser tool's limit). From `?beat=coldOpen` it has played the whole story to the credits; it does overwrite saved progress, so back that up first.

Controls:
- Desktop: WASD to move, Shift to run, drag to look, E to interact (hold it to close her eyes), S (or drag down) to lower the hand. Shift+S is fast. Esc or P pauses.
- Touch: left thumb is a stick, right side drags to look (pinch with a second finger to zoom), the on-screen button interacts (hold it to close her eyes), drag down lowers the hand. The II button at the top right pauses.
- Gamepad (standard mapping):
  - left stick moves (and lowers the hand), right stick looks;
  - A interacts, RT or L3 runs, LB / RB zoom out / in, R3 recentres the view;
  - Start pauses, Y is photo mode;
  - in menus and on the title screen, the d-pad or left stick moves between buttons, A presses and B goes back;
  - prompts name the pad's buttons once it's in use.
- Sound of movement (`core/audio.ts` `movement`): no footsteps, since they read as percussion. Instead:
  - a water swish that swells with her pace and the depth over her feet when she wades;
  - a faint air-and-cloth bed whenever she moves;
  - now and then, as she turns or kneels, a soft ceramic creak of her shell, with a slow attack and no click.
  - The ring has a low drone (detuned fifths) when you face it, stronger as more of it is drawn.
- Idle (`player/animator.ts`): left standing a while, she now and then looks off to one side (alternating sides) or down at the ground before her, on top of the weight shifts and breathing.
- Camera: the wheel (or a trackpad pinch, or `-` / `=`) zooms, and the zoom is remembered. R recentres the view behind her.

## Part I (complete)

The first film plays through Part I in a window of broken crystal (`story/filmWindow.ts`, `public/video/part1_film.mp4`: film I rebuilt frame for frame from the clean clips in `clips/part1/`). Its narration is spoken word for word at the film's own times, while the game stages each of the film's shots behind the window: the same moment, here. What she does stays playable, and it drives the film.

| Beat | Film shots (s) | Play |
|---|---|---|
| `coldOpen` | wide 0–10, eye 10–17, hand 17–24 | The game's wide and eye close-up run behind the film's. At "my hand reached for the water" the window closes for **the gentle touch** (slow leaves one ring, fast splashes). Then the film's hand plays over hers |
| `lying` | from above 24–31 | Top-down on the cracked ground. **Stillness is the input**: the film runs while she lies still; moving makes her stir and the memory stalls, trembling |
| `eyesClosed` | profile 31–38, port 38–44 | Her face behind the film's profile. At "I closed my eyes" the film waits for you to **hold to close her eyes**, then runs only while they're held. The game cuts to the port with the film |
| `rise` | standing 44–51 | She gets up and looks at her hands, palms up, as in the film |
| `explore` | none | A free walk through the grove to the still pool (the film's lines for it have been spoken) |
| `reflection` | reflection 51–58 | She kneels and sees her face in the water. After "in my reflection I saw someone lost" the film waits while she **touches the reflection gently** |
| `ending` | walking 58–69 | She walks toward the light and the arches, the camera behind her head, then a fade to white and the end card |

Progress is saved at each beat (Continue on the title screen, and "restart from checkpoint" in the pause menu).

## Minimal UI and the guide

- **The guide:** a faint mote of warm light (`world/guide.ts`) that drifts a few metres ahead toward where she should go, weaving a little, waiting (and pulsing) if she falls behind, trailing a few sparks. The story sets its goal: the still pool during the prologue's free walk, the way out at its end, and in the grove the nearest afterimage waiting (the mirror pool only once it can answer). **Subtle** (default) shows it only after about 18 s without real progress and lets it go once she is clearly on her way, so sensing stays the main way to find things; **always** keeps it out whenever there is a goal; **off** never shows it. Set in the pause menu; remembered.
- **Prompts** are a word and, the first few times, the key; after three sightings only the word remains.
- **Afterimages found:** six small dots appear at the top for a few seconds after each one.
- **Pause button** stays out of the picture until the mouse moves (always shown on touch).

## The grove: afterimages (after the prologue)

The film is the prologue. After its end card, the grove (`story/afterimages.ts`) is **one authored path**, not a field to search. The game is linear and story-first, in the Hellblade lineage. Memories wait in the world, in a fixed order, and each one is woken before the way goes on.

- **The path** (`ORDER`, and `GROVE_PATH` in `world/terrain.ts`) runs from the way out round the grove and back: the fallen giant (a weight held), the thicket (breaths beside her), the first pool (a small hand teaching hers), the salt marsh (two walking right to left), the conduit ruins (the cost), and the mirror pool (her own face, with the mist lifting toward the gate). Walking up to the gate starts Part II. The order builds toward the rescue Part II remembers.
- **Where she can walk:** `player.areas` opens the path one stretch at a time. Its edges aren't walls: as she strays toward them, the mist closes in. Trees and boulders keep a lane along it.
- **Perception, not a HUD.** Holding E closes her eyes: the grove dulls, the memory's echo sounds from where it waits and glows through her lids, and **small warm footprints** (`world/memoryTrail.ts`) walk on ahead of her, like someone small leading. They sit in their own layer (`post.memoryScene`), composited through the lids. The guide setting shows them faintly with her eyes open (**subtle**: after about 14 s without progress; **always**; **off**: only behind the lids). The port pulses faster as a memory nears.
- **Afterimage:** each asks for one gentle act, then gives a wordless, camera-led moment. What stays is a note of the three-note motif (the melody that carries through the whole game), a little ochre warmth, and an album frame. There is no on-screen counter.
- **Music:** cue slots in `core/audio.ts` (`MUSIC_CUES`): `grove` plays between memories and stops for each one; `gate`, `past` and `trace` cover Part II. Drop score files into `public/audio/`.
- Canon: no new narration; Part II is hinted through sensation only (never the child herself, no ochre cloth).

All six are built:
- **The first pool.** She kneels and lays her open hand flat on the water, gently, and stays still. A small hand made of light (`world/lightHand.ts`) appears on the water beside hers; rings form under its fingertips one by one; it glides over and settles on the back of her hand and presses once.
- **The salt marsh** (sound first). She stands still in the open water with her eyes closed and the wind comes. Rain patters on a coat beside her; two people wade across in front of her, one heavier, one small and quick, right to left. When her eyes open, the still water shows it again: rings arriving in two lines across the marsh's open heart, with no one there.
- **The fallen giant** (strain). She lays her palm on the bark and holds. Both arms rise overhead, a bar of light (`world/lightBar.ts`) comes down across her forearms, the weight lands (a thud, the camera jolts), she braces and trembles, and holds until it passes.

- **The conduit ruins** (cost). She touches the buried conduit. Light wakes in it at her hand (`world/conduitGlow.ts`), runs up and over the arch and back to her while her shoulder port answers; then the surge: a flash, she's thrown off it, and everything stops, no light and no sound, her port dark, her eyes fluttering. The hum comes back stuttering, the way she came back.
- **The thicket** (not alone). She lies down on the dry cracked ground, as she did when she woke, and is still. With her eyes closed, small breaths beside her. When they open, a warm glow lies in the dust in front of her, the size of someone small curled up close (`world/dustGlow.ts`); as she looks at it, it's gone.

- **The mirror pool** (last; it only answers once the other five are found). She kneels and looks again, as in the film. Her reflection, and this time, just past her shoulder in the water, a faint warmth, as if someone knelt close behind her (`world/warmGlow.ts`). The whole motif plays at last. Then the view turns toward the refuge and the mist lifts along the way (and stays lifted): the place Part II begins.

Each keeps a motif note (in the order found), warmth, and an album frame.

### The title screen (`story/titleScene.ts`)

Once loaded, the black lifts to show the world behind the title (Begin fades back to black before the story opens).
- She stands at the grove's edge in the late light, looking up toward her shed shell, the ring and the inverted grove.
- The camera drifts slowly behind her, and the sky is shown partway through the story.
- The first click or key starts the sound: `main_theme.mp3` (the `title` cue) once it exists, otherwise the grove cue, quietly.
- Begin or continue hands over to the story.

### Reading each chapter (what to do, without narration)

Every chapter after the prologue says its goal once, at the top, in the found row's caption (`ui.objective`). Its mechanic is taught by a once-ever hint (`ui.hintOnce`):
- **IV, the search:**
  - Goal: "follow the strip in her hand".
  - The first time she stops: "it leans the way · stand still and watch". The older 20 s nudge stays as a fallback.
  - The lift's cost is named: "spent · a weight held".
- **V, the crossing:**
  - Goal: "cross the channel".
  - The beam prompt says what A / D do: "lean against the sway".
- **VI, the other side:**
  - Goal: "the way is in the water".
  - Then once: "look down into the water".
  - After a first sinking: "keep to the stones in the reflection".

### Reading the grove (what to do, without narration)

- **The goal, once, as the chapter begins:** the row of six afterimage dots appears with "find what her body remembers".
- **The way:** the existing hint ("close your eyes", hold E) now comes after about 11 s instead of 20 when nothing is found yet. The first time the steps appear behind her lids, "follow the steps" shows once.
- **The act, shown** (`story/siteGhost.ts`): near the next memory site (within 12 m), a faint glass afterimage of her waits in the pose to take.
  - Each pose is baked from her own rig and reach IK, and stands where the act will place her.
  - At the fallen giant she stands with her palm to the bark; among the thorns she lies curled; at the pools she kneels.
  - It assembles from the ground up, fades if she walks away, and breaks into flakes as she takes its place.
- **What came back:** after each one, the dots return with its name, e.g. "1 / 6 · a weight held", "2 / 6 · someone small, breathing beside her". The names come from the design's own order, and the line is announced to screen readers.

## Part II: the refuge gate (`story/partII.ts`)

Once the grove is complete, the mist lifts toward the refuge, the gate appears, and the guide points to it. Walking up to it (within 7 m) ends the grove and begins Part II. The narration is the second film's, word for word and in order (`docs/part-ii-narration.md`).

- **`gate`** (S01–S04). The derelict slab hangs jammed about a metre open and slightly crooked. As she comes close it groans; she steps in and it slips. Her hand is under it before she knows: she kneels and catches the bottom beam palm-up. The camera cuts on the impact to the hand over the water, then "my hands remembered before I did". Next, a front-left close-up as her eyes go up the gate and her port settles. Then a low wide shot that rises: her at the right, the strip on the LEFT bolt. **Hold E** eases the slab down; her hand slides out and it drops shut into the sill. An insert of her hand on the shut gate plays with "I came here looking for what I'd lost"; the fingers open and the index hovers. If she stays still, a child's small breath arrives.
- **`memory`** (S05–S25, `story/partIIPast.ts`) is **the film's own footage, seen through fractures** (`story/memoryFrame.ts`).
  - **The shot:** the present holds close on her left eye. Beside it a window of broken crystal cracks open: a Voronoi fracture, whole in the middle, with loose shards at the rim that drift, lit warm, shedding embers. The film plays inside it.
  - **Footage:** `public/video/part2_past.mp4` is cut from `AFTERIMAGE II.mp4` at 14.6–85.4 s, with the burned-in subtitles and letterbox cropped off; the score plays over it.
  - **Narration:** lines 3–9 come from the game's subtitles at the film's times.
  - **What stays yours:** from the catch (S11) the film only runs while **E is held**, holding the gate and then staying. Release and it stalls, trembling and dimming. At S18 it waits on the child going through until you **let go**.
  - **Ending:** the one-second cuts and the blackout; the aftermath reopens dim and then shatters into the present.
  - **To swap in clean clips:** replace the file and adjust the times at the top of `partIIPast.ts`. The rigged child (`models/child.glb`) is no longer loaded here.
- **`trace`** (S26–S27). She comes to, still kneeling; the port lights and her eyes open. She walks to the bolt and **takes it** (E): an over-the-shoulder shot of her left hand closing on the strip, with "I remember why I stayed". Then a close-up as she holds it at her chest, lifts her eyes and turns toward the way on, with "now I have someone to find". The strip stays in her fist. The guide leads round the ruined end of the left wall (right to left), then the card: AFTERIMAGE, part two.
- **The strip** (`world/cloth.ts`) is faded, crumpled and frayed at the end, and sways in the draft. It stays on the bolt from the first present-day shot until she takes it; the child never appears in the present.
- New body controls: `supinate` (palm up under a weight), `leftGrip`, `leftAim` and `leftElbowDown` (holding something close). `player.areas` sets where she may walk: the grove circle, plus the way to the gate once it opens.

## The search (`story/search.ts`, beat `search`)

After Part II's card, the way on begins, on the far side of the gate. It has no narration: the films' lines are all spoken.

- **Memory shards** (`world/memoryShards.ts`): the moment the child went on (a film still) hangs in the air as 34 crystal fragments. Each is at its own depth along the lines of sight from one viewpoint, so from anywhere else they're scattered glass with pieces of a picture on them.
  - As the camera nears the viewpoint (where the follow camera sits when she stands at the spot, facing the pieces), they gather: depths close in and tilts settle. Held there, the picture is whole and the moment plays in the fractured window (`memoryClip`).
  - The way there (and on to the lift, and along the route) is shown by the strip itself: see the compass below.
- **Power at a cost** (`world/lift.ts`): a dead lift at the arcade climbs 12 m to the elevated route. It only rises while E is held with her hand on its receiver.
  - As it climbs, cyan fills the rails, the view greys and fractures (`post.uDrain`) and ghosts (`uAfter`) grow.
  - At the top she pays: the oldest memory not yet spent is gone (`progress.spendOne`). Its album frame is drained and cracked, and its warmth is out of the light (`warmth()` counts found − spent).
  - Then she steps onto the route.
- **The route gives way** (`world/routeCollapse.ts`): past the lift, the deck behind her starts to go, piece after piece, and chases her along the arcade, right to left, filmed side on. Hold any direction and she runs.
  - Each piece sags and shakes for a moment, sheds grit, then drops, tumbles and comes to rest below as rubble, with thuds and camera shake by distance. The front closes in if she gets ahead, so it stays just behind her heels.
  - No death: if the deck goes from under her, the moment fractures and rewinds (drain, afterimage, a pale flash) to where the run began, with every piece back in place.
  - The whole far end (`deck_00`) holds. She slows, turns to see the way she came fall away, and the card reads "the search".
  - Dev: `?beat=search&at=route` starts on the route.
- **The ochre strip as compass** (`story/compass.ts`): no markers; the strip in her fist leans toward where the child went next, as if a wind blew that way.
  - Walking, it barely stirs. Standing still, she holds her fist out low at her left side and it streams out toward the trace like a pennant (`OchreCloth.stream`), with faint ochre wisps drifting off its end in the same direction, so it reads from behind her.
  - With her eyes closed (hold E), its pull shows as warmth through the lids in that direction, with a faint sound from there when she faces it.
  - The guide setting still applies: **always** keeps a steady pull; **off** leaves only standing still and eyes closed. Stories set `compass.target` (null lets it hang) and `compass.listen` (off while E does something else).
- **Afterimage trails** (`core/ghost.ts`): a feedback post effect that blends each frame into a running memory of the last, so what moves leaves a fading, slightly warm ghost. Running adds a little on its own; story moments set `game.afterimage` (the shards gathering, the price at the top).

## V. The crossing (`story/crossing.ts`, beat `crossing`)

After the search, a reboot, and she comes to at dusk on the ground beyond the arcade (`CROSS_WAKE`). No narration.

- **The balance walk** (`world/crossing.ts`): a fallen conduit bundle spans a deep flooded channel (`CHANNEL`, carved in `heightAt`). Hold forward and she edges along it with her arms out; lean against the sway with A / D.
  - The sway is an inverted pendulum: less steady while she moves, and pushed by the wind.
  - Past about 30° she goes into the water, and the moment fractures and rewinds to the start of the conduit.
- Then she walks past two leaning slabs, and the strip leans toward the still pool (`POOL_EDGE`).
- The squeeze between the slabs was cut (October 2026); it wasn't needed for the playthrough. The slabs stay as scenery.

## VI. The other side (`story/mirror.ts`, beat `mirror`)

- **Looking in:** she kneels at the still pool and looks in. Holding E closes her eyes, and she passes through.
- **The other side:** her eyes open on night. All the water is dark glass (`water.uGlass`).
  - In the glass, and only there, a way of light runs to an arch: thin plates of pale glass hovering just above the surface, staggered like stepping stones, glowing at their wavering edges and nearly clear across, with a slow pulse running along them toward the arch; motes drifting up off them; small ochre lights floating either side. Mostly transparent, so the night sky in the water stays the picture. (A reflection is clipped at the surface and sees the world from below, so anything flush with the water shows only as a sliver: the plates float a few centimetres clear.) As she reaches the arch the way dims, leaving her reflection in the arch clean.
  - It lives on the `REFLECTION_ONLY` layer, which the view camera never renders but the water's reflection camera does (`water.showInReflection`).
  - Looking at her, she stands on bare water; in the reflection, she walks the causeway.
- **Off the causeway:** the water gives. She sinks, and the moment rewinds to the last step she stood on.
- **The arch:** she stands in its reflection, closes her eyes, and comes back to the dusk. The card reads "the other side".
- **The main theme** ("Ka-e Eren") carries the chapter. It starts quietly as her eyes open on the night water and builds while she crosses.
  - At the arch it moves (crossfading) to the breath before its climax, so the climax comes as she stands in the arch's reflection.
  - Through the climax the camera rises toward the ring of light beyond, and her eyes close exactly on the song's hard stop.
  - The song's quiet close plays on under the return to dusk and the card.
  - Arriving late, the song just plays on from where it is. Without the file, the grove's cue plays as before.
  - The music player gained a start offset and `musicTime(cue)` for this.

## Chapters, reboots, weather

- **Chapters** (`story/chapters.ts`): I afterimage, II the grove, III the gate, IV the search, V the crossing, VI the other side.
  - Each chapter's title shows low on the left as it begins (except the first film, which opens cold from the title).
  - The title screen's **chapters** button lists every chapter reached (kept across "start over").
- **Reboot interludes** (`story/reboot.ts`): before the grove, the search and the crossing, but only when play flows into them. It's wordless:
  - Black, then her core as a cyan ring drawing itself, with a socket for each of the grove's afterimages.
  - Holding E brings her back up. A memory she holds lights with its album frame and its motif note. One she spent flickers, cracks and stays dark. One not yet found is an empty outline.
  - Letting go stalls it.
- **Weather and time of day** (`world/weather.ts`): the story blends between presets.
  - **day** (the films), **late**, **dusk**, **storm** (a dust storm), **rain**, and **other** (chapter VI's night).
  - Each sets the sun's height and colour, sky, haze and mist, cloud shadow, and the wind: dust streams downwind and gusts come more often.
  - Rain adds streaks, rings on the water, and its hiss and patter.
  - The grove wears on from day to late as memories return. The wind gets up in the search, the collapse raises a dust storm, and the route ends at dusk.

## Photo mode and settings

- **Credits** (`story/credits.ts`): after VI, under "Someone to Find" (`public/audio/SomeoneToFind.mp3`), a slow pull away from her at the pool at dusk with the credits rising through it; any key lets them go after a few seconds. Edit `CREDITS` to add names.
- **Photo mode** (C, or "photo mode" in the pause menu): the moment holds and a free camera drifts within 7 m of her.
  - Controls: WASD, R / F, drag to look, the wheel for the lens. (No option to hide the panel: saved photos never include it.)
  - Panel settings: lens, focus (on her or set), aperture, exposure, roll, grain, vignette, and a look (film, warm, cold, silver).
  - Toggles: her, the bars.
  - **save** writes a full-size JPEG.
- **Accessibility** (pause menu, `core/access.ts`):
  - subtitle size, and a subtitle backing band;
  - camera shake (full, low, off: shake and handheld drift);
  - flashes and trails (reduced scales the afterimage trails and the drain fracture, and dims light flashes);
  - held actions (**toggle**: every "hold E" becomes a press on and a press off, and the prompts say so);
  - look speed (slow, normal, fast) and invert look.

## A layered score

The music system (`core/audio.ts`) takes stems as well as single files:
- **Stems:** list them in `public/audio/stems/stems.json` (e.g. `{ "grove": ["instruments", "voice"] }`) with files named `audio/stems/<cue>_<layer>.mp3`. They start and loop together, and the story sets each layer's level (`setLayer`).
  - The grove brings the voice in as memories return.
  - The route chase brings in a pulse layer.
  - Chapter VI plays the voice at full.
- **Intensity (`setIntensity`):** on any cue, stems or not, a low-pass and level that makes the score recede, as if heard from inside.
  - It leans in as a memory nears in the grove, draws back when she closes her eyes, falls away while the memory stalls at the gate, and climbs with the lift.
  - A cue without stems plays its single file as before.

## Assets

- `blender/rig_character.sh …`: the rigged character (see `docs/character-pipeline.md`).
- `blender/build_grove.sh`: the tree kit (12-sided sweeps, 18,000 triangles a tree, plus 2,000-triangle `_far` copies of the big forms for the silhouettes in the far haze): 8 pieces (tall, leaning, two arches, two shrubs, a fallen limb). Each uses swept branch curves with closed fork joints and bark displacement, with mineral scales, thorns and rust nodules, then decimation. Masks go into vertex colours: R = baked AO, G = mineral crust, B = rust. The game instances the kit over the grove spots and varies each instance with world-space noise. If the file is missing, it falls back to procedural trees. The same geometry gives the camera its obstacles: every trunk and branch cell between 0.8 and 2.6 m.
- `blender/build_rocks.sh`: the floor kit: pebbles, fractured chunks, a slab, two low salt-crusted outcrops, two boulders and three fallen thorn twigs (icosphere → fracture planes → ridged crags → sediment strata on top → seated base). Same mask layout, with B as a dark water stain. Crusts go where the ground dips just under the water line, with a hero set in the first pool for the opening wide; boulders stay off the path; twigs gather under trees and around where she wakes (grove bark material). Falls back to procedural rubble.
- `blender/build_landmarks.sh`: the off-route landmarks: a fallen giant of the grove (15 m trunk, upturned root plate holding a clod of pale earth, forked broken limbs, thorns) and the half-buried remains of refuge conduits (bundles arching out of a rise, a snapped rib, a tilted paving slab). Grove material; they block the player and the camera.
- `blender/build_gate.sh`: the refuge gate for Part II, built after the film's frames. It has a banded, riveted slab on guide rails (its thick bottom beam is what she braces) and a fixed head panel behind it. The LEFT jamb carries the rusty bolt; the wider RIGHT pillar carries the round receiver with a severed lead. It also has a ribbed power cable with its plug at rest, a pointed-arch grille crown, ruined masonry walls, and bone paving under the shallow water. `world/gate.ts` loads it at `GATE` (between the way out and the arcade, refuge side facing her approach) with its own weathered-iron material and an open-roof fill light. It exposes `lift` (0 = shut) `gap` and `jam` (derelict tilt), and the named points `bolt_tip`, `socket`, `cable_anchor` and `plug_rest`. It stays hidden until the grove's mist lifts. A smaller copy of the arcade (`loadCanopy` in `world/arches.ts`, 0.6 scale) runs out from the gate's right side as the refuge's conduit canopy; its piers block the player.
- `blender/build_arches.sh`: the refuge arcade seen at the end (Part II's setting, never reached here): conduit bundles rooted in the ground, twisting up and splitting into pointed arches, branches off the ribs, hanging conduits, the bone-paved elevated route on top continuing screen-left, one span broken. The deck is split into half-span pieces (`deck_00`…`deck_18`, ordered along +X) so the route can collapse in the search. Falls back to the procedural arcade.
- `blender/build_crossing.sh`: chapter V's crossing pieces (`scripts/crossing_kit.py`). The fallen conduit is a twisted bundle of strands with snapped ends, branch stubs and a loose cable. The slab (used twice, one turned end for end) is broken along fracture planes, giving an angular top and chipped ends. The kit also has the pinch block and rubble. Masks are as in the other kits. `world/crossing.ts` places them exactly where its stand-ins stood (which stay if the file is missing); the stone uses `kitStoneMaterial` (strata and grit, no bark grain).
- `blender/build_thorns.sh`: thorn vines after the films (`scripts/thorns_kit.py`).
  - Pieces: low creeper mats, arching brambles and upright spiralling tangles. The stems are near-black and knotted, set with thorns every few centimetres and rust-red knots.
  - Thickets: as in the films, two in three of the grove's tree spots are thorn thickets (`groveSpots` in `world/grove.ts`): a big spiralling tangle ringed by brambles and a creeper. About 23 dead trees remain, plus the two hero trees and the far silhouettes. Thickets block her and the camera like trees did; only the trees creak.
  - Placement (`world/thorns.ts`): about 200 instances on high quality, fewer on low. They're thickest around where she wakes and around the first pool, where the films frame them, and thin out across the grove.
  - Clearance: they're kept off the walking paths (low creepers can come close; the tall shapes stand back) and off the spots the story frames closely.
  - They cast shadows: the lacy webs over the pale mud. The day light was made harder to match (stronger sun, less fill, crisper shadow edges), and the mud paler.
- Art direction (`docs/art-direction.md`):
  - **The world exists where she remembers** (`core/post.ts`). Only far off (beyond about 70 m from her, fully by 150 m) does the picture break into shards anchored in the world (Voronoi cells, larger with distance). They drift, crack along lit edges, and a few are missing, opening onto a pale void. Places she has been stay whole (a "known" map stamped as she walks), and it all reassembles as she comes near. The sky is left alone. `post.uFrag` scales it.
  - **The shard on the horizon** (`world/landmarkShard.ts`): a vast fractured crystal far to the north-east, high in the haze, split in two with fragments turning round it. Its colours follow the sky and the weather. It's never reached and never explained.
  - **The camera is the player's** (`core/camera.ts`). In play there's no depth of field, so the whole landscape is sharp; cutscenes keep their own focus. Running no longer leaves a motion trail. Drag or mouse to look, and zoom with the wheel, a trackpad pinch, a two-finger pinch on touch, or `-` / `=`. The boom runs from about half to about 2.4 times its usual length. Outside cutscenes it does only one thing on its own: while she walks and the view is left alone, it drifts round behind her. Story cutscenes still take their authored shots. (The earlier framing zones, reveals, resting camera and lean toward points of interest are gone.)
  - **Forgetting flakes** (`world/flakes.ts`): thin glassy slivers that peel away, rise, turn in the light and dissolve. One pool serves the whole game:
    - a memory spent at the lift (a burst off her, as her echo goes);
    - each piece of the route that gives way in the collapse;
    - a chapter title coming apart;
    - a faint drift where the far world fragments.
    - In the reboot, a spent memory's socket sheds its own (2D) slivers as it cracks.
  - **Crystal afterimages of her** (`world/echo.ts`): her pose of that moment, baked once into a glass copy that stands while she moves on, then comes apart cell by cell from the top down into flakes. She leaves one when:
    - she rises in Part I;
    - a memory is found;
    - a memory is spent;
    - she wakes at the start of chapter V;
    - she rises from the still pool in chapter VI.
  - **Chapter titles set in the world** (`world/worldTitle.ts`): numeral and name stand in the air beside her, at her depth, sized to the frame. A sheen passes across them. Then they break into shards, piece by piece from the left, rising on the wind and shedding flakes. The `#chapter` live region still gets the text, so screen readers announce it.
  - **The sky tells the story** (after Control Resonant and Clair Obscur; the references are in `inspo/`):
    - **What she has shed** (`world/shedding.ts`): over the still pool, an armillary of her own shell. Ivory ceramic plates carry the crack network of her body, with an unglazed bisque inside. They sit on 14 broken, tilted rings, each drawn only part of the way round, like her reboot ring, and each turning at its own pace. Low down the rings are close and level; higher up they open and loosen into drifting plates. There's one instanced draw per ring. (This replaced the floating copies of her, which were too close to Control.)
    - **The inverted world** (`world/invertedWorld.ts`): the grove (far trees, arcade, fallen giant, ruins) hangs upside down in the haze, twice life size, west-north-west and south-east, about 330 m out. It's a flat silhouette in the sky's colour, with cells missing, and its roots are lost in a cloud deck. There's one copy on low quality.
    - **The rupture** (`world/landmarkShard.ts`): a diagonal fracture of light behind the shard, with crystal debris streaming out of it.
    - **Growing with the story** (`Game.setStage`, set at every beat): the rupture opens wider and more echoes hang over the pool with each chapter.
    - **Cloud banks** (`world/clouds.ts`): soft haze cards in a ring between the grove and the distance, plus decks under the inverted copies. The distance reads in planes rather than as one fog.
    - **The ring** (`world/ring.ts`): a thin cyan circle on the horizon beyond the other side's arch, the same ring as her core in the reboot. It draws itself clockwise from the top, further each chapter, its leading edge brightest.
    - **Memory panes** (`world/memoryPanes.ts`): from the gate on, each memory she holds hangs as a pane of glass round the dead lift's tower, rising with it. Each shows its frame from the album, with ragged crystal edges; one not yet found is an empty pane. When she spends one at the lift, its pane cracks along cell lines, greys and comes apart into flakes.
    - **Colour floods** (`Game.flood`, `post.uFlood`): at a peak the whole frame goes to one colour for a few seconds, shadows dark in it, as in Control's red rooms. It's cyan when she spends a memory and amber when she finds the last one. The effects setting scales it.
    - The fragmenting horizon leaves anything high in the sky alone; those things break in their own way. The camera's far plane is 520 m.
  - **Pointing without the camera** (`story/vistas.ts`): the three vistas are the ruins (the shard and rupture), the fallen giant (the upside-down grove) and the still pool's north shore (the echoes).
    - At each one, glassy flakes rise off the ground round her and drift toward the sight.
    - If she lingers without looking, a quiet "look up" hint appears, once per place ever. It never covers a story prompt, and it counts as given only once it has been readable.
    - The camera can now tilt further up (pitch down to -0.5).
  - **Painterly distance** (`core/post.ts`): a small Kuwahara filter can flatten the far picture into strokes. It's off by default (it softened the landscape); `post.uPaint = 1` turns it on.
- Her look, after the films (`player/character.ts`):
  - Her shell is glazed ivory ceramic with a fine network of dark cracks, laid out on her body at rest so it moves with her. The atlas's dull grey plating becomes ceramic; the darkest mechanical parts (joints, the spine band) and the cyan port and fibres stay as painted.
  - Her hair is lifted from the head texture's grey to silver-white.
- Water (`world/water.ts`): twinkling glitter along the sun's path (it blooms into bokeh out of focus), and pale mineral scum and floating flecks in the shallows near the shores. The mirror pool and chapter VI's glass stay clean. The follow camera's depth of field is a little shallower.
- Reeds (`world/reeds.ts`, three.js): dry reeds and dead grass in clumps along the waterlines, a few on low damp ground. Blades are dark at the root, straw up the stem and bone-white at the tips; they lean and sway with the wind, more in gusts. They're instanced (about 2,200 tufts on high, 850 on low) and kept off the spots the story frames closely.
- `blender/build_debris.sh`: small debris for the paths (`scripts/debris_kit.py`): a bone splinter, a rib fragment, a knuckle, a snapped conduit scrap, a bent plate and two stone chips. `world/debris.ts` scatters about 1,100 of them (500 on low quality), instanced and seeded, within a few metres of every corridor she walks, and never in deep water.
- The lift (`world/lift.ts`) is built in three.js, so its rails keep their own space for the power seam:
  - a lattice tower of channel rails with rack teeth, bolted brackets and raking back legs;
  - a head frame with a spoked sheave, and a hoist cable that shortens as she rises;
  - a seized winding motor and drum at its foot, on stone footings;
  - the cage: a grated floor in an angle-iron frame, railings, guide shoes and the receiver post.
- The arcade deck (`arches_kit.py`): each piece is a base slab under worn pavers in staggered courses, a few missing, cracked or askew. Their tops are at the old walking height, and the pieces are still `deck_00`…`deck_18` for the collapse.

**Look:**
- The chain is: scene → depth of field → light → painterly distance → fragmenting horizon → afterimage → bloom → tone map → LUT → grain.
- Light comes from two effects:
  - Screen-space **sun shafts** (bright sky seen between branches, smeared from the sun; on both tiers).
  - Shadow-map **god rays** (near in-scatter; desktop only).
- The grade (`src/core/grade.ts`) is a 3D LUT built at startup from measured Lab statistics. It moves the game about 80% of the way toward the Part I film's colour and 38% toward its lightness, then adds the film's olive-shadow / warm-highlight split and a matte black. To re-measure the film, run `blender/scripts/film_stats.py AFTERIMAGE.mp4`.

**World:** besides the route (wake → pool → still pool → way out), four places reward wandering, with no narration: the **salt marsh** to the east (a broad sheet of still water with crusted islands and a few lone trees), the **fallen giant** lying in a flooded hollow to the west, the **conduit ruins** on a rise near the way out, and a dense **thicket** behind where she wakes. Her gaze and the follow camera drift toward each when she's near. She can't walk through trunks, the giant or the ruins (ground-plane capsules). Low ground mist pools over water and hollows, thickens with distance and drifts slowly. Broken cloud shadows drift across the land (they dim only the direct sun). During wind gusts (the same ones you hear), patches of the water roughen and drift downwind, breaking up the sun's glitter; the still pool stays sheltered. A far ring of giant tree silhouettes stands in the haze beyond the bounds for scale, leaving the view to the arcade open. Boulders block her too.

**Surfaces:** grove bark (trees, the fallen giant, the ruins, the far silhouettes) has procedural ridges running up the limbs, grit, crumbly crust and flaking rust, in both the normal and the colour so it reads in shade; rocks have crags, pits and thin sediment layers on their crusted tops. **Ground:** the dried mud's cracks have relief (sunken cracks, curled plate edges, grit) from a derivative bump on the procedural height. Two hero trees stand 14–16 m toward the low sun from where she wakes, so their branch shadows cross her in the top-down shot, as in the film.

**Camera:**
- Follow: over the right shoulder on a 32 mm lens. While she walks and the view is left alone, it drifts back around behind her; it pulls back a little when she runs and leans in slowly when she stands still. The boom shortens when a trunk would come between her and the lens (fast in, slow out). When a point of interest is near (the pools, the way out) and the player isn't steering the view, the framing drifts slightly toward it.
- Shots: hard cuts or blends to recipes built around her body (`story/shots.ts`), with thin 2:1 letterbox bars (subtitles move down into the lower bar; none on portrait screens).
- Handheld: a slow, breath-like drift on every frame; stronger in shots (`Shot.handheld`, 0 locks it off). `cam.shake(amount)` adds a short jolt (a rough touch).
- Focus pulls: shot focus points can be tweened; the cold open racks from her hand out to the ring and back.

**Her body:** separate fingers (rebuilt in Blender, see `docs/character-pipeline.md`) posed on top of the procedural animation (`player/hands.ts`): curl per finger plus spread; a relaxed, slightly fanned hand that slowly breathes, the index pointing with the others folded while she reaches, and an open hand pose. At rest her weight drifts from leg to leg (contrapposto: the loaded hip rides up, the other knee softens, shoulders stay level), her shoulders rise on each breath, her head drifts with her attention and her arms hang soft. Walking follows clinical gait curves per leg (hip swing, a small knee dip as weight lands and a big bend in swing, heel-to-toe ankle roll, toes bending before toe-off), with each arm swinging against its leg; while a foot carries weight it stays pinned where it landed and the leg bends to reach it, so feet don't slide. Running (Shift, or the stick pushed fully on touch) blends into its own curves from about 1.75 m/s: contact for only ~38% of the stride and a flight between steps, the knee taking the landing and folding deep in swing, a hard push-off; she leans forward, carries herself a little lower, dips at mid-stance and rises through the flight, with elbows held near a right angle, a wider arm swing and loosely closed hands. Turning on the spot, she takes short steps. Walking, her head stays steady against the stride and leads into turns; she leans into acceleration, rocks back when stopping and banks into turns. Her head and neck turn toward what she notices (the nearest pool or the way out ahead of her, or a beat's `lookTarget`), clamped and eased, and off while a beat poses her head. Her feet follow the ground (leg IK, hips drop for the lower foot, soles tilt with the slope), the walk carries pelvis turn and drop, a weight shift and toe roll, and a rough touch makes her flinch (chest back, head away and up). Water leaves marks: wading or kneeling wets her feet, shins and knees (darker, glossier, with a ragged line and short drips), touching wets the fingertip, and both dry slowly. The marks live in her rest-pose space, so they move with her. Forearm twist bones take 60% of the wrist's roll so the skin doesn't pinch at the wrist.

**Sound:** `src/core/audio.ts` is procedural (no recorded assets), with 3D positional audio around a listener that follows the camera:
- **Ambience:** layered wind, gusts that whistle through the thorns, biomechanical creaks with a metallic ring from real tree positions, water lapping near both pools, and faint dust glints.
- **Her body:** footsteps on dry cracked mud vs wet shallows, ceramic ticks, and plate sounds when she kneels, rises or stirs. Her core hum sits at the shoulder port, with a chime when it pulses.
- **Moments:** a gentle touch is a soft plip and ringing ripple; a rough one is a spray and drop. With her eyes closed, the world muffles and a faint inner tone appears.
- **Score:** put `part1_open.mp3` and `part1_end.mp3` in `public/audio/`. They play under the cold open and the ending; without them, a synthesized motif plays at the end. The film's own soundtrack has the narration mixed in, so it can't be reused directly. The score on its own would be ideal.

The title screen shows a loading line while the renderer, character, grove, arcade and rocks load and every shader compiles. Begin/Continue appear when ready.

## Shipping

`npm run package` builds a self-contained web version in `dist-web/` and zips it to `afterimage-web.zip` (about 57 MB):
- Paths are relative, so it runs from any static host or subfolder, including itch.io. Upload the zip as an HTML game with "played in the browser" on.
- Two files in `public/audio` that nothing uses are left out: the large PNG and `part2_past (1).mp3`. They stay in the project.
- **Caching** (`public/sw.js`, production builds only): a service worker keeps the models, audio and built scripts, so a return visit loads from disk; they're refreshed in the background. The films stream as usual.
- **Local test:** the `afterimage-web` entry in `.claude/launch.json` serves `dist-web/` on port 5190.
- **Not done:** publishing anywhere, and a desktop wrapper (Tauri or Electron would wrap `dist-web/` as is). Re-encoding the music at a lower bitrate would cut the remaining size most.

## Performance

Measured on the development Mac at 2048×1536, grove start: 21 ms a frame before, 12.8 ms after (the new default render scale).
- **Adaptive resolution** (`Game.adaptResolution`): high quality starts at pixel ratio 1.5 and moves in steps of 0.15, between half that and 2 (on low quality, 1.25 and 1.5), keeping frames between about 42 and 57 fps. The post chain is costly per pixel: at ratio 2, a frame was 20 ms; at 1.5, 13 ms; at 1, 8.5 ms.
- **Draw calls:**
  - The clouds are one instanced sprite.
  - The inverted world's static parts are merged, one draw per copy.
  - The shard's fragments are instanced.
  - Small clutter (debris, rocks, flakes) and the far sky copies are kept out of the water's reflection pass (layer 7). Thorns are excluded too on low quality.
  - Pebbles, twigs and crust no longer cast shadows.
  - Together, CPU time per frame went from 13 ms to 9 ms.
- **Reduced resolution:** the sun-shaft blur renders at a third of the resolution.
- **Painterly filter:** off, and now left out of the post graph entirely (`PAINTERLY` in `core/post.ts`); at zero it still cost a full-resolution copy and a half-resolution pass every frame.
- **Low quality / phones** (checked at 375×812, `?q=low`): about 170 draws and 3.5M triangles a frame across all passes, down from 5M, because the thorn thickets no longer cast shadows on low. The touch stick, look drag and pinch work; the stick stays hidden until play starts; chapter titles in a portrait view sit centred above her instead of beside her.
- **High quality, after the latest pass** (grove start, 1536×1152): from 10.4M triangles and 13–15 ms a frame to 4–7M triangles and 9.6–12.8 ms, about 300–370 draws.
  - **The sun's shadow once a frame:** three.js rendered the shadow map again for every camera that used it, and the water's reflection camera is a second one, so about 2M triangles were drawn twice. The shadow now updates once at the start of each frame (`autoUpdate` off, `needsUpdate` in `Game.frame`). Renders are pixel-identical.
  - **Instanced kits split into 28 m ground cells** (`world/chunk.ts`): each kind of tree, thorn, rock, debris and reed was one mesh spanning the grove, drawn whole by the view, the 32 m shadow box and the reflection. Each cell now has its own bounds, so each camera skips what it can't see. The grove's far silhouettes stay whole, since the inverted world copies them.
  - **No depth-of-field passes in play:** the post chain is built twice, with and without depth of field, and each frame renders the one it needs (focus only in cutscene shots that ask for it). Both compile at load. Saves about 0.85 ms a frame in play.
- Don't toggle the sun's `castShadow` at runtime: the shadow node breaks. (Its `needsUpdate` each frame is fine.)

## Trailer tool (`src/trailer.ts`, dev only)

Open `localhost:5180/?trailer`. A 2-minute cut to the main theme, "Ka-e Eren" (76 bpm), with hard cuts on its downbeats (`BAR`, `HIT`, `CUTS`):
- **Intro (0–12.8 s):** overhead, sinking toward her where she lies; her eyes open on the first hit.
- **Sparse hits:** walking through the grove; the grove hanging upside down over the salt flat.
- **Verse:**
  - the shard over the ruins;
  - toward the gate, the arcade at sunset;
  - her memories as panes round the lift, filled with frames from the trailer's own shots;
  - her shed shell over the still pool.
- **Chorus:** the beam in the dust storm; under the rupture; the grove again. Then a close-up of her face in the wind, lowering her head into black on the music's breath.
- **Climax (76.5 s):** the night causeway; the ring over the far shore; then a montage cutting every two beats up to the hard stop at 101 s.
- **Outro:** black, then her small at the far arch across the glass water at night, and the title.

How to use it:
- **preview** plays it live with the music (`?trailer&from=76.5` starts partway).
- **teaser 16:9** and **teaser 9:16**: a 35 s cut for posting, from the song's last chorus bar through the climax to the hard stop, then the title on black over the quiet close (`.trailer/teaser.mp4`, `teaser_vertical.mp4`). The vertical one renders at 3414×1920 and keeps a 1080×1920 window that follows her head through each shot. `?trailer&edit=teaser` previews it.
- **record 1080p** renders every frame in order (no dropped frames however slow the machine), sends them to the dev server and has ffmpeg assemble `game/.trailer/<take>.mp4` (H.264, 30 fps, AAC). About 5 minutes; about 145 MB at the default quality.
- **Console:** `__trailer.record({ take, fps, width, crf })` (lower `crf` = finer and bigger), and `__trailer.still('face', 0.5)` for a 16:9 framing check in `.shots/`.
- **Adding shots:** each clip is a small object (`weather`, sky `beat`, `enter` placing her, `frame(k)` moving the camera); `CUTS` places them on the bars, with an optional `k` slice for montage cuts.

## Look pass: closer to the boards

Measured against the reference boards and the films' frames (median brightness, darkest and brightest 5%, saturation). The game was high-key and milky: mid-tones 106–186 against the boards' 75–110, blacks lifted to 50–78 against about 25, saturation about 22 against 30. Now about 63–164, 14–34 and 30–39.
- **Haze and sky are one formula** (`skyAt` in `world/atmosphere.ts`): forward scattering glows hot toward the sun and is a dim, cooler veil away from it. Far things dissolve into exactly the sky behind them. It starts 7 m out (`uFogStart`), so the ground at her feet keeps full contrast; grove haze and mist are a little thinner.
- **Light balance:** the weather's sun ×1.15, sky fill ×0.72 (`LIGHT`), so shade is shade and the backlight reads.
- **Grade** (`core/post.ts`): exposure 0.6, a firmer S-curve, real blacks (almost no olive lift), slightly richer colour, and bright warm light losing a little saturation as it climbs (gold, not orange). All live uniforms (`uExposure`, `uContrast`, `uSatBase`, `uLift`).
- **Water:**
  - Fine chop: six small, fast wavelets every way, more in the wind; never on the still pool or the glass.
  - The mirrored sky is capped below the sun's disc, and where the reflection is blinding it breaks into shards on the chop.
  - Sun glitter from two grids of tiny facets, each re-tilting at its own pace and flashing only while it faces the sun.
- **Ground:** wet films across the plates (darker, glossy, more of them low down), with the same glitter where it's wet and toward the light.
- **Bark:** beaded crust as in the boards, with clusters of round nodules and dark crevices between them where the pale crust has grown.

## Film lighting on her (cutscenes)

In cutscene shots the characters get what a gaffer would add on set (`uCineKey`, `uCineRim` in `player/character.ts`, driven by `Game.filmLight`). It's only on their materials, so the world's light is untouched:
- **Key:** soft, wrapping round the face, from just above and beside the camera.
- **Rim:** in the sun's colour, from behind them.

Both come up with the cinematic letterbox; in play only a faint rim remains. Close-ups at dusk now show her face, and in wide shots her ivory shell reads against the haze, as in the boards.

## The grove's trees, rebuilt (`blender/scripts/grove_kit.py`)

Closer to the boards' thorned vines:
- Limbs coil slowly about themselves and carry knots strung along their length (spacing follows thickness), plus burls.
- More than twice the thorns (mostly short, a few long), sized to the local limb thickness.
- Clusters of round crust beads packed onto the bark.

The twist and knot settings come from their own random stream, so every tree keeps the skeleton and footprint it had: paths, framed shots and story sites are unchanged.

Budget: the limbs get 80% of `TRIS` and are swept with eight sides (thin twigs with four). The thorns, beads and scales are built lean and are not decimated, since decimation erases small detail first. The far silhouettes are made from the bare limbs, so loose bits don't collapse into stray shards. About 22k triangles per large tree (13k before), 0.97 MB compressed.

To rebuild:
```
/Applications/Blender.app/Contents/MacOS/Blender -b -P blender/scripts/grove_kit.py -- /tmp/grove_raw.glb 13000
npx gltf-transform meshopt /tmp/grove_raw.glb game/public/models/grove.glb
```
`blender/scripts/closeup_tree.py -- <glb> <mesh> <out.png> [distance]` renders one tree close up.

## Round two in Blender and three.js: limbs, rubble, the gate, the sky as reflection

- **Rounder limbs** (`grove_kit.py`): the sweep is in three tiers. Thick limbs (≥ 11 cm) have twelve sides and two rings per segment; mid limbs eight sides and one ring; twigs four. The arch trees get a larger limb budget (about 27k triangles; the others about 21k). The silhouettes no longer show flat sides up close.
- **Baked bark normal maps:** tried and left off (`--bake` turns them on). A tangent-space bake from a round, finely ridged sweep changed almost nothing at game distances, since the faceting was in the silhouette, and it cost 1.2 MB of textures. The bark material still takes one (`groveMaterial(barkMap)`).
- **Rubble and gravel** (`rock_kit.py`, `rockKit.ts`):
  - Three rubble mounds: a low lumpy dome crowded with half-buried fractured chunks, bigger toward the foot, dark with wet-stained bases. They are built lean and never decimated, since collapsing loose chunks smears them.
  - Mounds are heaped either side of the refuge gate (clear of the door), round the ruins, and at the grove's edges. The big ones are solid.
  - About fifty gravel clumps over the dry ground, walkable and without shadows.
- **The sky as the reflection environment** (`createSkyEnvironment`): a scene holding only the sky (the same scattering formula) is captured into a prefiltered cube map (`scene.environment`, intensity 0.45). It is recaptured as the weather changes (throttled; at once after a cut). Metal, wet ground and glossy bark now see the haze instead of black. The darkest tones in the grove views rose from about 10 to about 19 (the boards: about 25).
- **The gate:**
  - It gets the cutscene film lighting too (`core/filmLight.ts`, now shared by the characters and set pieces). It's mostly seen backlit up close, and its iron read as black.
  - Its iron now has rust blooms and runs bleeding down the seams and rivet lines, brown to fresh orange where it flakes; the masonry stays clean.
- **Cost:** grove start on high, 11–16.5 ms a frame across three views.

## Light shafts and bokeh (`core/post.ts`)

- **Beams through the branches.** The old shafts were a veil: they blurred the whole bright glow round the sun, and the shadow-map rays came out as an even glow (the map covers only ~32 m round her; past it, all air counts as lit).
  - The shafts now blur how much open sky shows round the sun, weighted to the sun and its hot core, so each trunk and branch against it leaves a dark gap.
  - The result is high-passed against a tiny copy of itself, so only the structure (lit air between shadows) stays, plus a little glow.
  - It's laid mostly over what's near, not onto the bright sky.
  - Tunables: `uShaftGain`, `uMaskLo/Hi`.
  - The marched shadow-map rays are out of the pipeline (`MARCHED_RAYS`), which pays for the rest: a frame is a little faster than before.
- **Bokeh discs in cutscenes.** In shots with shallow focus, the brightest out-of-focus points on surfaces (sun glitter on the water and wet ground) open into soft even discs, as through the films' lenses. The depth-of-field blur only smeared them.
  - A bright pass (quarter resolution, glints only: the mirrored sky is capped below them; nothing from the sky itself) is gathered over a 32-tap disc sized by the shot's blur.
  - Tunables: `uBokehLo`, `uBokehGain`.
  - It's only in the cutscene chain; play is unaffected.

## Her poses at the gate (Part II, S01–S04)

Matched to the boards' gate frames (the child and the past are the film's own footage; in the engine it's her alone):
- **Catching the gate:** she kneels leaning in less (0.45 rad, was 0.6). Her free hand comes to rest on her knee, fingers loosely curled, instead of hanging behind her. Kneeling upright, she can't reach the stone.
- **The hand on the shut gate (S04):** it stays open and flat on the iron, the fingers easing apart and the palm lifting a breath. Half-closing it toward the pointing pose read as a claw against the metal.
- **Strip scene (S26):** it releases the knee hand (`leftReachWeight`, `leftAim`, `leftGrip`) before its own reach.

## Her closed eyes

A closed lid used a colour sampled at scan time in the crease's shadow, so a closed eye read as a dark hollow in close-ups. Now:
- `measureLidSkin` (`player/character.ts`) reads her skin tone just under each eye from the texture at load (the texture above the eye is painted with the crease's and fringe's shadow). Both eyes are averaged so the lids match.
- The lid is that skin, a touch pinker, deepening slightly toward the lashes, with a softer crease.
- Under the lid the geometry is still the open eye's (the shape key moves points, not normals). Its normal leans toward the way her face points (`u.face`, set by the Player while the eyes are closed), so the lid lights as one smooth round.

## Her hair in the wind

Her hair sways: wind from the weather (much more in a gust) and a lag as she sets off, stops or turns, as a damped spring (`Player.updateHair`) pushing the hair a couple of centimetres at most, with a finer flutter. The scan's texture atlas is too fragmented for a per-pixel mask (the surface tore apart), so `bakeHairWeights` (`player/character.ts`) samples it once per vertex at load, welds the samples across UV seams, smooths them over the surface and weights them from the crown (still) to the fringe and nape (free), away from the eyes.

## The ring as a vortex, and pillars of light (after `world-reference/`, see `docs/world-direction.md`)

- **The ring** (`world/ring.ts`) is still drawn clockwise from the top with the story's progress, but it is now a vortex: a band of streaked light round the line, turning slowly clockwise and drawn inward in a spiral (thin inside the ring, torn wide outside it, unevenly round the turn); crystal dust spiralling in toward it and glittering (1,400 motes on high, 600 on low, one instanced sprite); and spurs of faceted cyan crystal in five clusters, each growing out of the line as the arc reaches it. Only the drawn arc shows any of it. Inside, the haze is a little lighter and cooler. Every `pow` there keeps its base above zero: `pow(0, e)` is NaN on some GPUs, and bloom spreads a NaN into a white blowout.
- **A pillar of light** (`world/lightPillar.ts`) falls from the sky onto where the story wants her next (the guide's goal, the grove's next afterimage, or the strip's pull), one at a time: a tall card turned to the camera round its upright axis, a glow on the ground where it lands, motes drifting down through it. Pale and cool, like the ring and her memories. In the guide's **subtle** mode it is a whisper until she has gone about 22 s without getting closer, then brightens; **always** keeps it bright; **off** removes it. It fades within about 7 m of the place (the place takes over), in cutscenes, and between goals (out at the old place, down again at the new).

## What she recovers, left in the world (`world/foundMarks.ts`)

At each afterimage once it is found:
- **Crystal** grows up out of the ground beside where she acted, over about 4 s: a tall six-sided shard with a ring of smaller ones leaning out, dark mirror-like glass (it reflects the haze) with a cyan light inside, brightest at the tips and edges, breathing slowly, flaring as it grows.
- **The tree that remembers:** the nearest standing grove tree (within 16 m) carries clusters of cyan motes along its upper branches, each with a faint glow round it; a few drip slowly down from them, and a few rise round the crystal. Used sparingly: the grove stays dead and thorned.

A memory spent as power later goes out: the crystal turns milky grey and dark, the motes go. It follows the saved progress by itself (checked twice a second), so loading a checkpoint shows everything found so far at once, and finding one in play grows it.

## Visual and locomotion checks

`npm run check:motion` loads the shipped skeleton and geometry without a GPU at 30, 60 and 120 fps. It checks walking/running, starts and stops, walk/run transitions, corners and reversals, uneven ground, blockers, moving floors, scripted alignment and finite kneeling/lying/standing poses. Measurements include skinned sole clearance, support-foot sliding and twist, ankle continuity, pelvis excursion and settled-foot drift. Browser inspection remains necessary for skin deformation and visual quality.

Locomotion shares `strideFrequency` between cadence and foot placement. Support feet follow world-space contact points; swing feet follow a clearance arc, and only a supporting leg can lower the pelvis. Footstep sounds and ripples use the actual landing foot after IK. The exported skeleton and the story's hand/finger contract are unchanged.

The grove rebuild now uses rounded branch sections, relaxed branch paths, finer twig tips, attached mineral scales and repaired rust masks. The default budget is 13k triangles per large tree. Character shading separates dielectric ceramic/face from exposed metal; sky/ground fill, reduced grain and restrained water glints improve surface readability against the reference artwork.

## Layout

```
src/
  main.ts            Game: renderer, loop, wiring
  core/              input, camera rig (lens in mm), post chain, quality tiers, audio, palette
  world/             terrain + height function, water (reflection + ripples), grove, atmosphere
  player/            rig contract + IK, procedural placeholder body/animator, controller
  story/             clock (awaitable game time), UI (subtitles/prompts/fades/cards), shots, progress, partI.ts
docs/
  character-pipeline.md   image-to-3D → Blender → rig contract → export
```

Story beats are `async` functions that `await` game time and conditions (`clock.sleep`, `clock.until`, `clock.tween`), so each chapter reads like the storyboard.
