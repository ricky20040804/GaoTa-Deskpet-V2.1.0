# GaoTa Deskpet Windows Player

Windows desktop pet player for `custompet` resource packages.

## What It Does

- Reads `Downloads/custompet`.
- Also accepts `Downloads/custom_pet` and the local development folder `custompet/generated/current`.
- Plays `idle.mp4`, `run.mp4`, `happy.mp4`, and `rest.mp4`.
- Uses canvas realtime green-screen keying so the pet appears on the desktop.
- Provides a transparent, frameless, always-on-top pet window.
- Supports dragging and a right-click menu.
- Right-click menu supports reload, action preview, size changes, return to desktop bottom, and opening the resource folder.
- Automatically reloads when the `custompet` folder changes.
- Click the pet or use the right-click menu to open the Doubao chat panel.
- Doubao API settings match the macOS app: Base URL, API Key, Endpoint / Model, and System Prompt.
- Pet size presets match the macOS app: large 200px, medium 150px, small 100px.

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
