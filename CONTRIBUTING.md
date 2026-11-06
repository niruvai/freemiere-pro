# Contributing to Freemiere Pro

Thanks for helping make Freemiere Pro better. Bug fixes, new features, translations and documentation are all welcome.

[বাংলায় পড়ুন](#বাংলা)

## Before you start

- **Bugs and ideas:** search the [Issues](https://github.com/niruvai/freemiere-pro/issues) first. If nothing matches, open a new one using the template.
- **Big changes** (a new panel, a new export path, changes to the project file format): open an issue first and describe your plan, so we can agree on the approach before you spend time on it.
- **Security problems:** do not open a public issue. Follow the [security policy](SECURITY.md).

## Setting up

Requirements: macOS 11 or later, Node.js 18 or later, and Git.

```bash
git clone https://github.com/<your-username>/freemiere-pro.git
cd freemiere-pro
npm install
npm start
```

See [Project structure](README.md#project-structure) in the README to find your way around the code.

## Making a pull request

1. Fork the repository and create a branch from `main` (for example `fix-audio-sync` or `add-lut-import`).
2. Keep each pull request focused on one fix or feature.
3. Test your change with `npm start`, and check that an export still plays with picture and sound.
4. Open the pull request and fill in the template. Add screenshots or a short screen recording for anything visible.

### Please do not

- **Change `version` in `package.json` or edit `.github/workflows/`.** Pushing a new version to `main` builds a release that every installed copy of the app downloads automatically, so only the maintainer bumps versions and publishes releases.
- Add new dependencies without explaining why in the pull request.
- Add analytics, tracking or any network calls other than the existing update check.
- Include code, icons or artwork copied from Adobe Premiere Pro or other proprietary software.

## Code style

- Plain JavaScript, no build step. Follow the style of the file you're editing.
- Keep the renderer and the main process separate; the renderer talks to the main process only through `src/preload.js`.
- Write clear commit messages that say what changed and why.

## License

By contributing, you agree that your contributions are released under the [MIT License](LICENSE).

---

## বাংলা

Freemiere Pro-তে অবদান রাখার জন্য ধন্যবাদ।

- **বাগ বা আইডিয়া:** আগে [Issues](https://github.com/niruvai/freemiere-pro/issues)-এ খুঁজে দেখুন, না পেলে নতুন Issue খুলুন।
- **বড় পরিবর্তন** করার আগে একটা Issue খুলে পরিকল্পনাটা জানান।
- **Pull Request:** রিপো fork করুন, `main` থেকে নতুন branch বানান, `npm start` দিয়ে পরীক্ষা করুন, তারপর PR খুলে টেমপ্লেটটা পূরণ করুন।
- **`package.json`-এর `version` বা `.github/workflows/` বদলাবেন না।** নতুন ভার্সন `main`-এ গেলে সব ইউজারের কাছে আপডেট চলে যায়, তাই ভার্সন বাড়ানো ও রিলিজ শুধু মেইনটেইনার করবেন।
- নিরাপত্তার সমস্যা পাবলিক Issue-তে না লিখে [নিরাপত্তা নীতি](SECURITY.md) অনুসরণ করুন।
