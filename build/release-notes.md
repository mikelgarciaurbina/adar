### New
- **Edit the message of any commit on your branch**, the latest or an older one, right in the commit panel (pencil
  icon) or from the graph's context menu (*Edit commit message…*). Your working tree, staged changes, stashes and
  ignored files are never touched. If the commit was already pushed, Adar says so before saving and offers a
  **Force push** button afterwards; undo restores the previous history. Signed commits stay signed when
  `commit.gpgSign` is on, and your `commit-msg` hook checks the new message.
- **Tab groups**: keep a project's repositories (say api, app and landing) together under a named, coloured chip.
  Right-click a tab → *Add to New Group…*, or drag tabs into a group; click the chip to collapse it. Groups are
  remembered when their tabs are closed: reopen all their repositories at once from the welcome screen, the **+**
  menu or the command palette.
- `adar <folder>` on a folder that holds several repositories opens them as a group (or reopens its saved group).
  Opening a second repository from the same folder offers to group them.

### Fixed
- Force push (with lease) works in freshly cloned repositories and after git's housekeeping expired old reflog
  entries; it used to be refused as if someone else had pushed.
- Interactive rebase: if amending a message fails (for example a cancelled signing prompt), *Continue* now tries it
  again instead of silently keeping the old message.
- Hovering the warning icon next to a branch shows its tooltip again.

### Install
Download `Adar-0.3.0-arm64.dmg` (Apple Silicon Macs) and drag Adar to Applications. The app is not signed with an
Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

Already on 0.1.0 or 0.2.0? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
