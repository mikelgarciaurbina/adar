### New
- **`adar` command-line tool** — open the repository you are in from the terminal, like `code .`:
  `adar` opens the current folder's repository, `adar <path>` any other one. Install it once from
  **Adar → Install Command Line Tool…** (or Settings → Integrations). If Adar is already open, the repository
  opens in a new tab.
- **Drop a folder on Adar's Dock icon** to open it.

### Fixed
- Dragging branches now rebases the **checked-out branch**, like GitKraken: drag your current branch onto `main`
  and choose *Rebase &lt;current&gt; onto main* (it offered the opposite before). Fast-forward is hidden when there
  is nothing to fast-forward.
- The app icon no longer has a white frame around it.

### Install
Download `Adar-0.2.0-arm64.dmg` (Apple Silicon Macs) and drag Adar to Applications. The app is not signed with an
Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

Already on 0.1.0? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
