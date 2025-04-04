// 3D Orbits – Advanced Collision Prediction, Sound, & New Camera Controls
// -------------------------------------------------------------------------
// This script implements:
// • Mouse-controlled camera with pointer lock.
// • Ship controls remapped as follows:
//     Space: Thrust forward (only positive)
//     W: Pitch Up
//     S: Pitch Down
//     A: Yaw Left
//     D: Yaw Right
//     Q: Roll Left
//     E: Roll Right
//     K: Auto‑Align ship’s forward with velocity (auto-align forward)
//     L: Auto‑Align ship’s forward opposite to velocity (auto-align back)
//     Shift + Left Click: Continuous auto‑align forward while held
//     Shift + Right Click: Continuous auto‑align back while held
//     R: Reset the game
//     P: Toggle Pause
//     H: Toggle Help overlay
//
// Additional features:
// • A 30‑sec ballistic trajectory with dynamic dash spacing and a blue-to-red gradient.
// • Collision prediction with a pink indicator.
// • A realistic star field.
// • Sound effects for music, thrust, and collision with volume sliders in the top right.
// • On‑screen crosshair and help overlay for controls.

//
// === Global Scene & DOM Elements ===
let scene, camera, renderer;
let statusElement;

//
// === Audio Elements ===
let bgMusic, collisionSound, thrustSound;

//
// === Celestial Bodies ===
let sunMesh, planetMesh;
const sunMass = 100000;
const sunRadius = 50;
const planetMass = 8000;
const planetRadius = 12;
const planetOrbitRadius = 100;
const planetOrbitSpeed = 0.2; // radians per second
let planetAngle = 0;

//
// === Spaceship & Motion ===
let shipPivot;    // Container for the ship mesh, flame, and axis helper.
let shipMesh;     // The ship (a cone).
let flameMesh;    // Orange cylinder representing thrust.
let axisHelper;   // Visualizes ship's local axes.
const shipMass = 10;
const shipRadius = 2;
let shipVelocity = new THREE.Vector3(0, 0, 0);

//
// === Control Variables ===
// Smoothed control inputs.
let desiredThrust = 0;  // Thrust (only positive).
let desiredPitchRate = 0;  // For pitching (rotation about X).
let desiredYawRate = 0;  // For yawing (rotation about Y).
let desiredRollRate = 0;  // For rolling (rotation about Z).
let currentThrust = 0;
let currentPitchRate = 0;
let currentYawRate = 0;
let currentRollRate = 0;
const maxThrust = 0.2;
const maxPitchRate = 1.0; // radians per second.
const maxYawRate = 1.0;
const maxRollRate = 1.0;
const controlLerp = 0.1;

//
// === Camera Variables ===
let cameraAzimuth = Math.PI; // Default view.
let cameraElevation = 0;
const cameraDistance = 20;
const mouseSensitivity = 0.002;

//
// === Simulation Constants ===
const G = 0.2;
const dt = 0.016; // ~60 FPS.

//
// === Trajectory Projection & Collision Prediction ===
let trajectoryLine = null;  // Dashed line for 30-sec projection.
let collisionIndicator = null; // Pink sphere for predicted collision.
let collisionWarning = false;
const maxSimSpeed = 15;  // For trajectory gradient normalization.

//
// === State & Key Tracking ===
let paused = false;
let animationId;
const keys = {}; // Tracks pressed keys.

//
// === Mouse Button Tracking for Continuous Auto‑Alignment ===
let shiftLeftMouseDown = false;
let shiftRightMouseDown = false;

