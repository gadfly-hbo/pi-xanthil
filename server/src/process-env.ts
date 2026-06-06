/**
 * Shared environment sanitization for child processes.
 * Only allowlisted environment variables are forwarded to subprocess invocations.
 */

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PYTHONPATH",
  "PYTHONHOME",
  "VIRTUAL_ENV",
  "CONDA_DEFAULT_ENV",
  "CONDA_PREFIX",
  "TMPDIR",
  "TEMP",
  "TMP",
] as const;

export function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
