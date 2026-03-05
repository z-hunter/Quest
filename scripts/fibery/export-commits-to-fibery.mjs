#!/usr/bin/env node

/**
 * Export commits to Fibery with robust error handling.
 *
 * Features:
 * - Upsert by SHA
 * - Batch create/update commands (default batch size: 25)
 * - Retry only failed commands with exponential backoff
 * - Detailed per-command error logging
 * - Source SHAs from push event, COMMIT_SHAS env, or local git log backfill
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';

const fiberyHost = process.env.FIBERY_HOST || 'vsoft.fibery.io';
const fiberyToken = process.env.FIBERY_TOKEN;
if (!fiberyToken) throw new Error('Missing required env: FIBERY_TOKEN');
const fiberyApi = `https://${fiberyHost}/api/commands`;

const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const githubRepo = process.env.GITHUB_REPOSITORY || 'z-hunter/Quest';
const githubRef = process.env.GITHUB_REF || '';
const gitBranch = githubRef.startsWith('refs/heads/')
  ? githubRef.replace('refs/heads/', '')
  : safeExec('git rev-parse --abbrev-ref HEAD') || 'dev';

const commitType = process.env.FIBERY_COMMIT_TYPE || 'Blue Signal Game/Commit';
const branchType =
  process.env.FIBERY_BRANCH_TYPE || 'Blue Signal Game/Branch_Blue Signal Game/Commit';
const repoType =
  process.env.FIBERY_REPO_TYPE || 'Blue Signal Game/Repository_Blue Signal Game/Commit';

const fields = {
  commitSha: process.env.FIBERY_FIELD_COMMIT_SHA || 'Blue Signal Game/SHA',
  commitMessage: process.env.FIBERY_FIELD_COMMIT_MESSAGE || 'Blue Signal Game/Message',
  authorName: process.env.FIBERY_FIELD_AUTHOR_NAME || 'Blue Signal Game/Author Name',
  authorEmail: process.env.FIBERY_FIELD_AUTHOR_EMAIL || 'Blue Signal Game/Author Email',
  commitDate: process.env.FIBERY_FIELD_COMMIT_DATE || 'Blue Signal Game/Commit Date',
  githubLink: process.env.FIBERY_FIELD_GITHUB_LINK || 'Blue Signal Game/GitHub Link',
  parentShas: process.env.FIBERY_FIELD_PARENT_SHAS || 'Blue Signal Game/Parent SHAs',
  commitName: process.env.FIBERY_FIELD_COMMIT_NAME || 'Blue Signal Game/Name',
  branchRel: process.env.FIBERY_FIELD_BRANCH_REL || 'Blue Signal Game/Branch',
  repoRel: process.env.FIBERY_FIELD_REPO_REL || 'Blue Signal Game/Repository',
  relationName: process.env.FIBERY_FIELD_RELATION_NAME || 'enum/name',
};

const branchValue = process.env.FIBERY_BRANCH_VALUE || mapBranchToFibery(gitBranch);
const repoValue = process.env.FIBERY_REPO_VALUE || 'Main Repository';

const batchSize = parseInt(process.env.FIBERY_BATCH_SIZE || '25', 10);
const retryMax = parseInt(process.env.FIBERY_RETRY_MAX || '3', 10);
const retryBaseMs = parseInt(process.env.FIBERY_RETRY_BASE_MS || '250', 10);
const backfillCount = parseInt(process.env.BACKFILL_COUNT || '0', 10);

function mapBranchToFibery(branch) {
  if (branch === 'dev' || branch === 'develop') return 'develop';
  if (branch === 'main' || branch === 'master') return 'main';
  return 'feature';
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFiberyResponse(data) {
  if (Array.isArray(data)) return data;
  return [data];
}

async function postFibery(commands) {
  const res = await fetch(fiberyApi, {
    method: 'POST',
    headers: {
      Authorization: `Token ${fiberyToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Fibery HTTP ${res.status}: ${text}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Fibery response is not JSON: ${text}`);
  }
  return normalizeFiberyResponse(parsed);
}

async function runFiberySingle(commandObj, label) {
  const out = await postFibery([commandObj]);
  const row = out[0];
  if (!row?.success) {
    const errText = row?.error ? JSON.stringify(row.error) : JSON.stringify(row);
    throw new Error(`${label}: ${errText}`);
  }
  return row.result;
}

async function runCommandsInBatches(commandItems) {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < commandItems.length; i += batchSize) {
    const chunk = commandItems.slice(i, i + batchSize);
    const payload = chunk.map((x) => x.command);

    let responseRows;
    try {
      responseRows = await postFibery(payload);
    } catch (e) {
      console.warn(`WARN: batch ${i}-${i + chunk.length - 1} failed: ${e.message}`);
      responseRows = new Array(chunk.length).fill(null).map(() => ({
        success: false,
        error: { message: e.message },
      }));
    }

    for (let idx = 0; idx < chunk.length; idx++) {
      const item = chunk[idx];
      const row = responseRows[idx];
      if (row?.success) {
        success++;
        continue;
      }
      console.warn(`WARN: initial failure for ${item.label}: ${JSON.stringify(row)}`);

      let attempt = 0;
      let ok = false;
      while (attempt < retryMax && !ok) {
        attempt++;
        const delayMs = retryBaseMs * Math.pow(2, attempt - 1);
        await sleep(delayMs);
        try {
          await runFiberySingle(item.command, item.label);
          ok = true;
          success++;
        } catch (err) {
          if (attempt >= retryMax) {
            failed++;
            console.warn(`WARN: ${item.label} failed after ${attempt} attempts: ${err.message}`);
          }
        }
      }
    }
  }

  return { success, failed };
}

async function fiberyQueryOne(typeName, whereField, value) {
  const out = await postFibery([
    {
      command: 'fibery.entity/query',
      args: {
        query: {
          'q/from': typeName,
          'q/select': ['fibery/id', whereField],
          'q/where': ['=', [whereField], '$v'],
          'q/limit': 1,
        },
        params: { $v: value },
      },
    },
  ]);
  const row = out[0];
  if (!row?.success) {
    const errText = row?.error ? JSON.stringify(row.error) : 'Unknown Fibery query error';
    throw new Error(`Query failed (${typeName}, ${whereField}=${value}): ${errText}`);
  }
  const rows = row.result || [];
  return rows.length ? rows[0] : null;
}

async function resolveRelationId(typeName, relationValue) {
  const item = await fiberyQueryOne(typeName, fields.relationName, relationValue);
  if (!item?.['fibery/id']) {
    throw new Error(`Relation value not found in ${typeName}: ${relationValue}`);
  }
  return item['fibery/id'];
}

function readShasFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return [];
  const raw = fs.readFileSync(eventPath, 'utf8');
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.commits)) return [];
  return payload.commits.map((c) => c.id).filter(Boolean);
}

function readShasFromEnv() {
  const raw = (process.env.COMMIT_SHAS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function readShasFromGitLog(limit) {
  const out = safeExec(`git log -n ${limit} --pretty=format:%H`);
  if (!out) return [];
  return out
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

function getCommitDetailsFromLocalGit(sha) {
  const sep = String.fromCharCode(31);
  const fmt = `%H${sep}%P${sep}%an${sep}%ae${sep}%aI${sep}%s`;
  const out = safeExec(`git show -s --date=iso-strict --format=${fmt} ${sha}`);
  if (!out) return null;
  const parts = out.split(sep);
  if (parts.length < 6) return null;
  const parentShas = parts[1]
    ? parts[1]
        .split(' ')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  return {
    sha: parts[0],
    message: parts[5] || '',
    authorName: parts[2] || '',
    authorEmail: parts[3] || '',
    commitDate: parts[4] || '',
    githubLink: `https://github.com/${githubRepo}/commit/${parts[0]}`,
    parentShas,
  };
}

function normalizeCommitDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function fetchCommitDetailsFromGitHub(sha) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quest-fibery-export',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const url = `https://api.github.com/repos/${githubRepo}/commits/${sha}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub fetch failed for ${sha}: HTTP ${res.status} ${text}`);
  }
  const details = await res.json();
  const commit = details.commit || {};
  const commitAuthor = commit.author || {};
  return {
    sha,
    message: commit.message || '',
    authorName: commitAuthor.name || details.author?.login || '',
    authorEmail: commitAuthor.email || '',
    commitDate: commitAuthor.date || commit.committer?.date || '',
    githubLink: details.html_url || `https://github.com/${githubRepo}/commit/${sha}`,
    parentShas: Array.isArray(details.parents) ? details.parents.map((p) => p.sha) : [],
  };
}

async function getCommitDetails(sha) {
  try {
    return await fetchCommitDetailsFromGitHub(sha);
  } catch {
    const local = getCommitDetailsFromLocalGit(sha);
    if (!local) throw new Error(`Cannot resolve commit details for ${sha} from GitHub or local git`);
    return local;
  }
}

function buildCommitEntity(details, branchId, repoId) {
  const shortSha = details.sha.slice(0, 8);
  const firstLineMessage = (details.message || '').split('\n')[0];
  const title = `${shortSha} ${firstLineMessage}`.trim();

  return {
    [fields.commitSha]: details.sha,
    [fields.commitMessage]: details.message || '',
    [fields.authorName]: details.authorName || '',
    [fields.authorEmail]: details.authorEmail || '',
    [fields.commitDate]: normalizeCommitDate(details.commitDate),
    [fields.githubLink]: details.githubLink || `https://github.com/${githubRepo}/commit/${details.sha}`,
    [fields.parentShas]: (details.parentShas || []).join(','),
    [fields.commitName]: title,
    [fields.branchRel]: { 'fibery/id': branchId },
    [fields.repoRel]: { 'fibery/id': repoId },
  };
}

async function main() {
  let shas = readShasFromEnv();
  if (!shas.length) shas = readShasFromEvent();
  if (!shas.length && backfillCount > 0) shas = readShasFromGitLog(backfillCount);
  if (!shas.length) {
    console.log('No commits to export. Provide push event commits, COMMIT_SHAS, or BACKFILL_COUNT.');
    return;
  }

  shas = [...new Set(shas)];
  console.log(`Preparing export for ${shas.length} commit(s)...`);

  const [branchId, repoId] = await Promise.all([
    resolveRelationId(branchType, branchValue),
    resolveRelationId(repoType, repoValue),
  ]);

  const createOrUpdateItems = [];
  for (const sha of shas) {
    try {
      const details = await getCommitDetails(sha);
      const existing = await fiberyQueryOne(commitType, fields.commitSha, sha);
      const entity = buildCommitEntity(details, branchId, repoId);
      if (existing?.['fibery/id']) {
        createOrUpdateItems.push({
          label: `update ${sha}`,
          command: {
            command: 'fibery.entity/update',
            args: {
              type: commitType,
              entity: {
                'fibery/id': existing['fibery/id'],
                ...entity,
              },
            },
          },
        });
      } else {
        createOrUpdateItems.push({
          label: `create ${sha}`,
          command: {
            command: 'fibery.entity/create',
            args: {
              type: commitType,
              entity,
            },
          },
        });
      }
    } catch (e) {
      console.warn(`WARN: skip ${sha}: ${e.message}`);
    }
  }

  const result = await runCommandsInBatches(createOrUpdateItems);
  console.log(
    `Done. commands=${createOrUpdateItems.length} success=${result.success} failed=${result.failed} batchSize=${batchSize}`
  );
}

main().catch((err) => {
  console.warn(`WARN: export failed: ${err.message}`);
  process.exit(0);
});
