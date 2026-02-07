// ---------- Helper: Check if two circles overlap ----------
function circlesOverlap(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy) < (r1 + r2);
}

// ---------- Canvas & Full Screen Setup ----------
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Zoom via mouse wheel
canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
        zoom *= ZOOM_STEP;
    } else {
        zoom /= ZOOM_STEP;
    }
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    updateCamera();
});

const resetBtn = document.getElementById("resetBtn");
const pauseBtn = document.getElementById("pauseBtn");
const fsBtn = document.getElementById("fsBtn");
const statusDiv = document.getElementById("status");

// Removed spawnEnemy button logic

fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
        canvas.requestFullscreen().catch(err => console.error(err));
    } else {
        document.exitFullscreen();
    }
});

const guideBtn = document.getElementById("guideBtn");
guideBtn.addEventListener("click", () => {
    guideMode = !guideMode;
    if (!guideMode) localStorage.setItem("hasPlayedOrbits", "1");
});

// ---------- Volume Controls ----------
const musicVolumeSlider = document.getElementById("musicVolume");
const sfxVolumeSlider = document.getElementById("sfxVolume");
let sfxVolume = parseFloat(sfxVolumeSlider.value);

musicVolumeSlider.addEventListener("input", (e) => {
    bgMusic.volume = e.target.value;
});
sfxVolumeSlider.addEventListener("input", (e) => {
    sfxVolume = parseFloat(e.target.value);
    thrustSound.volume = sfxVolume;
    collisionSound.volume = sfxVolume;
    wormholeSound.volume = sfxVolume;
});

// ---------- Prediction Range Control ----------
const predictionSlider = document.getElementById("predictionRange");
const predictionValueSpan = document.getElementById("predictionValue");
predictionSlider.addEventListener("input", (e) => {
    predictionDuration = parseInt(e.target.value);
    predictionValueSpan.textContent = predictionDuration + "s";
});

// ---------- Audio Elements ----------
const bgMusic = document.getElementById("bgMusic");
const thrustSound = document.getElementById("thrustSound");
const collisionSound = document.getElementById("collisionSound");
const wormholeSound = document.getElementById("wormholeSound");
document.body.addEventListener("keydown", () => {
    if (bgMusic.paused) bgMusic.play();
}, {once: true});

// ---------- Global Settings ----------
let animationId;
let simulationRunning = false;
let simulationPaused = false;
const dt = 0.1;
// ADD: Seeded RNG setup
const RNG_INITIAL_SEED = Date.now() & 0xffffffff;
let rngState = RNG_INITIAL_SEED;
function setRandomSeed(s) { rngState = s >>> 0; }
function random() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967295;
}
// Override Math.random with seeded version for determinism
Math.random = random;
const G = 0.4;
let gameTime = 0;  // Global game time
const TRAIL_DURATION = 10;  // How many ticks of trail to show
let showTrajectory = true; // Toggle for drawing projected trajectory
let predictionDuration = 45; // How far ahead to project trajectory (0–120 game-time units)
let trajectoryCollisionWarning = false; // Active collision warning flag
let guideMode = !localStorage.getItem("hasPlayedOrbits"); // auto-enable on first play
// ADD: fast-forward and enemy globals
const FAST_FORWARD_FACTOR = 4; // Simulation speed multiplier when fast-forward is active
// REMOVE fastForward toggle State (superseded by hold multipliers)

// Enemy system removed.

// ---------- Camera ----------
const camera = {x: 0, y: 0};
let zoom = 1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.1;

// ---------- Procedurally Generated Stars ----------
const stars = [];
const numStars = 800;
for (let i = 0; i < numStars; i++) {
    const colorRoll = Math.random();
    let starColor;
    if (colorRoll < 0.05) starColor = "#aaccff";       // blue-white
    else if (colorRoll < 0.10) starColor = "#ffddaa";   // warm yellow
    else if (colorRoll < 0.13) starColor = "#ffbbbb";   // red-tinted
    else starColor = "#ffffff";                          // white
    stars.push({
        x: Math.random() * 8000 - 4000,
        y: Math.random() * 8000 - 4000,
        radius: Math.random() * 1.5 + 0.5,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.2 + Math.random() * 0.4,
        color: starColor
    });
}

// ---------- Solar System Objects ----------
const sun = {x: 0, y: 0, mass: 280000, radius: 110};
const planetA = {
    orbitRadius: 500,
    angle: 0,
    angularSpeed: 0.003,
    mass: 10000,
    radius: 30
};
const planetB = {
    orbitRadius: 650,
    angle: 4 * Math.PI / 3,
    angularSpeed: 0.002,
    mass: 25000,
    radius: 40,
};
// New planets
const planetC = {
    orbitRadius: 1050,
    angle: -5 * Math.PI / 3,
    angularSpeed: 0.001,
    mass: 35000,
    radius: 30,
};
const planetD = {
    orbitRadius: 1650,
    angle: Math.PI / 2,
    angularSpeed: 0.0005,
    mass: 135000,
    radius: 80,
};

// SHIELD DURATION
const SHIELD_DURATION = 200;  // ticks (extended duration)

// ---------- Black Hole (with limited influence) ----------
// Repositioned far away as an easter-egg object
const blackHole = {x: 5000, y: 5000, mass: 3000000, radius: 140};
// No strict boundary: gravity is 1/r² everywhere; at spawn (~7000 units away) BH pull is negligible
const BH_TIME_DILATION_THRESHOLD = 200;
const bhOrbiter1 = {orbitRadius: 100, angle: 0, angularSpeed: 0.008, mass: 1000, radius: 8, x: 0, y: 0};
const bhOrbiter2 = {orbitRadius: 140, angle: Math.PI / 3, angularSpeed: 0.005, mass: 1200, radius: 10, x: 0, y: 0};

// ---------- Wormhole (Two-Way) ----------
const wormhole = {
    entry: {x: 600, y: -600, radius: 20},
    exit: {x: -600, y: 600, radius: 20},
    pulse: 0
};

// ---------- Orbiters for Planets ----------
const moon = {
    orbitRadius: 80,
    angle: 0,
    angularSpeed: 0.01,
    mass: 3000,
    radius: 15,
    x: 0,
    y: 0
};
const satelliteA = {
    orbitRadius: 50,
    angle: 0,
    angularSpeed: 0.015,
    mass: 2000,
    radius: 10,
    x: 0,
    y: 0
};

// ---------- Asteroids (Additional Hazards) ----------
const asteroids = [];

// ---------- Constants for Asteroid Belt ----------
const BELT_INNER = 1300; // farther out belt
const BELT_OUTER = 1800;

function spawnAsteroids() {
    asteroids.length = 0;
    const beltInner = BELT_INNER;
    const beltOuter = BELT_OUTER;
    const beltCount = 80; // balanced asteroid belt
    const cometCount = 10; // moderate comets

    // Circular-belt asteroids
    for (let i = 0; i < beltCount; i++) {
        let r = beltInner + random() * (beltOuter - beltInner);
        let angle = random() * Math.PI * 2;
        let x = sun.x + r * Math.cos(angle);
        let y = sun.y + r * Math.sin(angle);

        // Circular orbital speed
        let speed = Math.sqrt(G * sun.mass / r);
        // Tangential direction: force clockwise (same as planets)
        const cw = 1;
        let vx = cw * (-Math.sin(angle)) * speed;
        let vy = cw * ( Math.cos(angle)) * speed;

        asteroids.push({x, y, vx, vy, radius: 5 + random() * 3, isComet: false});
    }

    // Comets on highly-elliptical orbits
    for (let i = 0; i < cometCount; i++) {
        let r = beltOuter + 300 + random() * 1000; // spawn farther out
        let angle = random() * Math.PI * 2;
        let x = sun.x + r * Math.cos(angle);
        let y = sun.y + r * Math.sin(angle);

        // Slower than circular to create elliptical orbit
        let speed = Math.sqrt(G * sun.mass / r) * 0.6;
        let vx = (-Math.sin(angle)) * speed;
        let vy = ( Math.cos(angle)) * speed;

        asteroids.push({x, y, vx, vy, radius: 5 + random() * 3, isComet: true});
    }
}

function updateAsteroids(dtEff) {
    for (let i = asteroids.length - 1; i >= 0; i--) {
        let a = asteroids[i];
        // ADD: gravitational influence on asteroids
        let ax = 0, ay = 0;
        const gravityBodies = [sun, planetA, planetB, planetC, planetD, moon, blackHole];
        for (let b of gravityBodies) {
            const g = computeGravity(b, a.x, a.y);
            ax += g.ax;
            ay += g.ay;
        }
        a.vx += ax * dtEff;
        a.vy += ay * dtEff;

        a.x += a.vx * dtEff;
        a.y += a.vy * dtEff;
        const fixedBodies = [sun, planetA, planetB, planetC, planetD, blackHole];
        for (let b of fixedBodies) {
            if (circlesOverlap(a.x, a.y, a.radius, b.x, b.y, b.radius)) {
                asteroids.splice(i, 1);
                break;
            }
        }
    }
}

