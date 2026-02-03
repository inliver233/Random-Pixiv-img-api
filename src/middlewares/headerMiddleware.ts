import fs from 'node:fs';
import path from 'node:path';

import type { NextFunction, Request, Response } from 'express';

type PackageJson = { version?: unknown };

function readPackageVersion(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PackageJson;
    if (parsed && typeof parsed.version === 'string') return parsed.version;
  } catch {
    // ignore
  }

  return null;
}

function findUpPackageVersion(startDir: string, maxDepth: number): string | null {
  let dir = startDir;

  for (let i = 0; i <= maxDepth; i++) {
    const version = readPackageVersion(path.join(dir, 'package.json'));
    if (version) return version;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

const appVersion = findUpPackageVersion(process.cwd(), 8) ?? findUpPackageVersion(__dirname, 8) ?? 'unknown';

const showVersion = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-App-Version', appVersion);
  next();
};

export default showVersion;
