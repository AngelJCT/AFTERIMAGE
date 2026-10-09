# AFTERIMAGE: music prompts (Suno)

The contrast: a dark, broken, forgotten utopia, scored with slow, emotional instrumentals
and one woman's voice. The references work like this:

- **NieR: Automata**: a haunting female voice singing in an invented language, dreamlike and
  melancholic, used to carry emotion rather than tell a story.
- **Stellar Blade**: the same ethereal vocals over cinematic ambient and orchestral textures in
  a ruined sci-fi world.
- **Lies of P, "Feel"**: a warm, human jazz ballad (trumpet, guitar, piano, soft drums) found on a
  record. Hope and light set against a heavy world.

**Canon.** Nothing in the game adds words to the story. The narration is the films', verbatim.
So in-game songs are **wordless or in an invented language**, like NieR. English lyrics belong
only to an optional credits song (the last prompt).

## The main theme: "Ka-e Eren" (`main_theme.mp3`, about 3:00)

The game's own song, the one a trailer would carry. It's built to stand apart from the score.
The cues are slow, wordless and drumless. This one is **hybrid and cinematic**: a cappella
intimacy, then broken glitching piano, a heartbeat sub, a string ostinato, and a chorus with
choir, low percussion and the motif as its hook.

The title is in the invented language and means **"if (it is) real"**. It's the game's
question: she searches for something that may never have been there.

Its sound carries the story:
- **Glitching piano and stuttered vocal chops** for memory coming apart.
- **Reversed choir** for the afterimage, a sound that stays after the thing is gone.
- **A full silence** before the last chorus (the reboot).
- **A second, younger voice** that answers once at the end, far away, with the child's falling
  figure (D → C → A).

### Style (A, recommended: hybrid trailer)
```
epic hybrid cinematic trailer song, main theme, solo female voice singing in an invented language, intimate a cappella opening, glitching granular piano and stuttering vocal chops, deep sub pulse like a slow heartbeat, rising staccato string ostinato, crystalline synth arpeggios, reversed choir swells, huge choir with taiko and low brass hits in the chorus, sudden total silence before the final chorus, a distant younger female voice answering at the end, emotional and defiant, ruined utopia, memory loss, 70 BPM half-time feel, A minor, final chorus lifts to B minor, hard cut ending
```

In **Exclude styles**:
```
trap, EDM drop, rap, male vocals, autotune, pop chorus, dubstep
```

Upload `afterimage_motif_seed.wav` and use **Cover** so the chorus hook is the game's three
notes. If the hook drifts, regenerate rather than settle.

### Two other directions (same lyrics)

**B. Ethereal electronic.** The darkest and most modern: a slow trip-hop beat, close and cold.
```
ethereal dark electronic ballad, slow trip-hop beat, breathy intimate female vocals in an invented language, granular synth textures, warm sub bass, glassy plucks, tape-warped piano, vocal chops, reverse reverb swells, melancholic and hypnotic, haunting, 72 BPM, A minor, cinematic game trailer
```

**C. Choral hymn.** A folk hymn from a lost civilization: layered voices, body percussion, almost
no instruments.
```
a cappella choral hymn, solo female lead over a layered female choir, invented language, ancient and ritual, stomps and claps and frame drum, drone of low voices, harmonium, cathedral reverb, sorrowful then exultant, 68 BPM, A minor to A major, video game main theme
```

### Lyrics

The bracketed tags guide Suno. The English in the second block is for you, not for Suno: give
Suno only the first block.