//
// === Initialization ===
function init() {
    // Set up scene, camera, renderer.
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");

    camera = new THREE.PerspectiveCamera(75,
        window.innerWidth / window.innerHeight,
        0.1, 3000);
    camera.position.set(0, 5, 15);

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Request pointer lock on canvas click.
    renderer.domElement.addEventListener("click", function () {
        this.requestPointerLock();
    });

    // Load audio.
    bgMusic = new Audio("bgMusic.mp3");
    bgMusic.loop = true;
    bgMusic.volume = 0.5;
    collisionSound = new Audio("collision.mp3");
    thrustSound = new Audio("thrust.mp3");
    thrustSound.loop = true;
    thrustSound.volume = 0.5;

    // Start bgMusic on first user interaction.
    document.addEventListener("keydown", () => {
        if (bgMusic.paused) bgMusic.play().catch(() => {
        });
    }, {once: true});

    // Create volume sliders for music and sound effects in the top right.
    const volumeContainer = document.createElement("div");
    volumeContainer.style.position = "absolute";
    volumeContainer.style.top = "10px";
    volumeContainer.style.right = "10px";
    volumeContainer.style.backgroundColor = "rgba(0,0,0,0.5)";
    volumeContainer.style.padding = "10px";
    volumeContainer.style.color = "#fff";
    volumeContainer.style.fontFamily = "sans-serif";
    volumeContainer.innerHTML = `
        <label>Music Volume: <input id="musicSlider" type="range" min="0" max="1" step="0.01" value="0.5"></label><br>
        <label>SFX Volume: <input id="sfxSlider" type="range" min="0" max="1" step="0.01" value="0.5"></label>
    `;
    document.body.appendChild(volumeContainer);
    document.getElementById("musicSlider").addEventListener("input", function (e) {
        bgMusic.volume = parseFloat(e.target.value);
    });
    document.getElementById("sfxSlider").addEventListener("input", function (e) {
        thrustSound.volume = parseFloat(e.target.value);
        collisionSound.volume = parseFloat(e.target.value);
    });

    // Add on-screen crosshair.
    const crosshair = document.createElement("div");
    crosshair.style.position = "absolute";
    crosshair.style.top = "50%";
    crosshair.style.left = "50%";
    crosshair.style.transform = "translate(-50%, -50%)";
    crosshair.style.fontSize = "24px";
    crosshair.style.color = "#fff";
    crosshair.style.pointerEvents = "none";
    crosshair.innerHTML = "+";
    document.body.appendChild(crosshair);

    // Create a toggleable help overlay.
    const helpOverlay = document.createElement("div");
    helpOverlay.id = "helpOverlay";
    helpOverlay.style.position = "absolute";
    helpOverlay.style.bottom = "10px";
    helpOverlay.style.right = "10px";
    helpOverlay.style.backgroundColor = "rgba(0,0,0,0.5)";
    helpOverlay.style.padding = "10px";
    helpOverlay.style.color = "#fff";
    helpOverlay.style.fontSize = "14px";
    helpOverlay.style.fontFamily = "sans-serif";
    helpOverlay.style.display = "none";
    helpOverlay.innerHTML = `
<strong>Controls:</strong><br>
W: Pitch Up<br>
S: Pitch Down<br>
A: Yaw Left<br>
D: Yaw Right<br>
Q: Roll Left<br>
E: Roll Right<br>
Space: Thrust<br>
K: Auto‑Align Forward<br>
L: Auto‑Align Back<br>
Shift+Left Click: Continuous Auto‑Align Forward<br>
Shift+Right Click: Continuous Auto‑Align Back<br>
R: Reset<br>
P: Pause/Resume<br>
H: Toggle Help
    `;
    document.body.appendChild(helpOverlay);

    // Lights.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(300, 200, 100);
    scene.add(directionalLight);

    // Sun at origin.
    {
        const sunGeo = new THREE.SphereGeometry(sunRadius, 32, 32);
        const sunMat = new THREE.MeshPhongMaterial({color: 0xffbb00, emissive: 0xaa6600});
        sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.set(0, 0, 0);
        scene.add(sunMesh);
    }

    // Orbiting planet.
    {
        const planetGeo = new THREE.SphereGeometry(planetRadius, 32, 32);
        const planetMat = new THREE.MeshPhongMaterial({color: 0x6688ff});
        planetMesh = new THREE.Mesh(planetGeo, planetMat);
        planetMesh.position.set(planetOrbitRadius, 0, 0);
        scene.add(planetMesh);
    }

    // Create ship pivot.
    shipPivot = new THREE.Object3D();
    scene.add(shipPivot);

    // Create ship mesh (a cone) – rotated so its tip is forward (+Z).
    {
        const coneGeo = new THREE.ConeGeometry(1, 3, 16);
        const coneMat = new THREE.MeshPhongMaterial({color: 0xffffff});
        shipMesh = new THREE.Mesh(coneGeo, coneMat);
        shipMesh.rotation.x = Math.PI / 2;
        shipPivot.add(shipMesh);
    }

    // Create flame: an orange cylinder.
    {
        // Create a cylinder with radius 0.4 and height 1.
        // By default, the cylinder extends from y=-0.5 to y=0.5.
        const cylGeo = new THREE.CylinderGeometry(0.4, 0.9, 1, 16);
        // Translate so that the top face (originally at y = 0.5) becomes the attachment point (y = 0).
        cylGeo.translate(-1.5, -1, 0);

        const cylMat = new THREE.MeshBasicMaterial({color: 0xff6600});
        flameMesh = new THREE.Mesh(cylGeo, cylMat);
        // Rotate so the cylinder, originally along Y, now extends along -Z.
        flameMesh.rotation.y = Math.PI / 2;
        // Position it so that its flat face is flush with the base of the cone.
        // With the cone centered and rotated, its base is at z = -1.5.
        flameMesh.position.set(0, 0, -1.5);
        shipMesh.add(flameMesh);
    }

    // Add axis helper.
    axisHelper = new THREE.AxesHelper(3);
    shipPivot.add(axisHelper);

    // Create a realistic star field attached to the camera.
    createStarField();

    // Set starting position 500 units from origin.
    shipPivot.position.set(500, 0, 0);

    // Event listeners.
    window.addEventListener("resize", onWindowResize);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    // Add mouse down/up for camera alignment and continuous auto‑alignment.
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mouseup", onMouseUp);

    statusElement = document.getElementById("status");
    document.getElementById("resetBtn")?.addEventListener("click", resetSimulation);
    document.getElementById("pauseBtn")?.addEventListener("click", togglePause);

    resetSimulation();
    animate();
}

