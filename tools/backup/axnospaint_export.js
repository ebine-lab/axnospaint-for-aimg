// AxnosPaint IndexedDB バックアップ用 単体スクリプト（エクスポート）
//
// 使い方:
//   1. AxnosPaint がロードされているタブ（aimg_viewer のページ）を開く
//   2. ブラウザの DevTools を開きコンソールタブを表示
//   3. このファイルの中身を全選択してコンソールに貼り付け、Enter で実行
//   4. ファイル保存ダイアログから axnospaint_backup_YYYYMMDD_HHMMSS.axp をダウンロード
//
// 注意:
//   - IndexedDB はオリジン単位のため、必ず AxnosPaint と同じドメインのページで実行すること
//   - 最近の Chrome / Edge は初回貼り付け時に "allow pasting" の入力を要求する場合あり

(async () => {
    const DB = 'axnospaint_db1';
    const STORES = ['save_manual', 'save_auto', 'save_config', 'save_palette'];

    const bytesToB64 = (u8) => {
        let bin = '';
        const C = 0x8000;
        for (let i = 0; i < u8.length; i += C) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + C));
        }
        return btoa(bin);
    };

    const serialize = (v) => {
        if (v === null || v === undefined || typeof v !== 'object') return v;
        if (v instanceof Date) return { __t: 'Date', v: v.toISOString() };
        if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
            return { __t: 'ImageData', w: v.width, h: v.height, b64: bytesToB64(v.data) };
        }
        if (v instanceof Uint8ClampedArray) return { __t: 'U8C', b64: bytesToB64(v) };
        if (v instanceof Uint8Array) return { __t: 'U8', b64: bytesToB64(v) };
        if (Array.isArray(v)) return v.map(serialize);
        const o = {};
        for (const k of Object.keys(v)) o[k] = serialize(v[k]);
        return o;
    };

    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB.open failed'));
        req.onupgradeneeded = () => {
            // DB がまだ無い（このオリジンで一度も AxnosPaint を起動していない）状態
            req.transaction.abort();
            reject(new Error(`IndexedDB "${DB}" が見つかりません。AxnosPaint のページで実行しているか確認してください。`));
        };
    });

    const stores = {};
    for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
            stores[name] = [];
            continue;
        }
        stores[name] = await new Promise((resolve, reject) => {
            const out = [];
            const req = db.transaction(name).objectStore(name).openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    out.push({ _key: cursor.primaryKey, value: serialize(cursor.value) });
                    cursor.continue();
                } else {
                    resolve(out);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }
    db.close();

    const payload = {
        magic: 'AXP_BACKUP',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        db: DB,
        origin: location.origin,
        stores,
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `axnospaint_backup_${ts}.axp`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const total = Object.values(stores).reduce((n, s) => n + s.length, 0);
    console.log(`[AxnosPaint backup] エクスポート完了: ${total} 件 / ${STORES.length} ストア -> ${a.download}`);
})().catch((e) => {
    console.error('[AxnosPaint backup] エクスポート失敗:', e);
    alert('エクスポート失敗: ' + (e && e.message ? e.message : e));
});
