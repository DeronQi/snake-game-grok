#!/usr/bin/env node
'use strict';

/**
 * 浏览器验收：file:// 直接打开，四种视口。
 * 用 canvas 像素认出蛇头和果实，真的走键盘/方向键把蛇喂到升级，
 * 再检查暂停、重开、最高分、标题和 AI 通关。
 */

var path = require('path');
var fs = require('fs');
var playwright = require('playwright');

var ROOT = path.resolve(__dirname, '..');
var FILE_URL = 'file://' + path.join(ROOT, 'index.html');
var SHOTS = '/tmp/snake-shots';
var failed = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log('PASS  ' + name);
    return;
  }
  failed += 1;
  console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
}

function keyFor(step) {
  if (step.dr === -1) return 'ArrowUp';
  if (step.dr === 1) return 'ArrowDown';
  if (step.dc === -1) return 'ArrowLeft';
  return 'ArrowRight';
}

function cellKey(r, c) {
  return r + ',' + c;
}

function firstStep(board) {
  var head = board.head;
  var food = board.food;
  if (!head || !food) return null;
  var blocked = {};
  board.bodies.forEach(function (b) { blocked[cellKey(b.r, b.c)] = true; });
  if (board.tail) delete blocked[cellKey(board.tail.r, board.tail.c)];
  var prev = {};
  var start = cellKey(head.r, head.c);
  prev[start] = null;
  var q = [[head.r, head.c]];
  var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var found = false;
  while (q.length) {
    var cur = q.shift();
    if (cur[0] === food.r && cur[1] === food.c) {
      found = true;
      break;
    }
    for (var i = 0; i < dirs.length; i++) {
      var nr = cur[0] + dirs[i][0];
      var nc = cur[1] + dirs[i][1];
      if (nr < 0 || nc < 0 || nr >= 20 || nc >= 20) continue;
      var k = cellKey(nr, nc);
      if (Object.prototype.hasOwnProperty.call(prev, k)) continue;
      if (blocked[k]) continue;
      prev[k] = { r: cur[0], c: cur[1] };
      q.push([nr, nc]);
    }
  }
  if (!found) return null;
  var cr = food.r;
  var cc = food.c;
  while (true) {
    var parent = prev[cellKey(cr, cc)];
    if (!parent) return null;
    if (parent.r === head.r && parent.c === head.c) {
      return { dr: cr - head.r, dc: cc - head.c };
    }
    cr = parent.r;
    cc = parent.c;
  }
}

