// @description ペン定義：親クラス＞なげなわツール

import { PenObj } from './_penobj.js';

// なげなわ
export class Nagenawa extends PenObj {
    constructor(option) {
        super();
        this.axpObj = option.axpObj;
        this.CANVAS = option.CANVAS;
        // 値（PenObjからの差分）
        this.name = this.axpObj._('@PENNAME.NAGENAWA');
        this.type = 'nagenawa';
        this.cursor = 'crosshair';
        // 制御

        this.init_save();
    }
    // 描画開始
    start(x, y, e) {
    }
    // 描画中
    move(x, y, e) {
    }
    // 描画終了
    end(x, y, e) {
    }
}
