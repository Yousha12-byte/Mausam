# Mausam — Demo Script

**SIH26076 · Personalized Weather Homepage PWA**
Edge to edge on a phone; a scaled-up window on a projector; installs to the home screen;
works offline.

---

## 1. The problem, in one line

A weather app tells you it is 28 °C and 70% chance of rain. It does not tell you whether
**your** 5:30 PM commute is going to be a problem, or what to do about it.

---

## 2. The 90-second demo script

Open the app. The header shows **Kochi · Kerala** and the local time.

### Beat 1 — It is already personal
The hero greets by name and the first card is not "today's forecast" — it is
**"For you, today."** The page is organised around the user's routine, not around
meteorology.

### Beat 2 — The whole page reacts to the weather
Open **Settings → Presentation** and tap **Rain**. The sky darkens within a second, rain
starts falling, and the accent colour shifts. The atmosphere is not decoration
around a weather app; it is the readout.

### Beat 3 — Weather → Context → Decision
The commute card turns amber and says:

> College to home around 5:30 PM may be affected
> **Consider leaving 45 min earlier, at 4:45 PM**

Then **Why we say this** — expanded by default, never hidden behind a tap:

- the data: heavy rain, 5.6 mm/h, visibility down to 4.5 km
- your profile: 35 minutes outdoors, auto, 70% exposed
- the timing: peaking at 6:00 PM, right across the journey

Three sources, each labelled. This is the core of the product.

### Beat 4 — It admits what it does not know
Under the verdict, a **confidence** bar breaks down into three honest factors:
how far ahead the forecast reaches, how steady the user's departure time is, and
whether this is simulated scenario data. Widen the variance in the profile sheet
and watch confidence drop. The app tells you when it is less sure instead of
pretending otherwise.

### Beat 5 — Ask "what if?"  ← the moment judges remember
Tap **What if I left at a different time?** A slider scores every candidate
departure, not just the one it recommends. Slide to 4:45 PM and the card flips:

> College to home **looks clear**

The banner confirms it is a what-if, and clearing it restores the original call.
The reasoning is not hidden behind the answer — you can interrogate it.

### Beat 6 — It refuses to cry wolf
In Presentation, tap **Sunny** and then **Cloudy**. The verdict is "looks clear", and it stays clear.
The same threshold that flags rain does not manufacture anxiety on a pleasant day.

### Beat 7 — Severe weather overrides everything
In Presentation, tap **Thunderstorm**. A safety banner takes the top slot, and the commute card
stops offering to re-time the journey into a thunderstorm. Mausam will not
optimise you into danger.

### Beat 8 — The night, and the honesty after midnight
In Presentation, tap **Clear night**: stars, a moon placed by real lunar math, a deep sky. Then
notice it does not fabricate a verdict. Once the day's routines are done, it says
**"Tomorrow's home to college is at 8:15 AM"** and says it will not borrow today's
numbers to call tomorrow. It would have been easy — and wrong — to score tomorrow
against today's stale hours.

### Beat 9 — Sound, and a page that looks finished
The speaker button synthesises ambience per state (no audio files): rain hiss,
thunder rumble on a randomised interval, muffled fog, crickets at night. The
audio graph is gesture-gated by the browser.

Everything else configurable lives behind the **Settings** button in the header:
ambience, whether the sky animates, a "use real time" reset when a scenario has
pinned the clock, and the six presentation skies. The homepage itself carries no
demo chrome — no "Demo scenarios", no "Clock pinned", no "Reduce motion" — so it
reads as a finished consumer app rather than a test harness. Choices persist.

### Beat 10 — It installs and it works offline
Build and serve the production bundle, then install it. Turn off the network and
cold-reload: the app still opens, still renders both canvases, and the badge
reads **"Offline · simulated"** — the mock provider, not a spinner.

---

## 3. Things worth saying out loud

