# Interview Coder

> ## ⚠️ IMPORTANT NOTICE TO THE COMMUNITY ⚠️
> 
> **This is a free, open-source initiative - NOT a full-service product!**
> 
> There are numerous paid interview preparation tools charging hundreds of dollars for comprehensive features like live audio capture, automated answer generation, and more. This project is fundamentally different:
> 
> - This is a **small, non-profit, community-driven project** with zero financial incentive behind it
> - The entire codebase is freely available for anyone to use, modify, or extend
> - New features should come through **community contributions** - it's unreasonable to expect a single maintainer to implement premium features for free
> - The maintainer receives no portfolio benefit, monetary compensation, or recognition for this work
> 
> **Before submitting feature requests or expecting personalized support, please understand this project exists purely as a community resource.** If you value what's been created, the best way to show appreciation is by contributing code, documentation, or helping other users.

## Free, Open-Source AI-Powered Interview Preparation Tool

An Electron-based invisible overlay desktop app that provides real-time AI-powered interview assistance through screen capture analysis, live audio transcription, and multi-provider LLM integration. Use your own API key — pay only for what you use.

### Why This Exists

The best coding interview tools are often behind expensive paywalls, making them inaccessible to many students and job seekers. This project provides the same powerful functionality without the cost barrier:

- **Use your own API key** — pay only for actual API usage
- **Run everything locally** on your machine with complete privacy
- **Choose your AI provider** — OpenAI, Google Gemini, or Anthropic Claude
- **Fully customizable** — open source, modify anything to suit your needs

---

## Features

- 🎯 **99% Invisible** — Undetectable frameless overlay that bypasses most screen capture methods
- 📸 **Smart Screenshot Capture** — Capture question text and code for AI analysis
- 🤖 **Multi-Provider AI** — Supports OpenAI (GPT-4o), Google Gemini (3 Flash/Pro), and Anthropic (Claude 3.5/3.7)
- 💡 **Solution Generation** — Detailed explanations with time/space complexity analysis
- 🔧 **Real-time Debugging** — Debug your code with AI-assisted structured feedback
- 🎙️ **Live Conversation Mode** — Record, transcribe, and get AI-powered answer suggestions in real time
- 🎨 **Advanced Window Controls** — Move, resize, adjust opacity, and zoom the overlay
- 🔄 **Per-Task Model Selection** — Choose different models for extraction, solving, debugging, and answers
- 👤 **Candidate Profile** — Add your resume and job description for personalized AI suggestions
- 🔒 **Privacy-First** — Your data never leaves your machine except for API calls to your chosen provider

---

## Global Keyboard Shortcuts

These OS-level shortcuts work even when the app is not focused:

| Shortcut | Action |
|:---------|:-------|
| `Cmd/Ctrl + B` | Toggle window visibility |
| `Cmd/Ctrl + H` | Take screenshot |
| `Cmd/Ctrl + L` | Delete last screenshot |
| `Cmd/Ctrl + Enter` | Process screenshots (Solve) |
| `Cmd/Ctrl + R` | Reset view & start over |
| `Cmd/Ctrl + M` | Toggle audio recording |
| `Cmd/Ctrl + Shift + M` | Toggle speaker (Interviewer ↔ You) |
| `Cmd/Ctrl + Q` | Quit application |
| `Cmd/Ctrl + [` / `]` | Decrease / increase opacity |
| `Cmd/Ctrl + -` / `=` / `0` | Zoom out / in / reset |
| `Cmd/Ctrl + Arrow Keys` | Move window position |

---

## Invisibility Compatibility

**Invisible to:**
- Zoom versions below 6.1.6 (inclusive)
- All browser-based screen recording software
- All versions of Discord
- macOS screenshot functionality (Cmd + Shift + 3/4)

