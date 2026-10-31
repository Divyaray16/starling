# Divya

Divya sorts a folder of photos and videos in the browser. You pick a real folder, each file is labeled on this machine, and a category row appears only after at least one file lands in it. Counts are the files that actually landed. Nothing is uploaded.

The pile of unsorted tiles sits on a dark table. One tile at a time lifts off, crosses to the paper side, and docks in its row.

## Run

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43127](http://127.0.0.1:43127) (`0.0.0.0:43127`).

## What stays in the browser

Choose a folder uses a folder input (`webkitdirectory`). You can also drop a folder onto the pile. Classification runs locally with Transformers.js and a quantized CLIP model (`Xenova/clip-vit-base-patch32`). The weights download from Hugging Face the first time and are cached in the browser. There is no account, no database, and no photo upload.

Photos (JPEG, PNG, WebP, GIF, HEIC, HEIF) and videos (MP4, WebM, MOV) can share a category. HEIC and HEIF are decoded in this browser with [libheif](https://github.com/strukturag/libheif) (the `libheif-js` wasm build) to a bitmap, drawn to a canvas, and then labeled the same way as a JPEG, including the flight animation. A video is labeled from one frame drawn to a canvas. Each tile is badged Photo or Video. A file that cannot be decoded is named on its own; the rest of the folder still sorts. Other files that are not photos or videos are skipped, and the page says how many.

## Categories are provisional

Category names are not a fixed set in the layout. They live in [`lib/vocabulary.ts`](lib/vocabulary.ts). That list is a provisional vocabulary for zero-shot labeling: a row is shown only when the model assigns at least one file to it, so a different folder can introduce a category that was not on screen before. Edit the names and prompts in that module when the wording should change.

If the CLIP weights cannot be downloaded, Divya switches to a smaller on-device reader in [`lib/fallback-classifier.ts`](lib/fallback-classifier.ts). That reader measures the image (edges, skin-tone pixels, sky, saturation) and scores the same vocabulary. The page says so. Those labels are rougher, and they are not CLIP labels.

## Sample folder

“Try a sample folder” fetches a few photographs (and one short crossing clip) from `public/samples`. They are Wikimedia Commons files stored with the app so the demo does not depend on hotlinking:

- Good Food Display, National Cancer Institute
- Albert Einstein
- Matterhorn from Domhütte, Luca Galuzzi
- Cat03
- Empire State Building from the Top of the Rock
- Tokyo Shibuya Scramble Crossing, 2018
- Screenshot of the eLabFTW user interface

The clip is a one-second view of the Shibuya photograph so the video path can be tried without a personal folder. Sample files go through the same classifier and the same animation as a folder you pick.

## Limits

- HEIC and HEIF are decoded locally. A multi-image HEIC uses the first image. A variant libheif cannot read (a truncated file, or an uncommon codec inside the HEIF container) is left out by itself, with that file’s name on the page.
- The first sort downloads about 150 MB of model weights. Later sorts reuse the browser cache. The HEIC decoder is bundled with the app and is not a photo upload.
- Very large folders stay responsive by labeling one file at a time and drawing only a sample of the resting pile.
- Choose a folder opens a folder input. You can also drop a folder on the pile.
