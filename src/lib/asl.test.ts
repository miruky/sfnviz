import { describe, it, expect } from 'vitest';
import { parseAsl, machineEdges, summarizeRule } from './asl';
import { EXAMPLES } from './examples';

const minimal = (states: Record<string, unknown>, startAt = Object.keys(states)[0]) =>
  JSON.stringify({ StartAt: startAt, States: states });

describe('parseAsl', () => {
  it('最小のステートマシンを解析する', () => {
    const { machine, errors } = parseAsl(minimal({ Done: { Type: 'Succeed' } }));
    expect(errors).toEqual([]);
    expect(machine?.startAt).toBe('Done');
    expect(machine?.states.get('Done')?.type).toBe('Succeed');
  });

  it('Choice・Catch・Parallel・Mapを読み取る', () => {
    for (const example of EXAMPLES) {
      const { machine, errors } = parseAsl(example.asl);
      expect(errors).toEqual([]);
      expect(machine).toBeDefined();
    }
  });

  it('壊れたJSONを報告する', () => {
    expect(parseAsl('{').errors[0]).toContain('JSONとして解析できない');
  });

  it('StartAtの欠落・不一致を報告する', () => {
    expect(parseAsl(JSON.stringify({ States: { A: { Type: 'Succeed' } } })).errors[0]).toContain(
      'StartAt',
    );
    const { errors } = parseAsl(
      JSON.stringify({ StartAt: 'Nope', States: { A: { Type: 'Succeed' } } }),
    );
    expect(errors[0]).toContain('Nope');
  });

  it('NextとEndの矛盾を報告する', () => {
    const missing = parseAsl(minimal({ A: { Type: 'Pass' } }));
    expect(missing.errors[0]).toContain('Next か End');
    const both = parseAsl(minimal({ A: { Type: 'Pass', Next: 'A', End: true } }));
    expect(both.errors[0]).toContain('同時に指定できない');
  });

  it('存在しない遷移先を報告する', () => {
    const { errors } = parseAsl(minimal({ A: { Type: 'Pass', Next: 'Ghost' } }));
    expect(errors[0]).toContain('Ghost');
  });

  it('未知のTypeを報告する', () => {
    const { errors } = parseAsl(minimal({ A: { Type: 'Magic' } }));
    expect(errors[0]).toContain('Type');
  });

  it('ブランチ内のエラーも場所つきで報告する', () => {
    const { errors } = parseAsl(
      minimal({
        P: {
          Type: 'Parallel',
          End: true,
          Branches: [{ StartAt: 'X', States: { X: { Type: 'Pass' } } }],
        },
      }),
    );
    expect(errors[0]).toContain('P branch[0]');
  });
});

describe('machineEdges', () => {
  it('Next・Choice・Default・Catchの辺を抽出する', () => {
    const { machine } = parseAsl(EXAMPLES[0]?.asl ?? '');
    if (!machine) throw new Error('parse failed');
    const edges = machineEdges(machine);
    const kinds = new Set(edges.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['next', 'choice', 'default', 'catch']));
    expect(edges).toContainEqual({
      from: '支払い実行',
      to: '注文失敗',
      kind: 'catch',
      label: 'PaymentDeclined',
    });
  });
});

describe('summarizeRule', () => {
  it('比較規則を1行に要約する', () => {
    expect(summarizeRule({ Variable: '$.n', NumericGreaterThan: 0, Next: 'X' })).toBe(
      '$.n NumericGreaterThan 0',
    );
    expect(summarizeRule({ And: [{}, {}], Next: 'X' })).toBe('And(2)');
  });
});
