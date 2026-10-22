### Improved
- **The rest of the new design.** The checked-out branch is a highlighted row with a filled dot, also in the toolbar
  and the status bar; every branch in the left panel keeps the colour of its lane in the graph; the selected commit and
  file use the fern highlight; files show their status as a letter (M, A, D, U…); the commit details show the
  commit's lane colour and its branches under the author.
- **Settings, redesigned**: options grouped in cards, and theme cards with a preview of *Gaua* (night), *Eguna* (day)
  and System.
- **A tab bar that fits.** Tabs share the bar and shrink instead of scrolling; when even that is not enough, a list of
  every open repository appears at its end. Tabs inside a group no longer repeat the folder name the group already
  shows.
- **Diff**: change markers on the scrollbar show where a long file changed (click one to jump there), and the header
  no longer repeats the commit the right panel already shows.
- New commits grow into their lane, and switching themes fades between them.

### Install
Download `Adar-0.5.1-arm64.dmg` (Apple Silicon Macs) and drag Adar to Applications. The app is not signed with an
Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

Already using Adar? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
