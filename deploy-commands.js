const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// 🔧 Variabili d'ambiente necessarie SOLO per questo script
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;   // Application ID (Developer Portal → General Information)
const GUILD_ID = process.env.GUILD_ID;     // ID del tuo server Discord

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('❌ Servono DISCORD_TOKEN, CLIENT_ID e GUILD_ID come variabili d\'ambiente.');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('aggiungi-auto')
        .setDescription('Aggiunge una nuova auto al listino (solo staff)')
        .addStringOption(o => o.setName('marca').setDescription('Marca').setRequired(true))
        .addStringOption(o => o.setName('modello').setDescription('Modello').setRequired(true))
        .addIntegerOption(o => o.setName('anno').setDescription('Anno').setRequired(true))
        .addIntegerOption(o => o.setName('prezzo').setDescription('Prezzo in €').setRequired(true))
        .addIntegerOption(o => o.setName('km').setDescription('Chilometraggio').setRequired(true))
        .addStringOption(o => o.setName('alimentazione').setDescription('Es. Benzina, Diesel, Elettrica').setRequired(true))
        .addStringOption(o => o.setName('cambio').setDescription('Es. Manuale, Automatico').setRequired(true)),

    new SlashCommandBuilder()
        .setName('modifica-auto')
        .setDescription('Modifica un\'auto esistente (solo staff)')
        .addIntegerOption(o => o.setName('id').setDescription('ID auto').setRequired(true))
        .addStringOption(o => o.setName('marca').setDescription('Marca').setRequired(true))
        .addStringOption(o => o.setName('modello').setDescription('Modello').setRequired(true))
        .addIntegerOption(o => o.setName('anno').setDescription('Anno').setRequired(true))
        .addIntegerOption(o => o.setName('prezzo').setDescription('Prezzo in €').setRequired(true))
        .addIntegerOption(o => o.setName('km').setDescription('Chilometraggio').setRequired(true))
        .addStringOption(o => o.setName('alimentazione').setDescription('Es. Benzina, Diesel, Elettrica').setRequired(true))
        .addStringOption(o => o.setName('cambio').setDescription('Es. Manuale, Automatico').setRequired(true)),

    new SlashCommandBuilder()
        .setName('elimina-auto')
        .setDescription('Elimina un\'auto dal listino (solo staff)')
        .addIntegerOption(o => o.setName('id').setDescription('ID auto').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lista-auto')
        .setDescription('Mostra la lista delle auto disponibili'),

    new SlashCommandBuilder()
        .setName('prenota-auto')
        .setDescription('Crea una prenotazione per un\'auto')
        .addIntegerOption(o => o.setName('id').setDescription('ID auto').setRequired(true))
        .addStringOption(o => o.setName('nome').setDescription('Nome cliente').setRequired(true))
        .addStringOption(o => o.setName('cognome').setDescription('Cognome cliente').setRequired(true))
        .addStringOption(o => o.setName('email').setDescription('Email cliente').setRequired(true))
        .addStringOption(o => o.setName('telefono').setDescription('Telefono cliente').setRequired(true))
        .addStringOption(o => o.setName('data').setDescription('Data richiesta').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lista-prenotazioni')
        .setDescription('Mostra la lista delle prenotazioni'),

    new SlashCommandBuilder()
        .setName('statistiche')
        .setDescription('Mostra statistiche rapide su auto e prenotazioni'),

    new SlashCommandBuilder()
        .setName('conferma-prenotazione')
        .setDescription('Conferma una prenotazione (solo staff)')
        .addIntegerOption(o => o.setName('id').setDescription('ID prenotazione').setRequired(true)),

    new SlashCommandBuilder()
        .setName('annulla-prenotazione')
        .setDescription('Annulla una prenotazione (solo staff)')
        .addIntegerOption(o => o.setName('id').setDescription('ID prenotazione').setRequired(true)),

    new SlashCommandBuilder()
        .setName('admin-add')
        .setDescription('Autorizza un utente ad accedere al pannello admin del sito (solo staff)')
        .addUserOption(o => o.setName('utente').setDescription('Utente Discord da autorizzare').setRequired(true)),

    new SlashCommandBuilder()
        .setName('admin-remove')
        .setDescription('Toglie a un utente l\'accesso al pannello admin del sito (solo staff)')
        .addUserOption(o => o.setName('utente').setDescription('Utente Discord da rimuovere').setRequired(true)),

    new SlashCommandBuilder()
        .setName('admin-list')
        .setDescription('Mostra chi può accedere al pannello admin del sito (solo staff)'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Mostra i comandi disponibili'),
].map(c => c.toJSON());

const rest = new REST().setToken(TOKEN);

(async () => {
    try {
        console.log(`🔄 Registrazione di ${commands.length} comandi sul server ${GUILD_ID}...`);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log('✅ Comandi registrati con successo! (visibili quasi subito nel server)');
    } catch (error) {
        console.error('❌ Errore durante la registrazione:', error);
    }
})();
