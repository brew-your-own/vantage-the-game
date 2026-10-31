/**
 * The Keeper's voice: the browser's speech synthesis, restricted to voices that run on
 * this machine (`localService`), so no text ever leaves it. With no local English voice,
 * the Keeper stays silent and only the subtitles show.
 *
 * Speech does not pass through WebAudio, so mute, pause and volume are applied here.
 */

/** Preferred local voices, best first (deep, steady voices suit the Keeper). */
const PREFERRED = ['Daniel', 'Fred', 'Ralph', 'Alex', 'Albert', 'Microsoft David', 'Microsoft Mark', 'Microsoft George'];

export class KeeperVoice {
  /** Player setting: the Keeper speaks at all. */
  enabled = true;
  /** Master mute (U). */
  muted = false;
  private voice: SpeechSynthesisVoice | null = null;
  private synth: SpeechSynthesis | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

  constructor() {
    if (!this.synth) return;
    this.chooseVoice();
    // Voices often load after the page does.
    this.synth.addEventListener('voiceschanged', () => this.chooseVoice());
  }

  /** Name of the voice in use, or null when no local voice is available. */
  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  get speaking(): boolean {
    return !!this.synth?.speaking;
  }

  private chooseVoice(): void {
    const local = this.synth!.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
    const named = (n: string) => local.find((v) => v.name === n || v.name.startsWith(`${n} `));
    this.voice = PREFERRED.map(named).find((v) => v) ?? local.find((v) => v.default) ?? local[0] ?? null;
  }

  /** Speaks a line. Unless `interrupt`, a line already being spoken is left to finish. */
  say(text: string, interrupt = false): boolean {
    if (!this.synth || !this.voice || !this.enabled || this.muted) return false;
    if (this.synth.speaking) {
      if (!interrupt) return false;
      this.synth.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.pitch = 0.4;
    u.rate = 0.82;
    u.volume = 0.9;
    this.synth.speak(u);
    return true;
  }

  stop(): void {
    this.synth?.cancel();
  }
}
