/**
 * Header and rows share this, so the header reads as part of the grid rather than a bar on top of it.
 *
 * Any future data-grid surface reads it too, so headers and rows cannot drift.
 */
export const GRID_ROW_HEIGHT = 34

/** panda token `1` = 0.75rem = 12px; cells, headers and skeletons all use it */
export const GRID_FONT_SIZE = "1"

/** a flat starting width — per-type widths made the header read as ragged */
export const GRID_DEFAULT_COL_WIDTH = 200
