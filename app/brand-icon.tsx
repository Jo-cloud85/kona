import type { ReactElement } from 'react';

/**
 * The triangular mark used for the app icon (favicon + "Add to Home Screen"),
 * shared between icon.tsx and apple-icon.tsx. Not the You tab's single-color
 * chevron — three facets meeting at the centroid, one per gradient token
 * already in globals.css (--grad-performance/recovery/vital), so the icon is
 * drawn from the app's own palette rather than a new one invented for it.
 */
export function TriangleMark(): ReactElement {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="perf" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ff9a44" />
          <stop offset="1" stopColor="#f62b0a" />
        </linearGradient>
        <linearGradient id="rec" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#11970c" />
          <stop offset="1" stopColor="#7cff3b" />
        </linearGradient>
        <linearGradient id="vital" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6388d1" />
          <stop offset="1" stopColor="#ff4bd8" />
        </linearGradient>
      </defs>
      {/* apex (50,14) · bottom-left (16,82) · bottom-right (84,82) · centroid (50,59.33) */}
      <polygon points="16,82 50,14 50,59.33" fill="url(#perf)" stroke="#0b0b10" strokeWidth="1.6" />
      <polygon points="84,82 16,82 50,59.33" fill="url(#rec)" stroke="#0b0b10" strokeWidth="1.6" />
      <polygon points="50,14 84,82 50,59.33" fill="url(#vital)" stroke="#0b0b10" strokeWidth="1.6" />
    </svg>
  );
}
