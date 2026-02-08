const { getBuildInfo } = require('../utils/buildInfo');

const showVersion = (req, res, next) => {
  const build = getBuildInfo();
  res.setHeader('X-App-Version', build.version || 'unknown');
  if (build.commit) res.setHeader('X-App-Commit', build.commit);
  if (build.build_time) res.setHeader('X-App-Build-Time', build.build_time);
  next();
};

module.exports = showVersion;
