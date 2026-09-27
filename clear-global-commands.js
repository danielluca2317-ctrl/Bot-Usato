const { REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ Servono DISCORD_TOKEN e CLIENT_ID come variabili d\'ambiente.');
    process.exit(1);
}

const rest = new REST().setToken(TOKEN);

(async () => {
    try {
        console.log('🔄 Rimozione di tutti i comandi GLOBALI...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: [] } // lista vuota = cancella tutto
        );
        console.log('✅ Comandi globali rimossi! (possono metterci fino a 1 ora per sparire dal client Discord)');
    } catch (error) {
        console.error('❌ Errore durante la rimozione:', error);
    }
})();