```
[Intro: solo female voice, a cappella, close, the three-note motif]
Ae-la… ae-la ven

[Verse 1: glitching piano enters, voice intimate]
Fe-ne so-rei, fe-ne lo
mi-na tor, a-ve lo
sil-ve ven, sil-ve ou-ra
ves-ta sel-la, nao ah-ren

[Pre-Chorus: heartbeat sub, string ostinato, voice doubled]
I-ra, i-ra, ri-el on
ka-e e-ren, ka-e e-ren

[Chorus: full, choir and low hits, the motif as the hook]
Ae-la, ae-la, ves-ta len
so-rei ri-el, mi-ra len
ka-e nao e-ren, i-ra ven
ves-ta, ves-ta, ae-la len

[Verse 2: half-time, darker, stuttered vocal chops]
Ta-mi ven, ta-mi lo
fe-ne ou-ra, fe-ne ven
lu-e na-ri, on-na so
sel-la, sel-la, lon

[Pre-Chorus]
I-ra, i-ra, ri-el on
ka-e e-ren, ka-e e-ren

[Chorus]
Ae-la, ae-la, ves-ta len
so-rei ri-el, mi-ra len
ka-e nao e-ren, i-ra ven
ves-ta, ves-ta, ae-la len

[Bridge: everything drops away, reversed choir, voice alone, a whisper rising to a cry]
nao ah-ren… nao ah-ren…
ka-e e-ren…

[Break: total silence]

[Final Chorus: key lifts, everything at once]
Ae-la, ae-la, ves-ta len
so-rei ri-el, mi-ra len
ka-e nao e-ren — i-ra, i-ra ven

[Outro: a distant younger voice answers, falling]
ven-na lon

[Hard cut]
Ae-la.
[End]
```

What it says:

| | |
|---|---|
| Ae-la… ae-la ven | Remember… remember me |
| Fe-ne so-rei, fe-ne lo / mi-na tor, a-ve lo | Shards of light, shards here / a hand in the water, still here |
| sil-ve ven, sil-ve ou-ra / ves-ta sel-la, nao ah-ren | I forget, the world forgets / the afterimage stays, not gone |
| I-ra, i-ra, ri-el on / ka-e e-ren | Find it, find it, far ahead / if it's real |
| Ae-la, ae-la, ves-ta len / so-rei ri-el, mi-ra len | Remember, remember, the afterimage again / light far off, a face again |
| ka-e nao e-ren, i-ra ven / ves-ta, ves-ta, ae-la len | Even if it isn't real, I find it / afterimage, afterimage, remember again |
| Ta-mi ven, ta-mi lo / fe-ne ou-ra, fe-ne ven | I walk, I walk here / the world in shards, me in shards |
| lu-e na-ri, on-na so / sel-la, sel-la, lon | A breath beside me, a small one, and / stay, stay, home |
| nao ah-ren… ka-e e-ren… | Not gone… if it's real… |
| ven-na lon | We, home |
| Ae-la. | Remember. |

### Getting Suno to sing it well

- Keep the hyphens: they tell Suno where the syllables break. Open vowels (a, e, o) carry best
  on long notes, which is why the chorus leans on *ae-la* and *ves-ta*.
- If it mispronounces a word, respell it the way it should sound. The pronunciation guide is below.
- Generate many takes. Keep the one where the chorus hook is the motif and the bridge truly
  drops to silence.
- **Extend** a good take for a longer trailer cut; **Get Stems** gives a voice-only version, and
  the a cappella intro alone works as a teaser.
- Save it as `game/public/audio/main_theme.mp3`. It can then play on the title screen and in a
  trailer.

## The language

The other tracks' words were written as sound. To give the main theme meaning, they now have
meanings, chosen to fit where each was sung, so every earlier lyric still works. The grammar is
plain: words in order, nothing inflected, *nao* before what it denies, *len* after what returns.

**Pronunciation:** *ae* = "ah-eh", *ei* = "ay", *ou* = "oh-oo", *e* always "eh", *r* lightly tapped.

| Word | Meaning | | Word | Meaning |
|---|---|---|---|---|
| ae-la | remember | | ta-mi | walk |
| ven | I, me | | ve-la | run, go |
| ven-na | we | | on | on, ahead |
| so-rei | light | | lon | home |
| mi-na | hand | | ri-el | far, away |
| mi-ra | face | | lo | here |
| tor | water | | len | again |
| a-ve | still, stillness | | so | and |
| sel-la | stay | | nao | not |
| ta-ve | hold | | ka-e | if |
| lu-e | breath | | e-ren | real, true |
| na-ri | beside | | i-ra | find |
| on-na | small one | | sil-ve | forget |
| fe-ne | shard, glass | | ves-ta | afterimage (light that stays) |
| ou-ra | the world | | ah-ren | gone |

