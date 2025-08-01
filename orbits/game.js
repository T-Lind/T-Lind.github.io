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
    stars.push({
        x: Math.random() * 8000 - 4000,
        y: Math.random() * 8000 - 4000,
        radius: Math.random() * 1.5 + 0.5
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
const BH_MAX_EFFECT_RADIUS = 1200;
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
            if (b === blackHole) {
                const dBH_ast = Math.hypot(a.x - b.x, a.y - b.y);
                if (dBH_ast > BH_MAX_EFFECT_RADIUS) {
                    // outside BH influence
                    continue;
                }
            }
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
        let grad = ctx.createRadialGradient(a.x - camera.x, a.y - camera.y, a.radius * 0.3, a.x - camera.x, a.y - camera.y, a.radius);
        grad.addColorStop(0, "#666666");
        grad.addColorStop(1, "#333333");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(a.x - camera.x, a.y - camera.y, a.radius, 0, Math.PI * 2);
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
    ctx.beginPath();
    if (collectible.type === "fuel") {
        ctx.fillStyle = "#00f";
        ctx.arc(collectible.x - camera.x, collectible.y - camera.y, collectible.radius, 0, Math.PI * 2);
        ctx.fill();
    } else if (collectible.type === "upgrade") {
        ctx.fillStyle = "#a0f";
        let size = collectible.radius;
        let cx = collectible.x - camera.x, cy = collectible.y - camera.y;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            let a = Math.PI / 3 * i;
            let x = cx + size * Math.cos(a);
            let y = cy + size * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillStyle = "#0f0";
        ctx.arc(collectible.x - camera.x, collectible.y - camera.y, collectible.radius, 0, Math.PI * 2);
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
    ctx.save();
    ctx.translate(driftingShip.x - camera.x, driftingShip.y - camera.y);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fillStyle = driftingShip.rescued ? "#f0f" : "#f0f";
    ctx.fill();
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

// ---------- Solar Flares (Dynamic Environmental Hazards) ----------
let solarFlareTimer = 45; // ticks until next flare burst
let solarFlareParticles = [];

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
    ctx.fillStyle = "#fff";
    for (let star of stars) {
        const sx = star.x - camera.x;
        const sy = star.y - camera.y;
        if (sx > -10 && sx < canvas.width + 10 && sy > -10 && sy < canvas.height + 10) {
            ctx.beginPath();
            ctx.arc(sx, sy, star.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
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

function drawBlackHole() {
    const x = blackHole.x - camera.x;
    const y = blackHole.y - camera.y;
    const outerRadius = blackHole.radius * 3;
    const grad = ctx.createRadialGradient(x, y, blackHole.radius * 0.2, x, y, outerRadius);
    grad.addColorStop(0, "#000");
    grad.addColorStop(0.5, "#551122");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, blackHole.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
}

function drawWormhole() {
    wormhole.pulse += 0.05;
    const pulseR = wormhole.entry.radius + Math.sin(wormhole.pulse) * 3;
    ctx.save();
    ctx.shadowColor = "#0ff";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(wormhole.entry.x - camera.x, wormhole.entry.y - camera.y, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = "#0ff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wormhole.exit.x - camera.x, wormhole.exit.y - camera.y, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = "#0ff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
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
    if (spaceship.shieldTime > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, spaceship.radius + 10, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,150,255,0.7)";
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-10, -8);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    if (keys["ArrowUp"] && spaceship.fuel > 0 && !spaceship.disabled) {
        ctx.beginPath();
        ctx.moveTo(-10, 4);
        ctx.lineTo(-20, 0);
        ctx.lineTo(-10, -4);
        ctx.fillStyle = "orange";
        ctx.fill();
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
function getTrajectoryPoints(state, duration, dtSim) {
    let points = [];
    let simState = {x: state.x, y: state.y, vx: state.vx, vy: state.vy};
    const steps = duration / dtSim;
    // Include the new planets in the gravity simulation.
    const bodies = [sun, planetA, planetB, planetC, planetD, moon, satelliteA, bhOrbiter1, bhOrbiter2];
    for (let i = 0; i < steps; i++) {
        let ax = 0, ay = 0;
        let dBH = Math.hypot(simState.x - blackHole.x, simState.y - blackHole.y);
        if (dBH < BH_MAX_EFFECT_RADIUS) {
            bodies.push(blackHole);
        }
        for (let body of bodies) {
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
    }
    return points;
}

function drawTrajectoryProjection() {
    const trajPoints = getTrajectoryPoints({
        x: spaceship.x,
        y: spaceship.y,
        vx: spaceship.vx,
        vy: spaceship.vy
    }, 45, 0.1);
    if (trajPoints.length < 2) return;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(trajPoints[0].x - camera.x, trajPoints[0].y - camera.y);
    for (let pt of trajPoints) {
        ctx.lineTo(pt.x - camera.x, pt.y - camera.y);
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
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

function drawScene() {
     // Clear with identity transform to prevent streak artifacts
     ctx.setTransform(1,0,0,1,0,0);
     ctx.clearRect(0,0,canvas.width,canvas.height);

    // Draw background without scaling so it always covers viewport
    drawBackground();

    ctx.save();
    ctx.scale(zoom, zoom);

    drawStars();
    // Draw celestial bodies
    drawPlanet(sun, "#ffea00", "#ccaa00");
    drawPlanet(planetA, "#00aaff", "#0077cc");
    drawPlanet(planetB, "#ff4444", "#cc3333");
    // New planets with chosen colors:
    drawPlanet(planetC, "#ffaa00", "#cc8800");
    drawPlanet(planetD, "#aa00ff", "#8800cc");
    drawBlackHole();
    drawBody(bhOrbiter1, "#888");
    drawBody(bhOrbiter2, "#888");
    drawWormhole();
    drawPlanet(moon, "#aaaaaa", "#888888");
    drawPlanet(satelliteA, "#aaaaaa", "#888888");
    drawAsteroids();
    // Enemies removed, no draw call
    drawSolarFlareParticles();
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
    // Enemies removed, no update call

    const gravSun = computeGravity(sun, spaceship.x, spaceship.y);
    const gravPlanetA = computeGravity(planetA, spaceship.x, spaceship.y);
    const gravPlanetB = computeGravity(planetB, spaceship.x, spaceship.y);
    const gravPlanetC = computeGravity(planetC, spaceship.x, spaceship.y);
    const gravPlanetD = computeGravity(planetD, spaceship.x, spaceship.y);
    let gravBlackHole = {ax: 0, ay: 0};
    if (dBH < BH_MAX_EFFECT_RADIUS) {
        gravBlackHole = computeGravity(blackHole, spaceship.x, spaceship.y);
    }
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
    solarFlareTimer -= dtEff;
    if (solarFlareTimer <= 0) {
        let baseAngle = Math.random() * 2 * Math.PI;
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
        solarFlareTimer = 30;
    }
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

// ---------- Collision Detection ----------
function checkCollisions() {
    if (spaceship.shieldTime > 0) return false;
    const bodies = [sun, planetA, planetB, planetC, planetD, blackHole, moon, satelliteA, bhOrbiter1, bhOrbiter2];
    for (let body of bodies) {
        const dx = spaceship.x - body.x;
        const dy = spaceship.y - body.y;
        if (Math.sqrt(dx * dx + dy * dy) < body.radius + spaceship.radius) {
            if (score > highScore) {
                highScore = score;
                localStorage.setItem("highScore", score);
            }
            simulationRunning = false;
            cancelAnimationFrame(animationId);
            collisionSound.play().catch(() => {
            });
            statusDiv.textContent = "Game Over! You collided with a celestial body.";
            return true;
        }
    }
    for (let a of asteroids) {
        const dx = spaceship.x - a.x;
        const dy = spaceship.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < spaceship.radius + a.radius) {
            if (score > highScore) {
                highScore = score;
                localStorage.setItem("highScore", score);
            }
            simulationRunning = false;
            cancelAnimationFrame(animationId);
            collisionSound.play().catch(() => {
            });
            statusDiv.textContent = "Game Over! You collided with an asteroid.";
            return true;
        }
    }
    // Enemy collision removed
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
    solarFlareTimer = 30;
    solarFlareParticles = [];
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
