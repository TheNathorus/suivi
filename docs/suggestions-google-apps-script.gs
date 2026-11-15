/**
 * Boîte de réception des suggestions du site Suivi (Google Apps Script, gratuit).
 *
 * Mode d'emploi : voir « Suggestions des agents » dans le README du dépôt.
 * 1. Créez une feuille Google Sheets vide, puis Extensions > Apps Script.
 *    (Si l'éditeur refuse de s'ouvrir, souvent à cause de plusieurs comptes Google connectés : ouvrez script.google.com
 *    dans une fenêtre de navigation privée avec un seul compte, Nouveau projet, et renseignez ID_FEUILLE ci-dessous.)
 * 2. Collez ce fichier à la place du code, changez CLE (votre mot de passe de lecture), enregistrez.
 * 3. Déployer > Nouveau déploiement > Application Web.
 *    Exécuter en tant que : moi. Qui a accès : tout le monde. Copiez l'adresse qui se termine par /exec.
 *
 * Les agents écrivent sans mot de passe (formulaire des fiches). Seule la page /admin/ lit la liste et marque une
 * suggestion « traitée » (colonne traite de la feuille), avec le mot de passe CLE. Rien d'autre n'est exposé.
 *
 * Mise à jour d'un script déjà déployé : collez ce fichier, remettez votre CLE (et ID_FEUILLE si vous en aviez une),
 * enregistrez, puis Déployer > Gérer les déploiements > crayon > Version : Nouvelle version > Déployer.
 * L'adresse /exec ne change pas.
 */
const CLE = 'REMPLACEZ-PAR-UNE-LONGUE-PHRASE-SECRETE';
// Si vous avez créé un projet Apps Script séparé (script.google.com > Nouveau projet) au lieu de l'ouvrir depuis la feuille,
// collez ici l'identifiant de la feuille (la longue suite de lettres entre /d/ et /edit dans son adresse). Sinon, laissez vide.
const ID_FEUILLE = '';
const ENTETE = ['id', 'date', 'bien', 'label', 'nom', 'types', 'statut', 'prix', 'texte', 'traite', 'traite_le'];
const MAX_LIGNES = 2000;

function feuille_() {
  const classeur = ID_FEUILLE ? SpreadsheetApp.openById(ID_FEUILLE) : SpreadsheetApp.getActiveSpreadsheet();
  const f = classeur.getSheets()[0];
  if (f.getLastRow() === 0) f.appendRow(ENTETE);
  else if (String(f.getRange(1, 10).getValue()) !== 'traite') f.getRange(1, 10, 1, 2).setValues([['traite', 'traite_le']]);  // feuille créée avant cette version
  f.getRange('A:A').setNumberFormat('@');   // les identifiants restent du texte (jamais un nombre ou une date)
  return f;
}

// Évite qu'un texte commençant par = + - @ soit interprété comme une formule dans la feuille.
function texte_(v, max) {
  const t = String(v == null ? '' : v).slice(0, max);
  return /^[=+\-@]/.test(t) ? ' ' + t : t;
}

function reponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Écrit « oui » (appliquée) ou « non » (écartée) et la date dans la ligne de la suggestion. Mot de passe obligatoire.
function marquerTraite_(d) {
  if (!d.cle || d.cle !== CLE) return reponse_({ ok: false });
  const f = feuille_(), n = f.getLastRow(), id = String(d.id || '').trim();
  if (n > 1 && id) {
    const ids = f.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) {
        f.getRange(i + 2, 10, 1, 2).setValues([[d.decision === 'oui' ? 'oui' : 'non', new Date().toISOString()]]);
        return reponse_({ ok: true });
      }
    }
  }
  return reponse_({ ok: false });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'traite') return marquerTraite_(d);              // l'administrateur a traité une suggestion
    if (d.piege) return reponse_({ ok: true });                       // champ piège rempli par un robot
    const f = feuille_();
    if (f.getLastRow() > MAX_LIGNES) return reponse_({ ok: true });  // garde-fou
    const bien = parseInt(d.bien, 10) || 0;
    const prix = parseInt(d.prix, 10) || '';
    f.appendRow([texte_(d.id, 40), new Date().toISOString(), bien, texte_(d.label, 60), texte_(d.nom, 60),
      texte_((d.types || []).join(','), 120), texte_(d.statut, 20), prix, texte_(d.texte, 600)]);
  } catch (err) { /* message mal formé : ignoré */ }
  return reponse_({ ok: true });
}

function doGet(e) {
  if (!e.parameter.cle || e.parameter.cle !== CLE) return reponse_({ ok: false });
  const f = feuille_();
  const lignes = f.getLastRow() > 1 ? f.getRange(2, 1, f.getLastRow() - 1, ENTETE.length).getValues() : [];
  const suggestions = lignes.map(function (l) {
    return { id: String(l[0]).trim(), date: l[1] instanceof Date ? l[1].toISOString() : String(l[1]), bien: l[2], label: l[3], nom: l[4], types: String(l[5]).split(',').filter(String), statut: l[6], prix: l[7], texte: l[8], traite: String(l[9] || '') };
  });
  return reponse_({ ok: true, suggestions: suggestions });
}
