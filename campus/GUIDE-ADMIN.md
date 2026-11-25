# Campus Services — guide d'administration

Tout se gère depuis la **console Firebase** (console.firebase.google.com → projet
`campus-services` → Firestore Database → onglet **Data**). Aucune mise à jour de
l'application n'est nécessaire : les changements apparaissent chez tous les
utilisateurs en quelques secondes.

> Après chaque modification du fichier `firestore.rules`, recopie-le dans
> Firestore → **Rules** → **Publish**.

---

## 1. Réglages généraux (à faire une seule fois)

1. Dans **Data**, appuie sur **+ Start collection**.
2. Collection ID : `config` → **Next**.
3. Document ID : `app`
4. Ajoute ces champs :

| Champ | Type | Exemple | Rôle |
|---|---|---|---|
| `adminWhatsapp` | string | `22901XXXXXXXX` | Ton numéro WhatsApp (avec indicatif, sans +). **Tant qu'il est absent, le bouton ⭐ est caché.** |
| `unePrix` | number | `300` | Prix de la mise à la une, en FCFA |
| `uneJours` | number | `7` | Durée de la mise à la une, en jours |

5. **Save**.

---

## 2. Mettre une annonce « à la une »

**Côté étudiant** : dans « Mes annonces », il appuie sur ⭐. WhatsApp s'ouvre vers
ton numéro avec un message contenant le **titre** et le **code** de l'annonce.

**Côté toi** :
1. Reçois le paiement (Mobile Money, espèces…).
2. Dans **Data** → collection `annonces`, ouvre le document dont l'ID est le **code** reçu.
3. **+ Add field** :
   - Field : `une`
   - Type : **timestamp**
   - Value : la date de fin (ex. aujourd'hui + 7 jours)
4. **Save**. L'annonce passe en tête avec un badge ⭐ jusqu'à cette date.

Pour arrêter plus tôt : supprime le champ `une`.

---

## 3. Publicités (bannières « Sponsorisé »)

La première bannière s'affiche après la 2ᵉ annonce, puis une toutes les 6 annonces.
S'il y a plusieurs publicités, elles tournent dans un ordre aléatoire.

1. Dans **Data**, **+ Start collection** → Collection ID : `pubs` (la première fois).
2. **Add document** → Document ID : **Auto-ID**.
3. Champs :

| Champ | Type | Exemple | Obligatoire |
|---|---|---|---|
| `titre` | string | `Repro Express — impression 20 F` | oui |
| `texte` | string | `À 2 min de l'amphi A. Livraison au campus.` | non |
| `lien` | string | `22901XXXXXXXX` (WhatsApp) ou `https://…` | non |
| `actif` | boolean | `true` | oui |
| `fin` | timestamp | date de fin de la campagne | non |

4. **Save**.

Pour mettre une pub en pause : passe `actif` à `false`. Elle disparaît aussi
automatiquement après la date `fin`.

---

## 4. Modération

- **Supprimer une annonce abusive** : collection `annonces` → ouvre le document → ⋮ → **Delete document**.
- Les annonces de plus de 30 jours ne s'affichent plus dans l'application.

---

## 5. Tarifs de départ suggérés

| Offre | Prix |
|---|---|
| Annonce à la une, 7 jours | 300 FCFA |
| Bannière, 1 mois | 5 000 – 20 000 FCFA selon le commerce |

Garde un petit tableau (date, client, offre, montant) pour suivre tes revenus.
