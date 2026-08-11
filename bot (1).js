const TelegramBot = require("node-telegram-bot-api");

let bot = null;

function startBot() {
  if (!process.env.BOT_TOKEN) {
    console.log("BOT_TOKEN not set: Telegram bot disabled.");
    return null;
  }

  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

  bot.onText(/^\/start$/, async (msg) => {
    const url = process.env.WEB_APP_URL;
    const opts = url
      ? { reply_markup: { inline_keyboard: [[{ text: "Open School Portal", web_app: { url } }]] } }
      : {};
    await bot.sendMessage(
      msg.chat.id,
      `Welcome to ${process.env.SCHOOL_NAME || "Green Star Integrated School"}.\nOpen the school portal below.`,
      opts
    );
  });

  bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "Commands:\n/start — Open the school portal\n/help — Show this help"
    );
  });

  bot.on("polling_error", (err) => console.error("Telegram polling error:", err.message));

  console.log("Telegram bot started.");
  return bot;
}

async function notify(chatId, text) {
  if (!bot || !chatId) return;
  try { await bot.sendMessage(chatId, text); } catch (e) { console.error("Telegram notify:", e.message); }
}

module.exports = { startBot, notify };
