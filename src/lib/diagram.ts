// ステートマシンを上から下へ流れるSVGへ描く。Parallel / Mapは入れ子の枠として
// 再帰的にレイアウトする。ループ(上方向への遷移)は左側を回る曲線で描く。

import { machineEdges, type Edge, type Machine, type StateNode } from './asl';

export const NODE_W = 180;
export const NODE_H = 56;
const GAP_Y = 56;
const GAP_X = 36;
const PAD = 22;

interface Box {
  node: StateNode;
  x: number;
  y: number;
  w: number;
  h: number;
  children: Layout[];
}

export interface Layout {
  boxes: Map<string, Box>;
  rows: string[][];
  width: number;
  height: number;
}

const TYPE_COLORS: Record<StateNode['type'], string> = {
  Task: '#3b66db',
  Pass: '#5f7385',
  Choice: '#b06f15',
  Wait: '#7d4fbe',
  Succeed: '#2e8b57',
  Fail: '#b04040',
  Parallel: '#0e8c85',
  Map: '#0e8c85',
};

function sizeOf(node: StateNode): { w: number; h: number; children: Layout[] } {
  if (node.branches.length === 0) return { w: NODE_W, h: NODE_H, children: [] };
  const children = node.branches.map((branch) => layoutMachine(branch));
  const w = Math.max(
    NODE_W,
    children.reduce((sum, c) => sum + c.width, 0) + GAP_X * (children.length - 1) + PAD * 2,
  );
  const h = Math.max(...children.map((c) => c.height)) + NODE_H + PAD * 2;
  return { w, h, children };
}

