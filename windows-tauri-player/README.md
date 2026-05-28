# GaoTa Deskpet Windows Tauri Runner

Lightweight Windows runner built with Tauri and the system WebView2 runtime.

## Build

Run on Windows:

```powershell
cargo build --release --manifest-path src-tauri/Cargo.toml
```

The release executable is written to:

```text
src-tauri/target/release/
```

The website workflow zips that executable as `gaotadeskpet-windows.zip`.
