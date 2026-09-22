export type SfxKind = "start" | "turn" | "card" | "secret" | "transfer" | "detective" | "dog" | "culprit" | "finish";

let audioContext: AudioContext | null = null;
let ambientTimer: number | null = null;
let ambientEnabled = false;

function context() {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  return audioContext;
}

export async function unlockAudio() {
  const ctx = context();
  if (ctx && ctx.state === "suspended") await ctx.resume();
  return Boolean(ctx);
}

function tone(freq: number, when: number, duration: number, gainValue = 0.035, type: OscillatorType = "sine") {
  const ctx = context();
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), when + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.03);
}

export function playSfx(kind: SfxKind) {
  const ctx = context();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.01;
  if (kind === "start") {
    tone(392, t, .14, .04, "triangle"); tone(523, t + .12, .16, .045, "triangle"); tone(659, t + .26, .22, .05, "triangle");
  } else if (kind === "turn") {
    tone(660, t, .10, .035, "sine"); tone(880, t + .11, .16, .04, "sine");
  } else if (kind === "card") {
    tone(240, t, .07, .025, "triangle"); tone(310, t + .05, .08, .022, "triangle");
  } else if (kind === "secret") {
    tone(880, t, .08, .02, "sine"); tone(740, t + .09, .09, .02, "sine"); tone(988, t + .19, .12, .025, "sine");
  } else if (kind === "transfer") {
    tone(330, t, .10, .025, "triangle"); tone(440, t + .08, .10, .025, "triangle"); tone(550, t + .16, .13, .03, "triangle");
  } else if (kind === "detective") {
    tone(196, t, .18, .035, "sawtooth"); tone(247, t + .20, .18, .035, "sawtooth"); tone(330, t + .42, .28, .045, "triangle");
  } else if (kind === "dog") {
    tone(180, t, .08, .035, "square"); tone(230, t + .11, .09, .035, "square");
  } else if (kind === "culprit") {
    tone(110, t, .45, .035, "sawtooth"); tone(92, t + .26, .55, .028, "sine");
  } else if (kind === "finish") {
    tone(523, t, .14, .045, "triangle"); tone(659, t + .14, .14, .045, "triangle"); tone(784, t + .28, .16, .05, "triangle"); tone(1046, t + .45, .36, .055, "triangle");
  }
}

function ambientPulse() {
  const ctx = context();
  if (!ctx || ctx.state !== "running" || !ambientEnabled) return;
  const t = ctx.currentTime + 0.02;
  tone(130.81, t, 1.6, .009, "sine");
  tone(196.00, t + .65, 1.4, .007, "sine");
  tone(164.81, t + 1.35, 1.7, .008, "sine");
}

export function setAmbient(enabled: boolean) {
  ambientEnabled = enabled;
  if (typeof window === "undefined") return;
  if (ambientTimer !== null) {
    window.clearInterval(ambientTimer);
    ambientTimer = null;
  }
  if (enabled) {
    ambientPulse();
    ambientTimer = window.setInterval(ambientPulse, 4300);
  }
}
