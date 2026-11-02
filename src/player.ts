import type { LoopMode, Track } from "./types";

type Slot = { el: HTMLAudioElement; url: string | null };

export type Transition =
  | "linear"
  | "equal"
  | "smooth"
  | "swell"
  | "quick"
  | "sequential"
  | "gap"
  | "cut";

export const TRANSITIONS: { id: Transition; label: string; hint: string }[] = [
  { id: "linear", label: "Crossfade", hint: "Uma sobe enquanto a outra desce (linear)" },
  { id: "equal", label: "Suave", hint: "Crossfade de potência constante, sem 'buraco' de volume" },
  { id: "smooth", label: "Curva S", hint: "Começa e termina devagar, com o meio mais rápido" },
  { id: "swell", label: "Crescendo", hint: "A atual some rápido e a próxima cresce lentamente até o fim" },
  { id: "quick", label: "Rápido-lento", hint: "A próxima entra quase de imediato e a atual se despede devagar" },
  { id: "sequential", label: "Fade out → in", hint: "A atual some por completo, depois a próxima entra" },
  { id: "gap", label: "Respiro", hint: "Fade out, 1 s de silêncio e então a próxima entra com fade in" },
  { id: "cut", label: "Corte seco", hint: "Troca imediata, sem fade" },
];

function gains(mode: Transition, t: number): [number, number] {
  switch (mode) {
    case "equal":
      return [Math.cos((t * Math.PI) / 2), Math.sin((t * Math.PI) / 2)];
    case "smooth": {
      const s = t * t * (3 - 2 * t);
      return [1 - s, s];
    }
    case "swell":
      return [Math.pow(1 - t, 3), t * t];
    case "quick":
      return [1 - t * t, 1 - Math.pow(1 - t, 3)];
    default:
      return [1 - t, t];
  }
}

export class Player {
  private slots: Slot[] = [
    { el: new Audio(), url: null },
    { el: new Audio(), url: null },
  ];
  private active = 0;
  private timer: number | null = null;
  private isFading = false;
  private pausing = false;
  private token = 0;

  tracks: Track[] = [];
  loop: LoopMode = "off";
  transition: Transition = "linear";
  fadeMs = 3000;
  pauseFadeMs = 1500;
  volume = 1;
  currentId: string | null = null;
  onChange: () => void = () => {};

  constructor() {
    this.slots.forEach((s, i) => {
      s.el.addEventListener("timeupdate", () => this.handleTime(i));
      s.el.addEventListener("ended", () => this.handleEnded(i));
    });
  }

  get playing() {
    return !!this.currentId && !this.cur.el.paused && !this.pausing;
  }

  get currentTime() {
    return this.currentId ? this.cur.el.currentTime : 0;
  }

  get duration() {
    const d = this.cur.el.duration;
    return this.currentId && isFinite(d) ? d : 0;
  }

  seek(seconds: number) {
    if (!this.currentId) return;
    this.cur.el.currentTime = seconds;
  }

  private get cur() {
    return this.slots[this.active];
  }
  private get other() {
    return this.slots[1 - this.active];
  }

