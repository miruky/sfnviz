// ステートマシンのシミュレータ。実AWSを呼ばずに遷移とデータの流れを再現する。
// Taskはモック結果(またはモックエラー)で置き換え、各ステップの入出力をトレースに残す。

import type { Machine, StateNode } from './asl';
import { evaluateRule } from './choice';
import { applyTemplate, getPath, setPath, type Json } from './jsonpath';

export interface MockError {
  error: string;
  cause?: string;
}

/** 状態名 → モック結果。{"$error": "..."} 形式はエラーを投げるモックになる。 */
export type TaskMocks = Record<string, Json>;

export interface TraceStep {
  state: string;
  type: StateNode['type'];
  /** ネストした実行の所在(例: ["集計", "branch 1"]) */
  path: string[];
  input: Json;
  output?: Json;
  next?: string;
  status: 'ok' | 'caught' | 'failed' | 'succeeded';
  note?: string;
}

export interface RunResult {
  steps: TraceStep[];
  outcome: 'succeeded' | 'failed' | 'stopped';
  output?: Json;
  error?: MockError;
}

const MAX_STEPS = 300;

class SimError extends Error {
  constructor(public info: MockError) {
    super(info.error);
  }
}

function mockFor(mocks: TaskMocks, state: string): { result?: Json; error?: MockError } {
  if (!(state in mocks)) return {};
  const value = mocks[state] as Json;
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && '$error' in value) {
    const obj = value as { [key: string]: Json };
    return {
      error: {
        error: String(obj.$error),
        cause: typeof obj.$cause === 'string' ? obj.$cause : undefined,
      },
    };
  }
  return { result: value };
}

function catchMatches(rule: string[], error: string): boolean {
  return rule.includes('States.ALL') || rule.includes(error);
}

interface Context {
  steps: TraceStep[];
  mocks: TaskMocks;
  count: number;
}

function effectiveInput(node: StateNode, input: Json): Json {
  const inputPath = node.raw.InputPath;
  let value: Json = input;
  if (inputPath === null) value = {};
  else if (typeof inputPath === 'string') value = (getPath(input, inputPath) ?? null) as Json;
  const params = node.raw.Parameters ?? node.raw.ItemSelector;
  if (params !== undefined && node.type !== 'Map') value = applyTemplate(params as Json, value);
  return value;
}

function applyResult(node: StateNode, rawInput: Json, result: Json): Json {
  let shaped = result;
  const selector = node.raw.ResultSelector;
  if (selector !== undefined) shaped = applyTemplate(selector as Json, shaped);
  const resultPath = node.raw.ResultPath;
  let merged: Json;
  if (resultPath === null) merged = rawInput;
  else if (typeof resultPath === 'string') merged = setPath(rawInput, resultPath, shaped);
  else merged = shaped;
  const outputPath = node.raw.OutputPath;
  if (outputPath === null) return {};
  if (typeof outputPath === 'string') return (getPath(merged, outputPath) ?? null) as Json;
  return merged;
}

