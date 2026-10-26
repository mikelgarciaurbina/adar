// Pull request entries for branch menus (left panel and graph labels): show a branch's pull
// request, or create one. Only for repositories with a GitHub, GitLab or Bitbucket remote.

import { createElement } from 'react'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import { openWebPage, selectPull, startPullRequest } from '@renderer/actions/pulls'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { providerName, pullForRef, pullNoun, pullRef } from '@renderer/lib/pulls'
import { useApp } from '@renderer/store/appStore'
import type { Ref, RefsResult } from '@shared/types'
import { pullIndexOf, repoHosting, usePulls } from './pullStore'

const icon = (C: typeof GitPullRequest) => createElement(C, { size: 14 })

/** `refs`: a branch label's local branch first, then its remote branches. */
export function branchPullItems(repo: string, refs: readonly Ref[], all: RefsResult | null): MenuItem[] {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  const hosting = repoHosting(tab)
  if (!refs.length || !hosting) return []
  const data = usePulls.getState().repos[repo]?.data ?? null
  const index = pullIndexOf(data, all)
  const pr = refs.map((r) => pullForRef(index, r)).find(Boolean)
  if (pr)
    return [
      { type: 'separator' },
      { label: `Show ${pullNoun(pr.provider)} ${pullRef(pr)}`, icon: icon(GitPullRequest), onClick: () => selectPull(repo, pr.number) },
      { label: `Open ${pullNoun(pr.provider)} on ${providerName(pr)}`, icon: icon(ExternalLink), onClick: () => openWebPage(pr.url) }
    ]
  const local = refs[0]
  if (local.type !== 'branch' || (data && local.name === data.defaultBranch)) return []
  return [{ type: 'separator' }, { label: `Create ${pullNoun(hosting.provider)}…`, icon: icon(GitPullRequest), onClick: () => void startPullRequest(repo, { head: local.name }) }]
}
