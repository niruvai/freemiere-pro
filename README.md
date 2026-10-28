# Frameline — ম্যাকের জন্য ভিডিও এডিটর

Premiere Pro-এর মতো লেআউটে বানানো একটা ভিডিও এডিটর: বাঁয়ে Project প্যানেল, মাঝে Program মনিটর, ডানে Effect Controls, নিচে মাল্টি-ট্র্যাক টাইমলাইন। Electron আর FFmpeg দিয়ে তৈরি, তাই এক্সপোর্ট হয় প্রফেশনাল মানের H.264 MP4।

## চালানোর নিয়ম (প্রথমবার)

ম্যাকে **Node.js** লাগবে (আপনার আছে)। Terminal খুলে:

```bash
cd ~/Downloads/frameline      # যেখানে ফোল্ডারটা আনজিপ করেছেন
npm install                    # একবারই; Electron আর ম্যাকের FFmpeg ডাউনলোড হবে (~২০০ MB)
npm start                      # অ্যাপ চালু হবে
```

## আসল ম্যাক অ্যাপ (.dmg) বানাতে

```bash
npm run dist
```

`dist/` ফোল্ডারে `Frameline-1.0.0-arm64.dmg` (বা Intel ম্যাকে x64) তৈরি হবে। DMG খুলে Frameline-কে Applications-এ টেনে দিন।

অ্যাপটা Apple-এ সাইন করা নয়, তাই প্রথমবার খুলতে: Applications-এ Frameline-এ **রাইট-ক্লিক → Open → Open**। (না খুললে Terminal-এ `xattr -cr /Applications/Frameline.app` চালান।)

## যা যা করা যায়

**মিডিয়া**
- ভিডিও (MP4, MOV, MKV, WebM, AVI, MTS…), অডিও (MP3, WAV, M4A, AAC, FLAC…), ছবি (JPG, PNG, WebP, TIFF) ইমপোর্ট — বাটন দিয়ে বা Finder থেকে টেনে
- থাম্বনেইল আর অডিও ওয়েভফর্ম নিজে থেকে তৈরি হয়
- যে ফরম্যাট সরাসরি প্রিভিউ হয় না (যেমন ProRes, AVI), তার জন্য স্বয়ংক্রিয় প্রিভিউ-প্রক্সি; এক্সপোর্ট সবসময় আসল ফাইল থেকে

**টাইমলাইন**
- যত খুশি ভিডিও ও অডিও ট্র্যাক, প্রতিটায় লুকানো/মিউট/লক
- ক্লিপ টেনে সরানো (ট্র্যাক বদলানোসহ), কিনারা টেনে ট্রিম, Razor টুল ও ⌘K দিয়ে কাটা
- Premiere-এর মতো overwrite এডিট, স্ন্যাপিং, Ripple Delete, Copy/Paste, Duplicate
- Detach Audio — ভিডিওর শব্দ আলাদা অডিও ট্র্যাকে
- জুম (স্লাইডার, ⌥+স্ক্রল বা পিঞ্চ), Undo/Redo (২০০ ধাপ)

**ইফেক্ট (Effect Controls)**
- Position, Scale, Rotation — মনিটরে সরাসরি টেনেও সরানো যায়; Fit/Fill
- Opacity, Fade in/out (উপরের ট্র্যাকে ফেড দিলে cross-dissolve হয়)
- Brightness, Contrast, Saturation
- Speed ১০%–১০০০% (শব্দের পিচ ঠিক থাকে), Volume ০–২০০%
- ভ্যালুর নাম ধরে ডানে-বাঁয়ে টানলে মান বদলায় (Shift = দ্রুত, Option = সূক্ষ্ম)

**টাইটেল**
- যেকোনো ফন্ট (বাংলা ফন্টসহ — Kohinoor Bangla, Bangla Sangam MN), সাইজ, রং, Bold/Italic, Alignment, আউটলাইন, ব্যাকগ্রাউন্ড বক্স, শ্যাডো

**সিকোয়েন্স ও এক্সপোর্ট**
- 1080p, 4K, 720p, Vertical (Reels/Shorts/TikTok 1080×1920), Square, 4:5 বা কাস্টম সাইজ; 23.976–60 fps
- MP4/MOV এক্সপোর্ট, রেজোলিউশন ও কোয়ালিটি বাছাই, প্রগ্রেস বার ও বাকি সময়, Show in Finder
- প্রজেক্ট `.flproj` ফাইলে সেভ/ওপেন, অসংরক্ষিত পরিবর্তন থাকলে বন্ধ করার আগে সতর্কবার্তা

## কিবোর্ড শর্টকাট

| কাজ | শর্টকাট |
|---|---|
| প্লে / পজ | Space (বা K / L) |
| এক ফ্রেম আগে / পরে | ← / → |
| ১ সেকেন্ড আগে / পরে | ⇧← / ⇧→ |
| আগের / পরের কাট | ↑ / ↓ |
| Selection / Razor টুল | V / C |
| প্লেহেডে কাটা | ⌘K |
| ডিলিট / Ripple delete | ⌫ / ⇧⌫ |
| কপি / কাট / পেস্ট | ⌘C / ⌘X / ⌘V |
| Duplicate | ⌘D |
| Detach audio | ⌘L |
| নতুন টাইটেল | ⌘T |
| স্ন্যাপিং চালু/বন্ধ | N |
| টাইমলাইন জুম / ফিট | = / − / ⇧Z |
| ইমপোর্ট / এক্সপোর্ট | ⌘I / ⌘M |
| সেভ / ওপেন / নতুন | ⌘S / ⌘O / ⌘N |
| Undo / Redo | ⌘Z / ⇧⌘Z |

অ্যাপের Help → Keyboard Shortcuts-এও পুরো তালিকা আছে।

## ফোল্ডার কাঠামো

```
src/main.js            উইন্ডো, মেনু, ফাইল ডায়ালগ, সব FFmpeg কাজ
src/export.js          টাইমলাইন → একটা FFmpeg কমান্ড (overlay + amix)
src/preload.js         রেন্ডারার আর মেইন প্রসেসের সেতু
src/renderer/          ইন্টারফেস
  js/core.js           প্রজেক্ট ডেটা, undo/redo, এডিট অপারেশন
  js/preview.js        প্লেব্যাক আর ক্যানভাস কম্পোজিটর
  js/timeline.js       টাইমলাইন ও মাউস-এডিটিং
  js/inspector.js      Effect Controls
  js/text.js           টাইটেল রেন্ডারিং (প্রিভিউ ও এক্সপোর্টে একই)
  js/app.js            Project প্যানেল, কমান্ড, শর্টকাট, এক্সপোর্ট ডায়ালগ
```

## সীমাবদ্ধতা

- প্রিভিউতে ভলিউম ১০০%-এর বেশি শোনা যায় না, তবে এক্সপোর্টে ২০০% পর্যন্ত প্রয়োগ হয়।
- Brightness/Contrast প্রিভিউ আর এক্সপোর্টে সামান্য আলাদা দেখাতে পারে।
- Keyframe অ্যানিমেশন, কালার গ্রেডিং LUT, মাল্টিক্যাম, সাবটাইটেল ফাইল এখনো নেই।
