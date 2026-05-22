#!/bin/bash
set -e

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║     Interview AI — Setup Script      ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── Check macOS ──────────────────────────────────────────────────────────────
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo -e "${YELLOW}⚠  This script is for macOS. On Linux/Windows, run: npm install && npm run dev${RESET}"
fi

# ── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${RESET}"
  echo "  Install via Homebrew:  brew install node"
  echo "  Or via nvm:            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo -e "${RED}✗ Node.js 18+ required (found $(node -v))${RESET}"
  echo "  Run: nvm install 20 && nvm use 20"
  exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v)${RESET}"

# ── Check npm ────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm not found${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${RESET}"

# ── Install dependencies ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}📦 Installing dependencies...${RESET}"
npm install

echo ""
echo -e "${GREEN}✓ Dependencies installed${RESET}"

# ── macOS Permissions ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${YELLOW}⚠  REQUIRED: Grant these macOS permissions${RESET}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  System Settings → Privacy & Security →"
echo -e "    ${BOLD}Microphone${RESET}       → Enable for Terminal (and Electron when prompted)"
echo -e "    ${BOLD}Accessibility${RESET}    → Enable for Terminal (needed for global hotkeys)"
echo ""
echo -e "  You will also see a permission popup on first launch — click ${BOLD}Allow${RESET}."
echo ""

# ── Launch ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}🚀 Starting Interview AI...${RESET}"
echo ""
echo -e "${BOLD}Hotkeys:${RESET}"
echo -e "  ${BOLD}⌘⇧Space${RESET}  — Toggle microphone"
echo -e "  ${BOLD}⌘⇧H${RESET}      — Hide / show overlay"
echo -e "  ${BOLD}⌘⇧C${RESET}      — Clear answer"
echo -e "  ${BOLD}⌘⇧P${RESET}      — Pin answer"
echo ""
echo -e "${BOLD}First run:${RESET} Click the ${BOLD}⚙${RESET} icon in the overlay to add your API key."
echo ""

npm run dev
