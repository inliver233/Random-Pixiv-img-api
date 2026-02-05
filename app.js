// Single source of truth: app.ts
// Node >=24 supports running/require-ing TypeScript files (type stripping).
const appModule = require('./app.ts');
const app = appModule.default || appModule;

module.exports = app;

if (require.main === module) {
  const runApp = appModule.runApp;
  if (typeof runApp !== 'function') {
    // eslint-disable-next-line no-console
    console.error('runApp() is missing from app.ts');
    process.exit(1);
  }

  Promise.resolve(runApp()).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
