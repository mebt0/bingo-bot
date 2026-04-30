// ============================================================
//  AUTO-UPDATE NGROK URL
//  Run: node update-ngrok-url.js
//  Reads ngrok's local API, gets the current tunnel URL,
//  and updates bingo-bot/.env WEB_APP_URL automatically.
// ============================================================
const http = require('http');
const fs   = require('fs');
const path = require('path');

const BOT_ENV_PATH = path.join(__dirname, 'bingo-bot', '.env');

function getNgrokUrl(retries) {
  retries = retries || 0;
  if (retries > 10) {
    console.error('❌ Could not get ngrok URL after 10 retries. Is ngrok running?');
    process.exit(1);
  }

  http.get('http://localhost:4040/api/tunnels', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json    = JSON.parse(data);
        const tunnels = json.tunnels || [];
        const https   = tunnels.find(t => t.proto === 'https');
        if (!https) {
          console.log('⏳ No HTTPS tunnel yet, retrying...');
          setTimeout(() => getNgrokUrl(retries + 1), 2000);
          return;
        }

        const url = https.public_url;
        console.log('✅ ngrok URL:', url);

        // Update bingo-bot/.env
        let env = fs.readFileSync(BOT_ENV_PATH, 'utf8');
        env = env.replace(/^WEB_APP_URL=.*/m, 'WEB_APP_URL=' + url);
        fs.writeFileSync(BOT_ENV_PATH, env);
        console.log('✅ Updated bingo-bot/.env WEB_APP_URL =', url);
        console.log('');
        console.log('Now restart the bot: npm run bot');

      } catch(e) {
        console.log('⏳ Waiting for ngrok...', e.message);
        setTimeout(() => getNgrokUrl(retries + 1), 2000);
      }
    });
  }).on('error', () => {
    console.log('⏳ ngrok not ready yet, retrying in 2s...');
    setTimeout(() => getNgrokUrl(retries + 1), 2000);
  });
}

console.log('🔍 Looking for ngrok tunnel...');
getNgrokUrl();
