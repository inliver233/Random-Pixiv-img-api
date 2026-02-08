import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type BuildInfo = {
  version: string;
  commit: string | null;
  build_time: string | null;
};

type PartialBuildInfo = {
  version?: unknown;
  commit?: unknown;
  build_time?: unknown;
  buildTime?: unknown;
};

let cached: BuildInfo | null = null;

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCommit(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  const normalized = raw.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) return normalized;
  return normalized.toLowerCase();
}

function readJsonFile(filePath: string): any | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findUpFile(startDir: string, fileName: string, maxDepth: number): string | null {
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

function readBuildInfoFromFile(): PartialBuildInfo | null {
  const fileName = 'build-info.json';

  const candidates = [
    findUpFile(process.cwd(), fileName, 10),
    findUpFile(__dirname, fileName, 10),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    const parsed = readJsonFile(filePath);
    if (parsed && typeof parsed === 'object') return parsed as PartialBuildInfo;
  }

  return null;
}

function readVersionFromPackageJson(): string | null {
  const fileName = 'package.json';

  const candidates = [
    findUpFile(process.cwd(), fileName, 10),
    findUpFile(__dirname, fileName, 10),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    const parsed = readJsonFile(filePath) as { version?: unknown } | null;
    const version = normalizeOptionalText(parsed?.version);
    if (version) return version;
  }

  return null;
}

function readCommitFromGit(): string | null {
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

export function resetBuildInfoForTest(): void {
  cached = null;
}

export function getBuildInfo(): BuildInfo {
  if (cached) return cached;

  const fileInfo = readBuildInfoFromFile();

  const version = normalizeOptionalText(process.env.APP_VERSION)
    ?? normalizeOptionalText(fileInfo?.version)
    ?? readVersionFromPackageJson()
    ?? 'unknown';

  const build_time = normalizeOptionalText(process.env.APP_BUILD_TIME)
    ?? normalizeOptionalText(process.env.BUILD_TIME)
    ?? normalizeOptionalText(fileInfo?.build_time)
    ?? normalizeOptionalText(fileInfo?.buildTime);

  const commit = normalizeCommit(process.env.APP_COMMIT)
    ?? normalizeCommit(process.env.GIT_COMMIT)
    ?? normalizeCommit(process.env.GIT_COMMIT_SHA)
    ?? normalizeCommit(process.env.COMMIT_SHA)
    ?? normalizeCommit(process.env.SOURCE_VERSION)
    ?? normalizeCommit(fileInfo?.commit)
    ?? readCommitFromGit();

  cached = { version, commit, build_time };
  return cached;
}

