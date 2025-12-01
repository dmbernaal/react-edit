# 🎯 Cursor Agent Browser CLI

**Click on any UI element → Type what you want → AI edits your code → See changes live**

A tool that bridges your browser to Cursor AI, enabling visual "click-to-edit" development for React apps.

![Demo](https://img.shields.io/badge/demo-coming_soon-blue)
[![npm version](https://img.shields.io/npm/v/cursor-agent-browser-cli.svg)](https://www.npmjs.com/package/cursor-agent-browser-cli)

---

## ⚡ Quick Install with Cursor

Click the button below to open Cursor and get AI-assisted installation:

<a href="cursor://anysphere.cursor-deeplink/prompt?text=Help%20me%20install%20cursor-agent-browser-cli%20in%20my%20React%2FNext.js%20project.%0A%0ASteps%3A%0A1.%20Install%20the%20package%3A%20npm%20install%20cursor-agent-browser-cli%0A2.%20Install%20Cursor%20CLI%3A%20curl%20https%3A%2F%2Fcursor.com%2Finstall%20-fsS%20%7C%20bash%0A3.%20Add%20~%2F.local%2Fbin%20to%20PATH%20if%20needed%0A4.%20Add%20the%20CursorOverlay%20component%20to%20my%20app%27s%20root%20layout%0A5.%20Show%20me%20how%20to%20run%20the%20bridge%20server%0A%0AThe%20package%20exports%20a%20CursorOverlay%20React%20component%20and%20a%20cursor-bridge%20CLI%20command.">
  <img src="https://img.shields.io/badge/Install%20with-Cursor-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMjRDMTguNjI3NCAyNCAyNCAxOC42Mjc0IDI0IDEyQzI0IDUuMzcyNTggMTguNjI3NCAwIDEyIDBDNS4zNzI1OCAwIDAgNS4zNzI1OCAwIDEyQzAgMTguNjI3NCA1LjM3MjU4IDI0IDEyIDI0WiIgZmlsbD0iIzAwMCIvPjwvc3ZnPg==" alt="Install with Cursor"/>
</a>

Or copy this link: 
```
cursor://anysphere.cursor-deeplink/prompt?text=Help%20me%20install%20cursor-agent-browser-cli%20in%20my%20React%2FNext.js%20project.%0A%0ASteps%3A%0A1.%20Install%20the%20package%3A%20npm%20install%20cursor-agent-browser-cli%0A2.%20Install%20Cursor%20CLI%3A%20curl%20https%3A%2F%2Fcursor.com%2Finstall%20-fsS%20%7C%20bash%0A3.%20Add%20~%2F.local%2Fbin%20to%20PATH%20if%20needed%0A4.%20Add%20the%20CursorOverlay%20component%20to%20my%20app%27s%20root%20layout%0A5.%20Show%20me%20how%20to%20run%20the%20bridge%20server%0A%0AThe%20package%20exports%20a%20CursorOverlay%20React%20component%20and%20a%20cursor-bridge%20CLI%20command.
```

---

## 📦 Manual Installation

### 1. Install the package

```bash
npm install cursor-agent-browser-cli
```

### 2. Install Cursor CLI

```bash
curl https://cursor.com/install -fsS | bash
```

Then add `~/.local/bin` to your PATH:

```bash
# For zsh (most macOS users)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# For bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 3. Verify Cursor CLI is authenticated

```bash
cursor-agent status
```

If not logged in, run `cursor-agent login`.

---

## 🚀 Usage

### Step 1: Add the Overlay to your app

#### Next.js App Router

Create `app/CursorOverlay.tsx`:

```tsx
"use client";
import dynamic from 'next/dynamic';

const CursorOverlay = dynamic(
  () => import('cursor-agent-browser-cli').then((mod) => mod.CursorOverlay),
  { ssr: false }
);

export default function ClientOverlay() {
  if (process.env.NODE_ENV !== 'development') return null;
  return <CursorOverlay />;
}
```

Add to `app/layout.tsx`:

```tsx
import ClientOverlay from './CursorOverlay';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <ClientOverlay />
      </body>
    </html>
  );
}
```

#### Vite / Create React App

```tsx
import { CursorOverlay } from 'cursor-agent-browser-cli';

function App() {
  return (
    <>
      <YourApp />
      {process.env.NODE_ENV === 'development' && <CursorOverlay />}
    </>
  );
}
```

### Step 2: Start the bridge server

In your project directory, run:

```bash
npx cursor-bridge
```

You should see:
```
============================================================
🔌 CURSOR BRIDGE - Browser → AI → Code
============================================================
📡 Server: http://localhost:3333
📁 Project: /your/project/path
```

### Step 3: Start your dev server

In another terminal:

```bash
npm run dev
```

### Step 4: Use it!

1. Open your app in the browser
2. Click the **"Enable Agent"** button (bottom-right corner)
3. Click on any UI element you want to edit
4. Type your instruction (e.g., "Change this to blue")
5. Press Enter or click Send
6. Watch the AI edit your code!
7. See changes instantly via HMR ✨

---

## 🎬 How it Works

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. Click "Enable Agent"                             │   │
│  │  2. Click on any element (uses react-grab)           │   │
│  │  3. Type: "Make this button red"                     │   │
│  │  4. Press Enter                                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ POST /cursor-command
┌─────────────────────────────────────────────────────────────┐
│  BRIDGE SERVER (cursor-bridge on port 3333)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Receives: file path, component, instruction         │   │
│  │  Builds prompt for AI                                │   │
│  │  Runs: cursor-agent -p -f                            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  CURSOR AGENT (AI)                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Edits your source code directly                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  HMR (Hot Module Replacement)                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Browser updates automatically!                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠 Requirements

- **Node.js** 18+
- **React** 18+
- **Cursor IDE** with CLI installed
- **macOS** (Windows/Linux support coming soon)

---

## 📋 Troubleshooting

### "cursor-agent not found"

Make sure the Cursor CLI is installed and in your PATH:

```bash
# Install
curl https://cursor.com/install -fsS | bash

# Add to PATH
export PATH="$HOME/.local/bin:$PATH"

# Verify
cursor-agent --version
```

### "cursor-agent timed out"

The AI is taking too long. Try:
- A simpler, more specific instruction
- Making sure you're authenticated: `cursor-agent status`

### Element source not found

For Next.js App Router with Server Components, the tool falls back to inferring the file from the URL route. This works for most cases.

For best results, click on **Client Components** (files with `"use client"`).

---

## 🤝 Contributing

PRs welcome! This is an experimental tool - lots of room for improvement.

---

## 📄 License

MIT

---

## 🙏 Credits

- [react-grab](https://react-grab.com) - Element selection and source detection
- [Cursor](https://cursor.com) - AI-powered code editor
- [cursor-agent CLI](https://cursor.com/cli) - Headless AI coding agent

