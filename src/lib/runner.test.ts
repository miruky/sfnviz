import { describe, it, expect } from 'vitest';
import { parseAsl, type Machine } from './asl';
import { simulate } from './runner';
import { EXAMPLES } from './examples';

function machineOf(def: unknown): Machine {
  const { machine, errors } = parseAsl(JSON.stringify(def));
  expect(errors).toEqual([]);
  if (!machine) throw new Error('parse failed');
  return machine;
}

describe('simulate', () => {
  it('Passのデータ加工(Result / ResultPath / OutputPath)を再現する', () => {
    const machine = machineOf({
      StartAt: 'Shape',
      States: {
        Shape: {
          Type: 'Pass',
          Result: { ok: true },
          ResultPath: '$.check',
          OutputPath: '$.check',
          End: true,
        },
      },
    });
    const result = simulate(machine, { id: 1 });
    expect(result.outcome).toBe('succeeded');
    expect(result.output).toEqual({ ok: true });
  });

  it('Taskはモック結果を使い、未設定なら入力を通す', () => {
    const machine = machineOf({
      StartAt: 'A',
      States: {
        A: { Type: 'Task', Resource: 'arn:x', ResultPath: '$.a', Next: 'B' },
        B: { Type: 'Task', Resource: 'arn:y', End: true },
      },
    });
    const result = simulate(machine, { seed: 1 }, { A: { value: 42 } });
    expect(result.outcome).toBe('succeeded');
    expect(result.steps[0]?.output).toEqual({ seed: 1, a: { value: 42 } });
    expect(result.steps[1]?.note).toContain('モック未設定');
  });

  it('Choiceは規則を評価して遷移する', () => {
    const machine = machineOf({
      StartAt: 'C',
      States: {
        C: {
          Type: 'Choice',
          Choices: [{ Variable: '$.n', NumericGreaterThan: 10, Next: 'Big' }],
          Default: 'Small',
        },
        Big: { Type: 'Succeed' },
        Small: { Type: 'Succeed' },
      },
    });
    expect(simulate(machine, { n: 100 }).steps[0]?.next).toBe('Big');
    expect(simulate(machine, { n: 1 }).steps[0]?.next).toBe('Small');
  });

  it('モックエラーをCatchで拾い、エラー情報をResultPathへ置く', () => {
    const machine = machineOf({
      StartAt: 'T',
      States: {
        T: {
          Type: 'Task',
          Resource: 'arn:x',
          Catch: [{ ErrorEquals: ['Boom'], ResultPath: '$.error', Next: 'Recover' }],
          Next: 'Done',
        },
        Recover: { Type: 'Succeed' },
        Done: { Type: 'Succeed' },
      },
    });
    const result = simulate(machine, { id: 1 }, { T: { $error: 'Boom', $cause: 'test' } });
    expect(result.outcome).toBe('succeeded');
    expect(result.steps[0]?.status).toBe('caught');
    expect(result.steps[0]?.next).toBe('Recover');
    expect(result.output).toEqual({ id: 1, error: { Error: 'Boom', Cause: 'test' } });
  });

  it('キャッチされないエラーは実行失敗になる', () => {
    const machine = machineOf({
      StartAt: 'T',
      States: { T: { Type: 'Task', Resource: 'arn:x', End: true } },
    });
    const result = simulate(machine, {}, { T: { $error: 'Boom' } });
    expect(result.outcome).toBe('failed');
    expect(result.error?.error).toBe('Boom');
  });

  it('Failは指定したエラーで終了する', () => {
    const machine = machineOf({
      StartAt: 'F',
      States: { F: { Type: 'Fail', Error: 'Custom', Cause: 'reason' } },
    });
    const result = simulate(machine, {});
    expect(result.outcome).toBe('failed');
    expect(result.error).toEqual({ error: 'Custom', cause: 'reason' });
  });

  it('Parallelは各ブランチの結果を配列にまとめる', () => {
    const machine = machineOf({
      StartAt: 'P',
      States: {
        P: {
          Type: 'Parallel',
          Branches: [
            { StartAt: 'X', States: { X: { Type: 'Task', Resource: 'arn:x', End: true } } },
            { StartAt: 'Y', States: { Y: { Type: 'Task', Resource: 'arn:y', End: true } } },
          ],
          End: true,
        },
      },
    });
    const result = simulate(machine, { in: 1 }, { X: { x: 1 }, Y: { y: 2 } });
    expect(result.output).toEqual([{ x: 1 }, { y: 2 }]);
    expect(result.steps.map((s) => s.state)).toEqual(['P', 'X', 'Y']);
    expect(result.steps[1]?.path).toEqual(['P branch 0']);
  });

  it('MapはItemsPathの各要素を処理する', () => {
    const machine = machineOf({
      StartAt: 'M',
      States: {
        M: {
          Type: 'Map',
          ItemsPath: '$.items',
          ItemProcessor: {
            StartAt: 'Each',
            States: { Each: { Type: 'Pass', End: true } },
          },
          ResultPath: '$.results',
          End: true,
        },
      },
    });
    const result = simulate(machine, { items: [1, 2, 3] });
    expect(result.outcome).toBe('succeeded');
    expect(result.output).toEqual({ items: [1, 2, 3], results: [1, 2, 3] });
    expect(result.steps[0]?.note).toContain('3件');
  });

  it('無限ループはステップ上限で止める', () => {
    const machine = machineOf({
      StartAt: 'A',
      States: {
        A: { Type: 'Pass', Next: 'B' },
        B: { Type: 'Pass', Next: 'A' },
      },
    });
    const result = simulate(machine, {});
    expect(result.outcome).toBe('failed');
    expect(result.error?.error).toBe('Sim.MaxSteps');
  });

  it('サンプルがすべて実行できる', () => {
    for (const example of EXAMPLES) {
      const { machine } = parseAsl(example.asl);
      if (!machine) throw new Error('parse failed');
      const result = simulate(machine, JSON.parse(example.input), JSON.parse(example.mocks));
      expect(result.steps.length).toBeGreaterThan(0);
      expect(['succeeded', 'failed']).toContain(result.outcome);
    }
  });

  it('注文サンプルは支払い拒否がキャッチされ注文失敗で終わる', () => {
    const example = EXAMPLES.find((e) => e.id === 'order');
    if (!example) throw new Error('missing');
    const { machine } = parseAsl(example.asl);
    if (!machine) throw new Error('parse failed');
    const result = simulate(machine, JSON.parse(example.input), JSON.parse(example.mocks));
    expect(result.outcome).toBe('failed');
    expect(result.error?.error).toBe('OrderFailed');
    const caught = result.steps.find((s) => s.status === 'caught');
    expect(caught?.state).toBe('支払い実行');
  });
});
