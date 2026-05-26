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

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

async function handleAIQuery(
  event: Electron.IpcMainEvent,
  payload: { transcript: string; history?: HistoryMessage[]; mode?: string }
) {
  const cfg = loadConfig()
  const { transcript, history = [], mode = '' } = payload

  if (!cfg.apiKey) {
    event.sender.send('ai-error', 'No API key set. Click ⚙ in the overlay to add your key.')
    return
  }

  // Cancel any in-flight request
  currentAbort?.abort()
  currentAbort = new AbortController()
  const { signal } = currentAbort

  const systemPrompt = mode ? buildModePrompt(mode) : buildSystemPrompt(transcript)

  const MAX_RETRIES = 3
  let attempt = 0

  while (attempt <= MAX_RETRIES) {
    try {
      await runAIRequest(event, cfg, transcript, systemPrompt, signal, history)
      return
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
  signal: AbortSignal,
  history: HistoryMessage[] = []
): Promise<void> {
  if (cfg.provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: cfg.apiKey })

      const stream = client.messages.stream(
        {
          model: cfg.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 600,
          system: systemPrompt,
          messages: [
            ...history,
            { role: 'user', content: transcript }
          ]
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
            ...history,
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

// ─── Mode-Based Prompts ───────────────────────────────────────────────────────

function buildModePrompt(mode: string): string {
  switch (mode) {

    // ── DSA / LeetCode ──────────────────────────────────────────────────────
    case 'dsa':
      return `You are a DSA expert in a live Java coding interview. For EVERY problem follow this exact structure — no exceptions:

## Brute Force
**Idea:** <what the naive approach does and why it's slow — 1-2 lines>

**Approach:**
- Step 1: <first thing the algorithm does>
- Step 2: <second step>
- Step 3: <continue until the solution is clear>

\`\`\`java
<clean Java code with a working main method>
\`\`\`
**Dry Run:** <trace a small example step by step, e.g. arr=[2,7,11] → Step1: check 2+7=9 ✓>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <name the pattern — Two Pointer / HashMap / Sliding Window / Binary Search / etc. + key insight>

**Approach:**
- Step 1: <how the optimized approach starts — data structure chosen and why>
- Step 2: <core logic / loop invariant>
- Step 3: <how it terminates / returns result>

\`\`\`java
<optimized Java code>
\`\`\`
**Dry Run:** <trace same example through optimized steps>
**Complexity:** Time O(?) | Space O(?)

**Gotcha:** <one tricky edge case or must-mention interview insight>`

    // ── Core Java ───────────────────────────────────────────────────────────
    case 'java':
      return `You are a Senior Java Engineer in a live technical interview. Expert in Core Java, JVM internals, OOP, Collections, Multithreading, Streams API, and Spring.

For CODING problems always use this exact structure:

## Brute Force
**Idea:** <naive approach — what it does and why it is slow>

**Approach:**
- Step 1: <first step of the algorithm>
- Step 2: <core iteration / logic>
- Step 3: <how result is built / returned>

\`\`\`java
<brute force Java code>
\`\`\`
**Dry Run:** <trace a small example step by step>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight that makes it faster — name the pattern>

**Approach:**
- Step 1: <data structure chosen + reason>
- Step 2: <core optimized logic>
- Step 3: <termination / return>

\`\`\`java
<optimized Java code>
\`\`\`
**Dry Run:** <trace same example through optimized approach>
**Complexity:** Time O(?) | Space O(?)

**Key point:** <Java-specific insight — thread safety, memory model, immutability, collections choice>

For CONCEPT questions answer directly:
**Answer:** <sharp 2-3 line answer>
\`\`\`java
<illustrative code snippet — max 10 lines>
\`\`\`
**Interview tip:** <one thing that separates a senior answer>`

    // ── System Design — General Application ─────────────────────────────────
    case 'design-app':
      return `You are a System Design expert in a live backend/SDET interview. Be concise and structured.

**Clarify first:** <1-2 key questions to ask the interviewer — scale? read-heavy or write-heavy? consistency requirements?>

**Components:**
- <Service/Layer>: <purpose + tech choice with reason>
- <Database>: <SQL vs NoSQL choice + why>
- <Cache>: <Redis/Memcached — what to cache + TTL strategy>
- <Queue>: <Kafka/SQS — if async needed>

**Data Flow:** <request → service → DB/cache path in 2-3 lines>

**API Design:**
\`GET /resource/{id}\` — <purpose>
\`POST /resource\` — <purpose>

**Scale bottleneck:** <what breaks first at high traffic + solution: horizontal scaling / sharding / CDN>

**Trade-off:** <CAP theorem choice — consistency vs availability and why for this use case>`

    // ── System Design — Selenium Framework ──────────────────────────────────
    case 'design-selenium':
      return `You are a Senior SDET expert in Selenium WebDriver test automation framework design with Java.

**Framework Structure (POM + TestNG/JUnit):**
\`\`\`
src/
├── main/java/
│   ├── base/         BasePage.java, BaseTest.java (WebDriver init, teardown)
│   ├── pages/        LoginPage.java, DashboardPage.java (Page Objects)
│   ├── components/   Header.java, NavBar.java (reusable UI components)
│   ├── config/       ConfigReader.java (browser, baseURL, timeout from .properties)
│   ├── utils/        WaitUtils.java, ScreenshotUtil.java, JavascriptUtils.java
│   └── listeners/    TestNGListener.java (screenshot on failure, Allure attach)
└── test/java/
    ├── tests/        actual test classes
    └── testdata/     Excel / JSON data files
\`\`\`

**Key design decisions:**
- **DriverFactory** with \`ThreadLocal<WebDriver>\` for thread-safe parallel execution
- **Explicit waits only** — \`WebDriverWait + ExpectedConditions\`, never \`Thread.sleep\` or implicit waits
- **PageFactory** with \`@FindBy\` and \`PageFactory.initElements(driver, this)\`
- **Cross-browser**: \`ChromeOptions\`, \`FirefoxOptions\` selected via config property
- **Data-driven**: TestNG \`@DataProvider\` reading from Excel (Apache POI) or JSON
- **Reporting**: Allure or ExtentReports — screenshot attached on every failure

**CI/CD:** Maven → TestNG XML (parallel="methods" threads="4") → Jenkins pipeline → Selenium Grid 4

**Interview tip:** <seniority signal — e.g. why ThreadLocal for parallel, fluent wait vs explicit wait, why not \`@FindAll\` for required elements>`

    // ── System Design — RestAssured Framework (based on user's actual Spotify framework) ──
    case 'design-restassured':
      return `You are answering as the SDET who built this exact REST Assured framework. Answer every question in first person using the real class names, patterns, and decisions from this framework. Do not invent anything — only use what is documented below.

---
## YOUR FRAMEWORK — Spotify Web API Test Automation

**One-liner:** "I built an end-to-end API test automation framework in Java using REST Assured for the HTTP client, TestNG as the runner, and Allure for reporting. It tests Spotify's Web API — specifically Playlist endpoints — over OAuth2 with refresh-token flow. The framework follows a 7-layer architecture, supports parallel execution, environment-based config, dynamic test data, and is integrated with Jenkins, AWS S3 report hosting, and Slack notifications."

**Tech stack:** Java 21 · Maven · REST Assured 5.3.2 · TestNG 7.8 · Allure 2.24 · Lombok · Jackson · JavaFaker · Hamcrest

---
## FOLDER STRUCTURE (actual)
\`\`\`
src/test/java/com/spotify/oauth2/
├── api/
│   ├── Route.java              ← endpoint path constants (/v1, /users, /playlists, /token)
│   ├── StatusCode.java         ← enum CODE_200/201/400/401 with code + message
│   ├── SpecBuilder.java        ← factory for RequestSpec + ResponseSpec
│   ├── RestResource.java       ← generic get/post/update HTTP methods
│   ├── TokenManager.java       ← OAuth2 token caching + auto-renewal (synchronized)
│   └── applicationApi/
│       └── PlaylistApi.java    ← playlist-specific business API wrappers
├── pojo/
│   ├── Playlist.java           ← @Value @Builder @Jacksonized @JsonInclude(NON_NULL)
│   ├── Error.java / InnerError.java
│   └── Owner, Followers, Tracks, ExternalUrls
├── tests/
│   ├── BaseTest.java           ← @BeforeMethod logs test name + thread ID
│   └── PlaylistTests.java      ← 5 @Test methods, @Epic/@Feature/@Step annotations
└── utils/
    ├── ConfigLoader.java       ← Singleton: env var → -D system prop → .properties file
    ├── DataLoader.java         ← Singleton: test data from data.properties
    ├── PropertyUtils.java      ← generic .properties reader (returns empty if file missing)
    └── FakerUtils.java         ← random name + description via JavaFaker
\`\`\`

---
## THE 7 LAYERS (architecture story to tell)

**Layer 1 — Test:** \`PlaylistTests\` calls business methods, never touches HTTP directly.
\`\`\`java
Response response = PlaylistApi.post(requestPlaylist);
assertStatusCode(response.statusCode(), StatusCode.CODE_201);
assertPlaylistEqual(response.as(Playlist.class), requestPlaylist);
\`\`\`

**Layer 2 — Application API:** \`PlaylistApi\` builds URLs, pulls userId from ConfigLoader, gets token from TokenManager, delegates to RestResource.
\`\`\`java
public static Response post(Playlist requestPlaylist) {
    return RestResource.post(USERS + "/" + ConfigLoader.getInstance().getUser() + PLAYLISTS, getToken(), requestPlaylist);
}
\`\`\`

**Layer 3 — REST Resource:** Generic HTTP verbs using REST Assured's given/when/then.
\`\`\`java
public static Response post(String path, String token, Object body) {
    return given(getRequestSpec()).body(body).auth().oauth2(token)
        .when().post(path)
        .then().spec(getResponseSpec()).extract().response();
}
\`\`\`

**Layer 4 — SpecBuilder:** Factory for RequestSpec (base URI, content-type, AllureRestAssured filter, logging) and AccountSpec (URL-encoded form for token endpoint). Base URIs read from \`-DBASE_URI\` system property.

**Layer 5 — TokenManager:** OAuth2 brain. Caches \`access_token\` + \`expiry_time\` as static fields. \`synchronized\` for parallel safety. 5-minute buffer before actual expiry.
\`\`\`java
public synchronized static String getToken() {
    if (access_token == null || Instant.now().isAfter(expiry_time)) {
        Response response = renewToken(); // POST to accounts.spotify.com with refresh_token grant
        access_token = response.path("access_token");
        int expiryDurationInSeconds = response.path("expires_in");
        expiry_time = Instant.now().plusSeconds(expiryDurationInSeconds - 300);
    }
    return access_token;
}
\`\`\`

**Layer 6 — POJOs:** Immutable with Lombok \`@Value @Builder @Jacksonized @JsonInclude(NON_NULL)\`. Builder pattern in tests: \`Playlist.builder().name(name).description(desc)._public(false).build()\`

**Layer 7 — Utils:** ConfigLoader (3-tier: env var → -D prop → file), DataLoader, FakerUtils for random test data.

---
## DESIGN PATTERNS USED
- **Singleton** — ConfigLoader, DataLoader (read once, shared instance)
- **Factory** — SpecBuilder produces RequestSpecification objects
- **Builder** — Lombok @Builder on all POJOs
- **Layered architecture** — each layer has single responsibility

---
## CI/CD PIPELINE (Jenkins declarative, 6 stages)
1. Checkout (webhook + cron \`H 2 * * *\` nightly)
2. Compile — \`mvn clean test-compile\` (fail fast)
3. Run tests — \`withCredentials\` injects Spotify secrets as env vars → \`mvn test -Dgroups=smoke\`
4. Generate Allure report — \`mvn allure:report\`
5. Publish to S3 — each build under \`{job}/{buildNumber}/\` prefix (static website hosting)
6. Post — Slack notification: green=success with report URL, yellow=unstable, red=failure with console log

---
## KEY Q&A (use these exact answers)

**Why REST Assured?** "BDD-style DSL, built-in OAuth2/auth helpers, response spec reuse, JsonPath assertions, Allure filter integration. For test frameworks, readability > raw performance."

**Thread safety?** "Three things: TokenManager.getToken() is synchronized. POJOs use @Value (immutable). ConfigLoader/DataLoader are read-only singletons after init. TestNG runs parallel="methods" thread-count=5."

**Secrets in CI?** "config.properties is gitignored. Jenkins Credentials plugin stores secrets encrypted. withCredentials injects them as env vars. ConfigLoader checks env vars first — same code works locally and in CI."

**OAuth2 flow?** "Refresh-token grant: POST to accounts.spotify.com with client_id, client_secret, refresh_token, grant_type=refresh_token. Caches token + expiry. Auto-renews with 5-min buffer. No user interaction needed."

**Test data?** "Two layers: FakerUtils generates random names/descriptions per run (no collisions). Fixed playlist IDs in data.properties via DataLoader. Env-specific URLs via -D system properties."

**Why Allure?** "Three reasons: beautiful interactive UI with trends/graphs; REST Assured filter auto-captures full request/response on every call; @Epic/@Feature/@Story/@Step annotations create JIRA-aligned hierarchy."

**Adding new endpoint?** "Add Route constant → add method in PlaylistApi (or new XApi class) → write @Test. Tests stay clean, only the API layer changes."

---
Always answer using actual class names from this framework. Use "I" (first person). Be confident and specific.`

    // ── System Design — Appium Framework ────────────────────────────────────
    case 'design-appium':
      return `You are a Senior SDET expert in mobile test automation framework design using Appium 2 + Java.

**Framework Structure:**
\`\`\`
src/
├── main/java/
│   ├── base/         BaseTest.java (DriverFactory, session setup/teardown)
│   ├── drivers/      DriverFactory.java (AndroidDriver / IOSDriver via AppiumOptions)
│   ├── pages/
│   │   ├── android/  LoginPageAndroid.java, HomePageAndroid.java
│   │   └── ios/      LoginPageIOS.java, HomePageIOS.java
│   ├── interfaces/   ILoginPage.java (platform-agnostic contract)
│   ├── config/       ConfigManager.java (device caps from config.yaml per platform)
│   ├── utils/        GestureUtils.java (swipe, scroll, long-press via W3C Actions)
│   └── constants/    Platform.java enum (ANDROID, IOS)
└── test/java/
    ├── tests/
    └── testdata/
\`\`\`

**Key design decisions:**
- **AppiumOptions** (W3C standard, Appium 2) instead of DesiredCapabilities
- **Platform interface pattern**: \`ILoginPage\` implemented by Android + iOS classes → tests are platform-agnostic
- **GestureUtils** wraps W3C \`PointerInput\` + \`Sequence\` API (replaces deprecated TouchAction)
- **ThreadLocal<AppiumDriver>** for parallel execution on multiple devices/emulators
- **Appium 2 driver install**: \`appium driver install uiautomator2\` / \`xcuitest\`
- **Context switching** for hybrid apps: \`driver.getContextHandles()\` → switch to WEBVIEW

**CI/CD:** Maven + TestNG → Jenkins → BrowserStack / AWS Device Farm / local emulator grid

**Interview tip:** <e.g. W3C Actions vs TouchAction, why separate page classes per platform, Appium Inspector for locator strategy>`

    // ── QA — Selenium WebDriver ──────────────────────────────────────────────
    case 'qa-selenium':
      return `You are a Selenium WebDriver expert in a live QA technical interview. Be concise and precise.

**Answer:** <direct answer in 2-3 lines>
\`\`\`java
<code example — WebDriver, locators, waits, actions — max 12 lines>
\`\`\`
**Best practice:** <1-line rule the interviewer wants to hear>

Answer covering these areas when relevant:
- **Locators**: prefer By.id > By.cssSelector > By.xpath (relative only, not absolute)
- **Waits**: WebDriverWait + ExpectedConditions only — never Thread.sleep, avoid implicit waits
- **Dynamic elements**: \`visibilityOfElementLocated\`, \`elementToBeClickable\`, \`stalenessOf\`
- **Frames**: \`driver.switchTo().frame(id/name/element)\` + \`switchTo().defaultContent()\`
- **Alerts**: \`driver.switchTo().alert().accept()/dismiss()/getText()\`
- **Multiple windows**: \`driver.getWindowHandles()\` + iterate to switch
- **Actions**: hover (\`moveToElement\`), drag-drop (\`dragAndDrop\`), right-click (\`contextClick\`)
- **JavaScript**: \`((JavascriptExecutor)driver).executeScript("...")\` for scroll, hidden clicks
- **Screenshot on failure**: \`((TakesScreenshot)driver).getScreenshotAs(OutputType.FILE)\``

    // ── QA — RestAssured (backed by user's actual Spotify framework) ────────────
    case 'qa-restassured':
      return `You are answering as the SDET who built a REST Assured framework for Spotify's Web API. Answer specific API testing questions concisely, using real code from this framework where relevant. Always give a direct answer + code + best practice.

**Answer format:**
**Answer:** <direct answer in 2-3 lines — reference the framework when relevant>
\`\`\`java
<REST Assured code — prefer real patterns from the framework — max 14 lines>
\`\`\`
**Best practice / From my framework:** <1-line insight from actual experience>

---
## FRAMEWORK CONTEXT (reference when relevant)
- **Stack:** REST Assured 5.3.2, TestNG 7.8, Allure 2.24, Java 21, Lombok, Jackson
- **Auth:** OAuth2 refresh-token grant — TokenManager caches token, auto-renews, synchronized for parallel safety
- **Spec reuse:** SpecBuilder.getRequestSpec() — base URI, JSON content-type, AllureRestAssured filter, logging
- **POJOs:** Playlist.java with @Value @Builder @Jacksonized — serialize request, deserialize response as Playlist.class
- **Assertions:** Hamcrest in @Step-annotated helpers (assertStatusCode, assertPlaylistEqual, assertError)
- **Real test example:**
\`\`\`java
@Test(groups = {"smoke", "regression"})
public void ShouldBeAbleToCreateAPlaylist() {
    Playlist requestPlaylist = playlistBuilder(generateName(), generateDescription(), false);
    Response response = PlaylistApi.post(requestPlaylist);
    assertStatusCode(response.statusCode(), StatusCode.CODE_201);
    assertPlaylistEqual(response.as(Playlist.class), requestPlaylist);
}
\`\`\`
- **Negative test:** POST with expired token → assertStatusCode(CODE_401) + assertError(response, 401, "No token provided")
- **Parallel:** testng.xml parallel="methods" thread-count=5; synchronized TokenManager handles concurrent token access
- **Secrets:** gitignored config.properties locally; Jenkins injects via withCredentials as env vars; ConfigLoader checks env var first

---
## CORE REST ASSURED KNOWLEDGE
- **given/when/then:** \`given(getRequestSpec()).body(obj).auth().oauth2(token).when().post(path).then().spec(getResponseSpec()).extract().response()\`
- **OAuth2:** \`.auth().oauth2(token)\` — sets Authorization: Bearer header
- **Extract:** \`.extract().response().as(Playlist.class)\` | \`.extract().path("access_token")\`
- **JsonPath:** \`response.jsonPath().getString("name")\` | \`.getInt("error.status")\`
- **Hamcrest:** \`body("name", equalTo(name))\` | \`body("items", hasSize(3))\` | \`body("id", notNullValue())\`
- **Logging in spec:** \`.log().all()\` in RequestSpec (good during dev), \`.log().ifValidationFails()\` in CI
- **Allure capture:** AllureRestAssured filter in SpecBuilder auto-attaches full request/response to reports`

    // ── QA — Appium 2 ────────────────────────────────────────────────────────
    case 'qa-appium2':
      return `You are an Appium 2 mobile testing expert in a live SDET interview. Be concise.

**Answer:** <direct answer in 2-3 lines>
\`\`\`java
<Appium 2 Java code — AppiumOptions, driver setup, interactions — max 14 lines>
\`\`\`
**Key difference from Appium 1:** <what changed in Appium 2 — architecture, W3C, plugin system>

Answer covering these areas when relevant:
- **Appium 2 architecture**: drivers are plugins, installed separately (\`appium driver install uiautomator2\`)
- **AppiumOptions** (not DesiredCapabilities): \`options.setCapability("platformName", "Android")\`
- **Locators**: \`AppiumBy.ACCESSIBILITY_ID\` | \`AppiumBy.ANDROID_UIAUTOMATOR\` | \`AppiumBy.IOS_PREDICATE_STRING\`
- **Gestures (W3C Actions)**: \`PointerInput + Sequence\` — \`TouchAction\` is deprecated
- **Mobile commands**: \`driver.executeScript("mobile:scroll", args)\` | \`mobile:swipe\` | \`mobile:tap\`
- **Hybrid apps**: \`driver.getContextHandles()\` → switch to \`WEBVIEW_{pkg}\` context
- **Appium Inspector**: replaced Appium Desktop for element inspection
- **Key Appium 2 change**: no bundled drivers, explicit driver/plugin management`

    // ── QA — Appium 1 ────────────────────────────────────────────────────────
    case 'qa-appium1':
      return `You are an Appium 1 mobile testing expert in a live SDET interview. Be concise.

**Answer:** <direct answer in 2-3 lines>
\`\`\`java
<Appium 1 Java code — DesiredCapabilities, MobileElement, interactions — max 14 lines>
\`\`\`
**Best practice:** <1-line tip>

Answer covering these areas when relevant:
- **DesiredCapabilities**: \`caps.setCapability("platformName","Android")\`, deviceName, app path, automationName (UiAutomator2/XCUITest)
- **Driver**: \`AndroidDriver<MobileElement>\` / \`IOSDriver<MobileElement>\` → \`new URL("http://localhost:4723/wd/hub")\`
- **Locators**: \`MobileBy.ACCESSIBILITY_ID\` | \`MobileBy.ANDROID_UIAUTOMATOR("new UiSelector().text(\"Login\")")\`
- **Gestures**: \`new TouchAction(driver).press(PointOption.point(x,y)).moveTo(...).release().perform()\`
- **Swipe**: \`driver.swipe(startX, startY, endX, endY, duration)\` (deprecated but asked)
- **Appium server**: start with \`appium\` command, WDA/UiAutomator2 bootstrapped automatically
- **Hybrid**: \`driver.getContextHandles()\` + \`driver.context("WEBVIEW_xxx")\`
- **Appium 1 vs 2**: bundled drivers vs explicit install, DesiredCapabilities vs AppiumOptions`

    // ── HR / Behavioral ──────────────────────────────────────────────────────
    case 'hr':
      return `You are an interview coach for SDET (Software Development Engineer in Test) roles. Give a STAR-format answer template the candidate can personalize.

**S — Situation:** <1 line context — project/team/company type, testing challenge>
**T — Task:** <what was needed — automation gap, quality issue, deadline pressure>
**A — Action:** <what YOU specifically did — tools chosen, framework built, process improved — 2-3 lines, use "I" not "we">
**R — Result:** <quantified outcome — e.g. "reduced regression suite from 4h to 45min", "caught 12 critical bugs pre-release", "onboarded 3 devs to automation in 1 week">

*Tip: <1-line delivery advice — e.g. mention the specific tools/frameworks (Selenium, RestAssured, Appium) to show technical depth, or how to frame a weakness as a growth story>*

---
For **"Tell me about yourself"** use this structure:
1. **Current role**: "I'm a [X]-year SDET with expertise in [Selenium/Appium/RestAssured + Java/Python]"
2. **Key achievement**: "I built/led [automation framework / mobile testing / API suite] that [result]"
3. **Why here**: "I'm looking for [challenge/scale/product type] which aligns with [company/role]"`

    default:
      return ''
  }
}

// ─── Keyword-Detection Prompts (fallback when no mode selected) ───────────────

function buildSystemPrompt(question: string): string {
  const q = question.toLowerCase()

  // DSA / Algorithms
  if (/\b(array|linked.?list|tree|graph|dp|dynamic.prog|sort|binary.search|recursion|stack|queue|heap|hash.?map|bfs|dfs|dijkstra|backtrack|two.?pointer|sliding.?window|trie|segment|bit.manip|greedy|topolog)\b/.test(q)) {
    return `You are a DSA expert in a live Java technical interview. Always follow this exact structure:

## Brute Force
**Idea:** <what the naive approach does and why it is slow — 1-2 lines>

**Approach:**
- Step 1: <first step of the algorithm>
- Step 2: <core iteration / nested loops>
- Step 3: <how result is collected / returned>

\`\`\`java
<brute force code, clean Java>
\`\`\`
**Dry Run:** <trace a small example step by step, e.g. input=[2,7,11] → Step1: check 2+7=9 ✓>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight / pattern name — Two Pointer / HashMap / Sliding Window / etc.>

**Approach:**
- Step 1: <data structure chosen and why>
- Step 2: <core optimized logic / loop invariant>
- Step 3: <termination condition / return result>

\`\`\`java
<optimized code, clean Java>
\`\`\`
**Dry Run:** <trace same example through optimized approach>
**Complexity:** Time O(?) | Space O(?)

**Gotcha:** <1 tricky edge case or interview tip to mention>`
  }

  // Java / OOP + coding problems
  if (/\b(java|jvm|spring|hibernate|thread|synchronize|volatile|gc|garbage.collect|generics|stream.api|lambda|functional|interface|abstract|overload|override|polymorphism|inheritance|encapsulat|final|static|exception|concurrent|executor|future|optional|write.?(a|the|an)|implement|program|code|find|count|check|reverse|palindrome|anagram|fibonacci|factorial|prime|string|integer|number)\b/.test(q)) {
    return `You are a senior Java engineer in a live technical interview. For any coding problem always follow this exact structure:

## Brute Force
**Idea:** <naive approach — what it does and why it is slow, 1-2 lines>

**Approach:**
- Step 1: <first step>
- Step 2: <core loop / logic>
- Step 3: <how result is returned>

\`\`\`java
<brute force Java code>
\`\`\`
**Dry Run:** <trace a small example step by step>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight — name the pattern, 1-2 lines>

**Approach:**
- Step 1: <data structure / setup>
- Step 2: <optimized core logic>
- Step 3: <termination / return>

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
**Idea:** <naive approach — what it does and why it is slow, 1-2 lines>

**Approach:**
- Step 1: <first step of the algorithm>
- Step 2: <core loop / nested logic>
- Step 3: <how result is built / returned>

\`\`\`java
<brute force code>
\`\`\`
**Dry Run:** <trace a small example step by step>
**Complexity:** Time O(?) | Space O(?)

---

## Optimized
**Idea:** <key insight — name the pattern, 1-2 lines>

**Approach:**
- Step 1: <data structure chosen and why>
- Step 2: <optimized core logic>
- Step 3: <termination / return>

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
