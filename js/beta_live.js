// beta_live.js
(function () {
  'use strict';

  const DATA = window.BETA_DATA || {};
  if (!DATA.REDOSLIJED_TXT || !DATA.POLASCI_TXT) {
    console.warn('[BETA] Missing embedded TXT data (REDOSLIJED_TXT / POLASCI_TXT).');
    return;
  }

  /* ================= HELPERS ================= */
  function formatDateTime(d = new Date()) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();

  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());

  return `${dd}. ${mm}. ${yyyy}., ${hh}:${mi}:${ss}`;
}

  const DAY = 24 * 3600;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pad2 = (n) => String(n).padStart(2, '0');

  const parseTime = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
    return m ? (+m[1] * 3600 + +m[2] * 60) : null;
  };

    // Vidljivost u spremištu: 5 min prije polaska i 5 min nakon dolaska
    
  const DEPOT_PRE  = 5 * 60;
  const DEPOT_POST = 5 * 60;

  // ⏱️ Stajanje na stanicama (u sekundama) – ali ukupno trajanje ostaje iz POLASCI trajanje
const DWELL_TIME = 2;

// tolerancija (u metrima) za “uhvati stanicu”
const STOP_EPS = 10;

  function isDepotEnd(routeKey) {
    // dolazak u spremište kad je odredište S (npr. "...-S")
    return /-S$/.test(routeKey || '');
  }

  const nowSec = () => {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  };

  //function isNightNow(d = new Date()) {
  //const h = d.getHours();
 // return (h >= 22 || h < 5); // ← prilagodi ako želiš
//}

    /* ================= SERVICE CALENDAR (PROMETNA PRAVILA) ================= */

  // Posebni dani (vrijedi svake godine) – format "MM-DD"
  const SPECIAL_MD = new Set([
    '01-01','01-02','01-03','01-04','01-05','01-06',
    '03-01',
    '04-02','04-03','04-04','04-05','04-06',
    '05-01','05-02',
    '05-30',
    '06-04','06-22',
    '08-05','08-15',
    '11-01','11-02','11-18','11-25',
    '12-24','12-25','12-26','12-27','12-28','12-29','12-30','12-31'
  ]);

  // 🚋 NEDJELJNI / POSEBNI REŽIM
const SUNDAY_ALLOWED_LINES = new Set(['1','2','3','4']);

const SUNDAY_ALLOWED_VEHICLES = new Set([
  '11','12','14','21','23','31','33','43','45'
]);

  // Vozila koja NE VOZE SUBOTOM (samo dnevne linije)
const SATURDAY_DISABLED_VEHICLES = new Set([
  '52',
  '62',
  '72',
  '92',
  '112',
  '122',
    '132',
      '152',


]);

function isSaturday(d = new Date()) {
  return d.getDay() === 6;
}

function isVehicleDisabledToday(vozilo, linija) {
  // vrijedi samo subotom, samo za dnevne linije
  if (!isSaturday()) return false;
  if (!isRegularLine(linija)) return false;
  return SATURDAY_DISABLED_VEHICLES.has(vozilo);
}

  function isSpecialDay(d = new Date()) {
    const md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return d.getDay() === 0 || SPECIAL_MD.has(md); // nedjelja ili poseban datum
  }

  function tripMatchesToday(tr) {
  const tag = String(tr.red || '').toLowerCase().trim();

  // ako nije označeno → uvijek vrijedi
  if (!tag) return true;

  const special = isSpecialDay();

  if (tag === 'dnevni') {
    return !special;
  }

  if (tag === 'posebni') {
    return special;
  }

  return true; // sve ostalo ne ograničava
}

  

  function isSpecialLine(line) {
    // POSEBNE LINIJE: P1/P2 i njihove S-varijante (P1S/P2S)
    const L = String(line || '').toUpperCase().trim();
    return (L === 'P1' || L === 'P2' || L === 'P1S' || L === 'P2S' || L.startsWith('P1') || L.startsWith('P2'));
  }

  function isRegularLine(line) {
    // sve ostale (uključivo 1S–5S, 3S itd. su "regularne")
    return !isSpecialLine(line);
  }

  const VEH_EVERYDAY_EXCEPT_SUN = new Set([
  'B101','B201','B301','B401','B501'
]);

const VEH_WEEKDAYS_ONLY = new Set([
  'B102','B202','B302','B402','B502'
]);

//const VEH_NIGHT_ONLY = new Set([
  //'B602','B702'
//]);

const VEH_SPECIAL_ONLY = new Set([
  'B802','B902'
]);

