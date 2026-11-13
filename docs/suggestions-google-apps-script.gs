/**
 * Boîte de réception des suggestions du site Suivi (Google Apps Script, gratuit).
 *
 * Mode d'emploi : voir « Suggestions des agents » dans le README du dépôt.
 * 1. Créez une feuille Google Sheets vide, puis Extensions > Apps Script.
 * 2. Collez ce fichier à la place du code, changez CLE (votre mot de passe de lecture), enregistrez.
 * 3. Déployer > Nouveau déploiement > Application Web.
 *    Exécuter en tant que : moi. Qui a accès : tout le monde. Copiez l'adresse qui se termine par /exec.
 *
 * Les agents écrivent sans mot de passe (formulaire des fiches). Seule la page /admin/ lit la liste,
 * avec le mot de passe CLE. Rien d'autre n'est exposé.
 */
const CLE = 'REMPLACEZ-PAR-UNE-LONGUE-PHRASE-SECRETE';
const ENTETE = ['id', 'date', 'bien', 'label', 'nom', 'types', 'statut', 'prix', 'texte'];
const MAX_LIGNES = 2000;

function feuille_() {
  const f = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (f.getLastRow() === 0) f.appendRow(ENTETE);
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

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
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
    return { id: l[0], date: String(l[1]), bien: l[2], label: l[3], nom: l[4], types: String(l[5]).split(',').filter(String), statut: l[6], prix: l[7], texte: l[8] };
  });
  return reponse_({ ok: true, suggestions: suggestions });
}
