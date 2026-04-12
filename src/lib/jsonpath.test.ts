import { describe, it, expect } from 'vitest';
import { parsePath, getPath, setPath, applyTemplate } from './jsonpath';

describe('parsePath', () => {
  it('ドット記法と添字を分解する', () => {
    expect(parsePath('$')).toEqual([]);
    expect(parsePath('$.a.b')).toEqual(['a', 'b']);
    expect(parsePath('$.items[2].name')).toEqual(['items', 2, 'name']);
    expect(parsePath("$['日本語キー'].x")).toEqual(['日本語キー', 'x']);
  });

  it('不正なパスは undefined', () => {
    expect(parsePath('a.b')).toBeUndefined();
    expect(parsePath('$..a')).toBeUndefined();
    expect(parsePath('$.a[*]')).toBeUndefined();
  });
});

describe('getPath', () => {
  const data = { order: { items: [{ sku: 'A' }, { sku: 'B' }], count: 2 } };

  it('入れ子の値を取り出す', () => {
    expect(getPath(data, '$.order.count')).toBe(2);
    expect(getPath(data, '$.order.items[1].sku')).toBe('B');
    expect(getPath(data, '$')).toEqual(data);
  });

  it('存在しないパスは undefined', () => {
    expect(getPath(data, '$.order.missing')).toBeUndefined();
    expect(getPath(data, '$.order.items[9]')).toBeUndefined();
    expect(getPath(null, '$.a')).toBeUndefined();
  });
});

describe('setPath', () => {
  it('$ への書き込みは全置換', () => {
    expect(setPath({ a: 1 }, '$', { b: 2 })).toEqual({ b: 2 });
  });

  it('途中のオブジェクトを作りながら書き込む', () => {
    expect(setPath({ a: 1 }, '$.result.value', 9)).toEqual({ a: 1, result: { value: 9 } });
  });

  it('元の値を破壊しない', () => {
    const original = { a: { b: 1 } };
    const updated = setPath(original, '$.a.c', 2);
    expect(original).toEqual({ a: { b: 1 } });
    expect(updated).toEqual({ a: { b: 1, c: 2 } });
  });
});

describe('applyTemplate', () => {
  it('.$ で終わるキーをパスで解決する', () => {
    const result = applyTemplate(
      { 'id.$': '$.orderId', fixed: 'x', nested: { 'n.$': '$.count' } },
      { orderId: 'A-1', count: 3 },
    );
    expect(result).toEqual({ id: 'A-1', fixed: 'x', nested: { n: 3 } });
  });

  it('解決できないパスは null になる', () => {
    expect(applyTemplate({ 'v.$': '$.missing' }, {})).toEqual({ v: null });
  });
});
