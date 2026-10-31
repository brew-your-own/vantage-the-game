import type { Stinger } from './composer';
import type { Mood } from './mood';

const SIGNALS: (keyof Mood)[] = ['exposure', 'lowEnergy', 'threat', 'progress', 'altitude', 'calm'];
const STINGERS: Stinger[] = ['relay', 'dark', 'transfer', 'scatter', 'swat', 'win', 'lose'];

/**
 * Dev-only panel (backquote key): sliders that override each mood signal, and buttons for
 * the stingers, to audition the music without playing into each situation.
 */
export class MoodPanel {
  readonly el = document.createElement('div');
  /** The faked mood, or null when the game drives the music. */
  override: Mood | null = null;

  constructor(private readonly playStinger: (s: Stinger) => void) {
    this.el.style.cssText =
      'position:fixed;right:12px;top:56px;z-index:10;display:none;background:rgba(10,12,24,.92);' +
      'border:1px solid #3a4270;border-radius:6px;padding:10px 12px;font:12px monospace;color:#c8d0ff;width:260px';
    const rows = SIGNALS.map(
      (k) =>
        `<label style="display:flex;justify-content:space-between;gap:8px;margin:3px 0">${k}` +
        `<input type="range" min="0" max="1" step="0.05" value="${k === 'calm' ? 1 : 0}" data-k="${k}"></label>`,
    ).join('');
    const buttons = STINGERS.map((s) => `<button data-s="${s}" style="font:11px monospace;margin:2px">${s}</button>`).join('');
    this.el.innerHTML =
      '<b>music mood (dev)</b><label style="display:block;margin:6px 0"><input type="checkbox" id="mood-on"> override the game</label>' +
      rows +
      `<div style="margin-top:6px">stingers: ${buttons}</div>`;
    this.el.querySelector('#mood-on')!.addEventListener('change', () => this.read());
    this.el.querySelectorAll('input[type=range]').forEach((i) => i.addEventListener('input', () => this.read()));
    this.el.querySelectorAll<HTMLButtonElement>('button[data-s]').forEach((b) =>
      b.addEventListener('click', () => this.playStinger(b.dataset.s as Stinger)),
    );
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }

  /** Mirrors the live mood on the sliders while not overriding. */
  show(mood: Mood): void {
    if (this.override || this.el.style.display === 'none') return;
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) => {
      i.value = String(mood[i.dataset.k as keyof Mood]);
    });
  }

  private read(): void {
    const on = (this.el.querySelector('#mood-on') as HTMLInputElement).checked;
    if (!on) {
      this.override = null;
      return;
    }
    const m = {} as Mood;
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) => {
      m[i.dataset.k as keyof Mood] = Number(i.value);
    });
    this.override = m;
  }
}
