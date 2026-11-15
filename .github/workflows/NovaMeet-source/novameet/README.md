# NovaMeet

**Listen. Understand. Organize.** A private meeting assistant for Windows and macOS.
It records online meetings, transcribes them, tells speakers apart and writes a
structured report (decisions, action items, warnings, contradictions, open
questions, key figures) — **everything runs on your computer**.

The interface follows the approved design prototype 1:1 (same tokens, components,
notch states and screens). Treat that prototype as the visual reference for any
future change.

---

## Run it

Requirements: **Node.js 20+** (22 recommended) and Git.

```bash
npm install          # downloads Electron and the native AI runtimes for your OS
npm run dev          # start NovaMeet with live reload
```

Build an installer:

```bash
npm run dist:win     # Windows → dist/NovaMeet Setup 1.0.0.exe
npm run dist:mac     # macOS   → dist/NovaMeet-1.0.0.dmg (run on a Mac)
```

## Build on GitHub

`.github/workflows/build.yml` builds the installers on GitHub's own Windows and macOS machines:

- **Every push to `main`** → Actions tab → the run → **Artifacts**: `NovaMeet-Windows` (.exe) and `NovaMeet-macOS` (.dmg).
- **Push a tag like `v1.0.0`** → the installers are also attached to a GitHub **Release**.

The installers are unsigned for now: Windows SmartScreen shows “More info → Run anyway”,
and on macOS right-click the app → Open the first time. They're about 1 GB because they
include the GPU runtimes (CUDA/Vulkan/Metal) so local AI works without installing anything else.

## First launch

1. The welcome screen asks your name (used for your lines in transcripts).
2. Click **Install recommended models**. NovaMeet checks your hardware and installs,
   in one click:
   - **Parakeet v3** — speech to text (25 European languages, incl. Portuguese) · 487 MB
   - **Voice essentials** — voice detection + speaker identification · 37 MB
   - **A report model sized for your GPU**:
     Qwen3 4B (≤10 GB VRAM) · Gemma 3 12B (10–22 GB) · Qwen3 30B A3B (22 GB+, e.g. RTX 5090)
3. Click **Start meeting** (or `Ctrl+Shift+R` / `⌘⇧R`) while your call is open.

Everything else is under **AI Models**: install / remove / switch models with one
click (downloads resume if interrupted), see your GPU, VRAM and disk use.

### Local AI options

| Job | Built-in (one click) | Notes |
|---|---|---|
| Speech to text | Parakeet v3 · Whisper Large v3 Turbo (99 languages) · Moonshine Base (English, tiny) | sherpa-onnx, runs on CPU, very fast |
| Speakers | pyannote segmentation + CAM++ voice embeddings | separates “Speaker 1, 2…”; rename them in **Participants** and the report updates |
| Report | Qwen3 4B · Gemma 3 12B · Qwen3 30B A3B (GGUF via llama.cpp) | GPU accelerated (CUDA / Vulkan / Metal), unloaded after each report so your GPU is free again |
| Report via Ollama | any model already in Ollama, plus one-click pulls (`qwen3:8b`, `gemma3:12b`, `qwen3:30b`, or type any name) | detected automatically at `localhost:11434` |

## How it works

```
mic ─┐                          ┌─ live transcript (notch + Home)
     ├─ recorder (16 kHz) ──────┤
system audio ┘   two tracks     └─ WAV files ──► speakers (diarization) ──► report (local LLM, JSON schema)
```

- **Two separate tracks**: your microphone (= you) and the computer's sound output
  (= everyone else). Your voice is never mixed up with the others, and echo from
  speakers is removed.
- Transcription happens **during** the call, so the transcript is ready seconds
  after you press End. Speaker identification and the report run afterwards.
- Long meetings are split into parts for the report and merged.
- Every finding links to the exact transcript line; clicking it jumps there and
  plays the audio from that moment.
- Rule checks on top of the AI: a task other work depends on with **no deadline**
  becomes a **critical** warning; tasks without an owner and unclear audio
  segments are flagged.

## The notch

A separate always-on-top window on the top edge of the chosen display (Left /
Center / Right in Settings). It is click-through except the pill itself, never
steals focus from your meeting app, and shows all seven approved states: Idle,
Recording, Expanded, Audio problem, Uncertain transcription, Processing, Completed.
It cannot be hidden while recording.

Audio problem triggers: microphone clipping (“Audio quality reduced”), meeting
audio silent for 45 s while you speak (“No meeting audio”), or the system audio
stream ending (“Meeting audio lost”).

## Where data lives

`%APPDATA%/NovaMeet` (Windows) or `~/Library/Application Support/NovaMeet` (macOS):
`meetings/<id>/meeting.json` + `meeting.wav` + `mic.wav`, `models/`, `settings.json`.
Retention, “delete raw audio after processing” and “delete everything” are in
**Settings › Privacy**.

## Status / not yet built

- **Google Docs export, Hybrid and Cloud processing** are shown as “Coming soon”
  (they need a Google OAuth client and a server). TXT, DOCX and PDF export work.
- **macOS system audio** uses Electron's screen-share loopback (macOS 14.2+,
  Screen Recording permission). Windows is fully supported. Test on a Mac before relying on it.
- Speaker identification runs on the CPU — on a long meeting it can take a few minutes.

## Developer checks

A headless end-to-end run (records fake audio, transcribes, exports, screenshots
every screen and notch state):

```bash
NOVAMEET_DATA=/tmp/nm NOVAMEET_SELFTEST=30 NOVAMEET_SHOTS=/tmp/nm-shots npx electron . \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --use-file-for-fake-audio-capture=speech16k.wav%noloop
```
(needs a speech model already installed in `/tmp/nm/models`).

## Project layout

```
src/main/            Electron main process
  index.js           windows, notch, meeting session, IPC
  models/            one-click model catalog + downloader (resume, cancel, unpack)
  ai/speech-*.js     sherpa-onnx speech engine (utility process)
  ai/report.js       local-LLM report (llama.cpp or Ollama) + rule checks
  store.js           meetings, settings, search
  export.js          TXT / DOCX / PDF
src/preload/         safe bridge (allow-listed IPC)
src/renderer/        React UI (same CSS as the approved prototype)
  notch/             the notch window
  recorder/          hidden recorder + audio worklet
```
