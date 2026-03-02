const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const app = express();
app.use(express.json());

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NEW_LEADS_CHANNEL_ID = process.env.NEW_LEADS_CHANNEL_ID;
const REVIEW_CHANNEL_ID = process.env.REVIEW_CHANNEL_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PORT = process.env.PORT;

console.log('Token check:', DISCORD_TOKEN ? 'EXISTS, length=' + DISCORD_TOKEN.length : 'MISSING OR EMPTY');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// HEALTH CHECK
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// Google Places lookup by phone
async function lookupBusiness(phone) {
  try {
    const searchRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: { query: phone, key: GOOGLE_API_KEY }
    });
    const results = searchRes.data.results;
    if (!results || results.length === 0) return null;

    const detailRes = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: results[0].place_id,
        fields: 'name,formatted_address,rating,user_ratings_total,website,url',
        key: GOOGLE_API_KEY
      }
    });
    const d = detailRes.data.result;
    return {
      name: d.name || 'N/A',
      address: d.formatted_address || 'N/A',
      rating: d.rating || 'N/A',
      reviews: d.user_ratings_total || 0,
      website: d.website || null,
      gmb_url: d.url || null
    };
  } catch (err) {
    console.error('Google lookup error:', err.message);
    return null;
  }
}

// Wait for Discord to be ready (up to 15 seconds)
function waitForDiscord() {
  return new Promise((resolve, reject) => {
    if (client.isReady()) return resolve();
    console.log('⏳ Waiting for Discord client...');
    const timeout = setTimeout(() => {
      reject(new Error('Discord client did not become ready in time'));
    }, 15000);
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

// Webhook
app.post('/webhook', async (req, res) => {
  res.status(200).json({ success: true });

  try {
    const data = req.body;
    console.log('Webhook received:', JSON.stringify(data));

    const name = data.contact_name || data.full_name || data.name || 'Unknown';
    const phone = data.phone || data.phone_number || '';
    const email = data.email || '';

    const biz = phone ? await lookupBusiness(phone) : null;

    const embed = new EmbedBuilder()
      .setColor(0x00FF88)
      .setTitle('🔥 NEW INTERESTED LEAD')
      .setDescription('Ready for preview building!')
      .addFields({ 
        name: '👤 Contact', 
        value: `**${name}**\n📞 ${phone || 'N/A'}\n📧 ${email || 'N/A'}`, 
        inline: false 
      });

    if (biz) {
      embed.addFields({
        name: '🏢 Business Info',
        value: [
          `**${biz.name}**`,
          `📍 ${biz.address}`,
          biz.rating !== 'N/A' ? `⭐ ${biz.rating}/5 (${biz.reviews} reviews)` : '⭐ No rating found',
          biz.website ? `🌐 [Website](${biz.website})` : '🌐 No website found',
          biz.gmb_url ? `📍 [View GMB Profile](${biz.gmb_url})` : '📍 No GMB found'
        ].join('\n'),
        inline: false
      });
      const socialLink = `https://www.google.com/search?q=${encodeURIComponent(biz.name + ' facebook OR instagram OR linkedin')}`;
      embed.addFields({ 
        name: '🔗 Find Socials', 
        value: `[🔍 Click to search ${biz.name} socials](${socialLink})`, 
        inline: false 
      });
    } else {
      embed.addFields({ 
        name: '⚠️ No GMB Found', 
        value: `Phone searched: ${phone}`, 
        inline: false 
      });
    }

    embed.setFooter({ text: 'Lead Bot • CMD Marketing' }).setTimestamp();

    await waitForDiscord();

    const channel = await client.channels.fetch(NEW_LEADS_CHANNEL_ID);
    await channel.send({ embeds: [embed] });
    console.log('✅ Posted to Discord for', name);

  } catch (err) {
    console.error('❌ Webhook processing error:', err.message);
  }
});

// /done slash command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'done') return;

  const previewUrl = interaction.options.getString('preview_url');
  const notes = interaction.options.getString('notes') || 'No notes';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('✅ Preview Ready for Review!')
    .addFields(
      { name: '🔗 Preview Link', value: previewUrl, inline: false },
      { name: '📝 Notes', value: notes, inline: false },
      { name: '👤 Built by', value: interaction.user.username, inline: false }
    )
    .setTimestamp();

  const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID);
  await reviewChannel.send({ content: '🎬 New preview ready — go record your Loom!', embeds: [embed] });
  await interaction.reply({ content: '✅ Done! Owner has been notified.', ephemeral: true });
});

// Register /done slash command
client.once('ready', async () => {
  console.log('✅ Discord bot online as', client.user.tag);
  try {
    const guild = client.guilds.cache.first();
    if (guild) {
      await guild.commands.create({
        name: 'done',
        description: 'Submit a finished preview for review',
        options: [
          { name: 'preview_url', description: 'Link to the finished preview', type: 3, required: true },
          { name: 'notes', description: 'Any notes about this lead', type: 3, required: false }
        ]
      });
      console.log('✅ /done command registered');
    }
  } catch (err) {
    console.error('Command registration error:', err);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received - shutting down gracefully');
  server.close(() => process.exit(0));
});

// START
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server running on port', PORT);
  client.login(DISCORD_TOKEN)
    .then(() => console.log('✅ Discord login successful'))
    .catch(err => console.error('❌ Discord login FAILED:', err.message));
});
