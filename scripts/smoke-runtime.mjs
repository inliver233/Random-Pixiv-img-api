import { execSync } from 'node:child_process';

function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function normalizeCommit(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const m = /[0-9a-f]{7,40}/i.exec(raw);
  return m ? m[0].toLowerCase() : raw;
}

function tryGetLocalCommit() {
  try {
    const out = execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
      windowsHide: true,
    }).toString('utf8');
    return normalizeCommit(out);
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json };
}

function fail(message, extra) {
  const payload = { ok: false, message, ...(extra ?? {}) };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2] || process.env.BASE_URL) || 'http://127.0.0.1:3000';
  const expectedCommit = normalizeCommit(process.env.EXPECTED_COMMIT) || tryGetLocalCommit();

  const healthzUrl = `${baseUrl}/healthz`;
  const versionUrl = `${baseUrl}/version`;

  const [healthz, version] = await Promise.all([
    fetchJson(healthzUrl),
    fetchJson(versionUrl),
  ]);

  if (healthz.res.status !== 200 || !healthz.json || healthz.json.ok !== true) {
    fail('healthz_failed', { url: healthzUrl, status: healthz.res.status, body: healthz.json ?? healthz.text });
    return;
  }

  if (version.res.status !== 200 || !version.json || version.json.ok !== true) {
    fail('version_failed', { url: versionUrl, status: version.res.status, body: version.json ?? version.text });
    return;
  }

  const healthzBuild = healthz.json.build && typeof healthz.json.build === 'object' ? healthz.json.build : {};
  const healthzCommit = normalizeCommit(healthzBuild.commit);
  const versionCommit = normalizeCommit(version.json.commit);

  if (!healthzCommit || !versionCommit) {
    fail('commit_missing', {
      base_url: baseUrl,
      healthz_commit: healthzCommit,
      version_commit: versionCommit,
      expected_commit: expectedCommit,
    });
    return;
  }

  if (healthzCommit !== versionCommit) {
    fail('commit_mismatch_between_healthz_and_version', {
      base_url: baseUrl,
      healthz_commit: healthzCommit,
      version_commit: versionCommit,
      expected_commit: expectedCommit,
    });
    return;
  }

  if (expectedCommit && healthzCommit !== expectedCommit) {
    fail('commit_mismatch_expected', {
      base_url: baseUrl,
      reported_commit: healthzCommit,
      expected_commit: expectedCommit,
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: true,
    base_url: baseUrl,
    version: version.json.version ?? null,
    commit: healthzCommit,
    build_time: version.json.build_time ?? healthzBuild.build_time ?? null,
  }, null, 2));
}

main().catch((err) => {
  fail('runtime_smoke_failed', { error: err instanceof Error ? err.message : String(err) });
});

