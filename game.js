/**
 * 贪吃蛇主程序：输入、渲染、音效、最高分与 Service Worker。
 * 规则与 AI 步长都走 ai.js，避免和验证脚本分叉。
 */
(function () {
  'use strict';

  globalThis.SNAKE_BUILD = 'snake-build-1';

  var SIZE = SnakeAI.SIZE;
  /** MAX 约每秒 1320 步。实测通关大约 3.0–3.6 万步，墙钟时间落在 22–28 秒。 */
  var MAX_STEPS_PER_SEC = 1320;
  var RATES = [1, 4, 16, 64, 'MAX'];
  var KEY_BEST = 'snake.best';
  var KEY_DIFF = 'snake.difficulty';
  var KEY_MUTED = 'snake.muted';

  var app = document.getElementById('app');
  var boardBox = document.getElementById('board-box');
  var boardFrame = document.getElementById('board-frame');
  var canvas = document.getElementById('board');
  var flash = document.getElementById('flash');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var speedEl = document.getElementById('speed');
  var speedLabel = document.getElementById('speed-label');
  var aiBanner = document.getElementById('ai-banner');
  var btnRate = document.getElementById('btn-rate');
  var btnAi = document.getElementById('btn-ai');
  var btnSound = document.getElementById('btn-sound');
  var btnFull = document.getElementById('btn-full');
  var btnPause = document.getElementById('btn-pause');
  var overlayStart = document.getElementById('overlay-start');
  var overlayPause = document.getElementById('overlay-pause');
  var overlayEnd = document.getElementById('overlay-end');
  var endKicker = document.getElementById('end-kicker');
  var endTitle = document.getElementById('end-title');
  var endScore = document.getElementById('end-score');
  var endMsg = document.getElementById('end-msg');
  var live = document.getElementById('live');

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduceMotion = motionQuery.matches;

  var phase = 'ready';
  var aiOn = false;
  var rateIndex = 0;
  var difficulty = 'normal';
  var muted = false;
  var best = 0;
  var score = 0;
  var snake = SnakeAI.createInitialSnake();
  var food = SnakeAI.spawnFood(snake);
  var dir = { dr: SnakeAI.initialDir.dr, dc: SnakeAI.initialDir.dc };
  var queue = [];
  var endShown = false;
  var endReason = '';
  var endTimer = 0;
  var cssSize = 0;
  var acc = 0;
  var lastTs = 0;
  var captureId = null;
  var drag = null;
  var audioCtx = null;
  var audioUnlocked = false;
  var lastEatSfx = 0;

  function storeGet(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) { /* 隐私模式或 file 限制时忽略 */ }
  }

  function loadPrefs() {
    var savedBest = parseInt(storeGet(KEY_BEST, '0'), 10);
    best = isFinite(savedBest) && savedBest > 0 ? savedBest : 0;
    var savedDiff = storeGet(KEY_DIFF, 'normal');
    difficulty = SnakeAI.DIFFICULTY[savedDiff] ? savedDiff : 'normal';
    muted = storeGet(KEY_MUTED, '0') === '1';
  }

  function titleFor() {
    if (phase === 'won') return '通关 · 得分 ' + score + ' · 贪吃蛇';
    if (phase === 'paused') return '已暂停 · 得分 ' + score + ' · 贪吃蛇';
    if (phase === 'dead') return '游戏结束 · 得分 ' + score + ' · 贪吃蛇';
    return '得分 ' + score + ' · 贪吃蛇';
  }

  function renderHud() {
    var level = SnakeAI.levelForScore(score);
    var speed = SnakeAI.speedMs(difficulty, level);
    scoreEl.textContent = String(score);
    scoreEl.dataset.score = String(score);
    bestEl.textContent = String(best);
    bestEl.dataset.best = String(best);
    speedEl.textContent = speed + 'ms';
    speedEl.dataset.speed = String(speed);
    speedEl.dataset.level = String(level);
    speedLabel.textContent = '速度 · Lv.' + level;
    document.title = titleFor();
    app.dataset.phase = phase;
    app.dataset.ai = aiOn ? '1' : '0';
  }

  function rateText() {
    var rate = RATES[rateIndex];
    return rate === 'MAX' ? 'MAX' : '×' + rate;
  }

  function syncSoundIcon() {
    var on = btnSound.querySelector('.icon-on');
    var off = btnSound.querySelector('.icon-off');
    on.hidden = muted;
    off.hidden = !muted;
    btnSound.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btnSound.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
  }

  function syncPauseIcon() {
    var paused = phase === 'paused';
    btnPause.querySelector('.icon-pause').hidden = paused;
    btnPause.querySelector('.icon-play').hidden = !paused;
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btnPause.setAttribute('aria-label', paused ? '继续' : '暂停');
  }

  function syncDifficulty() {
    var buttons = document.querySelectorAll('[data-diff]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-diff') === difficulty;
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function releaseCapture() {
    if (captureId == null) return;
    try {
      canvas.releasePointerCapture(captureId);
    } catch (err) { /* 指针已经松开 */ }
    captureId = null;
    drag = null;
  }

  function syncUi() {
    overlayStart.hidden = phase !== 'ready';
    overlayPause.hidden = phase !== 'paused';
    overlayEnd.hidden = !endShown;
    aiBanner.hidden = !aiOn || phase === 'ready';
    btnRate.textContent = rateText();
    btnRate.setAttribute('aria-label', '演示速度，当前 ' + rateText());
    btnAi.setAttribute('aria-pressed', aiOn ? 'true' : 'false');
    syncPauseIcon();
    syncSoundIcon();
    syncDifficulty();
    renderHud();
    if (phase !== 'running') releaseCapture();
  }

  function say(text) {
    live.textContent = text;
  }

  function setDifficulty(name) {
    if (!SnakeAI.DIFFICULTY[name]) return;
    difficulty = name;
    storeSet(KEY_DIFF, name);
    syncDifficulty();
    renderHud();
  }

  function stepInterval() {
    var base = SnakeAI.speedMs(difficulty, SnakeAI.levelForScore(score));
    if (!aiOn) return base;
    var rate = RATES[rateIndex];
    if (rate === 'MAX') return 1000 / MAX_STEPS_PER_SEC;
    return base / rate;
  }

  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioUnlocked) {
      audioUnlocked = true;
      audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function tone(freq, dur, type, gainValue, slideTo) {
    if (muted || !audioCtx) return;
    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + dur);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function sfxStart() { tone(340, 0.09, 'triangle', 0.05, 560); }
  function sfxEat() { tone(640, 0.07, 'square', 0.04, 920); }
  function sfxDie() { tone(210, 0.32, 'sawtooth', 0.05, 55); }
  function sfxWin() {
    [523, 659, 784, 1046].forEach(function (freq, index) {
      setTimeout(function () { tone(freq, 0.14, 'triangle', 0.05); }, index * 90);
    });
  }

  function buzz(pattern) {
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
    } catch (err) { /* 部分浏览器会抛安全错误 */ }
  }

  function playEat() {
    var now = performance.now();
    if (now - lastEatSfx < 70) return;
    lastEatSfx = now;
    sfxEat();
    buzz(12);
  }

  function enqueue(next) {
    if (!next || aiOn || phase !== 'running') return;
    var last = queue.length ? queue[queue.length - 1] : dir;
    if (next.dr === last.dr && next.dc === last.dc) return;
    if (SnakeAI.isOpposite(last, next)) return;
    if (queue.length >= 2) return;
    queue.push({ dr: next.dr, dc: next.dc });
  }

  function clearEndTimer() {
    if (endTimer) {
      clearTimeout(endTimer);
      endTimer = 0;
    }
    boardFrame.classList.remove('is-shaking');
    flash.hidden = true;
  }

  function startRun(options) {
    clearEndTimer();
    endShown = false;
    aiOn = !!(options && options.ai);
    if (!aiOn) rateIndex = 0;
    snake = SnakeAI.createInitialSnake();
    food = SnakeAI.spawnFood(snake);
    dir = { dr: SnakeAI.initialDir.dr, dc: SnakeAI.initialDir.dc };
    queue = [];
    score = 0;
    acc = 0;
    phase = 'running';
    syncUi();
    say(aiOn ? 'AI 演示开始' : '游戏开始');
    unlockAudio();
    sfxStart();
  }

  function pause() {
    if (phase !== 'running') return;
    phase = 'paused';
    acc = 0;
    syncUi();
    say('已暂停');
  }

  function resume() {
    if (phase !== 'paused') return;
    phase = 'running';
    acc = 0;
    syncUi();
    say('继续游戏');
  }

  function togglePause() {
    if (phase === 'running') pause();
    else if (phase === 'paused') resume();
    else if (phase === 'ready') startRun({ ai: false });
  }

  function fillEndCopy() {
    endScore.textContent = '得分 ' + score;
    if (phase === 'won' && aiOn) {
      endKicker.textContent = '通关';
      endTitle.textContent = '通关';
      endMsg.textContent = 'AI 通关！AI 用 397 个果实填满了整个棋盘';
    } else if (phase === 'won') {
      endKicker.textContent = '通关';
      endTitle.textContent = '通关';
      endMsg.textContent = '你用 397 个果实填满了整个棋盘';
    } else if (endReason === 'wall') {
      endKicker.textContent = '游戏结束';
      endTitle.textContent = '撞墙了';
      endMsg.textContent = '蛇头撞上了边界。';
    } else {
      endKicker.textContent = '游戏结束';
      endTitle.textContent = '咬到自己了';
      endMsg.textContent = '蛇头撞上了自己的身体。';
    }
  }

  function showEnd() {
    if (phase !== 'dead' && phase !== 'won') return;
    endShown = true;
    fillEndCopy();
    syncUi();
  }

  function die(reason) {
    if (phase === 'dead' || phase === 'won') return;
    phase = 'dead';
    endReason = reason || 'self';
    endShown = false;
    syncUi();
    say('游戏结束，得分 ' + score);
    unlockAudio();
    sfxDie();
    buzz([40, 30, 120]);
    flash.hidden = false;
    if (reduceMotion) {
      showEnd();
      return;
    }
    boardFrame.classList.add('is-shaking');
    endTimer = setTimeout(function () {
      endTimer = 0;
      boardFrame.classList.remove('is-shaking');
      flash.hidden = true;
      showEnd();
    }, 460);
  }

  function win() {
    if (phase === 'won') return;
    phase = 'won';
    syncUi();
    say('通关，得分 ' + score);
    unlockAudio();
    sfxWin();
    showEnd();
  }

  function goHome() {
    clearEndTimer();
    endShown = false;
    aiOn = false;
    rateIndex = 0;
    phase = 'ready';
    score = 0;
    snake = SnakeAI.createInitialSnake();
    food = SnakeAI.spawnFood(snake);
    dir = { dr: SnakeAI.initialDir.dr, dc: SnakeAI.initialDir.dc };
    queue = [];
    syncUi();
    say('返回标题');
  }

  function tick() {
    if (phase !== 'running') return;
    var stepDir = dir;
    if (aiOn) {
      var move = SnakeAI.nextMove(snake, food);
      if (!move) {
        die('self');
        return;
      }
      stepDir = { dr: move.dr, dc: move.dc };
      dir = stepDir;
      queue = [];
    } else if (queue.length) {
      stepDir = queue.shift();
      dir = stepDir;
    }
    var result = SnakeAI.advance(snake, food, stepDir);
    if (result.dead) {
      die(result.reason);
      return;
    }
    if (!result.ate) return;
    score += 1;
    if (score > best) {
      best = score;
      storeSet(KEY_BEST, String(best));
    }
    renderHud();
    playEat();
    if (result.won) {
      win();
      return;
    }
    food = SnakeAI.spawnFood(snake);
  }

  function fit() {
    var rect = boardBox.getBoundingClientRect();
    var size = Math.floor(Math.min(rect.width, rect.height));
    if (size < 40) return;
    cssSize = size;
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    boardFrame.style.width = size + 'px';
    boardFrame.style.height = size + 'px';
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = Math.max(1, Math.round(size * dpr));
  }

  function roundRect(x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function draw(now) {
    if (!cssSize) return;
    var dpr = canvas.width / cssSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);
    ctx.fillStyle = '#0c1220';
    ctx.fillRect(0, 0, cssSize, cssSize);

    var cell = cssSize / SIZE;
    ctx.strokeStyle = 'rgba(232, 238, 249, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var i;
    for (i = 1; i < SIZE; i++) {
      var p = Math.round(i * cell) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, cssSize);
      ctx.moveTo(0, p);
      ctx.lineTo(cssSize, p);
    }
    ctx.stroke();

    if (food) {
      var pulse = reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(now / 190);
      var fr = cell * 0.3 * pulse;
      var fx = (food.c + 0.5) * cell;
      var fy = (food.r + 0.5) * cell;
      ctx.shadowColor = 'rgba(255, 59, 92, 0.9)';
      ctx.shadowBlur = cell * 0.55;
      ctx.fillStyle = '#ff3b5c';
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(fx - fr * 0.38, fy - fr * 0.38, fr * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3ec878';
      roundRect(fx - fr * 0.08, fy - fr * 1.35, fr * 0.55, fr * 0.38, fr * 0.15);
      ctx.fill();
    }

    var len = snake.length;
    for (i = len - 1; i >= 1; i--) {
      var seg = snake[i];
      var t = (len - 1 - i) / (len - 1);
      var cr = Math.round(14 + (54 - 14) * t);
      var cg = Math.round(92 + (214 - 92) * t);
      var cb = Math.round(64 + (140 - 64) * t);
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      ctx.beginPath();
      ctx.arc((seg.c + 0.5) * cell, (seg.r + 0.5) * cell, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }

    var head = snake[0];
    var hx = (head.c + 0.5) * cell;
    var hy = (head.r + 0.5) * cell;
    ctx.shadowColor = 'rgba(255, 225, 74, 0.85)';
    ctx.shadowBlur = cell * 0.5;
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.arc(hx, hy, cell * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#142018';
    var fxDir = dir.dc;
    var fyDir = dir.dr;
    var px = -fyDir;
    var py = fxDir;
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.arc(
        hx + fxDir * cell * 0.14 + px * cell * 0.16 * s,
        hy + fyDir * cell * 0.14 + py * cell * 0.16 * s,
        cell * 0.065,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = now;
    var dt = now - lastTs;
    lastTs = now;
    if (!aiOn && dt > 250) dt = 250;
    if (phase === 'running') {
      acc += dt;
      var interval = stepInterval();
      var cap = aiOn ? 500 : 2;
      var n = 0;
      while (acc >= interval && n < cap && phase === 'running') {
        tick();
        acc -= interval;
        n += 1;
      }
    }
    draw(now);
  }

  function isVisibleButton(el) {
    if (!el || !el.closest) return false;
    var btn = el.closest('button');
    if (!btn || btn.closest('[hidden]')) return false;
    var cs = getComputedStyle(btn);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function onKey(e) {
    var keyDir = {
      ArrowUp: SnakeAI.DIR.up,
      ArrowDown: SnakeAI.DIR.down,
      ArrowLeft: SnakeAI.DIR.left,
      ArrowRight: SnakeAI.DIR.right,
      KeyW: SnakeAI.DIR.up,
      KeyA: SnakeAI.DIR.left,
      KeyS: SnakeAI.DIR.down,
      KeyD: SnakeAI.DIR.right
    };
    if (keyDir[e.code]) {
      e.preventDefault();
      unlockAudio();
      if (phase === 'ready' || phase === 'paused') {
        if (phase === 'paused') return;
        startRun({ ai: false });
      }
      if (phase === 'running') enqueue(keyDir[e.code]);
      return;
    }
    if (e.code === 'Space' || e.code === 'KeyP') {
      if (isVisibleButton(e.target) && e.target.id !== 'btn-pause' && e.target.getAttribute('data-dir') !== 'pause') {
        return;
      }
      e.preventDefault();
      unlockAudio();
      togglePause();
      return;
    }
    if (e.code === 'KeyR') {
      if (isVisibleButton(e.target)) return;
      e.preventDefault();
      unlockAudio();
      startRun({ ai: phase === 'ready' ? false : aiOn });
      return;
    }
    if (e.code === 'Enter') {
      if (isVisibleButton(e.target)) return;
      e.preventDefault();
      unlockAudio();
      if (phase === 'dead' || phase === 'won') startRun({ ai: aiOn });
      else if (phase === 'paused') resume();
      else if (phase === 'ready') startRun({ ai: false });
      return;
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      unlockAudio();
      toggleMute();
    }
  }

  function toggleMute() {
    muted = !muted;
    storeSet(KEY_MUTED, muted ? '1' : '0');
    syncSoundIcon();
    say(muted ? '已静音' : '声音已打开');
  }

  function toggleAi() {
    unlockAudio();
    if (phase === 'running' || phase === 'paused') {
      aiOn = !aiOn;
      if (aiOn) queue = [];
      syncUi();
      say(aiOn ? 'AI 演示中' : '已交回手动');
      return;
    }
    startRun({ ai: true });
  }

  function toggleFull() {
    unlockAudio();
    var root = document.documentElement;
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) {
        root.requestFullscreen().catch(function () {});
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  function bind() {
    document.getElementById('btn-start').addEventListener('click', function () {
      unlockAudio();
      startRun({ ai: false });
    });
    document.getElementById('btn-watch').addEventListener('click', function () {
      unlockAudio();
      startRun({ ai: true });
    });
    document.getElementById('btn-watch-end').addEventListener('click', function () {
      unlockAudio();
      startRun({ ai: true });
    });
    document.getElementById('btn-again').addEventListener('click', function () {
      unlockAudio();
      startRun({ ai: aiOn });
    });
    document.getElementById('btn-home').addEventListener('click', function () {
      unlockAudio();
      goHome();
    });
    document.getElementById('btn-resume').addEventListener('click', function () {
      unlockAudio();
      resume();
    });
    btnAi.addEventListener('click', toggleAi);
    btnPause.addEventListener('click', function () {
      unlockAudio();
      togglePause();
    });
    btnSound.addEventListener('click', function () {
      unlockAudio();
      toggleMute();
    });
    btnFull.addEventListener('click', toggleFull);
    btnRate.addEventListener('click', function () {
      unlockAudio();
      rateIndex = (rateIndex + 1) % RATES.length;
      acc = 0;
      syncUi();
    });

    var diffButtons = document.querySelectorAll('[data-diff]');
    for (var i = 0; i < diffButtons.length; i++) {
      diffButtons[i].addEventListener('click', function (event) {
        unlockAudio();
        setDifficulty(event.currentTarget.getAttribute('data-diff'));
      });
    }

    document.getElementById('dpad').addEventListener('pointerdown', function (event) {
      var btn = event.target.closest('button');
      if (!btn) return;
      event.preventDefault();
      unlockAudio();
      var name = btn.getAttribute('data-dir');
      if (name === 'pause') {
        togglePause();
        return;
      }
      var next = SnakeAI.DIR[name];
      if (phase === 'ready') startRun({ ai: false });
      if (phase === 'running') enqueue(next);
    });

    /**
     * 遮罩可见时不要 setPointerCapture。
     * 捕获还留在 canvas 上的话，结束面板里的按钮收不到点击。
     */
    canvas.addEventListener('pointerdown', function (event) {
      if (phase !== 'running' || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      try {
        canvas.setPointerCapture(event.pointerId);
        captureId = event.pointerId;
      } catch (err) { /* 某些指针类型不支持捕获 */ }
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id || phase !== 'running') return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) enqueue(dx > 0 ? SnakeAI.DIR.right : SnakeAI.DIR.left);
      else enqueue(dy > 0 ? SnakeAI.DIR.down : SnakeAI.DIR.up);
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      releaseCapture();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });

    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', function () {
      // 失焦后再确认一次：页面里点按钮也会冒出 blur，但焦点还在文档上，不该暂停。
      setTimeout(function () {
        if (phase === 'running' && !document.hasFocus()) pause();
      }, 0);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && phase === 'running') pause();
    });
    document.addEventListener('fullscreenchange', function () {
      var on = !!document.fullscreenElement;
      btnFull.setAttribute('aria-pressed', on ? 'true' : 'false');
      btnFull.setAttribute('aria-label', on ? '退出全屏' : '全屏');
    });
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', function () {
        reduceMotion = motionQuery.matches;
      });
    }

    var coarse = window.matchMedia('(pointer: coarse)');
    function syncInput() {
      var touch = coarse.matches || (navigator.maxTouchPoints || 0) > 0;
      document.documentElement.dataset.input = touch ? 'touch' : 'keyboard';
    }
    syncInput();
    if (coarse.addEventListener) coarse.addEventListener('change', syncInput);
    window.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'touch') {
        document.documentElement.dataset.input = 'touch';
      }
    }, { passive: true });

    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(function () { fit(); });
      observer.observe(boardBox);
    } else {
      window.addEventListener('resize', fit);
    }
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      reg.update().catch(function () {});
    }).catch(function () {});
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      var link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest';
      document.head.appendChild(link);
    }
  }

  loadPrefs();
  bind();
  syncUi();
  fit();
  requestAnimationFrame(frame);
  registerWorker();
})();
