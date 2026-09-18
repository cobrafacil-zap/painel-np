'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Grid 7×N (semanas x dias da semana) com intensidade por cor.
 * Tooltip nativo no hover.
 *
 * @example
 *   <Heatmap data={[{ dia: '2026-09-01', valor: 50 }, ...]} />
 */
export function Heatmap({
  data,
  weeks = 6,
  cellSize,
  gap = 3,
  color = '#22c55e',
  labels,
}: {
  /** Array de { dia: ISO date, valor: number }. Dias ausentes = 0. */
  data: { dia: string; valor: number }[];
  weeks?: number;
  cellSize?: number;
  gap?: number;
  color?: string;
  /** Rótulos da lateral (Seg, Ter, ...). Default: ['Seg', '', 'Qua', '', 'Sex', '', 'Dom'] */
  labels?: string[];
}) {
  // Responsivo: celular usa células menores, desktop usa maiores.
  const [responsiveSize, setResponsiveSize] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const w = window.innerWidth;
      setResponsiveSize(w < 640 ? 11 : w < 1024 ? 14 : 16);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  cellSize = cellSize ?? responsiveSize ?? 14;

  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const grid = useMemo(() => {
    // Mapa de data → valor
    const map = new Map(data.map((d) => [d.dia, d.valor]));
    const max = Math.max(...data.map((d) => d.valor), 1);

    // Encontra o domingo da semana atual (referência)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dow = hoje.getDay(); // 0=domingo
    const lastSunday = new Date(hoje);
    lastSunday.setDate(hoje.getDate() - dow);

    // weeks colunas, do mais antigo (esquerda) ao mais recente (direita)
    const cols: { date: Date; valor: number; intensity: number }[][] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const col: { date: Date; valor: number; intensity: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(lastSunday);
        date.setDate(lastSunday.getDate() - w * 7 + d);
        const iso = date.toISOString().slice(0, 10);
        const valor = map.get(iso) ?? 0;
        const intensity = valor / max;
        col.push({ date, valor, intensity });
      }
      cols.push(col);
    }
    return { cols, max };
  }, [data, weeks]);

  const total = data.reduce((s, d) => s + d.valor, 0);
  const diaLabels = labels ?? ['Seg', '', 'Qua', '', 'Sex', '', 'Dom'];

  const width = weeks * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  return (
    <div className="relative">
      <div className="flex gap-1.5 items-start">
        <div className="flex flex-col text-[9px] text-zinc-600 leading-[14px] mt-[1px]" style={{ gap }}>
          {diaLabels.map((l, i) => (
            <div key={i} style={{ height: cellSize }}>
              {l}
            </div>
          ))}
        </div>
        <div>
          <svg width={width} height={height} className="block">
            {grid.cols.map((col, ci) =>
              col.map((cell, ri) => {
                const opacity = cell.intensity === 0 ? 0.06 : 0.18 + cell.intensity * 0.7;
                return (
                  <rect
                    key={`${ci}-${ri}`}
                    x={ci * (cellSize + gap)}
                    y={ri * (cellSize + gap)}
                    width={cellSize}
                    height={cellSize}
                    rx={2.5}
                    fill={color}
                    fillOpacity={opacity}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        text: `${cell.date.toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}: ${cell.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })
            )}
          </svg>
          {hover && (
            <div
              className="absolute pointer-events-none bg-bg-elevated border border-white/10 rounded-md px-2 py-1 text-[11px] text-zinc-200 shadow-lg whitespace-nowrap"
              style={{
                left: hover.x + 12,
                top: hover.y - 8,
              }}
            >
              {hover.text}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 text-[10px] text-zinc-500">
        <span>menos</span>
        <div className="flex gap-1">
          {[0.06, 0.25, 0.5, 0.75, 1].map((op, i) => (
            <div
              key={i}
              style={{
                width: cellSize,
                height: cellSize,
                background: color,
                opacity: op,
                borderRadius: 2.5,
              }}
            />
          ))}
        </div>
        <span>mais</span>
      </div>
    </div>
  );
}
