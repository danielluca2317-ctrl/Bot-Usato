const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
const { setupAfkModule } = require('./afkModule');

// 🔧 LEGGE TOKEN E CHIAVI DALLE VARIABILI D'AMBIENTE
const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

// 🔒 Nome del ruolo Discord autorizzato a modificare i dati
const RUOLO_STAFF = 'Concessionario Usato';

// CONTROLLA CHE LE VARIABILI CI SIANO
if (!TOKEN) {
    console.error('❌ ERRORE: DISCORD_TOKEN non trovato!');
    process.exit(1);
}
if (!DATABASE_URL) {
    console.error('❌ ERRORE: DATABASE_URL non trovato! (usa la stringa PUBBLICA del Postgres di Railway, non quella .railway.internal, perché questo bot gira in un progetto diverso)');
    process.exit(1);
}

// Il bot gira in un progetto Railway diverso dal sito, quindi si collega
// tramite l'host pubblico del Postgres (DATABASE_PUBLIC_URL sul servizio
// Postgres del progetto del sito). Serve sempre SSL in questo caso.
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});
// Nota: con le Slash Command native NON servono più GuildMessages/MessageContent,
// perché il bot non legge più i messaggi di testo, solo le interazioni.

// ============================================================
// STILE "RACING" CONDIVISO PER TUTTI GLI EMBED
// ============================================================
// Stessa identità visiva del sito: nero/rosso, bandiera a scacchi,
// footer uniforme con il nome del concessionario. Un unico posto da
// cambiare se in futuro vuoi ritoccare i colori.
const COLORI = {
    successo: 0xe2001a,   // rosso brand — usato per creazioni/conferme positive
    modifica: 0xff2038,   // rosso vivo — modifiche
    pericolo: 0x0a0a0c,   // nero — eliminazioni/annullamenti
    info: 0x1b1b20,       // nero più chiaro — liste/info neutre
    statistiche: 0xe2001a,
    ammonimento: 0x2a2a30 // grigio scuro — avvisi permessi
};
const FOOTER_BRAND = { text: '🏁 Outlet Usato Garantito' };
const LINEA_BANDIERA = '🏁'.repeat(1) + ' ・ ' + '🏁'.repeat(1);

function embedRacing(colore) {
    return new EmbedBuilder().setColor(colore).setFooter(FOOTER_BRAND).setTimestamp();
}

// ============================================================
// FUNZIONI DATABASE (Postgres, le stesse tabelle usate dal sito)
// ============================================================

function rigaToPrenotazione(riga) {
    return {
        id: Number(riga.id),
        autoId: riga.auto_id,
        nome: riga.nome,
        cognome: riga.cognome,
        email: riga.email,
        telefono: riga.telefono,
        data: riga.data_appuntamento,
        messaggio: riga.messaggio || '',
        stato: riga.stato,
        dataRichiesta: riga.data_richiesta,
        discordId: riga.discord_id || null,
        discordUsername: riga.discord_username || null
    };
}

async function caricaDati() {
    try {
        const autoResult = await pool.query('SELECT dati FROM store_auto WHERE id = 1');
        const auto = autoResult.rows[0]?.dati || [];

        const prenResult = await pool.query('SELECT * FROM prenotazioni ORDER BY id ASC');
        const prenotazioni = prenResult.rows.map(rigaToPrenotazione);

        return { auto, prenotazioni };
    } catch (error) {
        console.error('❌ Errore caricamento:', error.message);
        return { auto: [], prenotazioni: [] };
    }
}

// Salva SOLO l'elenco auto (usato da aggiungi/modifica/elimina-auto)
async function salvaAuto(auto) {
    try {
        await pool.query(
            `INSERT INTO store_auto (id, dati) VALUES (1, $1::jsonb)
             ON CONFLICT (id) DO UPDATE SET dati = $1::jsonb`,
            [JSON.stringify(auto)]
        );
        return true;
    } catch (error) {
        console.error('❌ Errore salvataggio auto:', error.message);
        return false;
    }
}

