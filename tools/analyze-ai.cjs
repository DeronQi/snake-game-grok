#!/usr/bin/env node
'use strict';

/**
 * 对比三种走法在同一批果实上的代价：
 *   1. 纯绕环基线（只走哈密顿环的下一格）
 *   2. 本策略（安全规则 + 抄近路 + 门控）
 *   3. 曼哈顿下界（果实出现时，头到果实的曼哈顿距离之和）
 * 并按果实进度的前 25% / 中段 50% / 后 25% 统计每果实步数。
 */

var SnakeAI = require('../ai.js');

var SEEDS = [1, 2, 3, 4, 5];

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(seed, mode) {
  var rnd = mulberry32(seed);
  var snake = SnakeAI.createInitialSnake();
  var food = SnakeAI.spawnFood(snake, rnd);
  var perFruit = [];
  var bounds = [];
  var since = 0;
  var steps = 0;
  bounds.push(SnakeAI.manhattan(snake[0], food));
  while (snake.length < SnakeAI.N && steps < 200000) {
    var move = SnakeAI.nextMove(snake, food, { mode: mode });
    if (!move) return { ok: false, reason: 'nomove', steps: steps, perFruit: perFruit, bounds: bounds };
    var result = SnakeAI.advance(snake, food, move);
    steps += 1;
    since += 1;
    if (result.dead) return { ok: false, reason: result.reason, steps: steps, perFruit: perFruit, bounds: bounds };
    if (result.ate) {
      perFruit.push(since);
      since = 0;
      if (result.won) break;
      food = SnakeAI.spawnFood(snake, rnd);
      bounds.push(SnakeAI.manhattan(snake[0], food));
    }
  }
  return {
    ok: snake.length === SnakeAI.N && perFruit.length === SnakeAI.FOODS_TO_WIN,
    reason: '',
    steps: steps,
    perFruit: perFruit,
    bounds: bounds
  };
}

function average(list) {
  if (!list.length) return 0;
  var sum = 0;
  for (var i = 0; i < list.length; i++) sum += list[i];
  return sum / list.length;
}

function phases(list) {
  var n = list.length;
  var a = Math.floor(n * 0.25);
  var b = Math.floor(n * 0.75);
  return {
    early: average(list.slice(0, a)),
    mid: average(list.slice(a, b)),
    late: average(list.slice(b)),
    all: average(list),
    total: list.reduce(function (s, v) { return s + v; }, 0),
    count: n
  };
}

function fmt(n) {
  return n.toFixed(1);
}

function printRow(name, stat) {
  console.log(
    name.padEnd(16, ' ') +
    String(Math.round(stat.total)).padStart(8, ' ') +
    fmt(stat.all).padStart(10, ' ') +
    fmt(stat.early).padStart(10, ' ') +
    fmt(stat.mid).padStart(10, ' ') +
    fmt(stat.late).padStart(10, ' ')
  );
}

console.log('棋盘 ' + SnakeAI.SIZE + '×' + SnakeAI.SIZE +
  '  果实 ' + SnakeAI.FOODS_TO_WIN +
  '  种子 ' + SEEDS.join(','));
console.log('每果实步数：前 25% / 中段 50% / 后 25%（按吃到的顺序切分）\n');
console.log(
  '策略'.padEnd(16, ' ') +
  '总步数'.padStart(8, ' ') +
  '每果实'.padStart(10, ' ') +
  '前25%'.padStart(10, ' ') +
  '中50%'.padStart(10, ' ') +
  '后25%'.padStart(10, ' ')
);
console.log('-'.repeat(64));

var failed = 0;
var smartTotals = [];
var cycleTotals = [];
var boundTotals = [];

SEEDS.forEach(function (seed) {
  var smart = run(seed, 'smart');
  var cycle = run(seed, 'cycle');
  if (!smart.ok) {
    failed += 1;
    console.log('FAIL  本策略 seed=' + seed + ' ' + smart.reason);
    return;
  }
  if (!cycle.ok) {
    failed += 1;
    console.log('FAIL  纯绕环 seed=' + seed + ' ' + cycle.reason);
    return;
  }
  var smartStat = phases(smart.perFruit);
  var cycleStat = phases(cycle.perFruit);
  var boundStat = phases(smart.bounds.slice(0, SnakeAI.FOODS_TO_WIN));
  smartTotals.push(smartStat);
  cycleTotals.push(cycleStat);
  boundTotals.push(boundStat);
  console.log('种子 ' + seed);
  printRow('  纯绕环基线', cycleStat);
  printRow('  本策略', smartStat);
  printRow('  曼哈顿下界', boundStat);
  console.log('');
});

function meanStat(list, key) {
  return average(list.map(function (s) { return s[key]; }));
}

if (smartTotals.length) {
  console.log('五局平均');
  console.log(
    '策略'.padEnd(16, ' ') +
    '总步数'.padStart(8, ' ') +
    '每果实'.padStart(10, ' ') +
    '前25%'.padStart(10, ' ') +
    '中50%'.padStart(10, ' ') +
    '后25%'.padStart(10, ' ')
  );
  console.log('-'.repeat(64));
  printRow('纯绕环基线', {
    total: meanStat(cycleTotals, 'total'),
    all: meanStat(cycleTotals, 'all'),
    early: meanStat(cycleTotals, 'early'),
    mid: meanStat(cycleTotals, 'mid'),
    late: meanStat(cycleTotals, 'late')
  });
  printRow('本策略', {
    total: meanStat(smartTotals, 'total'),
    all: meanStat(smartTotals, 'all'),
    early: meanStat(smartTotals, 'early'),
    mid: meanStat(smartTotals, 'mid'),
    late: meanStat(smartTotals, 'late')
  });
  printRow('曼哈顿下界', {
    total: meanStat(boundTotals, 'total'),
    all: meanStat(boundTotals, 'all'),
    early: meanStat(boundTotals, 'early'),
    mid: meanStat(boundTotals, 'mid'),
    late: meanStat(boundTotals, 'late')
  });
  var smartMean = meanStat(smartTotals, 'total');
  var cycleMean = meanStat(cycleTotals, 'total');
  var boundMean = meanStat(boundTotals, 'total');
  console.log('');
  console.log('本策略 / 曼哈顿下界 = ' + (smartMean / boundMean).toFixed(2) + '×');
  console.log('本策略 / 纯绕环     = ' + (smartMean / cycleMean).toFixed(2) + '×');
  console.log('纯绕环比本策略多走 ' + Math.round(cycleMean - smartMean) + ' 步（平均）');
}

if (failed) {
  console.log('\n失败 ' + failed);
  process.exit(1);
}
console.log('\n分析完成（0 失败）');
