import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
for (const [command, args] of [
  ['npm', ['test', '--prefix', 'plugin']],
  [process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['npm', ['run', 'build', '--prefix', 'plugin']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
