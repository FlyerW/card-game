// 背景音樂：用 Web Audio 即時合成，不用音樂檔（沒有版權問題，也不佔下載量）。
// 選單一首、對戰一首，換畫面時舊的那首很快收掉，不會兩首疊在一起。瀏覽器規定使用者點過頁面才能出聲，所以第一次點擊時才開始。
// 同時開了好幾個遊戲頁面時，只有最後點過的那一頁出聲（用 BroadcastChannel 互相通知）。

export type Scene = 'menu' | 'battle';

/** 音效：出牌、法術或技能、攻擊、受傷、生物倒下、回復、輪到你、勝利、落敗。 */
export type Sound = 'card' | 'spell' | 'attack' | 'hit' | 'death' | 'heal' | 'turn' | 'win' | 'lose';

interface Song {
  bpm: number;
  /** 每小節一個和弦（MIDI 音高），四小節一輪。 */
  chords: number[][];
  /** 每個和弦的低音根音。 */
  bass: number[];
  /** 琶音一小節幾個音：8 或 16。 */
  arpNotes: 8 | 16;
  drums: boolean;
  /** 墊底和弦的音量。 */
  pad: number;
}

const SONGS: Record<Scene, Song> = {
  // A 小調：Am – F – C – G，慢、安靜。
  menu: {
    bpm: 72,
    chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    bass: [45, 41, 48, 43],
    arpNotes: 8,
    drums: false,
    pad: 0.05,
  },
  // D 小調：Dm – B♭ – C – A，快、有鼓。
  battle: {
    bpm: 108,
    chords: [[50, 53, 57], [50, 53, 58], [48, 52, 55], [49, 52, 57]],
    bass: [38, 34, 36, 33],
    arpNotes: 16,
    drums: true,
    pad: 0.035,
  },
};

const STORAGE_KEY = 'card-game.music';
const SFX_KEY = 'card-game.sfx';
const SFX_VOLUME = 0.7;
const VOLUME = 0.5;
const STEPS_PER_BAR = 16;
/** 排程往前看多久（秒）。 */
const LOOKAHEAD = 0.3;

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // 存不了就只在這次開著的頁面有效。
  }
}

interface Playing {
  scene: Scene;
  song: Song;
  out: GainNode;
  /** 這首排好、還沒響完的音；換曲時一起停掉。 */
  sources: Set<AudioScheduledSourceNode>;
  pad: BiquadFilterNode;
  bar: number;
  step: number;
  next: number;
  /** 旋律用的亂數，固定種子，同一首每次聽起來一樣。 */
  seed: number;
}

class Music {
  enabled = loadFlag(STORAGE_KEY);
  sfxEnabled = loadFlag(SFX_KEY);
  private sfx: GainNode | null = null;
  private scene: Scene = 'menu';
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private playing: Playing | null = null;
  private timer: number | null = null;
  private readonly id = Math.random().toString(36).slice(2);
  private readonly channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('card-game.music');

