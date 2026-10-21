### Changed
- **The arrows in the diff view now walk the changes of the file**, like GitKraken: previous / next change, with a
  "3 / 12" counter, and the change they land on is highlighted for a moment. Handy in long files. **N / P** and
  **⌥↑ / ⌥↓** do the same. To switch files, pick them in the right panel's file list (or press **[** / **]**).

### Install
Download `Adar-0.3.1-arm64.dmg` (Apple Silicon Macs) and drag Adar to Applications. The app is not signed with an
Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

Already using Adar? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
