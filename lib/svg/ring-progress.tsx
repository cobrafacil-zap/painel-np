'use client';

import { cn } from '@/lib/utils';

/**
 * Anel SVG com progresso animado (0..100%). Usa CSS vars para que
 * `globals.css` controle a animação via `@keyframes drawRing`.
 *
 * @example
 *   <RingProgress percent={68} label="68%" />
 */
export function RingProgress({
  percent,
  size = 200,
  stroke = 12,
  color = '#22c55e',
  label,
  sublabel,
  trackColor = 'rgb(255 255 255 / 0.06)',
  className,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
  trackColor?: string;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const targetOffset = circumference * (1 - clamped / 100);

  // CSS vars: --ring-circumference e --ring-target, usados por globals.css
  const styleVars: React.CSSProperties = {
    ['--ring-circumference' as any]: circumference.toFixed(2),
    ['--ring-target' as any]: targetOffset.toFixed(2),
  };

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        style={styleVars}
        role="img"
        aria-label={label ?? `${clamped.toFixed(0)}%`}
      >
        {/* Trilho de fundo */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Progresso animado */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          className="ring-progress-fill"
        />
      </svg>
      {(label || sublabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {label && (
            <div className="text-2xl font-bold tabular-nums text-zinc-100">{label}</div>
          )}
          {sublabel && <div className="text-[11px] text-zinc-500 mt-0.5">{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
