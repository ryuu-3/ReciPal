const fs = require('fs/promises');
const path = require('path');
const { PUBLIC_DIR, MIME } = require('./config');
const { HttpError, methodNotAllowed, decodePath } = require('./http-utils');

// 静的ファイル（public）を返す

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed();
  const rel = decodePath(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'FORBIDDEN', 'Forbidden');

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Not Found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

module.exports = { serveStatic };
