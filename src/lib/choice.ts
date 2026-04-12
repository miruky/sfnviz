// Choice状態の規則評価。データテスト式(比較)とブール式(And / Or / Not)を扱う。

import { getPath, type Json } from './jsonpath';

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function toTime(value: Json): number | undefined {
  if (typeof value !== 'string') return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

type Test = (actual: Json | undefined, expected: Json) => boolean;

const numberCmp =
  (cmp: (a: number, b: number) => boolean): Test =>
  (actual, expected) =>
    typeof actual === 'number' && typeof expected === 'number' && cmp(actual, expected);

const stringCmp =
  (cmp: (a: string, b: string) => boolean): Test =>
  (actual, expected) =>
    typeof actual === 'string' && typeof expected === 'string' && cmp(actual, expected);

const timeCmp =
  (cmp: (a: number, b: number) => boolean): Test =>
  (actual, expected) => {
    const a = toTime(actual ?? null);
    const b = toTime(expected);
    return a !== undefined && b !== undefined && cmp(a, b);
  };

const TESTS: Record<string, Test> = {
  StringEquals: stringCmp((a, b) => a === b),
  StringLessThan: stringCmp((a, b) => a < b),
  StringGreaterThan: stringCmp((a, b) => a > b),
  StringLessThanEquals: stringCmp((a, b) => a <= b),
  StringGreaterThanEquals: stringCmp((a, b) => a >= b),
  StringMatches: stringCmp((a, b) => wildcardMatch(b, a)),
  NumericEquals: numberCmp((a, b) => a === b),
  NumericLessThan: numberCmp((a, b) => a < b),
  NumericGreaterThan: numberCmp((a, b) => a > b),
  NumericLessThanEquals: numberCmp((a, b) => a <= b),
  NumericGreaterThanEquals: numberCmp((a, b) => a >= b),
  BooleanEquals: (actual, expected) => typeof actual === 'boolean' && actual === expected,
  TimestampEquals: timeCmp((a, b) => a === b),
  TimestampLessThan: timeCmp((a, b) => a < b),
  TimestampGreaterThan: timeCmp((a, b) => a > b),
  TimestampLessThanEquals: timeCmp((a, b) => a <= b),
  TimestampGreaterThanEquals: timeCmp((a, b) => a >= b),
  IsNull: (actual, expected) => (actual === null) === expected,
  IsPresent: (actual, expected) => (actual !== undefined) === expected,
  IsNumeric: (actual, expected) => (typeof actual === 'number') === expected,
  IsString: (actual, expected) => (typeof actual === 'string') === expected,
  IsBoolean: (actual, expected) => (typeof actual === 'boolean') === expected,
  IsTimestamp: (actual, expected) => (toTime(actual ?? null) !== undefined) === expected,
};

function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 1つのChoice規則を入力に対して評価する。未対応の演算子は false。 */
export function evaluateRule(rule: Json, input: Json): boolean {
  if (!isObject(rule)) return false;
  if (Array.isArray(rule.And)) return rule.And.every((r) => evaluateRule(r, input));
  if (Array.isArray(rule.Or)) return rule.Or.some((r) => evaluateRule(r, input));
  if (rule.Not !== undefined) return !evaluateRule(rule.Not, input);

  const variable = rule.Variable;
  if (typeof variable !== 'string') return false;
  const actual = getPath(input, variable);

  for (const [key, expected] of Object.entries(rule)) {
    if (key === 'Variable' || key === 'Next' || key === 'Comment') continue;
    // 〜Path 演算子は比較対象も入力から取り出す
    if (key.endsWith('Path') && typeof expected === 'string') {
      const test = TESTS[key.slice(0, -4)];
      if (!test) return false;
      const resolved = getPath(input, expected);
      return resolved === undefined ? false : test(actual, resolved);
    }
    const test = TESTS[key];
    return test ? test(actual, expected) : false;
  }
  return false;
}
