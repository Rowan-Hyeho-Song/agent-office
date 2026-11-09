// One GitHub event → the documents and approvals to send (the logic of event.mjs, without the process and the network
// of its own: `gh` is injected, so a test can feed it a recorded event and a fake GitHub).
//
//   issues                    the plan (with fresh progress, #241) + the open-issue count
//   issue_comment             minutes / decision / approval as before; a 🖊 or ✅ also re-sends the plan: the pending count changed
//   pull_request              a merged one files its report as before; any trusted PR re-sends the plan of the issue it names
//   create / delete (branch)  `<type>/<n>-…` re-sends the plan of issue n: the stage may have moved to / from 진행 중
// Progress only ever refreshes the plan of an existing issue written by the owner / a collaborator; a PR or branch never
// creates a document of its own, and a stranger's PR is not even looked at (it could name any issue).

import { approvalForComment, branchIssue, commentKind, docForComment, docForIssue, docForPull, mentions, progressFor, trusted } from './build.mjs'

const MAX_LINKED = 5

/** the issue numbers a PR names (closing keyword / Refs in its body, `<type>/<n>-…` as its head branch) */
export function issuesOfPull(pr) {
  const m = mentions(pr?.body)
  const nums = new Set([...m.closes, ...m.refs])
  const b = branchIssue(pr?.head?.ref)
  if (b) nums.add(b)
  return [...nums].filter((n) => n > 0).slice(0, MAX_LINKED)
}

/**
 * @param {string} name  GITHUB_EVENT_NAME
 * @param {any} event  the event payload
 * @param {string} repo  "owner/name"
 * @param {{ get(path: string): Promise<any>, all(path: string): Promise<any[]>, openIssues(repo: string): Promise<number> }} gh
 */
export async function docsForEvent(name, event, repo, gh) {
  const docs = []
  const approvals = []
  let project
  // the repo's PRs and branches are listed once per event, however many issues it refreshes
  let lists
  const repoLists = () => (lists ??= Promise.all([gh.all(`/repos/${repo}/pulls?state=all`), gh.all(`/repos/${repo}/branches`)]))
  /** the issue's plan with its progress; `issue` is the object GitHub just sent, or the number to fetch */
  const planOf = async (issue, comments) => {
    if (typeof issue === 'number') {
      try {
        issue = await gh.get(`/repos/${repo}/issues/${issue}`)
      } catch (e) {
        if (/ 404 /.test(` ${e?.message} `)) return null // a number that is not an issue here
        throw e
      }
    }
    if (!issue || issue.pull_request || !trusted(issue)) return null
    const [prs, branches] = await repoLists()
    const all = comments ?? (await gh.all(`/repos/${repo}/issues/${issue.number}/comments`))
    return docForIssue(issue, repo, progressFor(issue, { prs, branches, comments: all }))
  }

  if (name === 'issues') {
    const doc = await planOf(event.issue)
    // a newly opened issue assigns work: the planner throws a paper plane to whoever "누가 하나" names (#51)
    if (event.action === 'opened' && doc) doc.meta = { ...doc.meta, opened: true }
    docs.push(doc)
    project = { repo, open_issues: await gh.openIssues(repo) }
  } else if (name === 'issue_comment') {
    const kind = commentKind(event.comment.body)
    const needsAll = kind === 'result' || kind === 'request'
    let comments = needsAll ? await gh.all(`/repos/${repo}/issues/${event.issue.number}/comments`) : []
    // the list may lag behind the event that is being handled
    if (needsAll && !comments.some((c) => c.html_url === event.comment.html_url)) comments = [...comments, event.comment]
    docs.push(docForComment(event.comment, event.issue, repo, comments))
    approvals.push(approvalForComment(event.comment, event.issue, repo, comments))
    // the pending count of the issue's plan changed with this 🖊 / ✅ (only the owner's count)
    if (needsAll && !event.issue.pull_request && trusted(event.comment, ['OWNER'])) docs.push(await planOf(event.issue, comments))
  } else if (name === 'pull_request') {
    const pr = event.pull_request
    docs.push(docForPull(pr, repo))
    if (trusted(pr)) for (const n of issuesOfPull(pr)) docs.push(await planOf(n))
  } else if (name === 'create' || name === 'delete') {
    const n = event.ref_type === 'branch' ? branchIssue(event.ref) : null
    if (n) docs.push(await planOf(n))
  }
  return { docs: docs.filter(Boolean), approvals: approvals.filter(Boolean), project }
}
