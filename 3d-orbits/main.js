// 3D Orbits – Advanced Collision Prediction & Controls
// ------------------------------------------------------
// This script implements:
// • Non‑inverted, mouse‐controlled camera (with pointer lock)
// • F/B keys for default back/front views
// • Ship controls remapped as follows:
//     Space: Thrust forward (only positive)
//     W: Pitch down  S: Pitch up
//     A: Yaw right  D: Yaw left
//     L: Auto-align ship’s forward with velocity
//     K: Auto-align ship’s forward opposite to velocity
// • A 30‑sec ballistic trajectory with dash spacing that varies with simulated speed
//   and a gradient from blue (at rest) to red (fast)
// • Collision prediction: a pink sphere appears at the predicted collision point with a warning on the HUD.
// • A realistic star field is created on a sky sphere that’s attached to the camera.

//
// === Global Scene & DOM Elements ===
let scene, camera, renderer;
let statusElement;

//
// === Celestial Bodies ===
let sunMesh, planetMesh;
const sunMass      = 100000;
const sunRadius    = 50;
const planetMass   = 8000;
const planetRadius = 12;
const planetOrbitRadius = 100;
const planetOrbitSpeed  = 0.2; // radians per second
let planetAngle = 0;

//
// === Spaceship & Motion ===
let shipPivot;    // Container for the ship mesh, flame, and axis helper.
let shipMesh;     // The ship (a cone).
let flameMesh;    // Custom triangular flame.
let axisHelper;   // Visualizes ship's local axes.
const shipMass   = 10;
const shipRadius = 2;
let shipVelocity = new THREE.Vector3(0, 0, 0);

//
// === Control Variables ===
// Smoothed control inputs.
let desiredThrust    = 0;  // Thrust (only positive).
let desiredPitchRate = 0;  // Controlled by W/S (W pitches down, S pitches up).
let desiredYawRate   = 0;  // Controlled by A/D (A yaws right, D yaws left).
let currentThrust    = 0;
let currentPitchRate = 0;
let currentYawRate   = 0;
const maxThrust      = 0.2;
const maxPitchRate   = 1.0; // radians per second.
const maxYawRate     = 1.0;
const controlLerp    = 0.1;

//
// === Camera Variables ===
let cameraAzimuth   = Math.PI; // Default back view (ship faces +Z, so camera behind at azimuth = π).
let cameraElevation = 0;
const cameraDistance = 20;
const mouseSensitivity = 0.002;

//
// === Simulation Constants ===
const G  = 0.2;
const dt = 0.016; // ~60 FPS.

//
// === Trajectory Projection & Collision Prediction ===
let trajectoryLine = null;  // Dashed line for 30-sec projection.
let collisionIndicator = null; // Pink sphere for predicted collision.
let collisionWarning = false;
const maxSimSpeed = 10;  // Maximum simulated speed for trajectory gradient normalization.

//
// === State & Key Tracking ===
let paused = false;
let animationId;
const keys = {}; // Tracks pressed keys.

//
// === Initialization ===
function init() {
    // Scene, camera, renderer.
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");

    camera = new THREE.PerspectiveCamera(75,
        window.innerWidth / window.innerHeight,
        0.1, 3000);
    camera.position.set(0, 5, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Request pointer lock on canvas click.
    renderer.domElement.addEventListener("click", function() {
        this.requestPointerLock();
    });

    // Lights.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(300, 200, 100);
    scene.add(directionalLight);

    // Sun at origin.
    {
        const sunGeo = new THREE.SphereGeometry(sunRadius, 32, 32);
        const sunMat = new THREE.MeshPhongMaterial({ color: 0xffbb00, emissive: 0xaa6600 });
        sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.set(0, 0, 0);
        scene.add(sunMesh);
    }

    // Orbiting planet.
    {
        const planetGeo = new THREE.SphereGeometry(planetRadius, 32, 32);
        const planetMat = new THREE.MeshPhongMaterial({ color: 0x6688ff });
        planetMesh = new THREE.Mesh(planetGeo, planetMat);
        planetMesh.position.set(planetOrbitRadius, 0, 0);
        scene.add(planetMesh);
    }

    // Create ship pivot.
    shipPivot = new THREE.Object3D();
    scene.add(shipPivot);

    // Create ship mesh (a cone) – rotate so its tip is forward (+Z).
    {
        const coneGeo = new THREE.ConeGeometry(1, 3, 16);
        const coneMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
        shipMesh = new THREE.Mesh(coneGeo, coneMat);
        shipMesh.rotation.x = Math.PI / 2;
        shipPivot.add(shipMesh);
    }

    // Create custom flame (triangular shape).
    {
        const flameShape = new THREE.Shape();
        flameShape.moveTo(-0.5, 0);
        flameShape.lineTo(0.5, 0);
        flameShape.lineTo(0, -2);
        flameShape.lineTo(-0.5, 0);
        const flameGeo = new THREE.ShapeGeometry(flameShape);
        const flameMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.0
        });
        flameMesh = new THREE.Mesh(flameGeo, flameMat);
        flameMesh.position.set(0, 0, -1.8);
        shipMesh.add(flameMesh);
    }

    // Add axis helper.
    axisHelper = new THREE.AxesHelper(3);
    shipPivot.add(axisHelper);

    // Start ship 500 units from origin.
    shipPivot.position.set(500, 0, 0);

    // Create a realistic star field and attach it to the camera.
    createStarField();

    // Event listeners.
    window.addEventListener("resize", onWindowResize);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);

    statusElement = document.getElementById("status");
    document.getElementById("resetBtn").addEventListener("click", resetSimulation);
    document.getElementById("pauseBtn").addEventListener("click", togglePause);

    animate();
}