function runMachine(machine: Machine, input: Json, path: string[], ctx: Context): Json {
  let current = machine.startAt;
  let data = input;
  for (;;) {
    if (ctx.count >= MAX_STEPS) {
      throw new SimError({
        error: 'Sim.MaxSteps',
        cause: `${MAX_STEPS}ステップを超えた(無限ループの可能性)`,
      });
    }
    ctx.count += 1;
    const node = machine.states.get(current);
    if (!node) throw new SimError({ error: 'Sim.UnknownState', cause: current });

    const step: TraceStep = {
      state: node.name,
      type: node.type,
      path,
      input: data,
      status: 'ok',
    };
    ctx.steps.push(step);

    try {
      switch (node.type) {
        case 'Succeed': {
          step.status = 'succeeded';
          step.output = data;
          return data;
        }
        case 'Fail': {
          const error = typeof node.raw.Error === 'string' ? node.raw.Error : 'States.Fail';
          const cause = typeof node.raw.Cause === 'string' ? node.raw.Cause : undefined;
          throw new SimError({ error, cause });
        }
        case 'Choice': {
          const matched = node.choices?.find((c) => evaluateRule(c.rule, data));
          const next = matched?.next ?? node.default;
          if (next === undefined) {
            throw new SimError({
              error: 'States.NoChoiceMatched',
              cause: 'どの規則にも一致せずDefaultもない',
            });
          }
          step.note = matched ? `規則に一致` : 'Defaultへ';
          step.output = data;
          step.next = next;
          current = next;
          continue;
        }
        case 'Wait': {
          const seconds = node.raw.Seconds;
          step.note =
            typeof seconds === 'number'
              ? `${seconds}秒待機(シミュレーションでは省略)`
              : '待機を省略';
          step.output = data;
          break;
        }
        case 'Pass': {
          const effective = effectiveInput(node, data);
          const result = node.raw.Result !== undefined ? (node.raw.Result as Json) : effective;
          step.output = applyResult(node, data, result);
          break;
        }
        case 'Task': {
          const effective = effectiveInput(node, data);
          const mock = mockFor(ctx.mocks, node.name);
          if (mock.error) throw new SimError(mock.error);
          const result = mock.result !== undefined ? mock.result : effective;
          step.note =
            mock.result !== undefined ? 'モック結果を使用' : 'モック未設定のため入力をそのまま返す';
          step.output = applyResult(node, data, result);
          break;
        }
        case 'Parallel': {
          const effective = effectiveInput(node, data);
          const results = node.branches.map((branch, i) =>
            runMachine(branch, effective, [...path, `${node.name} branch ${i}`], ctx),
          );
          step.output = applyResult(node, data, results);
          break;
        }
        case 'Map': {
          const itemsPath = typeof node.raw.ItemsPath === 'string' ? node.raw.ItemsPath : '$';
          const items = getPath(data, itemsPath);
          if (!Array.isArray(items)) {
            throw new SimError({
              error: 'States.QueryEvaluationError',
              cause: `ItemsPath ${itemsPath} が配列を指していない`,
            });
          }
          const selector = node.raw.ItemSelector ?? node.raw.Parameters;
          const processor = node.branches[0];
          if (!processor) throw new SimError({ error: 'Sim.NoProcessor' });
          const results = items.map((item, i) => {
            const itemInput = selector !== undefined ? applyTemplate(selector as Json, item) : item;
            return runMachine(processor, itemInput, [...path, `${node.name} [${i}]`], ctx);
          });
          step.note = `${items.length}件を反復`;
          step.output = applyResult(node, data, results);
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof SimError)) throw e;
      const rule = node.catches.find((c) => catchMatches(c.errorEquals, e.info.error));
      if (!rule) {
        step.status = 'failed';
        step.note = `エラー ${e.info.error} はキャッチされない`;
        throw e;
      }
      const errorObject: Json = { Error: e.info.error, Cause: e.info.cause ?? '' };
      data = setPath(data, rule.resultPath ?? '$', errorObject);
      step.status = 'caught';
      step.note = `${e.info.error} をキャッチ`;
      step.output = data;
      step.next = rule.next;
      current = rule.next;
      continue;
    }

    data = step.output as Json;
    if (node.end || node.next === undefined) return data;
    step.next = node.next;
    current = node.next;
  }
}

/** 入力JSONとTaskモックでステートマシンを実行し、全ステップのトレースを返す。 */
export function simulate(machine: Machine, input: Json, mocks: TaskMocks = {}): RunResult {
  const ctx: Context = { steps: [], mocks, count: 0 };
  try {
    const output = runMachine(machine, input, [], ctx);
    return { steps: ctx.steps, outcome: 'succeeded', output };
  } catch (e) {
    if (e instanceof SimError) {
      return { steps: ctx.steps, outcome: 'failed', error: e.info };
    }
    throw e;
  }
}