Read this way, the Part I ending's *"ae-la ven so-rei"* becomes "I remember the light". The past's
climax, *"ve-la, so-rei, ve-la on"*, becomes "run, light, run on".

---

## One melody for the whole game

Every cue grows from the game's three-note motif: **A4 → E5 → D5**, then an octave up. The
grove returns it note by note, and the mirror pool plays it whole.
`game/audio-src/afterimage_motif_seed.wav` is a 20-second felt-piano sketch of it (60 BPM, over
a low A).

In Suno's Custom mode, **upload the seed** and use **Cover** (or **Extend**) with the prompts
below, so each track keeps the melody. Key **A minor / D**, **60–66 BPM**. Generate several and
keep the takes where the motif survives.

**Where the files go.** Save them to `game/public/audio/` with the names below. The `grove`
and `gate` cues loop in the game, so trim them at a bar line (e.g. in Audacity) so the end
flows into the start.

## Settings used in every prompt

In **Exclude styles**, add:

```
drums, trap, EDM, rap, male vocals, autotune, upbeat, pop chorus
```

Leave the credits song unrestricted.

---

## 1. `part1_open.mp3`: the cold open (about 2:00)

This plays under the first narration ("when I woke my memories were gone", up to "I keep
coming back to this moment"). It must leave room for the spoken lines.

**Style**
```
slow ambient neoclassical, solo felt piano, soft sustained strings, distant ethereal female vocalise (wordless, breathy, far away), melancholic, fragile, sparse, lots of space and silence between phrases, dusty warm reverb, tape hiss, 62 BPM, A minor, cinematic video game score, intimate, no percussion
```

**Lyrics**
```
[Intro: solo felt piano, the three-note motif, slowly]
[Instrumental]
[Break: long silence, room tone]
[Verse: strings enter very softly]
[Instrumental]
[Bridge: distant female vocalise, wordless]
Ah— … oh—
[Instrumental: piano alone]
[Outro: fade into air]
[End]
```

## 2. `part1_end.mp3`: the walk toward the arches, and the end card (about 2:30)

This is the first time the theme is sung in full.

**Style**
```
emotional cinematic ballad, slow build, solo female voice singing in an invented language, ethereal and haunting, lament, soft piano, warm strings swelling, low cello, choir pad, melancholic but hopeful, post-apocalyptic ruins, dreamlike, 64 BPM, A minor to D major lift at the end, video game ending theme, no drums
```

**Lyrics** (invented language; sing it as sound, not meaning)
```
[Intro: piano, the three-note motif]
[Verse: solo female voice, soft]
Ae-la ven so-rei
mi-na tor a-ve
sel-la, sel-la oh
ven-na ri-el lo
[Instrumental: strings answer]
[Chorus: voice opens, strings swell]
Ae-la, ae-la ven
so-rei mi-ra len
ta-ve on-na sel
ae-la ven so-rei
[Bridge: voice alone, fragile]
mi-na… mi-na tor…
[Final Chorus: full, then falling away]
Ae-la, ae-la ven
so-rei mi-ra len
[Outro: piano, the motif, unresolved]
[End]
```

## 3. `grove.mp3`: walking the grove between memories (looped, 3–4 min)

This must never climax. It sits under walking and stops for each memory.

**Style**
```
ambient drone, slow evolving pads, faint felt piano notes far apart, distant wordless female humming in reverb, wind-like textures, glassy harmonics, dusty forgotten ruins, contemplative, lonely, weightless, 60 BPM feel, A minor, seamless loop, no melody hooks, no drums, no build
```

**Lyrics**
```
[Instrumental: ambient pads]
[Verse: distant female humming, wordless, very far]
mm— … mm—
[Instrumental: piano, three notes, far apart]
[Instrumental: pads]
[End]
```

## 4. `part2_gate.mp3`: the refuge gate, present day (looped, about 1:30)

This covers the reflex, the recognition and the place: tension under tenderness.

**Style**
```
dark ambient cinematic, low sustained strings, deep cello pulse like a slow heartbeat, metallic resonances and bowed metal, distant female vocalise restrained and aching, industrial ruin atmosphere, suspense without action, 60 BPM, D minor, minimal, no drums, loopable
```

**Lyrics**
```
[Intro: low strings, bowed metal]
[Instrumental: slow cello pulse]
[Verse: female vocalise, wordless, restrained]
Oh— … ah—
[Instrumental]
[End]
```

## 5. `part2_past.mp3`: the memory (about 3:00, one arc)

The arc runs from tenderness, through the flight and holding the gate, to the choice. It should
end cut off rather than resolved: the game hard-cuts to silence at the blackout.

**Style**
```
cinematic emotional score in one arc: begins tender with music-box and soft piano and warm female voice, grows urgent with driving low strings and taiko-like low pulses (no drum kit), rises to a desperate choir and full strings, female voice soaring in an invented language, heartbreaking, sacrificial, then stops abruptly, 66 BPM building, A minor, video game climax
```

**Lyrics**
```
[Intro: music box, the three-note motif, gentle]
[Verse: female voice, warm, close]
Lu-e na-ri, lu-e so
ta-mi ven, ta-mi lo
[Build: strings driving, low pulses]
[Chorus: voice rising, choir behind]
Ve-la, ve-la, so-rei on
mi-na ta-ve, ven-na lon
[Bridge: voice alone over held strings]
lu-e… na-ri…
[Climax: full choir, voice at its height]
Ve-la, so-rei, ve-la on
[Cut: stop abruptly]
[End]
```

## 6. `part2_end.mp3`: the strip on the bolt, the turn, the card (about 2:30)

This comes after "I remember why I stayed", into "now I have someone to find". The theme
returns complete, quieter than the climax: resolve, not triumph.

**Style**
```
slow emotional resolution, solo piano and warm strings, female voice singing the main theme in an invented language, intimate then opening wide, bittersweet hope, a promise, gentle choir at the end, sunlight through ruins, 62 BPM, A minor resolving to D major, video game credits theme, no drums
```

**Lyrics**
```
[Intro: piano, the three-note motif, slowly]
[Verse: female voice, close, tender]
Ae-la ven so-rei
lu-e na-ri, lu-e so
[Instrumental: strings]
[Chorus: voice opens, choir softly]
Ae-la, ae-la ven
ta-mi ven, ta-mi lo
so-rei mi-ra len
[Outro: piano, the motif, resolved at last]
[End]
```

---

## Optional: the credits song (English)

This takes inspiration from Lies of P's "Feel" without copying it: one human song in words,
over the credits only, so the story's narration stays untouched. The goal is emotional and
melancholic, a song from a world that's gone. There are five directions, all with the same
lyrics; generate each and keep the one that hurts the most.

In **Exclude styles**, add:

```
upbeat, pop, EDM, trap, rap, male vocals, autotune, swing, big band
```

### A. Mythical slow jazz (recommended)

Jazz as a memory, not a nightclub: the song on an old record, played in the ruins, heard as if
through water.

```
slow mythical jazz ballad, video game fantasy, haunting female vocals with soft breathy delivery, warm felt piano, muted trumpet far away in reverb, upright bass, harp glissandi, celesta and choir pads underneath, dreamlike and melancholic, like a song from a lost kingdom playing on a worn record in the ruins, faint vinyl crackle, 64 BPM, A minor, no drum kit, emotional, bittersweet
```

### B. Melancholic piano

Closest to the game's own score: just her and a piano.

```
melancholic piano ballad, solo grand piano with soft pedal, intimate female vocals, fragile and aching, close-mic breath, sparse cello joining in the second chorus, rain and room tone, emotional, bittersweet, slow rubato, 60 BPM, A minor resolving to D major at the end, video game credits song, no drums
```

### C. Cinematic orchestral with haunting vocals

The widest: NieR's weight, with English words.

```
cinematic orchestral ballad, haunting ethereal female vocals, slow build, soft piano intro, warm strings swelling, low cello and horns, distant wordless choir behind the chorus, harp, post-apocalyptic melancholy, sorrowful and hopeful at once, emotional climax then a quiet ending, 62 BPM, A minor to D major lift, video game ending theme, no drum kit
```

### D. Soprano chanson, cinematic (after Clair Obscur)

A soprano lead as the heart of the song, French-film melancholy, and an operatic lift in the
last chorus.

```
cinematic chanson ballad, emotional soprano female lead, intimate verses then operatic climax, solo piano and nylon guitar, warm strings, accordion softly in the background, cello countermelody, French film melancholy, nostalgic and heartbreaking, grand final chorus then a whisper ending, 66 BPM, A minor, video game ending song, no drum kit
```

### E. The voice that comes back (after GRIS)

It starts almost empty and lets the voice carry the grief; the piano is slowly surrounded by
strings and swelling synths, then everything falls away to the voice.

```
minimal emotional ballad, raw close female voice with almost nothing under it, single sustained keyboard chords, harmonium, then violins and soft horns slowly swelling around the piano, dreamy analog synth pads, grief and quiet hope, vast empty space, the voice alone at the very end, 60 BPM, F minor to A-flat major, video game credits theme, no drums
```

### Lyrics (the same for all five)

The section tags are neutral, so the style decides the arrangement.

```
[Intro: soft, the three-note motif]

[Verse 1]
Hold my hand the way you did
When the water was the only thing we knew
Every ring that crossed the stillness
Was a small word meaning you

[Chorus]
Stay a while, the light is low
Let the old songs play us slow
If the world forgets our faces
I'll still know you, I'll still know

[Instrumental: the melody answered]

[Verse 2]
I have walked through rust and silence
Where the arches hold the sky
Keep a piece of you in ochre
Close enough to hear you sigh

[Chorus]
Stay a while, the light is low
Let the old songs play us slow
If the world forgets our faces
I'll still know you, I'll still know

[Outro: voice alone, then the motif, fading]
I'll still know…

[End]
```

To keep it in the family, upload `afterimage_motif_seed.wav` with **Cover** here too. The
intro then opens on the game's three notes.

---

## The voice as her story (after GRIS and Clair Obscur)

GRIS gives its heroine's grief to a voice she loses. Clair Obscur uses a soprano lead and
recurring themes across very different styles. AFTERIMAGE can do both: **the woman's voice in
the score is her lost self**, and it comes back as she does.

| Where | The voice |
|---|---|
| Part I, the opening | Barely there: a breath, far away. |
| The grove | Humming, distant, never close. |
| The mirror pool / Part I's end | Sung whole for the first time, in the invented language. |
| Part II, the past | A second, younger voice joins hers; at the blackout it stops mid-phrase. |
| Part II's end | Hers alone, close, in the invented language. |
| Credits | Words at last, in English: she has someone to find. |

The motifs in the style of Clair Obscur's recurring themes:
- **Hers:** A → E → D (the game's motif, `afterimage_motif_seed.wav`).
- **The child's:** answers it, falling D → C → A.
- **The refuge:** slow low strings over bowed metal.

Styles can change from cue to cue as long as these return.

If you remake any cue, the one that gains most is **`part2_past`**. Add to its style: `a second, younger female voice joins in a duet, and at the climax that voice stops abruptly mid-phrase`.

---

## Stems: letting the game layer the score

The game can play a cue as separate stems in sync and bring each in or out (see the game
README, "A layered score"). Suno's **Get Stems** on a finished track gives you **vocals** and
**instrumental**, which is enough:

1. Export both stems of the cue as MP3.
2. Name them `<cue>_voice.mp3` and `<cue>_instruments.mp3`, where the cue is `grove`, `gate`,
   `past`, `trace`, `open` or `end`.
3. Put them in `game/public/audio/stems/`.
4. List them in `game/public/audio/stems/stems.json`:

```json
{ "grove": ["instruments", "voice"] }
```

What the game does with them now:
- **grove:** the voice starts almost silent and grows with each memory she finds. That is the
  voice arc above, played live.
- **gate** during the route collapse: a `pulse` stem, if you make one, comes in. It could be
  a low-strings or taiko-like layer exported from a separate generation at the same tempo.
- **Chapter VI (the other side):** the grove cue with the voice at full, heard as if from
  inside.

Stems must be the same length and start at the same point (Suno's stems of one track are).