function tripAllowedNow(tr, tNowSec) {
  const v = String(tr.vozilo || '').trim();
  const d = new Date();

  // ================= NEDJELJA / POSEBNI DANI =================
const isSunOrSpecial = isSpecialDay(d);

if (isSunOrSpecial) {

  const line = String(tr.linija || '').replace(/S$/,'');

  // ❌ potpuno ukidamo stare posebne linije
  if (isSpecialLine(line)) return false;

  // ❌ dopuštene su samo linije 1–4
  if (!SUNDAY_ALLOWED_LINES.has(line)) return false;

  // ❌ dopuštena su samo određena vozila
  if (!SUNDAY_ALLOWED_VEHICLES.has(v)) return false;

}

  const day = d.getDay();      // 0 = nedjelja, 6 = subota
  const isSun = day === 0;
  const isSat = day === 6;
  const special = isSpecialDay(d);

  // 📅 SAMO NEDJELJA / POSEBNI DANI
  if (VEH_SPECIAL_ONLY.has(v)) {
    return special;
  }

  // 🚫 RADNIM DANOM ZABRANJENA SUBOTA + NEDJELJA
  if (VEH_WEEKDAYS_ONLY.has(v)) {
    return !isSat && !isSun && !special;
  }

  // 🚋 SVAKI DAN OSIM NEDJELJE
  if (VEH_EVERYDAY_EXCEPT_SUN.has(v)) {
    return !isSun && !special;
  }

  // ✅ SVE OSTALO: VOZI AKO POSTOJI TRIP
  return true;
}






  const hav = (a, b) => {
    const R = 6371000, toR = (x) => x * Math.PI / 180;
    const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
    const la1 = toR(a[0]), la2 = toR(b[0]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const bearing = (a, b) => {
    const toR = (x) => x * Math.PI / 180, toD = (x) => x * 180 / Math.PI;
    const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
    const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) -
      Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
    const ang = (toD(Math.atan2(y, x)) + 360) % 360;
    return Number.isFinite(ang) ? ang : 0;
  };

  function isActiveTrip(tr, t) {
    if (t >= tr._t0 && t <= tr._t1 + 1) return true;

    if (tr._t1 >= DAY) {
      const t1wrap = tr._t1 - DAY;
      if (t <= t1wrap) return true;
    }
    return false;
  }

  function minsUntil(secFuture, tNow) {
    let diff = secFuture - tNow;
    if (diff < 0) diff += DAY;
    return Math.max(0, Math.round(diff / 60));
  }

  function formatClock(t) {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  // ===== PAMETNO ZAOKRUŽIVANJE MINUTA =====
function formatMinsSmart(secondsLeft) {
  if (secondsLeft <= 30) {
    return { label: '<1 min.', sortMin: 0 };
  }
  if (secondsLeft < 90) {
    return { label: '1 min.', sortMin: 1 };
  }
  const mins = Math.round(secondsLeft / 60);
  return { label: `${mins} min.`, sortMin: mins };
}

  /* ================= PARSE REDOSLIJED ================= */

  // routeKey -> [stationId, ...]
  const routeStations = new Map();
  // routeKey -> { start:[lat,lng] | null, end:[lat,lng] | null }
  const routeEndpoints = new Map();

  function parsePointWKT(s) {
    // accepts: POINT(lat,lng)  or  POINT(lat lng)
    s = String(s || '').trim();
    const m = /^POINT\(([^)]+)\)$/i.exec(s);
    if (!m) return null;
    const parts = m[1].split(/[ ,]+/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  // Podržava STARI format:
  //   routeKey;id1,id2,...
  // i NOVI format:
  //   linija;pocetak;stanice_ID;kraj
  //   routeKey;POINT(lat,lng);id1,id2,...;POINT(lat,lng)
  let firstDataSeen = false;
  DATA.REDOSLIJED_TXT.split(/\r?\n/).forEach((l) => {
    l = (l || '').trim();
    if (!l || l.startsWith('#')) return;

    const p = l.split(';').map(x => (x ?? '').trim());

    // preskoči header novog formata
    if (!firstDataSeen && p[0].toLowerCase() === 'linija') {
      firstDataSeen = true;
      return;
    }
    firstDataSeen = true;

    // novi format: 4 stupca
    if (p.length >= 4 && p[2]) {
      const key = p[0];
      const ids = p[2].split(',').map(s => s.trim()).filter(Boolean);
      if (key && ids.length) routeStations.set(key, ids);

      const st = parsePointWKT(p[1]);
      const en = parsePointWKT(p[3]);
      if (st || en) routeEndpoints.set(key, { start: st, end: en });
      return;
    }

    // stari format: 2 stupca
    if (p.length >= 2) {
      const key = p[0];
      const ids = p[1].split(',').map(s => s.trim()).filter(Boolean);
      if (key && ids.length) routeStations.set(key, ids);
    }
  });

  /* ================= PARSE POLASCI ================= */

  const trips = [];
  const rows = DATA.POLASCI_TXT.split(/\r?\n/).filter(Boolean);
  const head = (rows.shift() || '').split(',').map(s => s.toLowerCase().trim());

  rows.forEach((r) => {
    const o = {};
    r.split(',').forEach((v, i) => o[head[i]] = (v ?? '').trim());
    o.linija = (o.linija || '').trim();
    o.vozilo = (o.vozilo || '').trim();
    o.smjer = (o.smjer || '').trim().toLowerCase();
    o.okretište = (o['okretište'] || o.okretiste || o.okretište || '').trim();
    o.vrijeme = (o.vrijeme || '').trim();
    o.trajanje = Number((o.trajanje || '').trim());
    o.red = (o.red || '').trim();

    o._t0 = parseTime(o.vrijeme);
    // je li vožnja smjela krenuti u trenutku polaska

    if (!o.linija || !o.vozilo || o._t0 == null || !Number.isFinite(o.trajanje)) return;

    o._t1 = o._t0 + o.trajanje * 60;
    trips.push(o);
  });

  /* ================= STATIONS ================= */

  const stationById = new Map();
  (json_Tramvajskestanice_2.features || []).forEach((f) => {
    const id = String(f.properties?.ID ?? '').trim();
    if (!id) return;
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) return;
    stationById.set(id, { latlng: [c[1], c[0]], name: String(f.properties?.Stanica ?? '') });
  });

  /* ================= ROUTE KEY PICKER ================= */

  const TERM_CODE = {
    'Pešija': 'PS',
    'Dubrava': 'D',
    'Krštelica': 'K',
    'Prispa': 'P',
    'Gomilice': 'GO',
    'Poljanice': 'PO',
    'Spremište': 'S',

    // aliasi iz POLASCI (da ne pada routeKey picker)
    'Otok': 'S',
    'Centar': 'S',
    'Kamenice': 'S',
    'Spremiste': 'S',
    // === NOVA OKRETIŠTA ===
'Topana':'T',
'Ričina':'RI',
'Opačac':'O',
'Brig':'BR',
'Bilušine':'BIL',
'Đardin':'DJ',
'Perinuša':'PER',
'Brižine':'R',
'Boboška':'B',
'Kamenmost':'KM',
'Podi':'PD',
'Gaj':'G',
'Mokri Dolac':'M',
'Meljakuša':'ME',
'Radovanj':'RD'
  };

  function pickRouteKeyForTrip(trip) {
 // === IZNIMKA DEFINIRANA PODACIMA ===
//if (
  //trip.red === 'dnevni_iznimka' &&
 // trip.linija === '4' &&
  //trip.smjer === 'od' &&
 // trip.okretište === 'Gomilice'
//) {
  //return '4_G-PR_DEPOT';
//}

    // === 0) EKSPPLICITNA DEPOT / IZNIMNA RUTA IZ POLASCI.TXT ===
  // Ako je u stupcu "red" naveden točan routeKey (npr. 4_G-PR_DEPOT),
  // i on postoji u Redoslijed.txt → koristi ga bez ikakve daljnje logike
  if (trip.red) {
    const rk = String(trip.red).trim();
    if (routeStations.has(rk)) {
      return rk;
    }
  }
    const line = String(trip.linija || '').trim();
    const termRaw = String(trip.okretište || '').trim();

    // normaliziraj alias okretišta (ako je u TERM_CODE)
    const code = TERM_CODE[termRaw];

    const prefix = line + '_';
    const candidates = [];
    for (const k of routeStations.keys()) if (k.startsWith(prefix)) candidates.push(k);
    if (!candidates.length) return null;

    // helper: probaj pogoditi "depot" rutu kad okretište nije prepoznato
    function fallbackDepot(smjer) {
      const L = String(line || '').toUpperCase();
      const looksDepotLine = L.endsWith('S') || L === 'P1S' || L === 'P2S';
      if (!looksDepotLine) return null;

      if (smjer.includes('prema')) {
        // izlaz iz spremišta: origin je S
        const out = candidates.filter(k => /_S-/.test(k));
        return out[0] || null;
      }
      if (smjer.includes('od')) {
        // ulaz u spremište: destination je S
        const back = candidates.filter(k => /-S$/.test(k));
        return back[0] || null;
      }
      return null;
    }

    const smjer = String(trip.smjer || '').toLowerCase();

    // 1) normalno: ako imamo kod okretišta
    if (code) {
 if (smjer.includes('prema')) {
  const exact = candidates.find(k => k.endsWith('-' + code));
  return exact || null;
}
 if (smjer.includes('od')) {
  // ✔️ mora počinjati točno s line + '_' + code + '-'
  const exact = candidates.find(k => k.startsWith(line + '_' + code + '-'));
  return exact || null;
}
    }

    // 2) fallback za depot i "čudna" okretišta (Otok/Centar/Kamenice…)
    const fb = fallbackDepot(smjer);
    if (fb) return fb;

    // 3) zadnji fallback: ako imamo samo jednu kandidatsku rutu, uzmi je
    if (candidates.length === 1) return candidates[0];

    return null;
  }

  function isDepotStart(routeKey) {
    return (routeKey || '').includes('_S-');
  }

  function displayLineForVehicle(tr, routeKey) {
  // ide U spremište → pokaži samo "S"
  if (routeKey && isDepotEnd(routeKey)) {
    return 'S';
  }

  // ide IZ spremišta ili normalna vožnja → makni eventualni S-sufiks
  return String(tr.linija || '').replace(/S$/, '');
}

  /* ================= ROUTE (TRACK-FOLLOWING via network graph) ================= */

  const routeCache = new Map();
  const nodeKey = (latlng) => latlng[0].toFixed(6) + ',' + latlng[1].toFixed(6);

  // routeKey -> [{id, name, dist}]  dist = udaljenost stanice (m) po ruti
const routeStationDistCache = new Map();

// nađi najbližu točku na polylineu i vrati njen index
function nearestPointIndexOnPolyline(poly, latlng) {
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = hav(poly[i], latlng);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
}

// izgradi listu stanica s njihovom udaljenosti po ruti (metri)
function getRouteStationDistances(routeKey) {
  if (routeStationDistCache.has(routeKey)) return routeStationDistCache.get(routeKey);

  const ids = routeStations.get(routeKey);
  const r = buildRoute(routeKey);
  if (!ids || ids.length < 2 || !r || !r.poly || r.poly.length < 2) {
    routeStationDistCache.set(routeKey, null);
    return null;
  }

  const out = [];
  for (const id of ids) {
    const st = stationById.get(String(id));
    if (!st) continue;
    const idx = nearestPointIndexOnPolyline(r.poly, st.latlng);
    const dist = r.cum[idx] ?? 0;
    out.push({ id: String(id), name: st.name || '', dist });
  }

  // sort po dist (da je rastuće po ruti)
  out.sort((a,b)=>a.dist - b.dist);

  routeStationDistCache.set(routeKey, out);
  return out;
}

// vrati id+ime sljedeće stanice dok je tramvaj ne prođe
function getNextStopByDistance(routeKey, currentDistMeters) {
  const list = getRouteStationDistances(routeKey);
  if (!list || !list.length) return null;

  // tolerancija da ne "preskače" zbog GPS/računskih šumova
  const EPS = 8; // metri (po potrebi 5-15)

  // nađi prvu stanicu čiji je dist > currentDist + EPS
  for (let i = 0; i < list.length; i++) {
    if (list[i].dist > currentDistMeters + EPS) {
      return list[i];
    }
  }
  return null; // na kraju rute (nema sljedeće)
}

function arrivalsForStation(stationId, tNow) {
  const best = [];
  const HORIZON = 15 * 60;
  const FAR_HORIZON = 60 * 60; // ✅ 60 min fallback

  // ✅ PO VOZILU (ne po linija+smjer)
  for (const [vozilo, arr] of tripsByVehicle.entries()) {

    // 🔥 PROĐI SVE TRIPOVE VOZILA (ne samo jedan!)
    for (const tr of arr) {

      const rk = pickRouteKeyForTrip(tr);
      if (!rk) continue;

      // ⛔ samo tripovi koji su danas dozvoljeni
      if (!tripAllowedNow(tr, tNow)) continue;

      // stanica mora biti na toj ruti
      const list = getRouteStationDistances(rk);
      if (!list) continue;

      const st = list.find(x => x.id === stationId);
      if (!st) continue;

      const r = buildRoute(rk);
      if (!r || r.total <= 0) continue;

      let secondsLeft;

      if (isActiveTrip(tr, tNow)) {
        // 🚋 vozilo je u vožnji

        let tInTrip = tNow;
        if (tr._t1 >= DAY && tNow < tr._t0) tInTrip = tNow + DAY;

        const tripDur = (tr._t1 - tr._t0);
        const tRel = clamp(tInTrip - tr._t0, 0, tripDur);

        const nStops = list.length;

        // isto kao tvoj kod prije (da ne mijenjamo ponašanje)
        const dwellTotal = Math.max(0, (nStops - 1) * DWELL_TIME);
        const runTime = Math.max(1, tripDur - dwellTotal);

        const stIndex = list.indexOf(st);

        const arriveRun  = (st.dist / r.total) * runTime;
        const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;

        // ako je već prošla (i odradila dwell) → skip
        if (tRel >= arriveReal + DWELL_TIME) continue;

        secondsLeft = Math.max(0, arriveReal - tRel);

      } else {
        // 🕒 tek kreće

        let untilStart = tr._t0 - tNow;
        if (untilStart < 0) untilStart += DAY;

        const tripDur = (tr._t1 - tr._t0);
        const nStops = list.length;

        const dwellTotal = Math.max(0, (nStops - 2) * DWELL_TIME);
        const runTime = Math.max(1, tripDur - dwellTotal);

        const stIndex = list.indexOf(st);
        const arriveRun  = (st.dist / r.total) * runTime;
        const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;

        secondsLeft = untilStart + arriveReal;
      }

      // samo u idućih 10 min
      if (secondsLeft < 0 || secondsLeft > HORIZON) continue;

      const fmt = formatMinsSmart(secondsLeft);

      best.push({
        vozilo: vozilo,
        linija: tr.linija,
        smjer: destFromRouteKey(rk),
        label: fmt.label,
        sortMin: fmt.sortMin,
        secondsLeft: secondsLeft
      });
    }
  }

  return best.sort((a, b) => {
    if (a.secondsLeft !== b.secondsLeft) return a.secondsLeft - b.secondsLeft;
    const c = String(a.linija).localeCompare(String(b.linija), 'hr');
    if (c) return c;
    return String(a.vozilo).localeCompare(String(b.vozilo), 'hr');
  });
}

function nextArrivalWithin60Min(stationId, tNow) {
  let bestOne = null;
  const FAR_HORIZON = 60 * 60;

  for (const [vozilo, arr] of tripsByVehicle.entries()) {
    for (const tr of arr) {

      const rk = pickRouteKeyForTrip(tr);
      if (!rk) continue;
      if (!tripAllowedNow(tr, tNow)) continue;

      const list = getRouteStationDistances(rk);
      if (!list) continue;

      const st = list.find(x => x.id === stationId);
      if (!st) continue;

      const r = buildRoute(rk);
      if (!r || r.total <= 0) continue;

      let secondsLeft;

      if (isActiveTrip(tr, tNow)) {
        let tInTrip = tNow;
        if (tr._t1 >= DAY && tNow < tr._t0) tInTrip = tNow + DAY;

        const tripDur = (tr._t1 - tr._t0);
        const tRel = clamp(tInTrip - tr._t0, 0, tripDur);

        const nStops = list.length;
        const dwellTotal = Math.max(0, (nStops - 1) * DWELL_TIME);
        const runTime = Math.max(1, tripDur - dwellTotal);

        const stIndex = list.indexOf(st);

        const arriveRun  = (st.dist / r.total) * runTime;
        const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;

        if (tRel >= arriveReal + DWELL_TIME) continue;

        secondsLeft = Math.max(0, arriveReal - tRel);

      } else {
        let untilStart = tr._t0 - tNow;
        if (untilStart < 0) untilStart += DAY;

        const tripDur = (tr._t1 - tr._t0);
        const nStops = list.length;

        const dwellTotal = Math.max(0, (nStops - 2) * DWELL_TIME);
        const runTime = Math.max(1, tripDur - dwellTotal);

        const stIndex = list.indexOf(st);
        const arriveRun  = (st.dist / r.total) * runTime;
        const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;

        secondsLeft = untilStart + arriveReal;
      }

      if (secondsLeft < 0 || secondsLeft > FAR_HORIZON) continue;

      const fmt = formatMinsSmart(secondsLeft);

      const cand = {
        vozilo,
        linija: tr.linija,
        smjer: destFromRouteKey(rk),
        label: fmt.label,
        sortMin: fmt.sortMin,
        secondsLeft
      };

      if (!bestOne || cand.secondsLeft < bestOne.secondsLeft) {
        bestOne = cand;
      }
    }
  }

  return bestOne; // ili null
}

  function buildGraphForRoute(routeKey) {
    const nodes = new Map();
    function ensureNode(latlng) {
      const k = nodeKey(latlng);
      if (!nodes.has(k)) nodes.set(k, { latlng, edges: [] });
      return k;
    }

    const feats = (json_TramvajskamreaopineGrude_1.features || []);
    for (const f of feats) {
      const segs = String(f.properties?.Segmenti ?? '');
      const segList = segs.split(',').map(s => s.trim()).filter(Boolean);
      if (!segList.includes(routeKey)) continue;

      const geom = f.geometry;
      if (!geom) continue;

      let coords = [];
      if (geom.type === 'LineString') coords = geom.coordinates;
      else if (geom.type === 'MultiLineString') coords = geom.coordinates.flat();
      if (!coords.length) continue;

      const latlngs = coords.map(c => [c[1], c[0]]);
      const a = latlngs[0];
      const b = latlngs[latlngs.length - 1];

      const ka = ensureNode(a);
      const kb = ensureNode(b);

      let w = 0;
      for (let i = 1; i < latlngs.length; i++) w += hav(latlngs[i - 1], latlngs[i]);

      nodes.get(ka).edges.push({ to: kb, coords: latlngs, w });
      nodes.get(kb).edges.push({ to: ka, coords: latlngs.slice().reverse(), w });
    }
    return nodes;
  }

  function nearestNodeKey(nodes, targetLatLng) {
    let bestK = null, bestD = Infinity;
    for (const [k, n] of nodes.entries()) {
      const d = hav(n.latlng, targetLatLng);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return bestK;
  }

  function dijkstra(nodes, startK, goalK) {
    if (startK === goalK) return [];
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();

    for (const k of nodes.keys()) dist.set(k, Infinity);
    dist.set(startK, 0);

    while (true) {
      let u = null, best = Infinity;
      for (const [k, d] of dist.entries()) {
        if (visited.has(k)) continue;
        if (d < best) { best = d; u = k; }
      }
      if (u === null) break;
      if (u === goalK) break;

      visited.add(u);
      const uNode = nodes.get(u);
      if (!uNode) continue;

      for (const e of uNode.edges) {
        const alt = best + e.w;
        if (alt < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, alt);
          prev.set(e.to, { from: u, edge: e });
        }
      }
    }

    if (!prev.has(goalK)) return null;

    const edges = [];
    let cur = goalK;
    while (cur !== startK) {
      const p = prev.get(cur);
      if (!p) return null;
      edges.push(p.edge);
      cur = p.from;
    }
    edges.reverse();
    return edges;
  }

  function buildRoute(key) {
    if (routeCache.has(key)) return routeCache.get(key);

    const stIds = routeStations.get(key);
    if (!stIds || stIds.length < 2) return null;

    const nodes = buildGraphForRoute(key);
    if (!nodes || nodes.size === 0) return null;

    // Waypoints: [START POINT?] + stanice + [END POINT?]
    const ep = routeEndpoints.get(key) || {};
    const waypoints = [];

    if (ep.start) waypoints.push(ep.start);

    for (const id of stIds) {
      const st = stationById.get(String(id));
      if (st?.latlng) waypoints.push(st.latlng);
    }

    if (ep.end) waypoints.push(ep.end);

    if (waypoints.length < 2) return null;

    let poly = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const A = waypoints[i];
      const B = waypoints[i + 1];
      if (!A || !B) continue;

      const startK = nearestNodeKey(nodes, A);
      const goalK = nearestNodeKey(nodes, B);
      if (!startK || !goalK) continue;

      const edges = dijkstra(nodes, startK, goalK);
      if (!edges) continue;

      for (const e of edges) {
        if (!poly.length) poly = poly.concat(e.coords);
        else poly = poly.concat(e.coords.slice(1));
      }
    }

    if (poly.length < 2) return null;

    const cum = [0];
    let total = 0;
    for (let i = 1; i < poly.length; i++) {
      total += hav(poly[i - 1], poly[i]);
      cum.push(total);
    }

    // safety: total = zadnji kumulativ
total = cum[cum.length - 1] || total;

    const out = { poly, cum, total };
    routeCache.set(key, out);
    return out;
  }

  function pointAt(route, distMeters) {
    const { poly, cum, total } = route;
    const d = clamp(distMeters, 0, total);

    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);

    const d0 = cum[i - 1];
    const d1 = cum[i];
    const t = (d1 === d0) ? 0 : (d - d0) / (d1 - d0);

    const a = poly[i - 1];
    const b = poly[i];

    const lat = a[0] + (b[0] - a[0]) * t;
    const lng = a[1] + (b[1] - a[1]) * t;

    // fallback: ako se dogodi da je segment mikro ili isti, uzmi sljedeći ako postoji
    const ang = bearing(a, b);

    return { latlng: [lat, lng], angle: ang };
  }

  /* ================= ICON (BIGGER + ALWAYS VISIBLE) ================= */

