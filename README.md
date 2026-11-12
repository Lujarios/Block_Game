# Block Game

A personal 8x8 block puzzle. No ads, no accounts, no network calls. Two fixed colours: slate for the board, amber for the pieces in your hand.

## Rules

- Drag any of the three pieces onto the board. Pieces do not rotate.
- A full row or column clears. Several can clear at once.
- When all three pieces are placed, three more arrive.
- The game ends when none of the pieces you have left fits.

### Scoring

| Event | Points |
| --- | --- |
| Placing a piece | 1 per cell |
| Clearing lines | 10 for one, 30 for two, 60 for three, 100 for four, times your streak |
| Streak | Goes up by one with every clearing move. Resets after three moves in a row without a clear |
| Emptying the board | +300 |

These numbers are my own approximation, not the original game's. They live in `place()` in `src/engine.js`.

## How hands are chosen

Every hand is checked by a solver before you see it, so there is always an order and a set of positions that places all three pieces. If you lose, there was a way out.

The dealer moves between phases that last one to four hands each:

| Phase | What it deals |
| --- | --- |
| Breeze | Small, friendly pieces with many places to go |
| Awkward | Bulky pieces (3x3, long bars, big corners, diagonals) that all fit but leave the board lumpy |
| Puzzle | At least one piece has nowhere to go until the other pieces clear room for it |
| Clear | If the board can be emptied with three pieces or fewer, exactly those pieces. Otherwise pieces that let you tidy up toward that |

Phase odds shift with how full the board is and how high the score is. Outside the Clear phase, a wipe that happens to be reachable is still offered about 60% of the time. The single-cell piece only appears as a rescue when nothing else is solvable.

To tune it, edit `WEIGHTS`, `MODES` and `choosePhase` in `src/engine.js`.

## Project layout

```
src/engine.js      rules, solver, dealer (no DOM, runs in Node)
src/ui.js          drag and drop, rendering, saving
src/style.css      look and layout
src/template.html  page shell
build.js           inlines everything into one HTML file
test/sim.js        plays hundreds of bot games and proves every dealt hand is solvable
docs/              the built app: index.html, manifest, icons, service worker
```

```
npm run build   # rebuild docs/index.html and dist/index.html after editing src/
npm test        # run the simulations
npm run serve   # try it locally in a browser
```

## Putting it on your iPhone

### Option A: home-screen app (works from Windows, about five minutes)

1. Push this folder to a GitHub repository.
2. In the repository, open Settings, then Pages. Under Build and deployment choose Deploy from a branch, pick `main`, and set the folder to `/docs`.
3. Open the Pages address in Safari on your phone, tap Share, then Add to Home Screen.

It opens full screen with its own icon, works offline after the first launch, and never expires. Your best score and current game are saved on the phone.

### Option B: native app signed with your Apple Developer account

iOS apps can only be compiled on macOS, so this needs a Mac or a hosted macOS build machine.

On a Mac with Xcode:

```
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap open ios
```

In Xcode, choose your team under Signing & Capabilities, plug in the phone, and press Run. `capacitor.config.json` is already set up. Change `appId` if you want a different bundle identifier.

This route has not been built or tested yet. Only the web version has.