//
// === Create Star Field ===
// The stars are placed on a sky sphere attached to the camera so that they always appear distant.
function createStarField() {
    const starCount = 1000;
    const radius = 1000;
    const positions = [];
    for (let i = 0; i < starCount; i++) {
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = 2 * Math.PI * Math.random();
        const x = radius * Math.sin(theta) * Math.cos(phi);
        const y = radius * Math.sin(theta) * Math.sin(phi);
        const z = radius * Math.cos(theta);
        positions.push(x, y, z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({color: 0xffffff, size: 2, depthWrite: false});
    const stars = new THREE.Points(starGeo, starMat);
    camera.add(stars);
    scene.add(camera);
}

//
// === Event Handlers ===
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(e) {
    const key = e.key.toLowerCase();
    keys[key] = true;
    if (key === "r") {  // Reset game.
        resetSimulation();
    }
    if (key === "p") {  // Toggle pause.
        togglePause();
    }
    if (key === "h") {  // Toggle help overlay.
        const help = document.getElementById("helpOverlay");
        help.style.display = help.style.display === "none" ? "block" : "none";
    }
}

function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
}

function onMouseMove(e) {
    if (document.pointerLockElement === renderer.domElement) {
        cameraAzimuth += e.movementX * mouseSensitivity;
        // Flip vertical movement.
        cameraElevation -= e.movementY * mouseSensitivity;
        cameraElevation = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraElevation));
    }
}

// Mouse down: left/right click for camera alignment and setting continuous auto‑alignment.
function onMouseDown(e) {
    if (shipVelocity.length() < 0.1) return; // Do nothing if almost stationary.

    // If Shift is held, set continuous auto‑alignment flags.
    if (e.shiftKey) {
        if (e.button === 0) {
            shiftLeftMouseDown = true;
        } else if (e.button === 2) {
            shiftRightMouseDown = true;
        }
    }

    // Camera alignment code.
    const normVel = shipVelocity.clone().normalize();
    let desiredOffset;
    if (e.button === 0) {
        // Left click: camera aligns behind the ship.
        desiredOffset = normVel.clone().multiplyScalar(-cameraDistance);
    } else if (e.button === 2) {
        // Right click: camera aligns in front of the ship.
        desiredOffset = normVel.clone().multiplyScalar(cameraDistance);
    }
    const r = desiredOffset.length();
    const elev = Math.asin(desiredOffset.y / r);
    const azim = Math.atan2(desiredOffset.x, desiredOffset.z);
    cameraElevation = elev;
    cameraAzimuth = azim;
}

// Mouse up: clear continuous auto‑alignment flags.
function onMouseUp(e) {
    if (e.button === 0) {
        shiftLeftMouseDown = false;
    } else if (e.button === 2) {
        shiftRightMouseDown = false;
    }
}

