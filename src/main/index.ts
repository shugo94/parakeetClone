import { app, BrowserWindow, globalShortcut, ipcMain, session } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'

const isDev = !app.isPackaged

// ─── Config ─────────────────────────────────────────────────────────────────

interface Config {
  apiKey: string
  provider: 'anthropic' | 'openai' | 'groq' | 'gemini' | 'openrouter'
  model: string
  contentProtection: boolean
  overlayX: number
  overlayY: number
  overlayWidth: number
  overlayHeight: number
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) }
    }
  } catch {
    // ignore parse errors
  }
  return defaultConfig()
}

function defaultConfig(): Config {
  return {
    apiKey: '',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    contentProtection: true,
    overlayX: 30,
    overlayY: 80,
    overlayWidth: 440,
    overlayHeight: 580
  }
}

function saveConfig(partial: Partial<Config>): Config {
  const updated = { ...loadConfig(), ...partial }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2))
  return updated
}

// ─── Windows ─────────────────────────────────────────────────────────────────

let overlayWindow: BrowserWindow | null = null

function createOverlayWindow() {
  const cfg = loadConfig()

  overlayWindow = new BrowserWindow({
    width: cfg.overlayWidth,
    height: cfg.overlayHeight,
    x: cfg.overlayX,
    y: cfg.overlayY,
    minWidth: 320,
    minHeight: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    // macOS: 'panel' windows are excluded from Exposé / screen recording
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // ── Screen-capture protection ──────────────────────────────────────────────
  // This sets kCGWindowSharingNone at the macOS compositor level.
  // The window appears as a solid black rectangle in ALL screen recordings,
  // Zoom, Google Meet, Teams, OBS, and browser tab sharing.
  if (cfg.contentProtection) {
    overlayWindow.setContentProtection(true)
  }

  // Visible on all desktops / full-screen spaces
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Highest always-on-top level — stays above full-screen apps
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)

  // Load the renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Persist window position / size on close
  overlayWindow.on('close', () => {
    if (!overlayWindow) return
    const [x, y] = overlayWindow.getPosition()
    const [w, h] = overlayWindow.getSize()
    saveConfig({ overlayX: x, overlayY: y, overlayWidth: w, overlayHeight: h })
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

// ─── AI Query Handler ─────────────────────────────────────────────────────────

let currentAbort: AbortController | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleAIQuery(event: Electron.IpcMainEvent, payload: { transcript: string }) {
  const cfg = loadConfig()
  const { transcript } = payload

  if (!cfg.apiKey) {
    event.sender.send('ai-error', 'No API key set. Click ⚙ in the overlay to add your key.')
    return
  }

  // Cancel any in-flight request
  currentAbort?.abort()
  currentAbort = new AbortController()
  const { signal } = currentAbort

  const systemPrompt = buildSystemPrompt(transcript)

  const MAX_RETRIES = 3
  let attempt = 0

  while (attempt <= MAX_RETRIES) {
    try {
      await runAIRequest(event, cfg, transcript, systemPrompt, signal)
      return
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return
      const status = (err as { status?: number })?.status
      if (status === 429 && attempt < MAX_RETRIES) {
        const delay = 2000 * 2 ** attempt // 2s, 4s, 8s
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai-error', `Rate limit hit — retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`)
        }
        await sleep(delay)
        // Clear the transient error before retrying
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai-retry', null)
        }
        attempt++
        continue
      }
      console.error('[AI Error]', err)
      if (!event.sender.isDestroyed()) {
        const msg = status === 429
          ? 'Rate limit exceeded. Wait a moment then try again, or switch to Groq (free & faster).'
          : (err as Error).message || 'Request failed. Check your API key.'
        event.sender.send('ai-error', msg)
      }
      return
    }
  }
}

async function runAIRequest(
  event: Electron.IpcMainEvent,
  cfg: Config,
  transcript: string,
  systemPrompt: string,
  signal: AbortSignal
): Promise<void> {
  if (cfg.provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: cfg.apiKey })

      const stream = client.messages.stream(
        {
          model: cfg.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: 'user', content: transcript }]
        },
        { signal }
      )

      stream.on('text', (text) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai-token', text)
        }
      })

      await stream.finalMessage()
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai-done', null)
      }
    } else {
      // openai / groq / gemini / openrouter — all use the OpenAI-compatible SDK
      const { default: OpenAI } = await import('openai')

      const baseURLMap: Record<string, string> = {
        groq: 'https://api.groq.com/openai/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        openrouter: 'https://openrouter.ai/api/v1'
      }

      const defaultModelMap: Record<string, string> = {
        openai: 'gpt-4o',
        groq: 'llama-3.3-70b-versatile',
        gemini: 'gemini-2.0-flash-lite',
        openrouter: 'deepseek/deepseek-chat-v3-0324:free'
      }

      const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: cfg.apiKey }
      if (baseURLMap[cfg.provider]) clientOptions.baseURL = baseURLMap[cfg.provider]

      const client = new OpenAI(clientOptions)

      const stream = await client.chat.completions.create(
        {
          model: cfg.model || defaultModelMap[cfg.provider],
          max_tokens: 600,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: transcript }
          ]
        },
        { signal }
      )

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || ''
        if (text && !event.sender.isDestroyed()) {
          event.sender.send('ai-token', text)
        }
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai-done', null)
      }
    }
}

