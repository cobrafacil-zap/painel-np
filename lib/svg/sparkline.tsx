'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Sparkline SVG com curva smooth (cubic bezier) e animação de desenho.
 * `width` é opcional — se omitido, usa a largura do container (responsivo).
 *
 * @example
 *   <Sparkline data={[10, 20, 15, 30, 25, 35, 40]} labels={['Seg', ...]} />
 */
export function Sparkline({
  data,
  width: widthProp,
  height = 80,
  color = '#22c55e',
  fill = true,
  labels,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  labels?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [responsiveWidth, setResponsiveWidth] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || widthProp !== undefined) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setResponsiveWidth(el.getBoundingClientRect().width || 320);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthProp]);

  const width = widthProp ?? responsiveWidth ?? 320;

  const { path, areaPath, max } = useMemo(() => {
    if (data.length === 0) return { path: '', areaPath: '', max: 0 };
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    // Smooth curve via Catmull-Rom → Cubic Bezier
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 8) - 4;
      return { x, y };
    });

    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(
        2
      )}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }

    const areaPath = `${d} L ${points[points.length - 1].x.toFixed(2)} ${height} L 0 ${height} Z`;
    return { path: d, areaPath, max };
  }, [data, width, height]);

  if (data.length === 0) {
    return (
      <div className="text-xs text-zinc-500" style={{ width, height }}>
        Sem dados
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`spark-fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {fill && <path d={areaPath} fill={`url(#spark-fill-${color.replace('#', '')})`} />}
        <path
          d={path}
          stroke={color}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sparkline-path"
          style={{ ['--sparkline-length' as any]: width * 1.5 }}
        />
        {/* Ponto final */}
        {(() => {
          const last = data.length - 1;
          const stepX = data.length > 1 ? width / (data.length - 1) : width;
          const min = Math.min(...data, 0);
          const range = Math.max(...data, 1) - min || 1;
          const y = height - ((data[last] - min) / range) * (height - 8) - 4;
          return (
            <g>
              <circle cx={last * stepX} cy={y} r="3.5" fill={color} />
              <circle cx={last * stepX} cy={y} r="6" fill={color} opacity="0.25" />
            </g>
          );
        })()}
      </svg>
      {labels && labels.length > 0 && (
        <div className="flex justify-between mt-1.5 text-[10px] text-zinc-500 tabular-nums">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
