// ステートマシン定義・入力・モックをURLハッシュへ畳んで共有できるようにする。
// 解析も実行もブラウザ内で完結する方針に合わせ、共有もサーバを介さずURLだけで行う。

export interface ShareState {
  asl: string;
  input: string;
  mocks: string;
}

const PREFIX = '#s=';

/** UTF-8文字列をURLセーフなBase64へ。日本語の状態名でも壊れないようにバイト列を経由する。 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(state: ShareState): string {
  return toBase64Url(JSON.stringify([state.asl, state.input, state.mocks]));
}

/** Base64URL文字列を復元する。壊れていれば undefined を返し、呼び出し側は通常起動へ倒す。 */
export function decodeState(encoded: string): ShareState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
  if (!parsed.every((v) => typeof v === 'string')) return undefined;
  const [asl, input, mocks] = parsed as [string, string, string];
  return { asl, input, mocks };
}

/** location.hash から共有状態を取り出す。共有リンクでなければ undefined。 */
export function parseShareHash(hash: string): ShareState | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  return decodeState(hash.slice(PREFIX.length));
}

/** 共有リンクのハッシュ片(`#s=...`)を作る。 */
export function shareHash(state: ShareState): string {
  return PREFIX + encodeState(state);
}
