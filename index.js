const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---- CONFIG (set these as Railway environment variables) ----
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NEW_LEADS_CHANNEL_ID = process.env.NEW_LEADS_CHANNEL_ID;
const REVIEW_CHANNEL_ID = process.env.REVIEW_CHANNEL_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PORT = process.env.PORT || 8080;

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

// ---- GOOGLE PLACES LOOKUP BY PHONE ----
async function lookupBusiness(phone) {
  try {
    // Search by phone number
    const searchRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: {
        query: phone,
        key: GOOGLE_API_KEY
      }
    });

    const results = searchRes.data.results;
    if (!results || results.length === 0) return null;

    const place = results[0];
    const placeId = place.place_id;

    // Get full details
    const detailRes = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,rating,user_ratings_total,website,url,formatted_phone_number',
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
      gmb_url: d.url || null,
      phone: d.formatted_phone_number || phone
    };
  } catch (err) {
    console.error('Google lookup error:', err.message);
    return null;
  }
}

// ---- SOCIAL MEDIA SEARCH (Google Custom Search fallback) ----
function buildSocialSearchUrl(businessName) {
  const query = encodeURIComponent(`${businessName} facebook OR instagram OR linkedin`);
  return `https://www.google.com/search?q=${query}`;
}

// ---- WEBHOOK ENDPOINT (GHL calls this) ----
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;

    // GHL sends contact info — adjust field names if needed
    const name = data.contact_name || data.full_name || data.name || 'Unknown';
    const phone = data.phone || data.phone_number || '';
    const email = data.email || '';

    console.log(`📥 New lead received: ${name} | ${phone}`);

    // Look up GMB
    const biz = phone ? await lookupBusiness(phone) : null;

    // Build the Discord embed
    const embed = new EmbedBuilder()
      .setColor(0x00FF88)
      .setTitle('🔥 NEW INTERESTED LEAD')
      .setDescription('A new lead is ready for preview building!')
      .addFields(
        { name: '👤 Contact', value: `**${name}**\n📞 ${phone || 'N/A'}\n📧 ${email || 'N/A'}`, inline: false }
      );

    if (biz) {
      embed.addFields(
        {
          name: '🏢 Business Info',
          value: [
            `**${biz.name}**`,
            `📍 ${biz.address}`,
            biz.rating !== 'N/A' ? `⭐ ${biz.rating}/5 (${biz.reviews} reviews)` : '⭐ No rating found',
            biz.website ? `🌐 [Website](${biz.website})` : '🌐 No website found',
            biz.gmb_url ? `📍 [Google My Business Profile](${biz.gmb_url})` : '📍 No GMB found'
          ].join('\n'),
          inline: false
        }
      );

      // Social search link
      const socialLink = buildSocialSearchUrl(biz.name);
      embed.addFields({
        name: '🔗 Find Socials',
        value: `[🔍 Search ${biz.name} on Google for socials](${socialLink})`,
        inline: false
      });
    } else {
      embed.addFields({
        name: '⚠️ No GMB Found',
        value: `Could not find a Google Business profile for phone: ${phone}\nTry searching manually.`,
        inline: false
      });
    }

    embed.setFooter({ text: 'Lead Bot • Preview Setter System' });
    embed.setTimestamp();

    // Post to #new-leads channel
    const channel = await client.channels.fetch(NEW_LEADS_CHANNEL_ID);
    await channel.send({ embeds: [embed] });

    console.log(`✅ Lead posted to Discord for ${name}`);
    res.json({ success: true });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- DONE BUTTON COMMAND ----
// Noah types /done [preview_url] in Discord to notify you
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'done') {
    const previewUrl = interaction.options.getString('preview_url');
    const notes = interaction.options.getString('notes') || 'No notes';

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('✅ Preview Ready for Review!')
      .setDescription(`Noah has finished building a preview — time to record your Loom!`)
      .addFields(
        { name: '🔗 Preview Link', value: previewUrl, inline: false },
        { name: '📝 Notes from Noah', value: notes, inline: false },
        { name: '👤 Submitted by', value: interaction.user.username, inline: false }
      )
      .setTimestamp();

    // Post to #ready-for-review and ping the server owner
    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID);
    await reviewChannel.send({ content: `<@&${interaction.guildId}> 🎬 New preview ready!`, embeds: [embed] });

    await interaction.reply({ content: '✅ Done! Posted to review channel.', ephemeral: true });
  }
});

// ---- REGISTER SLASH COMMAND ON STARTUP ----
client.once('ready', async () => {
  try {
    const guild = client.guilds.cache.first();
    if (guild) {
      await guild.commands.create({
        name: 'done',
        description: 'Submit a finished preview for review',
        options: [
          {
            name: 'preview_url',
            description: 'The link to the finished preview',
            type: 3, // STRING
            required: true
          },
          {
            name: 'notes',
            description: 'Any notes about this lead',
            type: 3,
            required: false
          }
        ]
      });
      console.log('✅ Slash command /done registered');
    }
  } catch (err) {
    console.error('Command registration error:', err);
  }
});

// ---- START ----
client.login(DISCORD_TOKEN);
app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`));
