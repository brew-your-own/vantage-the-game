/** World-space geometry constants shared by the simulation and the renderer. */

/** Hex centre-to-corner distance, in world units. */
export const HEX_SIZE = 1;

/** World height of one terrain level. */
export const LEVEL_HEIGHT = 0.6;

/** Fraction of the hex radius covered by the flat tile top; the rest is the bevel/slope. */
export const TOP_INSET = 0.66;

/** Height of the Wisp's eye above the tile it stands on. */
export const EYE_HEIGHT = 1.2;

/** Height of one Shard; equal to a terrain level, so a Shard is worth one level of climb. */
export const SHARD_HEIGHT = LEVEL_HEIGHT;

/** Height of a Husk (it blocks line of sight up to this height). */
export const HUSK_HEIGHT = 1.4;

/** Horizontal radius of the column an object stack occupies, for occlusion and picking. */
export const OBJECT_RADIUS = 0.42;

/** Height of the Keeper's tower; its lamp sits at the top. */
export const KEEPER_HEIGHT = 3.2;

/** Beam tuning. Relays (M6) will narrow and slow the beam as they are drained. */
export const BEAM = {
  /** Half of the beam's horizontal width, radians (15°). */
  halfAngle: (15 * Math.PI) / 180,
  /** Rotation speed, radians per second (one full turn every 36 s). */
  speed: (2 * Math.PI) / 36,
  /** Seconds in the beam per unit of energy drained. */
  drainInterval: 1,
};

/** Height gained per Spire level (two terrain levels). */
export const SPIRE_STEP = 2 * LEVEL_HEIGHT;
/** Highest level a Spire can grow to. */
export const SPIRE_MAX_LEVEL = 3;
/** Seconds for a fed Spire to grow one level. */
export const SPIRE_GROW_TIME = 2;
/** Energy spent per feed (one level of growth). */
export const SPIRE_FEED_COST = 1;

/** Moss, Moths and the energy cycle between them. */
export const ECOLOGY = {
  /** Chance per second that lit moss hatches into a Moth. */
  hatchRate: 0.05,
  /** Seconds between Moth moves (one tile per move). */
  mothStep: 1.2,
  /** Radius (tiles) within which a Moth senses moss. */
  mossSense: 5,
  /** Radius (tiles) within which a Moth senses the Wisp. */
  wispSense: 6,
  /** Seconds per unit a Moth on the Wisp's tile drains. */
  leechInterval: 1,
  /** Energy at which a Moth settles and lays that much moss nearby. */
  layAt: 5,
  /** Radius (tiles) a settling Moth lays its moss within. */
  layRadius: 3,
};

/** Height of a Relay pylon (it blocks sight; drain it from above its top). */
export const RELAY_HEIGHT = 1.6;
/** Energy each Relay holds. */
export const RELAY_ENERGY = 6;
/** Height of the plinth the Keeper's tower sinks to once its lamp goes dark. */
export const PLINTH_HEIGHT = 0.6;
