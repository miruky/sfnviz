import { describe, it, expect } from 'vitest';
import { parseAsl } from './asl';
import { layoutMachine, renderDiagram, NODE_H } from './diagram';
import { EXAMPLES } from './examples';

function machineOf(source: string) {
  const { machine, errors } = parseAsl(source);
  expect(errors).toEqual([]);
  if (!machine) throw new Error('parse failed');
  return machine;
}

describe('layoutMachine', () => {
  it('遷移の深さで行を分ける', () => {
    const machine = machineOf(
      JSON.stringify({
        StartAt: 'A',
        States: {
          A: { Type: 'Pass', Next: 'B' },
          B: { Type: 'Pass', Next: 'C' },
          C: { Type: 'Succeed' },
        },
      }),
    );
    const layout = layoutMachine(machine);
    const a = layout.boxes.get('A');
    const b = layout.boxes.get('B');
    const c = layout.boxes.get('C');
    expect((a?.y ?? 0) < (b?.y ?? 0) && (b?.y ?? 0) < (c?.y ?? 0)).toBe(true);
  });

  it('Choiceの分岐は同じ行に横並びになる', () => {
    const machine = machineOf(
      JSON.stringify({
        StartAt: 'C',
        States: {
          C: {
            Type: 'Choice',
            Choices: [{ Variable: '$.x', BooleanEquals: true, Next: 'L' }],
            Default: 'R',
          },
          L: { Type: 'Succeed' },
          R: { Type: 'Succeed' },
        },
      }),
    );
    const layout = layoutMachine(machine);
    expect(layout.boxes.get('L')?.y).toBe(layout.boxes.get('R')?.y);
    expect(layout.boxes.get('L')?.x).not.toBe(layout.boxes.get('R')?.x);
  });

  it('Parallelノードはブランチを含む高さになる', () => {
    const machine = machineOf(EXAMPLES.find((e) => e.id === 'fanout')?.asl ?? '');
    const layout = layoutMachine(machine);
    const p = layout.boxes.get('集計');
    expect(p?.h ?? 0).toBeGreaterThan(NODE_H);
    expect(p?.children).toHaveLength(2);
  });
});

describe('renderDiagram', () => {
  it('全状態のノードと遷移の辺を含むSVGを生成する', () => {
    const machine = machineOf(EXAMPLES.find((e) => e.id === 'order')?.asl ?? '');
    const { svg } = renderDiagram(machine);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('data-id="在庫確認"');
    expect(svg).toContain('class="edge catch"');
    expect(svg).toContain('class="edge choice"');
    expect(svg).toContain('default');
  });

  it('入れ子のブランチはスラッシュつきdata-idになる', () => {
    const machine = machineOf(EXAMPLES.find((e) => e.id === 'fanout')?.asl ?? '');
    const { svg } = renderDiagram(machine);
    expect(svg).toContain('data-id="集計/branch 0/売上集計"');
    expect(svg).toContain('data-id="集計/branch 1/在庫集計"');
  });

  it('XML特殊文字をエスケープする', () => {
    const machine = machineOf(
      JSON.stringify({
        StartAt: 'A<B>&"C"',
        States: { 'A<B>&"C"': { Type: 'Succeed' } },
      }),
    );
    const { svg } = renderDiagram(machine);
    expect(svg).toContain('A&lt;B&gt;&amp;&quot;C&quot;');
    expect(svg).not.toContain('data-id="A<');
  });

  it('ループ(上方向の遷移)も描ける', () => {
    const machine = machineOf(EXAMPLES.find((e) => e.id === 'batch')?.asl ?? '');
    const { svg, layout } = renderDiagram(machine);
    expect(svg).toContain('data-id="待機"');
    const wait = layout.boxes.get('待機');
    const check = layout.boxes.get('状況確認');
    expect(wait?.y ?? 0).toBeGreaterThan(check?.y ?? 0);
  });
});
