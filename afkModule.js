/**
 * afkModule.js
 * -----------------------------------------------------------------
 * Funzione AFK per il bot "Outlet Usato Garantito".
 *
 * Sposta automaticamente un utente nel canale vocale AFK del server
 * se resta muto/sordo per un tempo configurabile (default 5 minuti).
 *
 * "Inattivo" è rilevato SOLO tramite eventi nativi di Discord via
 * voiceStateUpdate — il bot NON si connette mai a nessun canale
 * vocale, quindi non serve alcun permesso/join in VC:
 *
 *   - selfMute / serverMute (muto)
 *   - selfDeaf / serverDeaf (sordo — di solito implica anche muto)
 *
 * Quando un utente si muta (o viene mutato) parte un timer. Se entro
 * AFK_TIMEOUT_MS non si smuta, viene spostato nel canale AFK.
 * Se si smuta prima, il timer si resetta.
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
 * Nessuna dipendenza extra richiesta (niente @discordjs/voice, il
 * bot non entra in VC).
 * -----------------------------------------------------------------
 */
 
/**
 * @param {import('discord.js').Client} client
 * @param {Object} options
 * @param {string} options.afkChannelId - ID del canale vocale AFK
 * @param {number} [options.timeoutMs=300000] - ms di inattività (muto/sordo) prima dello spostamento
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
 
  async function moveToAfk(member) {
    try {
      if (!member.voice.channelId || member.voice.channelId === afkChannelId) return;
 
      await member.voice.setChannel(afkChannelId, 'Inattività rilevata (AFK automatico)');
      logInfo(`${member.user.tag} spostato in AFK (${afkChannelId}) per inattività.`);
 
      try {
        await member.send('Ou si parla in vocale, non ci si sega!');
      } catch (dmErr) {
        logInfo(`Impossibile inviare DM a ${member.user.tag} (probabilmente DM chiusi).`);
      }
    } catch (err) {
      console.error('[afkModule] Errore nello spostamento AFK:', err.message);
    }
  }
 
  function isExempt(member) {
    if (!ignoreRoleIds.length) return false;
    return member.roles.cache.some((r) => ignoreRoleIds.includes(r.id));
  }
 
  function startOrResetTimer(member) {
    if (isExempt(member)) return;
    clearUserTimer(member.id);
 
    const timer = setTimeout(() => {
      moveToAfk(member);
      afkTimers.delete(member.id);
    }, timeoutMs);
 
    afkTimers.set(member.id, timer);
  }
 
  function stopTimer(member) {
    clearUserTimer(member.id);
  }
 
  function isMutedOrDeaf(state) {
    return !!(state.selfMute || state.serverMute || state.selfDeaf || state.serverDeaf);
  }
 
  client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
 
    if (!newState.channelId || newState.channelId === afkChannelId) {
      stopTimer(member);
      return;
    }
 
    if (newState.channelId !== oldState.channelId) {
      if (isMutedOrDeaf(newState)) {
        startOrResetTimer(member);
      } else {
        stopTimer(member);
      }
      return;
    }
 
    const eraMutedOrDeaf = isMutedOrDeaf(oldState);
    const oraMutedOrDeaf = isMutedOrDeaf(newState);
 
    if (!eraMutedOrDeaf && oraMutedOrDeaf) {
      startOrResetTimer(member);
    } else if (eraMutedOrDeaf && !oraMutedOrDeaf) {
      stopTimer(member);
    }
  });
 
  logInfo(`Modulo AFK attivo (senza connessione VC). Canale AFK: ${afkChannelId} — timeout: ${timeoutMs / 1000}s`);
}
 
module.exports = { setupAfkModule };
