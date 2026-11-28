/* FoodConnect — application de commande de repas (Cotonou, Bénin).
 * Version démo : toutes les données sont gardées sur le téléphone (localStorage).
 * La couche « DB » ci-dessous sera remplacée par Firebase dans l'étape suivante. */
'use strict';

/* ---------- Outils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
const F = n => fmt(n) + ' F';
const hhmm = t => t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
const dday = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const uid = p => p + Math.random().toString(36).slice(2, 9);
const COMMISSION = 0.07;            // part de la plateforme sur chaque commande
const DEMO_TRIP_MS = 3 * 60 * 1000; // durée simulée d'une livraison
const CENTER = { lat: 6.3654, lng: 2.4183, label: 'Cotonou' };
/* Numéro WhatsApp qui reçoit TOUTES les commandes (format international, sans +).
 * Exemple : '2290197123456'. Laisse vide pour que le client choisisse le contact lui-même. */
const ORDER_WA = '2290162249923';
const SUPPORT_WA = ORDER_WA;
const WA_MODE = true; // true = les commandes partent par WhatsApp (avant Firebase)
/* Clé PUBLIQUE FedaPay (pk_sandbox_… pour tester, pk_live_… pour le vrai argent).
 * Vide = pas de paiement en ligne : le client paie après confirmation ou en espèces. */
const FEDAPAY_PUBLIC_KEY = '';

function km(a, b) {
  const R = 6371, t = x => x * Math.PI / 180;
  const dLa = t(b.lat - a.lat), dLo = t(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const kmTxt = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1).replace('.', ',') + ' km';
const deliveryFee = d => Math.min(2500, Math.max(500, Math.round((300 + d * 250) / 100) * 100));
function normPhone(p) {
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('229')) d = d.slice(3);
  if (d.length === 8) d = '01' + d;          // anciens numéros à 8 chiffres
  if (d.length !== 10) return null;
  return '+229 ' + d.replace(/(\d{2})(?=\d)/g, '$1 ');
}
const telHref = p => 'tel:' + String(p).replace(/[^\d+]/g, '');
const waHref = (p, txt = '') => 'https://wa.me/' + String(p || '').replace(/\D/g, '') + (txt ? '?text=' + encodeURIComponent(txt) : '');
// Ouvre une autre application (WhatsApp, Google Maps) depuis l'APK ou le navigateur
function openExt(url) { if (window.Capacitor) location.href = url; else window.open(url, '_blank'); }
function orderText(o) {
  const L = [`🍽️ *Nouvelle commande FoodConnect #${o.id}*`, '', `*Restaurant :* ${o.rname}`, ''];
  if (o.group) {
    L.push('👥 *Commande groupée*');
    Object.keys(o.split).forEach(w => {
      L.push('', `*${w}* — à payer : ${F(o.split[w])}`);
      o.items.filter(i => i.who === w).forEach(i => L.push(`• ${i.qty} × ${i.name} — ${F(i.qty * i.price)}`));
    });
  } else o.items.forEach(i => L.push(`• ${i.qty} × ${i.name} — ${F(i.qty * i.price)}`));
  L.push('', `Sous-total : ${F(o.sub)}`, `Livraison : ${F(o.fee)}`, `*Total : ${F(o.total)}*`, '', `*Paiement :* ${o.pay.label}`, '',
    `*Client :* ${o.cname}`, `*Téléphone :* ${o.cphone}`, `*Adresse :* ${o.address.label}${o.address.note ? ' — ' + o.address.note : ''}`,
    `📍 Position : https://maps.google.com/?q=${o.address.lat.toFixed(6)},${o.address.lng.toFixed(6)}`);
  return L.join('\n');
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const x = document.createElement('script'); x.src = src; x.onload = res; x.onerror = rej; document.head.appendChild(x);
  });
}
// Paiement Mobile Money via FedaPay : le client valide avec son code secret sur son téléphone.
async function fedapayPay(amount, u, description) {
  await loadScript('https://cdn.fedapay.com/checkout.js?v=1.1.7');
  const [first, ...rest] = u.name.split(' ');
  return new Promise(res => {
    const customer = { firstname: first, lastname: rest.join(' ') || first };
    if (u.email) customer.email = u.email;
    window.FedaPay.init({
      public_key: FEDAPAY_PUBLIC_KEY, transaction: { amount, description }, customer,
      onComplete(r) { const t = r && r.transaction; res(r && r.reason === window.FedaPay.CHECKOUT_COMPLETED && t && t.status === 'approved' ? t : null); },
    }).open();
  });
}
async function hash(s) {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fc:' + s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { return 'p:' + btoa(unescape(encodeURIComponent(s))); }
}

/* ---------- Icônes ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pin: '<path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12 5 5 9-10"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  heart: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h5l3-7h3M14 10l-2-4H9"/>',
  nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h2M3 10h18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.5.5 4 2.5 4 5.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
};
const ic = (n, s = 22, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;
const hat = (s = 64, c = '#ff6a00') => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 40c-6-1-10-6-10-12a10 10 0 0 1 14-9 12 12 0 0 1 20 0 10 10 0 0 1 14 9c0 6-4 11-10 12v12H18z"/><path d="M18 46h28"/><path d="M28 30v10M36 30v10"/></svg>`;
const wordmark = () => `<span class="wm">Food<b>Connect</b></span>`;

/* ---------- Données de départ (démo) ---------- */
const CATS = [
  ['tous', 'Tous', '🍽️'], ['beninois', 'Béninois', '🍲'], ['poulet', 'Poulet', '🍗'], ['burger', 'Burger', '🍔'],
  ['pizza', 'Pizza', '🍕'], ['africain', 'Africain', '🥘'], ['fastfood', 'Fast-food', '🍟'], ['boissons', 'Boissons', '🥤'],
];
const d = (id, name, price, emoji, section, desc = '', popular = false) => ({ id, name, price, emoji, section, desc, popular, off: false });
const SEED_RESTOS = [
  {
    id: 'r1', name: 'Le Délice Africain', emoji: '🍛', bg: 'linear-gradient(135deg,#7c2d12,#ea580c)', cats: ['beninois', 'africain', 'poulet', 'boissons'],
    tags: ['Béninois', 'Africain', 'Poulet'], rating: 4.6, nrev: 120, lat: 6.3560, lng: 2.3930, from: '08:00', to: '22:00', open: true,
    address: 'Cadjèhoun, à côté de la station Jonquet', phone: '+229 01 97 00 11 22',
    menu: [
      d('m1', 'Riz au poulet', 3000, '🍛', 'Plats', 'Riz parfumé, poulet braisé, sauce tomate', true),
      d('m2', 'Spaghetti sauce viande', 2500, '🍝', 'Plats', 'Spaghetti, sauce tomate à la viande de bœuf', true),
      d('m3', 'Attiéké + poisson', 3500, '🐟', 'Plats', 'Attiéké, poisson braisé, piment et oignons', true),
      d('m4', 'Amiwo au poulet', 3000, '🍲', 'Plats', 'Pâte rouge de maïs, poulet en sauce'),
      d('m5', 'Igname pilée sauce arachide', 3000, '🥣', 'Plats', 'Igname pilée, sauce d\'arachide à la viande'),
      d('m6', 'Bissap', 500, '🧃', 'Boissons', 'Jus d\'hibiscus maison, bien frais'),
      d('m7', 'Boisson gazeuse', 1000, '🥤', 'Boissons', 'Coca, Fanta ou Sprite 33 cl'),
      d('m8', 'Eau minérale', 500, '💧', 'Boissons', 'Bouteille 50 cl'),
    ],
    reviews: [
      { name: 'Koffi M.', stars: 5, text: 'Le riz au poulet est excellent, livré chaud.' },
      { name: 'Aïcha D.', stars: 4, text: 'Très bon attiéké, un peu d\'attente le midi.' },
    ],
  },
  {
    id: 'r2', name: 'Restaurant Chez Tonton', emoji: '🍲', bg: 'linear-gradient(135deg,#78350f,#d97706)', cats: ['beninois', 'boissons'],
    tags: ['Béninois', 'Maquis'], rating: 4.5, nrev: 98, lat: 6.3712, lng: 2.4480, from: '07:00', to: '23:00', open: true,
    address: 'Akpakpa, carrefour Sègbèya', phone: '+229 01 96 22 33 44',
    menu: [
      d('t1', 'Pâte rouge + poulet', 2500, '🍲', 'Plats', 'Amiwo et poulet bicyclette', true),
      d('t2', 'Akassa + poisson frit', 2000, '🐟', 'Plats', 'Akassa, poisson frit, sauce pimentée', true),
      d('t3', 'Ablo + poisson', 2000, '🍥', 'Plats', 'Ablo, sauce tomate et poisson'),
      d('t4', 'Télibo sauce gombo', 1500, '🥬', 'Plats', 'Pâte de cossettes d\'igname, sauce gombo'),
      d('t5', 'Jus d\'ananas', 700, '🍍', 'Boissons', 'Ananas pressé du jour'),
    ],
    reviews: [{ name: 'Rodrigue A.', stars: 5, text: 'Comme à la maison. La pâte rouge est top.' }],
  },
  {
    id: 'r3', name: 'Le Bon Goût', emoji: '🍗', bg: 'linear-gradient(135deg,#7f1d1d,#dc2626)', cats: ['poulet', 'africain', 'boissons'],
    tags: ['Grillades', 'Poulet'], rating: 4.2, nrev: 76, lat: 6.3598, lng: 2.3662, from: '11:00', to: '23:30', open: true,
    address: 'Fidjrossè, route des pêches', phone: '+229 01 95 33 44 55',
    menu: [
      d('b1', 'Poulet braisé entier', 6000, '🍗', 'Grillades', 'Poulet bicyclette braisé, alloco et piment', true),
      d('b2', 'Demi-poulet + alloco', 3500, '🍗', 'Grillades', 'Demi-poulet braisé, bananes plantains frites', true),
      d('b3', 'Brochettes de bœuf (x4)', 2000, '🍢', 'Grillades', 'Brochettes marinées, oignons'),
      d('b4', 'Alloco', 1000, '🍌', 'Accompagnements', 'Bananes plantains frites'),
      d('b5', 'Boisson gazeuse', 1000, '🥤', 'Boissons', '33 cl'),
    ],
    reviews: [{ name: 'Sènan H.', stars: 4, text: 'Le poulet braisé est bien assaisonné.' }],
  },
  {
    id: 'r4', name: 'Saveurs du Bénin', emoji: '🥘', bg: 'linear-gradient(135deg,#14532d,#16a34a)', cats: ['beninois', 'africain'],
    tags: ['Béninois', 'Traditionnel'], rating: 4.7, nrev: 124, lat: 6.3528, lng: 2.4312, from: '09:00', to: '21:00', open: true,
    address: 'Ganhi, près du marché', phone: '+229 01 94 44 55 66',
    menu: [
      d('s1', 'Wassa-wassa + poisson', 2000, '🥘', 'Plats', 'Couscous d\'igname, sauce et poisson', true),
      d('s2', 'Ayimolou', 1500, '🍚', 'Plats', 'Riz et haricots, sauce tomate et piment', true),
      d('s3', 'Fromage peulh frit (wagashi)', 1500, '🧀', 'Plats', 'Wagashi frit, piment'),
      d('s4', 'Sauce feuille + pâte blanche', 2000, '🥬', 'Plats', 'Sauce légumes-feuilles, viande, pâte de maïs'),
      d('s5', 'Bissap', 500, '🧃', 'Boissons', 'Jus d\'hibiscus'),
    ],
    reviews: [{ name: 'Mariam B.', stars: 5, text: 'Le meilleur ayimolou de Cotonou !' }],
  },
  {
    id: 'r5', name: 'Pizza Marina', emoji: '🍕', bg: 'linear-gradient(135deg,#1e3a8a,#e11d48)', cats: ['pizza', 'fastfood', 'boissons'],
    tags: ['Pizza', 'Italien'], rating: 4.3, nrev: 64, lat: 6.3585, lng: 2.3875, from: '11:30', to: '23:00', open: true,
    address: 'Haie Vive, rue des Cocotiers', phone: '+229 01 93 55 66 77',
    menu: [
      d('p1', 'Pizza Margherita', 5000, '🍕', 'Pizzas', 'Tomate, mozzarella, basilic', true),
      d('p2', 'Pizza Reine', 6500, '🍕', 'Pizzas', 'Jambon, champignons, mozzarella'),
      d('p3', 'Pizza poulet', 7000, '🍕', 'Pizzas', 'Poulet, poivrons, oignons', true),
      d('p4', 'Calzone', 6500, '🥟', 'Pizzas', 'Pizza fermée, jambon, œuf'),
      d('p5', 'Boisson gazeuse', 1000, '🥤', 'Boissons', '33 cl'),
    ],
    reviews: [{ name: 'Lionel K.', stars: 4, text: 'Bonne pâte, livraison rapide à Haie Vive.' }],
  },
  {
    id: 'r6', name: 'Burger Express', emoji: '🍔', bg: 'linear-gradient(135deg,#713f12,#f59e0b)', cats: ['burger', 'fastfood', 'boissons'],
    tags: ['Burger', 'Fast-food'], rating: 4.1, nrev: 88, lat: 6.3705, lng: 2.4255, from: '10:00', to: '00:00', open: true,
    address: 'Saint-Michel, face au stade', phone: '+229 01 92 66 77 88',
    menu: [
      d('e1', 'Burger classique', 3000, '🍔', 'Burgers', 'Bœuf, salade, tomate, oignons', true),
      d('e2', 'Cheese burger', 3500, '🍔', 'Burgers', 'Bœuf, cheddar fondu', true),
      d('e3', 'Burger poulet', 3500, '🍔', 'Burgers', 'Poulet pané, mayonnaise'),
      d('e4', 'Chawarma', 2500, '🌯', 'Burgers', 'Poulet, crudités, sauce blanche'),
      d('e5', 'Frites', 1000, '🍟', 'Accompagnements', 'Portion moyenne'),
      d('e6', 'Milkshake vanille', 1500, '🥤', 'Boissons', '40 cl'),
    ],
    reviews: [{ name: 'Fiacre T.', stars: 4, text: 'Le chawarma est généreux.' }],
  },
  {
    id: 'r7', name: 'Mama Africa', emoji: '🍚', bg: 'linear-gradient(135deg,#4c1d95,#c026d3)', cats: ['africain'],
    tags: ['Africain', 'Ouest-africain'], rating: 4.4, nrev: 51, lat: 6.3683, lng: 2.4048, from: '07:00', to: '15:00', open: true,
    address: 'Gbégamey, rue de la pharmacie', phone: '+229 01 91 77 88 99',
    menu: [
      d('a1', 'Riz gras (jollof)', 2500, '🍚', 'Plats', 'Riz cuit dans la sauce tomate, viande', true),
      d('a2', 'Thiéboudiène', 4000, '🐟', 'Plats', 'Riz au poisson à la sénégalaise'),
      d('a3', 'Garba', 1500, '🐟', 'Plats', 'Attiéké, thon frit, piment', true),
      d('a4', 'Kédjénou de poulet', 4000, '🍲', 'Plats', 'Poulet mijoté aux légumes'),
    ],
    reviews: [],
  },
];
const SEED_USERS = [
  { id: 'u_kofi', name: 'Koffi Mensah', phone: '+229 01 97 12 34 56', email: '', role: 'client' },
  { id: 'u_r1', name: 'Gérant Délice Africain', phone: '+229 01 97 00 11 22', email: '', role: 'resto', rid: 'r1' },
  { id: 'u_issa', name: 'Issa ADAM', phone: '+229 01 96 45 78 90', email: '', role: 'driver' },
  { id: 'u_admin', name: 'Administrateur', phone: '+229 01 90 00 00 00', email: '', role: 'admin' },
];

