# Frameline — ম্যাকের জন্য ভিডিও এডিটর

Premiere Pro-এর মতো কাজের ধারায় বানানো ভিডিও এডিটর। বাঁয়ে Project / Effects / Essential Graphics, মাঝে Program আর Source মনিটর, ডানে Effect Controls, নিচে একাধিক সিকোয়েন্সের মাল্টি-ট্র্যাক টাইমলাইন আর অডিও মিটার। Electron আর FFmpeg দিয়ে তৈরি, এক্সপোর্ট হয় H.264 MP4।

## চালানোর নিয়ম

ম্যাকে **Node.js** লাগবে। Terminal-এ:

```bash
git clone https://github.com/niruvai/freemiere-pro
cd freemiere-pro
npm install
npm start
```

`npm start` প্রতিবার চালু হওয়ার আগে দেখে নেয় Electron আর FFmpeg ঠিকমতো বসেছে কিনা। না বসলে নিজেই ডাউনলোড করে নেয়। তাই npm-এর নতুন ভার্সন install script বন্ধ রাখলেও (`Electron failed to install correctly` error) এখন আর কিছু করতে হবে না। চাইলে আলাদাভাবে `npm run setup` চালানো যায়।

### আসল ম্যাক অ্যাপ (.dmg)

```bash
npm run dist
```

`dist/` ফোল্ডারে DMG তৈরি হবে। অ্যাপটা Apple-এ সাইন করা নয়, তাই প্রথমবার Applications-এ Frameline-এ রাইট-ক্লিক করে **Open** চাপুন। (না খুললে `xattr -cr /Applications/Frameline.app`।)

## Premiere-এর যে সুবিধাগুলো আছে

**প্রজেক্ট ও সিকোয়েন্স**
- একাধিক সিকোয়েন্স, টাইমলাইনের ওপরে ট্যাবে (নতুন, ডুপ্লিকেট, রিনেম, ডিলিট)
- Sequence Settings: 1080p, 4K, 720p, Vertical (Reels/Shorts), Square, 4:5 বা কাস্টম; 23.976–60 fps
- Clip থেকে নতুন সিকোয়েন্স (ক্লিপের সাইজ আর fps মিলিয়ে)
- পুরনো (1.x) প্রজেক্ট ফাইল নিজে থেকেই নতুন ফরম্যাটে খোলে

**প্যানেল যেখানে খুশি রাখা (Premiere-এর মতো ডকিং)**
- যেকোনো প্যানেলের ট্যাব (Project, Source, Program, Effect Controls, Effects, Essential Graphics, Markers, Timeline, Audio Meters) টেনে নিয়ে যান:
  - অন্য প্যানেলের **মাঝখানে বা ট্যাবের সারিতে** ছাড়লে → সেখানে ট্যাব হিসেবে যোগ হয়
  - অন্য প্যানেলের **বাঁ/ডান/ওপর/নিচের কিনারায়** ছাড়লে → তার পাশে আলাদা জায়গা নেয় (নীল ঘর দেখায় কোথায় বসবে)
  - **⌘ চেপে** টানলে → আলাদা ভাসমান উইন্ডো হয়ে যায়
