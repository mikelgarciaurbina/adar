### New
- **Compare changed images four ways.** A changed image now opens with an image bar: *Side by side*, *Swipe*, *Onion
  skin* and *Difference*, plus *Fit* (the whole image) and *1:1* (its real pixels). Handy for UI snapshots: you see at
  once what moved. Adar opens images in the mode you used last.
- **Side by side** keeps both images at the same zoom, and at 1:1 they scroll together.
- **Swipe** lays After over Before and cuts it with a line: Before on the left, After on the right. Drag anywhere on
  the image, or use ← → (Shift for bigger steps).
- **Onion skin** fades Before into After with a slider; in between you see both, so what changed looks doubled or
  faint. Space, or a click on the image, flips between the two.
- **Difference** paints every changed pixel in red over a faded After and numbers each changed area. **Ignore
  anti-aliasing** (on by default) leaves out the faint edge differences screenshots get from another machine.
- **N and P**, or the arrows in the diff toolbar, go through the changed areas in every mode, as they go through a
  text file's changes. The line, the slider and the zoom stay as you left them from one file to the next.
- **Images of different sizes** are lined up at the top left, and a file saved again with the same pixels says *No
  visible change*. Everything is compared inside the app; nothing is uploaded.

### Install
**macOS** (Apple Silicon): download `Adar-0.16.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.16.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.16.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.16.0-linux-amd64.deb` with `sudo apt install ./Adar-0.16.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