function drawAsteroids() {
    for (let a of asteroids) {
        const ax = a.x - camera.x;
        const ay = a.y - camera.y;

        // Comet tail pointing away from the sun
        if (a.isComet) {
            const dxSun = a.x - sun.x;
            const dySun = a.y - sun.y;
            const distSun = Math.hypot(dxSun, dySun);
            if (distSun > 0) {
                const tailAngle = Math.atan2(dySun, dxSun);
                const tailLen = 25 + 15 * Math.sin(gameTime * 0.3);
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(tailAngle);
                const tailGrad = ctx.createLinearGradient(0, 0, tailLen, 0);
                tailGrad.addColorStop(0, "rgba(150,200,255,0.6)");
                tailGrad.addColorStop(0.4, "rgba(100,180,255,0.25)");
                tailGrad.addColorStop(1, "rgba(80,150,255,0)");
                ctx.fillStyle = tailGrad;
                ctx.beginPath();
                ctx.moveTo(0, -a.radius * 0.6);
                ctx.lineTo(tailLen, 0);
                ctx.lineTo(0, a.radius * 0.6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        }

        let grad = ctx.createRadialGradient(ax, ay, a.radius * 0.3, ax, ay, a.radius);
        if (a.isComet) {
            grad.addColorStop(0, "#aaddff");
            grad.addColorStop(1, "#5588aa");
        } else {
            grad.addColorStop(0, "#777777");
            grad.addColorStop(1, "#333333");
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ax, ay, a.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ADD: Enemy logic ----------------------------------------------------
// Enemy logic removed
// --------------------------------------------------------------------

// ---------- The Player's Spaceship ----------
let spaceship;

function initSpaceship() {
    spaceship = {
        x: sun.x + planetA.orbitRadius + 240,
        y: sun.y - 300,
        vx: 0,
        vy: 0,
        angle: 0,
        fuel: 25,
        maxFuel: 30, // fuel capacity
        radius: 8,
        trail: [],
        graceTime: 20,
        disabled: false,
        disableTime: 0,
        upgrades: [],
        thrustMultiplier: 1,
        rotationMultiplier: 1,
        shieldTime: 0
    };
}

// ---------- Drifting Rescue Ship & Space Station ----------
let driftingShip; // The spaceship to rescue
let spaceStation; // The base to deliver the rescue ship

function spawnDriftingShip() {
    let angle = Math.random() * 2 * Math.PI;
    let distance = 800 + Math.random() * 400;
    driftingShip = {
        x: sun.x + distance * Math.cos(angle),
        y: sun.y + distance * Math.sin(angle),
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        radius: 10,
        rescued: false,
        delivered: false
    };
}

function spawnSpaceStation() {
    // Fixed location for the space station.
    spaceStation = {
        x: 600,
        y: 600,
        radius: 40
    };
}

// ---------- Collectibles & Upgrades ----------
let collectible = {x: 0, y: 0, radius: 7, type: "score"};

function spawnCollectible() {
    // Spawn within the orbit of the furthest planet (Planet D)
    const maxDist = planetD.orbitRadius + 200;
    const safeMargin = 10;
    const fixedBodies = [sun, planetA, planetB, planetC, planetD, blackHole, moon, satelliteA, bhOrbiter1, bhOrbiter2];

    let valid = false;
    while (!valid) {
        let angle = Math.random() * 2 * Math.PI;
        let r = Math.random() * maxDist;
        let newX = r * Math.cos(angle);
        let newY = r * Math.sin(angle);
        valid = true;
        for (let body of fixedBodies) {
            if (circlesOverlap(newX, newY, collectible.radius + safeMargin, body.x, body.y, body.radius)) {
                valid = false;
                break;
            }
        }
        if (valid) {
            collectible.x = newX;
            collectible.y = newY;
        }
    }

    let rnd = Math.random();
    const pUpgrade = 0.2;
    const pFuel = 0.3;
    if (rnd < pUpgrade) {
        collectible.type = "upgrade";
        const upgradeOptions = ["thruster", "fuelTank", "maneuver", "shield"];
        collectible.upgrade = upgradeOptions[Math.floor(Math.random() * upgradeOptions.length)];
    } else if (rnd < pUpgrade + pFuel) {
        collectible.type = "fuel";
    } else {
        collectible.type = "score";
    }
}

function drawCollectible() {
    const cx = collectible.x - camera.x;
    const cy = collectible.y - camera.y;
    const bob = Math.sin(gameTime * 0.4) * 2;
    const pulse = 1 + 0.15 * Math.sin(gameTime * 0.6);
    const effectiveRadius = collectible.radius * pulse;
    const bobbedY = cy + bob;

    // Glow halo
    let glowColor;
    if (collectible.type === "fuel") glowColor = "rgba(50,120,255,";
    else if (collectible.type === "upgrade") glowColor = "rgba(170,50,255,";
    else glowColor = "rgba(50,255,50,";

    const glowRadius = effectiveRadius * 3;
    const glowGrad = ctx.createRadialGradient(cx, bobbedY, effectiveRadius * 0.5, cx, bobbedY, glowRadius);
    glowGrad.addColorStop(0, glowColor + "0.3)");
    glowGrad.addColorStop(1, glowColor + "0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, bobbedY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    if (collectible.type === "fuel") {
        const fuelGrad = ctx.createRadialGradient(cx - 2, bobbedY - 2, effectiveRadius * 0.2, cx, bobbedY, effectiveRadius);
        fuelGrad.addColorStop(0, "#8cf");
        fuelGrad.addColorStop(1, "#00f");
        ctx.fillStyle = fuelGrad;
        ctx.beginPath();
        ctx.arc(cx, bobbedY, effectiveRadius, 0, Math.PI * 2);
        ctx.fill();
    } else if (collectible.type === "upgrade") {
        const spinAngle = gameTime * 0.1;
        let size = effectiveRadius;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            let a = Math.PI / 3 * i + spinAngle;
            let x = cx + size * Math.cos(a);
            let y = bobbedY + size * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const upGrad = ctx.createRadialGradient(cx, bobbedY, size * 0.2, cx, bobbedY, size);
        upGrad.addColorStop(0, "#f0f");
        upGrad.addColorStop(1, "#a0f");
        ctx.fillStyle = upGrad;
        ctx.fill();
    } else {
        const scoreGrad = ctx.createRadialGradient(cx - 2, bobbedY - 2, effectiveRadius * 0.2, cx, bobbedY, effectiveRadius);
        scoreGrad.addColorStop(0, "#8f8");
        scoreGrad.addColorStop(1, "#0f0");
        ctx.fillStyle = scoreGrad;
        ctx.beginPath();
        ctx.arc(cx, bobbedY, effectiveRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------- Drawing Functions for New Objects ----------
// Improved drawSpaceStation function with enhanced art
function drawSpaceStation() {
    if (!spaceStation) return;
    ctx.save();
    ctx.translate(spaceStation.x - camera.x, spaceStation.y - camera.y);

    // Draw outer ring for docking
    const outerRingRadius = spaceStation.radius + 10;
    ctx.beginPath();
    ctx.arc(0, 0, outerRingRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw the main hub with a radial gradient
    const hubRadius = spaceStation.radius;
    let grad = ctx.createRadialGradient(0, 0, hubRadius * 0.3, 0, 0, hubRadius);
    grad.addColorStop(0, "#88f");
    grad.addColorStop(1, "#005");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, hubRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw solar panels as docking modules
    ctx.fillStyle = "#444";
    ctx.fillRect(-hubRadius - 20, -5, 20, 10); // left panel
    ctx.fillRect(hubRadius, -5, 20, 10);         // right panel

    // Draw "windows" on the hub for added detail
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-hubRadius / 2, -hubRadius / 2, 3, 0, Math.PI * 2);
    ctx.arc(hubRadius / 2, -hubRadius / 2, 3, 0, Math.PI * 2);
    ctx.arc(-hubRadius / 2, hubRadius / 2, 3, 0, Math.PI * 2);
    ctx.arc(hubRadius / 2, hubRadius / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // // Label the station
    // ctx.font = "16px Arial";
    // ctx.fillStyle = "#fff";
    // ctx.textAlign = "center";
    // ctx.fillText("Space Station", 0, hubRadius + 30);

    ctx.restore();
}

function drawDriftingShip() {
    if (!driftingShip || driftingShip.delivered) return;
    const sx = driftingShip.x - camera.x;
    const sy = driftingShip.y - camera.y;

    // Distress beacon pulse
    const beaconAlpha = 0.3 + 0.3 * Math.sin(gameTime * 0.6);
    const beaconR = driftingShip.radius * 2.5;
    const beaconGrad = ctx.createRadialGradient(sx, sy, driftingShip.radius * 0.5, sx, sy, beaconR);
    beaconGrad.addColorStop(0, `rgba(255,0,255,${beaconAlpha})`);
    beaconGrad.addColorStop(1, "rgba(255,0,255,0)");
    ctx.fillStyle = beaconGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, beaconR, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(sx, sy);
    // Tumbling rotation for drifting feel
    const tumble = driftingShip.rescued ? 0 : gameTime * 0.05;
    ctx.rotate(tumble);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fillStyle = driftingShip.rescued ? "#ff88ff" : "#cc44cc";
    ctx.fill();
    ctx.strokeStyle = "#f0f";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

// ---------- Upgrade System ----------
function applyUpgrade(type) {
    spaceship.upgrades.push(type);
    if (type === "thruster") {
        spaceship.thrustMultiplier *= 1.4;
    } else if (type === "fuelTank") {
        spaceship.maxFuel += 10;
        spaceship.fuel = Math.min(spaceship.fuel + 10, spaceship.maxFuel);
    } else if (type === "maneuver") {
        spaceship.rotationMultiplier *= 1.2;
    } else if (type === "shield") {
        spaceship.shieldTime = SHIELD_DURATION;
    }
}

// ---------- Solar Flares (continuous pressure + smooth angle) ----------
let solarFlarePressure = 0.35;  // 0..1, flare fires when >= 1 then resets
let nextFlareAngle = Math.random() * 2 * Math.PI; // drifts smoothly, no jump on fire
let solarFlareParticles = [];

function solarFlareSmoothNoise(t, a, b, c) {
    return 0.5 + 0.5 * Math.sin(t * a) * Math.sin(t * b) * Math.sin(t * c);
}

// ---------- Engine Exhaust Particles ----------
let exhaustParticles = [];

function updateExhaustParticles(dtEff) {
    if (keys["ArrowUp"] && spaceship.fuel > 0 && !spaceship.disabled) {
        for (let i = 0; i < 2; i++) {
            const spread = (Math.sin(gameTime * 17 + i) * 0.5) * 0.6;
            const backAngle = spaceship.angle + Math.PI + spread;
            const speed = 3 + Math.abs(Math.sin(gameTime * 11 + i * 3)) * 4;
            exhaustParticles.push({
                x: spaceship.x - 8 * Math.cos(spaceship.angle),
                y: spaceship.y - 8 * Math.sin(spaceship.angle),
                vx: speed * Math.cos(backAngle) + spaceship.vx * 0.2,
                vy: speed * Math.sin(backAngle) + spaceship.vy * 0.2,
                lifetime: 12 + Math.abs(Math.sin(gameTime * 7 + i)) * 10,
                maxLifetime: 22,
                radius: 1.5 + Math.abs(Math.sin(gameTime * 13 + i * 2)) * 2
            });
        }
    }
    for (let i = exhaustParticles.length - 1; i >= 0; i--) {
        let p = exhaustParticles[i];
        p.x += p.vx * dtEff;
        p.y += p.vy * dtEff;
        p.lifetime -= dtEff;
        p.radius *= 0.985;
        if (p.lifetime <= 0 || p.radius < 0.2) {
            exhaustParticles.splice(i, 1);
        }
    }
}

function drawExhaustParticles() {
    for (let p of exhaustParticles) {
        const lifeRatio = Math.max(0, p.lifetime / p.maxLifetime);
        const r = 255;
        const g = Math.floor(100 + 155 * lifeRatio);
        const b = Math.floor(50 * lifeRatio);
        ctx.fillStyle = `rgba(${r},${g},${b},${lifeRatio * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x - camera.x, p.y - camera.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------- Pickup Burst Particles ----------
let pickupParticles = [];

function emitPickupParticles(x, y, color) {
    for (let i = 0; i < 16; i++) {
        const angle = (Math.PI * 2 / 16) * i + Math.sin(gameTime + i) * 0.3;
        const speed = 2 + Math.abs(Math.sin(gameTime * 3 + i * 1.5)) * 5;
        pickupParticles.push({
            x, y,
            vx: speed * Math.cos(angle),
            vy: speed * Math.sin(angle),
            lifetime: 20 + Math.abs(Math.sin(gameTime * 5 + i)) * 15,
            maxLifetime: 35,
            radius: 1.5 + Math.abs(Math.sin(gameTime * 7 + i * 2)) * 2.5,
            color
        });
    }
}

function updatePickupParticles(dtEff) {
    for (let i = pickupParticles.length - 1; i >= 0; i--) {
        let p = pickupParticles[i];
        p.x += p.vx * dtEff;
        p.y += p.vy * dtEff;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.lifetime -= dtEff;
        if (p.lifetime <= 0) {
            pickupParticles.splice(i, 1);
        }
    }
}

function drawPickupParticles() {
    for (let p of pickupParticles) {
        const alpha = Math.max(0, p.lifetime / p.maxLifetime);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x - camera.x, p.y - camera.y, p.radius * alpha, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// ---------- Score Tracking ----------
let score = 0;
let highScore = localStorage.getItem("highScore") || 0;

// ---------- Local Storage Stats ----------
let totalScoreLS = parseInt(localStorage.getItem("totalScore")) || 0;
let totalGamesLS = parseInt(localStorage.getItem("totalGames")) || 0;
// totalEnemies stat removed

// ---------- Keyboard Input ----------
const keys = {};
window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    if (e.key.toLowerCase() === "t") {
        showTrajectory = !showTrajectory;
    }
    if (e.key.toLowerCase() === "g") {
        guideMode = !guideMode;
        if (!guideMode) localStorage.setItem("hasPlayedOrbits", "1");
    }
    if (e.key.toLowerCase() === "w") keys["ArrowUp"] = true;
    if (e.key.toLowerCase() === "a") keys["ArrowLeft"] = true;
    if (e.key.toLowerCase() === "d") keys["ArrowRight"] = true;
    // ADD: reset keybind
    if (e.key.toLowerCase() === "r") {
        resetGame();
    }
});

window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
    if (e.key.toLowerCase() === "w") keys["ArrowUp"] = false;
    if (e.key.toLowerCase() === "a") keys["ArrowLeft"] = false;
    if (e.key.toLowerCase() === "d") keys["ArrowRight"] = false;
});

// ---------- Camera Update ----------
function updateCamera() {
    camera.x = spaceship.x - canvas.width / (2 * zoom);
    camera.y = spaceship.y - canvas.height / (2 * zoom);
}

// ---------- Background and Star Field ----------
function drawBackground() {
    let grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width / 4, canvas.width / 2, canvas.height / 2, canvas.width);
    grad.addColorStop(0, "#001");
    grad.addColorStop(1, "#000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawStars() {
    for (let star of stars) {
        const sx = star.x - camera.x;
        const sy = star.y - camera.y;
        if (sx > -10 && sx < canvas.width + 10 && sy > -10 && sy < canvas.height + 10) {
            const twinkle = 0.5 + 0.5 * Math.sin(gameTime * star.twinkleSpeed + star.phase);
            ctx.globalAlpha = 0.3 + 0.7 * twinkle;
            ctx.fillStyle = star.color;
            ctx.beginPath();
            ctx.arc(sx, sy, star.radius * (0.8 + 0.2 * twinkle), 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

// ---------- Drawing Helper for Celestial Bodies ----------
function drawPlanet(body, baseColor, darkColor) {
    let grad = ctx.createRadialGradient(body.x - camera.x, body.y - camera.y, body.radius * 0.3, body.x - camera.x, body.y - camera.y, body.radius);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, darkColor);
    ctx.beginPath();
    ctx.arc(body.x - camera.x, body.y - camera.y, body.radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawBody(body, color) {
    ctx.beginPath();
    ctx.arc(body.x - camera.x, body.y - camera.y, body.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

// ---------- Enhanced Visual Effects ----------
function drawSunCorona() {
    const x = sun.x - camera.x;
    const y = sun.y - camera.y;
    // Outer glow haze — biased toward next flare direction
    const hazeRadius = sun.radius * 2.2;
    const hazeGrad = ctx.createRadialGradient(x, y, sun.radius * 0.8, x, y, hazeRadius);
    hazeGrad.addColorStop(0, "rgba(255,200,50,0.25)");
    hazeGrad.addColorStop(0.5, "rgba(255,120,0,0.08)");
    hazeGrad.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = hazeGrad;
    ctx.beginPath();
    ctx.arc(x, y, hazeRadius, 0, Math.PI * 2);
    ctx.fill();
    // Animated corona rays with flare-direction bias (smooth buildup via solarFlarePressure)
    ctx.save();
    ctx.translate(x, y);
    const numRays = 18;
    const rotOffset = gameTime * 0.012;
    const pressureBias = 0.3 + 0.7 * solarFlarePressure; // buildup intensifies as pressure rises
    for (let i = 0; i < numRays; i++) {
        const angle = (Math.PI * 2 / numRays) * i + rotOffset;
        // How close is this ray to the upcoming flare direction?
        let angleDiff = angle - nextFlareAngle;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        const nearFlare = Math.max(0, 1 - Math.abs(angleDiff) / (Math.PI * 0.4));
        // Organic variation from multiple sine waves + flare bias (smooth, no jump)
        const baseLen = 1.15 + 0.2 * Math.sin(gameTime * 0.12 + i * 1.7)
                       + 0.15 * Math.sin(gameTime * 0.07 + i * 3.1)
                       + 0.1 * Math.sin(gameTime * 0.19 + i * 0.8);
        const flareBoost = nearFlare * 0.5 * pressureBias * (0.8 + 0.2 * Math.sin(gameTime * 0.25 + i));
        const rayLen = sun.radius * (baseLen + flareBoost);
        const rayWidth = Math.PI / (numRays * 1.3);
        const baseAlpha = 0.06 + 0.04 * Math.sin(gameTime * 0.18 + i);
        const flareAlpha = nearFlare * 0.1 * pressureBias;
        // Shift color toward orange-red near the flare buildup
        const g = Math.floor(200 - nearFlare * 80);
        const b = Math.floor(50 - nearFlare * 40);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, rayLen, angle - rayWidth, angle + rayWidth);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, ${g}, ${b}, ${baseAlpha + flareAlpha})`;
        ctx.fill();
    }
    ctx.restore();
}

function drawPlanetGlow(body, glowColor) {
    const bx = body.x - camera.x;
    const by = body.y - camera.y;
    const glowRadius = body.radius * 1.6;
    const grad = ctx.createRadialGradient(bx, by, body.radius * 0.8, bx, by, glowRadius);
    grad.addColorStop(0, glowColor);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, glowRadius, 0, Math.PI * 2);
    ctx.fill();
}

function drawOrbitPaths() {
    ctx.save();
    ctx.setLineDash([8, 16]);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    const sunX = sun.x - camera.x;
    const sunY = sun.y - camera.y;
    const orbits = [planetA.orbitRadius, planetB.orbitRadius, planetC.orbitRadius, planetD.orbitRadius];
    for (let r of orbits) {
        ctx.beginPath();
        ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

function drawPlanetDRingsHalf(isFront) {
    const bx = planetD.x - camera.x;
    const by = planetD.y - camera.y;
    ctx.save();
    ctx.translate(bx, by);
    const startAngle = isFront ? 0 : Math.PI;
    const endAngle = isFront ? Math.PI : Math.PI * 2;
    // Outer ring band
    ctx.beginPath();
    ctx.ellipse(0, 0, planetD.radius * 1.7, planetD.radius * 0.45, 0.35, startAngle, endAngle);
    ctx.strokeStyle = isFront ? "rgba(180,130,255,0.35)" : "rgba(180,130,255,0.18)";
    ctx.lineWidth = 8;
    ctx.stroke();
    // Inner ring band
    ctx.beginPath();
    ctx.ellipse(0, 0, planetD.radius * 1.35, planetD.radius * 0.35, 0.35, startAngle, endAngle);
    ctx.strokeStyle = isFront ? "rgba(200,160,255,0.25)" : "rgba(200,160,255,0.12)";
    ctx.lineWidth = 5;
    ctx.stroke();
    // Thin bright ring
    ctx.beginPath();
    ctx.ellipse(0, 0, planetD.radius * 1.5, planetD.radius * 0.4, 0.35, startAngle, endAngle);
    ctx.strokeStyle = isFront ? "rgba(220,200,255,0.4)" : "rgba(220,200,255,0.2)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

function drawPlanetTexture(body, type) {
    const bx = body.x - camera.x;
    const by = body.y - camera.y;
    const r = body.radius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.clip();

    if (type === "gas") {
        // Horizontal cloud bands (Jupiter-like)
        const numBands = 7;
        for (let i = 0; i < numBands; i++) {
            const bandY = by - r + (2 * r / numBands) * (i + 0.5);
            const bandH = r / numBands * 0.5;
            const alpha = 0.08 + 0.05 * Math.sin(gameTime * 0.04 + i * 1.3);
            ctx.fillStyle = (i % 2 === 0)
                ? `rgba(255,255,255,${alpha})`
                : `rgba(100,50,150,${alpha})`;
            ctx.fillRect(bx - r, bandY - bandH / 2, r * 2, bandH);
        }
        // Great spot
        const spotX = bx + r * 0.3 * Math.cos(gameTime * 0.02);
        const spotY = by + r * 0.2;
        ctx.beginPath();
        ctx.ellipse(spotX, spotY, r * 0.2, r * 0.12, 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,100,255,0.18)";
        ctx.fill();
    } else if (type === "ice") {
        // Ice caps at poles
        ctx.fillStyle = "rgba(200,230,255,0.22)";
        ctx.beginPath();
        ctx.ellipse(bx, by - r * 0.72, r * 0.65, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(bx, by + r * 0.78, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ocean highlight
        ctx.beginPath();
        ctx.arc(bx + r * 0.15, by - r * 0.1, r * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(130,210,255,0.12)";
        ctx.fill();
        // Continental mass hint
        ctx.beginPath();
        ctx.ellipse(bx - r * 0.2, by + r * 0.15, r * 0.3, r * 0.18, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,80,60,0.12)";
        ctx.fill();
    } else if (type === "volcanic") {
        // Lava flow hotspots
        const flows = [
            {dx: 0.25, dy: -0.2, s: 0.14},
            {dx: -0.3, dy: 0.15, s: 0.1},
            {dx: 0.1, dy: 0.3, s: 0.09},
            {dx: -0.15, dy: -0.35, s: 0.11},
        ];
        for (let f of flows) {
            const lavaAlpha = 0.14 + 0.08 * Math.sin(gameTime * 0.1 + f.dx * 10);
            ctx.beginPath();
            ctx.arc(bx + f.dx * r, by + f.dy * r, f.s * r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,100,0,${lavaAlpha})`;
            ctx.fill();
            // Bright core
            ctx.beginPath();
            ctx.arc(bx + f.dx * r, by + f.dy * r, f.s * r * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,200,50,${lavaAlpha * 0.7})`;
            ctx.fill();
        }
        // Dark terrain patches
        ctx.fillStyle = "rgba(80,20,0,0.12)";
        ctx.beginPath();
        ctx.ellipse(bx + r * 0.1, by - r * 0.1, r * 0.4, r * 0.25, 0.6, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === "desert") {
        // Sandy dune ridges
        for (let i = 0; i < 5; i++) {
            const lineY = by - r * 0.5 + i * r * 0.25;
            const waveAmp = r * (0.06 + 0.03 * Math.sin(i * 2.1));
            ctx.beginPath();
            ctx.moveTo(bx - r, lineY);
            ctx.quadraticCurveTo(bx - r * 0.3, lineY + waveAmp, bx, lineY - waveAmp);
            ctx.quadraticCurveTo(bx + r * 0.3, lineY + waveAmp * 0.5, bx + r, lineY);
            ctx.strokeStyle = "rgba(180,130,40,0.18)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        // Dark crater
        ctx.beginPath();
        ctx.arc(bx - r * 0.2, by + r * 0.15, r * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(120,80,20,0.15)";
        ctx.fill();
        // Highlight ridge
        ctx.beginPath();
        ctx.ellipse(bx + r * 0.25, by - r * 0.25, r * 0.2, r * 0.08, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,220,150,0.1)";
        ctx.fill();
    } else if (type === "moon") {
        // Craters
        const craters = [
            {dx: 0.25, dy: -0.2, s: 0.2},
            {dx: -0.2, dy: 0.25, s: 0.15},
            {dx: 0.05, dy: -0.4, s: 0.12},
            {dx: -0.35, dy: -0.05, s: 0.17},
            {dx: 0.15, dy: 0.3, s: 0.1},
        ];
        for (let c of craters) {
            // Shadow
            ctx.beginPath();
            ctx.arc(bx + c.dx * r, by + c.dy * r, c.s * r, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.12)";
            ctx.fill();
            // Highlight rim
            ctx.beginPath();
            ctx.arc(bx + c.dx * r - c.s * r * 0.15, by + c.dy * r - c.s * r * 0.15, c.s * r * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fill();
        }
    }

    ctx.restore();
}

function drawBlackHole() {
    const x = blackHole.x - camera.x;
    const y = blackHole.y - camera.y;

    // Outer distortion glow (no rings)
    const outerRadius = blackHole.radius * 3;
    const grad = ctx.createRadialGradient(x, y, blackHole.radius * 0.2, x, y, outerRadius);
    grad.addColorStop(0, "#000");
    grad.addColorStop(0.4, "#220011");
    grad.addColorStop(0.7, "#551122");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Event horizon
    ctx.beginPath();
    ctx.arc(x, y, blackHole.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
}

function drawWormholePortal(wx, wy, radius) {
    const x = wx - camera.x;
    const y = wy - camera.y;
    const pulseR = radius + Math.sin(wormhole.pulse) * 3;

    // Outer glow
    const glowGrad = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 3);
    glowGrad.addColorStop(0, "rgba(0,255,255,0.2)");
    glowGrad.addColorStop(1, "rgba(0,100,200,0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fill();

    // Spiral arms
    ctx.save();
    ctx.translate(x, y);
    const spiralT = gameTime * 0.08;
    for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        const baseAngle = (Math.PI * 2 / 3) * arm;
        for (let s = 0; s < 25; s++) {
            const t = s / 25;
            const angle = spiralT + baseAngle + t * Math.PI * 1.5;
            const r = 2 + t * pulseR * 1.2;
            const px = r * Math.cos(angle);
            const py = r * Math.sin(angle);
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(0,220,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    ctx.restore();

    // Core ring
    ctx.save();
    ctx.shadowColor = "#0ff";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(x, y, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = "#0ff";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner bright center
    const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.5);
    coreGrad.addColorStop(0, "rgba(200,255,255,0.5)");
    coreGrad.addColorStop(1, "rgba(0,200,255,0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawWormhole() {
    wormhole.pulse += 0.05;
    drawWormholePortal(wormhole.entry.x, wormhole.entry.y, wormhole.entry.radius);
    drawWormholePortal(wormhole.exit.x, wormhole.exit.y, wormhole.exit.radius);
}

function drawSpaceship() {
    if (spaceship.trail.length > 1) {
        for (let i = 1; i < spaceship.trail.length; i++) {
            let pt1 = spaceship.trail[i - 1];
            let pt2 = spaceship.trail[i];
            let alpha = Math.max(0, 1 - (gameTime - pt1.t) / TRAIL_DURATION);
            ctx.strokeStyle = "rgba(0,255,0," + alpha + ")";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pt1.x - camera.x, pt1.y - camera.y);
            ctx.lineTo(pt2.x - camera.x, pt2.y - camera.y);
            ctx.stroke();
        }
    }
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 10;
    ctx.translate(spaceship.x - camera.x, spaceship.y - camera.y);
    ctx.rotate(spaceship.angle);
    // Pulsing shield
    if (spaceship.shieldTime > 0) {
        const shieldPulse = spaceship.radius + 10 + Math.sin(gameTime * 0.5) * 2;
        ctx.beginPath();
        ctx.arc(0, 0, shieldPulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,150,255,${0.4 + 0.3 * Math.sin(gameTime * 0.8)})`;
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    // Ship hull with notched rear
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, -8);
    ctx.closePath();
    ctx.fillStyle = "#e8e8ff";
    ctx.fill();
    ctx.strokeStyle = "rgba(150,150,200,0.4)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Cockpit window
    ctx.beginPath();
    ctx.arc(5, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4af";
    ctx.fill();
    // Engine flame (layered, flickering)
    if (keys["ArrowUp"] && spaceship.fuel > 0 && !spaceship.disabled) {
        const flicker = Math.abs(Math.sin(gameTime * 7) * 3 + Math.sin(gameTime * 13) * 2);
        ctx.beginPath();
        ctx.moveTo(-6, 3.5);
        ctx.lineTo(-19 - flicker, 0);
        ctx.lineTo(-6, -3.5);
        ctx.fillStyle = "#ff4400";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-6, 2);
        ctx.lineTo(-14 - flicker * 0.6, 0);
        ctx.lineTo(-6, -2);
        ctx.fillStyle = "#ffcc00";
        ctx.fill();
    }
    // Disabled visual indicator
    if (spaceship.disabled) {
        ctx.globalAlpha = 0.3 + 0.4 * Math.sin(gameTime * 2);
        ctx.fillStyle = "rgba(255,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(0, 0, spaceship.radius + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

// // ---------- HUD Drawing Functions ----------
function drawFuelBar() {
    const barWidth = 200;
    const barHeight = 20;
    const x = 20;
    const y = canvas.height - barHeight - 20;
    ctx.fillStyle = "#444";
    ctx.fillRect(x, y, barWidth, barHeight);
    const fuelRatio = spaceship.fuel / spaceship.maxFuel;
    ctx.fillStyle = "#0f0";
    ctx.fillRect(x, y, barWidth * fuelRatio, barHeight);
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText("Fuel", x, y - 5);
}

function drawShieldBar() {
    const barWidth = 200;
    const barHeight = 20;
    const x = canvas.width - barWidth - 20;
    const y = canvas.height - barHeight - 20;
    ctx.fillStyle = "#444";
    ctx.fillRect(x, y, barWidth, barHeight);
    const shieldRatio = spaceship.shieldTime / SHIELD_DURATION;
    ctx.fillStyle = "#0af";
    ctx.fillRect(x, y, barWidth * shieldRatio, barHeight);
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText("Shield", x, y - 5);
}

// ---------- Trajectory Projection ----------
function getTrajectoryWithCollision(state, duration, dtSim) {
    let points = [];
    let collisionIndex = -1;
    let simState = {x: state.x, y: state.y, vx: state.vx, vy: state.vy};
    const steps = Math.floor(duration / dtSim);
    const gravBodies = [sun, planetA, planetB, planetC, planetD, moon, satelliteA, bhOrbiter1, bhOrbiter2, blackHole];
    const collisionBodies = [sun, planetA, planetB, planetC, planetD, blackHole, moon, satelliteA, bhOrbiter1, bhOrbiter2];
    for (let i = 0; i < steps; i++) {
        let ax = 0, ay = 0;
        for (let body of gravBodies) {
            let dx = body.x - simState.x;
            let dy = body.y - simState.y;
            let distSq = dx * dx + dy * dy;
            let dist = Math.sqrt(distSq);
            if (dist > body.radius) {
                let force = G * body.mass / distSq;
                ax += force * dx / dist;
                ay += force * dy / dist;
            }
        }
        simState.vx += ax * dtSim;
        simState.vy += ay * dtSim;
        simState.x += simState.vx * dtSim;
        simState.y += simState.vy * dtSim;
        points.push({x: simState.x, y: simState.y});
        // Check for collision at this trajectory point
        if (collisionIndex === -1) {
            for (let body of collisionBodies) {
                if (circlesOverlap(simState.x, simState.y, spaceship.radius, body.x, body.y, body.radius)) {
                    collisionIndex = i;
                    break;
                }
            }
            if (collisionIndex === -1) {
                for (let ast of asteroids) {
                    if (circlesOverlap(simState.x, simState.y, spaceship.radius, ast.x, ast.y, ast.radius)) {
                        collisionIndex = i;
                        break;
                    }
                }
            }
            if (collisionIndex !== -1) break; // Stop computing past collision
        }
    }
    return {points, collisionIndex};
}

function drawTrajectoryProjection() {
    if (predictionDuration <= 0) {
        trajectoryCollisionWarning = false;
        return;
    }
    const result = getTrajectoryWithCollision({
        x: spaceship.x, y: spaceship.y,
        vx: spaceship.vx, vy: spaceship.vy
    }, predictionDuration, 0.1);
    const trajPoints = result.points;
    const collisionIdx = result.collisionIndex;
    trajectoryCollisionWarning = (collisionIdx !== -1);
    if (trajPoints.length < 2) return;

    ctx.save();
    ctx.setLineDash([5, 5]);

    if (collisionIdx === -1) {
        // No collision anticipated — draw white dashed line
        ctx.beginPath();
        ctx.moveTo(trajPoints[0].x - camera.x, trajPoints[0].y - camera.y);
        for (let i = 1; i < trajPoints.length; i++) {
            ctx.lineTo(trajPoints[i].x - camera.x, trajPoints[i].y - camera.y);
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
    } else {
        // Collision anticipated — color-code the trajectory
        const total = trajPoints.length;

        if (total < 6) {
            // Very short path to collision — draw all red
            ctx.beginPath();
            ctx.moveTo(trajPoints[0].x - camera.x, trajPoints[0].y - camera.y);
            for (let i = 1; i < total; i++) {
                ctx.lineTo(trajPoints[i].x - camera.x, trajPoints[i].y - camera.y);
            }
            ctx.strokeStyle = "#ff3333";
            ctx.lineWidth = 2;
            ctx.stroke();
        } else {
            const yellowStart = Math.floor(total * 0.5);
            const redStart = Math.floor(total * 0.75);

            // White safe portion
            ctx.beginPath();
            ctx.moveTo(trajPoints[0].x - camera.x, trajPoints[0].y - camera.y);
            for (let i = 1; i <= yellowStart; i++) {
                ctx.lineTo(trajPoints[i].x - camera.x, trajPoints[i].y - camera.y);
            }
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Yellow warning portion
            ctx.beginPath();
            ctx.moveTo(trajPoints[yellowStart].x - camera.x, trajPoints[yellowStart].y - camera.y);
            for (let i = yellowStart + 1; i <= redStart; i++) {
                ctx.lineTo(trajPoints[i].x - camera.x, trajPoints[i].y - camera.y);
            }
            ctx.strokeStyle = "#ffaa00";
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Red danger portion
            ctx.beginPath();
            ctx.moveTo(trajPoints[redStart].x - camera.x, trajPoints[redStart].y - camera.y);
            for (let i = redStart + 1; i < total; i++) {
                ctx.lineTo(trajPoints[i].x - camera.x, trajPoints[i].y - camera.y);
            }
            ctx.strokeStyle = "#ff3333";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Collision marker: pulsing ring + X
        const cp = trajPoints[total - 1];
        const cpx = cp.x - camera.x;
        const cpy = cp.y - camera.y;
        const pulse = 10 + Math.sin(gameTime * 0.5) * 5;
        const alpha = 0.5 + Math.sin(gameTime * 0.5) * 0.3;

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cpx, cpy, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        const xSize = 6;
        ctx.beginPath();
        ctx.moveTo(cpx - xSize, cpy - xSize);
        ctx.lineTo(cpx + xSize, cpy + xSize);
        ctx.moveTo(cpx + xSize, cpy - xSize);
        ctx.lineTo(cpx - xSize, cpy + xSize);
        ctx.strokeStyle = "#ff3333";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    ctx.restore();
}

function drawCollisionWarning() {
    if (!trajectoryCollisionWarning || !showTrajectory || predictionDuration <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const alpha = 0.6 + Math.sin(gameTime * 0.8) * 0.4;
    // Warning banner background
    const bannerWidth = 300;
    const bannerHeight = 36;
    const bx = (canvas.width - bannerWidth) / 2;
    const by = 8;
    ctx.fillStyle = `rgba(140, 0, 0, ${alpha * 0.5})`;
    ctx.fillRect(bx, by, bannerWidth, bannerHeight);
    ctx.strokeStyle = `rgba(255, 80, 80, ${alpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bannerWidth, bannerHeight);
    // Warning text
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255, 70, 70, ${alpha})`;
    ctx.fillText("\u26A0 COLLISION WARNING \u26A0", canvas.width / 2, by + bannerHeight / 2);
    ctx.restore();
}

function drawSolarFlareParticles() {
    ctx.save();
    ctx.shadowColor = "rgba(255,100,0,0.8)";
    ctx.shadowBlur = 8;
    for (let p of solarFlareParticles) {
        let grad = ctx.createRadialGradient(p.x - camera.x, p.y - camera.y, p.radius * 0.2, p.x - camera.x, p.y - camera.y, p.radius);
        grad.addColorStop(0, "rgba(255,200,0,1)");
        grad.addColorStop(1, "rgba(255,100,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x - camera.x, p.y - camera.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// ---------- Drawing Functions (add minimap) ----------
function drawMinimap() {
    const size = 180;
    const margin = 15;
    const x0 = canvas.width - size - margin;
    const y0 = margin;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0, y0, size, size);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x0, y0, size, size);

    // Dynamically determine scale based on furthest object (planets, belt, comets)
    let maxDist = 0;
    const bodiesForScale = [planetA, planetB, planetC, planetD, moon, satelliteA]; // exclude remote black hole
    for (let b of bodiesForScale) {
        const d = Math.hypot(b.x - sun.x, b.y - sun.y);
        if (d > maxDist) maxDist = d;
    }
    for (let a of asteroids) {
        const d = Math.hypot(a.x - sun.x, a.y - sun.y);
        if (d > maxDist) maxDist = d;
    }
    if (maxDist < BELT_OUTER) maxDist = BELT_OUTER;
    const scale = size / (maxDist * 2);

    const cx = x0 + size / 2;
    const cy = y0 + size / 2;

    function drawDot(px, py, color, r = 2) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + px * scale, cy + py * scale, r, 0, Math.PI * 2);
        ctx.fill();
    }

    drawDot(sun.x - sun.x, sun.y - sun.y, '#ff0', 3); // sun at center (offset by sun)
    drawDot(spaceship.x - sun.x, spaceship.y - sun.y, '#0f0');
    drawDot(collectible.x - sun.x, collectible.y - sun.y, '#0ff');
    // Planets & moon
    drawDot(planetA.x - sun.x, planetA.y - sun.y, '#00aaff');
    drawDot(planetB.x - sun.x, planetB.y - sun.y, '#ff4444');
    drawDot(planetC.x - sun.x, planetC.y - sun.y, '#ffaa00');
    drawDot(planetD.x - sun.x, planetD.y - sun.y, '#aa00ff');
    drawDot(moon.x - sun.x, moon.y - sun.y, '#888888');
    drawDot(blackHole.x - sun.x, blackHole.y - sun.y, '#551122', 3);
    if (driftingShip && !driftingShip.delivered) {
        drawDot(driftingShip.x - sun.x, driftingShip.y - sun.y, '#f0f');
    }

    ctx.restore();
}

// ---------- Guide Mode Overlay ----------
function drawGuideWorld() {
    if (!guideMode) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    function worldToScreen(wx, wy) {
        return { x: (wx - camera.x) * zoom, y: (wy - camera.y) * zoom };
    }

    function callout(wx, wy, label, offX, offY, color) {
        const s = worldToScreen(wx, wy);
        // Skip if off-screen
        if (s.x < -200 || s.x > canvas.width + 200 || s.y < -200 || s.y > canvas.height + 200) return;
        const lx = s.x + offX;
        const ly = s.y + offY;
        // Connector line
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(lx, ly);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        // Highlight dot
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Label background
        ctx.font = "bold 11px Arial";
        const tw = ctx.measureText(label).width;
        const pad = 5;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(lx - pad, ly - 13, tw + pad * 2, 19);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(lx - pad, ly - 13, tw + pad * 2, 19);
        // Label text
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, lx, ly - 3);
    }

    callout(sun.x, sun.y, "SUN \u2014 Avoid! Emits solar flares", 120, -95, "#ffea00");
    callout(spaceship.x, spaceship.y, "YOUR SHIP", -85, -35, "#fff");
    callout(planetA.x, planetA.y, "Planet \u2014 Gravity pulls you in", 45, -40, "#00aaff");
    callout(planetD.x, planetD.y, "Gas Giant \u2014 Strong gravity + rings", 100, -55, "#aa00ff");
    callout(collectible.x, collectible.y, "Collectible \u2014 Fly through to collect!", 40, -30, "#0f0");
    callout(wormhole.entry.x, wormhole.entry.y, "Wormhole \u2014 Teleport + fuel", 40, -35, "#0ff");
    callout(wormhole.exit.x, wormhole.exit.y, "Wormhole Exit", 35, -30, "#0ff");
    if (spaceStation) {
        callout(spaceStation.x, spaceStation.y, "Station \u2014 Deliver rescue ship here", 55, -45, "#88f");
    }
    if (driftingShip && !driftingShip.delivered) {
        callout(driftingShip.x, driftingShip.y, "Rescue Ship \u2014 Pick up & deliver (+4pts)", 45, -30, "#f0f");
    }

    ctx.restore();
}

function drawGuideHUD() {
    if (!guideMode) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Controls panel
    const panelW = 360;
    const panelH = 290;
    const px = (canvas.width - panelW) / 2;
    const py = 52;

    ctx.fillStyle = "rgba(0,0,10,0.92)";
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = "#4af";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, panelW, panelH);

    // Title
    ctx.fillStyle = "#4af";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("GUIDE MODE", px + panelW / 2, py + 10);

    // Divider
    ctx.strokeStyle = "rgba(100,170,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 15, py + 32);
    ctx.lineTo(px + panelW - 15, py + 32);
    ctx.stroke();

    // Controls list
    ctx.textBaseline = "top";
    const controls = [
        {key: "W / \u2191", desc: "Thrust forward (uses fuel)", color: "#0f0"},
        {key: "A / \u2190  D / \u2192", desc: "Rotate ship", color: "#ccc"},
        {key: "T", desc: "Toggle trajectory prediction", color: "#ccc"},
        {key: "G", desc: "Toggle this guide", color: "#4af"},
        {key: "R", desc: "Reset game", color: "#f55"},
        {key: "Scroll", desc: "Zoom in / out", color: "#ccc"},
        {key: "C / V / B / N", desc: "Speed up time (2x/4x/8x/16x)", color: "#fa0"},
    ];
    for (let i = 0; i < controls.length; i++) {
        const ly = py + 40 + i * 17;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = controls[i].color;
        ctx.fillText(controls[i].key, px + 12, ly);
        ctx.font = "11px Arial";
        ctx.fillStyle = "#aaa";
        ctx.fillText(controls[i].desc, px + 145, ly);
    }

    // Tips divider
    const tipsY = py + 40 + controls.length * 17 + 6;
    ctx.strokeStyle = "rgba(100,170,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(px + 15, tipsY);
    ctx.lineTo(px + panelW - 15, tipsY);
    ctx.stroke();

    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = "#aaa";
    const tips = [
        "\u2022 Green orbs = score, Blue = fuel, Purple hex = upgrades",
        "\u2022 Rescue the purple ship \u2192 deliver to blue station (+4pts)",
        "\u2022 Wormholes teleport you and refuel (+3 fuel)",
        "\u2022 Solar flares disable your ship temporarily!",
        "\u2022 White trajectory line warns of collisions ahead",
        "\u2022 Black hole: far down-right from the sun (south-east)r.",
    ];
    for (let i = 0; i < tips.length; i++) {
        ctx.fillText(tips[i], px + 12, tipsY + 8 + i * 15);
    }

    // Close hint
    ctx.fillStyle = "#555";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Press G to dismiss", px + panelW / 2, py + panelH - 16);

    ctx.restore();
}

function drawScene() {
     // Clear with identity transform to prevent streak artifacts
     ctx.setTransform(1,0,0,1,0,0);
     ctx.clearRect(0,0,canvas.width,canvas.height);

    // Draw background without scaling so it always covers viewport
    drawBackground();

    ctx.save();
    ctx.scale(zoom, zoom);

    drawStars();
    drawOrbitPaths();

    // Sun: corona glow behind, then body
    drawSunCorona();
    drawPlanet(sun, "#ffea00", "#ccaa00");

    // Planets with atmospheric glow and surface textures
    drawPlanetGlow(planetA, "rgba(0,170,255,0.15)");
    drawPlanet(planetA, "#00aaff", "#0077cc");
    drawPlanetTexture(planetA, "ice");

    drawPlanetGlow(planetB, "rgba(255,68,68,0.15)");
    drawPlanet(planetB, "#ff4444", "#cc3333");
    drawPlanetTexture(planetB, "volcanic");

    drawPlanetGlow(planetC, "rgba(255,170,0,0.12)");
    drawPlanet(planetC, "#ffaa00", "#cc8800");
    drawPlanetTexture(planetC, "desert");

    // Gas giant: back rings -> planet body -> texture -> front rings
    drawPlanetGlow(planetD, "rgba(170,0,255,0.18)");
    drawPlanetDRingsHalf(false);
    drawPlanet(planetD, "#aa00ff", "#8800cc");
    drawPlanetTexture(planetD, "gas");
    drawPlanetDRingsHalf(true);

    drawBlackHole();
    drawBody(bhOrbiter1, "#888");
    drawBody(bhOrbiter2, "#888");
    drawWormhole();
    drawPlanet(moon, "#aaaaaa", "#888888");
    drawPlanetTexture(moon, "moon");
    drawPlanet(satelliteA, "#aaaaaa", "#888888");
    drawAsteroids();
    drawSolarFlareParticles();
    drawExhaustParticles();
    drawPickupParticles();
    // Draw the rescue mission objects:
    drawSpaceStation();
    drawDriftingShip();
    drawCollectible();
    if (showTrajectory) {
        drawTrajectoryProjection();
    }
    drawSpaceship();
    // Off-screen collectible indicator
    const dxInd = collectible.x - spaceship.x;
    const dyInd = collectible.y - spaceship.y;
    const distInd = Math.sqrt(dxInd * dxInd + dyInd * dyInd);
    if (distInd > 300) {
        const angle = Math.atan2(dyInd, dxInd);
        const arrowX = spaceship.x + 50 * Math.cos(angle);
        const arrowY = spaceship.y + 50 * Math.sin(angle);
        ctx.save();
        ctx.strokeStyle = "#ff0";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(spaceship.x - camera.x, spaceship.y - camera.y);
        ctx.lineTo(arrowX - camera.x, arrowY - camera.y);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = "#ff0";
        ctx.translate(arrowX - camera.x, arrowY - camera.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, 5);
        ctx.lineTo(-10, -5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
    const dxBH = spaceship.x - blackHole.x;
    const dyBH = spaceship.y - blackHole.y;
    const dBH = Math.sqrt(dxBH * dxBH + dyBH * dyBH);
    if (dBH < 300) {
        const opacity = 1 - dBH / 300;
        ctx.fillStyle = "rgba(50,0,50," + (opacity * 0.5) + ")";
        ctx.fillRect(camera.x, camera.y, canvas.width / zoom, canvas.height / zoom);
    }

    ctx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawFuelBar();
    drawShieldBar();
    drawMinimap();
    drawCollisionWarning();
    drawGuideWorld();
    drawGuideHUD();
    ctx.restore();
}

// ---------- Physics ----------
function computeGravity(body, x, y) {
    const dx = body.x - x;
    const dy = body.y - y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);
    if (dist < body.radius) return {ax: 0, ay: 0};
    const force = G * body.mass / distSq;
    return {ax: force * dx / dist, ay: force * dy / dist};
}

// ---------- Update Game Objects ----------
function updateGame() {
    const dxBH = spaceship.x - blackHole.x;
    const dyBH = spaceship.y - blackHole.y;
    const dBH = Math.sqrt(dxBH * dxBH + dyBH * dyBH);
    // Compute speed multiplier based on held keys (c/v/b/n)
    let speedMul = 1;
    if (keys['c'] || keys['C']) speedMul = 2;
    if (keys['v'] || keys['V']) speedMul = 4;
    if (keys['b'] || keys['B']) speedMul = 8;
    if (keys['n'] || keys['N']) speedMul = 16;
    let dtEff = dt * speedMul;
    let timeFactor = speedMul;
    if (dBH < BH_TIME_DILATION_THRESHOLD) {
        let bhf = dBH / BH_TIME_DILATION_THRESHOLD;
        if (bhf < 0.2) bhf = 0.2;
        timeFactor *= bhf;
    }
    bgMusic.playbackRate = timeFactor;
    gameTime += dtEff;
    if (!spaceship.disabled) {
        if (keys["ArrowLeft"]) {
            spaceship.angle -= 0.05 * (spaceship.rotationMultiplier || 1);
        }
        if (keys["ArrowRight"]) {
            spaceship.angle += 0.05 * (spaceship.rotationMultiplier || 1);
        }
        if (keys["ArrowUp"] && spaceship.fuel > 0) {
            const thrust = 0.2 * (spaceship.thrustMultiplier || 1);
            spaceship.vx += thrust * Math.cos(spaceship.angle) * dtEff;
            spaceship.vy += thrust * Math.sin(spaceship.angle) * dtEff;
            spaceship.fuel -= 0.05 * dtEff;
            if (spaceship.fuel < 0) spaceship.fuel = 0;
            if (thrustSound.paused) {
                thrustSound.play().catch(() => {
                });
            }
        }
        if (!keys["ArrowUp"]) {
            thrustSound.pause();
            thrustSound.currentTime = 0;
        }
    }
    spaceship.trail.push({x: spaceship.x, y: spaceship.y, t: gameTime});
    spaceship.trail = spaceship.trail.filter(pt => (gameTime - pt.t) <= TRAIL_DURATION);

    planetA.angle += planetA.angularSpeed * dtEff;
    planetA.x = sun.x + planetA.orbitRadius * Math.cos(planetA.angle);
    planetA.y = sun.y + planetA.orbitRadius * Math.sin(planetA.angle);

    planetB.angle += planetB.angularSpeed * dtEff;
    planetB.x = sun.x + planetB.orbitRadius * Math.cos(planetB.angle);
    planetB.y = sun.y + planetB.orbitRadius * Math.sin(planetB.angle);

    // Update new planets
    planetC.angle += planetC.angularSpeed * dtEff;
    planetC.x = sun.x + planetC.orbitRadius * Math.cos(planetC.angle);
    planetC.y = sun.y + planetC.orbitRadius * Math.sin(planetC.angle);

    planetD.angle += planetD.angularSpeed * dtEff;
    planetD.x = sun.x + planetD.orbitRadius * Math.cos(planetD.angle);
    planetD.y = sun.y + planetD.orbitRadius * Math.sin(planetD.angle);

    moon.angle += moon.angularSpeed * dtEff;
    moon.x = planetB.x + moon.orbitRadius * Math.cos(moon.angle);
    moon.y = planetB.y + moon.orbitRadius * Math.sin(moon.angle);

    satelliteA.angle += satelliteA.angularSpeed * dtEff;
    satelliteA.x = planetA.x + satelliteA.orbitRadius * Math.cos(satelliteA.angle);
    satelliteA.y = planetA.y + satelliteA.orbitRadius * Math.sin(satelliteA.angle);

    bhOrbiter1.angle += bhOrbiter1.angularSpeed * dtEff;
    bhOrbiter1.x = blackHole.x + bhOrbiter1.orbitRadius * Math.cos(bhOrbiter1.angle);
    bhOrbiter1.y = blackHole.y + bhOrbiter1.orbitRadius * Math.sin(bhOrbiter1.angle);

    bhOrbiter2.angle += bhOrbiter2.angularSpeed * dtEff;
    bhOrbiter2.x = blackHole.x + bhOrbiter2.orbitRadius * Math.cos(bhOrbiter2.angle);
    bhOrbiter2.y = blackHole.y + bhOrbiter2.orbitRadius * Math.sin(bhOrbiter2.angle);

    updateAsteroids(dtEff);
    updateExhaustParticles(dtEff);
    updatePickupParticles(dtEff);
    // Enemies removed, no update call

    const gravSun = computeGravity(sun, spaceship.x, spaceship.y);
    const gravPlanetA = computeGravity(planetA, spaceship.x, spaceship.y);
    const gravPlanetB = computeGravity(planetB, spaceship.x, spaceship.y);
    const gravPlanetC = computeGravity(planetC, spaceship.x, spaceship.y);
    const gravPlanetD = computeGravity(planetD, spaceship.x, spaceship.y);
    const gravBlackHole = computeGravity(blackHole, spaceship.x, spaceship.y);
    const gravMoon = computeGravity(moon, spaceship.x, spaceship.y);
    const gravSat = computeGravity(satelliteA, spaceship.x, spaceship.y);
    const gravBhOrb1 = computeGravity(bhOrbiter1, spaceship.x, spaceship.y);
    const gravBhOrb2 = computeGravity(bhOrbiter2, spaceship.x, spaceship.y);
    const ax = gravSun.ax + gravPlanetA.ax + gravPlanetB.ax + gravPlanetC.ax + gravPlanetD.ax + gravBlackHole.ax + gravMoon.ax + gravSat.ax + gravBhOrb1.ax + gravBhOrb2.ax;
    const ay = gravSun.ay + gravPlanetA.ay + gravPlanetB.ay + gravPlanetC.ay + gravPlanetD.ay + gravBlackHole.ay + gravMoon.ay + gravSat.ay + gravBhOrb1.ay + gravBhOrb2.ay;
    spaceship.vx += ax * dtEff;
    spaceship.vy += ay * dtEff;
    spaceship.x += spaceship.vx * dtEff;
    spaceship.y += spaceship.vy * dtEff;

    if (spaceship.graceTime > 0) spaceship.graceTime -= dtEff;

    const dxC = spaceship.x - collectible.x;
    const dyC = spaceship.y - collectible.y;
    if (Math.sqrt(dxC * dxC + dyC * dyC) < spaceship.radius + collectible.radius) {
        const pickupColor = collectible.type === "fuel" ? "#4af" :
                            collectible.type === "upgrade" ? "#f0f" : "#0f0";
        emitPickupParticles(collectible.x, collectible.y, pickupColor);
        score++;
        totalScoreLS++;
        localStorage.setItem("totalScore", totalScoreLS);
        // Enemy spawning removed
        if (collectible.type === "fuel") {
            spaceship.fuel += 5;
        } else if (collectible.type === "upgrade") {
            applyUpgrade(collectible.upgrade);
        }
        spawnCollectible();
    }
    if (spaceship.fuel > spaceship.maxFuel) {
        spaceship.fuel = spaceship.maxFuel;
    }
    const dxEntry = spaceship.x - wormhole.entry.x;
    const dyEntry = spaceship.y - wormhole.entry.y;
    const dEntry = Math.sqrt(dxEntry * dxEntry + dyEntry * dyEntry);
    const dxExit = spaceship.x - wormhole.exit.x;
    const dyExit = spaceship.y - wormhole.exit.y;
    const dExit = Math.sqrt(dxExit * dxExit + dyExit * dyExit);
    if (dEntry < wormhole.entry.radius + spaceship.radius) {
        wormholeSound.play().catch(() => {
        });
        let angle = Math.atan2(spaceship.vy, spaceship.vx);
        if (isNaN(angle)) angle = spaceship.angle;
        const offset = wormhole.exit.radius + spaceship.radius + 10;
        spaceship.x = wormhole.exit.x + offset * Math.cos(angle);
        spaceship.y = wormhole.exit.y + offset * Math.sin(angle);
        spaceship.fuel += 3;
    } else if (dExit < wormhole.exit.radius + spaceship.radius) {
        wormholeSound.play().catch(() => {
        });
        let angle = Math.atan2(spaceship.vy, spaceship.vx);
        if (isNaN(angle)) angle = spaceship.angle;
        const offset = wormhole.entry.radius + spaceship.radius + 10;
        spaceship.x = wormhole.entry.x + offset * Math.cos(angle);
        spaceship.y = wormhole.entry.y + offset * Math.sin(angle);
        spaceship.fuel += 3;
    }
    // Continuous pressure: smooth variance, flare when crossing threshold
    const pressureRate = 0.006 + 0.012 * solarFlareSmoothNoise(gameTime, 0.13, 0.27, 0.07);
    solarFlarePressure += dtEff * pressureRate;
    if (solarFlarePressure >= 1) {
        let baseAngle = nextFlareAngle;
        let spread = (5 + Math.random() * 15) * Math.PI / 180;
        let halfSpread = spread / 2;
        for (let i = 0; i < 30; i++) {
            let angle = baseAngle + (Math.random() * spread - halfSpread);
            let speed = 28 + Math.random() * 10;
            solarFlareParticles.push({
                x: sun.x,
                y: sun.y,
                vx: speed * Math.cos(angle),
                vy: speed * Math.sin(angle),
                lifetime: 60,
                radius: 3
            });
        }
        solarFlarePressure = 0;
        // Angle drifts smoothly next frame; no jump
    }
    // Smooth drift for next flare direction (continuous, no discontinuity)
    nextFlareAngle += dtEff * (0.015 * Math.sin(gameTime * 0.11) + 0.012 * Math.sin(gameTime * 0.23));
    const twoPi = Math.PI * 2;
    if (nextFlareAngle < 0) nextFlareAngle += twoPi;
    if (nextFlareAngle >= twoPi) nextFlareAngle -= twoPi;
    for (let j = solarFlareParticles.length - 1; j >= 0; j--) {
        let p = solarFlareParticles[j];
        p.x += p.vx * dtEff;
        p.y += p.vy * dtEff;
        p.lifetime -= dtEff;
        if (p.lifetime <= 0) {
            solarFlareParticles.splice(j, 1);
        }
    }
    for (let p of solarFlareParticles) {
        const dx = spaceship.x - p.x;
        const dy = spaceship.y - p.y;
        if (Math.sqrt(dx * dx + dy * dy) < spaceship.radius + p.radius) {
            spaceship.disabled = true;
            spaceship.disableTime = 30;
            break;
        }
    }
    if (spaceship.disabled) {
        spaceship.disableTime -= dtEff;
        if (spaceship.disableTime <= 0) {
            spaceship.disabled = false;
            spaceship.disableTime = 0;
        }
    }
    if (spaceship.shieldTime > 0) {
        spaceship.shieldTime -= dtEff;
        if (spaceship.shieldTime < 0) spaceship.shieldTime = 0;
    }

    // --- Update the drifting rescue ship ---
    if (driftingShip && !driftingShip.delivered) {
        if (!driftingShip.rescued) {
            driftingShip.x += driftingShip.vx * dtEff;
            driftingShip.y += driftingShip.vy * dtEff;
            const dxDS = spaceship.x - driftingShip.x;
            const dyDS = spaceship.y - driftingShip.y;
            if (Math.sqrt(dxDS * dxDS + dyDS * dyDS) < spaceship.radius + driftingShip.radius) {
                driftingShip.rescued = true;
                spaceship.thrustMultiplier *= 0.5;
            }
        } else {
            driftingShip.x = spaceship.x;
            driftingShip.y = spaceship.y - spaceship.radius - driftingShip.radius - 5;
            const dxSS = spaceship.x - spaceStation.x;
            const dySS = spaceship.y - spaceStation.y;
            if (Math.sqrt(dxSS * dxSS + dySS * dySS) < spaceship.radius + spaceStation.radius) {
                driftingShip.delivered = true;
                score += 4;
                totalScoreLS += 4;
                localStorage.setItem("totalScore", totalScoreLS);
                spaceship.thrustMultiplier *= 2;
            }
        }
    }
    updateCamera();
}

function updateStatus() {
    const speed = Math.sqrt(spaceship.vx ** 2 + spaceship.vy ** 2).toFixed(2);
    let txt = `Fuel: ${spaceship.fuel.toFixed(2)}/${spaceship.maxFuel} | Speed: ${speed} | Score: ${score} | High Score: ${highScore}`;
    txt += ` | Total Score: ${totalScoreLS} | Games: ${totalGamesLS}`;
    if (spaceship.graceTime > 0) txt += ` | Safe: ${(spaceship.graceTime * dt).toFixed(1)}s`;
    if (spaceship.disabled) txt += ` | DISABLED: ${(spaceship.disableTime * dt).toFixed(1)}s`;
    if (spaceship.upgrades.length > 0) txt += ` | Upgrades: ${spaceship.upgrades.join(", ")}`;
    statusDiv.textContent = txt;
}

// ---------- Soft collision: below this relative speed, push instead of destroy ----------
const SOFT_COLLISION_SPEED_THRESHOLD = 18;
const SOFT_COLLISION_PUSH_OUT_EXTRA = 4;   // nudge ship this much beyond surface
const SOFT_COLLISION_BOUNCE_SPEED = 6;     // outward velocity added on soft bounce

function getBodyVelocity(body) {
    if (body === sun || body === blackHole) return { vx: 0, vy: 0 };
    let cx, cy;
    if (body === moon) { cx = planetB.x; cy = planetB.y; }
    else if (body === satelliteA) { cx = planetA.x; cy = planetA.y; }
    else if (body === bhOrbiter1 || body === bhOrbiter2) { cx = blackHole.x; cy = blackHole.y; }
    else { cx = sun.x; cy = sun.y; }
    const w = body.angularSpeed || 0;
    return { vx: -w * (body.y - cy), vy: w * (body.x - cx) };
}

function pushShipAwayFrom(body) {
    const dx = spaceship.x - body.x;
    const dy = spaceship.y - body.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const overlap = body.radius + spaceship.radius + SOFT_COLLISION_PUSH_OUT_EXTRA;
    spaceship.x = body.x + (dx / dist) * overlap;
    spaceship.y = body.y + (dy / dist) * overlap;
    const outward = SOFT_COLLISION_BOUNCE_SPEED / dist;
    spaceship.vx += dx * outward;
    spaceship.vy += dy * outward;
}

function gameOverCollision(message) {
    thrustSound.pause();
    thrustSound.currentTime = 0;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem("highScore", score);
    }
    simulationRunning = false;
    cancelAnimationFrame(animationId);
    collisionSound.play().catch(() => {});
    statusDiv.textContent = message;
    return true;
}

// ---------- Collision Detection ----------
function checkCollisions() {
    if (spaceship.shieldTime > 0) return false;
    const bodies = [sun, planetA, planetB, planetC, planetD, blackHole, moon, satelliteA, bhOrbiter1, bhOrbiter2];
    for (let body of bodies) {
        const dx = spaceship.x - body.x;
        const dy = spaceship.y - body.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < body.radius + spaceship.radius) {
            if (body === sun) {
                return gameOverCollision("Game Over! You collided with the sun.");
            }
            const bv = getBodyVelocity(body);
            const relVx = spaceship.vx - bv.vx;
            const relVy = spaceship.vy - bv.vy;
            const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);
            if (relSpeed >= SOFT_COLLISION_SPEED_THRESHOLD) {
                return gameOverCollision("Game Over! You collided with a celestial body.");
            }
            pushShipAwayFrom(body);
        }
    }
    for (let a of asteroids) {
        const dx = spaceship.x - a.x;
        const dy = spaceship.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < spaceship.radius + a.radius) {
            const relVx = spaceship.vx - (a.vx || 0);
            const relVy = spaceship.vy - (a.vy || 0);
            const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);
            if (relSpeed >= SOFT_COLLISION_SPEED_THRESHOLD) {
                return gameOverCollision("Game Over! You collided with an asteroid.");
            }
            pushShipAwayFrom(a);
        }
    }
    return false;
}

function animate() {
    animationId = requestAnimationFrame(animate);
    if (simulationPaused) {
        drawScene();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.font = "48px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Paused", canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }
    updateGame();
    drawScene();
    updateStatus();
    if (checkCollisions()) return;
}

// ADD: Centralised reset function ------------------------------------
function resetGame() {
    cancelAnimationFrame(animationId);
    simulationRunning = false;
    simulationPaused = false;
    pauseBtn.textContent = "Pause";
    // No enemies to reset
    zoom = 1;
    totalGamesLS++;
    localStorage.setItem("totalGames", totalGamesLS);
    // speed multipliers reset via keys release; nothing to reset here
    initSpaceship();
    score = 0;
    spawnCollectible();
    spawnAsteroids();
    spawnDriftingShip();
    spawnSpaceStation();
    solarFlarePressure = 0.35;
    solarFlareParticles = [];
    exhaustParticles = [];
    pickupParticles = [];
    nextFlareAngle = Math.random() * 2 * Math.PI;
    gameTime = 0;
    animationId = null;
    simulationRunning = true;
    // Reset planet angles/positions
    planetA.angle = 0;
    planetB.angle = 4 * Math.PI / 3;
    planetC.angle = -5 * Math.PI / 3;
    planetD.angle = Math.PI / 2;

    planetA.x = sun.x + planetA.orbitRadius * Math.cos(planetA.angle);
    planetA.y = sun.y + planetA.orbitRadius * Math.sin(planetA.angle);
    planetB.x = sun.x + planetB.orbitRadius * Math.cos(planetB.angle);
    planetB.y = sun.y + planetB.orbitRadius * Math.sin(planetB.angle);
    planetC.x = sun.x + planetC.orbitRadius * Math.cos(planetC.angle);
    planetC.y = sun.y + planetC.orbitRadius * Math.sin(planetC.angle);
    planetD.x = sun.x + planetD.orbitRadius * Math.cos(planetD.angle);
    planetD.y = sun.y + planetD.orbitRadius * Math.sin(planetD.angle);

    // Re-seed RNG so each reset gives fresh randomness
    setRandomSeed(Date.now() & 0xffffffff);

    animate();
}
// --------------------------------------------------------------------

// Update reset button to use new function
resetBtn.addEventListener("click", resetGame);

// ---------- Start Game ----------
initSpaceship();
spawnCollectible();
spawnAsteroids();
spawnDriftingShip();
spawnSpaceStation();
simulationRunning = true;
animate();
