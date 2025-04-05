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
//     Shift+Left Click: Continuous Auto‑Align Forward
//     Shift+Right Click: Continuous Auto‑Align Back
//     R: Reset the game
//     P: Toggle Pause
//     H: Toggle Help overlay
//
// Additional features:
// • A 30‑sec ballistic trajectory with dynamic dash spacing and a blue-to-red gradient.
// • Collision prediction with a pink indicator.
// • A realistic star field.
// • Sound effects for music, thrust, and collision with volume sliders.
// • On‑screen crosshair and help overlay for controls.

//
// === Global Scene & DOM Elements ===
let scene, camera, renderer;
let statusElement;

//
// === Audio Elements ===
let bgMusic, collisionSound, thrustSound;

//
// === Spaceship & Motion ===
let shipPivot;    // Container for the ship mesh, flame, and axis helper.
let shipMesh;     // The ship (a cone).
let flameMesh;    // Orange cylinder representing thrust.
let flameLight;   // A point light for the engine flame.
let axisHelper;   // Visualizes ship's local axes.
const shipMass = 10;
const shipRadius = 2;
let shipVelocity = new THREE.Vector3(0, 0, 0);

//
// === Game & HUD Variables ===
let score = 0;
let highScore = 0;
let collectible;  // The current collectible (a green sphere)
let fuel = 750;
const maxFuel = 1000;
const fuelConsumptionRate = 10; // fuel consumption rate per thrust unit

//
// === Control Variables ===
let desiredThrust = 0;
let desiredPitchRate = 0;
let desiredYawRate = 0;
let desiredRollRate = 0;
let currentThrust = 0;
let currentPitchRate = 0;
let currentYawRate = 0;
let currentRollRate = 0;
const maxThrust = 0.2;
const maxPitchRate = 1.0;
const maxYawRate = 1.0;
const maxRollRate = 1.0;
const controlLerp = 0.1;

//
// === Camera Variables ===
let cameraAzimuth = Math.PI;
let cameraElevation = 0;
const cameraDistance = 20;
const mouseSensitivity = 0.002;

//
// === Simulation Constants ===
const G = 0.2;
const dt = 0.016; // ~60 FPS

//
// === Trajectory Projection & Collision Prediction ===
let trajectoryLine = null;
let collisionIndicator = null;
let collisionWarning = false;
const maxSimSpeed = 20;

//
// === State & Key Tracking ===
let paused = false;
let animationId;
const keys = {};

//
// === Mouse Button Tracking for Continuous Auto‑Alignment ===
let shiftLeftMouseDown = false;
let shiftRightMouseDown = false;

//
// === Helper Function: Calculate Orbit Speed ===
function calculateOrbitSpeed(centralMass, orbitRadius) {
    return 0.005 * Math.sqrt(G * centralMass / orbitRadius);
}

//
// === Solar System Configuration & Massive Bodies Array ===
const solarSystem = {
    sun: {
        name: "Sun",
        mass: 100000,
        radius: 50,
        color: 0xffbb00,
        emissive: 0xaa6600,
        glowSize: 60,
        position: new THREE.Vector3(0, 0, 0)
    },
    planets: [
        {
            name: "Planet1",
            mass: 8000,
            radius: 12,
            orbitRadius: 200,
            color: 0x6688ff,
            initialAngle: Math.PI / 4,
            texture: "",
            moons: [
                {
                    name: "Moon1",
                    mass: 100,
                    radius: 3,
                    orbitRadius: 40,
                    color: 0x888888,
                    texture: ""
                }
            ]
        },
        {
            name: "Planet2",
            mass: 9000,
            radius: 14,
            orbitRadius: 300,
            initialAngle: 3 * Math.PI / 2,
            color: 0xff8855,
            texture: "",
            moons: []
        },
        {
            name: "Planet3",
            mass: 10000,
            radius: 16,
            orbitRadius: 400,
            color: 0x55ff55,
            initialAngle: 3 * Math.PI / 4,
            texture: "",
            moons: [
                {
                    name: "Moon2",
                    mass: 200,
                    radius: 4,
                    orbitRadius: 50,
                    color: 0xaaaaaa,
                    texture: ""
                }
            ]
        },
        {
            name: "Planet4",
            mass: 50000,
            radius: 32,
            orbitRadius: 1000,
            color: 0xdd320f,
            initialAngle: 7 * Math.PI / 4,
            texture: "",
            moons: [
                {
                    name: "Moon3",
                    mass: 1200,
                    radius: 4,
                    orbitRadius: 75,
                    color: 0xaaaaaa,
                    texture: ""
                }
            ]
        },
        {
            name: "Planet5",
            mass: 11000,
            radius: 14,
            orbitRadius: 1400,
            color: 0x7733ff,
            initialAngle: 5 * Math.PI / 4,
            texture: "",
            moons: []
        }
    ],
    asteroidBelt: {
        count: 500,
        innerRadius: 600,
        outerRadius: 800,
        beltHeight: 20,
        asteroidSize: { min: 0.5, max: 2 }
    }
};

