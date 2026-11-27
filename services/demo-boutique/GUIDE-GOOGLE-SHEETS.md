# Le commerçant change lui-même ses produits (Google Sheets)

Grâce à ça, le commerçant peut changer un prix, mettre un produit « épuisé » ou en
ajouter un nouveau **depuis son téléphone**, sans te demander.

## 1. Créer le tableau (toi, une seule fois par client)

1. Ouvre **Google Sheets** (sheets.google.com ou l'appli) avec ton compte Google.
2. Crée une feuille vide nommée `Produits — [nom du commerce]`.
3. Copie le modèle `modele-produits.csv` dans la feuille (ou Fichier → Importer).
4. Remplis une ligne par produit :

| Colonne | Exemple | Explication |
|---|---|---|
| `categorie` | Robes | Le rayon (crée les boutons en haut de la page) |
| `nom` | Robe pagne wax | Nom du produit |
| `description` | Coupe évasée | Une phrase courte (facultatif) |
| `prix` | 12000 | Prix en F, chiffres seulement |
| `ancien_prix` | 15000 | Si promo : l'ancien prix (affiche « -20 % »). Sinon vide |
| `image` | 👗 ou un lien https://… | Un emoji, ou le lien d'une photo en ligne |
| `options` | S,M,L,XL | Tailles ou couleurs séparées par des virgules (facultatif) |
| `disponible` | OUI / NON | **NON** = affiché « Épuisé », impossible à commander |

## 2. Publier le tableau

1. **Fichier → Partager → Publier sur le Web**.
2. Choisis la feuille, format **Valeurs séparées par des virgules (.csv)** → **Publier**.
3. Copie le lien qui s'affiche (il finit par `output=csv`).

## 3. Brancher la page

Dans `demo-boutique/index.html` (la copie faite pour le client), colle le lien dans
`sheet:'…'` de sa boutique. Ou envoie-le à Claude qui le fera.

## 4. Donner l'accès au commerçant

1. **Partager** → ajoute l'adresse Gmail du commerçant en **Éditeur**.
2. Il installe l'appli **Google Sheets** et ouvre le tableau.
3. Il modifie ses produits ; la page se met à jour en **quelques minutes** (Google met
   à jour le lien publié avec un petit délai).

## Ce que tu dis au client

> « Vos produits sont dans un tableau sur votre téléphone. Un produit est fini ? Vous
> écrivez NON, et il s'affiche “Épuisé”. Un prix change ? Vous changez le chiffre.
> Et si vous préférez, vous m'envoyez un message et je le fais pour vous. »

## Photos des produits

Les emojis servent pour la démo. Pour un vrai client, mets de **vraies photos** :
envoie-les à Claude (ou mets-les en ligne) et colle le lien `https://…` dans la
colonne `image`. Les liens Google Drive classiques ne s'affichent pas directement.
