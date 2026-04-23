# AR Nupzuki

A browser-based AR toy that lets you grab, spin, and throw around a 3D character using just your hands and a webcam. No controllers, no headset, no setup — just you and your fingers.

## What it does

Your webcam feed becomes the background. MediaPipe tracks your hands in real time, and when you pinch your fingers together, you can interact with the Nupzuki model floating on screen.

- **One hand pinch** — grab and drag the model around
- **Two hand pinch** — rotate it like you're holding a real object
- **Let go** — it keeps spinning with momentum, gently floating in place
- **Reset button** — brings everything back to center when you've flung it somewhere offscreen

The model also plays an animation when you're holding it.

## Stack

- **React + Vite** — just for the UI shell, there's barely any React here honestly
- **MediaPipe Tasks Vision** — hand landmark detection, runs on CPU
- **Three.js** — 3D rendering with a transparent WebGL canvas layered over the webcam feed
- **FBX Loader** — loads the Nupzuki character model

## Running it

```bash
npm install
npm run dev
```

Open it in Chrome or Edge (Safari's webcam permissions are annoying). Allow camera access when prompted. Give it a few seconds to load the MediaPipe model — then put your hand in front of the camera and pinch near the character.

## How the gesture detection works

Each frame, MediaPipe gives back 21 landmarks per hand. Pinch detection compares the distance between the thumb tip (landmark 4) and index tip (landmark 8) against the palm size — if the ratio is below `0.6`, it's a pinch.

For two-hand rotation, it tracks the vector between the two pinch points and applies the delta rotation to the model each frame with a bit of smoothing and momentum so it doesn't feel jerky.

## Project structure

```
src/
  App.jsx   — everything, it's one file, don't judge
  App.css   — styling
public/
  Nubzuki_BigEye.fbx   — the character
  wasm/                — MediaPipe WASM runtime
```

## Notes

- The model floats around slightly even when you're not touching it. That's on purpose, it looks alive.
- Works best with decent lighting so MediaPipe can actually see your hands.
- The `PINCH_RATIO_THRESHOLD` constant at the top of `App.jsx` controls how hard you have to pinch — lower it if detection feels too sensitive.