let massiveBodies = [];
let planetGroups = [];
let asteroidBeltGroup;

//
// === Initialization ===
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");

    camera = new THREE.PerspectiveCamera(75,
        window.innerWidth / window.innerHeight,
        0.1, 3000);
    camera.position.set(0, 5, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    renderer.domElement.addEventListener("click", function () {
        this.requestPointerLock();
    });

    bgMusic = new Audio("bgMusic.mp3");
    bgMusic.loop = true;
    bgMusic.volume = 0.5;
    collisionSound = new Audio("collision.mp3");
    thrustSound = new Audio("thrust.mp3");
    thrustSound.loop = true;
    thrustSound.volume = 0.5;

    document.addEventListener("keydown", () => {
        if (bgMusic.paused) bgMusic.play().catch(() => {});
    }, { once: true });

    // Volume controls
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

    // Fuel bar HUD with a low fuel warning animation (CSS class added dynamically)
    const fuelBarContainer = document.createElement("div");
    fuelBarContainer.id = "fuelBarContainer";
    fuelBarContainer.style.position = "absolute";
    fuelBarContainer.style.bottom = "10px";
    fuelBarContainer.style.left = "10px";
    fuelBarContainer.style.width = "200px";
    fuelBarContainer.style.height = "20px";
    fuelBarContainer.style.backgroundColor = "rgba(255,255,255,0.2)";
    fuelBarContainer.style.border = "1px solid #fff";
    document.body.appendChild(fuelBarContainer);

    const fuelBar = document.createElement("div");
    fuelBar.id = "fuelBar";
    fuelBar.style.height = "100%";
    fuelBar.style.width = "100%";
    fuelBar.style.backgroundColor = "#00ff00";
    fuelBar.style.transition = "width 0.2s";
    fuelBarContainer.appendChild(fuelBar);

    // Collectible indicator: a ring and a separate distance label (number above the ring)
    const indicatorRing = document.createElement("div");
    indicatorRing.id = "collectibleIndicator";
    indicatorRing.style.position = "absolute";
    indicatorRing.style.width = "40px";
    indicatorRing.style.height = "40px";
    indicatorRing.style.border = "2px solid #00ff00";
    indicatorRing.style.borderRadius = "50%";
    indicatorRing.style.pointerEvents = "none";
    document.body.appendChild(indicatorRing);

    const indicatorLabel = document.createElement("div");
    indicatorLabel.id = "collectibleDistance";
    indicatorLabel.style.position = "absolute";
    indicatorLabel.style.width = "40px";
    indicatorLabel.style.textAlign = "center";
    indicatorLabel.style.fontFamily = "sans-serif";
    indicatorLabel.style.color = "#00ff00";
    indicatorLabel.style.pointerEvents = "none";
    document.body.appendChild(indicatorLabel);

    // (Reset High Score button removed as requested)

    createStarField();
    createSolarSystem(solarSystem);

    shipPivot = new THREE.Object3D();
    scene.add(shipPivot);

    {
        const coneGeo = new THREE.ConeGeometry(1, 3, 16);
        const coneMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
        shipMesh = new THREE.Mesh(coneGeo, coneMat);
        shipMesh.rotation.x = Math.PI / 2;
        shipPivot.add(shipMesh);
    }

    {
        const cylGeo = new THREE.CylinderGeometry(0.4, 0.9, 1, 16);
        cylGeo.translate(-1.5, -1, 0);
        const cylMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
        flameMesh = new THREE.Mesh(cylGeo, cylMat);
        flameMesh.rotation.y = Math.PI / 2;
        flameMesh.position.set(0, 0, -1.5);
        shipMesh.add(flameMesh);
    }

    // Use a point light for a more uniform flame illumination.
    flameLight = new THREE.PointLight(0xffaa33, 0, 25, 2);
    flameLight.position.set(0, 0, -1.5);
    shipMesh.add(flameLight);
    flameLight.visible = false;

    axisHelper = new THREE.AxesHelper(3);
    shipPivot.add(axisHelper);

    shipPivot.position.set(500, 0, 0);

    window.addEventListener("resize", onWindowResize);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mouseup", onMouseUp);

    statusElement = document.getElementById("status");
    document.getElementById("resetBtn")?.addEventListener("click", resetSimulation);
    document.getElementById("pauseBtn")?.addEventListener("click", togglePause);

    spawnCollectible();
    resetSimulation();
    animate();
}

