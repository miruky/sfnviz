import { describe, it, expect } from 'vitest';
import { evaluateRule } from './choice';
import type { Json } from './jsonpath';

describe('evaluateRule', () => {
  const input = { status: 'paid', amount: 120, vip: true, when: '2026-06-01T00:00:00Z', tag: null };

  it('文字列・数値・真偽値の比較', () => {
    expect(evaluateRule({ Variable: '$.status', StringEquals: 'paid' }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.amount', NumericGreaterThan: 100 }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.amount', NumericLessThanEquals: 100 }, input)).toBe(false);
    expect(evaluateRule({ Variable: '$.vip', BooleanEquals: true }, input)).toBe(true);
  });

  it('StringMatches はワイルドカードを使える', () => {
    expect(evaluateRule({ Variable: '$.status', StringMatches: 'pa*' }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.status', StringMatches: 'un*' }, input)).toBe(false);
  });

  it('Timestamp比較はISO 8601を解釈する', () => {
    expect(
      evaluateRule({ Variable: '$.when', TimestampLessThan: '2026-12-31T00:00:00Z' }, input),
    ).toBe(true);
  });

  it('型が合わなければ false(エラーにしない)', () => {
    expect(evaluateRule({ Variable: '$.status', NumericEquals: 1 }, input)).toBe(false);
    expect(evaluateRule({ Variable: '$.missing', StringEquals: 'x' }, input)).toBe(false);
  });

  it('存在・型のテスト', () => {
    expect(evaluateRule({ Variable: '$.tag', IsNull: true }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.missing', IsPresent: false }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.amount', IsNumeric: true }, input)).toBe(true);
    expect(evaluateRule({ Variable: '$.when', IsTimestamp: true }, input)).toBe(true);
  });

  it('And / Or / Not の組み合わせ', () => {
    const rule: Json = {
      And: [
        { Variable: '$.status', StringEquals: 'paid' },
        {
          Or: [
            { Variable: '$.amount', NumericGreaterThan: 1000 },
            { Variable: '$.vip', BooleanEquals: true },
          ],
        },
        { Not: { Variable: '$.status', StringEquals: 'cancelled' } },
      ],
    };
    expect(evaluateRule(rule, input)).toBe(true);
  });

  it('〜Path演算子は比較対象も入力から取る', () => {
    expect(
      evaluateRule(
        { Variable: '$.amount', NumericGreaterThanPath: '$.limit' },
        { amount: 5, limit: 3 },
      ),
    ).toBe(true);
    expect(
      evaluateRule({ Variable: '$.amount', NumericGreaterThanPath: '$.none' }, { amount: 5 }),
    ).toBe(false);
  });

  it('未対応の演算子は false', () => {
    expect(evaluateRule({ Variable: '$.x', SomethingNew: 1 }, { x: 1 })).toBe(false);
  });
});
