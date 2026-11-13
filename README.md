# Suivi · Maisons autour de Nîmes

Site statique publié avec GitHub Pages sur https://suivi.becheroy.fr.
Aucune dépendance à installer, aucune étape de construction dans ce dépôt.

## Contenu

| Chemin | Rôle |
| --- | --- |
| `index.html` | Page publique : liste, filtres, fiches, comparaison, plan |
| `admin/` | Page d'administration : afficher ou masquer un bien, suivi, contact |
| `assets/app.js`, `assets/style.css` | Code et styles de la page publique |
| `assets/admin.js`, `assets/admin.css` | Code et styles de l'administration |
| `assets/data.js` | Données des biens (fichier généré, ne pas modifier à la main) |
| `data/etat.json` | Suivi modifiable : visibilité, statut et note de chaque bien, contact |
| `photos/` | Photos des annonces, en deux tailles (`-s` vignette, `-l` grande) |
| `assets/vendor/leaflet/` | Leaflet 1.9.4 (licence BSD-2-Clause), chargé seulement pour le plan |

## Mettre à jour

- **Suivi d'un bien, visibilité, contact** : page `/admin/`. Elle enregistre `data/etat.json`
  dans ce dépôt avec un jeton GitHub personnel, puis GitHub Pages republie le site en une à deux minutes.
- **Ajout ou retrait de biens, photos, critères** : par pull request.

## Adresses utiles

- Fiche d'un bien : `https://suivi.becheroy.fr/#bien-14`
- Comparaison : `https://suivi.becheroy.fr/#comparer=14,18,16`

Les pages portent une balise `noindex`. Les photos appartiennent aux agences et aux annonceurs.

## Mise à jour automatique des annonces

**Un seul système de statuts.** La page `/admin/` pilote le site public : tout ce qui change passe par `data/etat.json` (la base de l'administration) et le site public ne fait que le lire. Le robot du matin écrit donc dans cette même base, exactement comme l'administrateur.

Chaque matin vers 7 h (heure de Paris), le workflow **Vérifier les annonces** (`.github/workflows/annonces.yml`) lance `scripts/verifier_annonces.py`. Le script ouvre chaque annonce de `assets/data.js` et, si ce qu'il lit change, pose un statut de suivi dans `data/etat.json` :

| Statut de suivi posé par le robot | Quand |
| --- | --- |
| Sous compromis | l'annonceur l'écrit dans le titre ou le début de la description (« sous compromis », « sous offre »…) |
| Plus disponible | la page reste en ligne mais affiche « Cette annonce n'est plus disponible », sans raison : vendue, retirée ou en pause (deux lectures concordantes) |
| Vendue | l'annonceur l'écrit dans le titre ou le début de la description (« VENDU »…), deux lectures concordantes |
| Retirée | page supprimée ou renvoyée vers une liste (deux lectures concordantes) |

Les autres statuts (À étudier, Questions envoyées, Visite à prévoir, Visité, Écarté) sont ceux de l'administrateur : le robot ne les choisit jamais. Les biens Plus disponible, Vendue ou Retirée restent visibles, grisés et placés en fin de liste, et le filtre « Suivi » les propose comme les autres.

Règles de prudence :

- Le robot n'agit que lorsque ce qu'il lit **change**. Un statut choisi dans l'admin n'est donc jamais écrasé le lendemain.
- Il note dans la base le statut qu'il remplace (`avant`) : si l'annonce revient en ligne et que personne n'a touché au statut, le bien retrouve son suivi d'avant.
- Un blocage isolé du site ne change rien. Si près de la moitié des annonces disparaissent en même temps, le script suppose une panne du site et ne change rien.
- Le prix modifié (14 jours) et la date de dernière vérification restent de simples informations affichées sous le statut.

`data/annonces.json` (ce que le site a montré : prix, historique) et `data/verification.json` (date de la dernière lecture réussie) sont la mémoire du robot. Chaque vérification est **un commit sur `main`** au message lisible, par exemple « Annonces 14 nov. : réf. 16 plus disponible ».

### Revenir en arrière

- **Corriger un bien** : page `/admin/`, champ « Suivi » de la ligne du bien, puis *Publier*. Le robot ne le changera plus tant que l'annonce ne change pas. C'est la solution durable.
- **Annuler une mise à jour** : GitHub, onglet *Actions*, workflow **Annuler une mise à jour des annonces**, *Run workflow*. Sans autre précision, il remet le suivi des biens changés par la dernière mise à jour automatique, sauf ceux que l'administrateur a modifiés depuis. On peut aussi donner le numéro d'un commit précis. L'annulation est un nouveau commit : rien n'est effacé.
- **Mettre en pause** : onglet *Actions*, **Vérifier les annonces**, menu « … », *Disable workflow*.
- **Lancer une vérification maintenant** : même workflow, *Run workflow*. Le champ facultatif « diagnostic » (ex. `18`) détaille dans le journal ce que le site renvoie pour cette réf., sans adresse.

Le **prix** suit la même règle : le robot écrit dans la base le prix lu dans l'annonce quand il change (champ « Prix » de l'admin), et un prix saisi dans l'admin n'est jamais écrasé tant que l'annonce ne change pas.

Tests : `python3 scripts/test_verifier_annonces.py` (sans réseau).

## Suggestions des agents

Chaque carte a un bouton **Suggérer**, et chaque fiche un formulaire (nom, cases à cocher, statut proposé, nouveau prix, texte). L'envoi arrive dans la page `/admin/`, section **Suggestions des agents** : pour chaque suggestion, des cases à cocher (passer le suivi à…, mettre le prix à…, mettre le texte dans la note) puis **Traiter** ou **Écarter**. Rien n'est publié tant que l'administrateur n'a pas cliqué sur **Publier** ; les suggestions traitées sont mémorisées dans `data/etat.json` (`suggestions.traitees`).

**Activer le formulaire (une fois, 5 minutes, gratuit)**

1. Créez une feuille Google Sheets vide, puis *Extensions*, *Apps Script*. Si l'éditeur affiche « Impossible d'ouvrir le fichier » (plusieurs comptes Google connectés), ouvrez `script.google.com` dans une fenêtre de navigation privée avec le seul compte de la feuille, créez un *Nouveau projet* et renseignez `ID_FEUILLE` (identifiant de la feuille, entre `/d/` et `/edit` dans son adresse).
2. Collez le contenu de `docs/suggestions-google-apps-script.gs`, remplacez la valeur de `CLE` par une longue phrase secrète, enregistrez.
3. *Déployer*, *Nouveau déploiement*, type *Application Web* ; exécuter en tant que **moi**, accès **tout le monde** ; autorisez, puis copiez l'adresse qui finit par `/exec`.
4. Dans `/admin/`, tout en bas (**Réglage des suggestions**) : collez l'adresse, saisissez la phrase secrète (elle reste dans le navigateur), puis **Publier**.

Sans formulaire, le bouton d'envoi prépare un e-mail vers l'adresse de contact ; on le colle ensuite dans l'admin (« Coller une suggestion reçue par e-mail »).
