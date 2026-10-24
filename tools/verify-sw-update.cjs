#!/usr/bin/env node
'use strict';

/**
 * 把旧的 index.html / style.css / game.js 塞进 Cache Storage，
 * 在线刷新必须仍执行新代码；断网后再刷新仍能打开。
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var playwright = require('playwright');

var ROOT = path.resolve(__dirname, '..');
var failed = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log('PASS  ' + name);
    return;
  }
  failed += 1;
  console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.webmanifest')) return 'application/manifest+json';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function startServer() {
  var root = path.resolve(ROOT);
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var url = new URL(req.url, 'http://127.0.0.1');
      var rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (rel.indexOf('..') !== -1) {
        res.writeHead(403);
        res.end('no');
        return;
      }
      var file = path.resolve(root, rel || 'index.html');
      if (file !== root && file.indexOf(root + path.sep) !== 0) {
        res.writeHead(403);
        res.end('no');
        return;
      }
      fs.readFile(file, function (err, data) {
        if (err) {
          res.writeHead(404);
          res.end('missing');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType(file),
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

async function main() {
  var server = await startServer();
  var port = server.address().port;
  var origin = 'http://127.0.0.1:' + port + '/';
  var browser = await playwright.chromium.launch({ headless: true });
  var page = await browser.newPage();
  var errors = [];
  page.on('console', function (msg) {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', function (err) {
    errors.push(String(err && err.message || err));
  });
  try {
    await page.goto(origin);
    await page.waitForFunction(function () {
      return navigator.serviceWorker.controller && window.SNAKE_BUILD === 'snake-build-1';
    }, null, { timeout: 15000 });
    var via = await page.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg && reg.updateViaCache;
      });
    });
    check('updateViaCache 为 none', via === 'none', String(via));
    var before = await page.evaluate(function () {
      return {
        build: window.SNAKE_BUILD,
        css: getComputedStyle(document.documentElement).getPropertyValue('--snake-build').trim(),
        caches: caches.keys ? null : null
      };
    });
    check('首次加载是新代码', before.build === 'snake-build-1' && before.css === '1', JSON.stringify(before));

    var poisoned = await page.evaluate(function () {
      var oldHtml = '<!doctype html><html><head><title>OLD</title></head><body>OLD_INDEX</body></html>';
      var oldCss = ':root{--snake-build:0}body{background:rgb(1,2,3)!important}';
      var oldJs = 'globalThis.SNAKE_BUILD="OLD";globalThis.__OLD_GAME=true;';
      return caches.keys().then(function (names) {
        return Promise.all(names.map(function (name) {
          return caches.open(name).then(function (cache) {
            function put(url, body, type) {
              return cache.put(url, new Response(body, {
                headers: { 'Content-Type': type }
              }));
            }
            return Promise.all([
              put(new URL('./', location.href).href, oldHtml, 'text/html'),
              put(new URL('./index.html', location.href).href, oldHtml, 'text/html'),
              put(new URL('./style.css?v=1', location.href).href, oldCss, 'text/css'),
              put(new URL('./game.js?v=1', location.href).href, oldJs, 'text/javascript')
            ]);
          });
        })).then(function () { return names; });
      });
    });
    check('缓存里写入了旧文件', poisoned.length > 0, JSON.stringify(poisoned));

    await page.reload();
    await page.waitForFunction(function () {
      return window.SNAKE_BUILD === 'snake-build-1' && document.querySelector('h1');
    }, null, { timeout: 15000 });
    var online = await page.evaluate(function () {
      return {
        build: window.SNAKE_BUILD,
        old: window.__OLD_GAME === true,
        css: getComputedStyle(document.documentElement).getPropertyValue('--snake-build').trim(),
        title: document.querySelector('h1') && document.querySelector('h1').textContent,
        body: document.body.innerText.slice(0, 80)
      };
    });
    check('刷新后 game.js 仍是新代码', online.build === 'snake-build-1' && online.old === false, JSON.stringify(online));
    check('刷新后 style.css 仍是新代码', online.css === '1', JSON.stringify(online));
    check('刷新后 index.html 仍是新代码', online.title === '贪吃蛇' && online.body.indexOf('OLD_INDEX') === -1, JSON.stringify(online));

    await page.context().setOffline(true);
    await page.reload();
    await page.waitForFunction(function () {
      return window.SNAKE_BUILD === 'snake-build-1' && document.querySelector('h1');
    }, null, { timeout: 15000 });
    var offline = await page.evaluate(function () {
      return {
        build: window.SNAKE_BUILD,
        title: document.querySelector('h1') && document.querySelector('h1').textContent
      };
    });
    check('断网刷新仍能打开', offline.build === 'snake-build-1' && offline.title === '贪吃蛇', JSON.stringify(offline));
    check('Service Worker 控制台无报错', errors.length === 0, errors.join(' | '));
  } catch (err) {
    failed += 1;
    console.log('FAIL  SW 流程中断  ' + (err && err.stack || err));
    if (errors.length) console.log('      console ' + errors.join(' | '));
  } finally {
    await browser.close();
    await new Promise(function (resolve) { server.close(resolve); });
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
