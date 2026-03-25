# Setup Guide: Braze AI Translator

This guide walks you through setting up the Braze AI Translator on your Mac so you can test it locally and use it with your Braze workspace.

## Prerequisites

You'll need:

- A Mac running macOS
- Chrome browser
- A Braze account with API access
- An OpenAI API key

## Step 1: Install Required Tools

Open Terminal and run these commands one at a time.

### Install Homebrew (if you don't have it)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions. When it finishes, it may ask you to run a couple of commands to add Homebrew to your PATH -- copy and paste those commands if prompted.

### Install Node.js

```bash
brew install node
```

Verify it installed:

```bash
node --version
```

You should see something like `v25.x.x`.

### Install pnpm

```bash
npm install -g pnpm
```

Verify it installed:

```bash
pnpm --version
```

You should see something like `9.x.x`.

## Step 2: Download the Project

### Option A: If you have git

```bash
cd ~/Documents
git clone https://github.com/YOUR_USERNAME/braze-ai-translator.git
cd braze-ai-translator
```

### Option B: Download as ZIP

1. Go to the GitHub repository
2. Click the green "Code" button
3. Click "Download ZIP"
4. Unzip the file to your Documents folder
5. Open Terminal and navigate to it:

```bash
cd ~/Documents/braze-ai-translator
```

## Step 3: Install Dependencies

From the `braze-ai-translator` folder in Terminal:

```bash
pnpm install
```

This will take 1-2 minutes. You'll see a lot of text scroll by -- that's normal.

## Step 4: Build the Project

```bash
pnpm build
```

This compiles all the TypeScript code. Takes about 10-15 seconds.

## Step 5: Configure Your API Keys

You'll need:

- Your Braze REST API key
- Your Braze REST endpoint URL (e.g., `https://rest.iad-01.braze.com`)
- Your OpenAI API key

You'll enter these in the extension settings panel after loading it (Step 7).

## Step 6: Start the Backend Server

In Terminal (in the `braze-ai-translator` folder):

```bash
pnpm --filter @braze-ai-translator/backend start
```

You should see:

```
Server listening at http://127.0.0.1:8787
```

**Keep this Terminal window open.** The server needs to stay running while you use the extension.

## Step 7: Load the Extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Toggle "Developer mode" ON (top-right corner)
4. Click "Load unpacked"
5. Navigate to the `braze-ai-translator` folder on your computer
6. Select the `apps/extension` folder
7. Click "Select"

You should see "Braze AI Translator" appear in your extensions list.

## Step 8: Configure the Extension

1. Go to any Braze page (e.g., open a canvas or campaign)
2. Look for a small purple gear icon in the bottom-left corner of the page
3. Click the gear icon to open the settings panel
4. Fill in:
  - **Backend URL**: `http://127.0.0.1:8787`
  - **Braze REST API URL**: your Braze endpoint (e.g., `https://rest.iad-01.braze.com`)
  - **Braze API Key**: your Braze REST API key
  - **OpenAI API Key**: your OpenAI key
  - **Source Locale**: `en` (or whatever your source language is)
5. Click "Save Settings"

## Step 9: Test It

### Tool 1: Wrap Text in Translation Tags

1. Open a Braze canvas and go to any message editor
2. Highlight some text (e.g., "Hello there!")
3. Right-click the selected text
4. Click "Wrap in translation tag"
5. Enter a translation ID (e.g., `greeting`)
6. Click "Insert Tag"

The text should now be wrapped: `{% translation greeting %}Hello there!{% endtranslation %}`

### Tool 2: Translate Entire Canvas

1. Open a Braze canvas (make sure you've already added translation tags to your messages using Tool 1)
2. Look for the "Translate Canvas" button at the bottom of the page (next to "Test Canvas")
3. Click "Translate Canvas"
4. Wait for the progress modal (it will fetch the canvas, translate all tagged content into your configured locales, and push the translations back to Braze)
5. You'll see a success or error toast when it completes

## Troubleshooting

### "Backend URL is not configured"

Open the settings panel (gear icon, bottom-left) and enter `http://127.0.0.1:8787` as the Backend URL.

### "Server listening" doesn't appear

Make sure you ran `pnpm build` before starting the server.

### Extension doesn't appear in Chrome

Make sure you selected the `apps/extension` folder (not the root `braze-ai-translator` folder) when loading the unpacked extension.

### Right-click menu doesn't show "Wrap in translation tag"

Refresh the Braze page after loading the extension.

### "Translate Canvas" button doesn't appear

The button only appears on canvas edit pages. Make sure you're viewing a canvas (not a campaign or template).

### Translations aren't working

1. Check that your OpenAI API key is valid and has credits
2. Check that your Braze API key has the correct permissions (`canvas.details`, `canvas.translations.get`, `canvas.translations.update`)
3. Open Chrome DevTools (View > Developer > JavaScript Console) and look for any error messages

### Backend server stopped

If you closed the Terminal window or pressed Ctrl+C, the server stopped. Run Step 6 again to restart it.

## Updating the Extension

When Thomas pushes updates:

1. Stop the backend server (Ctrl+C in Terminal)
2. Pull the latest code:
  ```bash
   cd ~/Documents/braze-ai-translator
   git pull
  ```
3. Rebuild:
  ```bash
   pnpm install
   pnpm build
  ```
4. Restart the backend:
  ```bash
   pnpm --filter @braze-ai-translator/backend start
  ```
5. Go to `chrome://extensions/` and click the refresh icon on the "Braze AI Translator" card
6. Refresh any open Braze pages

## Questions?

Reach out to Thomas if you run into issues.