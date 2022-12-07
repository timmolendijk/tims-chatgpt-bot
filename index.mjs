#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN } from './config.mjs';

const GPT_SESSION_TOKEN_COOKIE_KEY = '__Secure-next-auth.session-token';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15';

let [gptSessionToken] = process.argv.slice(2);

// TODO: How can we prevent this from being an ever-growing mapping?
let gptContext = {};

let bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/^\/(start|help|settings)$/, async message => {

  let lines = [`This is bot chat ${message.chat.id}.`];
  if (!gptSessionToken)
    lines.push("You have no valid GPT session. Use `/auth <session token>` to authenticate.");
  else if (gptContext[message.chat.id] && gptContext[message.chat.id].conversation_id)
    lines.push(`This is GPT conversation ${gptContext[message.chat.id].conversation_id}.`);

  await bot.sendMessage(
    message.chat.id, lines.join("\n"), { parse_mode: 'Markdown' }
  );

});

bot.onText(/^\/auth\b/, message => {

  [ , gptSessionToken] = message.text.split(' ');

});

bot.onText(/^\/reset\b/, message => {

  delete gptContext[message.chat.id];

});

bot.onText(/^[^\/]/, async message => {

  if (!gptContext[message.chat.id])
    gptContext[message.chat.id] = {
      parent_message_id: randomUUID(),
    };

  let answer;

  try {
    var sessionResponse = await requestGpt('api/auth/session', {
      headers: {
        Cookie: [GPT_SESSION_TOKEN_COOKIE_KEY, gptSessionToken].join('='),
      },
    });
  } catch (error) {
    return await sendErrorMessage(
      bot, message.chat.id, `GPT error: \`${error.message}\``
    );
  }

  gptSessionToken = getSetCookie(sessionResponse, GPT_SESSION_TOKEN_COOKIE_KEY);
  if (!gptSessionToken)
    return await bot.sendMessage(
      message.chat.id,
      "Please use `/auth <session token>` to sign in to GPT.",
      { parse_mode: 'Markdown' }
    );

  let { accessToken } = await sessionResponse.json();

  try {
    var conversationResponse = await requestGpt('backend-api/conversation', {
      method: 'POST',
      // If it takes longer than a few seconds before the user gets *any*
      // feedback, the UX starts to really suffer.
      timeout: 5000,
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
      body: {
        action: 'next',
        messages: [{
          id: randomUUID(),
          role: 'user',
          content: {
            content_type: 'text',
            parts: [message.text],
          },
        }],
        model: 'text-davinci-002-render',
        ...gptContext[message.chat.id],
      },
    });
  } catch (error) {
    return await sendErrorMessage(
      bot, message.chat.id, `GPT error: \`${error.message}\``
    );
  }

  if (conversationResponse.status === 200) {
    // As soon as we know that we are going to be able to provide an answer,
    // manage the user's expectations. We deliberately have not sent this action
    // before because it can only be sent once consecutively and has a maximum
    // duration of five seconds.
    await bot.sendChatAction(message.chat.id, 'typing');
    for await (let { data } of parseEventStream(conversationResponse.body)) {
      if (data === "[DONE]")
        break;
      try {
        data = JSON.parse(data);
        [answer] = data.message.content.parts;
        gptContext[message.chat.id] = {
          conversation_id: data.conversation_id,
          parent_message_id: data.message.id,
        };
      } catch {
        console.error("Could not parse event data", data);
      }
    }
  } else {
    return await sendErrorMessage(
      bot, message.chat.id,
      `GPT error: \`${conversationResponse.status} ${conversationResponse.statusText}\``
    );
  }

  if (!answer)
    return await sendErrorMessage(
      bot, message.chat.id, "Hmm, something went wrong. Please try again."
    );

  await bot.sendMessage(message.chat.id, answer, { parse_mode: 'Markdown' });

});

async function sendErrorMessage(bot, chatId, text) {
  if (/\b$/.test(text))
    text += ".";
  await bot.sendMessage(chatId, `⚠️ ${text}`, { parse_mode: 'Markdown' });
}

async function requestGpt(endpoint, { method = 'GET', headers, body, timeout }) {
  let opts = { method };
  if (body != null && !Object.keys(headers).map(key => key.toLowerCase()).includes('content-type'))
    headers['Content-Type'] = 'application/json';
  opts.headers = {
    'User-Agent': USER_AGENT,
    ...headers,
  };
  let aborter;
  if (timeout != null) {
    let controller = new AbortController();
    opts.signal = controller.signal;
    aborter = setTimeout(() => controller.abort(), timeout);
  }
  if (body != null)
    opts.body = JSON.stringify(body);
  let response = await fetch('https://chat.openai.com/' + endpoint, opts);
  clearTimeout(aborter);
  return response;
}

function getSetCookie(response, cookieKey) {
  let cookiePrefix = cookieKey + '=';
  let setCookieString = response.headers.get('set-cookie') || '';
  if (setCookieString.includes(cookiePrefix))
    setCookieString = setCookieString.slice(
      setCookieString.indexOf(cookiePrefix) + cookiePrefix.length
    );
  else
    setCookieString = '';
  if (setCookieString.includes(';'))
    setCookieString = setCookieString.slice(0, setCookieString.indexOf(';'));
  return setCookieString;
}

async function *parseEventStream(stream) {
  let reader = stream.getReader();
  let decoder = new TextDecoder();
  let str = '';
  let separator = '\n\n';

  while (true) {
    let { value, done } = await reader.read();

    if (done) {
      // If remaining string is empty or mere whitespace, we are done.
      if (/^\s*$/.test(str))
        break;
    } else {
      str += decoder.decode(value);
    }

    let nextSeparatorIndex = str.indexOf(separator);
    // If no separator available, this either means…
    if (nextSeparatorIndex === -1) {
      // … that we should read some more data, or…
      if (!done)
        continue;
      // … that we should consider the end of string the separator.
      nextSeparatorIndex = str.length;
    }
    
    yield parseEvent(str.slice(0, nextSeparatorIndex));

    str = str.slice(nextSeparatorIndex + separator.length);
  }
}

function parseEvent(str) {
  let event = {};
  for (let line of str.split('\n')) {
    let lineSeparatorIndex = line.indexOf(':');
    let fieldName = line.slice(0, lineSeparatorIndex).trim();
    let fieldValue = line.slice(lineSeparatorIndex + 1).trim();
    if (fieldName in event)
      event[fieldName] += "\n" + fieldValue;
    else
      event[fieldName] = fieldValue;
  }
  return event;
}
