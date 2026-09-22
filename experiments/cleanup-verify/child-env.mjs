import path from 'node:path';

/** Only these ambient OS/locale values may enter an experiment child. */
export const AMBIENT_ALLOWLIST = Object.freeze([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
]);

const ambientKeys = new Set(AMBIENT_ALLOWLIST);
// Integration change over the reviewed draft (ca751fe +1): the harness also
// passes bridge/wrapper CONTROL variables deliberately — ACP_* (wrap-cli logs)
// and ELECTRON_RUN_AS_NODE (production's spawn sets it; fidelity requires the
// arm to set it too). These still never INHERIT: ambient values enter only via
// AMBIENT_ALLOWLIST above.
// [cleanup-verify local extension] PORT added: this investigation boots the
// real server, which selects its listen port via PORT. No other additions.
const explicitName = /^(?:(?:ZCODE|ANTHROPIC|OPENAI|ACP)_[A-Z0-9_]+|ELECTRON_RUN_AS_NODE|PORT)$/;

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an environment record`);
  }
}

function stringValue(value, name) {
  if (typeof value !== 'string' || value.includes('\0')) {
    // Do not include the rejected value: it could be a credential.
    throw new TypeError(`${name} must be a string without NUL bytes`);
  }
}

/**
 * Build a child environment without implicitly reading process.env or files.
 *
 * The caller creates and owns profileDir and its generated subdirectories.
 * Pass only deliberate provider/model/bundle settings in explicitEnv, never
 * {...process.env}. Provider aliases are allowed when explicitly configured;
 * none are inherited. This is configuration isolation, not an OS sandbox.
 *
 * @param {object} options
 * @param {Record<string, string | undefined>} options.parentEnv
 * @param {string} options.profileDir Absolute disposable HOME root.
 * @param {Record<string, string | undefined>} [options.explicitEnv]
 * @returns {Readonly<Record<string, string>>}
 */
export function buildChildEnv({ parentEnv, profileDir, explicitEnv = {} } = {}) {
  record(parentEnv, 'parentEnv');
  record(explicitEnv, 'explicitEnv');
  stringValue(profileDir, 'profileDir');
  if (!path.isAbsolute(profileDir)) {
    throw new TypeError('profileDir must be absolute');
  }

  const env = Object.create(null);
  for (const [name, value] of Object.entries(parentEnv)) {
    const key = name.toUpperCase();
    if (!ambientKeys.has(key) || value === undefined) continue;
    stringValue(value, key);
    if (Object.hasOwn(env, key) && env[key] !== value) {
      throw new TypeError(`Conflicting case variants for ${key}`);
    }
    env[key] = value;
  }

  const home = path.resolve(profileDir);
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    ZCODE_HOME: path.join(home, '.zcode'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    APPDATA: path.join(home, '.config'),
    LOCALAPPDATA: path.join(home, '.local', 'share'),
    TMPDIR: path.join(home, '.tmp'),
    TMP: path.join(home, '.tmp'),
    TEMP: path.join(home, '.tmp'),
    NO_COLOR: '1',
  });

  for (const [key, value] of Object.entries(explicitEnv)) {
    if (!explicitName.test(key) || key === 'ZCODE_HOME') {
      throw new TypeError(`Explicit environment key is not permitted: ${key}`);
    }
    if (value === undefined) continue;
    stringValue(value, key);
    env[key] = value;
  }
  return Object.freeze(env);
}
