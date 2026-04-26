# Pinch Nubzuki

A browser-based AR toy where you grab, spin, stretch, and fling a 3D character using nothing but your hands and a webcam. No controllers, no headset — just fingers.


https://github.com/user-attachments/assets/af27c1d5-ac46-4fa4-9c90-8e3d607ad71b


## What it does

Your webcam feed becomes the background. MediaPipe tracks your hands in real time, and when you pinch your fingers together near the character, you can mess with it.

- **One hand pinch** — grab and drag the model; move your hand closer/farther from the camera to push and pull it in depth
- **Two hand pinch** — rotate it like you're holding a real object, and stretch it along the axis between your hands
- **Let go** — it keeps spinning with momentum, floating gently in place
- **Reset button** — brings everything back to center

The model plays an idle animation while you're holding it.

## Controls

Three sliders at the bottom let you tune the feel in real time:

| Slider | What it does |
|---|---|
| 꼬집기 인식 | Pinch sensitivity — how hard you have to pinch to register a grab |
| 회전 속도 | Rotation speed for two-hand spinning |
| 쫀쫀함 | Stretch stiffness — how snappy the squash-and-stretch spring feels |

## Stack

- **React + Vite + TypeScript** — minimal UI shell
- **MediaPipe Tasks Vision** — hand landmark detection, CPU delegate
- **Three.js** — 3D rendering on a transparent WebGL canvas layered over the webcam feed
- **FBX Loader** — loads the Nubzuki character model

## Running it

```bash
npm install
npm run dev
```

Open in Chrome or Edge (Safari webcam permissions are a pain). Allow camera access. Give it a few seconds to load the MediaPipe model, then put your hand in front of the camera and pinch near the character.

## How the gesture detection works

Each frame, MediaPipe returns 21 landmarks per hand. Pinch detection compares the distance between thumb tip (landmark 4) and index tip (landmark 8) against the palm width — if the ratio falls below the threshold slider value, it counts as a pinch.

For single-hand grabs, palm size change over time is used to infer depth movement — a shrinking palm means the hand moved away, growing means it moved closer.

For two-hand rotation, the vector between the two pinch points is tracked frame-to-frame. The delta rotation is applied to the model each frame with smoothing and angular momentum so it doesn't feel jerky. The distance between the two points drives a squash-and-stretch spring along that same axis.

## Project structure

```
src/
  App.tsx   — everything is here
  App.css   — styling
public/
  Nubzuki_BigEye.fbx   — the character model
  wasm/                — MediaPipe WASM runtime
  icon.png             — favicon
```

## Notes

- The model floats and slowly rotates on its own when idle. That's intentional — it looks alive.
- Works best with good lighting so MediaPipe can see your hands clearly.
- Mouse orbital controls are intentionally disabled — all interaction is hand-based.
