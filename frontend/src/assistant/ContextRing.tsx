import type { ContextUsage } from './contextUsage';

const R = 5;
const C = 2 * Math.PI * R;

export function ContextRing({ usage, tooltip }: { usage: ContextUsage; tooltip: string }) {
  const dash = Math.min(usage.ratio, 1) * C;

  return (
    <svg
      className={`ctx-ring ctx-${usage.level}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      role="img"
      aria-label={tooltip}
    >
      <title>{tooltip}</title>
      <circle className="ctx-track" cx="7" cy="7" r={R} />
      <circle className="ctx-arc" cx="7" cy="7" r={R} strokeDasharray={`${dash} ${C}`} />
    </svg>
  );
}
