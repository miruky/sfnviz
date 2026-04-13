// 画面の組み立て。ASLの解析・図のレイアウト・シミュレーションは src/lib に分離し、
// ここではエディタ・図・ステップ操作の配線だけを行う。

import { parseAsl, type Machine } from './lib/asl';
import { renderDiagram } from './lib/diagram';
import { simulate, type RunResult, type TraceStep } from './lib/runner';
import type { Json } from './lib/jsonpath';
import { EXAMPLES } from './lib/examples';

const STORAGE_KEY = 'sfnviz:v1';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BRAND_MARK =
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect x="22" y="4" width="20" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/><rect x="6" y="46" width="20" height="14" rx="4" fill="none" stroke="var(--accent)" stroke-width="3.5"/><rect x="38" y="46" width="20" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M32 18v10M32 28C32 38 16 36 16 46M32 28c0 10 16 8 16 18" fill="none" stroke="currentColor" stroke-width="3"/></svg>';

/** トレースのネストパスを、図の data-id(スラッシュ区切り)へ変換する。 */
export function stepDomId(step: TraceStep): string {
  const segments = step.path.map((p) => {
    const branch = /^(.*) branch (\d+)$/.exec(p);
    if (branch) return `${branch[1]}/branch ${branch[2]}`;
    const item = /^(.*) \[(\d+)\]$/.exec(p);
    if (item) return `${item[1]}/processor`;
    return p;
  });
  return [...segments, step.state].join('/');
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
  <header class="site-header">
    <div class="brand">${BRAND_MARK}<span class="brand-name">sfnviz</span></div>
    <p class="tagline">Step Functionsステートマシン(ASL)を図にして、モック実行で遷移とデータの流れを追うデバッガ</p>
  </header>
  <main>
    <section class="pane editor-pane" aria-labelledby="asl-h">
      <div class="pane-head">
        <h2 id="asl-h">ステートマシン(ASL)</h2>
        <label class="preset-label">サンプル
          <select id="preset">
            <option value="">自由入力</option>
            ${EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <textarea id="asl" spellcheck="false" aria-label="ASL JSON"></textarea>
      <ul id="errors" class="errors" hidden></ul>
      <div class="sub-editors">
        <label class="sub-editor">実行入力(JSON)
          <textarea id="input" spellcheck="false"></textarea>
        </label>
        <label class="sub-editor">Taskのモック結果(状態名 → 結果、$errorでエラー)
          <textarea id="mocks" spellcheck="false"></textarea>
        </label>
      </div>
      <button type="button" id="run" class="primary">実行する</button>
      <p id="run-error" class="run-error" hidden></p>
    </section>
    <section class="pane diagram-pane" aria-labelledby="diagram-h">
      <h2 id="diagram-h">遷移図</h2>
      <div id="diagram" class="diagram"></div>
      <div id="player" class="player" hidden>
        <div class="player-controls">
          <button type="button" id="prev" class="ghost" aria-label="前のステップ">前へ</button>
          <span id="step-pos" class="step-pos"></span>
          <button type="button" id="next" class="ghost" aria-label="次のステップ">次へ</button>
          <span id="outcome" class="outcome"></span>
        </div>
        <div id="step-detail" class="step-detail"></div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <p>解析と実行はすべてブラウザ内で完結し、定義や入力が外部へ送信されることはない。</p>
  </footer>`;

  const aslEl = root.querySelector('#asl') as HTMLTextAreaElement;
  const inputEl = root.querySelector('#input') as HTMLTextAreaElement;
  const mocksEl = root.querySelector('#mocks') as HTMLTextAreaElement;
  const presetEl = root.querySelector('#preset') as HTMLSelectElement;
  const errorsEl = root.querySelector('#errors') as HTMLUListElement;
  const diagramEl = root.querySelector('#diagram') as HTMLDivElement;
  const playerEl = root.querySelector('#player') as HTMLDivElement;
  const stepPosEl = root.querySelector('#step-pos') as HTMLSpanElement;
  const outcomeEl = root.querySelector('#outcome') as HTMLSpanElement;
  const stepDetailEl = root.querySelector('#step-detail') as HTMLDivElement;
  const runEl = root.querySelector('#run') as HTMLButtonElement;
  const runErrorEl = root.querySelector('#run-error') as HTMLParagraphElement;
  const prevEl = root.querySelector('#prev') as HTMLButtonElement;
  const nextEl = root.querySelector('#next') as HTMLButtonElement;

  let machine: Machine | undefined;
  let run: RunResult | undefined;
  let cursor = 0;

  function save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ asl: aslEl.value, input: inputEl.value, mocks: mocksEl.value }),
      );
    } catch {
      // 保存できない環境でも動作は継続する
    }
  }

  function refreshDiagram(): void {
    const { machine: parsed, errors } = parseAsl(aslEl.value);
    machine = parsed;
    run = undefined;
    playerEl.hidden = true;
    if (errors.length > 0 || !parsed) {
      errorsEl.hidden = false;
      errorsEl.innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
      diagramEl.innerHTML =
        '<p class="placeholder">ASLのエラーを解消すると遷移図が表示される。</p>';
      return;
    }
    errorsEl.hidden = true;
    diagramEl.innerHTML = renderDiagram(parsed).svg;
  }

  function showStep(): void {
    if (!run) return;
    const step = run.steps[cursor];
    if (!step) return;
    stepPosEl.textContent = `${cursor + 1} / ${run.steps.length}`;
    prevEl.disabled = cursor === 0;
    nextEl.disabled = cursor === run.steps.length - 1;

    diagramEl.querySelectorAll('.state').forEach((el) => {
      el.classList.remove('current', 'visited', 'st-caught', 'st-failed', 'st-succeeded');
    });
    run.steps.slice(0, cursor + 1).forEach((s, i) => {
      const el = diagramEl.querySelector(`[data-id="${CSS.escape(stepDomId(s))}"]`);
      if (!el) return;
      el.classList.add(i === cursor ? 'current' : 'visited');
      if (i === cursor && s.status !== 'ok') el.classList.add(`st-${s.status}`);
    });

    const where =
      step.path.length > 0 ? `<span class="step-path">${esc(step.path.join(' > '))}</span>` : '';
    const json = (v: Json | undefined) => (v === undefined ? '—' : esc(JSON.stringify(v, null, 2)));
    stepDetailEl.innerHTML = `
      <p class="step-head">${where}<strong>${esc(step.state)}</strong> <span class="type-badge">${step.type}</span>
        ${step.note ? `<span class="step-note">${esc(step.note)}</span>` : ''}</p>
      <div class="io">
        <div><h3>入力</h3><pre>${json(step.input)}</pre></div>
        <div><h3>出力</h3><pre>${json(step.output)}</pre></div>
      </div>`;
  }

  function execute(): void {
    if (!machine) return;
    runErrorEl.hidden = true;
    let input: Json;
    let mocks: Record<string, Json>;
    try {
      input = JSON.parse(inputEl.value === '' ? 'null' : inputEl.value) as Json;
    } catch {
      runErrorEl.hidden = false;
      runErrorEl.textContent = '実行入力がJSONとして解析できない。';
      return;
    }
    try {
      mocks = JSON.parse(mocksEl.value === '' ? '{}' : mocksEl.value) as Record<string, Json>;
    } catch {
      runErrorEl.hidden = false;
      runErrorEl.textContent = 'モック定義がJSONとして解析できない。';
      return;
    }
    run = simulate(machine, input, mocks);
    cursor = 0;
    playerEl.hidden = false;
    outcomeEl.textContent =
      run.outcome === 'succeeded' ? '実行成功' : `実行失敗: ${run.error?.error ?? ''}`;
    outcomeEl.className = `outcome ${run.outcome}`;
    showStep();
  }

  presetEl.addEventListener('change', () => {
    const example = EXAMPLES.find((e) => e.id === presetEl.value);
    if (!example) return;
    aslEl.value = example.asl;
    inputEl.value = example.input;
    mocksEl.value = example.mocks;
    refreshDiagram();
    save();
  });
  aslEl.addEventListener('input', () => {
    presetEl.value = '';
    refreshDiagram();
    save();
  });
  for (const el of [inputEl, mocksEl]) el.addEventListener('input', save);
  runEl.addEventListener('click', execute);
  prevEl.addEventListener('click', () => {
    cursor = Math.max(0, cursor - 1);
    showStep();
  });
  nextEl.addEventListener('click', () => {
    if (run) cursor = Math.min(run.steps.length - 1, cursor + 1);
    showStep();
  });
  root.addEventListener('keydown', (event) => {
    if (playerEl.hidden || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowLeft') prevEl.click();
    if (event.key === 'ArrowRight') nextEl.click();
  });

  let saved: { asl: string; input: string; mocks: string } | undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as { asl: string; input: string; mocks: string };
  } catch {
    saved = undefined;
  }
  if (saved && typeof saved.asl === 'string' && saved.asl.trim() !== '') {
    aslEl.value = saved.asl;
    inputEl.value = saved.input ?? '';
    mocksEl.value = saved.mocks ?? '';
  } else {
    const first = EXAMPLES[0];
    if (first) {
      presetEl.value = first.id;
      aslEl.value = first.asl;
      inputEl.value = first.input;
      mocksEl.value = first.mocks;
    }
  }
  refreshDiagram();
}
