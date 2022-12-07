# tims-chatgpt-bot

## Install

- [Create a Telegram bot](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).
- Create a `config.mjs` in the root path that exports your bot’s token:
  ```js
  export const TELEGRAM_BOT_TOKEN = '<your Telegram bot token>';
  ```
- Install the bot back-end via `npm install`.
- Make the executable available via `npm link`.

## Run

Launch the bot back-end via `tims-chatgpt-bot (<ChatGPT session token>)`. You can authenticate with ChatGPT directly by providing a valid session token (taken from cookies after [signing in at ChatGPT](https://chat.openai.com/chat)).