//
// === Solar System Building Functions ===
function createSolarSystem(config) {
    massiveBodies = [];
    createSun(config.sun);
    createPlanets(config.planets);
    createAsteroidBelt(config.asteroidBelt);
}

function createSun(sunConfig) {
    const sunGeo = new THREE.SphereGeometry(sunConfig.radius, 32, 32);
    const sunMat = new THREE.MeshPhongMaterial({ color: sunConfig.color, emissive: sunConfig.emissive });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.copy(sunConfig.position);
    scene.add(sunMesh);

    const glowGeo = new THREE.SphereGeometry(sunConfig.glowSize, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: sunConfig.color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });
    const sunGlow = new THREE.Mesh(glowGeo, glowMat);
    sunGlow.position.copy(sunConfig.position);
    scene.add(sunGlow);

    const sunLight = new THREE.PointLight(0xffffff, 1.5, 2000);
    sunLight.position.copy(sunConfig.position);
    scene.add(sunLight);

    massiveBodies.push({
        name: sunConfig.name,
        mass: sunConfig.mass,
        radius: sunConfig.radius,
        mesh: sunMesh
    });
}

function createPlanets(planetsArray) {
    planetGroups = [];
    planetsArray.forEach(planetConfig => {
        const planetGroup = new THREE.Group();
        planetGroup.userData.orbitRadius = planetConfig.orbitRadius;
        const angle = (planetConfig.initialAngle !== undefined ? planetConfig.initialAngle : Math.random() * Math.PI * 2);
        planetGroup.userData.angle = angle;
        planetGroup.userData.initialAngle = angle;
        planetGroup.userData.name = planetConfig.name;
        planetGroup.userData.orbitSpeed = calculateOrbitSpeed(solarSystem.sun.mass, planetConfig.orbitRadius);
        const planetGeo = new THREE.SphereGeometry(planetConfig.radius, 32, 32);
        const planetMatOptions = { color: planetConfig.color };
        if (planetConfig.texture) {
            planetMatOptions.map = new THREE.TextureLoader().load(planetConfig.texture);
        }
        const planetMat = new THREE.MeshPhongMaterial(planetMatOptions);
        const planetMesh = new THREE.Mesh(planetGeo, planetMat);
        planetMesh.position.set(planetConfig.orbitRadius * Math.cos(angle), 0, planetConfig.orbitRadius * Math.sin(angle));
        planetGroup.add(planetMesh);
        planetGroup.userData.planetMesh = planetMesh;
        scene.add(planetGroup);
        planetGroups.push(planetGroup);

        massiveBodies.push({
            name: planetConfig.name,
            mass: planetConfig.mass,
            radius: planetConfig.radius,
            mesh: planetMesh
        });

        if (planetConfig.moons && planetConfig.moons.length > 0) {
            planetGroup.userData.moons = [];
            planetConfig.moons.forEach(moonConfig => {
                const moonGroup = new THREE.Group();
                moonGroup.userData.orbitRadius = moonConfig.orbitRadius;
                const moonAngle = (moonConfig.initialAngle !== undefined ? moonConfig.initialAngle : Math.random() * Math.PI * 2);
                moonGroup.userData.angle = moonAngle;
                moonGroup.userData.initialAngle = moonAngle;
                moonGroup.userData.name = moonConfig.name;
                moonGroup.userData.orbitSpeed = calculateOrbitSpeed(planetConfig.mass, moonConfig.orbitRadius);
                const moonGeo = new THREE.SphereGeometry(moonConfig.radius, 32, 32);
                const moonMatOptions = { color: moonConfig.color };
                if (moonConfig.texture) {
                    moonMatOptions.map = new THREE.TextureLoader().load(moonConfig.texture);
                }
                const moonMat = new THREE.MeshPhongMaterial(moonMatOptions);
                const moonMesh = new THREE.Mesh(moonGeo, moonMat);
                moonMesh.position.set(moonConfig.orbitRadius * Math.cos(moonAngle), 0, moonConfig.orbitRadius * Math.sin(moonAngle));
                moonGroup.add(moonMesh);
                planetMesh.add(moonGroup);
                planetGroup.userData.moons.push(moonGroup);

                massiveBodies.push({
                    name: moonConfig.name,
                    mass: moonConfig.mass,
                    radius: moonConfig.radius,
                    mesh: moonMesh
                });
            });
        }
    });
}

