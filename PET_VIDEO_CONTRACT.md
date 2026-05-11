# Pet video contract

The script writes generated pet videos into this project folder:

```text
custompet/generated/current/
```

Expected action files:

```text
idle.mp4
run.mp4
happy.mp4
rest.mp4
```

`.mov` is preferred for each action because it can preserve alpha after green-screen keying. `.mp4` is accepted as a raw generated fallback.

Generation target:

- First frame: create a front-facing 2D cartoon pet image from the user's uploaded pet photo with `wan2.6-image`.
- Videos: generate four 3-second clips from that first frame with `wan2.6-i2v-flash`.
- Set `audio=false`.
- Use 720p output.
- Use a pure bright green background (`#00FF00`) so it can be keyed out locally.
- `run` should move to the right; the app mirrors the same video when the pet travels left.

The playback code loops each action with `AVQueuePlayer` and `AVPlayerLooper`, so mp4 output from the API is acceptable.

## Generate with DashScope

Set your API key:

```sh
export DASHSCOPE_API_KEY="your-key"
```

Generate the first frame and all four videos from a local pet photo:

```sh
python3 tools/generate_pet_videos.py /path/to/pet-photo.jpg
```

If you already have a first-frame image URL and only want to test video generation:

```sh
python3 tools/generate_pet_videos.py --first-frame-url "https://example.com/first-frame.png"
```

Generate only one action while debugging:

```sh
python3 tools/generate_pet_videos.py /path/to/pet-photo.jpg --actions idle
```

The script writes videos directly to the app's expected project folder.

Remove the green screen and create alpha-preserving `.mov` files:

```sh
python3 tools/key_green_screen.py
```

The app prefers the keyed `.mov` files over the raw `.mp4` files.
