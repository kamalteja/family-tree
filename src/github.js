const GITHUB_API = 'https://api.github.com';

function b64url(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function importPrivateKey(pem) {
  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('PKCS#1 key detected. Convert to PKCS#8 first: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem');
  }

  const pemBody = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function createJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: String(appId), iat: now - 60, exp: now + 600 };

  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(input)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${input}.${sigB64}`;
}

export async function getInstallationToken(jwt, installationId) {
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub App token exchange failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.token;
}

async function ghApi(token, method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
    },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${GITHUB_API}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getFileContent(token, owner, repo, path, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return ghApi(token, 'GET', `/repos/${owner}/${repo}/contents/${path}${query}`);
}

export async function findOpenBotPR(token, owner, repo) {
  const prs = await ghApi(token, 'GET', `/repos/${owner}/${repo}/pulls?state=open&per_page=30`);
  const botPR = prs.find(pr => pr.head.ref.startsWith('propose/'));
  return botPR || null;
}

export async function createPR({ token, owner, repo, title, body, files, onProgress }) {
  const report = onProgress || (() => {});

  report('Fetching latest main branch...');
  const ref = await ghApi(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/main`);
  const baseSha = ref.object.sha;

  const baseCommit = await ghApi(token, 'GET', `/repos/${owner}/${repo}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  report('Uploading encrypted files...');
  const treeEntries = [];
  for (const file of files) {
    const blob = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: file.content,
      encoding: file.encoding || 'utf-8',
    });
    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  report('Creating commit...');
  const tree = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const commit = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/commits`, {
    message: title,
    tree: tree.sha,
    parents: [baseSha],
  });

  const branchName = `propose/${Date.now()}`;
  report(`Creating branch ${branchName}...`);
  await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha: commit.sha,
  });

  report('Opening pull request...');
  const pr = await ghApi(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
    title,
    body,
    head: branchName,
    base: 'main',
  });

  return pr;
}
