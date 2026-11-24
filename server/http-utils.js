// HTTP の共通処理：エラー・JSON の返し方・リクエストの読み込み・アクセスの確認
const { MIME } = require('./config');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'TOO_LARGE', 'データが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'JSON の形式が不正です'));
      }
    });
    req.on('error', reject);
  });
}

const methodNotAllowed = () => new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed');

function decodePath(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'URL の形式が不正です');
  }
}

// ローカル専用のサーバーなので、ほかのサイトからのアクセスを拒否する
// - Host が localhost / 127.0.0.1 以外なら拒否する（DNS リバインディングでデータを読まれないように）
// - 更新系は、Origin が自分以外なら拒否し、Content-Type は application/json に限る
//   （閲覧中のほかのサイトから、勝手にデータを書き換えられないように）
function checkRequest(req, port) {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowed.includes(String(req.headers.host || '').toLowerCase())) {
    throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin && !allowed.some((host) => origin.toLowerCase() === `http://${host}`)) {
    throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type は application/json にしてください');
  }
}

module.exports = { HttpError, sendJson, readBody, methodNotAllowed, decodePath, checkRequest };
