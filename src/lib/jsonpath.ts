// ASLで使うJsonPathのサブセット。$ から始まるドット記法と配列添字に対応する。
// フィルタ式やスライスなど完全なJsonPathは扱わない(ASLの参照パスと同じ範囲)。

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** "$.a.b[0]" を ['a', 'b', 0] のようなセグメント列へ分解する。不正なら undefined。 */
export function parsePath(path: string): (string | number)[] | undefined {
  if (path === '$') return [];
  if (!path.startsWith('$')) return undefined;
  const segments: (string | number)[] = [];
  // .key / ['key'] / [0] の繰り返し
  const re = /\.([A-Za-z_][A-Za-z0-9_-]*)|\['([^']+)'\]|\[(\d+)\]/gy;
  let i = 1;
  while (i < path.length) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m || m.index !== i) return undefined;
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(m[2]);
    else segments.push(Number(m[3]));
    i = re.lastIndex;
  }
  return segments;
}

/** パスの値を取り出す。存在しなければ undefined。 */
export function getPath(value: Json, path: string): Json | undefined {
  const segments = parsePath(path);
  if (!segments) return undefined;
  let current: Json | undefined = value;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg];
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as { [key: string]: Json })[seg];
    }
  }
  return current;
}

/** パスへ値を書き込んだ新しい値を返す(ResultPath用)。途中のオブジェクトは作る。 */
export function setPath(target: Json, path: string, value: Json): Json {
  const segments = parsePath(path);
  if (!segments) return target;
  if (segments.length === 0) return value;
  const root: Json =
    typeof target === 'object' && target !== null && !Array.isArray(target)
      ? { ...(target as { [key: string]: Json }) }
      : {};
  let cursor = root as { [key: string]: Json };
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = String(segments[i]);
    const existing = cursor[seg];
    cursor[seg] =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? { ...(existing as { [key: string]: Json }) }
        : {};
    cursor = cursor[seg] as { [key: string]: Json };
  }
  cursor[String(segments[segments.length - 1])] = value;
  return root;
}

/** Parameters / ItemSelector / ResultSelector のテンプレートを展開する。 */
export function applyTemplate(template: Json, source: Json): Json {
  if (Array.isArray(template)) return template.map((item) => applyTemplate(item, source));
  if (typeof template === 'object' && template !== null) {
    const out: { [key: string]: Json } = {};
    for (const [key, value] of Object.entries(template)) {
      if (key.endsWith('.$') && typeof value === 'string') {
        out[key.slice(0, -2)] = (getPath(source, value) ?? null) as Json;
      } else {
        out[key] = applyTemplate(value, source);
      }
    }
    return out;
  }
  return template;
}