/** BFSで行(深さ)を決め、行内は中央寄せで横に並べる。 */
export function layoutMachine(machine: Machine): Layout {
  const depth = new Map<string, number>();
  const queue: { name: string; d: number }[] = [{ name: machine.startAt, d: 0 }];
  const edges = machineEdges(machine);
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  while (queue.length > 0) {
    const { name, d } = queue.shift() as { name: string; d: number };
    if (depth.has(name)) continue;
    depth.set(name, d);
    for (const next of out.get(name) ?? []) {
      if (!depth.has(next)) queue.push({ name: next, d: d + 1 });
    }
  }
  // 到達不能な状態も末尾の行に置いて見えるようにする
  let maxDepth = Math.max(0, ...depth.values());
  for (const name of machine.states.keys()) {
    if (!depth.has(name)) {
      maxDepth += 1;
      depth.set(name, maxDepth);
    }
  }

  const rows: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [name, d] of depth) (rows[d] as string[]).push(name);

  const sizes = new Map(
    [...machine.states.values()].map((node) => [node.name, sizeOf(node)] as const),
  );
  const rowWidth = (row: string[]) =>
    row.reduce((sum, name) => sum + (sizes.get(name)?.w ?? NODE_W), 0) + GAP_X * (row.length - 1);
  const width = Math.max(...rows.map(rowWidth), NODE_W) + PAD * 2;

  const boxes = new Map<string, Box>();
  let y = PAD;
  for (const row of rows) {
    const rowH = Math.max(...row.map((name) => sizes.get(name)?.h ?? NODE_H), NODE_H);
    let x = (width - rowWidth(row)) / 2;
    for (const name of row) {
      const node = machine.states.get(name) as StateNode;
      const size = sizes.get(name) as { w: number; h: number; children: Layout[] };
      boxes.set(name, { node, x, y, w: size.w, h: size.h, children: size.children });
      x += size.w + GAP_X;
    }
    y += rowH + GAP_Y;
  }
  return { boxes, rows, width, height: y - GAP_Y + PAD };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function edgePath(layout: Layout, edge: Edge): string {
  const from = layout.boxes.get(edge.from);
  const to = layout.boxes.get(edge.to);
  if (!from || !to) return '';
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y - 4;
  if (y2 > y1) {
    const mid = (y1 + y2) / 2;
    return `M${x1} ${y1} C${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  }
  // 上方向(ループ)は左の余白を回す
  const left = Math.min(from.x, to.x) - 28;
  return `M${from.x} ${from.y + from.h / 2} C${left} ${from.y + from.h / 2}, ${left} ${to.y + to.h / 2}, ${to.x - 4} ${to.y + to.h / 2}`;
}

function nodeSvg(
  box: Box,
  qualify: (name: string) => string,
  offsetX: number,
  offsetY: number,
): string {
  const { node } = box;
  const x = box.x + offsetX;
  const y = box.y + offsetY;
  const color = TYPE_COLORS[node.type];
  const id = qualify(node.name);
  const parts: string[] = [];
  parts.push(
    `<g class="state" data-id="${esc(id)}" tabindex="0" aria-label="${esc(node.name)} (${node.type})">` +
      `<rect class="state-card" x="${x}" y="${y}" width="${box.w}" height="${box.children.length > 0 ? box.h : NODE_H}" rx="10" stroke="${color}" fill="${color}"/>` +
      `<text class="state-name" x="${x + box.w / 2}" y="${y + 24}" text-anchor="middle">${esc(clip(node.name, 22))}</text>` +
      `<text class="state-type" x="${x + box.w / 2}" y="${y + 42}" text-anchor="middle">${node.type}</text>` +
      `<title>${esc(node.name)} (${node.type})</title></g>`,
  );
  if (box.children.length > 0) {
    let childX =
      x +
      (box.w -
        (box.children.reduce((s, c) => s + c.width, 0) + GAP_X * (box.children.length - 1))) /
        2;
    for (const [i, child] of box.children.entries()) {
      const label = node.type === 'Map' ? 'processor' : `branch ${i}`;
      parts.push(
        renderFlow(child, (name) => `${id}/${label}/${name}`, childX, y + NODE_H + PAD / 2),
      );
      childX += child.width + GAP_X;
    }
  }
  return parts.join('\n');
}

function renderFlow(
  layout: Layout,
  qualify: (name: string) => string,
  offsetX: number,
  offsetY: number,
): string {
  const machineOfLayout = [...layout.boxes.values()];
  const edges = machineEdgesFromBoxes(layout);
  const edgeSvg = edges
    .map((e) => {
      const d = edgePath(layout, e);
      if (d === '') return '';
      const label = e.label
        ? (() => {
            const from = layout.boxes.get(e.from) as Box;
            const to = layout.boxes.get(e.to) as Box;
            const fromCx = from.x + from.w / 2;
            const toCx = to.x + to.w / 2;
            // 分岐が同じ点から扇状に出ると中点ではラベルが重なるので、行き先寄りに置いて散らす
            const lx = fromCx * 0.35 + toCx * 0.65 + offsetX;
            const ly = (from.y + from.h + to.y) / 2 + offsetY;
            return `<text class="edge-label ${e.kind}" x="${lx}" y="${ly}" text-anchor="middle">${esc(clip(e.label, 24))}</text>`;
          })()
        : '';
      return `<g transform="translate(${offsetX} ${offsetY})"><path class="edge ${e.kind}" d="${d}" marker-end="url(#sfn-arrow)"/></g>${label}`;
    })
    .join('\n  ');
  const nodeSvgs = machineOfLayout
    .map((box) => nodeSvg(box, qualify, offsetX, offsetY))
    .join('\n  ');
  return `${edgeSvg}\n  ${nodeSvgs}`;
}

function machineEdgesFromBoxes(layout: Layout): Edge[] {
  const pseudo: Machine = {
    startAt: '',
    states: new Map([...layout.boxes.values()].map((b) => [b.node.name, b.node])),
  };
  return machineEdges(pseudo);
}

/** ステートマシン全体をSVG文字列へ描く。data-idは入れ子をスラッシュで表す。 */
export function renderDiagram(machine: Machine): { svg: string; layout: Layout } {
  const layout = layoutMachine(machine);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="sfn" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="ステートマシンの遷移図">
  <title>ステートマシンの遷移図</title>
  <defs>
    <marker id="sfn-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path class="arrow-head" d="M0 0L8 4L0 8z"/>
    </marker>
  </defs>
  ${renderFlow(layout, (name) => name, 0, 0)}
</svg>`;
  return { svg, layout };
}
