import type { NextFunction, Request, Response } from 'express';

const packageJson = require('../../package.json') as { version: string };

const showVersion = (req: Request, res: Response, next: NextFunction) => {
  const appVersion = packageJson.version;
  res.setHeader('X-App-Version', appVersion);
  next();
};

export default showVersion;