function createAsteroidBelt(beltConfig) {
    asteroidBeltGroup = new THREE.Group();
    for (let i = 0; i < beltConfig.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = beltConfig.innerRadius + Math.random() * (beltConfig.outerRadius - beltConfig.innerRadius);
        const y = (Math.random() - 0.5) * beltConfig.beltHeight;
        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);
        const size = beltConfig.asteroidSize.min + Math.random() * (beltConfig.asteroidSize.max - beltConfig.asteroidSize.min);
        const asteroidGeo = new THREE.DodecahedronGeometry(size, 0);
        const asteroidMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
        const asteroid = new THREE.Mesh(asteroidGeo, asteroidMat);
        asteroid.position.set(x, y, z);
        asteroid.userData.radius = size;
        asteroidBeltGroup.add(asteroid);
    }
    scene.add(asteroidBeltGroup);
}

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
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, depthWrite: false });
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
    if (key === "r") resetSimulation();
    if (key === "p") togglePause();
    if (key === "h") {
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
        cameraElevation -= e.movementY * mouseSensitivity;
        cameraElevation = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraElevation));
    }
}

function onMouseDown(e) {
    if (shipVelocity.length() < 0.1) return;
    if (e.shiftKey) {
        if (e.button === 0) shiftLeftMouseDown = true;
        else if (e.button === 2) shiftRightMouseDown = true;
    }
    const normVel = shipVelocity.clone().normalize();
    let desiredOffset;
    if (e.button === 0) desiredOffset = normVel.clone().multiplyScalar(-cameraDistance);
    else if (e.button === 2) desiredOffset = normVel.clone().multiplyScalar(cameraDistance);
    const r = desiredOffset.length();
    const elev = Math.asin(desiredOffset.y / r);
    const azim = Math.atan2(desiredOffset.x, desiredOffset.z);
    cameraElevation = elev;
    cameraAzimuth = azim;
}

function onMouseUp(e) {
    if (e.button === 0) shiftLeftMouseDown = false;
    else if (e.button === 2) shiftRightMouseDown = false;
}

//
// === Ship Control Update ===
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

    const steps = 600;
    const dtSim = 0.1;
    let simPos = shipPivot.position.clone();
    let simVel = shipVelocity.clone();
    const points = [simPos.clone()];
    const speeds = [simVel.length()];
    let predictedCollisionPoint = null;

    for (let i = 0; i < steps; i++) {
        let accelSim = new THREE.Vector3(0, 0, 0);
        massiveBodies.forEach(body => {
            const bodyPos = body.mesh.getWorldPosition(new THREE.Vector3());
            let rVec = new THREE.Vector3().subVectors(bodyPos, simPos);
            let distSq = rVec.lengthSq();
            if (distSq < 1e-6) distSq = 1e-6;
            const forceMag = (G * body.mass * shipMass) / distSq;
            rVec.normalize().multiplyScalar(forceMag / shipMass);
            accelSim.add(rVec);
        });
        simVel.add(accelSim.multiplyScalar(dtSim));
        simPos.add(simVel.clone().multiplyScalar(dtSim));
        points.push(simPos.clone());
        speeds.push(simVel.length());

        for (let body of massiveBodies) {
            const bodyPos = body.mesh.getWorldPosition(new THREE.Vector3());
            if (simPos.distanceTo(bodyPos) < body.radius + shipRadius) {
                predictedCollisionPoint = simPos.clone();
                break;
            }
        }
        if (predictedCollisionPoint) break;
    }

    let avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const dashSize = 2 * (1 + avgSpeed / 10);
    const gapSize = dashSize;

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
function updateFlame() {
    const t = Math.abs(currentThrust);
    if (t > 0.001) {
        const lengthScale = 1 + (t / maxThrust) * 2;
        flameMesh.scale.set(1, lengthScale, 1);
        flameMesh.visible = true;
        flameLight.visible = true;
        flameLight.intensity = 2 + (t / maxThrust) * 2;
    } else {
        flameMesh.visible = false;
        flameLight.visible = false;
    }
}