  constructor() {
    // 第一次點擊或按鍵時才建立聲音（瀏覽器的自動播放限制）。每次點擊也順便宣告「現在由這一頁出聲」。
    const unlock = () => {
      if (this.sfxEnabled && !this.enabled) void this.context()?.resume();
      if (!this.enabled) return;
      this.start();
      this.channel?.postMessage(this.id);
    };
    // 別的遊戲頁面開始出聲：這一頁安靜下來，等使用者再點這一頁才接回來。
    this.channel?.addEventListener('message', (event: MessageEvent<string>) => {
      if (event.data !== this.id) this.stop();
    });
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled || this.sfxEnabled) void this.ctx.resume();
    });
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    saveFlag(STORAGE_KEY, this.enabled);
    if (this.enabled) this.start();
    else this.stop();
    return this.enabled;
  }

  toggleSfx(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    saveFlag(SFX_KEY, this.sfxEnabled);
    return this.sfxEnabled;
  }

  /** 播音效，一個接一個錯開一點。音效關著、或這一頁還沒被點過（瀏覽器不讓出聲）就不播。 */
  effects(sounds: readonly Sound[]): void {
    if (!this.sfxEnabled || sounds.length === 0) return;
    const ctx = this.context();
    if (!ctx || ctx.state !== 'running') return;
    sounds.forEach((sound, i) => this.effect(sound, ctx.currentTime + 0.02 + i * 0.12));
  }

  /** 聲音環境：第一次要用時才建立。 */
  private context(): AudioContext | null {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.setup(this.ctx);
    }
    return this.ctx;
  }

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (this.ctx && this.enabled) this.play(scene);
  }

  private start(): void {
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume();
    if (this.playing?.scene !== this.scene) this.play(this.scene);
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 60);
  }

  private stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.playing && this.ctx) this.end(this.playing, 0.4);
    this.playing = null;
  }

  private setup(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = VOLUME;
    const compressor = ctx.createDynamicsCompressor();
    this.master.connect(compressor).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_VOLUME;
    this.sfx.connect(compressor);
    // 簡單的殘響：衰減的雜訊當脈衝響應。
    const length = Math.floor(ctx.sampleRate * 2.2);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  private play(scene: Scene): void {
    const ctx = this.ctx!;
    if (this.playing) this.end(this.playing, 0.3);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    out.connect(this.master!);
    out.connect(this.reverb!);
    const pad = ctx.createBiquadFilter();
    pad.type = 'lowpass';
    pad.frequency.value = 1100;
    pad.connect(out);
    this.playing = {
      scene,
      song: SONGS[scene],
      out,
      sources: new Set(),
      pad,
      bar: 0,
      step: 0,
      next: ctx.currentTime + 0.1,
      seed: scene === 'menu' ? 7 : 13,
    };
  }

  /** 收掉一首：很快淡出，排好的音全部停掉，再把線拔掉。 */
  private end(p: Playing, seconds: number): void {
    const now = this.ctx!.currentTime;
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.linearRampToValueAtTime(0, now + seconds);
    for (const source of p.sources) {
      try {
        source.stop(now + seconds);
      } catch {
        // 已經停了。
      }
    }
    window.setTimeout(() => p.out.disconnect(), (seconds + 0.2) * 1000);
  }

  /** 記下這首排好的音，響完就移掉。 */
  private track(p: Playing, source: AudioScheduledSourceNode): void {
    p.sources.add(source);
    source.onended = () => p.sources.delete(source);
  }

  /** 把接下來一小段時間要響的音先排好。 */
  private schedule(): void {
    const ctx = this.ctx;
    const p = this.playing;
    if (!ctx || !p || ctx.state !== 'running') return;
    const stepTime = 60 / p.song.bpm / 4;
    // 分頁被暫停過就從現在接著排，不要一次補一堆音。
    if (p.next < ctx.currentTime) p.next = ctx.currentTime + 0.05;
    while (p.next < ctx.currentTime + LOOKAHEAD) {
      this.playStep(p, p.next, stepTime);
      p.next += stepTime;
      p.step += 1;
      if (p.step === STEPS_PER_BAR) {
        p.step = 0;
        p.bar += 1;
      }
    }
  }

  private random(p: Playing): number {
    p.seed = (p.seed * 1103515245 + 12345) % 2147483648;
    return p.seed / 2147483648;
  }

  private playStep(p: Playing, time: number, stepTime: number): void {
    const { song, step } = p;
    const index = p.bar % song.chords.length;
    const chord = song.chords[index]!;
    const barLength = stepTime * STEPS_PER_BAR;
    // 每 8 小節一段：第二段拿掉琶音、加旋律，聽起來不會一直一樣。
    const section = Math.floor(p.bar / 8) % 2;

    if (step === 0) {
      for (const note of chord) {
        this.voice(p, time, freq(note), barLength * 1.05, 'sawtooth', song.pad, 0.5, 0.6, -6);
        this.voice(p, time, freq(note), barLength * 1.05, 'sawtooth', song.pad, 0.5, 0.6, 6);
      }
    }

    // 低音：選單每兩拍一次，對戰每拍一次、第三拍跳八度。
    const bassEvery = song.drums ? 4 : 8;
    if (step % bassEvery === 0) {
      const octave = song.drums && step === 8 ? 12 : 0;
      this.pluck(p, time, freq(song.bass[index]! + octave), stepTime * bassEvery * 0.9, 'triangle', 0.22);
    }

    // 琶音：根音、三音、五音、三音，4 個音一輪，剛好對齊拍子。
    const arpEvery = STEPS_PER_BAR / song.arpNotes;
    if (section === 0 && step % arpEvery === 0) {
      const tones = [chord[0]!, chord[1]!, chord[2]!, chord[1]!];
      const n = step / arpEvery;
      const note = tones[n % tones.length]! + 12;
      this.pluck(p, time, freq(note), stepTime * arpEvery * 1.6, 'triangle', 0.05);
    }

    // 旋律：第二段才有，每拍一個和弦音，第一拍用根音，聽起來跟和弦是同一首。
    if (section === 1 && step % 4 === 0 && (step === 0 || this.random(p) < 0.6)) {
      const note = step === 0 ? chord[0]! + 12 : chord[Math.floor(this.random(p) * chord.length)]! + 12;
      const up = note < 60 ? 12 : 0;
      this.pluck(p, time, freq(note + up), stepTime * 6, 'sine', 0.09);
      this.pluck(p, time, freq(note + up + 12), stepTime * 3, 'sine', 0.02);
    }

    if (song.drums) {
      if (step === 0 || step === 8 || (step === 10 && p.bar % 2 === 1)) this.kick(p, time);
      if (step === 4 || step === 12) this.hit(p, time, 0.18, 1800, 'bandpass', 0.09);
      if (step % 2 === 0) this.hit(p, time, 0.04, 7000, 'highpass', step % 4 === 2 ? 0.035 : 0.02);
    }
  }

  /** 慢慢起來、慢慢收掉的長音（墊底和弦）。 */
  private voice(p: Playing, time: number, hz: number, length: number, type: OscillatorType, level: number, attack: number, release: number, detune = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    osc.detune.value = detune;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level, time + attack);
    gain.gain.setValueAtTime(level, time + Math.max(attack, length - release));
    gain.gain.linearRampToValueAtTime(0, time + length);
    osc.connect(gain).connect(p.pad);
    osc.start(time);
    osc.stop(time + length + 0.05);
    this.track(p, osc);
  }

  /** 撥弦：一下就衰減。 */
  private pluck(p: Playing, time: number, hz: number, length: number, type: OscillatorType, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(gain).connect(p.out);
    osc.start(time);
    osc.stop(time + length + 0.05);
    this.track(p, osc);
  }

  private kick(p: Playing, time: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
    osc.connect(gain).connect(p.out);
    osc.start(time);
    osc.stop(time + 0.32);
    this.track(p, osc);
  }

  /** 雜訊打擊：小鼓（帶通）與鈸（高通）。 */
  private hit(p: Playing, time: number, length: number, hz: number, type: BiquadFilterType, level: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(filter).connect(gain).connect(p.out);
    source.start(time, Math.random() * 0.5);
    source.stop(time + length + 0.02);
    this.track(p, source);
  }

  // ─── 音效 ──────────────────────────────────────────────────────────────────

  private effect(sound: Sound, t: number): void {
    const out = this.sfx!;
    switch (sound) {
      case 'card':
        this.sweep(t, 0.16, 700, 2600, 'bandpass', 0.25, out);
        this.tone(t + 0.04, 880, 0.18, 'triangle', 0.18, out);
        return;
      case 'spell':
        this.tone(t, 660, 0.3, 'sine', 0.2, out);
        this.tone(t + 0.07, 990, 0.35, 'sine', 0.16, out);
        this.tone(t + 0.14, 1320, 0.4, 'sine', 0.1, out);
        return;
      case 'attack':
        this.sweep(t, 0.14, 3000, 600, 'bandpass', 0.35, out);
        return;
      case 'hit':
        this.drop(t, 170, 55, 0.2, 'sine', 0.55, out);
        this.sweep(t, 0.08, 400, 200, 'lowpass', 0.3, out);
        return;
      case 'death':
        this.drop(t, 320, 70, 0.4, 'sawtooth', 0.12, out);
        return;
      case 'heal':
        [523, 659, 784].forEach((hz, i) => this.tone(t + i * 0.07, hz, 0.3, 'sine', 0.14, out));
        return;
      case 'turn':
        this.tone(t, 784, 0.7, 'sine', 0.18, out);
        this.tone(t, 1568, 0.4, 'sine', 0.05, out);
        return;
      case 'win':
        [523, 659, 784, 1047].forEach((hz, i) => this.tone(t + i * 0.12, hz, i === 3 ? 0.9 : 0.25, 'triangle', 0.2, out));
        [523, 659, 784].forEach((hz) => this.tone(t + 0.48, hz, 0.9, 'sine', 0.08, out));
        return;
      case 'lose':
        [440, 349, 294].forEach((hz, i) => this.tone(t + i * 0.2, hz, i === 2 ? 0.9 : 0.3, 'triangle', 0.18, out));
        return;
    }
  }

  private tone(t: number, hz: number, length: number, type: OscillatorType, level: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /** 音高一路往下掉：受傷的悶響、倒下的聲音。 */
  private drop(t: number, from: number, to: number, length: number, type: OscillatorType, level: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /** 雜訊掃過一段頻率：出牌的刷聲、攻擊的揮擊聲。 */
  private sweep(t: number, length: number, from: number, to: number, type: BiquadFilterType, level: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(gain).connect(out);
    source.start(t, Math.random() * 0.5);
    source.stop(t + length + 0.02);
  }
}

export const music = new Music();
