// Tab group actions: open or close a whole group, group the repositories of a folder (the `adar`
// command run in a project folder, or that folder picked in Open Repository), name and colour groups,
// and the "group these repositories?" suggestion. Groups live in settings.tabGroups (lib/tabGroups.ts).

import { api } from '@renderer/api/client'
import { choose, form, prompt } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { summarizeList } from '@renderer/lib/format'
import { folderName, groupForFolder, groupOf, groupSuggestion, nextGroupColor, parentFolder } from '@renderer/lib/tabGroups'
import { useApp } from '@renderer/store/appStore'
import { AdarError } from '@shared/errors'
import { TAB_GROUP_COLORS, type FoundRepo, type TabGroupColor } from '@shared/types'
import { fetchAll, initRepoAt, trustAndOpen } from './git'

const store = () => useApp.getState()

/** A folder with more repositories than this is a code folder (~/Projects), not one project. */
const MAX_PROJECT_REPOS = 8

export const GROUP_COLOR_LABELS: Record<TabGroupColor, string> = {
  fern: 'Fern',
  moss: 'Moss',
  sea: 'Sea',
  heather: 'Heather',
  ember: 'Ember',
  sun: 'Sun',
  bone: 'Bone',
  mist: 'Mist'
}

/**
 * Open one repository of a group: asks to trust it if needed, but none of openRepoAt's fallbacks for
 * folders that are not repositories (no "initialize here?" in the middle of opening a group).
 * Resolves to the opened tab's path, 'missing' when the folder is gone or no longer a repository, or null.
 */