//
// === Audio Update ===
function updateAudio() {
    if (currentThrust > 0.001) {
        if (thrustSound.paused) {
            thrustSound.play().catch(() => {});
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
    const lowFuelWarning = (fuel / maxFuel < 0.2) ? "<span style='color:#ff0000; font-weight:bold;'>Low Fuel!</span><br>" : "";

    const hudInfo = `
    <strong>Ship Info</strong><br>
    Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})<br>
    Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})<br>
    Speed: ${speed}<br>
    Rotation (deg): x=${rx}, y=${ry}, z=${rz}<br>
    Thrust: ${currentThrust.toFixed(3)}<br>
    Score: ${score} | High Score: ${highScore}<br>
    Fuel: ${fuel.toFixed(0)} / ${maxFuel}<br>
    ${lowFuelWarning}
    ${collisionMsg}
  `;
    if (statusElement) statusElement.innerHTML = hudInfo;
    updateFuelBar();
}

function updateFuelBar() {
    const fuelBar = document.getElementById("fuelBar");
    if (fuelBar) {
        fuelBar.style.width = (fuel / maxFuel * 100) + "%";
        fuelBar.style.backgroundColor = (fuel / maxFuel < 0.2) ? "#ff0000" : "#00ff00";
        fuelBar.style.animation = (fuel / maxFuel < 0.2) ? "shake 0.5s infinite" : "none";
    }
}

//
// === Collectible Functions ===
function spawnCollectible() {
    const minDistance = solarSystem.sun.radius + 50;
    const maxOrbit = Math.max(...solarSystem.planets.map(p => p.orbitRadius));
    const maxDistance = maxOrbit + 50;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = 2 * Math.PI * Math.random();
    const x = distance * Math.sin(theta) * Math.cos(phi);
    const y = distance * Math.sin(theta) * Math.sin(phi);
    const z = distance * Math.cos(theta);

    // If a collectible exists, remove it immediately.
    if (collectible) {
        scene.remove(collectible);
        collectible.geometry.dispose();
        collectible.material.dispose();
        collectible = null;
    }
    const geo = new THREE.SphereGeometry(3, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    collectible = new THREE.Mesh(geo, mat);
    collectible.position.set(x, y, z);
    scene.add(collectible);
}

function updateCollectibleIndicator() {
    if (!collectible) return;
    // Project collectible position to screen space
    const vector = collectible.position.clone().project(camera);
    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;
    let x = vector.x * widthHalf + widthHalf;
    let y = -vector.y * heightHalf + heightHalf;

    // Determine if collectible is behind the camera
    if (vector.z < 0) {
        const angle = Math.atan2(y - heightHalf, x - widthHalf);
        const margin = 30;
        const radius = Math.min(widthHalf, heightHalf) - margin;
        x = widthHalf + radius * Math.cos(angle);
        y = heightHalf + radius * Math.sin(angle);
    } else {
        const margin = 20;
        x = Math.min(window.innerWidth - margin, Math.max(margin, x));
        y = Math.min(window.innerHeight - margin, Math.max(margin, y));
    }

    // Position the ring indicator (centered)
    const indicatorRing = document.getElementById("collectibleIndicator");
    if (indicatorRing) {
        indicatorRing.style.left = (x - 20) + "px";
        indicatorRing.style.top = (y - 20) + "px";
        indicatorRing.style.display = "block";
    }
    // Position the distance label above the ring
    const distance = shipPivot.position.distanceTo(collectible.position).toFixed(0);
    const indicatorLabel = document.getElementById("collectibleDistance");
    if (indicatorLabel) {
        indicatorLabel.style.left = (x - 20) + "px";
        indicatorLabel.style.top = (y - 45) + "px";
        indicatorLabel.innerHTML = distance;
        indicatorLabel.style.display = "block";
    }
}

//
// === Main Animation Loop ===
function animate() {
    animationId = requestAnimationFrame(animate);
    if (!paused) update(dt);
    renderer.render(scene, camera);
}

//
// === Update Function ===
function update(dt) {
    updateShipControls();
    if (keys["k"] || shiftLeftMouseDown) {
        autoAlignShipNormal();
    } else if (keys["l"] || shiftRightMouseDown) {
        autoAlignShipOpposite();
    }
    updateAudio();

    const accel = new THREE.Vector3(0, 0, 0);
    const shipPos = shipPivot.position.clone();
    massiveBodies.forEach(body => {
        const bodyPos = body.mesh.getWorldPosition(new THREE.Vector3());
        let rVec = new THREE.Vector3().subVectors(bodyPos, shipPos);
        let distSq = rVec.lengthSq();
        if (distSq < 1e-6) distSq = 1e-6;
        const forceMag = (G * body.mass * shipMass) / distSq;
        rVec.normalize().multiplyScalar(forceMag / shipMass);
        accel.add(rVec);
    });

    if (Math.abs(currentThrust) > 1e-6 && fuel > 0) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(shipPivot.quaternion);
        forward.multiplyScalar(currentThrust);
        accel.add(forward);
        fuel -= currentThrust * fuelConsumptionRate * dt;
        fuel = Math.max(0, fuel);
    }

    shipVelocity.add(accel.multiplyScalar(dt));
    shipPivot.position.add(shipVelocity.clone().multiplyScalar(dt));

    planetGroups.forEach(planetGroup => {
        planetGroup.userData.angle += planetGroup.userData.orbitSpeed * dt;
        const angle = planetGroup.userData.angle;
        const radius = planetGroup.userData.orbitRadius;
        planetGroup.userData.planetMesh.position.set(radius * Math.cos(angle), 0, radius * Math.sin(angle));

        if (planetGroup.userData.moons) {
            planetGroup.userData.moons.forEach(moonGroup => {
                moonGroup.userData.angle += moonGroup.userData.orbitSpeed * dt;
                const mAngle = moonGroup.userData.angle;
                const mRadius = moonGroup.userData.orbitRadius;
                moonGroup.children[0].position.set(mRadius * Math.cos(mAngle), 0, mRadius * Math.sin(mAngle));
            });
        }
    });

    for (let body of massiveBodies) {
        const bodyPos = body.mesh.getWorldPosition(new THREE.Vector3());
        if (shipPivot.position.distanceTo(bodyPos) < body.radius + shipRadius) {
            endGame("Collision with " + body.name + "!");
            return;
        }
    }

    if (asteroidBeltGroup) {
        for (let asteroid of asteroidBeltGroup.children) {
            const astPos = asteroid.getWorldPosition(new THREE.Vector3());
            const astRadius = asteroid.userData.radius;
            if (shipPivot.position.distanceTo(astPos) < astRadius + shipRadius) {
                endGame("Collision with an asteroid!");
                return;
            }
        }
    }

    if (collectible && shipPivot.position.distanceTo(collectible.position) < (3 + shipRadius)) {
        score++;
        if (score > highScore) highScore = score;
        fuel = Math.min(maxFuel, fuel + 200);
        // Remove collected collectible and spawn a new one.
        scene.remove(collectible);
        collectible.geometry.dispose();
        collectible.material.dispose();
        collectible = null;
        spawnCollectible();
    }

    updateCamera();
    updateFlame();
    updateTrajectoryLine();
    updateStatus();
    updateCollectibleIndicator();
}

//
// === End-of-Game & Reset Functions ===
function endGame(msg) {
    paused = true;
    if (animationId) cancelAnimationFrame(animationId);
    if (!collisionSound.paused) collisionSound.pause();
    statusElement.innerHTML = `<strong>${msg}</strong><br>Simulation stopped.`;
    collisionSound.play().catch(() => {});
}

function resetSimulation() {
    score = 0;
    shipVelocity.set(0, 0, 0);
    shipPivot.position.set(500, 0, 0);
    shipPivot.rotation.set(0, -Math.PI / 2, 0);
    planetGroups.forEach(pg => {
        pg.userData.angle = pg.userData.initialAngle;
        if (pg.userData.moons) {
            pg.userData.moons.forEach(moonGroup => {
                moonGroup.userData.angle = moonGroup.userData.initialAngle;
            });
        }
    });
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

/* Add CSS for low fuel shake effect */
const style = document.createElement('style');
style.innerHTML = `
@keyframes shake {
  0% { transform: translate(0px, 0px); }
  25% { transform: translate(2px, -2px); }
  50% { transform: translate(-2px, 2px); }
  75% { transform: translate(2px, 2px); }
  100% { transform: translate(0px, 0px); }
}
`;
document.head.appendChild(style);
