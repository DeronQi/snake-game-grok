#!/usr/bin/env node
'use strict';

/**
 * 与游戏同一套规则的无头模拟：4 档难度 × 5 个种子。
 * 难度只改速度，路径应一致；每一局都必须吃满 397 个果实、填满 400 格。
 */

var SnakeAI = require('../ai.js');

var SEEDS = [1, 2, 3, 4, 5];
var DIFFS = ['easy', 'normal', 'hard', 'insane'];
var EXPECTED = {
  easy: { base: 230, min: 150 },
  normal: { base: 150, min: 78 },
  hard: { base: 105, min: 58 },
  insane: { base: 70, min: 38 }
};

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

function simulate(seed) {
  var rnd = mulberry32(seed);
  var snake = SnakeAI.createInitialSnake();
  var food = SnakeAI.spawnFood(snake, rnd);
  var foods = 0;
  var steps = 0;
  var dead = false;
  var reason = '';
  var started = Date.now();
  while (snake.length < SnakeAI.N && steps < 200000) {
    var move = SnakeAI.nextMove(snake, food);
    if (!move) {
      dead = true;
      reason = 'nomove';
      break;
    }
    var result = SnakeAI.advance(snake, food, move);
    steps += 1;
    if (result.dead) {
      dead = true;
      reason = result.reason;
      break;
    }
    if (result.ate) {
      foods += 1;
      if (result.won) break;
      food = SnakeAI.spawnFood(snake, rnd);
      if (!food) {
        dead = true;
        reason = 'nofood';
        break;
      }
    }
  }
  return {
    seed: seed,
    steps: steps,
    foods: foods,
    length: snake.length,
    dead: dead,
    won: !dead && snake.length === SnakeAI.N && foods === SnakeAI.FOODS_TO_WIN,
    reason: reason,
    ms: Date.now() - started
  };
}

var failed = 0;

function fail(message) {
  failed += 1;
  console.log('FAIL  ' + message);
}

DIFFS.forEach(function (name) {
  var spec = EXPECTED[name];
  if (SnakeAI.speedMs(name, 1) !== spec.base || SnakeAI.speedMs(name, 10) !== spec.min) {
    fail(name + ' 速度应为 ' + spec.base + '→' + spec.min + '，实际 ' +
      SnakeAI.speedMs(name, 1) + '→' + SnakeAI.speedMs(name, 10));
  } else {
    console.log('PASS  速度 ' + name + '  ' + spec.base + '→' + spec.min + ' ms');
  }
});

if (SnakeAI.levelForScore(0) !== 1 || SnakeAI.levelForScore(3) !== 1 ||
    SnakeAI.levelForScore(4) !== 2 || SnakeAI.levelForScore(36) !== 10 ||
    SnakeAI.levelForScore(397) !== 10) {
  fail('升级曲线不符合每 4 分 1 级、最高 10 级');
} else {
  console.log('PASS  升级曲线 每 4 分 1 级，最高 10 级');
}

var stepsBySeed = {};

DIFFS.forEach(function (name) {
  SEEDS.forEach(function (seed) {
    var result = simulate(seed);
    var label = name + '  seed=' + seed +
      '  steps=' + result.steps +
      '  foods=' + result.foods +
      '  len=' + result.length +
      '  ' + result.ms + 'ms';
    if (!result.won) {
      fail(label + '  reason=' + (result.reason || 'incomplete'));
      return;
    }
    console.log('PASS  ' + label);
    if (stepsBySeed[seed] == null) stepsBySeed[seed] = result.steps;
    else if (stepsBySeed[seed] !== result.steps) {
      fail(name + ' seed=' + seed + ' 的步数与其他难度不一致');
    }
  });
});

if (failed) {
  console.log('\n失败 ' + failed);
  process.exit(1);
}
console.log('\n全部通过（0 失败）');