async function openMember(path: string): Promise<string | 'missing' | null> {
  try {
    return await store().openRepo(path)
  } catch (err) {
    if (err instanceof AdarError && err.code === 'UNTRUSTED_REPO') return trustAndOpen(path, err)
    if (err instanceof AdarError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_REPO')) return 'missing'
    toast.error(err)
    return null
  }
}

function warnMissing(paths: string[], groupId: string | null): void {
  if (!paths.length) return
  toast.warning(`${summarizeList(paths.map(folderName))} could not be opened: moved, deleted or no longer a repository.`, {
    duration: 0,
    actions: groupId ? [{ label: 'Remove from group', onClick: () => paths.forEach((p) => store().setTabGroup(p, null)) }] : undefined
  })
}

/** Open every repository of a group (open ones stay), expand it and show its first tab. */
export async function openGroup(id: string): Promise<void> {
  const group = store().settings.tabGroups.find((g) => g.id === id)
  if (!group) return
  const missing: string[] = []
  let first: string | null = null
  for (const p of group.repos) {
    if (store().tabs.some((t) => t.path === p)) {
      first ??= p
      continue
    }
    const wasOpen = new Set(store().tabs.map((t) => t.path))
    const opened = await openMember(p)
    if (opened === 'missing') missing.push(p)
    if (typeof opened !== 'string' || opened === 'missing') continue
    if (opened !== p && p.startsWith(`${opened}/`)) {
      // git found an enclosing repository: p itself is no longer one (a removed submodule, a deleted .git).
      missing.push(p)
      if (!wasOpen.has(opened)) await store().closeTab(opened)
      continue
    }
    // The folder resolved to another path (moved behind a symlink…): keep the group pointing at it.
    if (opened !== p && !groupOf(store().settings.tabGroups, opened)) {
      store().setTabGroup(opened, id)
      store().setTabGroup(p, null)
    }
    first ??= opened
  }
  if (store().settings.tabGroups.find((g) => g.id === id)?.collapsed) store().updateGroup(id, { collapsed: false })
  if (first) store().setActive(first)
  warnMissing(missing, id)
}

/** Close the group's tabs; the group itself is kept so it can be reopened. */
export async function closeGroup(id: string): Promise<void> {
  const group = store().settings.tabGroups.find((g) => g.id === id)
  if (!group) return
  for (const t of store().tabs.filter((x) => group.repos.includes(x.path))) await store().closeTab(t.path)
}

/** Default name for a group started from a repository: its parent folder (the project). */
function defaultGroupName(path: string): string {
  return folderName(parentFolder(path)) || folderName(path)
}

/** Ask for a name and colour, then group these open repositories. */
export async function newGroup(paths: string[]): Promise<string | null> {
  if (!paths.length) return null
  const groups = store().settings.tabGroups
  const usedBy = new Map(groups.map((g) => [g.color, g.name || 'Unnamed group']))
  const names = paths.map((p) => store().tabs.find((t) => t.path === p)?.name ?? folderName(p))
  const res = await form({
    title: 'New tab group',
    message: `${summarizeList(names)} ${names.length === 1 ? 'stays' : 'stay'} together in the tab bar, and ${names.length === 1 ? 'opens' : 'open'} together next time.`,
    fields: [
      { type: 'text', name: 'name', label: 'Name', defaultValue: defaultGroupName(paths[0]), required: true },
      {
        type: 'swatches',
        name: 'color',
        label: 'Colour',
        options: TAB_GROUP_COLORS.map((c) => ({
          value: c,
          label: GROUP_COLOR_LABELS[c],
          color: `var(--group-${c})`,
          note: usedBy.has(c) ? `used by ${usedBy.get(c)}` : undefined
        })),
        defaultValue: nextGroupColor(groups)
      }
    ],
    confirmLabel: 'Create group'
  })
  if (!res) return null
  return store().createGroup(paths, { name: String(res.name), color: String(res.color) as TabGroupColor })
}

/** Fetch every open repository of a group (all remotes) side by side, with one toast for the lot. */
export async function fetchGroup(id: string): Promise<void> {
  const group = store().settings.tabGroups.find((g) => g.id === id)
  if (!group) return
  const before = new Map(store().tabs.filter((t) => group.repos.includes(t.path)).map((t) => [t.path, t.lastFetch]))
  if (!before.size) return
  await Promise.all([...before.keys()].map((p) => fetchAll(p, { quiet: true })))
  const fetched = store().tabs.filter((t) => before.has(t.path) && t.lastFetch !== before.get(t.path)).length
  if (fetched) toast.success(`Fetched ${fetched === 1 ? '1 repository' : `${fetched} repositories`} in “${group.name || 'Unnamed group'}”`)
}

export async function renameGroup(id: string): Promise<void> {
  const group = store().settings.tabGroups.find((g) => g.id === id)
  if (!group) return
  const name = await prompt({ title: 'Rename group', label: 'Name', defaultValue: group.name, confirmLabel: 'Rename' })
  if (name !== null) store().updateGroup(id, { name })
}

/**
 * A folder that is not a repository but holds some (a project's api, app, landing…): reopen its saved
 * group, or offer to open them all as a new group named after the folder.
 */
export async function openFolderOfRepos(dir: string, repos: FoundRepo[]): Promise<boolean> {
  // The found repositories carry the folder's real path (symlinks and letter case resolved), like tab paths.
  const folder = (repos[0] && parentFolder(repos[0].path)) || dir
  const saved = groupForFolder(store().settings.tabGroups, folder)
  if (saved) {
    await openGroup(saved.id)
    return true
  }
  const name = folderName(folder)
  const many = repos.length > 1
  const choice = await choose<'group' | 'init'>({
    title: `${name} is not a Git repository`,
    message: `It contains ${many ? `${repos.length} repositories` : 'one repository'}: ${summarizeList(repos.map((r) => r.name), 6)}.`,
    options: [
      many
        ? { value: 'group', label: `Open them as the group “${name}”`, description: 'One tab per repository, kept together in the tab bar.' }
        : { value: 'group', label: `Open ${repos[0].name}`, description: repos[0].path },
      { value: 'init', label: 'Initialize a repository here', description: `Run git init in ${name}.` }
    ]
  })
  if (choice === 'init') return initRepoAt(dir)
  if (choice !== 'group') return false
  const opened: string[] = []
  const missing: string[] = []
  for (const r of repos) {
    const p = await openMember(r.path)
    if (p === 'missing') missing.push(r.path)
    else if (p && !opened.includes(p)) opened.push(p)
  }
  warnMissing(missing, null)
  if (opened.length > 1) {
    // Already one saved group (reached through another spelling of the folder): reopen it, never replace it.
    const groups = store().settings.tabGroups
    const existing = groupOf(groups, opened[0])
    if (existing && opened.every((p) => groupOf(groups, p) === existing)) await openGroup(existing.id)
    else {
      store().createGroup(opened, { name })
      store().setActive(opened[0])
    }
  }
  return opened.length > 0
}

/** Folders already suggested this session (the toast is not repeated). */
const suggested = new Set<string>()

/** After opening a repository: offer to group it with open, ungrouped repositories from the same folder. */
export async function suggestGroup(path: string): Promise<void> {
  const s = store()
  const home = s.appInfo?.homeDir ?? null
  const hit = groupSuggestion(s.tabs, s.settings.tabGroups, path, home)
  if (!hit || suggested.has(hit.folder) || s.settings.groupSuggestionsDismissed.includes(hit.folder)) return
  suggested.add(hit.folder)
  const inFolder = await api.findRepositories(hit.folder).catch(() => [])
  if (inFolder.length > MAX_PROJECT_REPOS) return
  const names = hit.paths.map((p) => store().tabs.find((t) => t.path === p)?.name ?? folderName(p))
  toast.info(`${summarizeList(names)} are in the same folder. Group them as “${hit.name}”?`, {
    duration: 15_000,
    actions: [
      {
        label: 'Group',
        onClick: () => {
          const now = groupSuggestion(store().tabs, store().settings.tabGroups, path, home)
          if (now) store().createGroup(now.paths, { name: now.name })
        }
      },
      {
        label: 'Not for this folder',
        onClick: () => void store().updateSettings({ groupSuggestionsDismissed: [...store().settings.groupSuggestionsDismissed, hit.folder] })
      }
    ]
  })
}