- প্যানেলের মাঝের দাগ টেনে সাইজ বদলান; `` ` `` চাপলে প্যানেল বড় হয়/আগের মতো হয়
- ট্যাবের ≡ মেনু: Close, Undock, Maximize; বন্ধ প্যানেল আবার আনতে Window মেনু বা ⇧1–⇧7
- ওপরে Workspace: Editing, Effects, Assembly, Audio, Graphics, Classic — আপনার সাজানো লেআউট মনে থাকে; ⋯ মেনু থেকে "Reset to Saved Layout"
- যে প্যানেলে ক্লিক করবেন সেটা নীল বর্ডারে focused হয়, কিবোর্ড শর্টকাট সেই প্যানেলেই কাজ করে (যেমন Source focused থাকলে Space/I/O Source-এ)

**Source মনিটর — কতটুকু কাটবেন, ভিডিও নাকি অডিও নেবেন**
- Project-এ ক্লিপে ডাবল-ক্লিক করলে (বা Source-এ টেনে আনলে) Source মনিটরে খোলে
- In/Out ঠিক করার চারটা উপায়: `I`/`O` চাপা; [ ] বাটন; নিচের নীল দাগের দুই মাথা টানা; অথবা **In / Out / Duration ঘরে সময় লিখে দেওয়া** (যেমন `2`, `1:30`, `00:00:05:00`)
- **Video ☑ / Audio ☑** টিক দিয়ে বেছে নিন শুধু ছবি, শুধু শব্দ, নাকি দুটোই নেবেন
- টাইমলাইনে আনার উপায়:
  - **Insert** (`,`) — প্লেহেডে ঢোকায়, পরের ক্লিপগুলো ডানে সরে যায়
  - **Overwrite** (`.`) — প্লেহেডে বসায়, নিচে যা ছিল তার ওপরে
  - ছবিটা টেনে টাইমলাইনের যেকোনো ট্র্যাকে ছাড়ুন (⌘ চেপে ছাড়লে Insert)
  - নিচের 🎞 আইকন টানলে **শুধু ভিডিও**, 〰 আইকন টানলে **শুধু অডিও**
  - Program মনিটরে টেনে আনলে Insert / Overwrite / Overlay / Append at End বেছে নেওয়ার ঘর দেখায়
- **Source patching**: টাইমলাইনের বাঁ পাশের নীল **V1 / A1** লেবেল দেখায় Insert/Overwrite কোন ট্র্যাকে যাবে। অন্য ট্র্যাকের খালি ঘরে ক্লিক করলে সেখানে সরে যায়; জ্বলা লেবেলে ক্লিক করলে বন্ধ হয়
- প্রতিটা ক্লিপের In/Out মনে থাকে, প্রজেক্টে সেভ হয়

**Linked ভিডিও + অডিও**
- শব্দসহ ভিডিও টাইমলাইনে দিলে Premiere-এর মতো দুটো ক্লিপ হয়: ছবি V ট্র্যাকে, শব্দ A ট্র্যাকে (নামের পাশে [V] / [A]), দুটো একসাথে linked
- ক্লিক করলে দুটোই সিলেক্ট হয়; সরানো, ট্রিম, কাটা (Razor/⌘K), Slip, Rate Stretch দুটোতেই একসাথে হয়
- **⌥-ক্লিক** করলে শুধু একটা দিক; টুলবারের 🔗 বাটনে Linked Selection চালু/বন্ধ
- **⌘L** দিয়ে Link / Unlink; আলাদা হয়ে sync নষ্ট হলে লাল সংখ্যা দেখায় কত ফ্রেম সরে গেছে
- Effect Controls-এ linked জোড়া সিলেক্ট থাকলে Video আর Audio দুই অংশই একসাথে দেখায়

**টাইমলাইন টুল (Premiere-এর একই শর্টকাট)**
- Selection (V), Track Select Forward (A), Ripple Edit (B), Rolling Edit (N), Rate Stretch (R), Razor (C), Slip (Y)
- একাধিক ক্লিপ সিলেক্ট (Shift-ক্লিক বা খালি জায়গায় টেনে মার্কি), একসাথে সরানো
- Option-টেনে ডুপ্লিকেট, ⌘-টেনে কিনারা ধরলে ripple trim
- Add Edit (⌘K / ⇧⌘K), Q/W ripple trim, Lift (;) / Extract (')
- In/Out (I, O, ⌥X), মার্কার (M; নাম আর রং বদলানো যায়), স্ন্যাপিং (S)
- ট্র্যাক লক, আউটপুট অন/অফ, অডিও Mute/Solo, ট্র্যাকের নাম বদল
- Copy/Paste, Paste Attributes (⌥⌘V), Undo/Redo (২০০ ধাপ)

**Effect Controls ও কীফ্রেম**
- Motion (Position, Scale, Rotation), Opacity, Volume, Panner — প্রতিটির পাশে স্টপওয়াচ দিয়ে কীফ্রেম অ্যানিমেশন, আগের/পরের কীফ্রেমে যাওয়া
- মনিটরে ক্লিপ সরাসরি টেনে সরানো (কীফ্রেম চালু থাকলে কীফ্রেম বসে)
- Speed / Duration, Fade in/out

**ইফেক্ট (Effects প্যানেল থেকে ক্লিপে টেনে আনুন)**
- Lumetri Color (Exposure, Contrast, Temperature, Tint, Saturation, Faded Film) + ৮টি রেডি Look
- Black & White, Gaussian Blur, Sharpen, Mosaic, Vignette, Crop, Horizontal/Vertical Flip, Ultra Key (গ্রিন স্ক্রিন)
- **মাস্ক**: Blur/Mosaic/Lumetri ইত্যাদি শুধু একটা ডিম্বাকার বা চতুর্ভুজ জায়গায় — মুখ বা নাম্বার প্লেট ঝাপসা করার জন্য। মনিটরে টেনে মাস্ক সরানো যায়, feather আর invert আছে
- **Adjustment Layer**: এর ইফেক্ট নিচের সব ট্র্যাকে প্রয়োগ হয়
- Color Matte

**ট্রানজিশন**
- ভিডিও: Cross Dissolve, Dip to Black/White, Push (৪ দিক), Wipe (৪ দিক), Iris Round, Clock Wipe, Cross Zoom
- অডিও: Constant Power, Constant Gain, Exponential Fade
- ⌘D দিলে Cross Dissolve, ⇧⌘D দিলে অডিও crossfade; ট্রানজিশনে ক্লিক করে ধরন আর সময় বদলানো

**অডিও**
- Web Audio দিয়ে লাইভ প্রিভিউ: ভলিউম ৪০০% পর্যন্ত, Panner, Simple EQ, Highpass/Lowpass, Compressor, Gain
- DeNoise (এক্সপোর্টে প্রয়োগ হয়)
- প্রিসেট: Voice Clean-up, Background Music (−12 dB), Phone/Radio Voice, Loud & Punchy
- মাস্টার অডিও মিটার (dB স্কেল, পিক হোল্ড, ক্লিপ ইন্ডিকেটর)
- Link / Unlink (⌘L) — পুরনো প্রজেক্টের ভিডিওর শব্দ আলাদা অডিও ট্র্যাকে নামিয়ে দেয়

**Essential Graphics (নিউজ টেমপ্লেট)**
- News Headline Bar (লাল "শিরোনাম" লেবেল + সাদা বার)
- Scrolling Ticker (চলমান খবর, প্রতি লাইনে একটা খবর, গতি বদলানো যায়)
- Lower Third (নাম + পদবি), Breaking News ব্যানার, Live Bug (LIVE + চ্যানেলের নাম), Caption Box
- সব লেখা, রং, ফন্ট (বাংলা ফন্টসহ) আর অবস্থান Effect Controls থেকে বদলানো যায়
- সাধারণ Title (⌘T): ফন্ট, সাইজ, স্ট্রোক, শ্যাডো, ব্যাকগ্রাউন্ড বক্স

**এক্সপোর্ট**
- Export Media (⌘M): পুরো সিকোয়েন্স বা শুধু In/Out অংশ, ফ্রেম সাইজ, fps, কোয়ালিটি, যেকোনো সিকোয়েন্স
- Export Frame (⇧⌘E): বর্তমান ফ্রেম PNG হিসেবে সেভ হয়ে প্রজেক্টেও যোগ হয়
- প্রিভিউ আর এক্সপোর্ট একই হিসাব ব্যবহার করে, তাই টাইটেল, গ্রাফিক্স, ইফেক্ট, মাস্ক আর ট্রানজিশন প্রিভিউতে যেমন দেখেন এক্সপোর্টেও তেমনই আসে

## কিবোর্ড শর্টকাট (সংক্ষেপে)

| কাজ | শর্টকাট |
|---|---|
| প্লে / স্টপ | Space, K / L |
| এক ফ্রেম / পাঁচ ফ্রেম | ← → / ⇧← ⇧→ |
| আগের / পরের কাট | ↑ / ↓ |
| টুল | V A B N R C Y |
| Add Edit | ⌘K (সব ট্র্যাকে ⇧⌘K) |
| Ripple trim আগের / পরের কাট | Q / W |
| Clear / Ripple Delete | ⌫ / ⇧⌫ |
| Cross Dissolve / অডিও crossfade | ⌘D / ⇧⌘D |
| Link / Unlink ভিডিও-অডিও | ⌘L |
| linked ক্লিপের শুধু এক দিক সিলেক্ট | ⌥-ক্লিক |
| প্যানেল বড়/ছোট | ` |
| প্যানেল খোলা (Project, Source, Timeline, Program, Effect Controls, Meters, Effects) | ⇧1 … ⇧7 |
| In / Out / মুছুন | I / O / ⌥X |
| Lift / Extract | ; / ' |
| মার্কার / পরের মার্কার | M / ⇧M |
| Source থেকে Insert / Overwrite | , / . |
| টেনে ছাড়ার সময় Insert | ⌘ চেপে রাখুন |
| স্ন্যাপিং | S |
| জুম / ফিট | = − / \ |
| নতুন সিকোয়েন্স / নতুন প্রজেক্ট | ⌘N / ⌥⌘N |
| এক্সপোর্ট / ফ্রেম এক্সপোর্ট | ⌘M / ⇧⌘E |

