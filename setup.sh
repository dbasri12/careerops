#!/bin/bash
# Career-Ops — one-time setup script
# Run: bash setup.sh

echo ""
echo "🚀 Career-Ops setup"
echo "──────────────────"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install it from https://nodejs.org (v18 or higher)"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js v18+ required. You have $(node -v). Update at https://nodejs.org"
  exit 1
fi

echo "✅ Node.js $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install Playwright browser
echo "🎭 Installing Playwright + Chromium..."
npx playwright install chromium

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start Career-Ops:"
echo "  node server.js"
echo ""
echo "Then open: http://localhost:3747"
echo ""