function readBoardScript() {
  return function () {
    var canvas = document.getElementById('board');
    var context = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width;
    var h = canvas.height;
    var img = context.getImageData(0, 0, w, h).data;
    var n = 20;
    var cw = w / n;
    var ch = h / n;
    var head = null;
    var food = null;
    var bodies = [];
    var r;
    var c;
    for (r = 0; r < n; r++) {
      for (c = 0; c < n; c++) {
        var x = Math.min(w - 1, Math.floor((c + 0.5) * cw));
        var y = Math.min(h - 1, Math.floor((r + 0.5) * ch));
        var i = (y * w + x) * 4;
        var R = img[i];
        var G = img[i + 1];
        var B = img[i + 2];
        if (R > 220 && G < 120 && B < 150 && R - G > 80) food = { r: r, c: c };
        else if (R > 220 && G > 180 && B < 140) head = { r: r, c: c };
        else if (G > 70 && G > R + 10 && G > B) bodies.push({ r: r, c: c, g: G });
      }
    }
    var tail = null;
    bodies.forEach(function (b) {
      if (!tail || b.g < tail.g) tail = b;
    });
    return { head: head, food: food, tail: tail, bodies: bodies, length: (head ? 1 : 0) + bodies.length };
  };
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function layout(page, label, expect) {
  await page.waitForFunction(function () {
    var b = document.getElementById('board').getBoundingClientRect();
    return b.width > 80 && Math.abs(b.width - b.height) < 2;
  });
  var info = await page.evaluate(function () {
    function box(el) {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      var visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      return {
        name: el.id || String(el.className),
        visible: visible,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        w: r.width,
        h: r.height
      };
    }
    var board = document.getElementById('board').getBoundingClientRect();
    return {
      board: { w: board.width, h: board.height, top: board.top, bottom: board.bottom, left: board.left, right: board.right },
      boxes: Array.prototype.map.call(document.querySelectorAll('header, .stats, #board, #hints, #dpad, #compact-hint'), box),
      iw: window.innerWidth,
      ih: window.innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      cw: document.documentElement.clientWidth,
      ch: document.documentElement.clientHeight
    };
  });
  check(label + ' 棋盘正方形', Math.abs(info.board.w - info.board.h) < 2, JSON.stringify(info.board));
  check(label + ' 棋盘在视口内',
    info.board.top >= -1 && info.board.left >= -1 &&
    info.board.bottom <= info.ih + 1 && info.board.right <= info.iw + 1,
    JSON.stringify(info.board) + ' viewport ' + info.iw + 'x' + info.ih);
  check(label + ' 页面无滚动',
    info.sw <= info.cw + 1 && info.sh <= info.ch + 1,
    'scroll ' + info.sw + 'x' + info.sh + ' client ' + info.cw + 'x' + info.ch);
  info.boxes.forEach(function (b) {
    if (!b.visible) return;
    var inside = b.top >= -1 && b.left >= -1 && b.bottom <= info.ih + 1 && b.right <= info.iw + 1;
    check(label + ' 可见不溢出 ' + b.name, inside, JSON.stringify(b));
  });
  var byName = {};
  info.boxes.forEach(function (b) { byName[b.name] = b; });
  if (expect.dpad != null) check(label + (expect.dpad ? ' 显示方向键' : ' 隐藏方向键'), !!byName.dpad && byName.dpad.visible === expect.dpad);
  if (expect.hints != null) check(label + (expect.hints ? ' 显示键盘提示' : ' 隐藏键盘提示'), !!byName.hints && byName.hints.visible === expect.hints);
  if (expect.compact != null) check(label + (expect.compact ? ' 紧凑提示' : ' 无紧凑提示'), !!byName['compact-hint'] && byName['compact-hint'].visible === expect.compact);
  return info;
}

async function openPage(browser, options) {
  var context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    hasTouch: !!options.touch,
    isMobile: !!options.touch,
    deviceScaleFactor: 1
  });
  var page = await context.newPage();
  var errors = [];
  page.on('console', function (msg) {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', function (err) {
    errors.push(String(err && err.message || err));
  });
  await page.goto(FILE_URL);
  await page.waitForFunction(function () {
    return document.getElementById('board').width > 100 && window.SnakeAI && window.SNAKE_BUILD === 'snake-build-1';
  });
  return { context: context, page: page, errors: errors };
}

async function eatUntil(page, target) {
  var dir = { dr: 0, dc: 1 };
  var prev = null;
  var started = Date.now();
  var script = readBoardScript();
  while (Date.now() - started < 45000) {
    var score = Number(await page.locator('#score').innerText());
    if (score >= target) return score;
    var board = await page.evaluate(script);
    if (!board.head || !board.food) {
      throw new Error('看不到蛇头或果实 ' + JSON.stringify({ head: board.head, food: board.food, length: board.length }));
    }
    if (prev && (prev.r !== board.head.r || prev.c !== board.head.c)) {
      dir = { dr: board.head.r - prev.r, dc: board.head.c - prev.c };
    }
    prev = { r: board.head.r, c: board.head.c };
    var step = firstStep(board);
    if (!step) throw new Error('找不到去果实的路 ' + JSON.stringify(board));
    if (step.dr !== dir.dr || step.dc !== dir.dc) {
      await page.keyboard.press(keyFor(step));
    }
    var before = cellKey(board.head.r, board.head.c);
    var moved = false;
    var waitUntil = Date.now() + 1200;
    while (Date.now() < waitUntil) {
      await page.waitForTimeout(30);
      var next = await page.evaluate(script);
      var nowScore = Number(await page.locator('#score').innerText());
      if (nowScore >= target) return nowScore;
      if (next.head && cellKey(next.head.r, next.head.c) !== before) {
        moved = true;
        break;
      }
      var phase = await page.locator('#app').getAttribute('data-phase');
      if (phase === 'paused') {
        await page.keyboard.press('Space');
      }
      if (phase === 'dead') throw new Error('蛇死了，得分 ' + nowScore);
    }
    if (!moved) throw new Error('蛇没有移动');
  }
  throw new Error('超时还没吃到 ' + target + ' 个果实');
}

