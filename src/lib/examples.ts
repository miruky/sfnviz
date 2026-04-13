// サンプル。Choice・Catch・Parallel・Map・ループといったASLの主要要素を一通り含む。

export interface Example {
  id: string;
  label: string;
  asl: string;
  input: string;
  mocks: string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export const EXAMPLES: Example[] = [
  {
    id: 'order',
    label: '注文処理(Choice + Catch)',
    asl: json({
      Comment: '在庫を確認し、支払いの結果で分岐する注文フロー',
      StartAt: '在庫確認',
      States: {
        在庫確認: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:check-stock',
          ResultPath: '$.stock',
          Next: '在庫あり?',
        },
        '在庫あり?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.stock.available',
              BooleanEquals: true,
              Next: '支払い実行',
            },
          ],
          Default: '取り寄せ登録',
        },
        取り寄せ登録: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:backorder',
          End: true,
        },
        支払い実行: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:charge',
          ResultPath: '$.payment',
          Catch: [
            {
              ErrorEquals: ['PaymentDeclined'],
              ResultPath: '$.error',
              Next: '注文失敗',
            },
          ],
          Next: '出荷指示',
        },
        出荷指示: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:ship',
          Next: '完了',
        },
        完了: { Type: 'Succeed' },
        注文失敗: {
          Type: 'Fail',
          Error: 'OrderFailed',
          Cause: '支払いが拒否された',
        },
      },
    }),
    input: json({ orderId: 'A-1024', items: 3 }),
    mocks: json({
      在庫確認: { available: true, warehouse: 'tokyo-2' },
      支払い実行: { $error: 'PaymentDeclined', $cause: '限度額超過' },
    }),
  },
  {
    id: 'fanout',
    label: '並列集計(Parallel)',
    asl: json({
      Comment: '売上と在庫を並列に集計してレポートをまとめる',
      StartAt: '集計',
      States: {
        集計: {
          Type: 'Parallel',
          Branches: [
            {
              StartAt: '売上集計',
              States: {
                売上集計: {
                  Type: 'Task',
                  Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:sales',
                  End: true,
                },
              },
            },
            {
              StartAt: '在庫集計',
              States: {
                在庫集計: {
                  Type: 'Task',
                  Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:inventory',
                  End: true,
                },
              },
            },
          ],
          ResultPath: '$.reports',
          Next: 'レポート保存',
        },
        レポート保存: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:save-report',
          End: true,
        },
      },
    }),
    input: json({ date: '2026-06-01' }),
    mocks: json({
      売上集計: { total: 1280000 },
      在庫集計: { skus: 412 },
    }),
  },
  {
    id: 'batch',
    label: 'リトライ付きバッチ(Map + Wait + ループ)',
    asl: json({
      Comment: '画像を1件ずつ変換し、未完了が残っていれば待って再確認する',
      StartAt: '変換',
      States: {
        変換: {
          Type: 'Map',
          ItemsPath: '$.images',
          ItemProcessor: {
            StartAt: 'リサイズ',
            States: {
              リサイズ: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:resize',
                End: true,
              },
            },
          },
          ResultPath: '$.results',
          Next: '状況確認',
        },
        状況確認: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:ap-northeast-1:123456789012:function:check-progress',
          ResultPath: '$.progress',
          Next: '完了?',
        },
        '完了?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.progress.pending',
              NumericGreaterThan: 0,
              Next: '待機',
            },
          ],
          Default: '完了',
        },
        待機: { Type: 'Wait', Seconds: 30, Next: '状況確認' },
        完了: { Type: 'Succeed' },
      },
    }),
    input: json({ images: ['a.png', 'b.png', 'c.png'] }),
    mocks: json({
      リサイズ: { status: 'resized' },
      状況確認: { pending: 0 },
    }),
  },
];