//
// === Ship Control Update ===
// Space: thrust forward.
// W: Pitch Up, S: Pitch Down.
// A: Yaw Left, D: Yaw Right.
// Q: Roll Left, E: Roll Right.
function updateShipControls() {
    desiredThrust = keys[" "] ? maxThrust : 0;
    desiredPitchRate = (keys["w"] ? -maxPitchRate : 0) + (keys["s"] ? maxPitchRate : 0);
    desiredYawRate = (keys["a"] ? maxYawRate : 0) + (keys["d"] ? -maxYawRate : 0);
    desiredRollRate = (keys["q"] ? maxRollRate : 0) + (keys["e"] ? -maxRollRate : 0);

    currentThrust = THREE.MathUtils.lerp(currentThrust, desiredThrust, controlLerp);
    currentPitchRate = THREE.MathUtils.lerp(currentPitchRate, desiredPitchRate, controlLerp);
    currentYawRate = THREE.MathUtils.lerp(currentYawRate, desiredYawRate, controlLerp);
    currentRollRate = THREE.MathUtils.lerp(currentRollRate, desiredRollRate, controlLerp);

    shipPivot.rotateX(currentPitchRate * dt);
    shipPivot.rotateY(currentYawRate * dt);
    shipPivot.rotateZ(currentRollRate * dt);
}

//
// === Auto-Alignment Functions ===
// K: Align ship’s forward with velocity.
// L: Align ship’s forward opposite to its velocity.
function autoAlignShipNormal() {
    if (shipVelocity.length() > 0.1) {
        const desiredDir = shipVelocity.clone().normalize();
        const tempObj = new THREE.Object3D();
        tempObj.position.copy(shipPivot.position);
        tempObj.lookAt(shipPivot.position.clone().add(desiredDir));
        shipPivot.quaternion.slerp(tempObj.quaternion, 0.02);
    }
}

function autoAlignShipOpposite() {
    if (shipVelocity.length() > 0.1) {
        const desiredDir = shipVelocity.clone().normalize();
        const tempObj = new THREE.Object3D();
        tempObj.position.copy(shipPivot.position);
        tempObj.lookAt(shipPivot.position.clone().sub(desiredDir));
        shipPivot.quaternion.slerp(tempObj.quaternion, 0.02);
    }
}

//
// === Camera Update ===
// The camera offset is computed using fixed spherical coordinates (controlled by mouse)
// and is independent of the ship's rotation.
function updateCamera() {
    const offset = new THREE.Vector3(
        cameraDistance * Math.cos(cameraElevation) * Math.sin(cameraAzimuth),
        cameraDistance * Math.sin(cameraElevation),
        cameraDistance * Math.cos(cameraElevation) * Math.cos(cameraAzimuth)
    );
    camera.position.copy(shipPivot.position).add(offset);
    camera.lookAt(shipPivot.position);
}

