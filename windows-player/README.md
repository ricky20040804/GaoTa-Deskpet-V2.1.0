# GaoTa Deskpet Windows Player

Windows desktop pet player for `custompet` resource packages.

## What It Does

- Reads `Downloads/custompet`.
- Plays `idle.mp4`, `run.mp4`, `happy.mp4`, and `rest.mp4`.
- Uses canvas realtime green-screen keying so the pet appears on the desktop.
- Provides a transparent, frameless, always-on-top pet window.
- Supports dragging and a right-click menu.

## Development

```bash
npm install
npm start
```

## Package

On a Windows machine:

```bash
npm install
npm run pack
```

The output will be created in `windows-player/dist`.
