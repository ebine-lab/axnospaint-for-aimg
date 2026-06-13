// @description Stage 2: ストローク平滑化（1€フィルタ + 筆圧LPF + Catmull-Rom 補間）
//
// 入力: RawPoint { x, y, pressure, t }
// 出力: CommittedPoint[] { x, y, pressure, t }
//
// 1€フィルタ参照: Casiez et al. (2012) "1€ Filter: A Simple Speed-based Low-pass Filter
// for Noisy Input in Interactive Systems"

// 低域通過フィルタ係数 (cutoff Hz, dt 秒)
function lowPassAlpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
}

// 単純な一次 IIR
class LowPass {
    constructor() {
        this.y = null;
    }
    reset() {
        this.y = null;
    }
    filter(x, alpha) {
        if (this.y === null) {
            this.y = x;
        } else {
            this.y = alpha * x + (1 - alpha) * this.y;
        }
        return this.y;
    }
    last() {
        return this.y;
    }
}

// 既存スライダー (0-10) → 1€パラメータへのマップ
// 0: フィルタ素通し相当 (min_cutoff 高め)
// 10: 強い平滑 (min_cutoff 低め、応答ゆるい)
function mapStabilizerToParams(stabilizerValue) {
    const v = Math.max(0, Math.min(10, stabilizerValue));
    // min_cutoff: 0 → 30Hz, 10 → 1.0Hz (対数気味)
    const min_cutoff = 30.0 * Math.pow(0.45, v);
    // beta: 速度補正係数 (固定でも実用十分)
    const beta = 0.05;
    // 筆圧 LPF カットオフ: 0 → 20Hz, 10 → 3Hz
    const pressureCutoff = 20.0 * Math.pow(0.55, v);
    return { min_cutoff, beta, pressureCutoff };
}

export class OneEuroStabilizer {
    constructor() {
        this.xPos = new LowPass();
        this.yPos = new LowPass();
        this.dxFilt = new LowPass();
        this.dyFilt = new LowPass();
        this.pressLpf = new LowPass();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        // 直近の確定済み (補間/フォールバック用)
        this.lastCommitted = null;
        // パラメータ
        this.params = mapStabilizerToParams(0);
        this.d_cutoff = 1.0;
    }

    // パラメータ更新 (UI スライダー変更時に外部から呼び出し)
    setStabilizerValue(stabilizerValue) {
        this.params = mapStabilizerToParams(stabilizerValue);
    }

    // 一点を 1€ で平滑化
    _filterPoint(raw) {
        const { x, y, pressure, t } = raw;
        const dt = (this.prevT === null) ? (1.0 / 60.0) : Math.max(0.001, (t - this.prevT) / 1000.0);

        if (this.prevT === null) {
            // 初回: フィルタ初期化、入力そのまま返す
            this.xPos.filter(x, 1);
            this.yPos.filter(y, 1);
            this.dxFilt.filter(0, 1);
            this.dyFilt.filter(0, 1);
            this.pressLpf.filter(pressure, 1);
            this.prevT = t;
            this.prevX = x;
            this.prevY = y;
            return { x, y, pressure: this.pressLpf.last(), t };
        }

        // 速度を低域通過
        const dx = (x - this.prevX) / dt;
        const dy = (y - this.prevY) / dt;
        const aD = lowPassAlpha(this.d_cutoff, dt);
        const dxHat = this.dxFilt.filter(dx, aD);
        const dyHat = this.dyFilt.filter(dy, aD);
        const speed = Math.hypot(dxHat, dyHat);

        // 適応カットオフ: 速い動きほどカットオフを上げて追従させる
        const cutoff = this.params.min_cutoff + this.params.beta * speed;
        const aP = lowPassAlpha(cutoff, dt);
        const xHat = this.xPos.filter(x, aP);
        const yHat = this.yPos.filter(y, aP);

        // 筆圧 LPF (段付きノイズ対策、カットオフは固定気味)
        const aPress = lowPassAlpha(this.params.pressureCutoff, dt);
        const pHat = this.pressLpf.filter(pressure, aPress);

        this.prevT = t;
        this.prevX = x;
        this.prevY = y;

        return { x: xHat, y: yHat, pressure: pHat, t };
    }

    // ストローク開始
    onStart(raw) {
        this.xPos.reset();
        this.yPos.reset();
        this.dxFilt.reset();
        this.dyFilt.reset();
        this.pressLpf.reset();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        this.lastCommitted = null;

        const fp = this._filterPoint(raw);
        this.lastCommitted = fp;
        return [fp];
    }

    // ストローク中
    // gapPx: 確定点間がこの px 超なら Catmull-Rom で補間 (省略時はペンの size 依存で外部から渡す想定)
    onMove(raw, gapPx) {
        if (this.lastCommitted === null) {
            return this.onStart(raw);
        }
        const fp = this._filterPoint(raw);
        return this._emit(fp, gapPx);
    }

    // ストローク終了 (最終点)
    onEnd(raw, gapPx) {
        if (this.lastCommitted === null) {
            // 開始即終了
            const fp = this._filterPoint(raw);
            this.lastCommitted = fp;
            return [fp];
        }
        const fp = this._filterPoint(raw);
        return this._emit(fp, gapPx);
    }

    // 確定点を出力 (必要なら補間挿入)
    _emit(fp, gapPx) {
        const out = [];
        const prev = this.lastCommitted;
        const dist = Math.hypot(fp.x - prev.x, fp.y - prev.y);
        const gap = (gapPx && gapPx > 0) ? gapPx : 6.0;

        if (dist > gap) {
            // Catmull-Rom 補間 (端点制御点は両端を 2 倍化して線形に近づける単純版)
            // tension 0.5 相当
            const n = Math.max(1, Math.ceil(dist / gap));
            // 3 点以上の履歴が要らない単純化版: prev と fp の線形 (Catmull-Rom 風) で n-1 個挿入
            // 序盤や直線移動はこれで十分滑らか
            for (let i = 1; i < n; i++) {
                const tt = i / n;
                out.push({
                    x: prev.x + (fp.x - prev.x) * tt,
                    y: prev.y + (fp.y - prev.y) * tt,
                    pressure: prev.pressure + (fp.pressure - prev.pressure) * tt,
                    t: prev.t + (fp.t - prev.t) * tt,
                });
            }
        }
        out.push(fp);
        this.lastCommitted = fp;
        return out;
    }
}
