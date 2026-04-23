import { useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./App.css";

const PINCH_RATIO_THRESHOLD = 0.6;

interface Landmark {
    x: number;
    y: number;
    z: number;
}

interface Pinch {
    ndc: { x: number; y: number };
    palmSize: number;
}

interface Physics {
    vel: THREE.Vector3;
    angularVel: THREE.Vector3;
    grabDist: number;
    initialGrabDist: number;
    initialPalmSize: number;
    wasGrabbing: boolean;
    activePinchesCount: number;
    grabOffset: THREE.Vector3;
    time: number;
    maxDim: number;
    halfHeight: number;
    smoothedVec: THREE.Vector3 | null;
    lastVec: THREE.Vector3 | null;
}

function mpToNDC(x: number, y: number): { x: number; y: number } {
    return { x: (1 - x) * 2 - 1, y: -(y * 2 - 1) };
}

function drawHand(
    ctx: CanvasRenderingContext2D,
    landmarks: Landmark[],
    connections: ReadonlyArray<{ start: number; end: number }>,
    w: number,
    h: number,
    pinching: boolean,
): void {
    const px = (lm: Landmark) => lm.x * w;
    const py = (lm: Landmark) => lm.y * h;

    const glowFaint = pinching ? "rgba(252,211,77,0.25)" : "rgba(255,255,255,0.25)";
    const glowColor = pinching ? "#fcd34d" : "white";
    const lineColor = pinching ? "rgba(252,211,77,0.9)" : "rgba(255,255,255,0.9)";
    const dotFaint = pinching ? "rgba(252,211,77,0.15)" : "rgba(255,255,255,0.15)";

    ctx.save();
    ctx.strokeStyle = glowFaint;
    ctx.lineWidth = 12;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 24;
    ctx.lineCap = "round";
    for (const { start: i, end: j } of connections) {
        ctx.beginPath();
        ctx.moveTo(px(landmarks[i]), py(landmarks[i]));
        ctx.lineTo(px(landmarks[j]), py(landmarks[j]));
        ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 6;
    ctx.lineCap = "round";
    for (const { start: i, end: j } of connections) {
        ctx.beginPath();
        ctx.moveTo(px(landmarks[i]), py(landmarks[i]));
        ctx.lineTo(px(landmarks[j]), py(landmarks[j]));
        ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = dotFaint;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 20;
    for (const lm of landmarks) {
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), 10, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = glowColor;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 8;
    for (const lm of landmarks) {
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    if (pinching) {
        const thumb = landmarks[4];
        const index = landmarks[8];
        const indexMcp = landmarks[5];
        const pinkyMcp = landmarks[17];

        const palmPixelSize = Math.hypot(
            px(indexMcp) - px(pinkyMcp),
            py(indexMcp) - py(pinkyMcp),
        );

        const glowRadius = palmPixelSize * 0.3;
        const mx = (px(thumb) + px(index)) / 2;
        const my = (py(thumb) + py(index)) / 2;

        ctx.save();
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, glowRadius);
        gradient.addColorStop(0, "rgba(252,211,77,0.9)");
        gradient.addColorStop(0.3, "rgba(252,211,77,0.5)");
        gradient.addColorStop(1, "rgba(252,211,77,0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(mx, my, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#fcd34d";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(mx, my, glowRadius * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

export default function App() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const threeRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef(0);
    const gestureRef = useRef<{ pinches: Pinch[] }>({ pinches: [] });
    const modelRef = useRef<THREE.Group | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const actionRef = useRef<THREE.AnimationAction | null>(null);
    const resetRef = useRef<(() => void) | null>(null);

    const [status, setStatus] = useState("초기화 중...");

    // ── MediaPipe 핸드트래킹 ─────────────────────────────────────
    useEffect(() => {
        let running = true;

        async function init() {
            setStatus("MediaPipe 로딩 중...");
            const vision = await FilesetResolver.forVisionTasks(import.meta.env.BASE_URL + "wasm");
            const handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "CPU",
                },
                runningMode: "VIDEO",
                numHands: 2,
            });
            const connections = HandLandmarker.HAND_CONNECTIONS;

            setStatus("카메라 연결 중...");
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: "user" },
            });

            const video = videoRef.current!;
            video.srcObject = stream;
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => resolve();
                video.onerror = reject;
            });
            await video.play();

            const canvas = canvasRef.current!;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d")!;

            setStatus("");

            let lastTimestamp = -1;
            function detect() {
                if (!running) return;
                if (video.readyState >= 2) {
                    const now = performance.now();
                    if (now > lastTimestamp) {
                        lastTimestamp = now;
                        const results = handLandmarker.detectForVideo(video, now);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);

                        const pinches: Pinch[] = [];

                        for (const lm of results.landmarks ?? []) {
                            const thumb = lm[4];
                            const index = lm[8];
                            const indexMcp = lm[5];
                            const pinkyMcp = lm[17];

                            const palmSize = Math.hypot(
                                indexMcp.x - pinkyMcp.x,
                                indexMcp.y - pinkyMcp.y,
                                indexMcp.z - pinkyMcp.z,
                            );
                            const pinchDist = Math.hypot(
                                thumb.x - index.x,
                                thumb.y - index.y,
                                thumb.z - index.z,
                            );
                            const isPinching = pinchDist / palmSize < PINCH_RATIO_THRESHOLD;

                            if (isPinching) {
                                pinches.push({
                                    ndc: mpToNDC(
                                        (thumb.x + index.x) / 2,
                                        (thumb.y + index.y) / 2,
                                    ),
                                    palmSize,
                                });
                            }

                            drawHand(ctx, lm, connections, canvas.width, canvas.height, isPinching);
                        }

                        gestureRef.current = { pinches };
                    }
                }
                animRef.current = requestAnimationFrame(detect);
            }
            detect();
        }

        init().catch((err: unknown) => {
            console.error(err);
            setStatus("오류: " + String(err));
        });

        return () => {
            running = false;
            cancelAnimationFrame(animRef.current);
            const src = videoRef.current?.srcObject;
            if (src instanceof MediaStream) src.getTracks().forEach((t) => t.stop());
        };
    }, []);

    // ── Three.js FBX 렌더링 ──────────────────────────────────────
    useEffect(() => {
        const canvas = threeRef.current!;

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.AgXToneMapping;
        renderer.toneMappingExposure = 1.5;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 5, 10000);

        const hemi = new THREE.HemisphereLight(0xffffff, 0xffe8f0, 2.5);
        scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xffffff, 2.5);
        sun.position.set(4, 8, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.near = 0.1;
        sun.shadow.camera.far = 500;
        scene.add(sun);

        const fill = new THREE.DirectionalLight(0xe8d0ff, 1.5);
        fill.position.set(-4, 3, -3);
        scene.add(fill);

        const front = new THREE.DirectionalLight(0xfff0f8, 1.2);
        front.position.set(0, 2, 8);
        scene.add(front);

        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;

        const physics: Physics = {
            vel: new THREE.Vector3(),
            angularVel: new THREE.Vector3(),
            grabDist: 300,
            initialGrabDist: 300,
            initialPalmSize: 0,
            wasGrabbing: false,
            activePinchesCount: 0,
            grabOffset: new THREE.Vector3(),
            time: 0,
            maxDim: 100,
            halfHeight: 0,
            smoothedVec: null,
            lastVec: null,
        };
        const raycaster = new THREE.Raycaster();

        new FBXLoader().load(
            import.meta.env.BASE_URL + "Nubzuki_BigEye.fbx",
            (fbx) => {
                fbx.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const wasArray = Array.isArray(child.material);
                    const mats = (wasArray ? child.material : [child.material]) as THREE.MeshStandardMaterial[];
                    const newMats = mats.map(
                        (m) =>
                            new THREE.MeshStandardMaterial({
                                color: m.color ?? 0xffffff,
                                map: m.map ?? null,
                                normalMap: m.normalMap ?? null,
                                roughness: 0.88,
                                metalness: 0.0,
                            }),
                    );
                    child.material = wasArray ? newMats : newMats[0];
                });

                if (fbx.animations && fbx.animations.length > 0) {
                    mixerRef.current = new THREE.AnimationMixer(fbx);
                    const clip = fbx.animations[0];
                    actionRef.current = mixerRef.current.clipAction(clip, fbx);
                    actionRef.current.setLoop(THREE.LoopRepeat, Infinity);
                    actionRef.current.timeScale = 3.5;
                }

                const box = new THREE.Box3().setFromObject(fbx);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                fbx.position.sub(center);
                scene.add(fbx);
                modelRef.current = fbx;

                const maxDim = Math.max(size.x, size.y, size.z);
                physics.maxDim = maxDim;
                physics.halfHeight = size.y / 2;

                camera.position.set(0, 0, maxDim * 2);
                controls.update();

                resetRef.current = () => {
                    fbx.position.set(0, 0, 0);
                    fbx.quaternion.identity();
                    physics.vel.set(0, 0, 0);
                    physics.angularVel.set(0, 0, 0);
                    physics.smoothedVec = null;
                    physics.lastVec = null;
                    camera.position.set(0, 0, maxDim * 2);
                    controls.target.set(0, 0, 0);
                    controls.update();
                };
            },
            undefined,
            (err) => console.error(err),
        );

        const timer = new THREE.Timer();
        let accumulator = 0;
        const timeStep = 1 / 60;

        let animId: number;
        function animate() {
            animId = requestAnimationFrame(animate);
            timer.update();
            const delta = timer.getDelta();
            accumulator += delta;

            if (mixerRef.current) mixerRef.current.update(delta);

            while (accumulator >= timeStep) {
                physics.time += timeStep;

                const model = modelRef.current;
                let pinches = gestureRef.current.pinches;

                if (model) {
                    const centerPos = model.position.clone();
                    centerPos.y += physics.halfHeight;

                    if (pinches.length === 2 && pinches[0].ndc.x > pinches[1].ndc.x) {
                        pinches = [pinches[1], pinches[0]];
                    }

                    // --- [1] 잡기 판정 ---
                    if (pinches.length > 0) {
                        const centerNDC = new THREE.Vector2();
                        if (pinches.length === 1) {
                            centerNDC.set(pinches[0].ndc.x, pinches[0].ndc.y);
                        } else {
                            centerNDC.set(
                                (pinches[0].ndc.x + pinches[1].ndc.x) / 2,
                                (pinches[0].ndc.y + pinches[1].ndc.y) / 2,
                            );
                        }

                        raycaster.setFromCamera(centerNDC, camera);

                        if (!physics.wasGrabbing || physics.activePinchesCount !== pinches.length) {
                            let startGrabbing = false;

                            if (!physics.wasGrabbing) {
                                const distToRay = Math.sqrt(raycaster.ray.distanceSqToPoint(centerPos));
                                const GRAB_RADIUS = physics.maxDim * (pinches.length === 2 ? 1.0 : 0.6);
                                if (distToRay < GRAB_RADIUS) {
                                    physics.initialGrabDist = camera.position.distanceTo(centerPos);
                                    physics.grabDist = physics.initialGrabDist;
                                    startGrabbing = true;
                                }
                            } else {
                                physics.initialGrabDist = physics.grabDist;
                                startGrabbing = true;
                            }

                            if (startGrabbing) {
                                if (!physics.wasGrabbing && actionRef.current) {
                                    actionRef.current.reset().fadeIn(0.2).play();
                                }
                                physics.initialPalmSize = pinches[0].palmSize;
                                physics.wasGrabbing = true;
                                physics.activePinchesCount = pinches.length;
                                const grabPoint = raycaster.ray.origin
                                    .clone()
                                    .addScaledVector(raycaster.ray.direction, physics.grabDist);
                                physics.grabOffset.subVectors(model.position, grabPoint);
                            }
                        }
                    } else {
                        if (physics.wasGrabbing && actionRef.current) {
                            actionRef.current.fadeOut(0.3);
                        }
                        physics.wasGrabbing = false;
                        physics.activePinchesCount = 0;
                    }

                    // --- [2] 이동 및 회전 로직 ---
                    if (physics.wasGrabbing) {
                        controls.enabled = false;

                        const centerNDC = new THREE.Vector2();
                        if (pinches.length === 1) {
                            centerNDC.set(pinches[0].ndc.x, pinches[0].ndc.y);

                            const depthRatio = physics.initialPalmSize / pinches[0].palmSize;
                            const targetDist = physics.initialGrabDist * Math.pow(depthRatio, 1.2);
                            const minDist = physics.maxDim * 1;
                            const maxDist = physics.maxDim * 7;
                            const clampedDist = THREE.MathUtils.clamp(targetDist, minDist, maxDist);
                            physics.grabDist = THREE.MathUtils.lerp(physics.grabDist, clampedDist, 0.15);
                        } else {
                            centerNDC.set(
                                (pinches[0].ndc.x + pinches[1].ndc.x) / 2,
                                (pinches[0].ndc.y + pinches[1].ndc.y) / 2,
                            );
                        }

                        raycaster.setFromCamera(centerNDC, camera);

                        const fingerPoint = raycaster.ray.origin
                            .clone()
                            .addScaledVector(raycaster.ray.direction, physics.grabDist);
                        const target = fingerPoint.add(physics.grabOffset);

                        physics.vel.copy(target).sub(model.position).multiplyScalar(0.15);
                        model.position.lerp(target, 0.15);

                        if (pinches.length === 2) {
                            const p1Ray = new THREE.Raycaster();
                            p1Ray.setFromCamera(new THREE.Vector2(pinches[0].ndc.x, pinches[0].ndc.y), camera);
                            const p1 = p1Ray.ray.at(physics.grabDist, new THREE.Vector3());
                            p1.z += (pinches[0].palmSize - 0.15) * physics.maxDim * 5.0;

                            const p2Ray = new THREE.Raycaster();
                            p2Ray.setFromCamera(new THREE.Vector2(pinches[1].ndc.x, pinches[1].ndc.y), camera);
                            const p2 = p2Ray.ray.at(physics.grabDist, new THREE.Vector3());
                            p2.z += (pinches[1].palmSize - 0.15) * physics.maxDim * 5.0;

                            const currentVec = new THREE.Vector3().subVectors(p2, p1).normalize();

                            if (!physics.smoothedVec) {
                                physics.smoothedVec = currentVec.clone();
                                physics.lastVec = currentVec.clone();
                                physics.angularVel.set(0, 0, 0);
                            } else {
                                const sv = physics.smoothedVec;
                                const lv = physics.lastVec!;
                                sv.lerp(currentVec, 0.15).normalize();
                                const q = new THREE.Quaternion().setFromUnitVectors(lv, sv);

                                const axis = new THREE.Vector3(q.x, q.y, q.z);
                                const sinHalfAngle = axis.length();

                                if (sinHalfAngle > 0.0001) {
                                    axis.divideScalar(sinHalfAngle);
                                    const angle = 2 * Math.atan2(sinHalfAngle, q.w) * 2.0;
                                    model.quaternion.premultiply(
                                        new THREE.Quaternion().setFromAxisAngle(axis, angle),
                                    );
                                    physics.angularVel.lerp(axis.clone().multiplyScalar(angle), 0.3);
                                } else {
                                    physics.angularVel.multiplyScalar(0.8);
                                }

                                physics.lastVec = sv.clone();
                            }
                        } else {
                            physics.smoothedVec = null;
                            physics.lastVec = null;

                            if (physics.angularVel.lengthSq() > 0.000001) {
                                const angle = physics.angularVel.length();
                                const axis = physics.angularVel.clone().normalize();
                                model.quaternion.premultiply(
                                    new THREE.Quaternion().setFromAxisAngle(axis, angle),
                                );
                                physics.angularVel.multiplyScalar(0.92);
                            }
                        }
                    } else {
                        controls.enabled = true;
                        physics.smoothedVec = null;
                        physics.lastVec = null;

                        if (physics.angularVel.lengthSq() > 0.000001) {
                            const angle = physics.angularVel.length();
                            const axis = physics.angularVel.clone().normalize();
                            model.quaternion.premultiply(
                                new THREE.Quaternion().setFromAxisAngle(axis, angle),
                            );
                            physics.angularVel.multiplyScalar(0.96);
                        }

                        physics.vel.y += Math.sin(physics.time * 1.2) * 0.02;
                        physics.vel.x += Math.sin(physics.time * 0.7 + 1.2) * 0.01;
                        physics.vel.z += Math.sin(physics.time * 0.9 + 0.5) * 0.01;
                        physics.vel.multiplyScalar(0.95);
                        model.position.add(physics.vel);

                        physics.angularVel.x += Math.sin(physics.time * 0.8) * 0.00005;
                        physics.angularVel.y += Math.sin(physics.time * 0.5 + 1.0) * 0.00008;
                        physics.angularVel.z += Math.sin(physics.time * 1.1 + 0.5) * 0.00004;
                    }
                }

                accumulator -= timeStep;
            }

            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        function onResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
        window.addEventListener("resize", onResize);

        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener("resize", onResize);
            renderer.dispose();
        };
    }, []);

    return (
        <div className="container">
            {status && <div className="status">{status}</div>}
            <video ref={videoRef} className="video" muted playsInline />
            <canvas ref={canvasRef} className="canvas" />
            <canvas ref={threeRef} className="three-canvas" />
            <div className="toolbar">
                <div className="toolbar-instructions">
                    <div className="instruction-item">
                        <span className="instruction-icon">☝🏻</span>
                        <span>한 손으로 꼬집어서 움직이기</span>
                    </div>
                    <div className="instruction-item">
                        <span className="instruction-icon">✌🏻</span>
                        <span>두 손으로 꼬집어서 회전하기</span>
                    </div>
                </div>
                <div className="toolbar-divider" />
                <button className="reset-button" onClick={() => resetRef.current?.()}>
                    초기화
                </button>
            </div>
        </div>
    );
}
