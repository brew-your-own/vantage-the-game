/**
 * First-person look: the Wisp is rooted to its tile and can only turn its head.
 * Mouse look uses pointer lock (click the canvas to capture, Esc to release);
 * arrow keys turn too, for keyboard-only play.
 */
export class LookControls {
  yaw = 0;
  pitch = -0.25;
  enabled = true;
  sensitivity = 0.0025;
  /** Keyboard turn rate in radians per second. */
  turnRate = 1.6;

  private readonly held = new Set<string>();

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== element) void element.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== element) return;
      this.turn(-e.movementX * this.sensitivity, -e.movementY * this.sensitivity);
    });
    window.addEventListener('keydown', (e) => this.held.add(e.key));
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  turn(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dPitch));
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const k = this.turnRate * dt;
    if (this.held.has('ArrowLeft')) this.turn(k, 0);
    if (this.held.has('ArrowRight')) this.turn(-k, 0);
    if (this.held.has('ArrowUp')) this.turn(0, k * 0.6);
    if (this.held.has('ArrowDown')) this.turn(0, -k * 0.6);
  }

  /** Unit view direction (Three.js convention: yaw 0 looks toward −Z). */
  direction(): { x: number; y: number; z: number } {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }
}
