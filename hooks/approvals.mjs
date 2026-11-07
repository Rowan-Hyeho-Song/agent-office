// Approval results → the text the approval hook hands to the session (#25). Pure, so it's tested.

const cut = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/**
 * @param {{ repo: string, folder: number, kind: string, content: string, result: string, chosen: string|null,
 *           opinion: string|null, result_url: string|null }[]} items  /api/approvals results (oldest first)
 * @returns {string} '' when there is nothing new
 */
export function formatApprovals(items) {
  if (!items?.length) return ''
  const lines = [
    `[사무실 결재함] 주인이 결재한 결과 ${items.length}건이 도착했습니다. 이 세션(같은 역할)이 올린 🖊 결재 요청에 대한 ✅ 결재입니다.`,
  ]
  for (const a of items) {
    const name = String(a.repo).split('/').pop()
    lines.push(`- ${name} #${a.folder} · ${cut(a.kind, 20)}: ${cut(a.content, 120)}`)
    const result = a.chosen ? `${a.result}(${cut(a.chosen, 120)})` : a.result
    lines.push(`  → 결과: ${result}${a.opinion ? ` / 의견: ${cut(a.opinion, 300)}` : ''}${a.result_url ? ` / ${a.result_url}` : ''}`)
  }
  lines.push('결재를 기다리던 일이 있으면 이 결과대로 이어 가세요.')
  return lines.join('\n')
}
