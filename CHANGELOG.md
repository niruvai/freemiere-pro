# Changelog

All notable changes to Freemiere Pro are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased] — 2.5.0

### Added
- **Remove Silence** (Clip → Remove Silence…): finds the pauses in talking clips and cuts them out — jump cuts in one step. Choose the loudness threshold, the shortest pause, how much air to keep around speech, and whether to close the gaps on all tracks (keeps graphics and music in sync), only on the clips' tracks, leave the gaps, or just add markers. With several mics, a pause is cut only when everyone is quiet.
- **Hardware export (Apple VideoToolbox)**, several times faster, for H.264 and the new **HEVC / H.265** format. **Apple ProRes 422 and 422 HQ** (MOV) for handing work to other editors. Software encoding stays available; if the hardware encoder refuses a job, the export falls back to software automatically.
- **Speed ramps (time remapping)**: animate Speed with keyframes in Effect Controls, or use Clip → Add Speed Ramp for a ready-made normal → slow motion → normal ramp. As in Premiere, a ramp changes the picture; the clip's own sound is silent while it is ramped (linked audio keeps playing at normal speed).
- **Nested sequences**: Clip → Nest… turns the selected clips into one clip that holds a sequence; double-click it to edit inside. Any sequence can also be inserted into another (right-click its tab). Nests render first on export.
- **Multi-camera editing**: select 2–9 camera clips in the Project panel (⌘-click) → Create Multi-Camera Sequence. Cameras are synchronized by their sound. Press 1–9 while playing to cut between cameras, or use Window → Multi-Camera View (⇧0) for live previews of every angle.
- **LUT (Look File)** effect: apply any 3D .cube LUT with an intensity slider, in preview (GPU) and export.
- **Keyframes for effect parameters**: Lumetri Color, Black & White, Gaussian Blur and LUT intensity can now be animated.
- **Mask tracking**: in an effect's mask, **Track ▶ / ◀ Track** follows the masked area (a face, a number plate) through the clip and writes the mask path as keyframes.
- **Auto Reframe**: Sequence → Auto Reframe Sequence… makes a 9:16, 1:1, 4:5 or 16:9 copy of a sequence; video is scaled to fill and panned to keep the subject (people, faces, movement) in view. Clip → Auto Reframe… does the same for selected clips.
- **Auto-save and crash recovery**: an auto-saved copy is written every 90 seconds while there are unsaved changes (the newest 10 per project are kept). If Freemiere Pro closes unexpectedly, the Home screen offers to recover the work. File → Open Auto-Saved Version… lists every copy.
- **Link Media**: when files have been moved or renamed, a dialog lists the offline media; locate one file and the others in the same folder are found automatically, or search a whole folder.
- **Graphics templates (.fpgfx)**: select titles, news graphics, color mattes, logos and adjustment layers and choose Graphics → Save Selection as Template. Templates appear under My Templates in Essential Graphics, can be dragged into any sequence, and can be exported and shared as files (images travel inside).

### Changed
- Export dialog: new Format and Encoding choices; the file extension follows the format, and the size estimate covers each format.
- Exports stop with a clear message if FFmpeg stops responding, instead of waiting forever.

## [2.4.0] — 2026-11-03

### Added
- **Splash screen** while Freemiere Pro starts, with artwork generated for each release.
- **Home screen** at launch: New Project, Open Project, a Recent list (sequences, last opened, size, filter, right-click to reveal or remove), a Learn page and Check for Updates. Open it any time with **File → Home** (⇧⌘H).
- **New Project dialog:** project name, save location and the first sequence's preset, created and saved in one step.
- **Sequence presets** in New Sequence (⌘N): HD 1080p from 23.976 to 60 fps, 4K UHD, 720p, Vertical 9:16 for Reels/Shorts/TikTok, Square and 4:5 Portrait, or *Automatic*, which matches the first clip you add.
- **File → Close Project** (⇧⌘W) returns to Home.

## [2.3.1] — 2026-10-29

### Fixed
- **Export Video and Export Frame couldn't open the save dialog** on Macs where the Movies or Pictures folder is missing. The dialog now falls back to Desktop, Downloads or your home folder, and remembers the last folder you used.
- If an export can't start, the Export window now shows the reason instead of doing nothing.

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
