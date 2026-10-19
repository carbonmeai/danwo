/** A test run's icon: one checked box. */
export function TestIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="m5.5 8.2 1.8 1.8 3.3-3.6" />
    </svg>
  )
}

/** A matrix run's icon: the grid of faults it ran. */
export function MatrixIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {[2, 6.5, 11].flatMap((y) =>
        [2, 6.5, 11].map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="3.2"
            height="3.2"
            rx="0.8"
            opacity={x === y ? 1 : 0.45}
          />
        )),
      )}
    </svg>
  )
}
