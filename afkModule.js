/**
 * afkModule.js
 * -----------------------------------------------------------------
 * Funzione AFK per il bot "Outlet Usato Garantito".
 *
 * Sposta automaticamente un utente nel canale vocale AFK del server
 * se resta silenzioso/inattivo per un tempo configurabile (default
 * 5 minuti). "Inattivo" è rilevato SOLO tramite eventi nativi di
 * Discord — niente analisi dello stream audio:
 *
 *   - selfMute / serverMute (muto)
 *   - selfDeaf / serverDeaf (sordo — di solito implica anche muto)
 *   - speaking start/stop (rilevato via @discordjs/voice, il bot
 *     deve essere connesso al canale vocale per ricevere l'evento)
 *
 * Ogni volta che un utente SMETTE di parlare o si muta, parte un
 * timer. Se entro AFK_TIMEOUT_MS non riprende a parlare (e non si
 * smuta), viene spostato nel canale AFK configurato.
 * Se l'utente parla o si smuta, il timer si resetta.
 *
 * -----------------------------------------------------------------
 * INTEGRAZIONE NEL BOT ESISTENTE
 * -----------------------------------------------------------------
 * Nel tuo file principale (index.js / bot.js):
 *
 *   const { setupAfkModule } = require('./afkModule');
 *
 *   const client = new Client({
 *     intents: [
 *       GatewayIntentBits.Guilds,
 *       GatewayIntentBits.GuildVoiceStates, // OBBLIGATORIO
 *       // ...gli intent che già usi
 *     ],
 *   });
 *
 *   client.once('ready', () => {
 *     setupAfkModule(client, {
 *       afkChannelId: process.env.AFK_CHANNEL_ID, // canale AFK di destinazione
 *       timeoutMs: 5 * 60 * 1000,                 // 5 minuti (default)
 *       // ignoreRoleIds: ['123456789012345678'], // opzionale: ruoli esenti (es. staff)
 *     });
 *   });
 *
 * Variabili d'ambiente da aggiungere su Railway:
 *   AFK_CHANNEL_ID = id del canale vocale AFK
 *
 * Dipendenza extra da installare:
 *   npm install @discordjs/voice
 * -----------------------------------------------------------------
 */

const { joinVoiceChannel, getVoiceConnection, EndBehaviorType } = require('@discordjs/voice');

/**
 * @param {import('discord.js').Client} client
 * @param {Object} options
 * @param {string} options.afkChannelId - ID del canale vocale AFK
 * @param {number} [options.timeoutMs=300000] - ms di inattività prima dello spostamento
 * @param {string[]} [options.ignoreRoleIds=[]] - ID ruoli esenti dall'AFK automatico
 * @param {boolean} [options.log=true] - log in console delle azioni
 */
function setupAfkModule(client, options) {
  const {
    afkChannelId,
    timeoutMs = 5 * 60 * 1000,
    ignoreRoleIds = [],
    log = true,
  } = options;

  if (!afkChannelId) {
    throw new Error('[afkModule] afkChannelId è obbligatorio.');
  }

  // userId -> timeout handle
  const afkTimers = new Map();
  // guildId -> Set di userId attualmente connessi al bot per il "speaking" tracking
  const trackedGuilds = new Set();

  function logInfo(...args) {
    if (log) console.log('[afkModule]', ...args);
  }

  function clearUserTimer(userId) {
    const t = afkTimers.get(userId);
    if (t) {
      clearTimeout(t);
      afkTimers.delete(userId);
    }
  }

  async function moveToAfk(guild, member) {
    try {
      // ricontrolla che sia ancora in un canale vocale (non AFK già, non disconnesso)
      if (!member.voice.channelId || member.voice.channelId === afkChannelId) return;

      await member.voice.setChannel(afkChannelId, 'Inattività rilevata (AFK automatico)');
      logInfo(`${member.user.tag} spostato in AFK (${afkChannelId}) per inattività.`);
    } catch (err) {
      console.error('[afkModule] Errore nello spostamento AFK:', err.message);
    }
  }

  function isExempt(member) {
    if (!ignoreRoleIds.length) return false;
    return member.roles.cache.some((r) => ignoreRoleIds.includes(r.id));
  }

  function startOrResetTimer(guild, member) {
    if (isExempt(member)) return;
    clearUserTimer(member.id);

    const timer = setTimeout(() => {
      moveToAfk(guild, member);
      afkTimers.delete(member.id);
    }, timeoutMs);

    afkTimers.set(member.id, timer);
  }

  function stopTimer(member) {
    clearUserTimer(member.id);
  }

  /**
   * Si connette (in modalità solo-ricezione) al canale vocale per
   * poter ricevere gli eventi "speaking start/stop" dei membri.
   * Non riproduce né elabora audio: serve solo l'evento discreto,
   * non lo stream.
   */
  function attachSpeakingListener(channel) {
    const guild = channel.guild;
    if (trackedGuilds.has(guild.id)) return;

    let connection = getVoiceConnection(guild.id);
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false, // deve restare "in ascolto" per ricevere speaking events
        selfMute: true,  // il bot non deve mai trasmettere audio
      });
    }

    trackedGuilds.add(guild.id);

    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      const member = guild.members.cache.get(userId);
      if (!member || member.user.bot) return;
      if (member.voice.selfMute || member.voice.serverMute || member.voice.selfDeaf) return;
      // sta parlando attivamente -> reset timer
      startOrResetTimer(guild, member);
    });

    receiver.speaking.on('end', (userId) => {
      const member = guild.members.cache.get(userId);
      if (!member || member.user.bot) return;
      // ha smesso di parlare -> avvia (o riavvia) il countdown verso l'AFK
      startOrResetTimer(guild, member);
    });
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild;

    // Utente entrato in un canale vocale (diverso da AFK)
    if (newState.channelId && newState.channelId !== afkChannelId) {
      attachSpeakingListener(newState.channel);

      const mutedOrDeaf =
        newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf;

      if (mutedOrDeaf) {
        // entra già mutato/sordo -> parte il countdown
        startOrResetTimer(guild, member);
      } else {
        // entra attivo -> nessun countdown finché non si muta o smette di parlare
        stopTimer(member);
      }
      return;
    }

    // Utente uscito dal canale vocale o spostato manualmente in AFK / disconnesso
    if (!newState.channelId || newState.channelId === afkChannelId) {
      stopTimer(member);
      return;
    }

    // Cambio di stato mute/deafen mentre resta nello stesso canale
    if (newState.channelId === oldState.channelId) {
      const becameMutedOrDeaf =
        (newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf) &&
        !(oldState.selfMute || oldState.serverMute || oldState.selfDeaf || oldState.serverDeaf);

      const becameUnmutedAndUndeaf =
        !(newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf) &&
        (oldState.selfMute || oldState.serverMute || oldState.selfDeaf || oldState.serverDeaf);

      if (becameMutedOrDeaf) {
        startOrResetTimer(guild, member);
      } else if (becameUnmutedAndUndeaf) {
        stopTimer(member);
      }
    }
  });

  logInfo(`Modulo AFK attivo. Canale AFK: ${afkChannelId} — timeout: ${timeoutMs / 1000}s`);
}

module.exports = { setupAfkModule };
