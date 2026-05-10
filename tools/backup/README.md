# AxnosPaint IndexedDB バックアップツール

AxnosPaint がブラウザの IndexedDB（`axnospaint_db1`）に保存しているデータ
（手動セーブスロット・自動保存・ユーザー設定・カラーパレット）を、`.axp`
という単一ファイルにまるごとエクスポート／インポートするためのスタンドアロン
スクリプトです。

AxnosPaint 本体には何の改変も加えません。コンソールに 1 回貼り付けて実行する
だけで動作します。

## いつ使うか

- AxnosPaint がアップデートされる前に、念のため手動でバックアップを取りたい
- ブラウザのデータを掃除する前にセーブスロットを退避したい
- 別のブラウザ／別の端末（同じホスト URL）にセーブデータを移行したい

> AxnosPaint のセーブデータ書式には `version` フィールドがあり、
> `restoreData()` 内で旧バージョンとの互換コードが用意されています。
> したがって、通常のアップデートでデータが失われることはありません。
> このツールは「万全を期したい」ユーザー向けのオプションです。

## ファイル

| ファイル | 用途 |
|---|---|
| `axnospaint_export.js` | コンソールに貼り付けて実行 → `.axp` をダウンロード |
| `axnospaint_import.js` | コンソールに貼り付けて実行 → `.axp` を選んで復元 |

## 使い方（エクスポート）

1. AxnosPaint がロードされているタブを開く（例: aimg_viewer のページ）。
2. キーボードの `F12` または右クリック → 「検証」/「要素を調査」で DevTools を開く。
3. **Console**（コンソール）タブを選択。
4. `axnospaint_export.js` の中身をすべてコピーし、コンソールに貼り付けて Enter。
   - Chrome / Edge で初めて貼り付ける場合、警告メッセージに従って
     `allow pasting` と入力してから貼り付け直す。
5. 自動的にファイル保存ダイアログが開き、`axnospaint_backup_YYYYMMDD_HHMMSS.axp`
   がダウンロードされる。

## 使い方（インポート／復元）

> **警告**: インポートは破壊的操作です。実行すると IndexedDB の既存セーブ
> データはすべて上書きされます。実行前に確認ダイアログが 1 度表示されます。

1. バックアップ時と同じオリジン（同じ URL のドメイン）の AxnosPaint タブを開く。
   - そのオリジンで AxnosPaint をまだ一度も起動していない場合、先に起動して
     IndexedDB スキーマを作成しておくこと。
2. DevTools のコンソールに `axnospaint_import.js` を貼り付けて実行。
3. ファイル選択ダイアログで `.axp` を選ぶ。
4. 「IndexedDB を上書きします」確認ダイアログで OK。
5. 「復元完了」のメッセージが出たら **必ずページをリロード**。

## `.axp` フォーマット

JSON テキスト。1 ファイルで 4 ストア全部を持つ。

```jsonc
{
  "magic": "AXP_BACKUP",
  "formatVersion": 1,
  "exportedAt": "2026-05-10T12:34:56.000Z",
  "db": "axnospaint_db1",
  "origin": "https://example.com",
  "stores": {
    "save_manual":  [ { "_key": "save_01", "value": { ... } }, ... ],
    "save_auto":    [ { "_key": 17,        "value": { ... } }, ... ],
    "save_config":  [ { "_key": "config_01","value": { ... } } ],
    "save_palette": [ { "_key": "palette_01","value": { ... } } ]
  }
}
```

`Date` および `ImageData`（レイヤー画像）はラウンドトリップ可能なよう、次の
タグ付きオブジェクトで保持される。

| 元の型 | JSON 表現 |
|---|---|
| `Date` | `{ "__t": "Date", "v": "<ISO>" }` |
| `ImageData` | `{ "__t": "ImageData", "w": <num>, "h": <num>, "b64": "<base64>" }` |
| `Uint8ClampedArray` | `{ "__t": "U8C", "b64": "<base64>" }` |
| `Uint8Array` | `{ "__t": "U8", "b64": "<base64>" }` |

## 制限・注意事項

- IndexedDB はオリジン（プロトコル＋ホスト＋ポート）単位で分離されている。
  バックアップを取ったオリジンと同じ URL のページでないと復元できない。
- 大きなキャンバス・多レイヤーのセーブほど `.axp` は大きくなる
  （ピクセル数 × 4 バイト × レイヤー数 を Base64 化）。
- インポート後はメモリ上の AxnosPaint 状態が古いままなので、必ずページを
  リロードすること。
- 旧バージョンで保存されたスロット（`version < 3` 等）も値構造を変えずに運ぶため、
  AxnosPaint 本体側の互換コードがそのまま機能する。

## トラブルシューティング

- **「IndexedDB "axnospaint_db1" が見つかりません」と出る**:
  そのオリジンで AxnosPaint を一度も起動していない可能性が高い。
  AxnosPaint を 1 回開いてから再実行する。
- **インポート時に一部ストアがスキップされる**:
  メッセージにあるとおり、AxnosPaint を一度開いて DB スキーマを作成してから
  インポートし直す。
- **コンソールに貼り付けできない**:
  Chrome / Edge の保護機能。コンソールに `allow pasting` と打ってから貼り付け直す。
