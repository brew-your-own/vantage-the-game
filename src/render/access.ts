/**
 * Accessibility switches the renderers read every frame (set from the player's settings).
 *
 * - `reducedMotion`: no pulsing, bobbing or swaying. Things that move because the game
 *   moves them (the beam turning, a Moth gliding to the next tile) still move.
 * - `colorBlind`: cues that rely on red against green use blue and orange instead, and the
 *   Keeper's sight is drawn striped, so it reads without colour at all.
 */
export const access = { reducedMotion: false, colorBlind: false };

/** A gentle oscillation, or its resting value with reduced motion. */
export const wobble = (value: number) => (access.reducedMotion ? 0 : value);
