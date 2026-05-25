const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../../db');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize the database table for automation jobs
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS automation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegramFileId TEXT,
      telegramUserId TEXT,
      telegramUsername TEXT,
      localFilePath TEXT,
      status TEXT DEFAULT 'received',
      colors TEXT, -- JSON array of Vision colors
      placement TEXT, -- Vision suggested placement
      scale REAL, -- Vision suggested scale
      printifyProductId TEXT,
      mockupUrls TEXT, -- JSON array of mockup URLs
      productTitle TEXT,
      productDescription TEXT,
      price REAL,
      category TEXT,
      errorMessage TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper to reply to a user
async function replyTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
    console.warn('⚠️ Telegram token not configured. Skipping reply:', text);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Failed to send Telegram response:', err.message);
  }
}

// Helper to download the file from Telegram
async function downloadTelegramFile(fileId, destPath) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
    // Create an empty mock image if Telegram is not configured to allow safe developer testing!
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, 'mock_image_data');
    return;
  }

  // 1. Get file path from Telegram
  const fileInfoResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = fileInfoResponse.data.result.file_path;
  
  // 2. Create directory if not exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  
  // 3. Download the actual file stream
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const writer = fs.createWriteStream(destPath);
  
  const response = await axios({
    url: fileUrl,
    method: 'GET',
    responseType: 'stream'
  });
  
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Router or middleware handler
async function handleWebhook(req, res) {
  try {
    // Webhook secret validation
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      console.warn('❌ [Telegram Webhook] Unauthorized request received. Secret tokens do not match.');
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { message } = req.body;
    if (!message) {
      return res.json({ ok: true, reason: 'no_message_in_body' });
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username || '';

    // We only process photo or document messages
    let fileId = null;
    let fileName = 'design.png';

    if (message.document) {
      const mime = message.document.mime_type || '';
      if (mime.startsWith('image/')) {
        fileId = message.document.file_id;
        fileName = message.document.file_name || 'design.png';
      }
    } else if (message.photo && message.photo.length > 0) {
      // Pick the highest resolution photo available
      const highestRes = message.photo[message.photo.length - 1];
      fileId = highestRes.file_id;
      fileName = `photo_${highestRes.file_unique_id}.png`;
    }

    if (!fileId) {
      await replyTelegram(chatId, '👋 <b>Welcome to Drip Street Automator!</b>\n\nPlease upload a high-resolution PNG image/design (as an uncompressed file or photo) to initiate the automation pipeline.');
      return res.json({ ok: true, reason: 'no_image_file_id' });
    }

    // Acknowledge design upload
    await replyTelegram(chatId, '📥 <b>Design Received!</b>\nDownloading design and adding to the automation queue...');

    // Download locally
    const destDir = path.resolve(__dirname, '../../data/uploads');
    const destFile = `${Date.now()}_${fileName}`;
    const destPath = path.join(destDir, destFile);
    
    await downloadTelegramFile(fileId, destPath);
    console.log(`✅ [Telegram Webhook] Saved image to ${destPath}`);

    // Insert job into database
    db.run(
      `INSERT INTO automation_jobs (telegramFileId, telegramUserId, telegramUsername, localFilePath, status) VALUES (?, ?, ?, ?, 'received')`,
      [fileId, String(userId), username, destPath],
      async function(err) {
        if (err) {
          console.error('❌ Failed to insert job into DB:', err.message);
          await replyTelegram(chatId, '❌ <b>System Error:</b> Could not queue your design. Please try again.');
          return res.status(500).json({ error: 'Database error' });
        }
        
        const jobId = this.lastID;
        console.log(`✅ [Telegram Webhook] Created Job #${jobId} with status 'received'`);
        await replyTelegram(chatId, `🚀 <b>Job Queued successfully!</b>\nYour Job ID is <code>#${jobId}</code>.\n\nWe are starting the Vision AI color and layout analysis. Hang tight!`);
      }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ [Telegram Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Webhook execution failed' });
  }
}

module.exports = {
  handleWebhook,
  replyTelegram
};