/* ---------- Stockage (DB démo) ---------- */
const KEY = 'foodconnect_v1';
function fresh() {
  return {
    v: 1, seq: 1025, users: JSON.parse(JSON.stringify(SEED_USERS)), restos: JSON.parse(JSON.stringify(SEED_RESTOS)),
    orders: [], session: null, cart: null, address: null, addresses: [], fav: [], driverOnline: true,
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || S.v !== 1) S = fresh();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
window.addEventListener('storage', e => { if (e.key === KEY) { try { S = JSON.parse(e.newValue) || S; } catch (x) { } render(); } });

const me = () => S.session && S.users.find(u => u.id === S.session.uid) || null;
const resto = id => S.restos.find(r => r.id === id);
const order = id => S.orders.find(o => String(o.id) === String(id));
const userOf = id => S.users.find(u => u.id === id);
const here = () => S.address || CENTER;
function isOpen(r) {
  if (!r.open) return false;
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  const [fh, fm] = r.from.split(':').map(Number), [th, tm] = r.to.split(':').map(Number);
  const a = fh * 60 + fm; let b = th * 60 + tm; if (b === 0) b = 1440;
  return b > a ? m >= a && m < b : m >= a || m < b;
}

/* ---------- Interface : toast, confirmation, cartes ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
function sheet(html) {
  closeSheet();
  const o = document.createElement('div'); o.className = 'ov'; o.id = 'ov';
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.addEventListener('click', e => { if (e.target === o) closeSheet(); });
  document.body.appendChild(o);
}
function closeSheet() { const o = $('#ov'); if (o) o.remove(); }
function ask(title, text, yes = 'Oui', danger = false) {
  return new Promise(res => {
    window.__ans = v => { closeSheet(); res(v); };
    sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="gap"></div>
      <div class="row"><button class="btn w" onclick="__ans(false)">Annuler</button><button class="btn ${danger ? 'r' : ''}" onclick="__ans(true)">${esc(yes)}</button></div>`);
  });
}

let maps = [], timers = [];
const TILE = dark => `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`;
function mkMap(id, center, zoom = 14, dark = false) {
  const el = document.getElementById(id);
  if (!el || !window.L) { if (el) el.innerHTML = '<div class="pad muted sm" style="padding-top:40px;text-align:center">Carte indisponible hors connexion</div>'; return null; }
  const m = L.map(el, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer(TILE(dark), { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }).addTo(m);
  m.attributionControl.setPrefix('');
  maps.push(m); return m;
}
const mk = (cls, html = '') => window.L && L.divIcon({ className: '', html: `<div class="mk ${cls}">${html}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
function fit(m, pts) { if (m && pts.length > 1) m.fitBounds(pts.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 }); }

/* ---------- Commandes ---------- */
const STATUS = {
  nouvelle: ['Nouvelle', 'b-new'], acceptee: ['En préparation', 'b-acc'], prete: ['Prête', 'b-ready'],
  en_route: ['En livraison', 'b-route'], livree: ['Livrée', 'b-done'], refusee: ['Refusée', 'b-ref'],
};
const badge = s => `<span class="badge ${STATUS[s][1]}">${STATUS[s][0]}</span>`;
const obadge = o => o.wa && o.status === 'nouvelle' ? '<span class="badge b-done">Envoyée WhatsApp</span>' : badge(o.status);
function setStatus(o, s) {
  o.status = s; o.t = o.t || {};
  o.t[{ acceptee: 'accepted', prete: 'ready', en_route: 'picked', livree: 'delivered', refusee: 'refused' }[s]] = Date.now();
  if (s === 'acceptee' && !o.eta) o.eta = Date.now() + 35 * 60000;
  save();
}
function driverPos(o) {
  const r = resto(o.rid), c = o.address;
  if (o.live && Date.now() - o.live.t < 60000) return o.live;
  if (o.status === 'en_route') {
    const f = Math.min(1, (Date.now() - (o.t.picked || Date.now())) / DEMO_TRIP_MS);
    return { lat: r.lat + (c.lat - r.lat) * f, lng: r.lng + (c.lng - r.lng) * f };
  }
  if (o.status === 'livree') return c;
  return { lat: r.lat + 0.004, lng: r.lng - 0.003 };
}
function etaTxt(o) {
  if (o.status === 'en_route') {
    const left = Math.max(1, Math.round((DEMO_TRIP_MS - (Date.now() - o.t.picked)) / 60000));
    return `${kmTxt(km(driverPos(o), o.address))} • ${left} min`;
  }
  return o.eta ? 'vers ' + hhmm(o.eta) : '';
}

/* ---------- Routeur ---------- */
const go = h => { location.hash = h; };
const back = fb => { if (history.length > 1) history.back(); else go(fb || '#/'); };
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, qs] = h.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function spaceHome(u = me()) {
  if (!u) return '#/home';
  return { resto: '#/rd/dash', driver: '#/dv', admin: '#/ad/home' }[u.role] || '#/home';
}
function bottomNav(cur) {
  const n = S.orders.filter(o => me() && o.cid === me().id && !o.wa && !['livree', 'refusee'].includes(o.status)).length;
  const it = (k, h, icn, label) => `<a href="${h}" class="${cur === k ? 'on' : ''}">${ic(icn, 22)}${label}${k === 'orders' && n ? `<span class="dot">${n}</span>` : ''}</a>`;
  return `<nav class="nav"><div>${it('home', '#/home', 'home', 'Accueil')}${it('explore', '#/explore', 'search', 'Explorer')}${it('orders', '#/orders', 'receipt', 'Commandes')}${it('account', '#/account', 'user', 'Compte')}</div></nav>`;
}

function render() {
  maps.forEach(m => m.remove()); maps = []; timers.forEach(clearInterval); timers = []; closeSheet();
  const { parts, q } = parse(); const [r, id] = parts;
  if (!r) { if (S.session) return go(spaceHome()); }
  const view = (V[r] || V.splash)(id, q);
  if (!view) return;
  const app = $('#app');
  app.innerHTML = view.h + (view.nav ? bottomNav(view.nav) : '');
  document.body.style.background = view.dark ? 'var(--dark)' : 'var(--bg)';
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = view.dark || r === undefined || r === 'splash' ? '#14100d' : '#f7f5f3';
  if (!view.keepScroll) window.scrollTo(0, 0);
  view.after && view.after();
}
window.addEventListener('hashchange', render);

