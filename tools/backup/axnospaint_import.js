// AxnosPaint IndexedDB バックアップ用 単体スクリプト（インポート／復元）
//
// 使い方:
//   1. AxnosPaint がロードされているタブ（aimg_viewer のページ）を開く
//      ※ 初めてのオリジンの場合、先に AxnosPaint を一度起動して DB スキーマを作成しておくこと
//   2. ブラウザの DevTools を開きコンソールタブを表示
//   3. このファイルの中身を全選択してコンソールに貼り付け、Enter で実行
//   4. ページ右下に表示される「.axp を選んで復元」ボタンをクリック
//      （ブラウザのファイル選択ダイアログはユーザー操作が必要なため、
//        コンソールから直接開けない仕様）
//   5. ファイル選択ダイアログで axnospaint_backup_*.axp を選ぶ
//   6. 確認ダイアログで OK を押すと既存の IndexedDB を上書きで復元
//   7. 完了後、必ずページをリロード（メモリ上の AxnosPaint 状態をクリアするため）
//
// 注意:
//   - 復元は破壊的操作（既存スロットを clear() してから書き戻す）。実行前に確認ダイアログが 1 度出る
//   - IndexedDB はオリジン単位。バックアップを取ったオリジンと同じドメインのページで実行すること

(() => {
    const DB = 'axnospaint_db1';
    const AUTO_KEY_STORES = new Set(['save_auto']); // autoIncrement のストア

    const b64ToBytes = (b64) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    };

    const deserialize = (v) => {
        if (v === null || v === undefined || typeof v !== 'object') return v;
        if (v.__t === 'Date') return new Date(v.v);
        if (v.__t === 'ImageData') {
            return new ImageData(new Uint8ClampedArray(b64ToBytes(v.b64).buffer), v.w, v.h);
        }
        if (v.__t === 'U8C') return new Uint8ClampedArray(b64ToBytes(v.b64).buffer);
        if (v.__t === 'U8') return b64ToBytes(v.b64);
        if (Array.isArray(v)) return v.map(deserialize);
        const o = {};
        for (const k of Object.keys(v)) o[k] = deserialize(v[k]);
        return o;
    };

    // 既存の起動 UI があれば一度撤去（連続実行対策）
    const PANEL_ID = 'axp-backup-import-panel';
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const input = Object.assign(document.createElement('input'), {
        type: 'file',
        accept: '.axp,application/json',
    });
    input.style.display = 'none';

    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        let payload;
        try {
            payload = JSON.parse(await file.text());
        } catch (e) {
            alert('JSONとして読み込めません: ' + e.message);
            return;
        }
        if (!payload || payload.magic !== 'AXP_BACKUP') {
            alert('AXP_BACKUP 形式のファイルではありません。');
            return;
        }
        if (payload.db && payload.db !== DB) {
            if (!confirm(`このファイルは別のDB(${payload.db})用です。本当に "${DB}" へ書き込みますか？`)) return;
        }

        const summary = Object.entries(payload.stores)
            .map(([k, v]) => `  ${k}: ${v.length} 件`).join('\n');
        const ok = confirm(
            `IndexedDB "${DB}" を以下の内容で上書きします（既存データは破棄されます）。\n\n` +
            `${summary}\n\nエクスポート日時: ${payload.exportedAt}\n\nよろしいですか？`
        );
        if (!ok) return;

        let db;
        try {
            db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(DB);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('indexedDB.open failed'));
            });
        } catch (e) {
            alert('IndexedDB のオープンに失敗しました: ' + e.message);
            return;
        }

        const skipped = [];
        try {
            for (const [name, entries] of Object.entries(payload.stores)) {
                if (!db.objectStoreNames.contains(name)) {
                    console.warn(`[skip] ストア "${name}" が DB に存在しません。AxnosPaint を一度開いて DB スキーマを作成してから再実行してください。`);
                    skipped.push(name);
                    continue;
                }
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(name, 'readwrite');
                    const store = tx.objectStore(name);
                    store.clear();
                    const useAutoKey = AUTO_KEY_STORES.has(name);
                    for (const ent of entries) {
                        const v = deserialize(ent.value);
                        if (useAutoKey) {
                            store.put(v, ent._key);
                        } else {
                            store.put(v);
                        }
                    }
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
                console.log(`[AxnosPaint backup] "${name}" に ${entries.length} 件を復元`);
            }
        } catch (e) {
            console.error('[AxnosPaint backup] インポート中にエラー:', e);
            alert('インポート中にエラーが発生しました: ' + (e && e.message ? e.message : e));
            db.close();
            return;
        }
        db.close();

        const note = skipped.length
            ? `\n\n※ 次のストアはスキップされました（DB スキーマに無いため）:\n  ${skipped.join(', ')}\n  AxnosPaint を一度開いてから再度インポートしてください。`
            : '';
        alert('復元完了。ページをリロードしてください。' + note);
        document.getElementById(PANEL_ID)?.remove();
    };

    // ファイル選択ダイアログはユーザー操作が無いと開けないため、
    // ページ右下にボタンを表示してクリックを待つ。
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'background:#fff', 'color:#000', 'border:2px solid #c33',
        'border-radius:8px', 'padding:12px 14px',
        'box-shadow:0 4px 16px rgba(0,0,0,.3)',
        'font:14px/1.4 sans-serif',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'AxnosPaint データ復元';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#c33';

    const desc = document.createElement('div');
    desc.textContent = '下のボタンを押して .axp ファイルを選んでください。';
    desc.style.cssText = 'margin-bottom:8px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '.axp を選んで復元';
    btn.style.cssText = [
        'padding:8px 14px', 'font:bold 14px sans-serif',
        'background:#c33', 'color:#fff', 'border:none',
        'border-radius:4px', 'cursor:pointer', 'margin-right:6px',
    ].join(';');
    btn.onclick = () => input.click();

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '中止';
    cancel.style.cssText = [
        'padding:8px 12px', 'font:14px sans-serif',
        'background:#eee', 'color:#000', 'border:1px solid #999',
        'border-radius:4px', 'cursor:pointer',
    ].join(';');
    cancel.onclick = () => panel.remove();

    panel.appendChild(title);
    panel.appendChild(desc);
    panel.appendChild(btn);
    panel.appendChild(cancel);
    panel.appendChild(input);
    document.body.appendChild(panel);

    console.log('[AxnosPaint backup] 右下のボタンをクリックして .axp を選択してください。');
})();