পুরো তালিকা অ্যাপের Help → Keyboard Shortcuts-এ।

## ফোল্ডার কাঠামো

```
scripts/setup.js        Electron/FFmpeg ঠিকমতো বসানো নিশ্চিত করে
src/main.js             উইন্ডো, মেনু, ফাইল ডায়ালগ, মিডিয়া সার্ভার, FFmpeg কাজ
src/export.js           সিকোয়েন্স → একটা FFmpeg কমান্ড (overlay, xfade, কীফ্রেম, মাস্ক, amix)
src/shared/defs.js      ইফেক্ট, ট্রানজিশন, লুক, গ্রাফিক্স টেমপ্লেট, কীফ্রেম গণিত (প্রিভিউ ও এক্সপোর্ট দুজনেই ব্যবহার করে)
src/renderer/js/
  core.js               প্রজেক্ট, সিকোয়েন্স, সিলেকশন, undo, এডিট অপারেশন
  render.js             টাইটেল, গ্রাফিক্স, ইফেক্ট, মাস্ক, ট্রানজিশন আঁকা
  audio.js              Web Audio ইঞ্জিন ও মিটার
  preview.js            প্লেব্যাক ও কম্পোজিটর
  timeline.js           টাইমলাইন ও সব এডিটিং টুল
  inspector.js          Effect Controls
  panels.js             Effects, Essential Graphics, Markers, Source মনিটর, Program-এর drop zone
  dock.js               প্যানেল ডকিং, ভাসমান প্যানেল, workspace
  dnd.js                অ্যাপের ভেতরের টেনে-ছাড়া (মিডিয়া, ইফেক্ট, গ্রাফিক্স)
  app.js                কমান্ড, শর্টকাট, সেভ/ওপেন, এক্সপোর্ট
```

## সীমাবদ্ধতা

- ইফেক্টের প্যারামিটার (যেমন Blur-এর মান) কীফ্রেম করা যায় না; Motion, Opacity, Volume আর Pan করা যায়।
- নেস্টেড সিকোয়েন্স, মাল্টিক্যাম, LUT ফাইল আর সাবটাইটেল (.srt) এখনো নেই।
- DeNoise শুধু এক্সপোর্টে শোনা যায়।
- অনেক ট্রানজিশন আর ইফেক্ট থাকলে এক্সপোর্টে বেশি সময় লাগে।