// ─── Prompt Engineering ───────────────────────────────────────────────────────

function buildSystemPrompt(question: string): string {
  const q = question.toLowerCase()

  // DSA / Algorithms
  if (/\b(array|linked.?list|tree|graph|dp|dynamic.prog|sort|binary.search|recursion|stack|queue|heap|hash.?map|bfs|dfs|dijkstra|backtrack|two.?pointer|sliding.?window|trie|segment|bit.manip|greedy|topolog)\b/.test(q)) {
    return `You are a DSA expert in a live Java technical interview. Always follow this exact structure:

## Brute Force
**Idea:** <what naive approach does, 1-2 lines>
\`\`\`java
<brute force code, clean Java>
\`\`\`
**Dry Run:** <trace through a small example step by step, e.g. input=[2,7,11], target=9 → check 2+7=9 ✓>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight / pattern name that makes it faster, 1-2 lines>
\`\`\`java
<optimized code, clean Java>
\`\`\`
**Dry Run:** <trace same example through optimized approach step by step>
**Complexity:** Time O(?) | Space O(?)

**Gotcha:** <1 tricky edge case or interview tip to mention>`
  }

  // Java / OOP + coding problems
  if (/\b(java|jvm|spring|hibernate|thread|synchronize|volatile|gc|garbage.collect|generics|stream.api|lambda|functional|interface|abstract|overload|override|polymorphism|inheritance|encapsulat|final|static|exception|concurrent|executor|future|optional|write.?(a|the|an)|implement|program|code|find|count|check|reverse|palindrome|anagram|fibonacci|factorial|prime|string|integer|number)\b/.test(q)) {
    return `You are a senior Java engineer in a live technical interview. For any coding problem always follow this exact structure:

## Brute Force
**Idea:** <naive approach, 1-2 lines>
\`\`\`java
<brute force Java code>
\`\`\`
**Dry Run:** <trace a small example step by step>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <what makes this faster/better, key insight in 1-2 lines>
\`\`\`java
<optimized Java code>
\`\`\`
**Dry Run:** <trace same example through optimized approach>
**Complexity:** Time O(?) | Space O(?)

**Key point:** <most important interview insight, edge case, or Java-specific detail>

For concept-only questions (no coding needed), answer directly in 3-4 lines with one code snippet if helpful.`
  }

  // Selenium / Test Automation
  if (/\b(selenium|webdriver|automation|xpath|css.?selector|page.?object|testng|junit|wait|implicit|explicit|fluent|locator|browser|chrome|firefox|appium|cucumber|bdd|test.?framework|report)\b/.test(q)) {
    return `You are a Selenium/QA automation expert in a technical interview. Be concise.

**Answer:** <direct answer, 2-3 lines>
\`\`\`java
<code example if relevant, 4-6 lines>
\`\`\`
**Best practice:** <1 line tip>`
  }

  // API Testing / REST
  if (/\b(api|rest|http|get\b|post\b|put\b|delete\b|status.?code|auth|oauth|jwt|postman|swagger|openapi|endpoint|request|response|header|body|curl|restassured|karate)\b/.test(q)) {
    return `You are an API testing expert in a technical interview. Be concise.

**Answer:** <direct answer, 2-3 lines>
**Key points:**
- <point 1>
- <point 2>
- <point 3 if needed>`
  }

  // System Design
  if (/\b(system.?design|design.?(a|the|this)|scale|scalab|load.?balanc|database|cach|cdn|kafka|redis|nosql|sql|shard|replicat|consistency|availab|cap.theorem|distributed|microservice|architect|message.?queue|event.?driven)\b/.test(q)) {
    return `You are a system design expert in a technical interview. Be concise.

**Components:**
- <component 1 + purpose>
- <component 2 + purpose>
- <component 3 + purpose>
- <component 4 if needed>

**Data Flow:** <1-2 lines>
**Scale numbers:** <key metrics to mention>
**Trade-off:** <CAP / consistency choice, 1 line>`
  }

  // HR / Behavioral
  if (/\b(tell me about yourself|introduce yourself|strength|weakness|why (this|you|join|our|the)|where.*see yourself|team.?work|conflict|challenge|achiev|proudest|project|experience|fail|success|leadership|collaborat|motivat|passion|why (should|hire)|greatest)\b/.test(q)) {
    return `You are an HR interview coach. Give a STAR-format template answer to adapt.

**Situation:** <1 line setup>
**Task/Action:** <what you did — 2 lines, action-oriented>
**Result:** <quantified outcome, 1 line>

*Delivery tip: <1 line on tone/framing>*`
  }

  // Default: generic interview answer
  return `You are an expert technical interview coach in a live interview.

If the question involves coding or a programming problem, always use this structure:

## Brute Force
**Idea:** <naive approach, 1-2 lines>
\`\`\`java
<brute force code>
\`\`\`
**Dry Run:** <trace a small example step by step>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight, 1-2 lines>
\`\`\`java
<optimized code>
\`\`\`
**Dry Run:** <trace same example>
**Complexity:** Time O(?) | Space O(?)

**Key point:** <interview-critical insight>

If it is a concept/theory question, answer in 3-4 sharp lines. Tone: confident, clear, ready to impress.`
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Grant mic + speech permissions needed for Web Speech API
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'microphone', 'speech', 'audio-capture']
    callback(allowed.includes(permission))
  })

  // Also needed in newer Electron versions — sync permission check
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    const allowed = ['media', 'microphone', 'speech', 'audio-capture']
    return allowed.includes(permission)
  })

  createOverlayWindow()

  // ── Global Hotkeys ─────────────────────────────────────────────────────────
  // Cmd+Shift+Space  — Toggle microphone listening
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    overlayWindow?.webContents.send('hotkey', 'toggle-listen')
  })

  // Cmd+Shift+H  — Hide / show overlay instantly
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow?.isVisible()) {
      overlayWindow.hide()
    } else {
      overlayWindow?.show()
      overlayWindow?.focus()
    }
  })

  // Cmd+Shift+C  — Clear current answer
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    overlayWindow?.webContents.send('hotkey', 'clear')
  })

  // Cmd+Shift+P  — Pin / unpin answer
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    overlayWindow?.webContents.send('hotkey', 'pin')
  })

  // ── IPC Handlers ───────────────────────────────────────────────────────────
  ipcMain.handle('get-config', () => loadConfig())
  ipcMain.handle('save-config', (_event, partial: Partial<Config>) => saveConfig(partial))

  ipcMain.handle('transcribe-audio', async (_event, arrayBuffer: ArrayBuffer, mimeType: string) => {
    const cfg = loadConfig()

    if (cfg.provider !== 'groq' && cfg.provider !== 'openai') {
      throw new Error(
        'Mic transcription needs Groq or OpenAI. Switch provider in ⚙ Settings, or type your question manually.'
      )
    }

    const { default: OpenAI, toFile } = await import('openai')
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: cfg.apiKey }
    if (cfg.provider === 'groq') clientOptions.baseURL = 'https://api.groq.com/openai/v1'

    const client = new OpenAI(clientOptions)
    const buffer = Buffer.from(arrayBuffer)

    // Guard: reject audio that's too small — Whisper will return 400 for these
    if (buffer.length < 4000) {
      return '' // return empty transcript, renderer will treat as no speech
    }

    // Strip codec params (e.g. "audio/webm;codecs=opus" → "audio/webm")
    const baseType = (mimeType || 'audio/webm').split(';')[0].trim()
    const ext = baseType.includes('ogg') ? 'ogg'
              : baseType.includes('mp4') ? 'mp4'
              : 'webm'

    const file = await toFile(buffer, `audio.${ext}`, { type: baseType })
    const model = cfg.provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'

    const result = await client.audio.transcriptions.create({ file, model, language: 'en' })
    return result.text
  })

  ipcMain.on('ai-query', handleAIQuery)
  ipcMain.on('ai-abort', () => {
    currentAbort?.abort()
    currentAbort = null
  })

  ipcMain.on('overlay-hide', () => overlayWindow?.hide())
  ipcMain.on('overlay-show', () => {
    overlayWindow?.show()
    overlayWindow?.focus()
  })
  ipcMain.on('set-content-protection', (_event, val: boolean) => {
    overlayWindow?.setContentProtection(val)
  })

  app.on('activate', () => {
    if (!overlayWindow) createOverlayWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
