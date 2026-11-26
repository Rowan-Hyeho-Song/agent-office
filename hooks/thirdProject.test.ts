// #706: jank-lab as the office's third project, end to end in the pieces that name projects.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECTS, insideProjects } from './classify.mjs'
import { DEFAULT_REPOS, validTask } from './task.mjs'
import { branchesFor } from '../scripts/timeline/build.mjs'
import { projectKind } from '../src/replay/barDraw'
import { deployTitle } from '../src/replay/engine'
import { byFirstPoint } from '../src/replay/store'
import { DEFAULT_TASK_CONFIG, matchRepo } from '../src/signal/events'
import type { Point } from '../src/timeline/types'
import { coverOf, groupLibrary, projectNote, type CoverSource } from '../src/docs/library'

const meta = (o: Partial<CoverSource> & Pick<CoverSource, 'id'>) =>
  coverOf({ kind: 'plan', repo: 'o/agent-office', folder: 1, title: '제목', agents: [], labels: [], grade: 'public', approved: true, created_at: '2026-11-08T01:00:00Z', updated_at: '2026-11-08T01:00:00Z', ...o })

describe('jank-lab is a known project (#706)', () => {
  it('the hook sends from a jank-lab folder and its worktrees, and accepts jank-lab issues', () => {
    expect(DEFAULT_PROJECTS).toContain('**/jank-lab*')
    expect(insideProjects('C:/code/jank-lab/cases/01')).toBe(true)
    expect(insideProjects('/home/me/jank-lab-706/x')).toBe(true)
    expect(DEFAULT_REPOS).toContain('jank-lab')
    expect(validTask('jank-lab', 3)).toEqual({ repo: 'jank-lab', issue: 3 })
  })
  it('the server takes jank-lab tasks and treats it as public', () => {
    expect(matchRepo('jank-lab', DEFAULT_TASK_CONFIG.repos)).toBe('Rowan-Hyeho-Song/jank-lab')
    expect(DEFAULT_TASK_CONFIG.publicRepos).toContain('Rowan-Hyeho-Song/jank-lab')
  })
  it('jank-lab has no dev branch: its main commits are deploys; the others keep dev / main', () => {
    expect(branchesFor('Rowan-Hyeho-Song/jank-lab')).toEqual({ devBranch: null, deployBranch: 'main' })
    expect(branchesFor('Rowan-Hyeho-Song/agent-office')).toEqual({ devBranch: 'dev', deployBranch: 'main' })
  })
})

describe('the library: folder order and notes (docs-ui.md, #706)', () => {
  it('public folders by their latest change, the private folder always last', () => {
    const folders = groupLibrary([
      meta({ id: 1, repo: 'o/agent-office', folder: 1, created_at: '2026-11-20T00:00:00Z' }),
      meta({ id: 2, repo: 'o/jank-lab', folder: 3, created_at: '2026-11-25T00:00:00Z' }),
      meta({ id: 3, grade: 'private', approved: false, repo: 'co/x', folder: 9, created_at: '2026-11-26T00:00:00Z' }),
      meta({ id: 4, repo: 'o/rowansong.dev', folder: 2, created_at: '2026-11-22T00:00:00Z' }),
    ])
    expect(folders.map((f) => f.label)).toEqual(['jank-lab', 'rowansong.dev', 'agent-office', '비공개 프로젝트'])
  })
  it('the three projects carry a short note; an unknown repo and the private folder none', () => {
    expect(projectNote({ repo: 'o/agent-office', label: 'agent-office' })).toBe('이 사무실')
    expect(projectNote({ repo: 'o/rowansong.dev', label: 'rowansong.dev' })).toBe('책상 방')
    expect(projectNote({ repo: 'o/jank-lab', label: 'jank-lab' })).toBe('성능 실험실')
    expect(projectNote({ repo: 'o/other', label: 'other' })).toBeNull()
    expect(projectNote({ repo: null, label: 'jank-lab' })).toBeNull()
  })
})

describe('the timelapse: band and buttons (timelapse.md, #706)', () => {
  it('a band kind per project, anything else plain', () => {
    expect(['o/agent-office', 'o/rowansong.dev', 'o/jank-lab', 'o/else'].map(projectKind)).toEqual(['office', 'hub', 'lab', 'other'])
  })
  it('the buttons keep the design order for the three, then any other by its first point', () => {
    const p = (project: string, at: string) => ({ project, at }) as unknown as Point
    expect(byFirstPoint([p('o/x', '0'), p('o/rowansong.dev', '1'), p('o/jank-lab', '2'), p('o/agent-office', '3'), p('o/y', '4')])).toEqual(['o/agent-office', 'o/rowansong.dev', 'o/jank-lab', 'o/x', 'o/y'])
  })
  it('a jank-lab deploy goes from main to Pages, the others from dev to main', () => {
    const d = (project: string) => ({ project, title: 'feat: x (#4)', pr: null }) as unknown as Point
    expect(deployTitle(d('Rowan-Hyeho-Song/jank-lab'))).toBe('#4 · main → Pages')
    expect(deployTitle(d('Rowan-Hyeho-Song/agent-office'))).toBe('#4 · dev → main')
  })
})