/* ---------- Actions globales ---------- */
const A = window.A = {
  guest() { S.session = null; S.guest = true; save(); go('#/home'); },
  social(n) { toast(`Connexion avec ${n} : disponible quand Firebase sera branché.`); },
  togglePass(b) { const i = b.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; },
  async register(e) {
    e.preventDefault(); const f = e.target;
    const name = f.name.value.trim(), phone = normPhone(f.phone.value), email = f.email.value.trim(), pass = f.pass.value;
    if (name.length < 2) return toast('Entre ton nom complet.');
    if (!phone) return toast('Numéro invalide : 10 chiffres, ex. 01 97 12 34 56.');
    if (pass.length < 6) return toast('Le mot de passe doit avoir au moins 6 caractères.');
    if (S.users.some(u => u.phone === phone && u.pass)) return toast('Ce numéro a déjà un compte. Connecte-toi.');
    const u = { id: uid('u_'), name, phone, email, role: 'client', pass: await hash(pass), created: Date.now() };
    S.users.push(u); S.session = { uid: u.id, base: u.id }; S.guest = false; save();
    toast('Bienvenue ' + name.split(' ')[0] + ' !');
    const nxt = S.after; S.after = null; save(); go(nxt || '#/home');
  },
  async login(e) {
    e.preventDefault(); const f = e.target;
    const phone = normPhone(f.phone.value), h = await hash(f.pass.value);
    const u = phone && S.users.find(x => x.phone === phone && x.pass === h);
    if (!u) return toast('Numéro ou mot de passe incorrect.');
    S.session = { uid: u.id, base: u.id }; S.guest = false; save();
    const nxt = S.after; S.after = null; save(); go(nxt || spaceHome(u));
  },
  async logout() {
    if (!await ask('Se déconnecter ?', 'Tu pourras te reconnecter avec ton numéro et ton mot de passe.', 'Se déconnecter', true)) return;
    S.session = null; S.guest = false; S.cart = null; save(); go('#/splash');
  },
  space(role, rid) {
    if (role === 'resto' && !rid) {
      const last = S.orders.find(o => !['livree', 'refusee'].includes(o.status));
      return sheet(`<h3>Quel restaurant gérer ?</h3><p class="muted sm">Démo : choisis le restaurant dont tu veux voir les commandes.</p>
        <div class="lm" style="max-height:55vh;overflow:auto">${visibleRestos().map(r => `<button onclick="A.space('resto','${r.id}')"><span style="font-size:24px">${r.emoji}</span><span class="sp">${esc(r.name)}${last && last.rid === r.id ? '<div class="sm" style="color:var(--pri)">Ta dernière commande est ici</div>' : ''}</span>${ic('chev', 18)}</button>`).join('')}</div>`);
    }
    if (rid) { const g = userOf('u_r1'); g.rid = rid; g.name = 'Gérant ' + resto(rid).name; }
    const target = { resto: 'u_r1', driver: 'u_issa', admin: 'u_admin' }[role];
    if (!S.session) S.session = { uid: null, base: null };
    if (role === 'client') { S.session.uid = S.session.base; if (!S.session.base) S.session = null; }
    else S.session.uid = target;
    save(); go(role === 'client' ? '#/account' : spaceHome(userOf(target)));
  },
  cat(c) { S.cat = c; save(); render(); },
  fav(rid) { S.fav = S.fav.includes(rid) ? S.fav.filter(x => x !== rid) : [...S.fav, rid]; save(); render(); },
  async add(rid, did, delta, who) {
    const r = resto(rid);
    if (!isOpen(r) && delta > 0) return toast('Ce restaurant est fermé pour le moment.');
    if (S.cart && S.cart.rid !== rid && delta > 0) {
      if (!await ask('Nouveau panier ?', `Ton panier contient des plats de ${resto(S.cart.rid).name}. On le vide pour commander ici ?`, 'Vider et ajouter')) return;
      S.cart = null;
    }
    if (!S.cart) { S.cart = { rid, items: {} }; if (S.groupNext) { S.groupNext = false; startGroup(); } }
    const k = ckey(did, who);
    const q = (S.cart.items[k] || 0) + delta;
    if (q <= 0) delete S.cart.items[k]; else S.cart.items[k] = q;
    if (!Object.keys(S.cart.items).length) S.cart = null;
    save(); const y = window.scrollY; render(); window.scrollTo(0, y);
  },
  groupStart() {
    if (!S.cart) { S.groupNext = true; save(); toast('Choisis un restaurant : chaque personne ajoute ses plats.'); return go('#/explore'); }
    startGroup(); save(); render();
  },
  groupStop() {
    const it = {}; Object.entries(S.cart.items).forEach(([k, q]) => { const d = k.split('|')[0]; it[d] = (it[d] || 0) + q; });
    S.cart.items = it; delete S.cart.group; delete S.cart.people; delete S.cart.who; save(); render();
  },
  who(name) { S.cart.who = name; save(); const y = scrollY; render(); scrollTo(0, y); },
  addPerson() {
    sheet(`<h3>Ajouter une personne</h3><p class="muted sm">Son prénom, pour savoir qui a pris quoi et combien chacun paie.</p>
      <form onsubmit="event.preventDefault();A.savePerson(this.n.value)"><div class="field">${ic('user', 20)}<input name="n" placeholder="Ex : Awa" maxlength="20" required></div><button class="btn">Ajouter</button></form>`);
    setTimeout(() => { const i = document.querySelector('#ov input'); if (i) i.focus(); }, 50);
  },
  savePerson(n) {
    n = n.trim().replace(/[|]/g, ''); if (!n) return;
    if (S.cart.people.includes(n)) return toast('Ce prénom est déjà dans la liste.');
    S.cart.people.push(n); S.cart.who = n; save(); closeSheet(); toast(`Ajoute maintenant les plats de ${n}.`); render();
  },
  cmp(rid) {
    S.cmp = S.cmp || [];
    if (S.cmp.includes(rid)) S.cmp = S.cmp.filter(x => x !== rid);
    else { if (S.cmp.length >= 3) return toast('3 restaurants maximum. Retire-en un d\'abord.'); S.cmp.push(rid); }
    save(); render();
  },
  async clearCart() { if (await ask('Vider le panier ?', 'Tous les plats seront retirés.', 'Vider', true)) { S.cart = null; save(); render(); } },
  checkout() {
    if (!me() || me().role !== 'client') { S.after = '#/address?next=pay'; save(); toast('Crée ton compte pour commander.'); return go('#/register'); }
    go('#/address?next=pay');
  },
  pay(m) { S.payMethod = m; save(); document.querySelectorAll('.pm').forEach(b => b.classList.toggle('on', b.dataset.m === m)); const x = $('#mmphone'); if (x) x.style.display = m === 'cash' ? 'none' : ''; },
  sendWa(id) { const o = order(id); if (o) openExt(waHref(ORDER_WA, orderText(o))); },
  async confirmPay() {
    const u = me(), c = S.cart; if (!u || !c) return go('#/home');
    const m = S.payMethod || 'mtn';
    let num = null;
    if (m !== 'cash' && !WA_MODE) { num = normPhone($('#mmnum').value); if (!num) return toast('Numéro Mobile Money invalide.'); }
    const r = resto(c.rid), items = cartItems();
    const sub = items.reduce((s, i) => s + i.price * i.qty, 0), fee = deliveryFee(km(r, here()));
    const names = { mtn: 'MTN Mobile Money', moov: 'Moov Money', celtiis: 'Celtiis Cash', cash: 'Espèces à la livraison' };
    let label = WA_MODE && m !== 'cash' ? names[m] + ' (après confirmation)' : names[m], paidOnline = false;
    if (WA_MODE && FEDAPAY_PUBLIC_KEY && m !== 'cash') {
      let t = null;
      try { t = await fedapayPay(sub + fee, u, `FoodConnect — ${r.name}`); }
      catch (x) { return toast('Paiement indisponible. Vérifie ta connexion internet.'); }
      if (!t) return toast('Paiement non effectué. Tu peux réessayer ou choisir « Espèces ».');
      label = `${names[m]} — PAYÉ en ligne (transaction ${t.id})`; paidOnline = true;
    }
    if (m !== 'cash' && !WA_MODE) {
      sheet(`<div style="text-align:center"><div class="spin"></div><h3>Confirme sur ton téléphone</h3>
        <p class="muted">Une demande de paiement de <b>${F(sub + fee)}</b> est envoyée au ${esc(num)} (${label}).<br>Valide avec ton code secret.</p>
        <p class="sm muted">Démo : le paiement est simulé, aucun argent n'est débité.</p></div>`);
      await new Promise(res => setTimeout(res, 2600));
    }
    const o = {
      id: S.seq++, cid: u.id, cname: u.name, cphone: u.phone, rid: r.id, rname: r.name,
      items: items.map(i => ({ name: i.name, price: i.price, qty: i.qty, emoji: i.emoji, who: i.who })),
      group: !!c.group, split: c.group ? groupSplit(items, fee) : null,
      sub, fee, total: sub + fee, commission: Math.round(sub * COMMISSION),
      address: { ...here() }, pay: { method: m, label, phone: num, paid: paidOnline || (m !== 'cash' && !WA_MODE) },
      status: 'nouvelle', t: { created: Date.now() }, driver: null, wa: WA_MODE,
    };
    S.orders.unshift(o); S.cart = null; save(); closeSheet();
    if (WA_MODE) { go('#/track/' + o.id); setTimeout(() => A.sendWa(o.id), 300); return; }
    toast(m === 'cash' ? 'Commande envoyée au restaurant !' : 'Paiement reçu, commande envoyée !');
    go('#/track/' + o.id);
  },
  demoNext(id) {
    const o = order(id); if (!o) return;
    const nx = { nouvelle: 'acceptee', acceptee: 'prete', prete: 'en_route', en_route: 'livree' }[o.status];
    if (!nx) return;
    if (nx === 'en_route' && !o.driver) o.driver = 'u_issa';
    if (nx === 'prete' && !o.driver) o.driver = 'u_issa';
    setStatus(o, nx); render();
  },
  rate(id, n) {
    const o = order(id), r = resto(o.rid); if (o.rated) return;
    o.rated = n; r.reviews.unshift({ name: o.cname.split(' ')[0] + ' ' + (o.cname.split(' ')[1] || '').slice(0, 1) + '.', stars: n, text: '' });
    r.rating = Math.round(((r.rating * r.nrev) + n) / (r.nrev + 1) * 10) / 10; r.nrev++;
    save(); toast('Merci pour ta note !'); render();
  },
  async cancel(id) {
    const o = order(id);
    if (o.status !== 'nouvelle') return toast('Le restaurant a déjà accepté la commande.');
    if (!await ask('Annuler la commande ?', o.pay.paid ? 'Tu seras remboursé sur ton compte Mobile Money.' : 'Le restaurant sera prévenu.', 'Annuler la commande', true)) return;
    setStatus(o, 'refusee'); o.cancelled = true; save(); render();
  },
  // restaurant
  rAccept(id) { setStatus(order(id), 'acceptee'); toast('Commande acceptée.'); render(); },
  async rRefuse(id) { if (await ask('Refuser la commande ?', 'Le client sera prévenu et remboursé.', 'Refuser', true)) { setStatus(order(id), 'refusee'); render(); } },
  rReady(id) { setStatus(order(id), 'prete'); toast('Les livreurs sont prévenus.'); render(); },
  rOpen() { const r = resto(me().rid); r.open = !r.open; save(); render(); },
  rDish(did) { const r = resto(me().rid), x = r.menu.find(m => m.id === did); x.off = !x.off; save(); const y = scrollY; render(); scrollTo(0, y); },
  rEdit(did) {
    const r = resto(me().rid), x = did ? r.menu.find(m => m.id === did) : { name: '', price: '', emoji: '🍛', section: 'Plats', desc: '' };
    sheet(`<h3>${did ? 'Modifier le plat' : 'Ajouter un plat'}</h3><div class="gap"></div>
      <form onsubmit="A.rSave(event,'${did || ''}')">
      <div class="lbl">Nom du plat</div><div class="field"><input name="name" required value="${esc(x.name)}" placeholder="Ex : Riz au poulet"></div>
      <div class="row"><div class="sp"><div class="lbl">Prix (F CFA)</div><div class="field"><input name="price" required inputmode="numeric" value="${esc(x.price)}" placeholder="3000"></div></div>
      <div style="width:90px"><div class="lbl">Icône</div><div class="field"><select name="emoji">${['🍛', '🍲', '🍝', '🐟', '🍗', '🍢', '🥘', '🍚', '🥬', '🧀', '🍕', '🍔', '🌯', '🍟', '🍌', '🥣', '🥗', '🧃', '🥤', '💧', '🍰'].map(e => `<option ${e === x.emoji ? 'selected' : ''}>${e}</option>`).join('')}</select></div></div></div>
      <div class="lbl">Catégorie</div><div class="field"><input name="section" value="${esc(x.section)}" placeholder="Plats, Boissons…"></div>
      <div class="lbl">Description</div><div class="field"><input name="desc" value="${esc(x.desc)}" placeholder="Ingrédients, portion…"></div>
      <div class="lbl">Photo du plat</div><label class="field" style="cursor:pointer">${x.photo ? `<span class="pic" style="width:44px;height:44px;border-radius:10px;background:center/cover url('${esc(x.photo)}')"></span>` : ic('plus', 20)}<span class="sp" style="padding:15px 0">${x.photo ? 'Changer la photo' : 'Prendre ou choisir une photo'}</span><input name="photo" type="file" accept="image/*" style="display:none" onchange="this.previousElementSibling.textContent='Photo choisie ✓'"></label>
      <button class="btn">Enregistrer</button></form>`);
  },
  async rSave(e, did) {
    e.preventDefault(); const f = e.target, r = resto(me().rid);
    let photo = null;
    if (f.photo.files[0]) { try { photo = await shrink(f.photo.files[0]); } catch (x) { return toast('Photo illisible, essaie une autre.'); } }
    const price = parseInt(String(f.price.value).replace(/\D/g, ''), 10);
    if (!price) return toast('Prix invalide.');
    const v = { name: f.name.value.trim(), price, emoji: f.emoji.value, section: f.section.value.trim() || 'Plats', desc: f.desc.value.trim() };
    if (photo) v.photo = photo;
    if (did) Object.assign(r.menu.find(m => m.id === did), v); else r.menu.push({ id: uid('m'), off: false, popular: false, ...v });
    save(); if (photo && !localStorage.getItem(KEY)) toast('Mémoire pleine : photo trop lourde.'); else toast('Menu mis à jour.'); closeSheet(); render();
  },
  // livreur
  dOnline() { S.driverOnline = !S.driverOnline; save(); render(); },
  dTake(id) {
    const o = order(id);
    if (o.driver) return toast('Un autre livreur a déjà pris cette course.');
    o.driver = me().id; o.t.assigned = Date.now(); save(); go('#/dc/' + id);
  },
  dPicked(id) { const o = order(id); if (o.status !== 'prete') return toast('Le restaurant prépare encore la commande.'); setStatus(o, 'en_route'); render(); },
  async dDone(id) {
    const o = order(id);
    if (!await ask('Commande livrée ?', o.pay.paid ? 'Confirme que le client a reçu sa commande.' : `Encaisse ${F(o.total)} en espèces avant de confirmer.`, 'Oui, livrée')) return;
    setStatus(o, 'livree'); toast('Bravo, livraison terminée !'); go('#/dv');
  },
  navTo(lat, lng) { openExt(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`); },
  // admin
  aResto(rid) { const r = resto(rid); r.suspended = !r.suspended; save(); render(); },
  async reset() {
    if (!await ask('Réinitialiser la démo ?', 'Toutes les commandes et comptes créés sur ce téléphone seront effacés.', 'Réinitialiser', true)) return;
    S = fresh(); save(); go('#/splash');
  },
};

const ckey = (did, who) => S.cart && S.cart.group ? did + '|' + (who || S.cart.who) : did;
function startGroup() {
  const me1 = (me() && me().name.split(' ')[0]) || 'Moi';
  const it = {}; Object.entries(S.cart.items).forEach(([k, q]) => { it[k.split('|')[0] + '|' + me1] = q; });
  Object.assign(S.cart, { group: true, people: [me1], who: me1, items: it });
}
function cartItems() {
  if (!S.cart) return [];
  const r = resto(S.cart.rid);
  return Object.entries(S.cart.items).map(([k, qty]) => { const [id, who] = k.split('|'); return { ...r.menu.find(m => m.id === id), qty, who }; }).filter(i => i.name);
}
// Part de chacun : ses plats + la livraison divisée entre les personnes qui ont commandé
function groupSplit(items, fee) {
  const out = {}, ppl = [...new Set(items.map(i => i.who))];
  ppl.forEach(w => { out[w] = items.filter(i => i.who === w).reduce((s, i) => s + i.qty * i.price, 0) + Math.ceil(fee / ppl.length / 25) * 25; });
  return out;
}
const pic = (m, st = '') => m.photo ? `<div class="pic" style="background:center/cover url('${esc(m.photo)}');${st}"></div>` : `<div class="pic" style="${st}">${m.emoji}</div>`;
function shrink(file, max = 520) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const im = new Image(); im.onerror = rej;
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
const etaMin = d => Math.round(20 + d * 4);
const isDrink = m => /boisson/i.test(m.section);
const cartCount = () => cartItems().reduce((s, i) => s + i.qty, 0);
const cartSub = () => cartItems().reduce((s, i) => s + i.qty * i.price, 0);
const visibleRestos = () => S.restos.filter(r => !r.suspended);

function stars(n) { return `<span class="stars">★ ${String(n).replace('.', ',')}</span>`; }
function restoCard(r) {
  const dist = km(r, here()), op = isOpen(r);
  return `<a class="rc ${op ? '' : 'closed'}" href="#/resto/${r.id}">
    <div class="rimg" style="background:${r.bg}">${r.emoji}</div>
    <div class="sp"><b>${esc(r.name)}</b>
      <div class="sm">${stars(r.rating)} <span class="muted">(${r.nrev} avis)</span></div>
      <div class="sm muted">${kmTxt(dist)} • ${op ? `<span class="ok">Ouvert</span>` : `<span class="ko">Fermé</span>`} • Livraison ${F(deliveryFee(dist))}</div>
    </div>${ic('chev', 20)}</a>`;
}

/* ---------- Écrans ---------- */
const V = {};

V.splash = () => ({
  h: `<div class="splash">
    <div class="logo">${hat(70)}${wordmark()}<div style="opacity:.85;margin-top:6px">Les meilleurs restaurants<br>près de chez vous</div></div>
    <div class="plate">🍛<small>🌶️🍗🥘</small></div>
    <div class="acts">
      <a class="btn" href="#/login">Se connecter</a>
      <a class="btn w" href="#/register">Créer un compte</a>
      <button class="link" onclick="A.guest()">Continuer sans compte</button>
    </div></div>`,
});

function authHead(t) { return `<div class="top"><button class="ib" onclick="back('#/splash')">${ic('back')}</button></div>
  <div class="pad" style="text-align:center">${hat(52)}<div>${wordmark().replace('wm"', 'wm" style="font-size:28px"')}</div><h2 style="font-size:18px;margin:6px 0 22px">${t}</h2></div>`; }
const socialBtns = () => `<div class="row" style="margin:16px 0;color:var(--mute);font-size:13px"><hr class="sp" style="border:0;border-top:1px solid var(--line)">ou<hr class="sp" style="border:0;border-top:1px solid var(--line)"></div>
  <button type="button" class="btn w" onclick="A.social('Google')"><b style="color:#4285f4">G</b> Continuer avec Google</button><div style="height:10px"></div>
  <button type="button" class="btn w" onclick="A.social('Facebook')"><b style="color:#1877f2">f</b> Continuer avec Facebook</button>`;

V.register = () => ({
  h: `<div class="scr">${authHead('Créez votre compte')}<form class="pad" onsubmit="A.register(event)" autocomplete="on">
    <div class="field">${ic('user', 20)}<input name="name" placeholder="Nom complet" autocomplete="name" required></div>
    <div class="field">${ic('phone', 20)}<input name="phone" type="tel" inputmode="tel" placeholder="Numéro de téléphone" autocomplete="tel" required></div>
    <div class="field">${ic('mail', 20)}<input name="email" type="email" placeholder="Email (optionnel)" autocomplete="email"></div>
    <div class="field">${ic('lock', 20)}<input name="pass" type="password" placeholder="Mot de passe" autocomplete="new-password" required><button type="button" class="ib" style="box-shadow:none;width:32px;height:32px" onclick="A.togglePass(this)">${ic('eye', 20)}</button></div>
    <button class="btn">S'inscrire</button>${socialBtns()}
    <p style="text-align:center" class="sm muted">Vous avez déjà un compte ? <a href="#/login" style="color:var(--pri);font-weight:700">Se connecter</a></p>
  </form></div>`,
});

V.login = () => ({
  h: `<div class="scr">${authHead('Connexion')}<form class="pad" onsubmit="A.login(event)">
    <div class="field">${ic('phone', 20)}<input name="phone" type="tel" inputmode="tel" placeholder="Numéro de téléphone" autocomplete="tel" required></div>
    <div class="field">${ic('lock', 20)}<input name="pass" type="password" placeholder="Mot de passe" autocomplete="current-password" required><button type="button" class="ib" style="box-shadow:none;width:32px;height:32px" onclick="A.togglePass(this)">${ic('eye', 20)}</button></div>
    <button class="btn">Se connecter</button>${socialBtns()}
    <p style="text-align:center" class="sm muted">Pas encore de compte ? <a href="#/register" style="color:var(--pri);font-weight:700">Créer un compte</a></p>
  </form></div>`,
});

function cartBar() {
  const n = cartCount(); if (!n) return '';
  return `<div class="fixb" style="bottom:calc(58px + var(--bot));border:0;background:transparent;padding-bottom:8px"><div>
    <a class="btn" href="#/cart">${ic('cart', 20)} Voir le panier (${n}) • ${F(cartSub())}</a></div></div>`;
}

V.home = () => {
  const cat = S.cat || 'tous';
  const list = visibleRestos().filter(r => cat === 'tous' || r.cats.includes(cat))
    .sort((a, b) => (isOpen(b) - isOpen(a)) || km(a, here()) - km(b, here()));
  const u = me();
  const best = visibleRestos().filter(isOpen).sort((a, b) => b.rating - a.rating)
    .flatMap(r => r.menu.filter(m => m.popular && !m.off).map(m => ({ r, m }))).sort((a, b) => (!!b.m.photo - !!a.m.photo)).slice(0, 10);
  return {
    nav: 'home',
    h: `<div class="scr"><div class="top" style="flex-direction:column;align-items:stretch;gap:12px">
      <div class="row"><button class="addr sp" onclick="go('#/address')">${ic('pin', 20)}<span>${esc(here().label)}</span>${ic('down', 18)}</button>
      ${u ? `<a class="ib" href="#/account"><b style="color:var(--pri)">${esc(u.name[0])}</b></a>` : `<a href="#/login" class="sm" style="color:var(--pri);font-weight:700">Connexion</a>`}</div>
      <form class="search" onsubmit="event.preventDefault();go('#/explore?q='+encodeURIComponent(this.q.value))">${ic('search', 20)}<input name="q" placeholder="Rechercher un restaurant, un plat…"></form></div>
      <div class="pad">
      <div class="banner"><div class="sp"><h3>Des plats délicieux à portée de main</h3><p>Commandez maintenant, payez par Mobile Money.</p><button onclick="go('#/explore')">Voir les restaurants</button></div><div class="em">🍲</div></div>
      <div class="quick">
        <a href="#/budget">💰<b>Mon budget</b><span>Plats selon mon argent</span></a>
        <a href="#/compare">⚖️<b>Comparer</b><span>Prix, notes, délais</span></a>
        <a href="#" onclick="event.preventDefault();A.groupStart()">👥<b>En groupe</b><span>Chacun choisit, on partage</span></a>
      </div>
      ${best.length ? `<div class="h2">Les meilleurs plats</div><div class="best">${best.map(({ r, m }) => `<a href="#/resto/${r.id}">${pic(m, 'width:100%;height:104px;font-size:54px;border-radius:14px')}<b>${esc(m.name)}</b><span class="sm muted">${esc(r.name)}</span><span class="p">${F(m.price)}</span></a>`).join('')}</div>` : ''}
      <div class="cats">${CATS.map(([k, l, e]) => `<button class="cat ${cat === k ? 'on' : ''}" onclick="A.cat('${k}')"><i>${e}</i>${l}</button>`).join('')}</div>
      <div class="h2">Restaurants à proximité <a href="#/explore">Voir tout</a></div>
      ${list.map(restoCard).join('') || '<p class="muted">Aucun restaurant dans cette catégorie pour le moment.</p>'}
      </div>${cartBar()}</div>`,
  };
};

V.explore = (_, q) => {
  const term = (q.q || '').toLowerCase().trim(), f = S.filter || {};
  let list = visibleRestos().filter(r => !term || r.name.toLowerCase().includes(term) || r.tags.join(' ').toLowerCase().includes(term) || r.menu.some(m => m.name.toLowerCase().includes(term)));
  if (f.open) list = list.filter(isOpen);
  list.sort(f.sort === 'note' ? (a, b) => b.rating - a.rating : (a, b) => km(a, here()) - km(b, here()));
  window.__filt = (k, v) => { S.filter = { ...f, [k]: v }; save(); render(); };
  return {
    nav: 'explore',
    h: `<div class="scr"><div class="top"><form class="search sp" onsubmit="event.preventDefault();go('#/explore?q='+encodeURIComponent(this.q.value))">${ic('search', 20)}<input name="q" value="${esc(q.q || '')}" placeholder="Rechercher un restaurant, un plat…"></form></div>
      <div class="pad"><div class="map" id="m-exp"></div>
      <div class="chips" style="margin:12px 0 6px">
        <button class="chip ${f.open ? 'on' : ''}" onclick="__filt('open',${!f.open})">${ic('clock', 16)} Ouvert maintenant</button>
        <button class="chip ${f.sort !== 'note' ? 'on' : ''}" onclick="__filt('sort','dist')">${ic('pin', 16)} Distance</button>
        <button class="chip ${f.sort === 'note' ? 'on' : ''}" onclick="__filt('sort','note')">${ic('star', 16)} Mieux notés</button>
        <a class="chip" href="#/budget" style="text-decoration:none">💰 Budget</a>
        <a class="chip" href="#/compare" style="text-decoration:none">⚖️ Comparer</a>
      </div>
      ${term ? `<p class="sm muted">${list.length} résultat(s) pour « ${esc(q.q)} »</p>` : ''}
      ${list.map(restoCard).join('') || '<p class="muted">Aucun résultat.</p>'}</div>${cartBar()}</div>`,
    after() {
      const m = mkMap('m-exp', here(), 13); if (!m) return;
      L.marker([here().lat, here().lng], { icon: mk('mk-me') }).addTo(m);
      list.forEach(r => L.marker([r.lat, r.lng], { icon: mk('mk-r', r.emoji) }).addTo(m).on('click', () => go('#/resto/' + r.id)).bindTooltip(r.name));
      fit(m, [here(), ...list]);
    },
  };
};

V.resto = (id, q) => {
  const r = resto(id); if (!r) return go('#/home');
  const tab = q.tab || 'menu', dist = km(r, here()), op = isOpen(r);
  const inCart = did => S.cart && S.cart.rid === r.id ? S.cart.items[ckey(did)] || 0 : 0;
  const grp = S.cart && S.cart.group && S.cart.rid === r.id;
  const dish = m => `<div class="dish ${m.off ? 'off' : ''}">${pic(m)}
    <div class="sp"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><span class="p">${F(m.price)}</span></div>
    ${m.off ? '<span class="sm muted">Épuisé</span>' : inCart(m.id) ? `<div class="qty"><button onclick="A.add('${r.id}','${m.id}',-1)" aria-label="Retirer">${ic('minus', 18)}</button><span>${inCart(m.id)}</span><button class="add" onclick="A.add('${r.id}','${m.id}',1)" aria-label="Ajouter">${ic('plus', 18)}</button></div>`
      : `<div class="qty"><button class="add" onclick="A.add('${r.id}','${m.id}',1)" aria-label="Ajouter">${ic('plus', 18)}</button></div>`}</div>`;
  const sections = [...new Set(r.menu.map(m => m.section))];
  const pop = r.menu.filter(m => m.popular && !m.off);
  let body = '';
  if (tab === 'menu') {
    body = (pop.length ? `<div class="h2">Plats populaires</div>${pop.map(dish).join('')}` : '') +
      sections.map(s => `<div class="h2">${esc(s)}</div>${r.menu.filter(m => m.section === s && !(m.popular && !m.off)).map(dish).join('')}`).join('').replace(/<div class="h2">[^<]*<\/div>(?=<div class="h2">|$)/g, '');
  } else if (tab === 'avis') {
    body = `<div class="card" style="margin-top:14px;text-align:center"><div style="font-size:34px;font-weight:800">${String(r.rating).replace('.', ',')}</div><div class="stars">${'★'.repeat(Math.round(r.rating))}</div><div class="sm muted">${r.nrev} avis</div></div>
      <div class="card" style="margin-top:12px">${r.reviews.map(v => `<div class="rev"><div class="row"><b class="sp">${esc(v.name)}</b><span class="stars">${'★'.repeat(v.stars)}</span></div>${v.text ? `<div class="sm muted" style="margin-top:4px">${esc(v.text)}</div>` : ''}</div>`).join('') || '<p class="muted">Pas encore d\'avis.</p>'}</div>`;
  } else {
    body = `<div class="lm" style="margin-top:14px">
      <a href="#" onclick="event.preventDefault();A.navTo(${r.lat},${r.lng})">${ic('pin', 20)}<span class="sp">${esc(r.address)}</span>${ic('chev', 18)}</a>
      <a href="${telHref(r.phone)}">${ic('phone', 20)}<span class="sp">${esc(r.phone)}</span></a>
      <div style="display:flex;gap:12px;padding:15px">${ic('clock', 20)}<span>Tous les jours, ${r.from} – ${r.to === '00:00' ? 'minuit' : r.to}</span></div>
      <div style="display:flex;gap:12px;padding:15px">${ic('bike', 20)}<span>Livraison ${F(deliveryFee(dist))} jusqu'à vous (${kmTxt(dist)})</span></div></div>
      <div class="map" id="m-r" style="margin-top:12px;height:200px;min-height:0"></div>`;
  }
  const n = S.cart && S.cart.rid === r.id ? cartCount() : 0;
  return {
    keepScroll: true,
    h: `<div class="scr" style="padding-bottom:${n ? 110 : 30}px"><div class="hero" style="background:${r.bg}">
      <button class="ib" style="left:16px" onclick="back('#/home')">${ic('back')}</button>
      <button class="ib" style="right:16px;color:${S.fav.includes(r.id) ? 'var(--red)' : 'inherit'}" onclick="A.fav('${r.id}')">${S.fav.includes(r.id) ? ic('heart', 22).replace('fill="none"', 'fill="currentColor"') : ic('heart', 22)}</button>${r.emoji}</div>
      <div class="sheet-top"><h1>${esc(r.name)}</h1>
      <div class="sm" style="margin-top:6px">${stars(r.rating)} <span class="muted">(${r.nrev} avis)</span></div>
      <div class="sm muted" style="margin-top:3px">${kmTxt(dist)} • ${op ? `<span class="ok">Ouvert jusqu'à ${r.to === '00:00' ? 'minuit' : r.to.replace(':', 'h')}</span>` : `<span class="ko">Fermé • ouvre à ${r.from.replace(':', 'h')}</span>`}</div>
      <div class="chips" style="margin-top:10px">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="tabs">${[['menu', 'Menu'], ['avis', 'Avis'], ['infos', 'Infos']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="history.replaceState(null,'','#/resto/${r.id}?tab=${k}');render()">${l}</button>`).join('')}</div>
      ${grp && tab === 'menu' ? `<div class="whobar"><span class="sm muted">👥 Tu ajoutes pour :</span><div class="chips">${S.cart.people.map(w => `<button class="chip ${S.cart.who === w ? 'on' : ''}" onclick="A.who('${esc(w).replace(/'/g, '&#39;')}')">${esc(w)}</button>`).join('')}<button class="chip" onclick="A.addPerson()">${ic('plus', 14)} Personne</button></div></div>` : ''}
      ${body}</div></div>
      ${n ? `<div class="fixb"><div><a class="btn" href="#/cart">${ic('cart', 20)} Voir le panier (${n}) • ${F(cartSub())}</a></div></div>` : ''}`,
    after() {
      if (tab !== 'infos') return;
      const m = mkMap('m-r', r, 15); if (!m) return;
      L.marker([r.lat, r.lng], { icon: mk('mk-r', r.emoji) }).addTo(m);
    },
  };
};

V.cart = () => {
  const items = cartItems();
  if (!items.length) return {
    h: `<div class="scr"><div class="top"><button class="ib" onclick="back('#/home')">${ic('back')}</button><h1>Mon panier</h1></div>
    <div class="pad" style="text-align:center;padding-top:60px"><div style="font-size:70px">🛒</div><h3>Ton panier est vide</h3><p class="muted">Choisis un restaurant et ajoute des plats.</p><div class="gap"></div><a class="btn" href="#/home">Voir les restaurants</a></div></div>`,
  };
  const r = resto(S.cart.rid), sub = cartSub(), dist = km(r, here()), fee = deliveryFee(dist), grp = !!S.cart.group;
  const split = grp ? groupSplit(items, fee) : null;
  const line = i => `<div class="dish">${pic(i)}<div class="sp"><b>${esc(i.name)}</b><span class="p">${F(i.price)}</span></div>
      <div class="qty"><button onclick="A.add('${r.id}','${i.id}',-1${i.who ? `,'${esc(i.who).replace(/'/g, '&#39;')}'` : ''})">${ic('minus', 18)}</button><span>${i.qty}</span><button class="add" onclick="A.add('${r.id}','${i.id}',1${i.who ? `,'${esc(i.who).replace(/'/g, '&#39;')}'` : ''})">${ic('plus', 18)}</button></div></div>`;
  return {
    keepScroll: true,
    h: `<div class="scr" style="padding-bottom:120px"><div class="top"><button class="ib" onclick="back('#/home')">${ic('back')}</button><h1>Mon panier<small>${cartCount()} article(s) • ${esc(r.name)}</small></h1><button class="ib" onclick="A.clearCart()" aria-label="Vider">${ic('trash', 20)}</button></div>
    <div class="pad">
      <div class="card row" style="margin-bottom:12px;padding:12px">${ic('users', 22)}<div class="sp"><b>Commande groupée</b><div class="sm muted">${grp ? 'Chacun voit ce qu\'il doit payer' : 'Commander avec des amis et partager la note'}</div></div><button class="sw ${grp ? 'on' : ''}" onclick="A.${grp ? 'groupStop' : 'groupStart'}()" aria-label="Commande groupée"></button></div>
      ${grp ? S.cart.people.map(w => { const mine = items.filter(i => i.who === w); return `<div class="h2" style="margin-top:6px">${esc(w)} <span class="sm muted" style="font-weight:600">${F(mine.reduce((t, i) => t + i.qty * i.price, 0))}</span></div>${mine.map(line).join('') || '<p class="sm muted" style="margin:0 0 10px">Rien pour l\'instant.</p>'}`; }).join('')
        + `<button class="btn ghost" onclick="A.addPerson()">${ic('plus', 18)} Ajouter une personne</button>` : items.map(line).join('')}
      <a href="#/resto/${r.id}" class="btn ghost">${ic('plus', 18)} Ajouter d'autres plats</a>
      ${grp && split ? `<div class="card" style="margin-top:8px"><b>Qui paie combien</b><div class="sm muted" style="margin:2px 0 8px">Ses plats + la livraison partagée</div>${Object.entries(split).map(([w, v]) => `<div class="row sm" style="padding:4px 0"><span class="sp">${esc(w)}</span><b>${F(v)}</b></div>`).join('')}</div>` : ''}
      <div class="card" style="margin-top:8px">
        <div class="row sm"><span class="sp muted">Sous-total</span><span>${F(sub)}</span></div><div style="height:8px"></div>
        <div class="row sm"><span class="sp muted">Livraison (${kmTxt(dist)})</span><span>${F(fee)}</span></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
        <div class="row"><b class="sp">Total</b><b style="font-size:19px">${F(sub + fee)}</b></div></div>
      ${!isOpen(r) ? '<p class="ko sm">Ce restaurant est fermé pour le moment.</p>' : ''}
    </div>
    <div class="fixb"><div><button class="btn" onclick="A.checkout()" ${isOpen(r) ? '' : 'disabled'}>Passer la commande • ${F(sub + fee)}</button></div></div></div>`,
  };
};

V.address = (_, q) => {
  const cur = { ...here() };
  let pick = { ...cur }, geoT;
  const toPay = q.next === 'pay';
  window.__addr = {
    async gps() {
      if (!navigator.geolocation) return toast('GPS indisponible sur cet appareil.');
      toast('Recherche de ta position…');
      navigator.geolocation.getCurrentPosition(p => { maps[0] && maps[0].setView([p.coords.latitude, p.coords.longitude], 17); },
        () => toast('Active la localisation (GPS) et autorise FoodConnect.'), { enableHighAccuracy: true, timeout: 15000 });
    },
    async search(e) {
      e.preventDefault(); const t = e.target.q.value.trim(); if (!t) return;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=bj&accept-language=fr&q=${encodeURIComponent(t)}`);
        const j = await res.json();
        if (!j[0]) return toast('Adresse introuvable. Déplace la carte à la main.');
        maps[0].setView([+j[0].lat, +j[0].lon], 17);
      } catch (x) { toast('Recherche impossible hors connexion.'); }
    },
    save(saved) {
      const label = $('#a-label').value.trim() || 'Position sur la carte', note = $('#a-note').value.trim();
      S.address = { lat: pick.lat, lng: pick.lng, label, note };
      if (saved || !S.addresses.some(a => a.label === label)) S.addresses = [S.address, ...S.addresses.filter(a => a.label !== label)].slice(0, 5);
      save(); go(toPay ? '#/pay' : '#/home');
    },
    use(i) { const a = S.addresses[i]; maps[0].setView([a.lat, a.lng], 17); $('#a-label').value = a.label; $('#a-note').value = a.note || ''; },
  };
  return {
    h: `<div class="scr" style="padding-bottom:110px"><div class="top"><button class="ib" onclick="back('#/home')">${ic('back')}</button><h1>Lieu de livraison</h1></div>
    <div class="pad"><form class="search" onsubmit="__addr.search(event)">${ic('search', 20)}<input name="q" placeholder="Rechercher un quartier, un lieu…"></form>
    <div class="map" id="m-addr" style="margin-top:12px"><div class="pin-c">${ic('pin', 44, 2.4).replace('fill="none"', 'fill="#e5372b" stroke="#fff"')}</div>
      <button class="ib mapbtn" onclick="__addr.gps()" aria-label="Ma position">${ic('gps', 22)}</button></div>
    <p class="sm muted" style="margin:8px 2px 14px">Déplace la carte pour placer l'épingle rouge exactement sur ta maison.</p>
    <div class="lbl">Adresse (comment le livreur te trouve)</div>
    <div class="field">${ic('pin', 20)}<input id="a-label" value="${esc(cur.label === 'Cotonou' ? '' : cur.label)}" placeholder="Ex : Maison derrière la pharmacie Saint Joseph"></div>
    <div class="lbl">Précision (optionnel)</div>
    <div class="field"><input id="a-note" value="${esc(cur.note || '')}" placeholder="Ex : Portail bleu, maison à côté du marché"></div>
    ${S.addresses.length ? `<div class="lbl" style="margin-top:6px">Adresses récentes</div><div class="chips">${S.addresses.map((a, i) => `<button class="chip" onclick="__addr.use(${i})">${ic('clock', 14)} ${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div><div class="fixb"><div><button class="btn" onclick="__addr.save()">Valider la localisation</button></div></div></div>`,
    after() {
      const m = mkMap('m-addr', cur, 16); if (!m) return;
      const upd = () => {
        const c = m.getCenter(); pick = { lat: c.lat, lng: c.lng };
        clearTimeout(geoT);
        geoT = setTimeout(async () => {
          const inp = $('#a-label'); if (!inp || inp.dataset.typed) return;
          try {
            const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&accept-language=fr&lat=${pick.lat}&lon=${pick.lng}`)).json();
            const a = j.address || {};
            const t = [a.road || a.pedestrian || a.amenity, a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village].filter(Boolean).join(', ');
            if (t && !inp.dataset.typed) inp.value = t;
          } catch (x) { }
        }, 900);
      };
      m.on('moveend', upd); upd();
      const inp = $('#a-label'); inp.addEventListener('input', () => { inp.dataset.typed = inp.value ? '1' : ''; });
      if (cur.label !== 'Cotonou') inp.dataset.typed = '1';
    },
  };
};