//
// === Trajectory Projection & Collision Prediction ===
function updateTrajectoryLine() {
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }

    const steps = 600;  // 60 sec / 0.1 s
    const dtSim = 0.1;
    let simPos = shipPivot.position.clone();
    let simVel = shipVelocity.clone();
    let predictedPlanetAngle = planetAngle; // start from current angle
    const points = [];
    const speeds = [];
    let predictedCollisionPoint = null;

    points.push(simPos.clone());
    speeds.push(simVel.length());

    for (let i = 0; i < steps; i++) {
        predictedPlanetAngle += planetOrbitSpeed * dtSim;

        // Gravity from sun.
        {
            const rSun = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), simPos);
            let distSq = rSun.lengthSq();
            if (distSq < 1e-6) distSq = 1e-6;
            const forceMag = (G * sunMass * shipMass) / distSq;
            rSun.normalize().multiplyScalar(forceMag / shipMass);
            simVel.add(rSun.multiplyScalar(dtSim));
        }
        // Gravity from planet.
        {
            const pX = Math.cos(predictedPlanetAngle) * planetOrbitRadius;
            const pZ = Math.sin(predictedPlanetAngle) * planetOrbitRadius;
            const predictedPlanetPos = new THREE.Vector3(pX, 0, pZ);
            const rPlanet = new THREE.Vector3().subVectors(predictedPlanetPos, simPos);
            let distSq = rPlanet.lengthSq();
            if (distSq < 1e-6) distSq = 1e-6;
            const forceMag = (G * planetMass * shipMass) / distSq;
            rPlanet.normalize().multiplyScalar(forceMag / shipMass);
            simVel.add(rPlanet.multiplyScalar(dtSim));
        }
        // No thrust applied.
        simPos.add(simVel.clone().multiplyScalar(dtSim));
        points.push(simPos.clone());
        speeds.push(simVel.length());

        // Check collision with sun.
        if (simPos.length() < sunRadius + shipRadius) {
            predictedCollisionPoint = simPos.clone();
            break;
        }
        // Check collision with planet.
        const pX = Math.cos(predictedPlanetAngle) * planetOrbitRadius;
        const pZ = Math.sin(predictedPlanetAngle) * planetOrbitRadius;
        const predictedPlanetPos = new THREE.Vector3(pX, 0, pZ);
        if (simPos.distanceTo(predictedPlanetPos) < planetRadius + shipRadius) {
            predictedCollisionPoint = simPos.clone();
            break;
        }
    }

    // Adjust dash spacing based on average simulated speed.
    let avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const dashSize = 2 * (1 + avgSpeed / 10);
    const gapSize = dashSize;

    // Create geometry with vertex colors (gradient: blue = at rest, red = fast).
    const trajGeom = new THREE.BufferGeometry().setFromPoints(points);
    const colors = [];
    for (let i = 0; i < speeds.length; i++) {
        let normalized = THREE.MathUtils.clamp(speeds[i] / maxSimSpeed, 0, 1);
        let color = new THREE.Color(normalized, 0, 1 - normalized);
        colors.push(color.r, color.g, color.b);
    }
    trajGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const trajMat = new THREE.LineDashedMaterial({
        vertexColors: true,
        dashSize: dashSize,
        gapSize: gapSize,
        linewidth: 1
    });

    trajectoryLine = new THREE.Line(trajGeom, trajMat);
    trajectoryLine.computeLineDistances();
    scene.add(trajectoryLine);

    // Manage collision indicator.
    if (predictedCollisionPoint) {
        collisionWarning = true;
        if (!collisionIndicator) {
            const colGeo = new THREE.SphereGeometry(3, 16, 16);
            const colMat = new THREE.MeshBasicMaterial({color: 0xff00ff});
            collisionIndicator = new THREE.Mesh(colGeo, colMat);
            scene.add(collisionIndicator);
        }
        collisionIndicator.position.copy(predictedCollisionPoint);
    } else {
        collisionWarning = false;
        if (collisionIndicator) {
            scene.remove(collisionIndicator);
            collisionIndicator.geometry.dispose();
            collisionIndicator.material.dispose();
            collisionIndicator = null;
        }
    }
}

//
// === Flame Update ===
// The flame's length (scale along Z) is proportional to current thrust.
function updateFlame() {
    const t = Math.abs(currentThrust);
    if (t > 0.001) {
        // Base length is 1; scale factor increases linearly with thrust.
        const lengthScale = 1 + (t / maxThrust) * 2;
        // Scale only along Z; the flame extends along its negative Z axis.
        flameMesh.scale.set(1, lengthScale, 1);
        flameMesh.visible = true;
    } else {
        flameMesh.visible = false;
    }
}

//
// === Audio Update ===
// Play thrust sound while thrust is applied.
function updateAudio() {
    if (currentThrust > 0.001) {
        if (thrustSound.paused) {
            thrustSound.play().catch(() => {
            });
        }
    } else {
        if (!thrustSound.paused) {
            thrustSound.pause();
            thrustSound.currentTime = 0;
        }
    }
}

//
// === HUD Update ===
function updateStatus() {
    const pos = shipPivot.position;
    const vel = shipVelocity;
    const rx = THREE.MathUtils.radToDeg(shipPivot.rotation.x).toFixed(1);
    const ry = THREE.MathUtils.radToDeg(shipPivot.rotation.y).toFixed(1);
    const rz = THREE.MathUtils.radToDeg(shipPivot.rotation.z).toFixed(1);
    const speed = vel.length().toFixed(2);
    const collisionMsg = collisionWarning ? "<span style='color:#ff00ff'>Warning: Predicted collision!</span><br>" : "";

    statusElement.innerHTML = `
    <strong>Ship Info</strong><br>
    Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})<br>
    Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})<br>
    Speed: ${speed}<br>
    Rotation (deg): x=${rx}, y=${ry}, z=${rz}<br>
    Thrust: ${currentThrust.toFixed(3)}<br>
    ${collisionMsg}
  `;
}