/* ================= ICON (ELIPSA + SPOJENA STRELICA) ================= */

//const BLUE = 'rgb(18,100,171)';

// konstantne dimenzije ikone (uvijek iste)
const ICON_SIZE = 60;

// centar i “krug” (zapravo elipsa) — malo šire da P2S stane bez trikova
const CX = 30;
const CY = 36;
const RX = 18;  // širina (x radijus)  -> šire
const RY = 15;  // visina (y radijus)  -> kao prije

// --- ICON (Školjka-stil: elipsa + zaobljena strelica) ---
const BLUE = 'rgb(18,100,171)';

function makeVehicleIcon(label, angleDeg, showArrow, color) {
  const C = color || BLUE;

  // Dimenzije ikone (konzistentno za sve, da stane "P2S")
  const W = 66;           // ukupna širina SVG
  const H = 66;           // ukupna visina SVG

  // Elipsa (badge)
  // Krug (badge)
const cx = 33, cy = 33; 
const r  = 16.5;          // radijus kruga (po želji 17–20)

  // Strelica (offset + veličina)
  const gap = -2;          // koliko je odmaknuta od elipse (povećaj za veći razmak)
  const baseW = 18;       // širina baze strelice
  const baseH = 10;       // visina baze (koliko “debelo” izgleda)
  const tipL  = 14;       // dužina do šiljka
  const round = 6;        // zaobljenje baze prema elipsi (veće = “mekše”)

  // Strelica se crta “iznad” elipse pa rotira oko (cx,cy)
  // Baza strelice je iznad elipse (y = cy-ry-gap), a šiljak još gore.
const baseY = cy - r - gap;
  const tipY  = baseY - tipL;

  // Zaobljena strelica kao path:
  // - ima zaobljenu stranu prema elipsi (donji rub)
  // - šiljak gore
  // Koordinate su u lokalnom sustavu pa ih samo rotiramo.
  const arrowPath = `
    M ${cx - baseW/2} ${baseY}
    L ${cx} ${tipY}
    L ${cx + baseW/2} ${baseY}
    Q ${cx + baseW/2 - round} ${baseY + baseH} ${cx} ${baseY + baseH}
    Q ${cx - baseW/2 + round} ${baseY + baseH} ${cx - baseW/2} ${baseY}
    Z
  `;

  const arrow = showArrow
    ? `<g transform="rotate(${angleDeg},${cx},${cy})">
         <path d="${arrowPath}" fill="${C}"></path>
       </g>`
    : '';

  // Tekst (kao prije – ne “širimo” slova)
  const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      ${arrow}
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C}" stroke="white" stroke-width="2"></circle>
      <text x="${cx}" y="${cy+5}" text-anchor="middle"
        font-size="14" font-weight="700" fill="white"
        font-family="Arial, sans-serif">${label}</text>
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: 'beta-vehicle-icon',
    iconSize: [W, H],
    iconAnchor: [W/2, H/2]
  });
}

  /* ================= POPUP CONTENT ================= */

  const DEST_LABEL = { PS: 'PEŠIJA', D: 'DUBRAVA', K: 'KRŠTELICA', P: 'PRISPA', GO: 'GOMILICE', PO: 'POLJANICE', S: 'SPREMIŠTE PRISPA' ,
    T:'TOPANA', RI:'RIČINA', O:'OPAČAC', BIL:'BILUŠINE', DJ: 'ĐARDIN', PER: 'PERINUŠA', R: 'BRIŽINE', B: 'BOBOŠKA', KM: 'KAMENMOST', PD: 'PODI', G: 'Gaj', M: 'MOKRI DOLAC', ME: 'MELJAKUŠA', RD: 'RADOVANJ', BR: 'BRIG'
  };

  // === DISPLAY OVERRIDES (samo za prikaz, ne za logiku!) ===