async function desktop(browser) {
  var opened = await openPage(browser, { width: 1280, height: 820, touch: false });
  var page = opened.page;
  try {
    check('file:// 打开', page.url().indexOf('file://') === 0, page.url());
    var text = await page.locator('body').innerText();
    check('开始界面有 AI 演示按钮', text.indexOf('🤖 看 AI 演示') !== -1);
    await shot(page, 'desktop-start');
    await layout(page, '1280×820', { dpad: false, hints: true, compact: false });

    await page.locator('[data-diff="hard"]').click();
    check('困难高亮', (await page.locator('[data-diff="hard"]').getAttribute('aria-checked')) === 'true');
    check('困难速度 105ms', (await page.locator('#speed').getAttribute('data-speed')) === '105');
    await page.reload();
    await page.waitForSelector('[data-diff="hard"][aria-checked="true"]');
    check('难度刷新后仍是困难', true);

    await page.locator('[data-diff="easy"]').click();
    check('简单速度 230ms', (await page.locator('#speed').getAttribute('data-speed')) === '230');
    await page.locator('#btn-start').click();
    await page.waitForFunction(function () {
      return document.getElementById('app').dataset.phase === 'running';
    });
    var score = await eatUntil(page, 4);
    check('吃到至少 4 分', score >= 4, String(score));
    var level = await page.locator('#speed').getAttribute('data-level');
    var speed = await page.locator('#speed').getAttribute('data-speed');
    check('升级到 2 级以上', Number(level) >= 2, 'level ' + level);
    check('升级后速度变快', speed !== '230', speed);
    var shown = (await page.locator('#score').innerText()).trim();
    check('标题同步得分', (await page.title()) === '得分 ' + shown + ' · 贪吃蛇', await page.title());
    var stored = await page.evaluate(function () { return localStorage.getItem('snake.best'); });
    check('吃到果实时最高分已写入', stored === shown, stored);

    var headBefore = await page.evaluate(readBoardScript());
    await page.keyboard.press('Space');
    await page.waitForFunction(function () {
      return document.getElementById('app').dataset.phase === 'paused';
    });
    check('暂停标题', (await page.title()).indexOf('已暂停 · 得分 ' + shown) === 0, await page.title());
    await page.waitForTimeout(400);
    var headAfter = await page.evaluate(readBoardScript());
    check('暂停时蛇头不动',
      headBefore.head && headAfter.head &&
      headBefore.head.r === headAfter.head.r && headBefore.head.c === headAfter.head.c);
    await page.keyboard.press('Space');
    await page.waitForFunction(function () {
      return document.getElementById('app').dataset.phase === 'running';
    });
    check('暂停后恢复', true);

    var bestBefore = await page.evaluate(function () { return localStorage.getItem('snake.best'); });
    var restarted = await page.evaluate(function () {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }));
      return {
        score: document.getElementById('score').textContent.trim(),
        best: localStorage.getItem('snake.best'),
        phase: document.getElementById('app').dataset.phase
      };
    });
    check('R 重开得分归零', restarted.score === '0', restarted.score);
    check('R 重开不丢最高分', restarted.best === bestBefore && restarted.phase === 'running', JSON.stringify(restarted));

    await page.reload();
    await page.waitForSelector('#best');
    var bestAfterReload = (await page.locator('#best').innerText()).trim();
    check('刷新后最高分还在', bestAfterReload === bestBefore, bestAfterReload);
    check('刷新后难度还在', (await page.locator('[data-diff="easy"]').getAttribute('aria-checked')) === 'true');

    await page.locator('#btn-watch').click();
    await page.waitForSelector('#ai-banner:not([hidden])');
    check('演示条文案', (await page.locator('#ai-banner').innerText()).indexOf('🤖 AI 演示中') !== -1);
    for (var i = 0; i < 6; i++) {
      var rate = (await page.locator('#btn-rate').innerText()).trim();
      if (rate === 'MAX') break;
      await page.locator('#btn-rate').click();
    }
    check('可以切到 MAX', (await page.locator('#btn-rate').innerText()).trim() === 'MAX');
    await shot(page, 'desktop-ai');
    await page.waitForFunction(function () {
      return document.title === '通关 · 得分 397 · 贪吃蛇' &&
        document.body.innerText.indexOf('AI 通关！AI 用 397 个果实填满了整个棋盘') !== -1 &&
        document.getElementById('score').textContent.trim() === '397';
    }, null, { timeout: 70000 });
    check('AI 填满棋盘 397 分', true);
    await shot(page, 'desktop-win');
    check('1280 控制台无报错', opened.errors.length === 0, opened.errors.join(' | '));
  } catch (err) {
    failed += 1;
    console.log('FAIL  1280 流程中断  ' + err.message);
    try { await shot(page, 'desktop-error'); } catch (e) {}
    if (opened.errors.length) console.log('      console ' + opened.errors.join(' | '));
  } finally {
    await opened.context.close();
  }
}

