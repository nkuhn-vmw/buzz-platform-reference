import { loadDeployment } from './lib/config.mjs';
import { cfHomeFor, restrictedCFCommand, runCF, verifyLocalTarget } from './lib/cf.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--login-args') {
  const deployment = loadDeployment();
  for (const value of [deployment.api, deployment.org, deployment.space, cfHomeFor(deployment)]) console.log(value);
  process.exit(0);
}
if (args.length === 1 && args[0] === '--verify-target') {
  verifyLocalTarget(loadDeployment());
  console.log('Configured CF target verified.');
  process.exit(0);
}
if (!args.length) {
  console.error('Usage: scripts/cf.mjs <cf command> [arguments...]');
  process.exit(2);
}
if (restrictedCFCommand(args)) {
  console.error('This wrapper refuses CF API, authentication, login, target, logout, and context override commands. Use scripts/cf-login.sh to select the configured target.');
  process.exit(2);
}
try {
  const deployment = loadDeployment();
  const result = runCF(args, { deployment });
  process.exit(result.status);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