const DEST_DISPLAY_OVERRIDE = {
  'P2': {
    'D': 'PRISPA'
  },
  'P2S': {
    'D': 'PRISPA'
  }
};

  // Preko po LINJI + KRAJNJEM ODREDIŠTU
// ključ: linija -> odredište -> tekst
const VIA_BY_DEST = {
  '1': {
    'TOPANA':   '(Boboška — Bazana)',
    'KRŠTELICA':  '(Bazana — Boboška)'
  },
  '2': {
    'PERINUŠA': '(Radovanj — Kvartir)',
    'BRIŽINE':    '(Kvartir — Radovanj)'
  },
  '3': {
    'PRISPA': '(Mokri Dolac — Krištelica)',
    'RIČINA': '(Krištelica — Mokri Dolac)'
  },
  '4': {
    'POLJANICE':    '(Lukovac — Krenica)',
    'BOBOŠKA':  '(Krenica — Lukovac)'
  },
  '5': {
    'GOMILICE':  '(Prispa — Otok)',
    'POLJANICE': '(Otok — Prispa)'
  },
    '6': {
    'PODI':  '(Đirada — Kvartir)',
    'KAMENMOST': '(Kvartir — Đirada)'
  },
      '7': {
    'PERINUŠA':  '(Vilenice — Dunduša)',
    'GAJ': '(Dunduša — Vilenice)'
  },
    '8': {
    'GAJ':  '(Kvartir — Podpazar)',
    'PODI': '(Podpazar — Kvartir)'
  },
     '9': {
    'TOPANA':  '(Perišovac — Vilenice)',
    'BILUŠINE': '(Vilenice — Perišovac)'
  },
       '10': {
    'KRŠTELICA':  '(Boboška — Otok)',
    'PRISPA': '(Otok — Boboška)'
  },
       '11': {
    'POLJANICE':  '(Boboška — Bili Brig)',
    'GOMILICE': '(Bili Brig — Boboška)'
  },
       '12': {
    'PEŠIJA':  '(Prispa — Otok)',
    'DUBRAVA': '(Otok — Prispa)'
  },
       '13': {
    'MOKRI DOLAC':  '(Vojuša — Meljakuša)',
    'RIČINA': '(Meljakuša — Vojuša)'
  },
       '14': {
    'MELJAKUŠA':  '(Banovo — Topala)',
    'RADOVANJ': '(Topala — Banovo)'
  },
       '15': {
    'BRIG':  '(Mokri Dolac — Gajevac)',
    'MELJAKUŠA': '(Gajevac — Mokri Dolac)'
  },
};

  function destFromRouteKey(routeKey) {
  if (!routeKey) return '';

  const m = /-([A-Z0-9]+)$/.exec(routeKey);
  if (!m) return '';

  const destCode = m[1];          // npr. D
  const line = routeKey.split('_')[0]; // npr. P2

  // 🔥 DISPLAY IZNIMKA (P2 → PRISPA)
  const override =
    DEST_DISPLAY_OVERRIDE?.[line]?.[destCode];

  if (override) return override;

  return DEST_LABEL[destCode] || destCode;
}

  function oppositeDestFromRouteKey(routeKey) {
  const m = /_([A-Z0-9]+)-([A-Z0-9]+)$/.exec(routeKey || '');
  if (!m) return '';
  const from = m[1]; // početno okretište
  return DEST_LABEL[from] || from;
}

