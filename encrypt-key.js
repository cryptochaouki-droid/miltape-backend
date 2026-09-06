// ⚠️ CE SCRIPT S'EXÉCUTE EN LOCAL, SUR TA MACHINE — JAMAIS SUR RAILWAY, JAMAIS COLLÉ
// DANS UN CHAT, JAMAIS COMMIT DANS GIT. Il ne fait que chiffrer ta clé, il ne l'envoie nulle part.
//
// Usage : node encrypt-key.js
// Puis colle les DEUX valeurs affichées dans les variables d'environnement Railway :
//   MASTER_KEY=...
//   ENCRYPTED_PRIVATE_KEY=...
// Une fois confirmé que le serveur démarre bien avec ces deux variables, retire
// MILTAPE_PRIVATE_KEY de Railway (elle n'est plus nécessaire).

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

(async () => {
    console.log("=== Chiffrement de la clé privée Miltape ===\n");

    const privateKey = await ask("Colle ta clé privée TRON actuelle (MILTAPE_PRIVATE_KEY) : ");
    if (!privateKey) { console.error("❌ Clé privée vide."); process.exit(1); }

    let masterKey = await ask("Clé maîtresse (32 bytes hex — laisse vide pour en générer une nouvelle) : ");
    if (!masterKey) {
        masterKey = crypto.randomBytes(32).toString('hex');
        console.log("\n🔑 Nouvelle clé maîtresse générée automatiquement.");
    }

    const key = Buffer.from(masterKey, 'hex');
    if (key.length !== 32) {
        console.error("❌ La clé maîtresse doit faire exactement 32 bytes (64 caractères hex).");
        process.exit(1);
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const result = iv.toString('hex') + encrypted;

    console.log("\n=== Variables à copier dans Railway (onglet Variables) ===\n");
    console.log("MASTER_KEY=" + masterKey);
    console.log("ENCRYPTED_PRIVATE_KEY=" + result);
    console.log("\n⚠️ Ne redéploie qu'une fois ces deux variables enregistrées sur Railway.");
    console.log("⚠️ Une fois le serveur redémarré et confirmé fonctionnel, retire MILTAPE_PRIVATE_KEY.");
    console.log("⚠️ Ne partage MASTER_KEY nulle part — quiconque l'a, avec ENCRYPTED_PRIVATE_KEY, peut retrouver ta clé privée.");

    rl.close();
})();
