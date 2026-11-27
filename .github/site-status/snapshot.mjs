// Builds the GitHub part of the Site Status Board: one row per repository.
// Reads only public data with the workflow's own token. Prints JSON {rows, meta}.
const owner = process.env.OWNER;
const token = process.env.GH_TOKEN;
const extra = (process.env.EXTRA_REPOS || '').split(/[\s,]+/).filter(Boolean);

async function gh(path) {
  const r = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const repos = [];
for (let page = 1; ; page++) {
  const batch = await gh(`/users/${owner}/repos?type=owner&per_page=100&page=${page}`);
  if (!batch || !batch.length) break;
  repos.push(...batch);
  if (batch.length < 100) break;
}

const rows = [];
for (const r of repos.filter((x) => !x.fork).sort((a, b) => a.name.localeCompare(b.name))) {
  const full = `${owner}/${r.name}`;
  const [runs, pages, prs] = await Promise.all([
    gh(`/repos/${full}/actions/runs?per_page=1`).catch(() => null),
    r.has_pages ? gh(`/repos/${full}/pages`).catch(() => null) : null,
    gh(`/repos/${full}/pulls?state=open&per_page=100`).catch(() => null),
  ]);
  const last = runs && runs.workflow_runs && runs.workflow_runs[0];
  rows.push({
    repo: r.name,
    url: r.html_url,
    description: r.description || '',
    pages: !!r.has_pages,
    pages_url: r.has_pages ? (pages && pages.html_url) || `https://${owner}.github.io/${r.name === owner + '.github.io' ? '' : r.name + '/'}` : '',
    last_push: r.pushed_at,
    archived: !!r.archived,
    runs_total: runs ? runs.total_count : 0,
    last_run: last ? last.name : '',
    last_run_result: last ? (last.conclusion || last.status) : 'none',
    last_run_at: last ? last.created_at : '',
    last_run_url: last ? last.html_url : '',
    open_prs: Array.isArray(prs) ? prs.length : 0,
    // Dependabot settings need an admin token, which this job does not have.
    dependabot: 'unknown',
    reachable: true,
  });
}

const missing = [];
for (const name of extra) {
  if (rows.some((x) => x.repo.toLowerCase() === name.toLowerCase())) continue;
  const r = await gh(`/repos/${owner}/${name}`).catch(() => null);
  if (r) continue;
  missing.push(`${owner}/${name}`);
  rows.push({
    repo: name, url: `https://github.com/${owner}/${name}`, description: 'Netlify still builds from this repository, but GitHub does not show it.',
    pages: false, pages_url: '', last_push: '', archived: false, runs_total: 0, last_run: '', last_run_result: 'none',
    last_run_at: '', last_run_url: '', open_prs: 0, dependabot: 'unknown', reachable: false,
  });
}

const meta = [{ label: 'Taken', value: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the GitHub API for ${owner}, by the Site status workflow` }];
if (missing.length) meta.push({ label: 'Not reachable', value: missing.join(', ') + ' (private, renamed or deleted)' });
process.stdout.write(JSON.stringify({ rows, meta }, null, 1) + '\n');