function popupHtml(tr, state) {
  // Uvijek prikazuj KRAJNJE odredište rute.
  // (Ako smo u "waiting" stanju i vozilo kreće u suprotnom smjeru,
  // to je upravo odredište iduće vožnje.)
  const dest = destFromRouteKey(state.routeKey || '');
  // bazna linija bez S (1, 2, 5, P1, P2…)
// bazna linija bez S (1, 2, 5, P1, P2…)
const baseLine = String(tr.linija || '').replace(/S$/, '');

// dinamički "Preko" prema odredištu
const via =
  VIA_BY_DEST?.[baseLine]?.[dest] || '';

// tekst "Preko:" ako postoji definicija
const viaText = via
  ? `<div style="
       font-size:13px;
       font-weight:600;
       margin-top:-10px;
       line-height:1.1;
     ">
       ${via}
     </div>`
  : '';




  // --- 1. RED: "2 PEŠIJA"
  // --- 1. RED: "3 PRISPA" (ZET stil)
  const displayLine = displayLineForVehicle(tr, state.routeKey);
// ✅ LED DOT-MATRIX CSS (ubaci samo jednom)
if (!document.getElementById('betaLedCss')) {
  const st = document.createElement('style');
  st.id = 'betaLedCss';
  st.textContent = `
.beta-led-text{

  color: transparent !important;
  -webkit-text-fill-color: transparent !important;

  /* 🟡 PRAVE LED TOČKICE (bez blur efekta) */
  background-image:
    radial-gradient(circle,
 #f4ff6a 0 1.15px,
transparent 1.25px

    );

  background-size: 2.5px 2.5px;   /* ← veličina matrice (3.5–4px je ZET-like) */
  background-position: 0 0;

  -webkit-background-clip: text;
  background-clip: text;

  /* ❌ NEMA glow-a — zato će se točkice stvarno vidjeti */
  filter: none;

  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
}




      background-image: radial-gradient(circle, rgba(215,247,180,0.98) 0 1.35px, transparent 1.55px);
      background-size: 6px 6px;        /* gustoća točkica (smanji na 5px za gušće) */
      background-position: 0 0;
      -webkit-background-clip: text;
      background-clip: text;

      /* lagani “glow” kao LED */
      filter: drop-shadow(0 0 1px rgba(215,247,180,0.75))
              drop-shadow(0 0 2px rgba(215,247,180,0.35));
      letter-spacing: 0.5px;
      text-transform: uppercase;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(st);
}

  const line1 = `
  <div style="
    margin: -8px -12px 6px -12px;
    padding: 8px 12px;
    background: #1264ab;
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
    border-radius: 6px 6px 0 0;
  ">
    <span class="beta-led-text">${displayLine} ${dest}</span>
  </div>
`;



  // --- minute (0 → "manje od 1 min.")
 let minsLabel = '?';
if (typeof state.secondsLeft === 'number') {
  minsLabel = formatMinsSmart(state.secondsLeft).label;
}

  // --- 2. RED: Polazak / Dolazak
 // --- 2. RED: ikona sata + vrijeme
let line2;
if (state.mode === 'moving') {
  line2 = `⏱️: za ${minsLabel}`;
} else {
  if (state.secondsLeft == null) {
    line2 = 'Nema više polazaka.';
  } else {
    line2 = `Polazak: za ${minsLabel}`;
  }
}

  // --- 3. RED: sljedeća stanica (NE DIRAMO)
  // --- 3. RED: ikona tramvaja (emoji) umjesto teksta
// --- 3. RED: sljedeća stanica + mala ikona
// --- 3. RED: 🚋: Naziv stanice
const line3 =
  (state.mode === 'moving' && state.nextStopName)
    ? `
      <div style="
        margin-top:6px;
        font-size:13px;
        font-weight:normal;
      ">
        🚋: ${state.nextStopName}
      </div>
    `
    : '';



return [line1, viaText, line2, line3]
  .filter(Boolean)
  .join('<br>');
}

  /* ================= FILTER UI ================= */
const STATION_FOCUS_ZOOM = 17;

function ensureFilterUI() {
  if (document.getElementById('betaFilter')) return;

  // mapiranje odredišnih kodova -> puni naziv
  const DEST_NAME = {
    PS: 'Pešija',
    D: 'Dubrava',
    K: 'Krštelica',
    PR: 'Prispa',
    GO: 'Gomilice',
    PO: 'Poljanice',
    S: 'Spremište Prispa',
    T:'Topana',
RI:'Ričina',
O:'Opačac',
BR:'Brig',
BIL:'Bilušine',
DJ:'Đardin',
PER:'Perinuša',
R:'Brižine',
B:'Boboška',
KM:'Kamenmost',
PD:'Podi',
M:'Mokri Dolac',
ME:'Meljakuša',
RD:'Radovanj'
  };

  // iz "P-D" ili "S-PR" izvuci samo zadnji dio (D, PR, ...)
  function destCodeFromDir(dirCode) {
    const parts = String(dirCode || '').split('-').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function dirLabel(dirCode) {
    const code = destCodeFromDir(dirCode);
    return DEST_NAME[code] || code || dirCode;
  }

  const div = document.createElement('div');
  div.id = 'betaFilter';
  if (window.matchMedia('(max-width: 768px)').matches) {
  div.style.display = 'none';
}
div.style.position = 'absolute';
div.style.top = '12px';
div.style.left = '12px';
div.style.right = 'auto';

  div.style.zIndex = '9999';
  div.style.background = 'rgba(255,255,255,0.92)';
  div.style.padding = '10px';
  div.style.borderRadius = '10px';
  div.style.fontFamily = 'PT Sans, sans-serif';
  div.style.boxShadow = '0 4px 14px rgba(0,0,0,0.25)';
div.innerHTML = `
  <div style="font-weight:700;margin-bottom:6px;text-align:center">Tramvajske linije</div>

  <select id="betaLineSel" style="width:190px;margin-bottom:6px"></select><br>
  <select id="betaDirSel" style="width:190px;margin-bottom:6px"></select><br>

  <select id="betaStationSel" style="width:190px;margin-bottom:6px"></select><br>

  

  <button id="betaClear" style="width:190px">Prikaži sve</button>

  <div id="betaClock" style="margin-top:8px;font-size:12px;opacity:.8;text-align:center"></div>
`;

  document.body.appendChild(div);
if (!document.getElementById('betaFilterCss')) {
  const style = document.createElement('style');
  style.id = 'betaFilterCss';
  style.textContent = `
    #betaFilter,
    #betaFilter select,
    #betaFilter button {
      font-family: "PT Sans", Arial, sans-serif !important;
    }

    #betaFilter select {
      font-size: 13px;
    }

    #betaFilter button {
      font-size: 13px;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

  const lineSel = document.getElementById('betaLineSel');
  const dirSel  = document.getElementById('betaDirSel');
  const clearBtn= document.getElementById('betaClear');
  const stationSel = document.getElementById('betaStationSel');
    // --- POPUNI POPIS STANICA ---
  const stationsSorted = Array.from(stationById.entries())
    .map(([id, s]) => ({ id, name: s.name, latlng: s.latlng }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'));

  stationSel.innerHTML =
    `<option value="">Prikaz svih stanica</option>` +
    stationsSorted.map(s =>
      `<option value="${s.id}">${s.name}</option>`
    ).join('');

  // --- ODABIR STANICE ---
stationSel.addEventListener('change', () => {
  clearStationSelection();

  const id = stationSel.value;
  if (!id) return;

  const st = stationById.get(id);
  if (!st) return;

  const m = L.marker(st.latlng).addTo(stationLayer);

  let popupTimer = null;

  function updatePopup() {
const arr = arrivalsForStation(id, nowSec());

let linesHtml = '';

if (arr.length) {
  // ✅ standard: svi u 10 min
  linesHtml = arr.map(a => `${a.linija} ${a.smjer} (${a.label})`).join('<br>');
} else {
  // ✅ fallback: pokaži samo 1 ako je unutar 60 min
  const one = nextArrivalWithin60Min(id, nowSec());
  if (one) {
    linesHtml = `${one.linija} ${one.smjer} (${one.label})`;
  } else {
    linesHtml = 'Nema skorih dolazaka';
  }
}

const html =
  `<b>${st.name}</b><hr style="margin:4px 0">` + linesHtml;

    if (!m.getPopup()) {
      m.bindPopup(html, { autoClose: true, closeOnClick: false }).openPopup();
    } else {
      m.setPopupContent(html).openPopup();
    }
  }

  // odmah
  updatePopup();

  // refresh svake 2 s
  popupTimer = setInterval(updatePopup, 2000);

  // cleanup
  m.on('popupclose', () => {
    if (popupTimer) clearInterval(popupTimer);
  });

map.setView(st.latlng, Math.max(map.getZoom(), STATION_FOCUS_ZOOM));
});

  const allKeys = Array.from(routeStations.keys());

  // --- LINIJE: uzmi samo bazne linije bez "S" u nazivu (1,2,3,4,5,P1,P2) ---
  const lineNames = Array.from(new Set(
    allKeys
      .map(k => k.split('_')[0])
.filter(l =>
  l &&
  !String(l).includes('S') &&
  String(l).toLowerCase() !== 'linija'
)
)).sort((a,b)=>{
  const na = parseInt(a,10);
  const nb = parseInt(b,10);

  // ako su obje numeričke → numerički redoslijed
  if (!isNaN(na) && !isNaN(nb)) return na - nb;

  // inače fallback na tekst
  return String(a).localeCompare(String(b),'hr');
});
  lineSel.innerHTML =
    `<option value="">Prikaz svih linija</option>` +
    lineNames.map(l => `<option value="${l}">${l}</option>`).join('');

function populateDirs() {
  const chosenLine = lineSel.value;

  // uzmi samo rute od baznih linija (bez S)
  const keysForDirs = allKeys.filter(k => {
    const ln = k.split('_')[0];
    if (!ln || String(ln).includes('S')) return false;   // izbaci sve S linije/rute
    if (chosenLine && ln !== chosenLine) return false;
    return true;
  });

  // 1) napravi mapu: "Dubrava" -> jedan dirCode (npr. "P-D")
  const labelToDir = new Map();

  for (const k of keysForDirs) {
    const parts = k.split('_');
    if (parts.length < 2) continue;

    const dirCode = parts[1];
    if (!dirCode) continue;

    const destCode = destCodeFromDir(dirCode); // npr. "G" ili "P"
    if (destCode === 'G' || destCode === 'P') continue; // ⛔ makni iz dropdowna

    const label = dirLabel(dirCode); // npr. "Dubrava"
    if (!label || label === 'undefined') continue;

    // zadrži prvi (ili možeš staviti pravilo prioriteta)
    if (!labelToDir.has(label)) labelToDir.set(label, dirCode);
  }

  // 2) sortiraj po labelu i generiraj options
  const labelsSorted = Array.from(labelToDir.keys())
    .sort((a, b) => a.localeCompare(b, 'hr'));

  dirSel.innerHTML =
    `<option value="">Prikaz svih smjerova</option>` +
    labelsSorted
      .map(lbl => `<option value="${labelToDir.get(lbl)}">${lbl}</option>`)
      .join('');
}

  lineSel.addEventListener('change', populateDirs);
  populateDirs();

clearBtn.addEventListener('click', () => {
  // reset linije i smjera
  lineSel.value = '';
  populateDirs();
  dirSel.value = '';

  // reset stanice (OVO JE KLJUČNO)
  stationSel.value = '';

  // ukloni marker stanice + popup
  if (typeof clearStationSelection === 'function') {
    clearStationSelection();
  }
});

}

  ensureFilterUI();

  /* ================= NETWORK HIGHLIGHT ================= */

  function highlightNetwork(routeKey) {
    if (!window.layer_TramvajskamreaopineGrude_1) return;
    window.layer_TramvajskamreaopineGrude_1.eachLayer((l) => {
      const segs = String(l.feature?.properties?.Segmenti ?? '');
      const has = segs.split(',').map(s => s.trim()).includes(routeKey);
      l.setStyle({
        color: has ? 'red' : 'rgba(0,0,0,1.0)',
        weight: has ? 5.0 : 2.0,
        opacity: 1
      });
    });
  }

  function resetNetworkHighlight() {
    if (!window.layer_TramvajskamreaopineGrude_1) return;
    window.layer_TramvajskamreaopineGrude_1.eachLayer((l) => {
      l.setStyle({ color: 'rgba(0,0,0,1.0)', weight: 2.0, opacity: 1 });
    });
  }

    /* ================= STATION SELECTION LAYER ================= */

  const stationLayer = L.layerGroup().addTo(map);

  function clearStationSelection() {
    stationLayer.clearLayers();
    const info = document.getElementById('betaStationInfo');
    if (info) info.textContent = 'Prikaži sve stanice';
  }

  /* ================= VEHICLE INDEX ================= */

  const tripsByVehicle = new Map();
  for (const tr of trips) {
    if (!tripsByVehicle.has(tr.vozilo)) tripsByVehicle.set(tr.vozilo, []);
    tripsByVehicle.get(tr.vozilo).push(tr);
  }
  for (const arr of tripsByVehicle.values()) arr.sort((a, b) => a._t0 - b._t0);

  function findPrevNext(arr, t) {
    let prev = null, next = null;
    for (const tr of arr) {
      if (tr._t0 <= t) prev = tr;
      if (tr._t0 > t) { next = tr; break; }
    }
    return { prev, next };
  }

  function getNextStopName(routeKey, frac) {
    const ids = routeStations.get(routeKey);
    if (!ids || ids.length < 2) return null;
    const idx = Math.min(ids.length - 1, Math.max(1, Math.floor(frac * (ids.length - 1))));
    const st = stationById.get(String(ids[idx]));
    return st?.name || null;
  }

  /* ================= RENDER LOOP ================= */

  const layer = L.layerGroup().addTo(map);
  const markers = new Map();

  let selectedVehicleId = null;
  let selectedRouteKey = null;

  // pamti zadnju aktivnu rutu po vozilu (da se ne mijenja na okretištu)
const lastRouteKeyByVehicle = new Map();
// pamti zadnji aktivni polazak (t0) po vozilu – da znamo kad je krenula NOVA vožnja
const lastActiveT0ByVehicle = new Map();
// pamti zadnju POZNATU POZICIJU po vozilu (bitno za liniju 5)
const lastPosByVehicle = new Map();


  function render() {
    const t = nowSec();

    const clk = document.getElementById('betaClock');
if (clk) clk.textContent = formatDateTime();

    const lineSel = document.getElementById('betaLineSel');
    const dirSel = document.getElementById('betaDirSel');
    const selectedLine = lineSel?.value || '';
    const selectedDir = dirSel?.value || '';
    const selectedRouteKeyFilter = (selectedLine && selectedDir) ? `${selectedLine}_${selectedDir}` : '';

    if (!selectedVehicleId) resetNetworkHighlight();

    for (const [vozilo, arr] of tripsByVehicle.entries()) {
       let pos = null;
  let ang = 0;
  let showArrow = false;
  let trForLabel = null;
  let rk = null;
  let popupState = null;
      // 🔴 PRVO: postoji li AKTIVNA vožnja (bez ikakvog filtriranja)
let activeAny = null;
for (let i = arr.length - 1; i >= 0; i--) {
  const trX = arr[i];
  if (!tripAllowedNow(trX, t)) continue;
  if (isActiveTrip(trX, t)) { activeAny = trX; break; }
}




      // 1) filtriraj tripove po prometnim pravilima (za OVAJ trenutak)
const arrAllowed = arr.filter(tr => tripAllowedNow(tr, t));
const arrService = arrAllowed;


      const lastRealTrip = arr[arr.length - 1] || null;
const lastRealKey = lastRealTrip ? pickRouteKeyForTrip(lastRealTrip) : null;

// Ako nema dopuštenih tripova,
// vozilo smije ostati VIDLJIVO samo ako je
// završilo u spremištu i još je unutar DEPOT_POST
// Ako nema dopuštenih tripova,
// ALI postoji aktivna vožnja → NE DIRAJ (pusti dalje)
if (!arrAllowed.length && !activeAny) {
  

  const prevAll = arr[arr.length - 1];
  const prevKey = prevAll ? pickRouteKeyForTrip(prevAll) : null;
  const endsDepot = prevAll && prevKey && isDepotEnd(prevKey);

  if (!endsDepot) {
    const existing = markers.get(vozilo);
    if (existing) {
      layer.removeLayer(existing);
      markers.delete(vozilo);
    }
    continue;
  }



  // ❌ prošlo više od 5 min od dolaska u spremište → briši
  if (t > prevAll._t1 + DEPOT_POST) {
    const existing = markers.get(vozilo);
    if (existing) {
      layer.removeLayer(existing);
      markers.delete(vozilo);
    }
    continue;
  }

  // ✔️ inače (još unutar 5 min) → pusti render dalje
}

      // 2) prev/next gledaj samo u dopuštenim tripovima
const { prev, next } = findPrevNext(arrService, t);
      // 🔒 FALLBACK: ako nema prev/next zbog arrAllowed,
// ali postoji stvarni zadnji završeni trip → STOJI NA OKRETIŠTU
// 🚫 VOZILO JE DANAS POTPUNO VAN PROMETA (npr. subota)
if (
  !arrAllowed.length &&
  !activeAny &&
  isVehicleDisabledToday(vozilo, arr[0]?.linija)
) {
  const ex = markers.get(vozilo);
  if (ex) {
    layer.removeLayer(ex);
    markers.delete(vozilo);
  }
  continue; // ⬅️ preskoči cijeli fallback
}

if (!prev && !next) {
  const lastFinished = arr
    .filter(tr => t >= tr._t1)
    .sort((a, b) => b._t1 - a._t1)[0];

  // ništa završeno → nema fallbacka
  if (!lastFinished) {
    // pusti dalje (ne postavljaj pos/rk/trForLabel)
  } else {
    // ⛔ P1/P2 (i P1S/P2S): ako danas nisu u prometu, nemoj ih "parkirati" na okretištu
 if (!tripAllowedNow(lastFinished, t)) {
  const ex = markers.get(vozilo);
  if (ex) { layer.removeLayer(ex); markers.delete(vozilo); }
  continue;
}


    const lastKey =
      lastRouteKeyByVehicle.get(vozilo) ||
      pickRouteKeyForTrip(lastFinished);

    if (lastKey && !isDepotEnd(lastKey)) {
      const rLast = buildRoute(lastKey);
      const endPos =
        rLast && rLast.poly && rLast.poly.length
          ? rLast.poly[rLast.poly.length - 1]
          : (lastPosByVehicle.get(vozilo) || null);

      if (endPos) {
        pos = endPos;
        rk = lastKey;
        trForLabel = lastFinished;
        showArrow = false;

        popupState = {
          mode: 'waiting',
          secondsLeft: null,
          routeKey: lastKey,
          networkRouteKey: lastKey,
          nextStopName: null
        };
      }
    }
  }
}


      // 3) active također samo u dopuštenim
let active = null;
for (let i = arr.length - 1; i >= 0; i--) {
  const tr = arr[i];
if (isActiveTrip(tr, t)) {
  active = tr;
  break;
}
}


if (active) {

  // ✅ Rutu vežemo uz KONKRETAN trip.
  // Prijašnja logika je znala "zalijepiti" stari routeKey (npr. depo-rutu)
  // pa bi kasnije cijeli dan prikazivala krivo odredište (npr. "... SPREMIŠTE").
  // Zato: kad se promijeni aktivni polazak (_t0), ponovno izračunaj routeKey.
  const lastT0 = lastActiveT0ByVehicle.get(vozilo);
  if (lastT0 !== active._t0) {
    const rkNew = pickRouteKeyForTrip(active);
    if (rkNew) {
      rk = rkNew;
      lastRouteKeyByVehicle.set(vozilo, rkNew);
    } else {
      rk = lastRouteKeyByVehicle.get(vozilo) || null;
    }
    lastActiveT0ByVehicle.set(vozilo, active._t0);
  } else {
    rk = lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(active);
    if (rk) lastRouteKeyByVehicle.set(vozilo, rk);
  }

  const r = rk ? buildRoute(rk) : null;
  trForLabel = active;

let frac = 0;

if (r && r.total > 0) {
  let tInTrip = t;
  if (active._t1 >= DAY && t < active._t0) tInTrip = t + DAY;

  const tRel = clamp(tInTrip - active._t0, 0, (active._t1 - active._t0)); // ukupno trajanje ostaje isto!

  const stationDists = getRouteStationDistances(rk);
  const nStops = stationDists ? stationDists.length : 0;

  // ukupno “stajanje” unutar vožnje
const dwellTotal = Math.max(0, (nStops - 2) * DWELL_TIME);

  // efektivno vrijeme kretanja (unutar ISTOG ukupnog trajanja)
  const runTime = Math.max(1, (active._t1 - active._t0) - dwellTotal);

  // 1) bazna udaljenost po ruti, kao da nema stajanja, ali sa skraćenim runTime
  let distNow = (tRel / (active._t1 - active._t0)) * r.total;

  // 2) ako imamo stanice, uvedi “stajanje” tako da u tim prozorima dist ostane na stanici
  if (stationDists && nStops >= 2) {
    // mapiranje vremena -> dist:
    // - kretanje se rastegne u runTime
    // - na svakoj stanici (osim prve) stoji DWELL_TIME
    //
    // Prvo: pretvori tRel u "run clock" tako da oduzme već odrađena stajanja
    let runClock = tRel;

    for (let i = 1; i < nStops; i++) {
      const stopDist = stationDists[i].dist;

      // vrijeme dolaska na ovu stanicu u "runTime" skali
      const arriveRun = (stopDist / r.total) * runTime;

      // stvarno vrijeme dolaska (dodaj stajanja prethodnih stanica)
      const arriveReal = arriveRun + (i - 1) * DWELL_TIME;

      // ako smo u prozoru stajanja -> zalijepi na dist stanice
      if (tRel >= arriveReal && tRel < arriveReal + DWELL_TIME) {
        distNow = stopDist;
        break;
      }

      // ako smo nakon stajanja, “runClock” za daljnje računanje treba ignorirati već odrađeno stajanje
      if (tRel >= arriveReal + DWELL_TIME) {
        runClock = tRel - i * DWELL_TIME;
      }
    }

    // ako nismo u stajanju, dist se računa iz runClock-a kroz runTime
    // (ali samo ako runClock nije “preko”)
    if (distNow !== (stationDists?.find(s => Math.abs(s.dist - distNow) < STOP_EPS)?.dist)) {
      const runFrac = clamp(runClock / runTime, 0, 1);
      distNow = runFrac * r.total;
    }
  }

  frac = clamp(distNow / r.total, 0, 1);

  const pt = pointAt(r, frac * r.total);
  pos = pt.latlng;
  ang = pt.angle;
  showArrow = true;

  if (pos) lastPosByVehicle.set(vozilo, pos);

} else {
  pos = rk ? (buildRoute(rk)?.poly?.[0] || null) : null;
  ang = 0;
  showArrow = true;
}

        // FORSIRAJ strelicu u vožnji
        showArrow = true;

 const distNow = (r && r.total > 0) ? (frac * r.total) : 0;
const nextStop = (rk && r && r.total > 0) ? getNextStopByDistance(rk, distNow) : null;

popupState = {
  mode: 'moving',
  secondsLeft: (active._t1 - t),

  routeKey: rk,          // tekst = normalno odredište
  networkRouteKey: rk,   // ruta = ista

  nextStopName: nextStop ? nextStop.name : null
};

} else if (prev && t >= prev._t1 && (!next || t < next._t0)) {

  // gdje je vozilo završilo (po zadnjoj vožnji)
  const prevKey =
    lastRouteKeyByVehicle.get(vozilo) ||
    pickRouteKeyForTrip(prev);

  const prevEndsDepot = prevKey && isDepotEnd(prevKey);

  const rPrev = prevKey ? buildRoute(prevKey) : null;
  const endPos = (rPrev && rPrev.poly && rPrev.poly.length)
    ? rPrev.poly[rPrev.poly.length - 1]
    : (lastPosByVehicle.get(vozilo) || null);

  // što slijedi (ako postoji) – TO pokazujemo u oznaci/popupu (npr. "5S SPREMIŠTE BEKIJA")
  const nextKey = next ? pickRouteKeyForTrip(next) : null;
  const labelTrip = next || prev;          // label na ikoni (linija) uzmi iz SLJEDEĆE vožnje ako postoji
  const textKey   = nextKey || prevKey;    // destinacija u popupu/filtru: sljedeća ruta, ako postoji

 // 🚋 OKRETIŠTE (nije spremište)
if (!prevEndsDepot) {

  // ⛔ ako NEMA sljedeće vožnje → makni i 1–5 (i sve ostale)
  if (!next) {
    pos = null;
    trForLabel = null;
    popupState = null;
  } else {
    pos = endPos;

    rk = textKey;
    trForLabel = labelTrip;
    showArrow = false;

    popupState = {
      mode: 'waiting',
      secondsLeft: (next._t0 - t),
      routeKey: rk,
      networkRouteKey: nextKey || prevKey,
      nextStopName: null
    };
  }
}


  // 🏠 SPREMIŠTE → vidljivo još DEPOT_POST nakon dolaska
  else if (prevEndsDepot && t <= prev._t1 + DEPOT_POST) {
    pos = endPos;

    rk = textKey;
    trForLabel = labelTrip;
    showArrow = false;

    popupState = {
      mode: 'waiting',
      secondsLeft: next ? (next._t0 - t) : null,
      routeKey: rk,
      networkRouteKey: rk,
      nextStopName: null,
      inDepot: true
    };
  }

  // 🔔 nakon DEPOT_POST u spremištu → sakrij, OSIM ako smo u DEPOT_PRE prije idućeg polaska iz spremišta
  else {
    const canPreShow = next && nextKey && isDepotStart(nextKey) && (t >= next._t0 - DEPOT_PRE) && (t < next._t0);
    if (canPreShow) {
      const rNext = buildRoute(nextKey);
      pos = (rNext && rNext.poly && rNext.poly.length) ? rNext.poly[0] : (endPos || null);

      rk = nextKey;
      trForLabel = next;     // pokaži baš ono što ide dalje (npr. 5S)
      showArrow = false;

      popupState = {
        mode: 'waiting',
        secondsLeft: (next._t0 - t),
        routeKey: rk,
        networkRouteKey: rk,
        nextStopName: null,
        inDepot: true
      };
    } else {
      pos = null;
      trForLabel = null;
      popupState = null;
    }
  }
}

      else if (!prev && next) {
        rk = pickRouteKeyForTrip(next);

        if (rk && isDepotStart(rk) && t >= next._t0 - DEPOT_PRE && t < next._t0) {
          const r = buildRoute(rk);

          pos = (r && r.poly && r.poly.length) ? r.poly[0] : null;
          trForLabel = next;
          showArrow = false;

          popupState = {
            mode: 'waiting',
            secondsLeft: (next._t0 - t),
            routeKey: rk,
            nextStopName: null
          };
        }
      }

      const existing = markers.get(vozilo);
      // 🔒 AKO POSTOJI AKTIVNA VOŽNJA (BEZ OBZIRA NA ALLOWED) – NE BRIŠI
if (!trForLabel && activeAny) {
  trForLabel = activeAny;
  popupState = {
    mode: 'moving',
    secondsLeft: (activeAny._t1 - t),
    routeKey: lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(activeAny),
    networkRouteKey: lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(activeAny),
    nextStopName: null
  };

  // fallback pozicija
  if (!pos) pos = lastPosByVehicle.get(vozilo) || null;
}

      
// ✅ AKO NEMA DOVOLJNO PODATAKA – SAMO PRESKOČI TICK
// 🧹 ako smo odlučili da se vozilo NE PRIKAZUJE → ukloni marker
if (!pos || !trForLabel || !popupState) {
  const existing = markers.get(vozilo);
  if (existing) {
    layer.removeLayer(existing);
    markers.delete(vozilo);
  }
  continue;
}



// 🔥 filtriranje po liniji (uključi i spremišne varijante tipa 9S)
if (selectedLine) {

  const rkLine = String(popupState.routeKey || '').split('_')[0]; // npr. 9 ili 9S
  const rkBase = rkLine.replace(/S$/, ''); // 9S -> 9

  if (rkBase !== selectedLine) {
    if (existing) { layer.removeLayer(existing); markers.delete(vozilo); }
    continue;
  }
}
      if (selectedDir && selectedRouteKeyFilter && (popupState.routeKey !== selectedRouteKeyFilter)) {
        if (existing) { layer.removeLayer(existing); markers.delete(vozilo); }
        continue;
      }

      const isSelected = (selectedVehicleId === vozilo);
      const iconColor = isSelected ? 'red' : BLUE;

      // dodatni safety: ako je moving, strelica mora biti true
      const arrowFinal = (popupState.mode === 'moving') ? true : !!showArrow;

const labelLine = displayLineForVehicle(trForLabel, popupState.routeKey);
const ic = makeVehicleIcon(labelLine, ang, arrowFinal, iconColor);

if (isSelected && (popupState.networkRouteKey || popupState.routeKey)) {
  highlightNetwork(popupState.networkRouteKey || popupState.routeKey);
}

      if (!existing) {
const m = L.marker(pos, {
  icon: ic,
  pane: 'vehiclePane'
}).addTo(layer);
        m.bindPopup(popupHtml(trForLabel, popupState));

m.on('click', (ev) => {
  L.DomEvent.stopPropagation(ev);
  selectedVehicleId = vozilo;

  selectedRouteKey =
    popupState.networkRouteKey || popupState.routeKey || null; // ⬅️ BITNO

  if (selectedRouteKey) highlightNetwork(selectedRouteKey);
  render();
  m.openPopup();
});

        markers.set(vozilo, m);
      } else {
        existing.setLatLng(pos);
        existing.setIcon(ic);
        existing.setPopupContent(popupHtml(trForLabel, popupState));
      }
    }
  }

  // ===== expose API for qgis2web station click (outside this IIFE) =====
window.BETA_API = {
  stationById,
  arrivalsForStation,
  clearStationSelection,
  stationLayer,
  nowSec,
  map
};

  render();

map.on('click', () => {
  selectedVehicleId = null;
  selectedRouteKey = null;
  resetNetworkHighlight();
  clearStationSelection();
  render();
});

  setInterval(render, 1000);
/* ================= MOBILE TRAM UI ================= */

(function setupMobileFilterToggle() {
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile()) return;

  const waitForFilter = setInterval(() => {
    const filter = document.getElementById('betaFilter');
    if (!filter) return;

    clearInterval(waitForFilter);

// onda sakrij
filter.style.display = 'none';
// 🔒 reset svih mogućih Leaflet pozicija
filter.style.left = '50%';
filter.style.right = 'auto';
filter.style.top = 'auto';
filter.style.bottom = '10px';
filter.style.transform = 'translateX(-50%)';
filter.style.width = '92%';
filter.style.maxWidth = '420px';


    // napravi tramvaj ikonu
    const btn = document.createElement('div');
    btn.innerHTML = '🚋';
    btn.title = 'Tramvajske linije';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: 'rgb(18,100,171)',
      color: '#fff',
      fontSize: '28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      zIndex: '1002',
      cursor: 'pointer',
      userSelect: 'none'
    });

    document.body.appendChild(btn);

    // toggle filtera
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      filter.style.display =
        filter.style.display === 'none' ? 'block' : 'none';
    });

    // klik izvan zatvara
    document.addEventListener('click', (e) => {
      if (
        filter.style.display === 'block' &&
        !filter.contains(e.target) &&
        !btn.contains(e.target)
      ) {
        filter.style.display = 'none';
      }
    });
  }, 100);
})();

  console.log(`[BETA] Loaded: ${routeStations.size} ruta, ${trips.length} polazaka, ${stationById.size} stanica.`);
})();
