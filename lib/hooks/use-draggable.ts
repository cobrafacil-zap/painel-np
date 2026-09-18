'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Drag nativo HTML5 pra reordenar listas.
 *
 * Implementa:
 *  - `draggable` em cada item (passado via spread).
 *  - `onDragStart` salva índice da fonte.
 *  - `onDragOver` calcula posição de drop e move visualmente.
 *  - `onDrop` chama `onReorder(newArray)`.
 *  - Long-press 300ms em mobile (touch) ativa drag.
 *
 * @example
 *   const drag = useDraggable({ items, onReorder: setItems });
 *   items.map((item, i) => (
 *     <div {...drag.itemProps(i)}>{item.title}</div>
 *   ))
 */
export function useDraggable<T>(opts: {
  items: T[];
  onReorder: (newItems: T[]) => void;
  /** Tempo de long-press em ms pra ativar drag em mobile. Default 300. */
  longPressMs?: number;
}) {
  const { items, onReorder, longPressMs = 300 } = opts;
  const dragFromRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Long-press em touch
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      dragFromRef.current = idx;
      setDraggingIndex(idx);
      // Firefox exige dataTransfer pra disparar drag
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    },
    []
  );

  const onDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (dragFromRef.current === null) return;
      dragOverRef.current = idx;
    },
    []
  );

  const onDrop = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragFromRef.current;
      if (from === null || from === idx) {
        dragFromRef.current = null;
        setDraggingIndex(null);
        return;
      }
      const arr = [...items];
      const [moved] = arr.splice(from, 1);
      arr.splice(idx, 0, moved);
      onReorder(arr);
      dragFromRef.current = null;
      dragOverRef.current = null;
      setDraggingIndex(null);
    },
    [items, onReorder]
  );

  const onDragEnd = useCallback(() => {
    dragFromRef.current = null;
    dragOverRef.current = null;
    setDraggingIndex(null);
  }, []);

  // Touch handlers (mobile fallback)
  const onTouchStart = useCallback(
    (idx: number) => () => {
      longPressTimer.current = setTimeout(() => {
        dragFromRef.current = idx;
        setDraggingIndex(idx);
      }, longPressMs);
    },
    [longPressMs]
  );

  const onTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const itemProps = useCallback(
    (idx: number) => ({
      draggable: true,
      onDragStart: onDragStart(idx),
      onDragOver: onDragOver(idx),
      onDrop: onDrop(idx),
      onDragEnd: onDragEnd,
      onTouchStart: onTouchStart(idx),
      onTouchEnd: onTouchEnd,
      onTouchMove: onTouchEnd,
      className: draggingIndex === idx ? 'dragging' : '',
    }),
    [onDragStart, onDragOver, onDrop, onDragEnd, onTouchStart, onTouchEnd, draggingIndex]
  );

  return { itemProps, draggingIndex };
}