//
// === Star Field ===
// Instead of being part of the world, the stars are created on a fixed sky sphere
// that is attached to the camera so they remain always in the distance.
function createStarField() {
    const starCount = 1000;
    const radius = 1000;
    const positions = [];
    for (let i = 0; i < starCount; i++) {
        // Random point on sphere surface.
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = 2 * Math.PI * Math.random();
        const x = radius * Math.sin(theta) * Math.cos(phi);
        const y = radius * Math.sin(theta) * Math.sin(phi);
        const z = radius * Math.cos(theta);
        positions.push(x, y, z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    // Attach stars to the camera so they always remain fixed in the background.
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
    // Camera defaults:
    if (key === "f") {
        cameraAzimuth = Math.PI;
        cameraElevation = 0;
    }
    if (key === "b") {
        cameraAzimuth = 0;
        cameraElevation = 0;
    }
}
function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
}
function onMouseMove(e) {
    if (document.pointerLockElement === renderer.domElement) {
        cameraAzimuth += e.movementX * mouseSensitivity;
        // Removed the inversion: add rather than subtract.
        cameraElevation += e.movementY * mouseSensitivity;
        cameraElevation = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, cameraElevation));
    }
}

//
// === Ship Control Update ===
// Space bar: thrust forward (only positive)
// W: Pitch down, S: Pitch up
// A: Yaw right, D: Yaw left
function updateShipControls() {
    desiredThrust    = keys[" "] ? maxThrust : 0;
    desiredPitchRate = (keys["w"] ? -maxPitchRate : 0) + (keys["s"] ? maxPitchRate : 0);
    desiredYawRate   = (keys["a"] ? maxYawRate : 0) + (keys["d"] ? -maxYawRate : 0);

    currentThrust    = THREE.MathUtils.lerp(currentThrust, desiredThrust, controlLerp);
    currentPitchRate = THREE.MathUtils.lerp(currentPitchRate, desiredPitchRate, controlLerp);
    currentYawRate   = THREE.MathUtils.lerp(currentYawRate, desiredYawRate, controlLerp);

    shipPivot.rotateX(currentPitchRate * dt);
    shipPivot.rotateY(currentYawRate * dt);
}

//
// === Auto-Alignment Functions ===
// L: Align ship’s forward (+Z) with its velocity (pointing where you’re going).
// K: Align ship’s forward with the opposite of its velocity.
function autoAlignShipNormal() {
    if (shipVelocity.length() > 0.1) {
        const desiredDir = shipVelocity.clone().normalize();
        const tempObj = new THREE.Object3D();
        tempObj.position.copy(shipPivot.position);
        tempObj.lookAt(shipPivot.position.clone().add(desiredDir));
        const adjustQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
        const desiredQuat = tempObj.quaternion.clone().multiply(adjustQuat);
        shipPivot.quaternion.slerp(desiredQuat, 0.02);
    }
}
function autoAlignShipOpposite() {
    if (shipVelocity.length() > 0.1) {
        const desiredDir = shipVelocity.clone().normalize();
        const tempObj = new THREE.Object3D();
        tempObj.position.copy(shipPivot.position);
        tempObj.lookAt(shipPivot.position.clone().sub(desiredDir));
        const adjustQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
        const desiredQuat = tempObj.quaternion.clone().multiply(adjustQuat);
        shipPivot.quaternion.slerp(desiredQuat, 0.02);
    }
}

//
// === Camera Update ===
// The camera offset is computed using fixed spherical coordinates (controlled by mouse and F/B keys)
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
// Simulate 30 seconds ahead using Euler integration (with dtSim steps) to compute a ballistic trajectory.
// The dash spacing is adjusted based on average simulated speed.
// Vertex colors form a gradient from blue (at rest) to red (fast).
// If a collision is predicted (with the sun or planet), a pink sphere is placed at the estimated collision point.
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
            const rSun = new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0), simPos);
            let distSq = rSun.lengthSq();
            if (distSq < 1e-6) distSq = 1e-6;
            const forceMag = (G * sunMass * shipMass) / distSq;
            rSun.normalize().multiplyScalar(forceMag / shipMass);
            simVel.add(rSun.multiplyScalar(dtSim));
        }
        // Gravity from planet (using predicted planet position).
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

    // Average simulated speed to adjust dash spacing.
    let avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const dashSize = 2 * (1 + avgSpeed / 10);
    const gapSize  = dashSize;

    // Create geometry with vertex colors (gradient from blue to red).
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
            const colMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
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
// The flame scales and its opacity increases with thrust.
function updateFlame() {
    const t = Math.abs(currentThrust);
    if (t > 0.001) {
        const scaleFactor = 1 + (t / maxThrust) * 4;
        flameMesh.scale.set(scaleFactor, scaleFactor, 1);
        flameMesh.material.opacity = Math.min(0.2 + 2 * t, 1.0);
        flameMesh.visible = true;
    } else {
        flameMesh.visible = false;
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

    // Auto-align if L or K are pressed.
    if (keys["l"]) {
        autoAlignShipNormal();
    } else if (keys["k"]) {
        autoAlignShipOpposite();
    }

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

    // Update trajectory projection and collision prediction.
    updateTrajectoryLine();

    // Update HUD.
    updateStatus();
}

//
// === End-of-Game & Reset Functions ===
function endGame(msg) {
    paused = true;
    if (animationId) cancelAnimationFrame(animationId);
    statusElement.innerHTML = `<strong>${msg}</strong><br>Simulation stopped.`;
}
function resetSimulation() {
    shipVelocity.set(0, 0, 0);
    shipPivot.position.set(500, 0, 0);
    shipPivot.rotation.set(0, 0, 0);
    planetAngle = 0;
    currentThrust = currentPitchRate = currentYawRate = 0;
    desiredThrust = desiredPitchRate = desiredYawRate = 0;
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
