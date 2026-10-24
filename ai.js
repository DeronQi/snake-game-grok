/**
 * 贪吃蛇必通关 AI。
 *
 * UMD：浏览器挂到 window.SnakeAI，Node 里 require 可直接使用。
 * 算法保证：在规定开局下，任意果实序列都会填满 20×20（吃掉 397 个果实）。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SnakeAI = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 20;
  var N = SIZE * SIZE;
  /** 开局 3 节，吃满棋盘还需要的果实数。 */
  var FOODS_TO_WIN = N - 3;

  /**
   * 四档难度只改速度（毫秒/步）。level 1 用 base，level 10 用 min，中间线性插值。
   * 每 4 分升 1 级，最高 10 级。
   */
  var DIFFICULTY = {
    easy: { base: 230, min: 150 },
    normal: { base: 150, min: 78 },
    hard: { base: 105, min: 58 },
    insane: { base: 70, min: 38 }
  };

  var DIR = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };

  var DIRS = [DIR.up, DIR.down, DIR.left, DIR.right];

  /**
   * 预计算 20×20 哈密顿环，每格一个唯一序号 order。
   * 走法：第 0 列向下 → 其余列在第 1..size-1 行蛇形往返 → 第 0 行向左闭合回 (0,0)。
   * 偶数边长才能这样把第 0 行留成闭合边，同时覆盖全部格子。
   */
  function buildCycle(size) {
    var order = [];
    var r;
    var c;
    for (r = 0; r < size; r++) {
      order.push(new Array(size));
    }
    var idx = 0;
    for (r = 0; r < size; r++) {
      order[r][0] = idx++;
    }
    for (c = 1; c < size; c++) {
      if (c % 2 === 1) {
        for (r = size - 1; r >= 1; r--) order[r][c] = idx++;
      } else {
        for (r = 1; r < size; r++) order[r][c] = idx++;
      }
    }
    for (c = size - 1; c >= 1; c--) {
      order[0][c] = idx++;
    }
    if (idx !== size * size) {
      throw new Error('哈密顿环长度错误: ' + idx);
    }
    return order;
  }

  var ORDER = buildCycle(SIZE);

  function levelForScore(score) {
    var level = Math.floor(score / 4) + 1;
    if (level < 1) level = 1;
    if (level > 10) level = 10;
    return level;
  }

  function speedMs(difficulty, level) {
    var spec = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    var lv = level < 1 ? 1 : level > 10 ? 10 : level;
    var t = (lv - 1) / 9;
    return Math.round(spec.base + (spec.min - spec.base) * t);
  }

  /**
   * 开局蛇：第 10 行、第 8–10 列，头在右，向右出发。
   * 不放在第 0 行——那一行是环的向左闭合边，朝右的蛇在安全规则下没有合法首步。
   */
  function createInitialSnake() {
    return [
      { r: 10, c: 10 },
      { r: 10, c: 9 },
      { r: 10, c: 8 }
    ];
  }

  /** 行优先扫描空格，用 rnd()∈[0,1) 均匀抽取。棋盘满了返回 null。 */
  function spawnFood(snake, rnd) {
    var rand = typeof rnd === 'function' ? rnd : Math.random;
    var occ = new Uint8Array(N);
    var i;
    for (i = 0; i < snake.length; i++) {
      occ[snake[i].r * SIZE + snake[i].c] = 1;
    }
    var empty = [];
    for (i = 0; i < N; i++) {
      if (!occ[i]) empty.push(i);
    }
    if (!empty.length) return null;
    var pick = empty[Math.floor(rand() * empty.length)];
    return { r: Math.floor(pick / SIZE), c: pick % SIZE };
  }

  function manhattan(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  }

  /**
   * 选择下一步。
   *
   * 安全规则：头只能落到「头 → 尾」这段环上的格子。
   *   step    = (候选序号 - 头序号) mod N
   *   tailDist = (尾序号 - 头序号) mod N
   *   要求 step ≤ tailDist。吃果实时尾巴不移动，因此不能正好落在尾巴上。
   * 身体若始终落在「尾 → 头」的另一段弧上，这条规则就不会踩到自己；
   * 沿环走 1 步永远存在（环是邻接的），所以不会无路可走；环经过每一格，所以必然吃到果实并填满棋盘。
   * 再加一层身体占用检查，防止不变量被意外打破时撞死。
   *
   * 抄近路：合法邻居按 [是否吃到食物, 沿环到食物的剩余步数, 曼哈顿距离, 环步长] 择优
   * （吃到优先，其余三项越小越好）。
   *
   * 门控：空地 < 蛇长 × 1.25 时禁止跳格。吃食物、以及沿环正好走 1 步，永远允许。
   * 若门控后没有合法走法，退回不门控重算，避免卡死。
   *
   * options.mode === 'cycle' 时只允许环上下一格，供「纯绕环基线」对照。
   */
  function nextMove(snake, food, options) {
    var mode = options && options.mode === 'cycle' ? 'cycle' : 'smart';
    var head = snake[0];
    var tail = snake[snake.length - 1];
    var headOrder = ORDER[head.r][head.c];
    var tailOrder = ORDER[tail.r][tail.c];
    var tailDist = (tailOrder - headOrder + N) % N;
    var foodOrder = food ? ORDER[food.r][food.c] : 0;
    var empty = N - snake.length;
    var gateActive = empty < snake.length * 1.25;

    function collect(useGate) {
      var cands = [];
      var d;
      for (d = 0; d < DIRS.length; d++) {
        var dir = DIRS[d];
        var nr = head.r + dir.dr;
        var nc = head.c + dir.dc;
        if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
        var step = (ORDER[nr][nc] - headOrder + N) % N;
        if (step === 0) continue;
        var eats = !!(food && nr === food.r && nc === food.c);
        if (step > tailDist) continue;
        if (step === tailDist && eats) continue;
        var limit = eats ? snake.length : snake.length - 1;
        var hit = false;
        var i;
        for (i = 0; i < limit; i++) {
          if (snake[i].r === nr && snake[i].c === nc) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
        if (mode === 'cycle' && step !== 1) continue;
        if (useGate && gateActive && step !== 1 && !eats) continue;
        cands.push({
          dr: dir.dr,
          dc: dir.dc,
          nr: nr,
          nc: nc,
          eats: eats,
          remain: food ? (foodOrder - ORDER[nr][nc] + N) % N : step,
          manh: food ? Math.abs(nr - food.r) + Math.abs(nc - food.c) : 0,
          step: step
        });
      }
      cands.sort(function (a, b) {
        if (a.eats !== b.eats) return a.eats ? -1 : 1;
        if (a.remain !== b.remain) return a.remain - b.remain;
        if (a.manh !== b.manh) return a.manh - b.manh;
        return a.step - b.step;
      });
      return cands.length ? cands[0] : null;
    }

    if (mode === 'cycle') return collect(false);
    return collect(true) || collect(false);
  }

  /**
   * 推进一步，原地修改 snake（头插入，没吃到就丢掉尾巴）。
   * 撞墙或咬到自己时不修改 snake。
   */
  function advance(snake, food, dir) {
    var head = snake[0];
    var nr = head.r + dir.dr;
    var nc = head.c + dir.dc;
    if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) {
      return { dead: true, won: false, ate: false, reason: 'wall' };
    }
    var ate = !!(food && nr === food.r && nc === food.c);
    var limit = ate ? snake.length : snake.length - 1;
    var i;
    for (i = 0; i < limit; i++) {
      if (snake[i].r === nr && snake[i].c === nc) {
        return { dead: true, won: false, ate: false, reason: 'self' };
      }
    }
    snake.unshift({ r: nr, c: nc });
    if (!ate) snake.pop();
    return { dead: false, won: ate && snake.length === N, ate: ate, reason: '' };
  }

  function isOpposite(a, b) {
    return !!a && !!b && a.dr + b.dr === 0 && a.dc + b.dc === 0;
  }

  return {
    SIZE: SIZE,
    N: N,
    FOODS_TO_WIN: FOODS_TO_WIN,
    DIFFICULTY: DIFFICULTY,
    DIR: DIR,
    initialDir: { dr: 0, dc: 1 },
    order: ORDER,
    buildCycle: buildCycle,
    levelForScore: levelForScore,
    speedMs: speedMs,
    createInitialSnake: createInitialSnake,
    spawnFood: spawnFood,
    manhattan: manhattan,
    nextMove: nextMove,
    advance: advance,
    isOpposite: isOpposite
  };
});