//
// === Main Animation Loop ===
function animate() {
    animationId = requestAnimationFrame(animate);
    if (!paused) {
        update(dt);
    }
    renderer.render(scene, camera);
}

//
// === Update Function ===
function update(dt) {
    // Update ship controls.
    updateShipControls();

    // Auto-align if K or L keys are pressed, or if continuous auto‑alignment flags are set.
    if (keys["k"] || shiftLeftMouseDown) {
        autoAlignShipNormal();
    } else if (keys["l"] || shiftRightMouseDown) {
        autoAlignShipOpposite();
    }

    // Update audio (thrust sound).
    updateAudio();

    // Compute gravitational acceleration.
    const accel = new THREE.Vector3(0, 0, 0);
    const shipPos = shipPivot.position.clone();

    // Gravity from sun.
    {
        const rSun = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), shipPos);
        let distSq = rSun.lengthSq();
        if (distSq < 1e-6) distSq = 1e-6;
        const forceMag = (G * sunMass * shipMass) / distSq;
        rSun.normalize().multiplyScalar(forceMag / shipMass);
        accel.add(rSun);
    }
    // Gravity from planet.
    {
        const pX = Math.cos(planetAngle) * planetOrbitRadius;
        const pZ = Math.sin(planetAngle) * planetOrbitRadius;
        const planetPos = new THREE.Vector3(pX, 0, pZ);
        const rPlanet = new THREE.Vector3().subVectors(planetPos, shipPos);
        let distSq = rPlanet.lengthSq();
        if (distSq < 1e-6) distSq = 1e-6;
        const forceMag = (G * planetMass * shipMass) / distSq;
        rPlanet.normalize().multiplyScalar(forceMag / shipMass);
        accel.add(rPlanet);
    }

    // Thrust along ship's local forward (+Z).
    if (Math.abs(currentThrust) > 1e-6) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(shipPivot.quaternion);
        forward.multiplyScalar(currentThrust);
        accel.add(forward);
    }

    // Update velocity and position.
    shipVelocity.add(accel.multiplyScalar(dt));
    shipPivot.position.add(shipVelocity.clone().multiplyScalar(dt));

    // Update orbiting planet position.
    planetAngle += planetOrbitSpeed * dt;
    planetMesh.position.set(
        Math.cos(planetAngle) * planetOrbitRadius,
        0,
        Math.sin(planetAngle) * planetOrbitRadius
    );

    // Collision detection.
    if (shipPivot.position.length() < sunRadius + shipRadius) {
        endGame("Collision with Sun!");
        return;
    }
    const distToPlanet = shipPivot.position.distanceTo(planetMesh.position);
    if (distToPlanet < planetRadius + shipRadius) {
        endGame("Collision with Planet!");
        return;
    }

    // Update camera.
    updateCamera();

    // Update flame visuals.
    updateFlame();

    // Update trajectory projection & collision prediction.
    updateTrajectoryLine();

    // Update HUD.
    updateStatus();
}

//
// === End-of-Game & Reset Functions ===
function endGame(msg) {
    paused = true;
    if (animationId) cancelAnimationFrame(animationId);
    if (!collisionSound.paused) collisionSound.pause();
    statusElement.innerHTML = `<strong>${msg}</strong><br>Simulation stopped.`;
    collisionSound.play().catch(() => {
    });
}

function resetSimulation() {
    shipVelocity.set(0, 0, 0);
    shipPivot.position.set(500, 0, 0);
    shipPivot.rotation.set(0, -Math.PI / 2, 0);
    planetAngle = 0;
    currentThrust = currentPitchRate = currentYawRate = currentRollRate = 0;
    desiredThrust = desiredPitchRate = desiredYawRate = desiredRollRate = 0;
    cameraAzimuth = Math.PI / 2;
    cameraElevation = Math.PI / 24;
    paused = false;
    animate();
}

function togglePause() {
    paused = !paused;
    if (!paused) animate();
}

//
// === Start the Simulation ===
init();
