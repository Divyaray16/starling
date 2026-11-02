# Starling

Starling sorts a folder of photos and videos in the browser. The pile lifts together and lands in place. You choose files, each one is labeled on this machine, and a category row appears only after at least one file belongs there. Counts are the files that actually landed. Nothing is uploaded.

When the flock has settled, open a category to see its photos and videos, or download a zip of folders: one folder per category, with the original file bytes inside.

## The flock

A batch — a folder, a drop, or the sample — is decoded onto the pile first, including HEIC. Nothing in that batch is labeled or flown until every file from it is on the pile. Then the visible cards leave together. Departures in a wave are about 10 milliseconds apart. Each flight is one smooth arc of about 320–420 milliseconds. A large folder draws at most 24 cards and flies them in waves of about 12; every file still lands in a row, and the count includes the whole batch. A category row warms briefly as a tile docks, and the counts tick up as they land. A category is shown only when at least one file belongs there. Files already landed stay where they are when another batch is added.

If the browser asks for reduced motion, Starling skips the flight and shows the settled board.

## After the sort

The page says the sort is finished. Each category opens into a grid of thumbnails, file names, and a photo or video badge. Close returns to the board. **Download folders** builds a zip in the browser with [fflate](https://github.com/101arrowz/fflate). HEIC and HEIF files are the original files, not the JPEG preview used for the thumbnail. **Sort another set** clears the board.

## Run

The server a person can open from the Cursor cloud agent UI is the production server. It listens on port **43127** on every interface:

```bash
npm install
npm run build
npm start
```

`npm start` runs `next start --hostname 0.0.0.0 --port 43127`. Inside the agent VM that is [http://127.0.0.1:43127](http://127.0.0.1:43127). That loopback address only answers on the VM. Cursor forwards the port to the machine running the Agents Window: open **Forwarded Ports**, forward **43127** if it is not already listed, and choose **Open in internal browser**. That preview reaches this same process through a proxied host, not through a public URL.

`npm run dev` is the wrong server for that preview. Next.js blocks dev assets, including the hot-reload client, unless the browser’s host is listed in `allowedDevOrigins`. A forwarded or proxied host is not `127.0.0.1`, so the dev page stays blank. The production server does not do that check.

## What stays in the browser

**Choose files or folder** is a directory picker (`webkitdirectory`). Choosing a folder returns the images and videos inside it, including HEIC. You can also drop files or a folder onto the pile. Canceling the dialog leaves the session as it is. Classification runs locally with Transformers.js and a quantized CLIP model (`Xenova/clip-vit-base-patch32`). The weights download from Hugging Face the first time and are cached in the browser. There is no account, no database, and no photo upload.

Photos (JPEG, PNG, WebP, GIF, HEIC, HEIF) and videos (MP4, WebM, MOV) can share a category. HEIC and HEIF are decoded in this browser with [libheif](https://github.com/strukturag/libheif) (the `libheif-js` wasm build) to a bitmap, drawn to a canvas, and then labeled the same way as a JPEG. The zip still contains the original HEIC. A video is labeled from three frames — near the start, the middle, and the end, when the clip is long enough to tell them apart. Those scores are combined so one odd frame does not decide. The thumbnail is the middle frame. Each tile is badged Photo or Video. A file that cannot be decoded is named on its own; the rest of the folder still sorts. Other files that are not photos or videos are skipped, and the page says how many.

## Categories are provisional

Category names are not a fixed set in the layout. They live in [`lib/vocabulary.ts`](lib/vocabulary.ts). Each concept has several full-sentence prompts. The model averages those scores, and when the top two are only a hair apart it prefers the more specific concept — fish over a generic animal, diving over open water, a boat over a car or bike, a wreck over a vehicle. A row is shown only when at least one file lands there, so a different folder can introduce a category that was not on screen before. Edit the names and prompts in that module when the wording should change.

If the CLIP weights cannot be downloaded, Starling switches to a smaller on-device reader in [`lib/fallback-classifier.ts`](lib/fallback-classifier.ts). That reader measures the image (edges, skin-tone pixels, sky, saturation) and scores the same vocabulary. The page says so. Those labels are rougher, and they are not CLIP labels.

## Sample folder

“Try a sample folder” fetches a few photographs (and one short crossing clip) from `public/samples`. They are Wikimedia Commons files stored with the app so the demo does not depend on hotlinking:

- Good Food Display, National Cancer Institute
- Albert Einstein
- Matterhorn from Domhütte, Luca Galuzzi
- Cat03
- Empire State Building from the Top of the Rock
- Tokyo Shibuya Scramble Crossing, 2018
- Screenshot of the eLabFTW user interface

The clip is a one-second view of the Shibuya photograph so the video path can be tried without a personal folder. Sample files go through the same classifier and the same flock, and they end on the settled board.

## Limits

- HEIC and HEIF are decoded locally. A multi-image HEIC uses the first image. A variant libheif cannot read (a truncated file, or an uncommon codec inside the HEIF container) is left out by itself, with that file’s name on the page.
- The first sort downloads about 150 MB of model weights. Later sorts reuse the browser cache. The HEIC decoder is bundled with the app and is not a photo upload. The empty page paints before that download starts.
- A very large folder shows a dense pile of at most 24 cards, plus the real count. Those cards fly in waves of about 12. Every file still lands in a category row.
- The folder control opens the system directory picker. Loose files still add by dropping them on the pile. HEIC and HEIF are included either way.