**NOT invisible to:**
- Zoom versions 6.1.6 and above ([downgrade link](https://zoom.en.uptodown.com/mac/versions))
- macOS native screen recording (Cmd + Shift + 5)

---

## Prerequisites

- **Node.js** v16 or higher
- **npm** or **bun** package manager
- **API Key** from one of the supported providers:
  - [OpenAI](https://platform.openai.com/api-keys) — GPT-4o, GPT-4o-mini, Whisper
  - [Google AI Studio](https://aistudio.google.com/app/apikey) — Gemini 3 Flash, Gemini 3 Pro
  - [Anthropic](https://console.anthropic.com/settings/keys) — Claude 3.5 Sonnet, Claude 3.7 Sonnet
- **Screen Recording Permission** (macOS: System Preferences → Privacy → Screen Recording)
- **Microphone Permission** (required for conversation mode)

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/greeneu/interview-coder-withoupaywall-opensource.git
cd interview-coder-withoupaywall-opensource

# 2. Install dependencies
npm install

# 3. Clean any previous builds (recommended)
npm run clean

# 4. Run in development mode
npm run dev
```

> **Note:** The application window is invisible by default! Press `Cmd/Ctrl + B` to toggle visibility.

### Stealth Launch Scripts

For a production-like stealth experience:

```bash
# macOS / Linux
chmod +x stealth-run.sh
./stealth-run.sh

# Windows
stealth-run.bat
```

### Building Distributable Packages

```bash
# macOS (DMG + ZIP for x64 and arm64)
npm run package-mac

# Windows (NSIS installer)
npm run package-win
```

Packaged applications are output to the `release/` directory.

---

## How It Works

1. **Setup** — Launch the app, enter your API key in Settings, and choose your preferred AI provider and models

2. **Screenshot Capture** — Press `Cmd/Ctrl + H` to capture coding problems. Screenshots queue up (max 5) and can be removed with `Cmd/Ctrl + L`

3. **AI Processing** — Press `Cmd/Ctrl + Enter` to analyze screenshots. The AI extracts the problem via vision models, classifies it (MCQ / coding / general), and generates a solution

4. **Solution & Debugging** — View generated code with explanations, complexity analysis, and step-by-step thoughts. Take additional screenshots and re-process to debug

5. **Conversation Mode** — Press `Cmd/Ctrl + M` to record audio. Toggle between Interviewer and You modes. AI suggestions appear automatically based on conversation context, your candidate profile, and any captured screenshots

6. **Window Management** — Move with arrow keys, adjust opacity with `[`/`]`, zoom with `-`/`=`, and toggle visibility with `B` — all with `Cmd/Ctrl`

---

## Configuration

### API Provider & Models

The app supports three AI providers with per-task model selection:

| Task | What It Does | Available Providers |
|:-----|:-------------|:-------------------|
| **Extraction** | OCR from screenshots to extract problem text | OpenAI, Gemini, Anthropic |
| **Solution** | Generate code solutions with explanations | OpenAI, Gemini, Anthropic |
| **Debugging** | Analyze and fix code issues | OpenAI, Gemini, Anthropic |
| **Answer** | Generate conversation answer suggestions | OpenAI, Gemini, Anthropic |
| **Speech Recognition** | Transcribe audio to text | OpenAI (Whisper), Gemini |

All model and provider configuration is managed in the Settings dialog (gear icon → Settings).

### Candidate Profile

Add your resume text and target job description in Settings to receive personalized, context-aware AI answer suggestions during conversations.

### Config File Location

Settings are persisted locally:
- **macOS:** `~/Library/Application Support/interview-coder-v1/config.json`
- **Windows:** `%APPDATA%/interview-coder-v1/config.json`

> **Troubleshooting API keys:** If your API key isn't working, try deleting the config file and re-entering your key in Settings. Verify the key is active and has sufficient credits on your provider's dashboard.

---

## Comparison with Paid Interview Tools

| Feature | Premium Tools ($60+/mo) | Interview Coder (Free) |
|:--------|:------------------------|:-----------------------|
| Solution Generation | ✅ | ✅ |
| Debugging Assistance | ✅ | ✅ |
| Invisibility | ✅ | ✅ |
| Multi-language Support | ✅ | ✅ |
| Complexity Analysis | ✅ | ✅ |
| Window Management | ✅ | ✅ |
| Speech Recognition | ✅ | ✅ (Whisper + Gemini) |
| AI Answer Suggestions | ✅ | ✅ (Context-aware) |
| Multi-Provider AI | Limited | ✅ (OpenAI, Gemini, Anthropic) |
| Candidate Profile | ❌ | ✅ (Resume + Job Description) |
| Privacy | Server-processed | 100% Local |
| Customization | Limited | Full Source Code |
| Cost | $60+/month | Free (API usage only) |

---

## Tech Stack

| Category | Technology |
|:---------|:-----------|
| Framework | Electron |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Bundler | Vite + `vite-plugin-electron` |
| State Management | TanStack Query (React Query) |
| UI Primitives | Radix UI |
| AI SDKs | OpenAI, Anthropic, Google Gemini (REST) |
| Screen Capture | `screenshot-desktop`, native CLI tools |
| Audio | Web Audio API, MediaRecorder, Web Speech API |
| Auto Updates | `electron-updater` |

For detailed architecture documentation, see [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

---

## Extending the App

The codebase is designed for extensibility:

- **Add AI models** — Edit [`shared/aiModels.ts`](shared/aiModels.ts) (single source of truth for both processes)
- **Modify AI prompts** — Extraction/solution prompts in [`electron/ProcessingHelper.ts`](electron/ProcessingHelper.ts), conversation prompts in [`electron/AnswerAssistant.ts`](electron/AnswerAssistant.ts)
- **Add IPC channels** — Define in [`electron/preload.ts`](electron/preload.ts) → Handle in [`electron/ipcHandlers.ts`](electron/ipcHandlers.ts) → Type in [`src/types/electron.d.ts`](src/types/electron.d.ts)
- **Window behavior** — Overlay flags, opacity, click-through in [`electron/main.ts`](electron/main.ts)
- **Add hotkeys** — Register via `globalShortcut` in [`electron/shortcuts.ts`](electron/shortcuts.ts)

---

## Troubleshooting

| Issue | Solution |
|:------|:---------|
| Window doesn't appear | Press `Cmd/Ctrl + B` multiple times to toggle visibility |
| Build errors | Run `npm run clean` first, then `npm run dev` |
| API key not working | Delete config file and re-enter key; verify key is active with credits |
| macOS permission errors | Enable Screen Recording and Microphone in System Preferences → Privacy |
| Window management conflicts | Disable tools like Rectangle Pro that may interfere with overlay positioning |
| Speech recognition not working | Ensure API provider is set to OpenAI or Gemini; grant microphone permissions |

---

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- You are free to use, modify, and distribute this software
- Modified versions must be released under the same license
- Network server usage requires making source code available to users

See [LICENSE-SHORT](LICENSE-SHORT) for a summary or [GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) for the full text.

### Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Disclaimer and Ethical Usage

This tool is intended as a **learning aid and practice assistant**. Please use it responsibly:

- Be honest about using assistance tools if asked directly
- Use this tool to learn concepts, not just to get answers
- Understanding solutions is more valuable than presenting them
- In take-home assignments, thoroughly understand any solutions you submit

The purpose of technical interviews is to assess problem-solving skills. This tool works best when used to enhance your learning, not as a substitute for it.

---

> **Remember:** This is a community resource. If you find it valuable, consider contributing code, documentation, or helping other users rather than just requesting features.
