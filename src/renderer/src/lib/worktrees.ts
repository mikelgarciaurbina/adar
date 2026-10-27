// Pure helpers for worktrees.

import { folderName, parentFolder } from './tabGroups'

/** A folder for a new worktree: next to the main one, named after it and the branch ("widgets-saved-cards"). */
export function worktreeFolder(main: string, branch: string, attempt = 1): string {
  const slug = (branch.split('/').pop() || branch).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'worktree'
  const sep = main.includes('\\') && !main.includes('/') ? '\\' : '/'
  return `${parentFolder(main)}${sep}${folderName(main)}-${slug}${attempt > 1 ? `-${attempt}` : ''}`
}
