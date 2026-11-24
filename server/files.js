// ファイル・フォルダの小さな共通処理
const fs = require('fs/promises');
const path = require('path');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// child が parent そのものか、その中にあるか（Windows では大文字・小文字を区別しない）
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = { exists, isInside };