// Inserisce una nuova prenotazione (usato da /prenota-auto)
async function inserisciPrenotazione(p) {
    try {
        await pool.query(
            `INSERT INTO prenotazioni
                (id, auto_id, nome, cognome, email, telefono, data_appuntamento, messaggio, stato, data_richiesta)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [p.id, p.autoId, p.nome, p.cognome, p.email, p.telefono, p.data, p.messaggio || '', p.stato, p.dataRichiesta]
        );
        return true;
    } catch (error) {
        console.error('❌ Errore salvataggio prenotazione:', error.message);
        return false;
    }
}

// Aggiorna lo stato di una prenotazione esistente (conferma/annulla)
async function aggiornaStatoPrenotazione(id, stato) {
    try {
        const result = await pool.query(
            'UPDATE prenotazioni SET stato = $1 WHERE id = $2',
            [stato, id]
        );
        return result.rowCount > 0;
    } catch (error) {
        console.error('❌ Errore aggiornamento prenotazione:', error.message);
        return false;
    }
}

function isAutoPrenotata(autoId, prenotazioni) {
    return prenotazioni.some(p => p.autoId === autoId && p.stato === 'confermata');
}

// ============================================================
// WHITELIST ADMIN DEL SITO (tabella admin_whitelist, stesso Postgres)
// ============================================================
// Chi è in questa tabella può entrare nel pannello admin del sito web
// dopo aver fatto login con Discord (vedi server.js). La tabella viene
// creata da server.js all'avvio; qui la leggiamo/scriviamo e basta.
async function aggiungiAdminWhitelist(discordId, discordUsername, aggiuntoDa) {
    try {
        await pool.query(
            `INSERT INTO admin_whitelist (discord_id, discord_username, aggiunto_da, aggiunto_il)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (discord_id) DO UPDATE SET discord_username = $2`,
            [discordId, discordUsername || null, aggiuntoDa || null, new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })]
        );
        return true;
    } catch (error) {
        console.error('❌ Errore aggiunta whitelist admin:', error.message);
        return false;
    }
}

async function rimuoviAdminWhitelist(discordId) {
    try {
        const result = await pool.query('DELETE FROM admin_whitelist WHERE discord_id = $1', [discordId]);
        return result.rowCount > 0;
    } catch (error) {
        console.error('❌ Errore rimozione whitelist admin:', error.message);
        return false;
    }
}

async function listaAdminWhitelist() {
    try {
        const result = await pool.query('SELECT discord_id, discord_username, aggiunto_da, aggiunto_il FROM admin_whitelist ORDER BY aggiunto_il ASC');
        return result.rows;
    } catch (error) {
        console.error('❌ Errore lettura whitelist admin:', error.message);
        return [];
    }
}

// 📩 Invia un DM all'utente indicato dal suo Discord ID. Non blocca mai il
// flusso del comando: se fallisce (DM chiusi, ID errato, utente non trovato)
// ritorna semplicemente false e viene loggato.
async function inviaDM(discordId, embed) {
    if (!discordId) {
        console.warn('⚠️ Nessun discordId associato alla prenotazione, DM non inviato.');
        return false;
    }
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [embed] });
        console.log(`✅ DM inviato a ${user.tag} (${discordId})`);
        return true;
    } catch (error) {
        console.error(`❌ Impossibile inviare DM a ${discordId}:`, error.message);
        return false;
    }
}

// 🔒 Controlla se chi ha lanciato l'interazione ha il ruolo staff
function haRuoloStaff(interaction) {
    if (!interaction.member || !interaction.member.roles) return false;
    return interaction.member.roles.cache.some(role => role.name === RUOLO_STAFF);
}

// ============================================================
// COMANDI (ricevono un oggetto opts con i parametri già validati da Discord)
// ============================================================

async function aggiungiAuto(opts, username) {
    const data = await caricaDati();
    const auto = data.auto || [];
    const { marca, modello, anno, prezzo, km, alimentazione, cambio } = opts;
    const newId = auto.length > 0 ? Math.max(...auto.map(a => a.id)) + 1 : 1;
    auto.push({ id: newId, marca, modello, anno, prezzo, km, alimentazione, cambio });
    if (await salvaAuto(auto)) {
        const embed = embedRacing(COLORI.successo)
            .setTitle('🏁 Nuova auto in griglia di partenza!')
            .setDescription(`### 🚗 ${marca} ${modello}\n${LINEA_BANDIERA}`)
            .addFields(
                { name: '📅 Anno', value: String(anno), inline: true },
                { name: '💰 Prezzo', value: `€ ${prezzo.toLocaleString()}`, inline: true },
                { name: '🆔 ID', value: String(newId), inline: true },
                { name: '📏 Km', value: `${km.toLocaleString()} km`, inline: true },
                { name: '⛽ Alimentazione', value: alimentazione, inline: true },
                { name: '⚙️ Cambio', value: cambio, inline: true }
            )
            .setFooter({ text: `🏁 Aggiunta da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function modificaAuto(opts, username) {
    const data = await caricaDati();
    const auto = data.auto || [];
    const { id, marca, modello, anno, prezzo, km, alimentazione, cambio } = opts;
    const index = auto.findIndex(a => a.id === id);
    if (index === -1) return { success: false, messaggio: `❌ Auto con ID ${id} non trovata.` };
    if (isAutoPrenotata(id, data.prenotazioni || [])) {
        return { success: false, messaggio: `❌ L'auto con ID ${id} è prenotata!` };
    }
    auto[index] = { ...auto[index], marca, modello, anno, prezzo, km, alimentazione, cambio };
    if (await salvaAuto(auto)) {
        const embed = embedRacing(COLORI.modifica)
            .setTitle('🔧 Auto passata ai box — modifiche apportate!')
            .setDescription(`### 🚗 ${marca} ${modello}\n\`ID ${id}\` ${LINEA_BANDIERA}`)
            .addFields(
                { name: '📅 Anno', value: String(anno), inline: true },
                { name: '💰 Prezzo', value: `€ ${prezzo.toLocaleString()}`, inline: true },
                { name: '📏 Km', value: `${km.toLocaleString()} km`, inline: true }
            )
            .setFooter({ text: `🔧 Modificata da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function eliminaAuto(opts, username) {
    const data = await caricaDati();
    const auto = data.auto || [];
    const { id } = opts;
    const index = auto.findIndex(a => a.id === id);
    if (index === -1) return { success: false, messaggio: `❌ Auto con ID ${id} non trovata.` };
    if (isAutoPrenotata(id, data.prenotazioni || [])) {
        return { success: false, messaggio: `❌ L'auto con ID ${id} è prenotata!` };
    }
    const autoEliminata = auto[index];
    auto.splice(index, 1);
    if (await salvaAuto(auto)) {
        const embed = embedRacing(COLORI.pericolo)
            .setTitle('🏳️ Auto ritirata dalla gara')
            .setDescription(`### 🚗 ${autoEliminata.marca} ${autoEliminata.modello}\n\`ID ${id}\` rimossa dal listino.`)
            .setFooter({ text: `🗑️ Eliminata da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function listaAuto() {
    const data = await caricaDati();
    const auto = data.auto || [];
    const prenotazioni = data.prenotazioni || [];
    if (auto.length === 0) return { success: false, messaggio: '🏁 **La griglia di partenza è vuota.** Nessuna auto in listino.' };
    let testo = `${LINEA_BANDIERA}\n\n`;
    auto.slice(0, 15).forEach(a => {
        const prenotata = isAutoPrenotata(a.id, prenotazioni) ? ' 🔒 *PRENOTATA*' : '';
        testo += `**\`${a.id}\`** · 🚗 ${a.marca} ${a.modello} — € ${a.prezzo.toLocaleString()} · ${a.anno} · ${a.km.toLocaleString()}km${prenotata}\n`;
    });
    if (auto.length > 15) testo += `\n*… e altre ${auto.length - 15} auto in listino*`;
    const embed = embedRacing(COLORI.info)
        .setTitle('🏁 Griglia di partenza — Listino auto')
        .setDescription(testo)
        .setFooter({ text: `🚗 Totale: ${auto.length} auto · Outlet Usato Garantito` })
        .setTimestamp();
    return { success: true, embed };
}

async function prenotaAuto(opts, username) {
    const data = await caricaDati();
    const auto = data.auto || [];
    const prenotazioni = data.prenotazioni || [];
    const { id, nome, cognome, email, telefono, data: dataPrenotazione } = opts;
    const autoEsiste = auto.find(a => a.id === id);
    if (!autoEsiste) return { success: false, messaggio: `❌ Auto con ID ${id} non trovata.` };
    if (isAutoPrenotata(id, prenotazioni)) {
        return { success: false, messaggio: `❌ L'auto ${autoEsiste.marca} ${autoEsiste.modello} è già prenotata!` };
    }
    const nuovaPrenotazione = {
        id: Date.now(),
        autoId: id,
        nome, cognome, email, telefono,
        data: dataPrenotazione,
        stato: 'in-attesa',
        dataRichiesta: new Date().toLocaleDateString('it-IT')
    };
    if (await inserisciPrenotazione(nuovaPrenotazione)) {
        const embed = embedRacing(COLORI.successo)
            .setTitle('🏁 Prenotazione ai box!')
            .setDescription(`### 🚗 ${autoEsiste.marca} ${autoEsiste.modello}\n\`ID ${id}\` ${LINEA_BANDIERA}`)
            .addFields(
                { name: '👤 Cliente', value: `${nome} ${cognome}`, inline: true },
                { name: '📧 Email', value: email, inline: true },
                { name: '📞 Telefono', value: telefono, inline: true },
                { name: '📅 Data richiesta', value: dataPrenotazione, inline: true },
                { name: '🚦 Stato', value: '🟡 In attesa', inline: true }
            )
            .setFooter({ text: `🏁 Prenotata da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function listaPrenotazioni() {
    const data = await caricaDati();
    const prenotazioni = data.prenotazioni || [];
    const auto = data.auto || [];
    if (prenotazioni.length === 0) return { success: false, messaggio: '📋 **Nessuna prenotazione al momento.**' };
    let testo = `${LINEA_BANDIERA}\n\n`;
    prenotazioni.slice(0, 10).forEach(p => {
        const autoNome = auto.find(a => a.id === p.autoId);
        const statoEmoji = p.stato === 'confermata' ? '🟢' : p.stato === 'annullata' ? '🔴' : '🟡';
        const discordTag = p.discordUsername ? ` (Discord: @${p.discordUsername})` : '';
        testo += `**\`${p.id}\`** · 🚗 ${autoNome ? autoNome.marca + ' ' + autoNome.modello : 'Auto #' + p.autoId} — ${p.nome} ${p.cognome}${discordTag} — ${statoEmoji} *${p.stato}*\n`;
    });
    const embed = embedRacing(COLORI.info)
        .setTitle('🏁 Box prenotazioni')
        .setDescription(testo)
        .setFooter({ text: `📅 Totale: ${prenotazioni.length} prenotazioni · Outlet Usato Garantito` })
        .setTimestamp();
    return { success: true, embed };
}

async function statistiche() {
    const data = await caricaDati();
    const auto = data.auto || [];
    const prenotazioni = data.prenotazioni || [];

    const autoPrenotate = auto.filter(a => isAutoPrenotata(a.id, prenotazioni));
    const autoDisponibili = auto.length - autoPrenotate.length;
    const valoreTotale = auto.reduce((somma, a) => somma + (Number(a.prezzo) || 0), 0);

    const inAttesa = prenotazioni.filter(p => p.stato === 'in-attesa').length;
    const confermate = prenotazioni.filter(p => p.stato === 'confermata').length;
    const annullate = prenotazioni.filter(p => p.stato === 'annullata').length;

    const embed = embedRacing(COLORI.statistiche)
        .setTitle('🏁 Tabellone gara — Statistiche')
        .setDescription(LINEA_BANDIERA)
        .addFields(
            { name: '🚗 Auto in listino', value: String(auto.length), inline: true },
            { name: '✅ Disponibili', value: String(autoDisponibili), inline: true },
            { name: '🔒 Prenotate', value: String(autoPrenotate.length), inline: true },
            { name: '💰 Valore totale listino', value: `€ ${valoreTotale.toLocaleString()}`, inline: false },
            { name: '🟡 In attesa', value: String(inAttesa), inline: true },
            { name: '🟢 Confermate', value: String(confermate), inline: true },
            { name: '🔴 Annullate', value: String(annullate), inline: true }
        )
        .setFooter({ text: `📊 Totale prenotazioni: ${prenotazioni.length} · Outlet Usato Garantito` })
        .setTimestamp();
    return { success: true, embed };
}

async function confermaPrenotazione(opts, username) {
    const data = await caricaDati();
    const prenotazioni = data.prenotazioni || [];
    const auto = data.auto || [];
    const { id } = opts;
    const prenotazione = prenotazioni.find(p => p.id === id);
    if (!prenotazione) return { success: false, messaggio: `❌ Prenotazione con ID ${id} non trovata.` };
    if (prenotazione.stato === 'confermata') return { success: false, messaggio: `❌ Prenotazione già confermata.` };

    if (await aggiornaStatoPrenotazione(id, 'confermata')) {
        const autoInfo = auto.find(a => a.id === prenotazione.autoId);
        const nomeAuto = autoInfo ? `${autoInfo.marca} ${autoInfo.modello}` : `Auto #${prenotazione.autoId}`;

        // DM al cliente
        const dmEmbed = embedRacing(COLORI.successo)
            .setTitle('🏁 Semaforo verde — Prenotazione confermata!')
            .setDescription(`### 🚗 ${nomeAuto}\nLa tua prenotazione è stata confermata, ti aspettiamo! ${LINEA_BANDIERA}`)
            .addFields(
                { name: '📅 Data richiesta', value: prenotazione.data, inline: true },
                { name: '🆔 Prenotazione', value: String(id), inline: true }
            )
            .setFooter({ text: '🏁 Outlet Usato Garantito' })
            .setTimestamp();
        const dmInviato = await inviaDM(prenotazione.discordId, dmEmbed);

        const embed = embedRacing(COLORI.successo)
            .setTitle('✅ Prenotazione confermata!')
            .setDescription(`\`Prenotazione ID ${id}\` ${LINEA_BANDIERA}`)
            .addFields(
                { name: '👤 Cliente', value: `${prenotazione.nome} ${prenotazione.cognome}${prenotazione.discordUsername ? ` (@${prenotazione.discordUsername})` : ''}` },
                { name: '📩 DM al cliente', value: dmInviato ? '✅ Inviato' : '⚠️ Non inviato (DM chiusi o ID non valido)' }
            )
            .setFooter({ text: `🏁 Confermata da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function annullaPrenotazione(opts, username) {
    const data = await caricaDati();
    const prenotazioni = data.prenotazioni || [];
    const auto = data.auto || [];
    const { id } = opts;
    const prenotazione = prenotazioni.find(p => p.id === id);
    if (!prenotazione) return { success: false, messaggio: `❌ Prenotazione con ID ${id} non trovata.` };
    if (prenotazione.stato === 'annullata') return { success: false, messaggio: `❌ Prenotazione già annullata.` };

    if (await aggiornaStatoPrenotazione(id, 'annullata')) {
        const autoInfo = auto.find(a => a.id === prenotazione.autoId);
        const nomeAuto = autoInfo ? `${autoInfo.marca} ${autoInfo.modello}` : `Auto #${prenotazione.autoId}`;

        // DM al cliente
        const dmEmbed = embedRacing(COLORI.pericolo)
            .setTitle('🏳️ Bandiera rossa — Prenotazione annullata')
            .setDescription(`### 🚗 ${nomeAuto}\nLa tua prenotazione è stata annullata.`)
            .addFields(
                { name: '🆔 Prenotazione', value: String(id), inline: true }
            )
            .setFooter({ text: '🏁 Outlet Usato Garantito' })
            .setTimestamp();
        const dmInviato = await inviaDM(prenotazione.discordId, dmEmbed);

        const embed = embedRacing(COLORI.pericolo)
            .setTitle('🏳️ Prenotazione annullata!')
            .setDescription(`\`Prenotazione ID ${id}\``)
            .addFields(
                { name: '👤 Cliente', value: `${prenotazione.nome} ${prenotazione.cognome}${prenotazione.discordUsername ? ` (@${prenotazione.discordUsername})` : ''}` },
                { name: '📩 DM al cliente', value: dmInviato ? '✅ Inviato' : '⚠️ Non inviato (DM chiusi o ID non valido)' }
            )
            .setFooter({ text: `🏁 Annullata da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function adminAdd(opts, interaction, username) {
    const utenteTarget = interaction.options.getUser('utente');
    if (!utenteTarget) return { success: false, messaggio: '❌ Utente non valido.' };

    if (await aggiungiAdminWhitelist(utenteTarget.id, utenteTarget.username, username)) {
        const embed = embedRacing(COLORI.successo)
            .setTitle('🔑 Nuovo pilota ammesso al box admin!')
            .setDescription(`### 👤 ${utenteTarget.username}\nPuò ora accedere al pannello admin del sito. ${LINEA_BANDIERA}`)
            .addFields(
                { name: '🆔 Discord ID', value: utenteTarget.id, inline: true }
            )
            .setFooter({ text: `🏁 Aggiunto da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: '❌ Errore durante il salvataggio.' };
}

async function adminRemove(opts, interaction, username) {
    const utenteTarget = interaction.options.getUser('utente');
    if (!utenteTarget) return { success: false, messaggio: '❌ Utente non valido.' };

    if (await rimuoviAdminWhitelist(utenteTarget.id)) {
        const embed = embedRacing(COLORI.pericolo)
            .setTitle('🏳️ Pass box ritirato')
            .setDescription(`### 👤 ${utenteTarget.username}\nNon può più accedere al pannello admin del sito.`)
            .setFooter({ text: `🏁 Rimosso da ${username} · Outlet Usato Garantito` })
            .setTimestamp();
        return { success: true, embed };
    }
    return { success: false, messaggio: `❌ ${utenteTarget.username} non era nella whitelist admin.` };
}

async function adminList() {
    const whitelist = await listaAdminWhitelist();
    if (whitelist.length === 0) {
        return { success: false, messaggio: '📋 **Nessun admin del sito ancora autorizzato.** Usa `/admin-add` per aggiungerne uno.' };
    }
    let testo = `${LINEA_BANDIERA}\n\n`;
    whitelist.forEach(w => {
        testo += `🔑 **${w.discord_username || 'sconosciuto'}** · \`${w.discord_id}\` — aggiunto da ${w.aggiunto_da || '?'} il ${w.aggiunto_il}\n`;
    });
    const embed = embedRacing(COLORI.info)
        .setTitle('🏁 Box admin — Piloti autorizzati')
        .setDescription(testo)
        .setFooter({ text: `🔑 Totale: ${whitelist.length} admin · Outlet Usato Garantito` })
        .setTimestamp();
    return { success: true, embed };
}

function help() {
    const embed = embedRacing(COLORI.info)
        .setTitle('🏁 Box informazioni — Comandi disponibili')
        .setDescription(LINEA_BANDIERA)
        .addFields(
            { name: '🚗 Gestione Auto (solo staff)', value:
                '`/aggiungi-auto` `/modifica-auto` `/elimina-auto`\n`/lista-auto` (per tutti)' },
            { name: '📅 Gestione Prenotazioni', value:
                '`/prenota-auto` `/lista-prenotazioni` (per tutti)\n`/conferma-prenotazione` `/annulla-prenotazione` (solo staff)' },
            { name: '📊 Statistiche', value: '`/statistiche` (per tutti)' },
            { name: '🔑 Admin pannello sito (solo staff)', value:
                '`/admin-add` `/admin-remove` `/admin-list`\nGestisce chi può accedere al pannello admin del sito web (login con Discord).' },
            { name: '❓ Help', value: '`/help`' }
        )
        .setFooter({ text: '🏁 Outlet Usato Garantito' })
        .setTimestamp();
    return { success: true, embed };
}

// Comandi che richiedono il ruolo staff
const COMANDI_STAFF = [
    'aggiungi-auto',
    'modifica-auto',
    'elimina-auto',
    'conferma-prenotazione',
    'annulla-prenotazione',
    'admin-add',
    'admin-remove',
    'admin-list'
];

// ============================================================
// GESTIONE INTERAZIONI (Slash Command native)
// ============================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    const username = interaction.user.username;

    if (COMANDI_STAFF.includes(cmd) && !haRuoloStaff(interaction)) {
        const embedNegato = embedRacing(COLORI.ammonimento)
            .setTitle('🚫 Bandiera nera — Accesso ai box negato')
            .setDescription(`Non hai i permessi per usare questo comando.\nServe il ruolo **${RUOLO_STAFF}**.`);
        await interaction.reply({
            embeds: [embedNegato],
            ephemeral: true
        });
        return;
    }

    // Discord fa timeout dopo 3s: "difeririamo" subito la risposta per avere più tempo
    await interaction.deferReply();

    let risultato;
    try {
        const opts = {};
        interaction.options.data.forEach(o => { opts[o.name] = o.value; });

        if (cmd === 'aggiungi-auto') risultato = await aggiungiAuto(opts, username);
        else if (cmd === 'modifica-auto') risultato = await modificaAuto(opts, username);
        else if (cmd === 'elimina-auto') risultato = await eliminaAuto(opts, username);
        else if (cmd === 'lista-auto') risultato = await listaAuto();
        else if (cmd === 'prenota-auto') risultato = await prenotaAuto(opts, username);
        else if (cmd === 'lista-prenotazioni') risultato = await listaPrenotazioni();
        else if (cmd === 'statistiche') risultato = await statistiche();
        else if (cmd === 'conferma-prenotazione') risultato = await confermaPrenotazione(opts, username);
        else if (cmd === 'annulla-prenotazione') risultato = await annullaPrenotazione(opts, username);
        else if (cmd === 'admin-add') risultato = await adminAdd(opts, interaction, username);
        else if (cmd === 'admin-remove') risultato = await adminRemove(opts, interaction, username);
        else if (cmd === 'admin-list') risultato = await adminList();
        else if (cmd === 'help') risultato = help();
        else risultato = { success: false, messaggio: '❌ Comando non riconosciuto.' };

        if (risultato.embed) {
            await interaction.editReply({ embeds: [risultato.embed] });
        } else {
            await interaction.editReply(risultato.messaggio || '❌ Errore sconosciuto');
        }
    } catch (error) {
        console.error('❌ Errore:', error);
        await interaction.editReply('❌ Si è verificato un errore.');
    }
});

client.on('clientReady', () => {
    console.log(`✅ Bot avviato con successo!`);
    console.log(`📢 Connesso come: ${client.user.tag}`);
    console.log(`🔒 Ruolo staff: ${RUOLO_STAFF}`);

    if (process.env.AFK_CHANNEL_ID) {
        setupAfkModule(client, {
            afkChannelId: process.env.AFK_CHANNEL_ID,
            timeoutMs: 5 * 60 * 1000 // 5 minuti
        });
    } else {
        console.warn('⚠️ AFK_CHANNEL_ID non impostata: funzione AFK disattivata.');
    }
});

client.login(TOKEN).catch(error => {
    console.error('❌ Errore login:', error.message);
    process.exit(1);
});