V.pay = () => {
  if (!S.cart) return go('#/home');
  if (!me()) return go('#/register');
  const r = resto(S.cart.rid), sub = cartSub(), fee = deliveryFee(km(r, here())), m = S.payMethod || 'mtn';
  const wa = WA_MODE, after = 'Vous payez après confirmation du restaurant';
  const pm = (k, name, sub2, lg) => `<button class="pm ${m === k ? 'on' : ''}" data-m="${k}" onclick="A.pay('${k}')">${lg}<div class="sp"><b>${name}</b><div class="sm muted">${sub2}</div></div><span class="radio"></span></button>`;
  return {
    h: `<div class="scr" style="padding-bottom:120px"><div class="top"><button class="ib" onclick="back('#/cart')">${ic('back')}</button><h1>Choisir un moyen de paiement</h1></div>
    <div class="pad">
      ${pm('mtn', 'MTN Mobile Money', wa ? after : 'Payez avec votre compte MTN MoMo', '<span class="lg" style="background:#ffcc00;color:#004f71">MTN<br>MoMo</span>')}
      ${pm('moov', 'Moov Money', wa ? after : 'Payez avec votre compte Moov Money', '<span class="lg" style="background:#0a4ea2;color:#fff">Moov<br><span style="color:#ff8a00">Money</span></span>')}
      ${pm('celtiis', 'Celtiis Cash', wa ? after : 'Payez avec votre compte Celtiis Cash', '<span class="lg" style="background:#0f9d58;color:#fff">Celtiis<br>Cash</span>')}
      ${pm('cash', 'Espèces à la livraison', 'Vous payez le livreur en main propre', '<span class="lg" style="background:#efe8e2;font-size:24px">💵</span>')}
      ${wa ? '' : `<div id="mmphone" style="${m === 'cash' ? 'display:none' : ''}"><div class="lbl" style="margin-top:8px">Numéro Mobile Money</div>
      <div class="field">${ic('phone', 20)}<input id="mmnum" type="tel" inputmode="tel" value="${esc(me().phone)}"></div></div>`}
      <div class="card" style="margin-top:6px">
        <div class="row sm"><span class="sp muted">${esc(r.name)} (${cartCount()} articles)</span><span>${F(sub)}</span></div><div style="height:6px"></div>
        <div class="row sm"><span class="sp muted">Livraison</span><span>${F(fee)}</span></div><div style="height:6px"></div>
        <div class="row sm"><span class="sp muted">Livré à</span><span style="text-align:right;max-width:60%">${esc(here().label)}</span></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><div class="row"><b class="sp">Total à payer</b><b style="font-size:19px">${F(sub + fee)}</b></div></div>
      ${wa ? `<div class="row card" style="margin-top:12px;box-shadow:none;background:#e8f7ee">${ic('chat', 26)}<div class="sm"><b>Commande par WhatsApp</b><div class="muted">WhatsApp va s'ouvrir avec ta commande déjà écrite. Appuie sur « Envoyer » : on te confirme le délai et le paiement par message.</div></div></div>`
        : `<div class="row card" style="margin-top:12px;box-shadow:none;background:#f0ebe6">${ic('shield', 26)}<div class="sm"><b>Paiement sécurisé</b><div class="muted">Vous confirmez le paiement sur votre téléphone avec votre code secret. FoodConnect ne voit jamais ce code.</div></div></div>`}
    </div><div class="fixb"><div><button class="btn ${wa ? 'g' : ''}" onclick="A.confirmPay()">${wa ? ic('chat', 20) + ' Envoyer la commande sur WhatsApp' : 'Payer maintenant • ' + F(sub + fee)}</button></div></div></div>`,
  };
};

function timeline(o) {
  const steps = [
    ['nouvelle', 'Commande confirmée', o.t.created, 'check'],
    ['acceptee', 'Le restaurant prépare votre repas', o.t.accepted, 'store'],
    ['prete', 'Prêt pour le livreur', o.t.ready, 'receipt'],
    ['en_route', 'Livreur en route', o.t.picked, 'bike'],
    ['livree', 'Livré', o.t.delivered, 'home'],
  ];
  const idx = ['nouvelle', 'acceptee', 'prete', 'en_route', 'livree'].indexOf(o.status);
  return `<div class="tl">${steps.map(([k, l, t, icn], i) => `<div class="st ${i < idx || o.status === 'livree' ? 'done' : i === idx ? 'cur' : 'todo'}"><i>${ic(icn, 16, 2.4)}</i><div><b>${l}</b><div class="sm muted">${t ? hhmm(t) : i === 4 && o.eta ? 'Estimation : ' + hhmm(o.eta) : ''}</div></div></div>`).join('')}</div>`;
}

V.track = id => {
  const o = order(id); if (!o) return go('#/orders');
  const dr = o.driver && userOf(o.driver), r = resto(o.rid);
  const live = ['prete', 'en_route'].includes(o.status) && dr;
  const head = o.wa && o.status === 'nouvelle' ? 'Envoyée par WhatsApp' : o.status === 'refusee' ? (o.cancelled ? 'Commande annulée' : 'Commande refusée par le restaurant')
    : o.status === 'livree' ? 'Commande livrée' : o.status === 'en_route' ? 'En cours de livraison' : 'En cours de préparation';
  return {
    h: `<div class="scr"><div class="top"><button class="ib" onclick="go('#/orders')">${ic('back')}</button><h1>Commande #${o.id}<small style="color:${o.status === 'refusee' ? 'var(--red)' : 'var(--green)'}">${head}</small></h1></div>
    <div class="pad">
    ${o.status === 'refusee' ? `<div class="card"><p style="margin:0">${o.cancelled ? 'Tu as annulé cette commande.' : 'Le restaurant n\'a pas pu prendre ta commande.'} ${o.pay.paid ? 'Le montant de <b>' + F(o.total) + '</b> est remboursé sur ton compte ' + esc(o.pay.label) + '.' : ''}</p></div>`
        : o.wa && o.status === 'nouvelle' ? `<div class="card" style="text-align:center"><div style="font-size:46px">📲</div><b>Commande prête à partir sur WhatsApp</b>
          <p class="sm muted">Si tu n'as pas encore appuyé sur « Envoyer » dans WhatsApp, ta commande n'est pas partie. On te répond sur WhatsApp pour confirmer le délai et le paiement.</p>
          <button class="btn g" onclick="A.sendWa(${o.id})">${ic('chat', 20)} Ouvrir WhatsApp</button></div>`
        : `<div class="card">${timeline(o)}</div>`}
    ${live ? `<div class="map" id="m-trk" style="margin-top:12px;height:220px;min-height:0"></div>
      <div class="card row" style="margin-top:12px"><div class="av" style="width:48px;height:48px;font-size:20px">🛵</div><div class="sp"><div class="sm muted">Votre livreur</div><b>${esc(dr.name)}</b><div class="sm" id="eta">${etaTxt(o)}</div></div>
        <a class="ib" href="${waHref(dr.phone, 'Bonjour, je suis le client de la commande FoodConnect #' + o.id)}" style="color:var(--green)">${ic('chat', 20)}</a>
        <a class="ib" href="${telHref(dr.phone)}" style="color:var(--green)">${ic('phone', 20)}</a></div>` : ''}
    ${o.status === 'livree' ? `<div class="card" style="margin-top:12px;text-align:center"><b>${o.rated ? 'Merci pour ta note !' : 'Comment était ton repas ?'}</b>
      <div style="font-size:34px;margin-top:6px;letter-spacing:6px">${[1, 2, 3, 4, 5].map(n => `<span style="cursor:pointer;color:${(o.rated || 0) >= n ? '#f5a300' : '#ddd'}" onclick="A.rate(${o.id},${n})">★</span>`).join('')}</div></div>` : ''}
    <div class="card" style="margin-top:12px">
      <div class="row"><b class="sp">${esc(o.rname)}</b>${obadge(o)}</div><div style="height:8px"></div>
      ${o.items.map(i => `<div class="row sm" style="padding:3px 0"><span class="sp">${i.who && o.group ? '<b>' + esc(i.who) + '</b> · ' : ''}${i.qty} × ${esc(i.name)}</span><span>${F(i.qty * i.price)}</span></div>`).join('')}
      <div class="row sm" style="padding:3px 0"><span class="sp muted">Livraison</span><span>${F(o.fee)}</span></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0"><div class="row"><b class="sp">Total</b><b>${F(o.total)}</b></div>
      <div class="sm muted" style="margin-top:8px">${esc(o.pay.label)}${o.pay.paid ? ' • payé' : ' • à payer au livreur'}<br>${ic('pin', 14)} ${esc(o.address.label)}${o.address.note ? ' — ' + esc(o.address.note) : ''}</div>
      ${o.status === 'nouvelle' && !o.wa ? `<button class="btn ghost" style="color:var(--red)" onclick="A.cancel(${o.id})">Annuler la commande</button>` : ''}
      <a class="btn ghost" href="${telHref(r.phone)}">${ic('phone', 18)} Appeler le restaurant</a></div>
    ${!['livree', 'refusee'].includes(o.status) && !o.wa ? `<div class="demo-note" style="margin-top:12px">Démo : le restaurant et le livreur font avancer la commande depuis leur espace (Compte → Espaces). <a href="#" onclick="event.preventDefault();A.demoNext(${o.id})" style="font-weight:700">Passer à l'étape suivante</a></div>` : ''}
    </div></div>`,
    nav: 'orders',
    after() {
      const st = o.status;
      timers.push(setInterval(() => {
        const cur = order(id); if (!cur) return;
        if (cur.status !== st || (cur.driver && !dr)) return render();
        if (dm) dm.setLatLng([driverPos(cur).lat, driverPos(cur).lng]);
        const e = $('#eta'); if (e) e.textContent = etaTxt(cur);
      }, 2000));
      if (!live) return;
      const m = mkMap('m-trk', o.address, 14); if (!m) return;
      L.marker([r.lat, r.lng], { icon: mk('mk-r', r.emoji) }).addTo(m);
      L.marker([o.address.lat, o.address.lng], { icon: mk('mk-c', '🏠') }).addTo(m);
      L.polyline([[r.lat, r.lng], [o.address.lat, o.address.lng]], { color: '#16a34a', weight: 4, dashArray: '8 8' }).addTo(m);
      const p = driverPos(o); var dm = L.marker([p.lat, p.lng], { icon: mk('mk-d', '🛵'), zIndexOffset: 1000 }).addTo(m);
      fit(m, [r, o.address]);
    },
  };
};

V.orders = () => {
  const u = me();
  if (!u) return {
    nav: 'orders', h: `<div class="scr"><div class="top"><h1>Mes commandes</h1></div><div class="pad" style="text-align:center;padding-top:50px"><div style="font-size:64px">🧾</div><p class="muted">Connecte-toi pour voir tes commandes.</p><a class="btn" href="#/login">Se connecter</a></div></div>`,
  };
  const list = S.orders.filter(o => o.cid === u.id);
  return {
    nav: 'orders',
    h: `<div class="scr"><div class="top"><h1>Mes commandes</h1></div><div class="pad">
    ${list.map(o => `<a class="oc" href="#/track/${o.id}"><div class="row"><b class="sp">${esc(o.rname)}</b>${obadge(o)}</div>
      <div class="sm muted" style="margin-top:4px">#${o.id} • ${dday(o.t.created)} à ${hhmm(o.t.created)} • ${o.items.reduce((s, i) => s + i.qty, 0)} article(s)</div>
      <div class="row" style="margin-top:6px"><span class="sm sp">${esc(o.items.map(i => i.name).join(', '))}</span><b>${F(o.total)}</b></div></a>`).join('')
      || '<div style="text-align:center;padding-top:40px"><div style="font-size:64px">🍽️</div><p class="muted">Aucune commande pour le moment.</p><a class="btn" href="#/home">Commander maintenant</a></div>'}
    </div></div>`,
    after() { timers.push(setInterval(() => { const n = JSON.stringify(S.orders.filter(o => o.cid === u.id).map(o => o.status)); if (n !== JSON.stringify(list.map(o => o.status))) render(); }, 3000)); },
  };
};

V.account = () => {
  const u = me(), base = S.session && S.session.base && userOf(S.session.base);
  const spaces = `<div class="h2">Espaces de démonstration</div>
    <div class="lm">
      <button onclick="A.space('resto')">${ic('store', 20)}<span class="sp">Espace restaurant<div class="sm muted">Recevoir et préparer les commandes</div></span>${ic('chev', 18)}</button>
      <button onclick="A.space('driver')">${ic('bike', 20)}<span class="sp">Espace livreur<div class="sm muted">Issa ADAM : prendre et livrer les commandes</div></span>${ic('chev', 18)}</button>
      <button onclick="A.space('admin')">${ic('grid', 20)}<span class="sp">Administration<div class="sm muted">Vue d'ensemble, chiffre d'affaires, commissions</div></span>${ic('chev', 18)}</button>
    </div>
    <div class="demo-note" style="margin-top:12px">Ces espaces sont là pour tester toute la chaîne sur un seul téléphone. Dans la vraie application, chaque restaurant et chaque livreur aura son propre compte.</div>`;
  if (!u || u.role !== 'client') return {
    nav: 'account',
    h: `<div class="scr"><div class="top"><h1>Mon compte</h1></div><div class="pad">
      <div class="card" style="text-align:center">${hat(48)}<p>Crée un compte pour commander et suivre tes livraisons.</p><a class="btn" href="#/register">Créer un compte</a><div style="height:10px"></div><a class="btn w" href="#/login">Se connecter</a></div>
      ${spaces}<div class="gap"></div><button class="btn ghost" onclick="A.reset()">Réinitialiser la démo</button></div></div>`,
  };
  const nOrders = S.orders.filter(o => o.cid === u.id).length;
  return {
    nav: 'account',
    h: `<div class="scr"><div class="top"><h1>Mon profil</h1></div><div class="pad">
    <div class="card row"><div class="av">${esc(u.name[0])}</div><div class="sp"><b style="font-size:18px">${esc(u.name)}</b><div class="sm muted">${esc(u.phone)}</div>${u.email ? `<div class="sm muted">${esc(u.email)}</div>` : ''}</div></div>
    <div class="gap"></div>
    <div class="lm">
      <a href="#/orders">${ic('receipt', 20)}<span class="sp">Mes commandes</span><span class="muted sm">${nOrders}</span>${ic('chev', 18)}</a>
      <a href="#/address">${ic('pin', 20)}<span class="sp">Mes adresses<div class="sm muted">${esc(here().label)}</div></span>${ic('chev', 18)}</a>
      <a href="#" onclick="event.preventDefault();toast('Tu choisis le moyen de paiement à chaque commande.')">${ic('wallet', 20)}<span class="sp">Moyens de paiement<div class="sm muted">MTN, Moov, Celtiis, espèces</div></span>${ic('chev', 18)}</a>
      <a href="${waHref(SUPPORT_WA, 'Bonjour FoodConnect, j\'ai besoin d\'aide.')}">${ic('help', 20)}<span class="sp">Aide et support<div class="sm muted">Discuter sur WhatsApp</div></span>${ic('chev', 18)}</a>
      <button onclick="A.logout()" style="color:var(--red)">${ic('logout', 20)}<span class="sp">Se déconnecter</span></button>
    </div>
    ${spaces}<div class="gap"></div><button class="btn ghost" onclick="A.reset()">Réinitialiser la démo</button></div></div>`,
  };
};

/* ---------- Budget ---------- */
V.budget = (_, q) => {
  const b = parseInt(q.b || S.budget || 2000, 10), withFee = q.f !== '0';
  S.budget = b; save();
  const set = (nb, nf) => `history.replaceState(null,'','#/budget?b=${nb}&f=${nf ? 1 : 0}');render()`;
  const res = visibleRestos().filter(isOpen).flatMap(r => {
    const fee = deliveryFee(km(r, here()));
    return r.menu.filter(m => !m.off && !isDrink(m)).map(m => ({ r, m, fee, tot: m.price + (withFee ? fee : 0) }));
  }).filter(x => x.tot <= b).sort((x, y) => y.m.price - x.m.price || km(x.r, here()) - km(y.r, here()));
  return {
    nav: 'explore',
    h: `<div class="scr"><div class="top"><button class="ib" onclick="back('#/home')">${ic('back')}</button><h1>Mon budget<small>Qu'est-ce que je peux manger avec…</small></h1></div>
    <div class="pad">
      <form class="field" onsubmit="event.preventDefault();history.replaceState(null,'','#/budget?b='+(parseInt(this.b.value.replace(/\\D/g,''))||0)+'&f=${withFee ? 1 : 0}');render()"><b style="color:var(--ink)">💰</b><input name="b" inputmode="numeric" value="${b}" aria-label="Budget"><span>F</span><button class="chip on" style="margin:6px 0">OK</button></form>
      <div class="chips">${[1000, 1500, 2000, 3000, 5000, 10000].map(v => `<button class="chip ${v === b ? 'on' : ''}" onclick="${set(v, withFee)}">${fmt(v)} F</button>`).join('')}</div>
      <div class="card row" style="margin:12px 0;padding:12px"><span class="sp sm"><b>Livraison comprise</b><div class="muted">Le budget couvre le plat + la livraison</div></span><button class="sw ${withFee ? 'on' : ''}" onclick="${set(b, !withFee)}" aria-label="Livraison comprise"></button></div>
      <div class="sm muted" style="margin-bottom:8px">${res.length} plat(s) possible(s) avec ${F(b)}</div>
      ${res.map(({ r, m, fee, tot }) => `<div class="dish">${pic(m)}<a class="sp" href="#/resto/${r.id}" style="text-decoration:none;color:inherit"><b>${esc(m.name)}</b><small>${esc(r.name)} • ${kmTxt(km(r, here()))}</small><span class="p">${F(m.price)}${withFee ? ` <span class="sm muted" style="font-weight:500">+ ${F(fee)} livraison = ${F(tot)}</span>` : ''}</span></a>
        <div class="qty"><button class="add" onclick="A.add('${r.id}','${m.id}',1)" aria-label="Ajouter">${ic('plus', 18)}</button></div></div>`).join('')
        || `<div style="text-align:center;padding:30px 0"><div style="font-size:56px">🪙</div><p class="muted">Rien d'ouvert à ce prix pour le moment.${withFee ? ' Essaie sans la livraison comprise.' : ''}</p></div>`}
    </div>${cartBar()}</div>`,
  };
};

/* ---------- Comparaison ---------- */
V.compare = () => {
  if (!S.cmp || !S.cmp.length) S.cmp = visibleRestos().filter(isOpen).sort((a, b) => km(a, here()) - km(b, here())).slice(0, 2).map(r => r.id);
  const sel = S.cmp.map(resto).filter(Boolean);
  const data = sel.map(r => {
    const d = km(r, here()), plats = r.menu.filter(m => !isDrink(m) && !m.off);
    return { r, d, fee: deliveryFee(d), eta: etaMin(d), min: Math.min(...plats.map(m => m.price)), avg: Math.round(plats.reduce((t, m) => t + m.price, 0) / (plats.length || 1) / 50) * 50, n: plats.length, cheap: plats.slice().sort((a, b) => a.price - b.price)[0] };
  });
  const bestOf = (k, hi) => { const v = data.map(x => x[k]); return hi ? Math.max(...v) : Math.min(...v); };
  const row = (label, k, show, hi) => `<tr><td>${label}</td>${data.map(x => `<td class="${data.length > 1 && x[k] === bestOf(k, hi) ? 'best' : ''}">${show(x)}</td>`).join('')}</tr>`;
  data.forEach(x => { x.rating = x.r.rating; });
  return {
    nav: 'explore',
    h: `<div class="scr"><div class="top"><button class="ib" onclick="back('#/home')">${ic('back')}</button><h1>Comparer<small>Choisis jusqu'à 3 restaurants</small></h1></div>
    <div class="pad"><div class="chips" style="flex-wrap:wrap">${visibleRestos().map(r => `<button class="chip ${S.cmp.includes(r.id) ? 'on' : ''}" onclick="A.cmp('${r.id}')">${r.emoji} ${esc(r.name)}</button>`).join('')}</div>
    ${data.length ? `<div style="overflow-x:auto;margin-top:12px"><table class="cmp"><tr><td></td>${data.map(x => `<th><div style="font-size:30px">${x.r.emoji}</div>${esc(x.r.name)}</th>`).join('')}</tr>
      ${row('Note', 'rating', x => '★ ' + String(x.r.rating).replace('.', ',') + `<div class="muted" style="font-weight:400">${x.r.nrev} avis</div>`, true)}
      ${row('Distance', 'd', x => kmTxt(x.d))}
      ${row('Livraison', 'fee', x => F(x.fee))}
      ${row('Délai estimé', 'eta', x => '~' + x.eta + ' min')}
      ${row('Plat le moins cher', 'min', x => F(x.min) + `<div class="muted" style="font-weight:400">${esc(x.cheap ? x.cheap.name : '')}</div>`)}
      ${row('Prix moyen d\'un plat', 'avg', x => F(x.avg))}
      ${row('Choix de plats', 'n', x => x.n, true)}
      <tr><td>Horaires</td>${data.map(x => `<td>${isOpen(x.r) ? '<span class="ok">Ouvert</span>' : '<span class="ko">Fermé</span>'}<div class="muted">${x.r.from}–${x.r.to}</div></td>`).join('')}</tr>
      <tr><td></td>${data.map(x => `<td><a class="btn" style="padding:9px 6px;font-size:13px" href="#/resto/${x.r.id}">Voir</a></td>`).join('')}</tr>
    </table></div><p class="sm muted">En vert : le meilleur de chaque ligne. Le délai est une estimation (préparation + trajet).</p>` : '<p class="muted" style="margin-top:14px">Touche les restaurants ci-dessus pour les comparer.</p>'}
    </div></div>`,
  };
};

/* ---------- Espace restaurant ---------- */
function backToClient() { return `<button class="ib" onclick="A.space('client')" aria-label="Quitter l'espace">${ic('swap', 20)}</button>`; }
const today = t => new Date(t).toDateString() === new Date().toDateString();

V.rd = tab => {
  const u = me(); if (!u || u.role !== 'resto') return go('#/account');
  const r = resto(u.rid), mine = S.orders.filter(o => o.rid === r.id);
  const tday = mine.filter(o => today(o.t.created) && o.status !== 'refusee');
  const ca = tday.reduce((s, o) => s + o.sub, 0), com = tday.reduce((s, o) => s + o.commission, 0);
  const nNew = mine.filter(o => o.status === 'nouvelle').length;
  const oc = o => `<a class="oc ${o.status === 'nouvelle' ? 'hot' : ''}" href="#/ro/${o.id}"><div class="row"><b class="sp">#${o.id} • ${esc(o.cname)}</b>${badge(o.status)}</div>
    <div class="sm muted" style="margin-top:4px">${hhmm(o.t.created)} • ${esc(o.items.map(i => i.qty + '× ' + i.name).join(', '))}</div>
    <div class="row" style="margin-top:6px"><span class="sm sp muted">${esc(o.pay.label)}</span><b>${F(o.sub)}</b></div></a>`;
  let body = '';
  if (tab === 'orders') {
    const groups = [['nouvelle', 'Nouvelles'], ['acceptee', 'En préparation'], ['prete', 'Prêtes, en attente du livreur'], ['en_route', 'En livraison'], ['livree', 'Livrées'], ['refusee', 'Refusées']];
    body = groups.map(([k, l]) => { const g = mine.filter(o => o.status === k); return g.length ? `<div class="h2">${l} (${g.length})</div>${g.map(oc).join('')}` : ''; }).join('') || '<p class="muted" style="text-align:center;padding-top:30px">Aucune commande pour le moment.</p>';
  } else if (tab === 'menu') {
    body = `<button class="btn" style="margin:14px 0" onclick="A.rEdit()">${ic('plus', 20)} Ajouter un plat</button>` +
      r.menu.map(m => `<div class="dish ${m.off ? 'off' : ''}" style="opacity:1">${pic(m)}<div class="sp" onclick="A.rEdit('${m.id}')"><b>${esc(m.name)}</b><small>${esc(m.section)}</small><span class="p">${F(m.price)}</span></div>
      <div style="text-align:center"><button class="sw ${m.off ? '' : 'on'}" onclick="A.rDish('${m.id}')" aria-label="Disponible"></button><div class="sm muted" style="font-size:11px">${m.off ? 'Épuisé' : 'Dispo'}</div></div></div>`).join('');
  } else {
    body = `<div class="stats" style="margin-top:14px">
      <div class="stat"><span>Commandes aujourd'hui</span><b>${tday.length}</b></div>
      <div class="stat"><span>Chiffre d'affaires</span><b>${F(ca)}</b></div>
      <div class="stat"><span>Commission FoodConnect (7 %)</span><b>${F(com)}</b></div>
      <div class="stat"><span>Votre revenu net</span><b class="ok">${F(ca - com)}</b></div></div>
      <div class="h2">Commandes récentes <a href="#/rd/orders">Voir tout</a></div>${mine.slice(0, 5).map(oc).join('') || '<p class="muted">Les commandes des clients arriveront ici.</p>'}`;
  }
  return {
    keepScroll: tab === 'menu',
    h: `<div class="scr"><div class="top"><div class="rimg" style="width:42px;height:42px;font-size:24px;border-radius:12px;background:${r.bg}">${r.emoji}</div><h1>${esc(r.name)}<small>${isOpen(r) ? '<span class="ok">Ouvert</span>' : '<span class="ko">Fermé</span>'} • ${r.from}–${r.to}</small></h1>
      <button class="sw ${r.open ? 'on' : ''}" onclick="A.rOpen()" aria-label="Ouvert"></button>${backToClient()}</div>
      <div class="pad"><div class="seg"><a href="#/rd/dash" class="${!tab || tab === 'dash' ? 'on' : ''}">Tableau de bord</a><a href="#/rd/orders" class="${tab === 'orders' ? 'on' : ''}">Commandes${nNew ? ` (${nNew})` : ''}</a><a href="#/rd/menu" class="${tab === 'menu' ? 'on' : ''}">Menu</a></div>
      ${body}</div></div>`,
    after() {
      const sig = JSON.stringify(mine.map(o => o.status));
      timers.push(setInterval(() => { if (JSON.stringify(S.orders.filter(o => o.rid === r.id).map(o => o.status)) !== sig) { if (S.orders.filter(o => o.rid === r.id && o.status === 'nouvelle').length > nNew) { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { } toast('Nouvelle commande !'); } render(); } }, 2000));
    },
  };
};

V.ro = id => {
  const u = me(), o = order(id); if (!u || u.role !== 'resto' || !o) return go('#/rd/orders');
  const dr = o.driver && userOf(o.driver);
  const acts = {
    nouvelle: `<div class="row"><button class="btn r" onclick="A.rRefuse(${o.id})">Refuser</button><button class="btn g" onclick="A.rAccept(${o.id})">Accepter</button></div>`,
    acceptee: `<button class="btn" onclick="A.rReady(${o.id})">${ic('check', 20)} La commande est prête</button>`,
    prete: `<p class="sm muted" style="text-align:center;margin:0">${dr ? esc(dr.name) + ' vient récupérer la commande.' : 'En attente d\'un livreur…'}</p>`,
  }[o.status] || '';
  return {
    h: `<div class="scr" style="padding-bottom:120px"><div class="top"><button class="ib" onclick="back('#/rd/orders')">${ic('back')}</button><h1>Commande #${o.id}<small>${hhmm(o.t.created)}</small></h1>${badge(o.status)}</div>
    <div class="pad"><div class="card"><div class="sm muted">Client</div><div class="row" style="margin-top:4px"><b class="sp">${esc(o.cname)}<div class="sm muted" style="font-weight:400">${esc(o.cphone)}</div></b>
      <a class="ib" href="${telHref(o.cphone)}" style="color:var(--green)">${ic('phone', 20)}</a></div>
      <div class="sm muted" style="margin-top:8px">${ic('pin', 14)} ${esc(o.address.label)}${o.address.note ? ' — ' + esc(o.address.note) : ''}</div></div>
    <div class="card" style="margin-top:12px"><div class="sm muted" style="margin-bottom:6px">Articles</div>
      ${o.items.map(i => `<div class="row" style="padding:5px 0"><span style="font-size:22px">${i.emoji}</span><span class="sp">${i.who && o.group ? esc(i.who) + ' · ' : ''}<b>${i.qty} ×</b> ${esc(i.name)}</span><span>${F(i.qty * i.price)}</span></div>`).join('')}
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
      <div class="row"><b class="sp">Total plats</b><b>${F(o.sub)}</b></div>
      <div class="row sm" style="margin-top:4px"><span class="sp muted">Commission FoodConnect (7 %)</span><span>− ${F(o.commission)}</span></div>
      <div class="row sm" style="margin-top:4px"><span class="sp muted">Vous recevez</span><b class="ok">${F(o.sub - o.commission)}</b></div>
      <div class="sm muted" style="margin-top:8px">Paiement : ${esc(o.pay.label)}${o.pay.paid ? ' (déjà payé)' : ' (encaissé par le livreur)'}</div></div>
    </div>${acts ? `<div class="fixb"><div>${acts}</div></div>` : ''}</div>`,
    after() { const st = o.status; timers.push(setInterval(() => { if (order(id).status !== st) render(); }, 2000)); },
  };
};

/* ---------- Espace livreur ---------- */
V.dv = tab => {
  const u = me(); if (!u || u.role !== 'driver') return go('#/account');
  const avail = S.orders.filter(o => ['acceptee', 'prete'].includes(o.status) && !o.driver);
  const mine = S.orders.filter(o => o.driver === u.id && ['acceptee', 'prete', 'en_route'].includes(o.status));
  const done = S.orders.filter(o => o.driver === u.id && o.status === 'livree');
  const gain = done.filter(o => today(o.t.delivered)).reduce((s, o) => s + o.fee, 0);
  const card = (o, act) => { const r = resto(o.rid); return `<div class="oc"><div class="row"><b class="sp">#${o.id} • ${esc(r.name)}</b>${badge(o.status)}</div>
    <div class="sm muted" style="margin-top:6px">${ic('store', 14)} ${esc(r.address)}</div>
    <div class="sm muted" style="margin-top:3px">${ic('pin', 14)} ${esc(o.address.label)} • ${kmTxt(km(r, o.address))}</div>
    <div class="row" style="margin-top:10px"><span class="sp">Gain : <b class="ok">${F(o.fee)}</b>${o.pay.paid ? '' : `<div class="sm muted">Encaisser ${F(o.total)} en espèces</div>`}</span>${act}</div></div>`; };
  return {
    dark: true, keepScroll: false,
    h: `<div class="dk"><div class="scr"><div class="top"><div class="av" style="width:42px;height:42px;font-size:20px;background:#3a2e26">🛵</div><h1>${esc(u.name)}<small>${S.driverOnline ? '<span class="ok">En ligne</span>' : 'Hors ligne'}</small></h1>
      <button class="sw ${S.driverOnline ? 'on' : ''}" onclick="A.dOnline()" aria-label="En ligne"></button>${backToClient()}</div>
      <div class="pad"><div class="stats"><div class="stat"><span>Gains aujourd'hui</span><b class="ok">${F(gain)}</b></div><div class="stat"><span>Livraisons</span><b>${done.length}</b></div></div>
      ${mine.length ? `<div class="h2">Ma course en cours</div>${mine.map(o => card(o, `<a class="btn" style="width:auto;padding:11px 16px" href="#/dc/${o.id}">${ic('nav', 18)} Ouvrir</a>`)).join('')}` : ''}
      <div class="h2">Commandes disponibles</div>
      ${!S.driverOnline ? '<p class="muted">Passe en ligne pour recevoir des courses.</p>' : avail.map(o => card(o, `<button class="btn g" style="width:auto;padding:11px 16px" onclick="A.dTake(${o.id})">Accepter</button>`)).join('') || '<p class="muted">Aucune commande pour le moment. Elles apparaissent dès qu\'un restaurant accepte une commande.</p>'}
      </div></div></div>`,
    after() { const sig = JSON.stringify(S.orders.map(o => o.status + o.driver)); timers.push(setInterval(() => { if (JSON.stringify(S.orders.map(o => o.status + o.driver)) !== sig) render(); }, 2000)); },
  };
};

V.dc = id => {
  const u = me(), o = order(id); if (!u || u.role !== 'driver' || !o) return go('#/dv');
  const r = resto(o.rid), toResto = o.status !== 'en_route';
  const dest = toResto ? r : o.address;
  let watch = null;
  const bottom = o.status === 'livree' ? `<p>Commande livrée ✅</p><a class="btn" href="#/dv">Retour</a>` : toResto
    ? `<div class="row" style="margin-bottom:12px"><div class="rimg" style="width:44px;height:44px;font-size:24px;border-radius:12px;background:${r.bg}">${r.emoji}</div><div class="sp"><div class="sm muted">Récupérer chez</div><b>${esc(r.name)}</b><div class="sm muted">${esc(r.address)}</div></div><a class="ib" href="${telHref(r.phone)}" style="color:var(--green)">${ic('phone', 20)}</a></div>
       <div class="row"><button class="btn w" style="background:#3a2e26;color:#fff;border:0" onclick="A.navTo(${r.lat},${r.lng})">${ic('nav', 18)} Naviguer</button><button class="btn g" onclick="A.dPicked(${o.id})" ${o.status === 'prete' ? '' : 'disabled'}>${o.status === 'prete' ? 'Commande récupérée' : 'En préparation…'}</button></div>`
    : `<div class="row" style="margin-bottom:12px"><div class="av" style="width:44px;height:44px;font-size:20px;background:var(--red-soft)">📍</div><div class="sp"><div class="sm muted">Client</div><b>${esc(o.cname)}</b><div class="sm muted">${esc(o.address.label)}${o.address.note ? ' — ' + esc(o.address.note) : ''}</div></div><a class="ib" href="${telHref(o.cphone)}" style="color:var(--green)">${ic('phone', 20)}</a></div>
       ${o.pay.paid ? '' : `<div class="demo-note" style="margin-bottom:10px">Encaisser <b>${F(o.total)}</b> en espèces.</div>`}
       <div class="row"><button class="btn w" style="background:#3a2e26;color:#fff;border:0" onclick="A.navTo(${o.address.lat},${o.address.lng})">${ic('nav', 18)} Naviguer</button><button class="btn g" onclick="A.dDone(${o.id})">Livrée</button></div>`;
  return {
    dark: true,
    h: `<div class="dk" style="display:flex;flex-direction:column;height:100vh"><div class="top"><button class="ib" onclick="go('#/dv')">${ic('back')}</button><h1>Commande #${o.id}<small>${toResto ? 'Direction le restaurant' : 'En route vers le client'}</small></h1>${badge(o.status)}</div>
      <div class="map full" id="m-dc" style="flex:1;height:auto"></div>
      <div style="background:var(--dark-2);border-radius:22px 22px 0 0;margin-top:-18px;position:relative;z-index:5;padding:18px 16px calc(16px + var(--bot))">
      <div class="sm muted" style="margin-bottom:10px" id="dist">${kmTxt(km(driverPos(o), dest))} jusqu'à ${toResto ? 'le restaurant' : 'au client'}</div>${bottom}</div></div>`,
    after() {
      const m = mkMap('m-dc', dest, 14, true);
      if (m) {
        L.marker([r.lat, r.lng], { icon: mk('mk-r', r.emoji) }).addTo(m);
        L.marker([o.address.lat, o.address.lng], { icon: mk('mk-c', '🏠') }).addTo(m);
        L.polyline([[r.lat, r.lng], [o.address.lat, o.address.lng]], { color: '#3b82f6', weight: 5 }).addTo(m);
        const p = driverPos(o); var dm = L.marker([p.lat, p.lng], { icon: mk('mk-d', '🛵'), zIndexOffset: 1000 }).addTo(m);
        fit(m, [r, o.address, p]);
      }
      // Position GPS réelle du livreur, partagée avec le client
      if (navigator.geolocation && o.status !== 'livree') {
        watch = navigator.geolocation.watchPosition(pos => {
          const cur = order(id); if (!cur) return;
          cur.live = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
          // On ignore une position à plus de 50 km (téléphone de test hors Cotonou)
          if (km(cur.live, cur.address) > 50) delete cur.live; else save();
        }, () => { }, { enableHighAccuracy: true, maximumAge: 10000 });
      }
      const st = o.status;
      timers.push(setInterval(() => {
        const cur = order(id); if (!cur) return;
        if (cur.status !== st) { if (watch !== null) navigator.geolocation.clearWatch(watch); return render(); }
        const p = driverPos(cur); if (dm) dm.setLatLng([p.lat, p.lng]);
        const el = $('#dist'); if (el) el.textContent = `${kmTxt(km(p, dest))} jusqu'à ${toResto ? 'le restaurant' : 'au client'}`;
      }, 2000));
      timers.push(setInterval(() => { if (!location.hash.startsWith('#/dc/') && watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; } }, 1000));
    },
  };
};

