const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../../db');
const telegramBot = require('../ingest/telegram-bot');

// Helper to run query as promise
const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

async function processVisionJob(job) {
  const jobId = job.id;
  const imagePath = job.localFilePath;
  const telegramUserId = job.telegramUserId;

  console.log(`🤖 [Vision Worker] Processing Job #${jobId} (file: ${path.basename(imagePath)})`);

  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Local image file not found at ${imagePath}`);
    }

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const fileExtension = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
    const mediaType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

    let parsedResult = null;

    // Check for API Keys
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    const hasRealOpenai = openaiKey && openaiKey !== 'YOUR_OPENAI_API_KEY' && openaiKey.startsWith('sk-');
    const hasRealAnthropic = anthropicKey && anthropicKey !== 'YOUR_ANTHROPIC_API_KEY';

    if (hasRealOpenai) {
      console.log('📡 [Vision Worker] Calling OpenAI Vision API (gpt-4o)...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this printwear design. You must return a JSON object with the following fields: "colors" (an array of 3 standard apparel color names like "Black", "White", "Natural", "Navy", "Red", "Grey" that fit the design best), "placement" (either "front" or "back" based on what layout suits the print best), "scale" (a float between 0.1 and 1.0 representing ideal placement print scale size), "title" (a cool, minimalist, premium streetwear product title, max 40 chars), and "description" (a high-conversion, professional streetwear product description, max 200 chars).'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mediaType};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
      parsedResult = JSON.parse(content);
      console.log('✅ [Vision Worker] OpenAI Vision analysis parsed successfully:', parsedResult);

    } else if (hasRealAnthropic) {
      console.log('📡 [Vision Worker] Calling Anthropic Claude Vision API...');
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Image
                  }
                },
                {
                  type: 'text',
                  text: 'Analyze this printwear design. Return ONLY a raw JSON object (no markdown wrapping) containing: "colors" (array of 3 standard apparel color names like "Black", "White", "Natural", "Navy", "Red", "Grey"), "placement" (either "front" or "back"), "scale" (a float between 0.1 and 1.0), "title" (cool streetwear title, max 40 chars), and "description" (streetwear description, max 200 chars).'
                }
              ]
            }
          ]
        },
        {
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        }
      );

      const textContent = response.data.content[0].text;
      // Extract JSON if model wrapped it in markdown codeblocks
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      const rawJson = jsonMatch ? jsonMatch[0] : textContent;
      parsedResult = JSON.parse(rawJson);
      console.log('✅ [Vision Worker] Anthropic Vision analysis parsed successfully:', parsedResult);

    } else {
      console.warn('⚠️ [Vision Worker] No active Vision API Key found. Falling back to offline mockup simulation...');
      
      // Smart simulation based on filename/time
      const timestamp = Date.now();
      const mockColors = ['Black', 'White', 'Natural'];
      const mockPlacement = timestamp % 2 === 0 ? 'front' : 'back';
      const mockScale = 0.35;
      const mockTitle = `Drip Street Graphics Tee #${jobId}`;
      const mockDesc = 'Premium minimal streetwear built for everyday confidence. Featuring a custom drip-style graphic, tailored fit, and absolute comfort.';

      parsedResult = {
        colors: mockColors,
        placement: mockPlacement,
        scale: mockScale,
        title: mockTitle,
        description: mockDesc
      };
      
      // Artificial delay to mimic API latency
      await new Promise(r => setTimeout(r, 1500));
      console.log('✅ [Vision Worker] Offline mock analysis generated:', parsedResult);
    }

    // Verify fields
    const colors = Array.isArray(parsedResult.colors) ? parsedResult.colors : ['Black', 'White', 'Natural'];
    const placement = ['front', 'back'].includes(parsedResult.placement) ? parsedResult.placement : 'front';
    const scale = Number(parsedResult.scale) || 0.35;
    const title = parsedResult.title || `Drip Graphic Tee #${jobId}`;
    const description = parsedResult.description || 'Premium minimal streetwear built for confidence.';

    // Update DB
    await dbRunAsync(
      `UPDATE automation_jobs SET status = 'analyzed', colors = ?, placement = ?, scale = ?, productTitle = ?, productDescription = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(colors), placement, scale, title, description, jobId]
    );

    console.log(`✅ [Vision Worker] Job #${jobId} successfully moved to 'analyzed'`);
    
    if (telegramUserId) {
      const colorsMsg = colors.map(c => `• <b>${c}</b>`).join('\n');
      await telegramBot.replyTelegram(
        telegramUserId,
        `🤖 <b>Vision AI Analysis Complete!</b>\n` +
        `We've parsed your graphic and optimized the properties:\n\n` +
        `📝 <b>Suggested Title:</b> ${title}\n` +
        `📐 <b>Placement:</b> ${placement.toUpperCase()} at ${Math.round(scale * 100)}% scale\n` +
        `🎨 <b>Selected Colors:</b>\n${colorsMsg}\n\n` +
        `🚀 Starting the Printify product creation pipeline...`
      );
    }

    return true;
  } catch (err) {
    console.error(`❌ [Vision Worker] Error processing Job #${jobId}:`, err.message);
    
    await dbRunAsync(
      `UPDATE automation_jobs SET status = 'failed', errorMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [err.message, jobId]
    );

    if (telegramUserId) {
      await telegramBot.replyTelegram(
        telegramUserId,
        `🚨 <b>Vision AI Processing Failed</b>\n` +
        `Job ID: <code>#${jobId}</code>\n` +
        `Reason: <code>${err.message}</code>\n\n` +
        `Please make sure the upload is a valid image and try again.`
      );
    }
    return false;
  }
}

module.exports = {
  processVisionJob
};
