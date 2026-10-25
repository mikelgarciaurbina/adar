// Pull request entries for branch menus (left panel and graph labels): show a branch's pull
// request, or create one. Only for repositories with a GitHub or Bitbucket remote.

import { createElement } from 'react'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import { openWebPage, selectPull, startPullRequest } from '@renderer/actions/pulls'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { providerName, pullForRef } from '@renderer/lib/pulls'
import { useApp } from '@renderer/store/appStore'
import type { Ref, RefsResult } from '@shared/types'
import { pullIndexOf, repoHosting, usePulls } from './pullStore'

const icon = (C: typeof GitPullRequest) => createElement(C, { size: 14 })

/** `refs`: a branch label's local branch first, then its remote branches. */
export function branchPullItems(repo: string, refs: readonly Ref[], all: RefsResult | null): MenuItem[] {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  if (!refs.length || !repoHosting(tab)) return []
  const data = usePulls.getState().repos[repo]?.data ?? null
  const index = pullIndexOf(data, all)
  const pr = refs.map((r) => pullForRef(index, r)).find(Boolean)
  if (pr)
    return [
      { type: 'separator' },
      { label: `Show pull request #${pr.number}`, icon: icon(GitPullRequest), onClick: () => selectPull(repo, pr.number) },
      { label: `Open pull request on ${providerName(pr)}`, icon: icon(ExternalLink), onClick: () => openWebPage(pr.url) }
    ]
  const local = refs[0]
  if (local.type !== 'branch' || (data && local.name === data.defaultBranch)) return []
  return [{ type: 'separator' }, { label: 'Create pull request…', icon: icon(GitPullRequest), onClick: () => void startPullRequest(repo, { head: local.name }) }]
}
