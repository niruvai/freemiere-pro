// Ad-hoc signs the macOS app after packaging. Freemiere Pro isn't signed with a
// paid Apple Developer ID; an ad-hoc signature keeps the bundle consistent so
// Apple Silicon Macs run it and Gatekeeper offers "Open Anyway" instead of
// reporting the app as damaged.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
