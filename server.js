// ReciPal - Node.js 標準モジュールのみで動くレシピ管理サーバー
// 起動・ポートの選択・ブラウザを開く処理。API などの中身は server/ フォルダにある
const http = require('http');
const { exec } = require('child_process');
const { HOST, BASE_PORT, DATA_DIR, NO_OPEN } = require('./server/config');
const { HttpError, sendJson, checkRequest } = require('./server/http-utils');
const { BACKUP_DIR, backupState } = require('./server/backup');
const { ensureDataFiles } = require('./server/migrate');
const { handleApi } = require('./server/api');
const { serveStatic } = require('./server/static');

// ---------- 起動 ----------

const server = http.createServer(async (req, res) => {
  try {
    checkRequest(req, server.address().port);
    // Host ヘッダーは URL の組み立てに使わない（不正な値で例外になりサーバーが落ちるため）
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'INVALID_REQUEST', 'URL の形式が不正です');
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      sendJson(res, status, status === 500
        ? { code: 'SERVER_ERROR', error: 'サーバーエラー' }
        : { code: err.code, error: err.message });
    } else res.end();
  }
});

function openBrowser(url) {
  if (NO_OPEN) return;
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}

// すでに ReciPal が起動しているか確認する
function isReciPalRunning(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === 'ReciPal');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function listen(port, attempts = 10) {
  server.once('error', async (err) => {
    if (err.code !== 'EADDRINUSE' || attempts <= 1) {
      console.error('サーバーを起動できませんでした:', err.message);
      process.exit(1);
    }
    if (await isReciPalRunning(port)) {
      const url = `http://localhost:${port}`;
      console.log(`ReciPal はすでに起動しています: ${url}`);
      openBrowser(url);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    listen(port + 1, attempts - 1);
  });
  server.listen(port, HOST, () => {
    const url = `http://localhost:${port}`;
    console.log(`ReciPal を起動しました: ${url}`);
    console.log(`データフォルダ: ${DATA_DIR}`);
    console.log(`バックアップ先: ${BACKUP_DIR}`);
    if (backupState.error && backupState.error.code === 'BACKUP_DIR_NOT_ALLOWED') {
      console.error('  → この場所はバックアップ先に使えないため、バックアップは取りません。'
        + 'ReciPal のフォルダの中は、既定の backup フォルダ以外は使えません（環境変数 RECIPAL_BACKUP_DIR を確認してください）。');
    }
    console.log('終了するにはこのウィンドウを閉じるか Ctrl+C を押してください。');
    openBrowser(url);
  });
}

ensureDataFiles()
  .then(() => listen(BASE_PORT))
  .catch((err) => {
    console.error('データファイルの準備に失敗しました:', err.message);
    process.exit(1);
  });
