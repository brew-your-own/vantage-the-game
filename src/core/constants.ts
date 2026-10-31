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
