// テスト用にサーバーを起動・停止する共通処理
// 本物の data・backup に触れないよう、一時フォルダにプログラム（server.js・server・public）をコピーし、
// その中にテスト用のデータを置いてから起動する。終わったら一時フォルダごと消す
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP_FILES = ['server.js', 'server', 'public'];

// 今日の日付（サーバーと同じく PC のタイムゾーン）を YYYY-MM-DD で返す
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 起動時のメッセージ（「ReciPal を起動しました: http://localhost:3000」から「終了するには…」まで）が出るまで待つ。
// すでに ReciPal が動いているポートに当たったとき（並列で動くほかのテストなど）は null を返す
function waitForStart(child, output) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`サーバーが起動しませんでした:\n${output.text}`)), 10000);
    const onData = (chunk) => {
      output.text += chunk;
      const started = output.text.includes('終了するには') && output.text.match(/ReciPal を起動しました: http:\/\/localhost:(\d+)/);
      if (started || output.text.includes('すでに起動しています')) {
        clearTimeout(timer);
        resolve(started ? Number(started[1]) : null);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => (output.text += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!/ReciPal を起動しました/.test(output.text)) resolve(null);
      else if (code) reject(new Error(`サーバーが終了しました（${code}）:\n${output.text}`));
    });
  });
}

/**
 * テスト用のサーバーを起動する
 * @param {object} options
 * @param {object} [options.data]  data フォルダに置くファイル（{ 'recipes.json': [...] }）
 * @param {object} [options.env]   追加の環境変数（RECIPAL_BACKUP_DIR など）
 * @param {(dir: string) => void} [options.setup]  起動前に一時フォルダを準備する処理
 */
async function startServer({ data, env = {}, setup } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipal-test-'));
  for (const name of APP_FILES) fs.cpSync(path.join(ROOT, name), path.join(dir, name), { recursive: true });
  if (data) {
    fs.mkdirSync(path.join(dir, 'data'));
    for (const [file, value] of Object.entries(data)) {
      fs.writeFileSync(path.join(dir, 'data', file), typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  if (setup) setup(dir);

  // PC で設定した PORT や RECIPAL_BACKUP_DIR を引き継がない（本物のバックアップ先に書き込まないように）
  const baseEnv = { ...process.env };
  delete baseEnv.PORT;
  delete baseEnv.RECIPAL_BACKUP_DIR;

  for (let attempt = 0; attempt < 5; attempt++) {
    const output = { text: '' };
    const child = spawn(process.execPath, ['server.js', '--no-open'], {
      cwd: dir,
      env: { ...baseEnv, PORT: String(20000 + Math.floor(Math.random() * 30000)), ...env },
    });
    const port = await waitForStart(child, output);
    if (port) return createHandle(dir, child, port, output);
    child.kill();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  throw new Error('空いているポートが見つかりませんでした');
}

function createHandle(dir, child, port, output) {
  // API にリクエストを送る。GET・HEAD 以外は画面と同じく Content-Type: application/json を付ける
  function request(method, urlPath, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          Host: `localhost:${port}`,
          ...(method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, body: json });
        });
      });
      req.on('error', reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  return {
    dir,
    port,
    output: () => output.text,
    // コンソールの出力に pattern が現れるまで待つ（警告は標準エラー出力に出るので、届く順番が前後することがある）
    async waitForOutput(pattern, timeout = 2000) {
      const end = Date.now() + timeout;
      while (!pattern.test(output.text)) {
        if (Date.now() > end) throw new Error(`コンソールに ${pattern} が出ませんでした:\n${output.text}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    request,
    get: (p, opts) => request('GET', p, opts),
    post: (p, body, opts) => request('POST', p, { ...opts, body }),
    put: (p, body, opts) => request('PUT', p, { ...opts, body }),
    patch: (p, body, opts) => request('PATCH', p, { ...opts, body }),
    del: (p, opts) => request('DELETE', p, opts),
    // data フォルダのファイルを読む（ないときは undefined）
    readData(file) {
      const p = path.join(dir, 'data', file);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : undefined;
    },
    async stop() {
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill();
        });
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { ROOT, startServer, localDate };
