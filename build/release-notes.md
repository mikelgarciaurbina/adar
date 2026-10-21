### New
- **A new look.** Adar now uses Basoa, the design system of [adargit.com](https://adargit.com): a night theme
  (*Gaua*) and a day theme (*Eguna*), the fern accent, and Geist and Geist Mono bundled with the app.
- **The commit graph speaks the same language as the logo.** Commits are rings in their lane colour, HEAD is filled
  with a soft halo, merges are a small dot. Lanes take six colours (fern, moss, sea, heather, ember, sun), the
  checked-out branch's label is solid in its lane colour, tags are bone, and author avatars sit in the Author column.
- **Tab groups read as one piece.** A group is a tray, with its label and tabs tied together by a line in its
  colour. Groups use the eight Basoa colours (saved groups switch to the closest one), the new group dialog picks
  the colour from swatches, and the group's menu has **Fetch All** for all its open repositories.
- **A new welcome screen**, with what *adar* means in Basque: a branch of a tree, and an antler.
- **The diff header fits on one line**: the file, its changes, navigation, view options and actions.

### Install
Download `Adar-0.5.0-arm64.dmg` (Apple Silicon Macs) and drag Adar to Applications. The app is not signed with an
Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

Already using Adar? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