async function smokeMove(page, label, useDpad) {
  await page.locator('#btn-start').click();
  await page.waitForFunction(function () {
    return document.getElementById('app').dataset.phase === 'running';
  });
  var before = await page.evaluate(readBoardScript());
  if (useDpad) await page.locator('#dpad [data-dir="up"]').dispatchEvent('pointerdown');
  else await page.keyboard.press('ArrowUp');
  var turned = false;
  var until = Date.now() + 2500;
  while (Date.now() < until) {
    await page.waitForTimeout(40);
    var now = await page.evaluate(readBoardScript());
    if (now.head && before.head && now.head.r < before.head.r) {
      turned = true;
      break;
    }
  }
  check(label + ' 能转向', turned);
}

async function phone(browser) {
  var opened = await openPage(browser, { width: 390, height: 844, touch: true });
  var page = opened.page;
  try {
    await shot(page, 'phone-start');
    await layout(page, '390×844', { dpad: true, hints: false, compact: false });
    await smokeMove(page, '390×844', true);
    await shot(page, 'phone-play');
    check('390 控制台无报错', opened.errors.length === 0, opened.errors.join(' | '));
  } catch (err) {
    failed += 1;
    console.log('FAIL  390 流程中断  ' + err.message);
    try { await shot(page, 'phone-error'); } catch (e) {}
  } finally {
    await opened.context.close();
  }
}

async function landscape(browser) {
  var opened = await openPage(browser, { width: 844, height: 390, touch: true });
  var page = opened.page;
  try {
    await shot(page, 'land-start');
    await layout(page, '844×390', { dpad: false, hints: false, compact: true });
    await smokeMove(page, '844×390', false);
    check('844 控制台无报错', opened.errors.length === 0, opened.errors.join(' | '));
  } catch (err) {
    failed += 1;
    console.log('FAIL  844 流程中断  ' + err.message);
    try { await shot(page, 'land-error'); } catch (e) {}
  } finally {
    await opened.context.close();
  }
}

async function tiny(browser) {
  var opened = await openPage(browser, { width: 320, height: 568, touch: true });
  var page = opened.page;
  try {
    await shot(page, 'tiny-start');
    await layout(page, '320×568', { dpad: true, hints: false, compact: false });
    var text = await page.locator('body').innerText();
    check('320 看得到 AI 演示', text.indexOf('🤖 看 AI 演示') !== -1);
    check('320 控制台无报错', opened.errors.length === 0, opened.errors.join(' | '));
  } catch (err) {
    failed += 1;
    console.log('FAIL  320 流程中断  ' + err.message);
    try { await shot(page, 'tiny-error'); } catch (e) {}
  } finally {
    await opened.context.close();
  }
}

async function main() {
  var browser = await playwright.chromium.launch({ headless: true });
  try {
    await desktop(browser);
    await phone(browser);
    await landscape(browser);
    await tiny(browser);
  } finally {
    await browser.close();
  }
  if (failed) {
    console.log('\n失败 ' + failed);
    process.exit(1);
  }
  console.log('\n全部通过（0 失败）');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
