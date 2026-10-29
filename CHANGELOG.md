# Changelog

All notable changes to Freemiere Pro are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [2.3.0] — 2026-10-29

### Added
- **Automatic updates.** Freemiere Pro checks GitHub for a new release at launch and every six hours, and installs it with one click (**Freemiere Pro → Check for Updates…**).
- **Gap removal.** Click the empty space between clips to select the gap, then press Delete to close it. Linked audio moves with its video, so nothing goes out of sync. **Sequence → Close Gaps** removes every gap at once.
- **Scale and rotate in the Program monitor.** Drag a corner or edge handle to resize the selected clip, or drag just outside a corner to rotate it. Hold Shift to snap to 5 % / 15° steps. If the property is animated, the change is written as a keyframe.
- Release builds for Apple silicon and Intel Macs, published automatically as DMG and ZIP.

## [2.2.0] — 2026-10-29

### Changed
- The app is now called **Freemiere Pro**. New projects use the `.fpproj` extension; `.flproj` projects from earlier versions still open.

## [2.1.0] — 2026-10-29

### Added
- **Dockable panels.** Drag any panel tab onto another panel to group it, onto an edge to dock it beside, or ⌘-drag it to float. Panels can be resized, closed, reopened (Window menu, ⇧1–⇧7) and maximized (`).
- **Workspaces:** Editing, Effects, Assembly, Audio, Graphics and Classic, each remembering your layout until you reset it.
- **Source monitor editing:** typed In/Out/Duration, draggable range handles, Video/Audio selection, Drag Video Only / Drag Audio Only, and Insert / Overwrite buttons.
- **Source patching** on the timeline track headers, and Program monitor drop zones (Insert, Overwrite, Overlay, Append at End).
- **Linked clips:** video with sound is placed as linked video and audio clips, with Linked Selection, Option-click to pick one side, Link/Unlink (⌘L) and out-of-sync indicators.
- Markers panel, Audio Meters panel and editable timecode displays.

### Fixed
- Mono audio is exported at the same level you hear in the preview.

## [2.0.0] — 2026-10-28

### Added
- Multiple sequences, Source monitor, and the Selection, Track Select Forward, Ripple, Rolling, Rate Stretch, Razor and Slip tools.
- Effects panel: Lumetri Color with looks, Black & White, Gaussian Blur, Sharpen, Mosaic, Vignette, Crop, Flip and Ultra Key, with ellipse and rectangle masks; adjustment layers.
- Video and audio transitions, plus keyframes for position, scale, rotation, opacity, volume and pan.
- Essential Graphics news templates: headline bar, scrolling ticker, lower third, breaking news, live bug and caption box.
- Audio effects and presets, master meters, export of a sequence range, and Export Frame.

## [1.0.0] — 2026-10-28

### Added
- First release: multi-track timeline, trimming and splitting, titles, basic color and motion controls, and H.264 export.
