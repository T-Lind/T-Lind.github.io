/* Original, softly pulsing space score. Audio exists only after clicking Admire. */
(() => {
  "use strict";
  const button = document.getElementById("admire-sound");
  if (!button) return;
  let active = false, muted = false, unavailable = false;
  let context, master, timer, nextNote = 0, step = 0;
  const voices = new Set();
  const beat = 60 / 76;
  // Dm9 / Bbmaj7 / Fmaj9 / Csus2, eight beats per chord.
  const chords = [[50, 57, 60, 64, 69], [46, 53, 57, 60, 65], [41, 53, 57, 60, 67], [48, 55, 60, 62, 67]];
  const melody = [0, 2, 1, 3, 2, 4, 3, 1, 0, 3, 2, 4, 1, 2, 3, 4];

  try { muted = localStorage.getItem("admire-muted") === "true"; } catch (_) {}
  function updateButton() {
    button.hidden = !active;
    button.textContent = unavailable ? "RETRY SOUND" : muted ? "SOUND OFF" : "SOUND ON";
    button.setAttribute("aria-pressed", String(muted));
    button.setAttribute("aria-label", unavailable ? "Retry admire music" : muted ? "Unmute admire music" : "Mute admire music");
  }
  function wanted() { return active && !muted && !document.hidden; }
  function createAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Audio unavailable");
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.24;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    master.connect(filter);
    filter.connect(context.destination);
    const echo = context.createDelay(2);
    const feedback = context.createGain();
    const wet = context.createGain();
    echo.delayTime.value = beat * 0.75;
    feedback.gain.value = 0.32;
    wet.gain.value = 0.28;
    filter.connect(echo);
    echo.connect(feedback);
    feedback.connect(echo);
    echo.connect(wet);
    wet.connect(context.destination);
  }
  function tone(note, time, duration, volume, type = "sine", attack = 0.025) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(time);
    oscillator.stop(time + duration + 0.05);
  }
  function schedule() {
    if (!wanted() || context.state !== "running") return;
    while (nextNote < context.currentTime + 0.2) {
      const chord = chords[Math.floor(step / 16) % chords.length];
      const position = step % 16;
      if (position === 0) {
        chord.slice(1).forEach((note, i) => tone(note, nextNote, beat * 7.8, 0.045, i % 2 ? "triangle" : "sine", 1.2));
      }
      tone(chord[melody[position]] + 12, nextNote, beat * 1.8, 0.065, "sine");
      if (position % 4 === 0) tone(chord[0] - 12, nextNote, beat * 1.9, 0.16, "sine", 0.06);
      nextNote += beat / 2;
      step++;
    }
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    voices.forEach(voice => { try { voice.stop(); } catch (_) {} });
    if (context && context.state !== "closed") context.suspend().catch(() => {});
  }
  async function sync() {
    updateButton();
    if (!wanted()) { stop(); return; }
    try {
      if (!context) createAudio();
      await context.resume();
      // Exit, mute, or tab hiding may happen while resume is pending.
      if (!wanted()) { stop(); return; }
      unavailable = false;
      if (!timer) {
        nextNote = context.currentTime + 0.04;
        step = 0;
        schedule();
        timer = setInterval(schedule, 80);
      }
    } catch (_) { unavailable = true; stop(); }
    updateButton();
  }
  document.addEventListener("admirechange", event => { active = event.detail.active; sync(); });
  button.addEventListener("click", () => {
    if (!unavailable) muted = !muted;
    try { localStorage.setItem("admire-muted", String(muted)); } catch (_) {}
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", sync);
  updateButton();
})();
