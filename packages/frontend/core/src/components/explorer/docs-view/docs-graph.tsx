import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { DocSummaryService } from '@affine/core/modules/doc-summary';
import { DocsSearchService } from '@affine/core/modules/docs-search';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { i18nTime } from '@affine/i18n';
import { LiveData, useLiveData, useService } from '@toeverything/infra';
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { map } from 'rxjs';

import { DocExplorerContext } from '../context';
import * as styles from './docs-graph.css';

// ---- Types ----

interface GNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface GEdge {
  source: string;
  target: string;
}

// ---- Force simulation ----

const REPULSION = 6000;
const SPRING_LENGTH = 110;
const SPRING_STRENGTH = 0.04;
const DAMPING = 0.82;
const GRAVITY = 0.018;
const MIN_DIST = 8;
const BASE_RADIUS = 7;
const MAX_NODES = 400;

function nodeRadius(degree: number): number {
  return BASE_RADIUS + Math.sqrt(degree) * 2.5;
}

function stepSimulation(
  nodes: GNode[],
  edges: GEdge[],
  cx: number,
  cy: number
) {
  if (nodes.length === 0) return;

  const forces = new Float64Array(nodes.length * 2);
  const indexMap = new Map(nodes.map((n, i) => [n.id, i]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces[i * 2] -= fx;
      forces[i * 2 + 1] -= fy;
      forces[j * 2] += fx;
      forces[j * 2 + 1] += fy;
    }
  }

  for (const edge of edges) {
    const ai = indexMap.get(edge.source);
    const bi = indexMap.get(edge.target);
    if (ai === undefined || bi === undefined) continue;
    const a = nodes[ai],
      b = nodes[bi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
    const displacement = dist - SPRING_LENGTH;
    const force = SPRING_STRENGTH * displacement;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    forces[ai * 2] += fx;
    forces[ai * 2 + 1] += fy;
    forces[bi * 2] -= fx;
    forces[bi * 2 + 1] -= fy;
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const fx = forces[i * 2] + (cx - node.x) * GRAVITY;
    const fy = forces[i * 2 + 1] + (cy - node.y) * GRAVITY;
    node.vx = (node.vx + fx) * DAMPING;
    node.vy = (node.vy + fy) * DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function kineticEnergy(nodes: GNode[]): number {
  let total = 0;
  for (const n of nodes) total += n.vx * n.vx + n.vy * n.vy;
  return total;
}

// ---- Canvas rendering ----

function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GNode[],
  edges: GEdge[],
  titles: Map<string, string>,
  hoveredId: string | null,
  transform: { x: number; y: number; scale: number },
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.scale, transform.scale);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const connectedToHovered = new Set<string>();

  if (hoveredId) {
    for (const e of edges) {
      if (e.source === hoveredId) connectedToHovered.add(e.target);
      else if (e.target === hoveredId) connectedToHovered.add(e.source);
    }
  }

  const hasHover = hoveredId !== null;

  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;

    const isActive =
      !hasHover || edge.source === hoveredId || edge.target === hoveredId;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isActive
      ? 'rgba(59, 130, 246, 0.45)'
      : 'rgba(156, 163, 175, 0.2)';
    ctx.lineWidth = isActive ? 1.5 : 1;
    ctx.stroke();
  }

  for (const node of nodes) {
    const r = nodeRadius(node.degree);
    const isHovered = node.id === hoveredId;
    const isConnected = connectedToHovered.has(node.id);
    const isDimmed = hasHover && !isHovered && !isConnected;

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

    if (isHovered) ctx.fillStyle = '#2563EB';
    else if (isConnected) ctx.fillStyle = '#3B82F6';
    else if (isDimmed) ctx.fillStyle = 'rgba(156, 163, 175, 0.4)';
    else if (node.degree === 0) ctx.fillStyle = 'rgba(156, 163, 175, 0.7)';
    else ctx.fillStyle = '#60A5FA';

    ctx.fill();
    ctx.strokeStyle = isHovered
      ? '#1D4ED8'
      : isDimmed
        ? 'rgba(209, 213, 219, 0.4)'
        : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = isHovered ? 2 : 1.5;
    ctx.stroke();

    // Only label the hovered node; when idle, label nodes with connections
    const showLabel = isHovered || (!hasHover && node.degree >= 2);
    if (showLabel) {
      const title = titles.get(node.id) ?? 'Untitled';
      const truncated = title.length > 22 ? title.slice(0, 20) + '…' : title;
      ctx.fillStyle = isHovered
        ? 'rgba(29, 78, 216, 1)'
        : 'rgba(55, 65, 81, 1)';
      ctx.font = `${isHovered ? 600 : 400} ${isHovered ? 11.5 : 10.5}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(truncated, node.x, node.y + r + 3);
    }
  }

  ctx.restore();
}

function canvasToWorld(
  cx: number,
  cy: number,
  transform: { x: number; y: number; scale: number }
) {
  return {
    x: (cx - transform.x) / transform.scale,
    y: (cy - transform.y) / transform.scale,
  };
}

function hitTest(node: GNode, wx: number, wy: number): boolean {
  const r = nodeRadius(node.degree) + 4;
  const dx = node.x - wx;
  const dy = node.y - wy;
  return dx * dx + dy * dy <= r * r;
}

// ---- Preview card sub-components ----

const PreviewSummary = memo(function PreviewSummary({
  docId,
}: {
  docId: string;
}) {
  const docSummaryService = useService(DocSummaryService);
  const summary = useLiveData(
    useMemo(
      () => LiveData.from(docSummaryService.watchDocSummary(docId), null),
      [docSummaryService, docId]
    )
  );

  if (summary === null) {
    return <div className={styles.previewBodyEmpty}>Loading…</div>;
  }
  if (summary === '') {
    return <div className={styles.previewBodyEmpty}>No content yet</div>;
  }
  return <div className={styles.previewBody}>{summary}</div>;
});

// ---- Node preview card ----

const GraphNodePreview = memo(function GraphNodePreview({
  docId,
  screenX,
  screenY,
  containerW,
  isExiting,
}: {
  docId: string;
  screenX: number;
  screenY: number;
  containerW: number;
  isExiting: boolean;
  // screenY is in canvas-local coords (top-left origin)
}) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const docsService = useService(DocsService);

  const Icon = useLiveData(docDisplayMetaService.icon$(docId));
  const title = useLiveData(docDisplayMetaService.title$(docId));
  const doc = useLiveData(docsService.list.doc$(docId));
  const updatedAt = useLiveData(doc?.updatedAt$ ?? null);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null;
    return i18nTime(updatedAt, {
      relative: { max: [1, 'week'], accuracy: 'minute' },
      absolute: { accuracy: 'day' },
    });
  }, [updatedAt]);

  // screenY is the top edge of the node circle in canvas coords
  const CARD_W = 220;
  const CARD_H = 164; // fixed height — all cards are the same distance from node
  const GAP = 10;

  // Keep card within horizontal bounds
  const left = Math.min(
    Math.max(screenX - CARD_W / 2, 8),
    containerW - CARD_W - 8
  );

  // Show above node; flip below only if very close to top
  const flipDown = screenY < CARD_H + GAP + 8;
  const top = flipDown ? screenY + GAP : screenY - CARD_H - GAP;

  return (
    <div
      className={isExiting ? styles.previewCardExiting : styles.previewCard}
      style={{ left, top }}
    >
      <div className={styles.previewHeader}>
        <span className={styles.previewIcon}>{Icon ? <Icon /> : null}</span>
        <span className={styles.previewTitle}>{title || 'Untitled'}</span>
      </div>

      <div className={styles.previewDivider} />

      <PreviewSummary docId={docId} />

      <div className={styles.previewDivider} />
      <div className={styles.previewMeta}>
        <span className={styles.previewMetaItem}>
          {updatedLabel ? `Updated ${updatedLabel}` : ''}
        </span>
      </div>
    </div>
  );
});

// ---- Main component ----

export const DocsGraph = () => {
  const contextValue = useContext(DocExplorerContext);
  const groups = useLiveData(contextValue.groups$);
  const docsSearchService = useService(DocsSearchService);
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const workbenchService = useService(WorkbenchService);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const nodesRef = useRef<GNode[]>([]);
  const edgesRef = useRef<GEdge[]>([]);
  const titlesRef = useRef<Map<string, string>>(new Map());
  const hoveredIdRef = useRef<string | null>(null);

  // Preview state
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewPos, setPreviewPos] = useState({ x: 0, y: 0 });
  const [previewExiting, setPreviewExiting] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafRef = useRef<number>(0);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const draggedNodeRef = useRef<{ id: string; ox: number; oy: number } | null>(
    null
  );
  const simulatingRef = useRef(true);

  const docIds = useMemo(() => {
    const ids: string[] = (groups as Array<{ items: string[] }>).flatMap(
      g => g.items
    );
    return ids.slice(0, MAX_NODES);
  }, [groups]);

  // Initialize nodes when docIds change
  useEffect(() => {
    const existing = new Map(nodesRef.current.map(n => [n.id, n]));
    const w = canvasSize.w;
    const h = canvasSize.h;

    nodesRef.current = docIds.map((id, i): GNode => {
      const prev = existing.get(id);
      if (prev) return prev;
      const angle = (2 * Math.PI * i) / Math.max(docIds.length, 1);
      const radius = Math.min(w, h) * 0.28;
      return {
        id,
        x: w / 2 + radius * Math.cos(angle),
        y: h / 2 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        degree: 0,
      };
    });

    simulatingRef.current = true;
  }, [docIds, canvasSize.w, canvasSize.h]);

  // Subscribe to titles
  useEffect(() => {
    const subs = docIds.map(id =>
      docDisplayMetaService.title$(id).subscribe((title: string) => {
        titlesRef.current.set(id, title || 'Untitled');
      })
    );
    return () => subs.forEach(s => s.unsubscribe());
  }, [docIds, docDisplayMetaService]);

  // Fetch all workspace links
  useEffect(() => {
    if (docIds.length === 0) {
      edgesRef.current = [];
      return;
    }

    const sub = docsSearchService.indexer
      .search$(
        'block',
        { type: 'exists', field: 'refDocId' },
        { fields: ['docId', 'refDocId'], pagination: { limit: 2000 } }
      )
      .pipe(
        map(({ nodes }) => {
          const docIdSet = new Set(docIds);
          const edgeSet = new Map<string, GEdge>();

          for (const node of nodes) {
            const srcRaw = node.fields['docId'];
            const tgtRaw = node.fields['refDocId'];
            const src = Array.isArray(srcRaw) ? srcRaw[0] : srcRaw;
            if (!src || !docIdSet.has(src)) continue;

            const targets = Array.isArray(tgtRaw)
              ? tgtRaw
              : tgtRaw
                ? [tgtRaw]
                : [];

            for (const tgt of targets) {
              if (!tgt || src === tgt || !docIdSet.has(tgt)) continue;
              const key = src < tgt ? `${src}|${tgt}` : `${tgt}|${src}`;
              if (!edgeSet.has(key)) {
                edgeSet.set(key, { source: src, target: tgt });
              }
            }
          }

          return Array.from(edgeSet.values());
        })
      )
      .subscribe((edges: GEdge[]) => {
        edgesRef.current = edges;
        const degreeMap = new Map<string, number>();
        for (const e of edges) {
          degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
          degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
        }
        for (const node of nodesRef.current) {
          node.degree = degreeMap.get(node.id) ?? 0;
        }
        simulatingRef.current = true;
      });

    return () => sub.unsubscribe();
  }, [docIds, docsSearchService]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) {
        const { width, height } = e.contentRect;
        setCanvasSize({ w: Math.floor(width), h: Math.floor(height) });
        transformRef.current = { x: 0, y: 0, scale: 1 };
      }
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // RAF rendering + simulation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.scale(dpr, dpr);

    let running = true;
    let stepsWithoutMotion = 0;

    const loop = () => {
      if (!running) return;

      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const cx = canvasSize.w / 2;
      const cy = canvasSize.h / 2;

      if (simulatingRef.current) {
        const steps = stepsWithoutMotion < 5 ? 4 : 1;
        for (let s = 0; s < steps; s++) {
          const draggedId = draggedNodeRef.current?.id;
          const prevPos = draggedId
            ? (() => {
                const n = nodes.find(n => n.id === draggedId);
                return n ? { x: n.x, y: n.y } : null;
              })()
            : null;

          stepSimulation(nodes, edges, cx, cy);

          if (draggedId && prevPos) {
            const dn = nodes.find(n => n.id === draggedId);
            if (dn) {
              dn.x = prevPos.x;
              dn.y = prevPos.y;
              dn.vx = 0;
              dn.vy = 0;
            }
          }
        }

        const ke = kineticEnergy(nodes);
        if (ke < 0.05) {
          stepsWithoutMotion++;
          if (stepsWithoutMotion > 30) {
            simulatingRef.current = false;
            stepsWithoutMotion = 0;
          }
        } else {
          stepsWithoutMotion = 0;
        }
      }

      drawGraph(
        ctx,
        nodes,
        edges,
        titlesRef.current,
        hoveredIdRef.current,
        transformRef.current,
        canvasSize.w,
        canvasSize.h
      );

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [canvasSize]);

  // ---- Preview timing helpers ----

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const showPreview = useCallback(
    (id: string, sx: number, sy: number) => {
      clearExitTimer();
      setPreviewExiting(false);
      setPreviewDocId(id);
      setPreviewPos({ x: sx, y: sy });
    },
    [clearExitTimer]
  );

  const beginHidePreview = useCallback(() => {
    clearShowTimer();
    setPreviewExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setPreviewDocId(null);
      setPreviewExiting(false);
      exitTimerRef.current = null;
    }, 140);
  }, [clearShowTimer]);

  useEffect(() => {
    return () => {
      clearShowTimer();
      clearExitTimer();
    };
  }, [clearShowTimer, clearExitTimer]);

  // ---- Interaction helpers ----

  const getNodeScreenPos = useCallback((node: GNode) => {
    const t = transformRef.current;
    return {
      sx: node.x * t.scale + t.x,
      sy: node.y * t.scale + t.y,
      // top edge of the circle in screen coords
      syTop: (node.y - nodeRadius(node.degree)) * t.scale + t.y,
    };
  }, []);

  const getHoveredNode = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const world = canvasToWorld(cx, cy, transformRef.current);
      return nodesRef.current.find(n => hitTest(n, world.x, world.y)) ?? null;
    },
    []
  );

  // Stable refs for preview callbacks (to avoid stale closures in mousemove)
  const previewDocIdRef = useRef<string | null>(null);
  useEffect(() => {
    previewDocIdRef.current = previewDocId;
  }, [previewDocId]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.mx;
        const dy = e.clientY - panStartRef.current.my;
        transformRef.current = {
          ...transformRef.current,
          x: panStartRef.current.tx + dx,
          y: panStartRef.current.ty + dy,
        };
        return;
      }

      if (draggedNodeRef.current) {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const world = canvasToWorld(cx, cy, transformRef.current);
        const dragged = draggedNodeRef.current;
        const node = nodesRef.current.find(n => n.id === dragged.id);
        if (node) {
          node.x = world.x + draggedNodeRef.current.ox;
          node.y = world.y + draggedNodeRef.current.oy;
          node.vx = 0;
          node.vy = 0;
          simulatingRef.current = true;
        }
        return;
      }

      const hovered = getHoveredNode(e);
      const id = hovered?.id ?? null;
      hoveredIdRef.current = id;

      if (id && hovered) {
        const { sx, syTop } = getNodeScreenPos(hovered);
        const currentPreview = previewDocIdRef.current;

        if (currentPreview === id) {
          // Same node — cancel any pending hide, keep card visible
          clearShowTimer();
          clearExitTimer();
          setPreviewExiting(false);
          setPreviewPos({ x: sx, y: syTop });
        } else if (currentPreview !== null) {
          // Different node while one is showing — quick swap
          clearShowTimer();
          setPreviewExiting(true);
          clearExitTimer();
          showTimerRef.current = setTimeout(() => {
            showTimerRef.current = null;
            showPreview(id, sx, syTop);
          }, 180);
        } else {
          // No preview yet — show after comfortable delay
          clearShowTimer();
          showTimerRef.current = setTimeout(() => {
            showTimerRef.current = null;
            showPreview(id, sx, syTop);
          }, 450);
        }
      } else {
        // Left all nodes
        clearShowTimer();
        if (previewDocIdRef.current !== null) {
          beginHidePreview();
        }
      }
    },
    [
      getHoveredNode,
      getNodeScreenPos,
      clearShowTimer,
      clearExitTimer,
      showPreview,
      beginHidePreview,
    ]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const hovered = getHoveredNode(e);
      if (hovered && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const world = canvasToWorld(cx, cy, transformRef.current);
        draggedNodeRef.current = {
          id: hovered.id,
          ox: hovered.x - world.x,
          oy: hovered.y - world.y,
        };
      } else {
        isPanningRef.current = true;
        panStartRef.current = {
          mx: e.clientX,
          my: e.clientY,
          tx: transformRef.current.x,
          ty: transformRef.current.y,
        };
      }
    },
    [getHoveredNode]
  );

  const handleMouseUp = useCallback(() => {
    if (draggedNodeRef.current) {
      simulatingRef.current = true;
      draggedNodeRef.current = null;
    }
    isPanningRef.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const hovered = getHoveredNode(e);
      if (hovered) {
        workbenchService.workbench.openDoc(hovered.id);
      }
    },
    [getHoveredNode, workbenchService]
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const t = transformRef.current;
    const newScale = Math.min(Math.max(t.scale * factor, 0.2), 4);
    const ratio = newScale / t.scale;
    transformRef.current = {
      x: cx - (cx - t.x) * ratio,
      y: cy - (cy - t.y) * ratio,
      scale: newScale,
    };
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredIdRef.current = null;
    clearShowTimer();
    if (previewDocIdRef.current !== null) {
      beginHidePreview();
    }
    isPanningRef.current = false;
    draggedNodeRef.current = null;
  }, [clearShowTimer, beginHidePreview]);

  if (docIds.length === 0) {
    return (
      <div ref={containerRef} className={styles.container}>
        <div className={styles.emptyState}>No documents to display</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseLeave={handleMouseLeave}
      />

      {previewDocId !== null && (
        <GraphNodePreview
          key={previewDocId}
          docId={previewDocId}
          screenX={previewPos.x}
          screenY={previewPos.y}
          containerW={canvasSize.w}
          isExiting={previewExiting}
        />
      )}
    </div>
  );
};