/* ---------- Administration ---------- */
V.ad = tab => {
  const u = me(); if (!u || u.role !== 'admin') return go('#/account');
  const ok = S.orders.filter(o => o.status !== 'refusee');
  const clients = S.users.filter(x => x.role === 'client'), drivers = S.users.filter(x => x.role === 'driver');
  const com = ok.reduce((s, o) => s + o.commission, 0), ca = ok.reduce((s, o) => s + o.total, 0);
  // 6 jours précédents : chiffres d'exemple (démo) ; aujourd'hui : vraies commandes du téléphone
  const demoDays = [42000, 56500, 38000, 61000, 72500, 80500];
  const days = [...Array(7)].map((_, i) => { const dt = new Date(); dt.setDate(dt.getDate() - (6 - i)); return dt; });
  const vals = days.map((dt, i) => i === 6 ? ok.filter(o => today(o.t.created)).reduce((s, o) => s + o.total, 0) : demoDays[i]);
  const mx = Math.max(...vals, 1);
  let body = '';
  if (tab === 'orders') {
    body = S.orders.map(o => `<div class="oc"><div class="row"><b class="sp">#${o.id} • ${esc(o.rname)}</b>${badge(o.status)}</div><div class="sm muted" style="margin-top:4px">${esc(o.cname)} • ${dday(o.t.created)} ${hhmm(o.t.created)} • ${esc(o.pay.label)}</div><div class="row" style="margin-top:6px"><span class="sm sp muted">Commission ${F(o.commission)}</span><b>${F(o.total)}</b></div></div>`).join('') || '<p class="muted">Aucune commande.</p>';
  } else if (tab === 'restos') {
    body = S.restos.map(r => { const n = S.orders.filter(o => o.rid === r.id && o.status !== 'refusee'); return `<div class="oc row"><div class="rimg" style="width:46px;height:46px;font-size:24px;border-radius:12px;background:${r.bg}">${r.emoji}</div><div class="sp"><b>${esc(r.name)}</b><div class="sm muted">${n.length} commande(s) • ${F(n.reduce((s, o) => s + o.commission, 0))} de commission</div><div class="sm ${r.suspended ? 'ko' : 'ok'}">${r.suspended ? 'Suspendu' : 'Actif'}</div></div><button class="sw ${r.suspended ? '' : 'on'}" onclick="A.aResto('${r.id}')" aria-label="Actif"></button></div>`; }).join('');
  } else if (tab === 'users') {
    body = S.users.map(x => `<div class="oc row"><div class="av" style="width:42px;height:42px;font-size:17px;background:#3a2e26;color:#fff">${esc(x.name[0])}</div><div class="sp"><b>${esc(x.name)}</b><div class="sm muted">${esc(x.phone)}</div></div><span class="tag">${{ client: 'Client', resto: 'Restaurant', driver: 'Livreur', admin: 'Admin' }[x.role]}</span></div>`).join('');
  } else {
    body = `<div class="stats" style="margin-top:14px">
      <div class="stat"><span>${ic('users', 16)} Clients inscrits</span><b>${clients.length}</b></div>
      <div class="stat"><span>${ic('store', 16)} Restaurants</span><b>${S.restos.filter(r => !r.suspended).length}</b></div>
      <div class="stat"><span>${ic('bike', 16)} Livreurs</span><b>${drivers.length}</b></div>
      <div class="stat"><span>${ic('receipt', 16)} Commandes</span><b>${S.orders.length}</b></div></div>
      <div class="card" style="margin-top:12px"><div class="row"><b class="sp">Chiffre d'affaires</b><span class="sm muted">7 jours</span></div>
      <div class="bars">${vals.map((v, i) => `<div class="${i === 6 ? 'today' : ''}"><span>${v >= 1000 ? Math.round(v / 1000) + 'k' : v}</span><i style="height:${Math.max(3, v / mx * 100)}%"></i>${days[i].toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</div>`).join('')}</div>
      <div class="sm muted" style="margin-top:8px">Les 6 jours précédents sont des chiffres d'exemple ; aujourd'hui = les vraies commandes passées sur ce téléphone.</div></div>
      <div class="stats" style="margin-top:12px"><div class="stat"><span>Volume total</span><b>${F(ca)}</b></div><div class="stat"><span>Commissions (7 %)</span><b class="ok">${F(com)}</b></div></div>`;
  }
  const t = tab || 'home';
  return {
    dark: true,
    h: `<div class="dk"><div class="scr"><div class="top">${hat(34)}<h1>${wordmark().replace('wm"', 'wm" style="font-size:20px"')}<small>Administration</small></h1>${backToClient()}</div>
      <div class="pad"><div class="seg">${[['home', 'Vue d\'ensemble'], ['orders', 'Commandes'], ['restos', 'Restaurants'], ['users', 'Utilisateurs']].map(([k, l]) => `<a href="#/ad/${k}" class="${t === k ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${body}</div></div></div>`,
  };
};

render();