  private release(slot: Slot) {
    slot.el.pause();
    if (slot.url) URL.revokeObjectURL(slot.url);
    slot.url = null;
    slot.el.removeAttribute("src");
    slot.el.load();
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ramp(ms: number, step: (t: number) => void, done: () => void) {
    this.clearTimer();
    const start = performance.now();
    const total = Math.max(1, ms);
    this.timer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / total);
      step(t);
      if (t >= 1) {
        this.clearTimer();
        done();
      }
    }, 30);
  }

  /** Cancela qualquer fade/pausa em andamento, mantendo o que está tocando. */
  private cancel() {
    this.token++;
    this.clearTimer();
    this.pausing = false;
    if (this.isFading) {
      this.isFading = false;
      this.release(this.other);
    }
    this.cur.el.volume = Math.min(this.cur.el.volume, this.volume);
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.isFading && !this.pausing && !this.cur.el.paused) {
      this.cur.el.volume = v;
    }
  }

  private indexOf(id: string | null) {
    return this.tracks.findIndex((t) => t.id === id);
  }

  private nextTrack(auto: boolean): Track | null {
    if (!this.tracks.length) return null;
    const i = this.indexOf(this.currentId);
    if (auto && this.loop === "track" && i >= 0) return this.tracks[i];
    if (i < 0) return this.tracks[0];
    if (i + 1 < this.tracks.length) return this.tracks[i + 1];
    if (!auto || this.loop === "playlist") return this.tracks[0];
    return null;
  }

  private prevTrack(): Track | null {
    if (!this.tracks.length) return null;
    const i = this.indexOf(this.currentId);
    if (i <= 0) return this.tracks[this.tracks.length - 1];
    return this.tracks[i - 1];
  }

  private load(slot: Slot, track: Track, volume: number) {
    this.release(slot);
    slot.url = URL.createObjectURL(track.blob);
    slot.el.src = slot.url;
    slot.el.volume = volume;
  }

  private async startDirect(track: Track, token: number) {
    const incoming = this.other;
    const outgoing = this.cur;
    this.load(incoming, track, this.volume);
    try {
      await incoming.el.play();
    } catch {
      this.onChange();
      return;
    }
    if (token !== this.token) return;
    this.release(outgoing);
    this.active = 1 - this.active;
    this.onChange();
  }

  async crossfadeTo(track: Track, mode: Transition = this.transition) {
    this.cancel();
    const token = this.token;
    const outgoing = this.cur;
    const incoming = this.other;
    const hasCurrent = !!this.currentId && !outgoing.el.paused;
    this.currentId = track.id;

    if (!hasCurrent || mode === "cut" || this.fadeMs <= 0) {
      await this.startDirect(track, token);
      return;
    }

    const startOut = outgoing.el.volume;

    if (mode === "sequential" || mode === "gap") {
      const half = this.fadeMs / 2;
      this.isFading = true;
      this.onChange();
      this.ramp(
        half,
        (t) => (outgoing.el.volume = startOut * (1 - t)),
        async () => {
          if (mode === "gap") {
            await new Promise((r) => setTimeout(r, 1000));
            if (token !== this.token) return;
          }
          this.load(incoming, track, 0);
          try {
            await incoming.el.play();
          } catch {
            return;
          }
          if (token !== this.token) return;
          this.release(outgoing);
          this.active = 1 - this.active;
          this.onChange();
          this.ramp(
            half,
            (t) => (incoming.el.volume = this.volume * t),
            () => {
              this.isFading = false;
            }
          );
        }
      );
      return;
    }

    this.load(incoming, track, 0);
    try {
      await incoming.el.play();
    } catch {
      this.onChange();
      return;
    }
    if (token !== this.token) return;

    const dur = isFinite(incoming.el.duration) ? incoming.el.duration : Infinity;
    const fade = Math.max(1, Math.min(this.fadeMs, dur * 500));
    this.isFading = true;
    this.active = 1 - this.active;
    this.onChange();

    this.ramp(
      fade,
      (t) => {
        const [gOut, gIn] = gains(mode, t);
        outgoing.el.volume = Math.max(0, Math.min(1, startOut * gOut));
        incoming.el.volume = Math.max(0, Math.min(1, this.volume * gIn));
      },
      () => {
        this.isFading = false;
        this.release(outgoing);
      }
    );
  }

  private handleTime(i: number) {
    if (i !== this.active || this.isFading || this.pausing) return;
    if (this.transition === "cut") return;
    const el = this.slots[i].el;
    if (!isFinite(el.duration) || el.paused) return;
    const fade = Math.min(this.fadeMs, (el.duration * 1000) / 2) / 1000;
    if (el.duration - el.currentTime <= fade) {
      const next = this.nextTrack(true);
      if (next) this.crossfadeTo(next);
    }
  }

  private handleEnded(i: number) {
    if (i !== this.active) return;
    const next = this.nextTrack(true);
    if (next) this.crossfadeTo(next);
    else this.onChange();
  }

  playTrack(id: string) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) this.crossfadeTo(t);
  }

  /** Pausa. Com fade = true usa pauseFadeMs; false pausa na hora. */
  pause(fade = true) {
    const el = this.cur.el;
    if (!this.currentId || el.paused) return;
    this.cancel();
    if (fade && this.pauseFadeMs > 0) {
      this.pausing = true;
      const startV = el.volume;
      this.ramp(
        this.pauseFadeMs,
        (t) => (el.volume = startV * (1 - t)),
        () => {
          el.pause();
          el.volume = this.volume;
          this.pausing = false;
          this.onChange();
        }
      );
    } else {
      el.pause();
      el.volume = this.volume;
    }
    this.onChange();
  }

  resume(fade = true) {
    const el = this.cur.el;
    if (!this.currentId) return;
    this.cancel();
    const useFade = fade && this.pauseFadeMs > 0;
    const startV = el.paused ? 0 : el.volume;
    if (useFade) el.volume = startV;
    else el.volume = this.volume;
    el.play().catch(() => {});
    if (useFade) {
      this.ramp(
        this.pauseFadeMs,
        (t) => (el.volume = startV + (this.volume - startV) * t),
        () => {}
      );
    }
    this.onChange();
  }

  toggle() {
    if (!this.currentId) {
      if (this.tracks[0]) this.crossfadeTo(this.tracks[0]);
      return;
    }
    if (this.playing) this.pause(true);
    else this.resume(true);
  }

  next() {
    const t = this.nextTrack(false);
    if (t) this.crossfadeTo(t);
  }

  prev() {
    const t = this.prevTrack();
    if (t) this.crossfadeTo(t);
  }

  stopIfCurrent(id: string) {
    if (this.currentId !== id) return;
    this.token++;
    this.clearTimer();
    this.isFading = false;
    this.pausing = false;
    this.release(this.cur);
    this.release(this.other);
    this.currentId = null;
    this.onChange();
  }
}