**Every scenario pins its own clock.** Rain is always 4:20 PM, fog always 6:30 AM,
thunderstorm always 5:10 PM. A demo that shows a thunderstorm at noon because
that is when the presenter happened to run it is a broken demo. There is a test
that fails if a scenario's label and its rendered sky ever disagree.

**The astronomy is real, and tested.** Sun position, sunrise/sunset, lunar phase
and moon placement are computed from day-of-year and hour angle. There are tests
asserting the sun rises in the east, transits due south, and sets in the west;
that Kerala's days are longer than Delhi's near the equinox; and that a full moon
rises at sunset. Two genuine bugs were caught this way: an inverted azimuth that
put the sunrise in the west, and a sign error that put a full moon opposite the
wrong side of the sky.

**The engine is a pure function.** `runDecisionEngine` takes a forecast and a
profile and returns decisions. No React, no DOM, no clock, no network. That is
why 58 tests run in under a second and why the what-if control can re-run the
entire page in memory.

**The domain has one meaning of severity.** Sensitivity lives in the profile, not
in the thresholds, so the same storm can be "ignore" for one person and "act now"
for another. The output is ordered by what matters *to this user*, not by severity
in the abstract.

**Reduced scope on purpose.** The atmosphere is CSS + Canvas 2D, not WebGL. There
is no state-management library beyond a small Zustand store, no component library,
no charting dependency. The heaviest dependency is React.

---

## 4. Honest limitations

- Open-Meteo is used directly, so it is a global forecast rather than an India-specific
  IMD one. IMD integration is stubbed behind the same provider interface.
- When a day's routines are over, the app previews tomorrow but does not score it.
  The hourly feed does carry tomorrow, but the engine indexes hours by time of day,
  so scoring it would silently reuse today's numbers. An honest "I don't know yet"
  beat a confident wrong answer; indexing by absolute timestamp is the next fix.
- Ambient audio is synthesised noise and tones, not field recordings.
- The service worker is enabled in production builds only, so dev hot reload stays honest.
- Not yet packaged for the app stores; it is an installable PWA, and Capacitor/TWA
  wrapping would be the next step.

---

## 5. On a projector

Below 1024px the app is exactly the mobile app, edge to edge, with no frame at all.
Above it, the app becomes a window on a stage: 34px corners, a hairline edge and a
soft shadow. The stage around it is a flat near-black (`rgb(8,10,14)`) — deliberately
neutral, because **the weather belongs to the app, not the room**. The sky is clipped
to the app's own bounds and scrolls with the content; nothing spills onto the stage.

**The window scales as one piece.** Mausam is laid out once at 430px wide and then
scaled by a single factor, stepped to the room available — 1.34x on a 1080p projector
(576px), less on shorter screens. Type, spacing, corner radii and the weather world all
grow together, so a projector gets a bigger *app*, not a stretched one. Widening the
window while leaving components at their mobile pixel sizes would have shrunk the type
relative to the frame, which is the opposite of what a projector needs.

The height is derived from the space available rather than fixed, so the window always
fills the stage exactly and can never overflow it, at any scale. The canvases sample
at the *painted* ratio, so the weather stays pixel-sharp instead of being upscaled.

The page itself never scrolls. The app scrolls internally, pinned to the viewport.
Sheets are siblings of the window, not children of it, so they carry the same scale
explicitly: on a projector a bottom sheet pinned to the screen edge would sit visibly
apart from the app it belongs to, so it becomes a centred dialog matched to the
window's width and centre.

The consequence for the demo: everything that matters — the current conditions, the
one primary insight, the hours — is above the fold with no interaction. The six skies
are in **Settings → Presentation**: tap the gear in the header, pick a state, and the
whole page and sky follow. What-if and the routine editor open as sheets from the
insight and the header.

## 6. Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 58 tests
npm run build      # production bundle + service worker
npm run preview    # serve the production build (PWA active here)
```

The service worker is disabled in dev on purpose — run `preview` to exercise
install and offline behaviour.
