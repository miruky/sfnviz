import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, parseShareHash, shareHash, type ShareState } from './share';

const sample: ShareState = {
  asl: '{"StartAt":"在庫確認","States":{}}',
  input: '{"orderId":"A-1024"}',
  mocks: '{"在庫確認":{"available":true}}',
};

describe('share', () => {
  it('符号化して元に戻せる(日本語を含む)', () => {
    const restored = decodeState(encodeState(sample));
    expect(restored).toEqual(sample);
  });

  it('Base64URLは記号を含まない', () => {
    const encoded = encodeState(sample);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('壊れた符号は undefined', () => {
    expect(decodeState('これは壊れている###')).toBeUndefined();
    expect(decodeState('')).toBeUndefined();
  });

  it('形が合わない符号は undefined', () => {
    const wrong = btoa(JSON.stringify({ asl: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeState(wrong)).toBeUndefined();
  });

  it('ハッシュ片の往復', () => {
    const hash = shareHash(sample);
    expect(hash.startsWith('#s=')).toBe(true);
    expect(parseShareHash(hash)).toEqual(sample);
  });

  it('共有リンクでないハッシュは undefined', () => {
    expect(parseShareHash('')).toBeUndefined();
    expect(parseShareHash('#section')).toBeUndefined();
  });
});
