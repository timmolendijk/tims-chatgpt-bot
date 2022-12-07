# tims-chatgpt-bot

## Install

1. Create a Telegram bot.
2. Create a `config.mjs` in the root path that exports your bot’s token:
   ```js
   export const TELEGRAM_BOT_TOKEN = '<your Telegram bot token>';
   ```
3. Install the bot back-end via `npm install`.
4. Make the executable available via `npm link`.
5. Launch the bot back-end via `tims-chatgpt-bot (<ChatGPT session token>)`. You can authenticate with ChatGPT directly by providing a valid session token (taken from cookies after signing in at <https://chat.openai.com/chat>).
