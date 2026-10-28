# PMV Generator – web version (2.38.7)

Pick a song and a folder of clips – on every beat it cuts to the next one: split-screen layouts like real PMVs, effects on cuts, beats and drops, beat-synced speed ramps and clip audio. It runs live in the browser and can record the result as a video. It can also analyze an existing PMV and rebuild it with your own clips.

**Open it:** https://pmvgen.github.io

This is the standalone web version of the PMV Generator from [stash-pmv-plugins](https://github.com/anonym88312/stash-pmv-plugins) – it doesn't need Stash or any server.

## Privacy

Everything happens in your browser. Songs and clips are opened straight from your disk and are **never uploaded** – the page is plain static HTML and JavaScript without any backend, tracking or analytics. Your settings are remembered in your browser's local storage. Only if you use **Plex** does the page talk to plex.tv (to sign in) and to your own Plex server – straight from your browser, nothing passes through anyone else; the Plex key stays in your browser, and **Sign out** removes it.

## Terms of use & disclaimer

This tool is meant for making music edits from **your own media**. The site asks you to accept these terms before it opens:

- You are **18 or older** (or of legal age where you live).
- You only use videos, images and music that **you own or have permission to use**.
- You **never** use content showing **anyone under 18**.
- You **never** use footage of real people **without their consent** – in particular, no sexual content of anyone who hasn't agreed to it.
- You follow the law where you live, including copyright and privacy law.

Everything runs locally in your browser – the author never receives, sees, stores or controls any media or anything made with this tool. **Users are solely responsible for what they create and share.** The author does not condone any misuse and accepts no liability for it. The software is provided “as is”, without warranty of any kind, under the [MIT license](LICENSE).

## Using it

1. **Music**: drop or choose a song (MP3, M4A, WAV, OGG, FLAC) – or a video, then its music is used. Tempo and beats are detected in the browser. If the tempo is off, **½ tempo** / **2× tempo** help, and **Earlier** / **Later** shift the cuts by 20 ms. **Only use … Cut** takes just a part of the song (e.g. without the intro); **Whole song again** undoes it. **Long DJ mixes** (an hour and more) work too: they're read piece by piece (with progress) and streamed while playing. **Several songs**: drop or choose several files (or a folder) – they play one after another, optionally shuffled. Or take the music from **Plex**, or use **PMV as template** (both below).
2. **Clips**: drop one or more folders onto the card, or click it to choose a folder (subfolders are included). Single files work too. Supported: MP4, WebM, MOV, MKV (whatever your browser can play) and JPG, PNG, WebP, GIF, AVIF.
   - **What**: videos, images or both · **Clip shape**: all, portrait only, landscape only.
   - **Folders**: limit the clips to some of the added folders.
   - **Clip selection**: best moments instead of random spots, **clean cuts** (a clip starts where its scene runs on for the next few seconds – no hidden scene change inside the clip), smart crop, match cuts, variety.
     Also: **Skip the start / the end of each video** (no clips from logos and credits), **Clip speed follows the music** (fast, busy music gets clips with fast motion – experimental) and **Motion on the beat** (a clip's rhythm is measured and lined up with the beat – experimental).
3. **Style**: mood presets (*PMV classic*, *Maximal*, *Hypno*, *Clean*) and five sections – cutting and layouts (fullscreen, kaleidoscope, 2-way, 3-way mirrored, 3-way, 4-way), effects on cuts / beats / drops, look & picture (color look, 16:9 or 9:16, **Fit** shows the whole clip with a blurred border, **Fill** crops it to fill the frame), song and clip volume, intro/outro and recording quality (720p/1080p). All sections are open; click a section's header to collapse it, or use **Collapse all**. **Bars and phrases** (under Cutting) finds the “one” of each bar and where a 4-bar phrase starts: cuts sit on the bar's strong beats and split screens change at the start of a phrase.
4. **Go**: runs as a fullscreen show (Space pause, F fullscreen, Esc stop; with several songs N / P or the buttons in the bar skip). The bar and the mouse pointer disappear after 2.5 s without movement; **H** hides the bar for good (H again brings it back). **I** shows which clips are on screen (file, size, playing / loading / black picture) and which had to be skipped and why – clips the browser can't decode are left out instead of showing a black field. 4K clips run smoothly: the picture analysis runs in the background and every clip frame reaches the screen, also on 144/240 Hz monitors. With **Record** you get a WebM video to download – the duration is written into the file right in the browser, so players show the length and can seek.

   **My settings** saves everything about clips, cutting, effects, look and sound under a name and loads it again (kept in this browser); **Export** / **Import** move it as a file – also between the web version and the Stash plugin.

   **Funscript** (optional): builds a script for The Handy from the song and plays it with the PMV – enter your connection key under Funscript (kept in this browser only).

   **Soften the seams** (Look): in a split screen the line between the clips is soft instead of sharp.

   **Pictures**: still images from your library flash between the clips (**Image flash**: one or a burst, up to eight per beat, in a tempo of their own) or lie see-through over them (**Image overlay**) – add image files or a folder with images to the library.

   **Change the moment** (key **M** or the pencil in the bar): the show pauses and every clip gets a slider to take it from another moment of its video; **Pin this moment** makes clips of that video often start there (kept in this browser).

   **Mouse control**: run the show with the mouse – click the middle to pause, the sides for song volume or the previous / next song, the wheel and the middle button too (all off by default); **Start by itself** starts right after you pick a song.

The clips you add are kept only while the page is open – after a reload, add the folder again (your folder choice and all settings are remembered).

Tip: three full-size portrait clips side by side = format **16:9** + layout 3-way + “Portrait only”.

## Look and language

- **Liquid glass**: the switch at the top right turns the see-through glass look on or off (on by default).
- **Languages**: English, and Simplified Chinese when your browser is set to Chinese.

## Music from Plex

Switch step 1 to **Plex** and **Sign in with Plex** – you confirm on plex.tv like with any Plex app (no password passes through this page). Then:

- **Follow what's playing**: a live visualizer for whatever you play in Plex – Plexamp, your phone, the Plex web app, a TV. The sound stays in your Plex player; the show follows song changes, pause and seeking. Your speakers may be late (Bluetooth, TV): press **T** (or **Tap**) along to the beat you hear and the offset sets itself; **− / +** or **[ / ]** shift it by hand. It's remembered per Plex player. Nothing is recorded in this mode.
- **A playlist** or **Shuffle all**: songs from your Plex library, played here.

This page is served over https, so your browser only lets it reach a Plex server that offers **secure connections** – with Plex's default settings and Remote Access that's the case. If your server can't be reached, the Stash plugin version (on `http://localhost`) reaches it in your local network directly.

## PMV as template

Switch step 1 to **PMV as template**, then pick one of your added videos (names containing “PMV” come first) or choose a video file. The analysis runs in the browser at about three times real-time speed and takes over the music, every cut, the layouts (split screens) and flashes. **Rebuild with my clips** plays the original music with the same cuts, layouts and flashes – only with your clips.

## Requirements

A current Chrome, Edge or Firefox on a desktop computer. Choosing whole folders isn't supported by every mobile browser – pick single files there.

## Run it yourself

It's a static site – any web server works, for example:

```
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` directly from disk doesn't work, because browsers block JavaScript modules on `file://`.)

## License

MIT – see [LICENSE](LICENSE).
