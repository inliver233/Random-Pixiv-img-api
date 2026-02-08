import type { NextFunction, Request, Response } from 'express';

import { getBuildInfo } from '../utils/buildInfo';

const buildInfo = getBuildInfo();

const showVersion = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-App-Version', buildInfo.version);
  if (buildInfo.commit) res.setHeader('X-App-Commit', buildInfo.commit);
  if (buildInfo.build_time) res.setHeader('X-App-Build-Time', buildInfo.build_time);
  next();
};

export default showVersion;
