# Study Sahurrr Extension

If Chrome says **"Manifest file is missing or unreadable"**, it usually means the wrong folder was selected.

## Make release ZIP

```bash
./build-extension-zip.sh
```

This generates locally (not committed to git):

- `release/study-sahurrr-v3.zip`
- `release/study-sahurrr-v3/`

## Load unpacked

1. Extract `release/study-sahurrr-v3.zip`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Pick the extracted `study-sahurrr-v3` folder (the one that directly contains `manifest.json`)
