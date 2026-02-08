const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let cached = null;

function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCommit(value) {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  const normalized = raw.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) return normalized;
  return normalized.toLowerCase();
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findUpFile(startDir, fileName, maxDepth) {
  let dir = startDir;

  for (let i = 0; i <= maxDepth; i += 1) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function readBuildInfoFromFile() {
  const fileName = 'build-info.json';

  const candidates = [
    findUpFile(process.cwd(), fileName, 10),
    findUpFile(__dirname, fileName, 10),
  ].filter(Boolean);

  for (const filePath of candidates) {
    const parsed = readJsonFile(filePath);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  return null;
}

function readVersionFromPackageJson() {
  const fileName = 'package.json';

  const candidates = [
    findUpFile(process.cwd(), fileName, 10),
    findUpFile(__dirname, fileName, 10),
  ].filter(Boolean);

  for (const filePath of candidates) {
    const parsed = readJsonFile(filePath);
    const version = normalizeOptionalText(parsed && parsed.version);
    if (version) return version;
  }

  return null;
}

function readCommitFromGit() {
  try {
    const gitDir = findUpFile(process.cwd(), '.git', 5);
    if (!gitDir) return null;
  } catch {
    return null;
  }

  try {
    const out = execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
      windowsHide: true,
    }).toString('utf8');
    return normalizeCommit(out);
  } catch {
    return null;
  }
}

function resetBuildInfoForTest() {
  cached = null;
}

function getBuildInfo() {
  if (cached) return cached;

  const fileInfo = readBuildInfoFromFile();

  const version = normalizeOptionalText(process.env.APP_VERSION)
    || normalizeOptionalText(fileInfo && fileInfo.version)
    || readVersionFromPackageJson()
    || 'unknown';

  const build_time = normalizeOptionalText(process.env.APP_BUILD_TIME)
    || normalizeOptionalText(process.env.BUILD_TIME)
    || normalizeOptionalText(fileInfo && fileInfo.build_time)
    || normalizeOptionalText(fileInfo && fileInfo.buildTime);

  const commit = normalizeCommit(process.env.APP_COMMIT)
    || normalizeCommit(process.env.GIT_COMMIT)
    || normalizeCommit(process.env.GIT_COMMIT_SHA)
    || normalizeCommit(process.env.COMMIT_SHA)
    || normalizeCommit(process.env.SOURCE_VERSION)
    || normalizeCommit(fileInfo && fileInfo.commit)
    || readCommitFromGit();

  cached = { version, commit, build_time };
  return cached;
}

module.exports = {
  getBuildInfo,
  resetBuildInfoForTest,
};

