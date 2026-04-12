// Amazon States Language の解析と検証。状態遷移のグラフ(辺)もここで抽出する。

import type { Json } from './jsonpath';

export type StateType =
  | 'Task'
  | 'Pass'
  | 'Choice'
  | 'Wait'
  | 'Succeed'
  | 'Fail'
  | 'Parallel'
  | 'Map';

export interface CatchRule {
  errorEquals: string[];
  next: string;
  resultPath?: string;
}

export interface StateNode {
  name: string;
  type: StateType;
  raw: Record<string, Json>;
  next?: string;
  end: boolean;
  choices?: { rule: Json; next: string }[];
  default?: string;
  catches: CatchRule[];
  /** Parallelのブランチ、またはMapのItemProcessor(配列要素1つ) */
  branches: Machine[];
  comment?: string;
}

export interface Machine {
  startAt: string;
  states: Map<string, StateNode>;
  comment?: string;
}

export interface ParseResult {
  machine?: Machine;
  errors: string[];
}

export type EdgeKind = 'next' | 'choice' | 'default' | 'catch';

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

const STATE_TYPES: ReadonlySet<string> = new Set([
  'Task',
  'Pass',
  'Choice',
  'Wait',
  'Succeed',
  'Fail',
  'Parallel',
  'Map',
]);

const TERMINAL_TYPES: ReadonlySet<string> = new Set(['Succeed', 'Fail']);

function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMachine(raw: unknown, prefix: string, errors: string[]): Machine | undefined {
  if (!isObject(raw)) {
    errors.push(`${prefix}: ステートマシンはオブジェクトで書く`);
    return undefined;
  }
  const statesRaw = raw.States;
  if (!isObject(statesRaw) || Object.keys(statesRaw).length === 0) {
    errors.push(`${prefix}: States が必要(空でないオブジェクト)`);
    return undefined;
  }
  if (typeof raw.StartAt !== 'string') {
    errors.push(`${prefix}: StartAt が必要`);
    return undefined;
  }
  if (!(raw.StartAt in statesRaw)) {
    errors.push(`${prefix}: StartAt "${raw.StartAt}" がStatesに存在しない`);
  }

  const states = new Map<string, StateNode>();
  for (const [name, def] of Object.entries(statesRaw)) {
    const where = prefix === '' ? name : `${prefix} > ${name}`;
    if (!isObject(def)) {
      errors.push(`${where}: 状態定義はオブジェクトで書く`);
      continue;
    }
    const type = def.Type;
    if (typeof type !== 'string' || !STATE_TYPES.has(type)) {
      errors.push(`${where}: Type は ${[...STATE_TYPES].join(' / ')} のいずれか`);
      continue;
    }
    const node: StateNode = {
      name,
      type: type as StateType,
      raw: def,
      end: def.End === true,
      catches: [],
      branches: [],
      comment: typeof def.Comment === 'string' ? def.Comment : undefined,
    };
    if (typeof def.Next === 'string') node.next = def.Next;

    if (!TERMINAL_TYPES.has(type) && type !== 'Choice' && node.next === undefined && !node.end) {
      errors.push(`${where}: Next か End: true のどちらかが必要`);
    }
    if (node.next !== undefined && node.end) {
      errors.push(`${where}: Next と End は同時に指定できない`);
    }

    if (type === 'Choice') {
      if (!Array.isArray(def.Choices) || def.Choices.length === 0) {
        errors.push(`${where}: Choice には Choices(1つ以上)が必要`);
      } else {
        node.choices = [];
        def.Choices.forEach((rule, i) => {
          if (!isObject(rule) || typeof rule.Next !== 'string') {
            errors.push(`${where}: Choices[${i}] に Next が必要`);
            return;
          }
          node.choices?.push({ rule, next: rule.Next });
        });
      }
      if (typeof def.Default === 'string') node.default = def.Default;
    }

    if (Array.isArray(def.Catch)) {
      def.Catch.forEach((rule, i) => {
        if (!isObject(rule) || !Array.isArray(rule.ErrorEquals) || typeof rule.Next !== 'string') {
          errors.push(`${where}: Catch[${i}] には ErrorEquals と Next が必要`);
          return;
        }
        node.catches.push({
          errorEquals: rule.ErrorEquals.filter((e): e is string => typeof e === 'string'),
          next: rule.Next,
          resultPath: typeof rule.ResultPath === 'string' ? rule.ResultPath : undefined,
        });
      });
    }

    if (type === 'Parallel') {
      if (!Array.isArray(def.Branches) || def.Branches.length === 0) {
        errors.push(`${where}: Parallel には Branches(1つ以上)が必要`);
      } else {
        def.Branches.forEach((branch, i) => {
          const sub = parseMachine(branch, `${where} branch[${i}]`, errors);
          if (sub) node.branches.push(sub);
        });
      }
    }

    if (type === 'Map') {
      const processor = def.ItemProcessor ?? def.Iterator;
      if (processor === undefined) {
        errors.push(`${where}: Map には ItemProcessor(または Iterator)が必要`);
      } else {
        const sub = parseMachine(processor, `${where} processor`, errors);
        if (sub) node.branches.push(sub);
      }
    }

    states.set(name, node);
  }

  // 遷移先の存在チェック
  for (const node of states.values()) {
    const targets: (string | undefined)[] = [
      node.next,
      node.default,
      ...(node.choices?.map((c) => c.next) ?? []),
      ...node.catches.map((c) => c.next),
    ];
    for (const target of targets) {
      if (target !== undefined && !states.has(target)) {
        errors.push(
          `${prefix === '' ? '' : `${prefix} > `}${node.name}: 遷移先 "${target}" が存在しない`,
        );
      }
    }
  }

  return {
    startAt: raw.StartAt,
    states,
    comment: typeof raw.Comment === 'string' ? raw.Comment : undefined,
  };
}

/** ASL JSON文字列を解析する。エラーがあれば machine は返さない。 */
export function parseAsl(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (e) {
    return { errors: [`JSONとして解析できない: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors: string[] = [];
  const machine = parseMachine(raw, '', errors);
  if (errors.length > 0) return { errors };
  return { machine, errors };
}

/** Choice規則を「変数 演算子 値」程度の短い文字列へ要約する(辺ラベル用)。 */
export function summarizeRule(rule: Json): string {
  if (!isObject(rule)) return '';
  if (Array.isArray(rule.And)) return `And(${rule.And.length})`;
  if (Array.isArray(rule.Or)) return `Or(${rule.Or.length})`;
  if (rule.Not !== undefined) return 'Not(...)';
  const variable = typeof rule.Variable === 'string' ? rule.Variable : '';
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'Variable' || key === 'Next' || key === 'Comment') continue;
    return `${variable} ${key} ${JSON.stringify(value)}`;
  }
  return variable;
}

/** 1階層分の遷移の辺を抽出する(ブランチ内部は含まない)。 */
export function machineEdges(machine: Machine): Edge[] {
  const edges: Edge[] = [];
  for (const node of machine.states.values()) {
    if (node.next !== undefined) edges.push({ from: node.name, to: node.next, kind: 'next' });
    node.choices?.forEach((choice) => {
      edges.push({
        from: node.name,
        to: choice.next,
        kind: 'choice',
        label: summarizeRule(choice.rule),
      });
    });
    if (node.default !== undefined) {
      edges.push({ from: node.name, to: node.default, kind: 'default', label: 'default' });
    }
    for (const rule of node.catches) {
      edges.push({
        from: node.name,
        to: rule.next,
        kind: 'catch',
        label: rule.errorEquals.join(', '),
      });
    }
  }
  return edges;
}
