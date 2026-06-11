const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_HOSTNAME);
const DB_SEED_PATH = path.join(__dirname, 'db.json');
const DB_PATH = process.env.DB_PATH || (IS_RENDER ? path.join('/tmp', 'db.json') : DB_SEED_PATH);
const UPLOADS_DIR = process.env.UPLOADS_DIR || (IS_RENDER ? path.join('/tmp', 'uploads') : path.join(__dirname, 'public', 'uploads'));

function ensureRuntimeDb() {
  if (DB_PATH === DB_SEED_PATH) return;
  if (fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(DB_SEED_PATH)) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(DB_SEED_PATH, DB_PATH);
}

// Create upload directory if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Configure Multer for team crest uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.png';
    cb(null, 'crest-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// JSON Database helper with sequential queue to prevent corruption
let dbQueue = Promise.resolve();
function readDb() {
  // #region debug-point A:read-db
  (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'server.js:readDb:entry',msg:'[DEBUG] readDb entry',data:{dbPath:DB_PATH,dbSeedPath:DB_SEED_PATH,isRender:IS_RENDER,dbExists:fs.existsSync(DB_PATH),seedExists:fs.existsSync(DB_SEED_PATH)},ts:Date.now()})}).catch(()=>{})})();
  // #endregion
  ensureRuntimeDb();
  if (!fs.existsSync(DB_PATH)) {
    // #region debug-point A:read-db-missing
    (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'server.js:readDb:missing',msg:'[DEBUG] readDb missing db file',data:{dbPath:DB_PATH},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    return null;
  }
  const data = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(data);
  // #region debug-point B:read-db-success
  (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'B',location:'server.js:readDb:parsed',msg:'[DEBUG] readDb parsed successfully',data:{hasUsers:Array.isArray(db?.users),hasMatches:Array.isArray(db?.matches),hasPredictions:Array.isArray(db?.predictions),hasSpecialPredictions:Array.isArray(db?.special_predictions),hasSettings:Boolean(db?.settings),hasTeams:Array.isArray(db?.teams)},ts:Date.now()})}).catch(()=>{})})();
  // #endregion
  
  // Initialize missing sections
  if (!db.predictions) db.predictions = [];
  if (!db.special_predictions) db.special_predictions = [];
  if (!db.settings) db.settings = {};
  if (db.settings.special_locked === undefined) db.settings.special_locked = false;
  if (!db.teams) db.teams = [];
  
  return db;
}

function writeDb(data) {
  return new Promise((resolve, reject) => {
    dbQueue = dbQueue.then(() => {
      try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Scoring logic
// 25 pts: Marcador exacto (acertaste ambos goles)
// 5 pts: Winner correcto (acertaste quién gana), sin goles correctos
// 6 pts: Winner correcto + 1 equipo con goles correctos
// 7 pts: Winner correcto + 2 equipos con goles correctos (pero no exacto)
// 1 pt: Winner incorrecto pero acertaste los goles de 1 equipo
function calculatePoints(predHome, predAway, actHome, actAway) {
  if (predHome === null || predAway === null || actHome === null || actAway === null) return 0;

  const exact = (predHome === actHome && predAway === actAway);
  if (exact) {
    return 25;
  }

  const predOutcome = Math.sign(predHome - predAway); // 1, -1, 0
  const actOutcome = Math.sign(actHome - actAway);
  const outcomeCorrect = (predOutcome === actOutcome);

  const homeGoalsCorrect = (predHome === actHome);
  const awayGoalsCorrect = (predAway === actAway);
  const goalsCorrectCount = (homeGoalsCorrect ? 1 : 0) + (awayGoalsCorrect ? 1 : 0);

  if (outcomeCorrect) {
    // Winner correcto: 5 puntos base + bonus por goles
    let points = 5;
    if (homeGoalsCorrect) points += 1;
    if (awayGoalsCorrect) points += 1;
    return points;
  } else {
    // Winner incorrecto: 1 punto si acertaste los goles de algún equipo
    if (goalsCorrectCount >= 1) {
      return 1;
    }
    return 0;
  }
}

// Recalculate all user scores based on actual matches and special predictions
function recalculateScores(db) {
  // Reset scores on users
  const userScores = {};
  db.users.forEach(u => {
    userScores[u.id] = {
      total: 0,
      exact: 0,
      outcomePlusGoals: 0,
      outcomeOnly: 0,
      goalsOnly: 0,
      specials: 0
    };
  });

  // Calculate match points
  db.matches.forEach(match => {
    if (match.status === 'played') {
      db.predictions.forEach(pred => {
        if (pred.match_id === match.id) {
          const pts = calculatePoints(pred.goals1, pred.goals2, match.goals1, match.goals2);
          pred.points = pts;
          
          if (userScores[pred.user_id]) {
            userScores[pred.user_id].total += pts;
            if (pts === 25) userScores[pred.user_id].exact++;
            else if (pts === 6) userScores[pred.user_id].outcomePlusGoals++;
            else if (pts === 5) userScores[pred.user_id].outcomeOnly++;
            else if (pts === 1) userScores[pred.user_id].goalsOnly++;
          }
        }
      });
    }
  });

  // Calculate special prediction points (champion and top scorer)
  const actualChampion = db.settings.champion;
  const actualTopScorer = db.settings.top_scorer ? db.settings.top_scorer.toLowerCase().trim() : '';

  db.special_predictions.forEach(spec => {
    let pts = 0;
    if (actualChampion && spec.champion_team && spec.champion_team.toLowerCase() === actualChampion.toLowerCase()) {
      spec.points_champion = 50;
      pts += 50;
    } else {
      spec.points_champion = 0;
    }

    if (actualTopScorer && spec.top_scorer && spec.top_scorer.toLowerCase().trim() === actualTopScorer) {
      spec.points_top_scorer = 50;
      pts += 50;
    } else {
      spec.points_top_scorer = 0;
    }

    if (userScores[spec.user_id]) {
      userScores[spec.user_id].specials += pts;
      userScores[spec.user_id].total += pts;
    }
  });

  // Write updated totals back to users list
  db.users.forEach(u => {
    if (userScores[u.id]) {
      u.score_total = userScores[u.id].total;
      u.score_exact = userScores[u.id].exact;
      u.score_outcome_plus = userScores[u.id].outcomePlusGoals;
      u.score_outcome_only = userScores[u.id].outcomeOnly;
      u.score_goals_only = userScores[u.id].goalsOnly;
      u.score_specials = userScores[u.id].specials;
    }
  });
}

// Group definitions
const GROUPS_DATA = {
  'A': ['México', 'Sudáfrica', 'Corea del Sur', 'Chequia'],
  'B': ['Canadá', 'Bosnia y Herzegovina', 'Catar', 'Suiza'],
  'C': ['Brasil', 'Marruecos', 'Haití', 'Escocia'],
  'D': ['Estados Unidos', 'Paraguay', 'Australia', 'Turquía'],
  'E': ['Alemania', 'Curazao', 'Costa de Marfil', 'Ecuador'],
  'F': ['Países Bajos', 'Japón', 'Suecia', 'Túnez'],
  'G': ['Bélgica', 'Egipto', 'Irán', 'Nueva Zelanda'],
  'H': ['España', 'Cabo Verde', 'Arabia Saudita', 'Uruguay'],
  'I': ['Francia', 'Senegal', 'Irak', 'Noruega'],
  'J': ['Argentina', 'Argelia', 'Austria', 'Jordania'],
  'K': ['Portugal', 'República Democrática del Congo', 'Uzbekistán', 'Colombia'],
  'L': ['Inglaterra', 'Croacia', 'Ghana', 'Panamá']
};

// Seeding function
function initializeDatabase() {
  ensureRuntimeDb();
  if (fs.existsSync(DB_PATH)) {
    // Check if the database has the initial structure, if so just return
    try {
      const db = readDb();
      if (db && db.users && db.matches && db.predictions) {
        return;
      }
    } catch(e) {
      console.log("Database parsing error, reseeding...");
    }
  }

  console.log("Initializing database with teams and schedule...");
  const db = {
    users: [],
    matches: [],
    predictions: [],
    special_predictions: [],
    settings: {
      champion: null,
      top_scorer: null,
      tournament_start_time: "2026-06-11T18:00:00Z", // June 11, 2026 - Opening match: Mexico vs South Africa
      special_locked: false
    },
    teams: []
  };

    // =====================================================
  // COMPLETE 2026 WORLD CUP GROUP STAGE SCHEDULE
  // Times in UTC (CEST = UTC+2, subtract 2h from Madrid time)
  // =====================================================

  const allGroupMatches = [
    // ===== JUNE 11 =====
    { id: 'G-A-1', stage: 'group', group_name: 'A', team1: 'Mexico', team2: 'Sudafrica', match_date: '2026-06-11T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 12 =====
    { id: 'G-A-2', stage: 'group', group_name: 'A', team1: 'Corea del Sur', team2: 'Chequia', match_date: '2026-06-12T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-B-1', stage: 'group', group_name: 'B', team1: 'Canada', team2: 'Bosnia y Herzegovina', match_date: '2026-06-12T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 13 =====
    { id: 'G-D-1', stage: 'group', group_name: 'D', team1: 'Estados Unidos', team2: 'Paraguay', match_date: '2026-06-13T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-B-2', stage: 'group', group_name: 'B', team1: 'Catar', team2: 'Suiza', match_date: '2026-06-13T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 14 =====
    { id: 'G-C-1', stage: 'group', group_name: 'C', team1: 'Brasil', team2: 'Marruecos', match_date: '2026-06-13T22:00:00Z' }, // 00:00 Madrid Jun 14
    { id: 'G-C-2', stage: 'group', group_name: 'C', team1: 'Haiti', team2: 'Escocia', match_date: '2026-06-14T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-D-2', stage: 'group', group_name: 'D', team1: 'Australia', team2: 'Turquia', match_date: '2026-06-14T04:00:00Z' }, // 06:00 Madrid
    { id: 'G-E-1', stage: 'group', group_name: 'E', team1: 'Alemania', team2: 'Curazao', match_date: '2026-06-14T17:00:00Z' }, // 19:00 Madrid
    { id: 'G-F-1', stage: 'group', group_name: 'F', team1: 'Paises Bajos', team2: 'Japon', match_date: '2026-06-14T20:00:00Z' }, // 22:00 Madrid

    // ===== JUNE 15 =====
    { id: 'G-E-2', stage: 'group', group_name: 'E', team1: 'Costa de Marfil', team2: 'Ecuador', match_date: '2026-06-14T23:00:00Z' }, // 01:00 Madrid Jun 15
    { id: 'G-F-2', stage: 'group', group_name: 'F', team1: 'Suecia', team2: 'Tunez', match_date: '2026-06-15T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-H-1', stage: 'group', group_name: 'H', team1: 'Espania', team2: 'Cabo Verde', match_date: '2026-06-15T16:00:00Z' }, // 18:00 Madrid
    { id: 'G-G-1', stage: 'group', group_name: 'G', team1: 'Belgica', team2: 'Egipto', match_date: '2026-06-15T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 16 =====
    { id: 'G-H-2', stage: 'group', group_name: 'H', team1: 'Arabia Saudita', team2: 'Uruguay', match_date: '2026-06-15T22:00:00Z' }, // 00:00 Madrid Jun 16
    { id: 'G-G-2', stage: 'group', group_name: 'G', team1: 'Iran', team2: 'Nueva Zelanda', match_date: '2026-06-16T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-K-1', stage: 'group', group_name: 'K', team1: 'Portugal', team2: 'Republica Democratica del Congo', match_date: '2026-06-16T17:00:00Z' }, // 19:00 Madrid
    { id: 'G-I-1', stage: 'group', group_name: 'I', team1: 'Francia', team2: 'Senegal', match_date: '2026-06-16T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 17 =====
    { id: 'G-I-2', stage: 'group', group_name: 'I', team1: 'Irak', team2: 'Noruega', match_date: '2026-06-16T22:00:00Z' }, // 00:00 Madrid Jun 17
    { id: 'G-J-1', stage: 'group', group_name: 'J', team1: 'Argentina', team2: 'Argelia', match_date: '2026-06-17T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-J-2', stage: 'group', group_name: 'J', team1: 'Austria', team2: 'Jordania', match_date: '2026-06-17T04:00:00Z' }, // 06:00 Madrid
    { id: 'G-L-1', stage: 'group', group_name: 'L', team1: 'Inglaterra', team2: 'Croacia', match_date: '2026-06-17T20:00:00Z' }, // 22:00 Madrid

    // ===== JUNE 18 =====
    { id: 'G-L-2', stage: 'group', group_name: 'L', team1: 'Ghana', team2: 'Panama', match_date: '2026-06-17T23:00:00Z' }, // 01:00 Madrid Jun 18
    { id: 'G-K-2', stage: 'group', group_name: 'K', team1: 'Uzbekistan', team2: 'Colombia', match_date: '2026-06-18T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-A-3', stage: 'group', group_name: 'A', team1: 'Chequia', team2: 'Sudafrica', match_date: '2026-06-18T16:00:00Z' }, // 18:00 Madrid
    { id: 'G-B-3', stage: 'group', group_name: 'B', team1: 'Suiza', team2: 'Bosnia y Herzegovina', match_date: '2026-06-18T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 19 =====
    { id: 'G-B-4', stage: 'group', group_name: 'B', team1: 'Canada', team2: 'Catar', match_date: '2026-06-18T22:00:00Z' }, // 00:00 Madrid Jun 19
    { id: 'G-A-4', stage: 'group', group_name: 'A', team1: 'Mexico', team2: 'Corea del Sur', match_date: '2026-06-19T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-D-3', stage: 'group', group_name: 'D', team1: 'Estados Unidos', team2: 'Australia', match_date: '2026-06-19T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 20 =====
    { id: 'G-C-3', stage: 'group', group_name: 'C', team1: 'Escocia', team2: 'Marruecos', match_date: '2026-06-19T22:00:00Z' }, // 00:00 Madrid Jun 20
    { id: 'G-C-4', stage: 'group', group_name: 'C', team1: 'Brasil', team2: 'Haiti', match_date: '2026-06-20T00:30:00Z' }, // 02:30 Madrid
    { id: 'G-D-4', stage: 'group', group_name: 'D', team1: 'Turquia', team2: 'Paraguay', match_date: '2026-06-20T03:00:00Z' }, // 05:00 Madrid
    { id: 'G-F-3', stage: 'group', group_name: 'F', team1: 'Paises Bajos', team2: 'Suecia', match_date: '2026-06-20T17:00:00Z' }, // 19:00 Madrid
    { id: 'G-E-3', stage: 'group', group_name: 'E', team1: 'Alemania', team2: 'Costa de Marfil', match_date: '2026-06-20T20:00:00Z' }, // 22:00 Madrid

    // ===== JUNE 21 =====
    { id: 'G-E-4', stage: 'group', group_name: 'E', team1: 'Ecuador', team2: 'Curazao', match_date: '2026-06-21T00:00:00Z' }, // 02:00 Madrid
    { id: 'G-F-4', stage: 'group', group_name: 'F', team1: 'Tunez', team2: 'Japon', match_date: '2026-06-21T04:00:00Z' }, // 06:00 Madrid
    { id: 'G-H-3', stage: 'group', group_name: 'H', team1: 'Espania', team2: 'Arabia Saudita', match_date: '2026-06-21T16:00:00Z' }, // 18:00 Madrid
    { id: 'G-G-3', stage: 'group', group_name: 'G', team1: 'Belgica', team2: 'Iran', match_date: '2026-06-21T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 22 =====
    { id: 'G-H-4', stage: 'group', group_name: 'H', team1: 'Uruguay', team2: 'Cabo Verde', match_date: '2026-06-21T22:00:00Z' }, // 00:00 Madrid Jun 22
    { id: 'G-G-4', stage: 'group', group_name: 'G', team1: 'Nueva Zelanda', team2: 'Egipto', match_date: '2026-06-22T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-J-3', stage: 'group', group_name: 'J', team1: 'Argentina', team2: 'Austria', match_date: '2026-06-22T17:00:00Z' }, // 19:00 Madrid
    { id: 'G-I-3', stage: 'group', group_name: 'I', team1: 'Francia', team2: 'Irak', match_date: '2026-06-22T21:00:00Z' }, // 23:00 Madrid

    // ===== JUNE 23 =====
    { id: 'G-I-4', stage: 'group', group_name: 'I', team1: 'Noruega', team2: 'Senegal', match_date: '2026-06-23T00:00:00Z' }, // 02:00 Madrid
    { id: 'G-J-4', stage: 'group', group_name: 'J', team1: 'Jordania', team2: 'Argelia', match_date: '2026-06-23T03:00:00Z' }, // 05:00 Madrid
    { id: 'G-K-3', stage: 'group', group_name: 'K', team1: 'Portugal', team2: 'Uzbekistan', match_date: '2026-06-23T17:00:00Z' }, // 19:00 Madrid
    { id: 'G-L-3', stage: 'group', group_name: 'L', team1: 'Inglaterra', team2: 'Ghana', match_date: '2026-06-23T20:00:00Z' }, // 22:00 Madrid

    // ===== JUNE 24 - Simultaneous matches =====
    { id: 'G-B-5', stage: 'group', group_name: 'B', team1: 'Suiza', team2: 'Canada', match_date: '2026-06-24T19:00:00Z' }, // 21:00 Madrid
    { id: 'G-B-6', stage: 'group', group_name: 'B', team1: 'Bosnia y Herzegovina', team2: 'Catar', match_date: '2026-06-24T19:00:00Z' }, // 21:00 Madrid
    { id: 'G-L-4', stage: 'group', group_name: 'L', team1: 'Panama', team2: 'Croacia', match_date: '2026-06-24T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 25 - Simultaneous matches =====
    { id: 'G-C-5', stage: 'group', group_name: 'C', team1: 'Escocia', team2: 'Brasil', match_date: '2026-06-24T22:00:00Z' }, // 00:00 Madrid Jun 25
    { id: 'G-C-6', stage: 'group', group_name: 'C', team1: 'Marruecos', team2: 'Haiti', match_date: '2026-06-24T22:00:00Z' }, // 00:00 Madrid Jun 25
    { id: 'G-A-5', stage: 'group', group_name: 'A', team1: 'Sudafrica', team2: 'Corea del Sur', match_date: '2026-06-25T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-A-6', stage: 'group', group_name: 'A', team1: 'Chequia', team2: 'Mexico', match_date: '2026-06-25T01:00:00Z' }, // 03:00 Madrid
    { id: 'G-E-5', stage: 'group', group_name: 'E', team1: 'Ecuador', team2: 'Alemania', match_date: '2026-06-25T20:00:00Z' }, // 22:00 Madrid
    { id: 'G-E-6', stage: 'group', group_name: 'E', team1: 'Curazao', team2: 'Costa de Marfil', match_date: '2026-06-25T20:00:00Z' }, // 22:00 Madrid

    // ===== JUNE 26 - Simultaneous matches =====
    { id: 'G-F-5', stage: 'group', group_name: 'F', team1: 'Tunez', team2: 'Paises Bajos', match_date: '2026-06-25T23:00:00Z' }, // 01:00 Madrid Jun 26
    { id: 'G-F-6', stage: 'group', group_name: 'F', team1: 'Japon', team2: 'Suecia', match_date: '2026-06-25T23:00:00Z' }, // 01:00 Madrid Jun 26
    { id: 'G-D-5', stage: 'group', group_name: 'D', team1: 'Paraguay', team2: 'Australia', match_date: '2026-06-26T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-D-6', stage: 'group', group_name: 'D', team1: 'Turquia', team2: 'Estados Unidos', match_date: '2026-06-26T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-I-5', stage: 'group', group_name: 'I', team1: 'Noruega', team2: 'Francia', match_date: '2026-06-26T19:00:00Z' }, // 21:00 Madrid
    { id: 'G-I-6', stage: 'group', group_name: 'I', team1: 'Senegal', team2: 'Irak', match_date: '2026-06-26T19:00:00Z' }, // 21:00 Madrid

    // ===== JUNE 27 - Simultaneous matches =====
    { id: 'G-H-5', stage: 'group', group_name: 'H', team1: 'Uruguay', team2: 'Espania', match_date: '2026-06-27T00:00:00Z' }, // 02:00 Madrid
    { id: 'G-H-6', stage: 'group', group_name: 'H', team1: 'Cabo Verde', team2: 'Arabia Saudita', match_date: '2026-06-27T00:00:00Z' }, // 02:00 Madrid
    { id: 'G-G-5', stage: 'group', group_name: 'G', team1: 'Egipto', team2: 'Iran', match_date: '2026-06-27T03:00:00Z' }, // 05:00 Madrid
    { id: 'G-G-6', stage: 'group', group_name: 'G', team1: 'Nueva Zelanda', team2: 'Belgica', match_date: '2026-06-27T03:00:00Z' }, // 05:00 Madrid
    { id: 'G-L-5', stage: 'group', group_name: 'L', team1: 'Panama', team2: 'Inglaterra', match_date: '2026-06-27T21:00:00Z' }, // 23:00 Madrid
    { id: 'G-L-6', stage: 'group', group_name: 'L', team1: 'Croacia', team2: 'Ghana', match_date: '2026-06-27T21:00:00Z' }, // 23:00 Madrid

    // ===== JUNE 28 - Final group stage day =====
    { id: 'G-K-4', stage: 'group', group_name: 'K', team1: 'Republica Democratica del Congo', team2: 'Uzbekistan', match_date: '2026-06-27T23:30:00Z' }, // 01:30 Madrid Jun 28
    { id: 'G-K-5', stage: 'group', group_name: 'K', team1: 'Colombia', team2: 'Portugal', match_date: '2026-06-27T23:30:00Z' }, // 01:30 Madrid Jun 28
    { id: 'G-J-5', stage: 'group', group_name: 'J', team1: 'Argelia', team2: 'Austria', match_date: '2026-06-28T02:00:00Z' }, // 04:00 Madrid
    { id: 'G-J-6', stage: 'group', group_name: 'J', team1: 'Jordania', team2: 'Argentina', match_date: '2026-06-28T02:00:00Z' }, // 04:00 Madrid
  ];

  allGroupMatches.forEach(m => {
    db.matches.push({ ...m, goals1: null, goals2: null, status: 'scheduled' });
  });

  db.matches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

  db.matches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

  // Generate Knockout Stage Placeholders (32 matches total)
  // Round of 32 (16 matches)
  const r32Placeholders = [
    { t1: '2º Grupo A', t2: '2º Grupo B', date: '2026-06-28T18:00:00Z' },
    { t1: '1º Grupo C', t2: '2º Grupo F', date: '2026-06-28T21:00:00Z' },
    { t1: '1º Grupo E', t2: '3º Grupo A/B/C/D/F', date: '2026-06-29T18:00:00Z' },
    { t1: '1º Grupo F', t2: '2º Grupo C', date: '2026-06-29T21:00:00Z' },
    { t1: '2º Grupo E', t2: '2º Grupo I', date: '2026-06-30T18:00:00Z' },
    { t1: '1º Grupo I', t2: '3º Grupo C/D/F/G/H', date: '2026-06-30T21:00:00Z' },
    { t1: '1º Grupo A', t2: '3º Grupo C/E/F/H/I', date: '2026-07-01T18:00:00Z' },
    { t1: '1º Grupo L', t2: '3º Grupo E/H/I/J/K', date: '2026-07-01T21:00:00Z' },
    { t1: '1º Grupo G', t2: '3º Grupo A/E/H/I/J', date: '2026-07-02T18:00:00Z' },
    { t1: '1º Grupo D', t2: '3º Grupo B/E/F/I/J', date: '2026-07-02T21:00:00Z' },
    { t1: '1º Grupo H', t2: '2º Grupo J', date: '2026-07-03T18:00:00Z' },
    { t1: '2º Grupo K', t2: '2º Grupo L', date: '2026-07-03T21:00:00Z' },
    { t1: '1º Grupo B', t2: '3º Grupo E/F/G/I/J', date: '2026-07-04T18:00:00Z' },
    { t1: '2º Grupo D', t2: '2º Grupo G', date: '2026-07-04T21:00:00Z' },
    { t1: '1º Grupo J', t2: '2º Grupo H', date: '2026-07-05T18:00:00Z' },
    { t1: '1º Grupo K', t2: '3º Grupo D/E/I/J/L', date: '2026-07-05T21:00:00Z' }
  ];

  r32Placeholders.forEach((p, idx) => {
    db.matches.push({
      id: `R32-${idx + 1}`,
      stage: 'R32',
      group_name: null,
      team1: p.t1,
      team2: p.t2,
      goals1: null,
      goals2: null,
      penalty1: null,
      penalty2: null,
      match_date: p.date,
      status: 'scheduled'
    });
  });

  // Round of 16 (8 matches)
  for (let i = 1; i <= 8; i++) {
    db.matches.push({
      id: `R16-${i}`,
      stage: 'R16',
      group_name: null,
      team1: `Ganador R32-${(i * 2) - 1}`,
      team2: `Ganador R32-${i * 2}`,
      goals1: null,
      goals2: null,
      penalty1: null,
      penalty2: null,
      match_date: new Date(new Date("2026-07-06T18:00:00Z").getTime() + (i * 12 * 60 * 60 * 1000)).toISOString(),
      status: 'scheduled'
    });
  }

  // Quarterfinals (4 matches)
  for (let i = 1; i <= 4; i++) {
    db.matches.push({
      id: `QF-${i}`,
      stage: 'QF',
      group_name: null,
      team1: `Ganador R16-${(i * 2) - 1}`,
      team2: `Ganador R16-${i * 2}`,
      goals1: null,
      goals2: null,
      penalty1: null,
      penalty2: null,
      match_date: new Date(new Date("2026-07-11T18:00:00Z").getTime() + (i * 24 * 60 * 60 * 1000)).toISOString(),
      status: 'scheduled'
    });
  }

  // Semifinals (2 matches)
  db.matches.push({
    id: 'SF-1',
    stage: 'SF',
    group_name: null,
    team1: 'Ganador QF-1',
    team2: 'Ganador QF-2',
    goals1: null,
    goals2: null,
    penalty1: null,
    penalty2: null,
    match_date: '2026-07-15T20:00:00Z',
    status: 'scheduled'
  });
  db.matches.push({
    id: 'SF-2',
    stage: 'SF',
    group_name: null,
    team1: 'Ganador QF-3',
    team2: 'Ganador QF-4',
    goals1: null,
    goals2: null,
    penalty1: null,
    penalty2: null,
    match_date: '2026-07-16T20:00:00Z',
    status: 'scheduled'
  });

  // Third Place Play-off (1 match)
  db.matches.push({
    id: '3RD',
    stage: '3RD',
    group_name: null,
    team1: 'Perdedor SF-1',
    team2: 'Perdedor SF-2',
    goals1: null,
    goals2: null,
    penalty1: null,
    penalty2: null,
    match_date: '2026-07-18T18:00:00Z',
    status: 'scheduled'
  });

  // Final (1 match)
  db.matches.push({
    id: 'FINAL',
    stage: 'FINAL',
    group_name: null,
    team1: 'Ganador SF-1',
    team2: 'Ganador SF-2',
    goals1: null,
    goals2: null,
    penalty1: null,
    penalty2: null,
    match_date: '2026-07-19T18:00:00Z',
    status: 'scheduled'
  });

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log("Database initialized successfully!");
}

// Run DB Initialization
initializeDatabase();

// Auth helper middleware
function authUser(req, res, next) {
  const username = req.headers['x-username'];
  const accessCode = req.headers['x-access-code'];

  if (!username || !accessCode) {
    return res.status(401).json({ error: 'Falta identificación de usuario' });
  }

  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.access_code === accessCode);

  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.user = user;
  next();
}

function authAdmin(req, res, next) {
  const username = req.headers['x-username'];
  const accessCode = req.headers['x-access-code'];

  if (!username || !accessCode) {
    return res.status(401).json({ error: 'Faltan credenciales de administrador' });
  }

  if (username === 'prisma' && accessCode === 'prisma') {
    req.user = { id: 0, username: 'prisma', fullname: 'Administrador', is_admin: true };
    return next();
  }

  // Also check if they are flagged as admin in DB
  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.access_code === accessCode);

  if (user && user.is_admin) {
    req.user = user;
    return next();
  }

  return res.status(403).json({ error: 'Acceso denegado. Se requiere administrador.' });
}

// --- API ROUTES ---

// Get list of teams
app.get('/api/teams', (req, res) => {
  const teams = [];
  Object.keys(GROUPS_DATA).forEach(grp => {
    GROUPS_DATA[grp].forEach(team => {
      teams.push({ name: team, group: grp });
    });
  });
  teams.sort((a, b) => a.name.localeCompare(b.name));
  res.json(teams);
});

// User registration
app.post('/api/register', (req, res, next) => {
  upload.single('crest')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'La imagen es demasiado grande. Máximo 5MB.' });
    }
    if (err) {
      return res.status(400).json({ error: 'Error al subir la imagen: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { username, fullname, team_name, access_code } = req.body;

    if (!username || !fullname || !team_name || !access_code) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.toLowerCase() === 'prisma') {
      return res.status(400).json({ error: 'El nombre de usuario "prisma" está reservado para el administrador' });
    }

    const db = readDb();

    // Check if username already exists
    const userExists = db.users.some(u => u.username.toLowerCase() === trimmedUsername.toLowerCase());
    if (userExists) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });
    }

    // Check if access_code is already in use
    const codeExists = db.users.some(u => u.access_code === access_code.trim());
    if (codeExists) {
      return res.status(400).json({ error: 'Este código de acceso ya está en uso. Elige otro diferente.' });
    }

    // Shield path
    let crestPath = '/uploads/default-crest.png';
    if (req.file) {
      crestPath = '/uploads/' + req.file.filename;
    }

    // Admin user: if access_code is 'prisma', user becomes admin
    const isAdminUser = (access_code.trim().toLowerCase() === 'prisma');

    const newUser = {
      id: db.users.length + 1,
      username: trimmedUsername,
      fullname: fullname.trim(),
      team_name: team_name.trim(),
      team_crest: crestPath,
      access_code: access_code.trim(),
      is_admin: isAdminUser,
      score_total: 0,
      score_exact: 0,
      score_outcome_plus: 0,
      score_outcome_only: 0,
      score_goals_only: 0,
      score_specials: 0,
      created_at: new Date().toISOString()
    };

    db.users.push(newUser);

    // Initialize special predictions slot
    db.special_predictions.push({
      user_id: newUser.id,
      champion_team: null,
      top_scorer: null,
      points_champion: 0,
      points_top_scorer: 0
    });

    await writeDb(db);

    res.json({
      success: true,
      user: {
        username: newUser.username,
        fullname: newUser.fullname,
        team_name: newUser.team_name,
        team_crest: newUser.team_crest
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor al registrar usuario' });
  }
});

// Login (verify credentials)
app.post('/api/login', (req, res) => {
  const { username, access_code } = req.body;
  if (!username || !access_code) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }

  const trimmedUsername = username.trim().toLowerCase();
  const code = access_code.trim();

  // Special Admin case: username 'prisma' with code 'prisma'
  if (trimmedUsername === 'prisma' && code === 'prisma') {
    const db = readDb();
    let adminUser = db.users.find(u => u.username.toLowerCase() === 'prisma');
    if (!adminUser) {
      adminUser = {
        id: 999,
        username: 'prisma',
        fullname: 'Administrador (Prisma)',
        team_name: 'Team Prisma',
        team_crest: '/uploads/default-crest.png',
        access_code: 'prisma',
        is_admin: true,
        score_total: 0, score_exact: 0, score_outcome_plus: 0,
        score_outcome_only: 0, score_goals_only: 0, score_specials: 0,
        created_at: new Date().toISOString()
      };
      db.users.push(adminUser);
      db.special_predictions.push({ user_id: 999, champion_team: null, top_scorer: null, points_champion: 0, points_top_scorer: 0 });
      writeDb(db).then(() => {
        res.json({ success: true, user: { id: 999, username: 'prisma', fullname: adminUser.fullname, team_name: adminUser.team_name, team_crest: adminUser.team_crest, is_admin: true } });
      });
      return;
    } else {
      return res.json({ success: true, user: { id: adminUser.id, username: 'prisma', fullname: adminUser.fullname, team_name: adminUser.team_name, team_crest: adminUser.team_crest, is_admin: true } });
    }
  }

  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === trimmedUsername && u.access_code === code);

  if (!user) {
    return res.status(400).json({ error: 'Usuario o código de acceso incorrecto' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      fullname: user.fullname,
      team_name: user.team_name,
      team_crest: user.team_crest,
      is_admin: user.is_admin === 1 || user.is_admin === true
    }
  });
});

// User: Update own profile (team_name, team_crest)
app.post('/api/profile/update', authUser, (req, res) => {
  try {
    const { team_name } = req.body;
    const db = readDb();
    const userId = req.user.id;
    const user = db.users.find(u => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Update team name if provided
    if (team_name && team_name.trim()) {
      user.team_name = team_name.trim();
    }
    
    // Handle crest upload if new file was uploaded
    if (req.file) {
      user.team_crest = '/uploads/' + req.file.filename;
    }
    
    writeDb(db).then(() => {
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          fullname: user.fullname,
          team_name: user.team_name,
          team_crest: user.team_crest,
          is_admin: user.is_admin
        }
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// User: Get own profile
app.get('/api/profile', authUser, (req, res) => {
  try {
    const db = readDb();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        team_name: user.team_name,
        team_crest: user.team_crest,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// Admin: Edit any user's prediction
app.post('/api/admin/edit-prediction', authAdmin, async (req, res) => {
  try {
    const { user_id, match_id, goals1, goals2 } = req.body;
    const db = readDb();

    const userId = parseInt(user_id, 10);
    const g1 = parseInt(goals1, 10);
    const g2 = parseInt(goals2, 10);

    if (!Number.isInteger(userId) || !match_id) {
      return res.status(400).json({ error: 'Usuario o partido inválido' });
    }
    if (!Number.isInteger(g1) || !Number.isInteger(g2) || g1 < 0 || g2 < 0) {
      return res.status(400).json({ error: 'Los goles deben ser números válidos' });
    }

    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const match = db.matches.find(m => m.id === match_id);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

    let pred = db.predictions.find(p => p.user_id === userId && p.match_id === match_id);
    if (!pred) {
      pred = {
        user_id: userId,
        match_id,
        goals1: g1,
        goals2: g2,
        points: 0
      };
      db.predictions.push(pred);
    } else {
      pred.goals1 = g1;
      pred.goals2 = g2;
    }

    recalculateScores(db);
    await writeDb(db);
    res.json({ success: true, prediction: pred });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Admin: Edit any user's special prediction
app.post('/api/admin/edit-special-prediction', authAdmin, async (req, res) => {
  try {
    const { user_id, champion_team, top_scorer } = req.body;
    const db = readDb();

    const userId = parseInt(user_id, 10);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Usuario inválido' });
    }

    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    let spec = db.special_predictions.find(sp => sp.user_id === userId);
    if (!spec) {
      spec = {
        user_id: userId,
        champion_team: null,
        top_scorer: null,
        points_champion: 0,
        points_top_scorer: 0
      };
      db.special_predictions.push(spec);
    }

    spec.champion_team = champion_team ? String(champion_team).trim() : null;
    spec.top_scorer = top_scorer ? String(top_scorer).trim() : null;

    recalculateScores(db);
    await writeDb(db);
    res.json({ success: true, special_prediction: spec });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar predicción especial' });
  }
});

// Check if predictions are locked for a match
function isMatchLocked(match) {
  const now = new Date();
  const matchDate = new Date(match.match_date);
  const lockTime = new Date(matchDate.getTime() - 5 * 60 * 1000); // 5 minutes before kickoff
  return now >= lockTime;
}

// Check if tournament has started (locks special predictions)
function isTournamentStarted(db) {
  const now = new Date();
  const start = new Date(db.settings.tournament_start_time || "2026-06-11T18:00:00Z");
  return now >= start;
}

function isGroupStageFinished(db) {
  // Check if all group stage matches are completed
  const groupMatches = db.matches.filter(m => m.stage === 'group');
  if (groupMatches.length === 0) return false;
  return groupMatches.every(m => m.status === 'played' || m.status === 'completed');
}

// Get all matches with current user's predictions
app.get('/api/matches', authUser, (req, res) => {
  const db = readDb();
  const userId = req.user.id;
  const isAdmin = req.user.is_admin;

  const matchesWithPred = db.matches.map(m => {
    const pred = db.predictions.find(p => p.match_id === m.id && p.user_id === userId);
    
    // For regular users, hide official result until match is completed
    // Admin sees all results
    const matchIsCompleted = m.status === 'played' || m.status === 'completed';
    const showResult = isAdmin || matchIsCompleted;

    return {
      id: m.id,
      stage: m.stage,
      group_name: m.group_name,
      team1: m.team1,
      team2: m.team2,
      goals1: showResult ? m.goals1 : null,
      goals2: showResult ? m.goals2 : null,
      penalty1: showResult ? m.penalty1 : null,
      penalty2: showResult ? m.penalty2 : null,
      status: m.status,
      match_date: m.match_date,
      is_locked: isMatchLocked(m),
      prediction: pred ? { goals1: pred.goals1, goals2: pred.goals2, points: pred.points } : null
    };
  });

  // Also fetch special predictions
  const special = db.special_predictions.find(sp => sp.user_id === userId) || { champion_team: null, top_scorer: null };
  const specialLocked = isGroupStageFinished(db) || db.settings.special_locked;
  const hasExistingSelection = special.champion_team !== null || special.top_scorer !== null;

  res.json({
    matches: matchesWithPred,
    special: {
      ...special,
      is_locked: specialLocked,
      has_existing_selection: hasExistingSelection
    }
  });
});

// Save match prediction
app.post('/api/predict', authUser, async (req, res) => {
  try {
    const { match_id, goals1, goals2 } = req.body;
    const userId = req.user.id;

    if (goals1 === undefined || goals2 === undefined || goals1 === '' || goals2 === '') {
      return res.status(400).json({ error: 'Marcador incompleto' });
    }

    const g1 = parseInt(goals1, 10);
    const g2 = parseInt(goals2, 10);

    if (isNaN(g1) || isNaN(g2) || g1 < 0 || g2 < 0) {
      return res.status(400).json({ error: 'Los goles deben ser números mayores o iguales a 0' });
    }

    const db = readDb();
    const match = db.matches.find(m => m.id === match_id);

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    // Cannot predict placeholder teams
    if (match.team1.includes('Grupo') || match.team1.includes('Ganador') || match.team1.includes('Perdedor') ||
        match.team2.includes('Grupo') || match.team2.includes('Ganador') || match.team2.includes('Perdedor')) {
      return res.status(400).json({ error: 'No se puede predecir un partido con equipos sin definir' });
    }

    if (isMatchLocked(match)) {
      return res.status(400).json({ error: 'La predicción está bloqueada. El partido comienza en menos de 5 minutos o ya se jugó.' });
    }

    // Upsert prediction
    let pred = db.predictions.find(p => p.match_id === match_id && p.user_id === userId);
    if (pred) {
      pred.goals1 = g1;
      pred.goals2 = g2;
    } else {
      pred = {
        user_id: userId,
        match_id: match_id,
        goals1: g1,
        goals2: g2,
        points: 0
      };
      db.predictions.push(pred);
    }

    await writeDb(db);
    res.json({ success: true, prediction: pred });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la predicción' });
  }
});

// Save special predictions (champion & top scorer)
app.post('/api/predict/special', authUser, async (req, res) => {
  try {
    const { champion_team, top_scorer } = req.body;
    const userId = req.user.id;

    const db = readDb();
    const specialLocked = isGroupStageFinished(db) || db.settings.special_locked;
    if (specialLocked) {
      return res.status(400).json({ error: 'Las predicciones especiales están bloqueadas (ha terminado la fase de grupos o el administrador lo ha bloqueado).' });
    }

    let spec = db.special_predictions.find(sp => sp.user_id === userId);
    if (!spec) {
      spec = {
        user_id: userId,
        champion_team: champion_team ? champion_team.trim() : null,
        top_scorer: top_scorer ? top_scorer.trim() : null,
        points_champion: 0,
        points_top_scorer: 0
      };
      db.special_predictions.push(spec);
    } else {
      if (champion_team !== undefined) spec.champion_team = champion_team ? champion_team.trim() : null;
      if (top_scorer !== undefined) spec.top_scorer = top_scorer ? top_scorer.trim() : null;
    }

    await writeDb(db);
    res.json({ success: true, special: spec });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar predicciones especiales' });
  }
});

// Get Leaderboard / Ranking
app.get('/api/ranking', (req, res) => {
  const db = readDb();
  
  // Sort users by score (descending)
  const ranking = db.users.map(u => {
    // Find special predictions
    const spec = db.special_predictions.find(sp => sp.user_id === u.id) || {};
    return {
      id: u.id,
      username: u.username,
      fullname: u.fullname,
      team_name: u.team_name,
      team_crest: u.team_crest,
      score_total: u.score_total || 0,
      score_exact: u.score_exact || 0,
      score_outcome_plus: u.score_outcome_plus || 0,
      score_outcome_only: u.score_outcome_only || 0,
      score_goals_only: u.score_goals_only || 0,
      score_specials: u.score_specials || 0,
      specials: {
        champion: spec.champion_team,
        top_scorer: spec.top_scorer
      }
    };
  }).sort((a, b) => b.score_total - a.score_total || b.score_exact - a.score_exact || a.fullname.localeCompare(b.fullname));

  res.json({
    ranking,
    tournament_started: isTournamentStarted(db)
  });
});

// Get detailed predictions of another user (only for locked/played matches)
app.get('/api/user-predictions/:targetUserId', authUser, (req, res) => {
  const targetUserId = parseInt(req.params.targetUserId, 10);
  const db = readDb();
  
  const targetUser = db.users.find(u => u.id === targetUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  // Filter predictions to only include locked matches
  const targetPreds = db.predictions.filter(p => p.user_id === targetUserId);
  const lockedPreds = [];

  db.matches.forEach(m => {
    const pred = targetPreds.find(p => p.match_id === m.id);
    const isLocked = isMatchLocked(m);

    if (pred && (isLocked || m.status === 'played')) {
      lockedPreds.push({
        match_id: m.id,
        team1: m.team1,
        team2: m.team2,
        goals1: pred.goals1,
        goals2: pred.goals2,
        points: pred.points
      });
    }
  });

  // Include special predictions only if tournament started
  const showSpecials = isTournamentStarted(db);
  const spec = db.special_predictions.find(sp => sp.user_id === targetUserId) || {};

  res.json({
    user: {
      username: targetUser.username,
      fullname: targetUser.fullname,
      team_name: targetUser.team_name,
      team_crest: targetUser.team_crest,
      score_total: targetUser.score_total || 0
    },
    predictions: lockedPreds,
    special: showSpecials ? {
      champion_team: spec.champion_team,
      top_scorer: spec.top_scorer,
      points_champion: spec.points_champion || 0,
      points_top_scorer: spec.points_top_scorer || 0
    } : null
  });
});

// --- ADMIN ROUTES ---

// Admin: Update match result & propagate bracket
const propagationMap = {
  'R32-1': { nextMatchId: 'R16-1', teamSlot: 'team1' },
  'R32-2': { nextMatchId: 'R16-1', teamSlot: 'team2' },
  'R32-3': { nextMatchId: 'R16-2', teamSlot: 'team1' },
  'R32-4': { nextMatchId: 'R16-2', teamSlot: 'team2' },
  'R32-5': { nextMatchId: 'R16-3', teamSlot: 'team1' },
  'R32-6': { nextMatchId: 'R16-3', teamSlot: 'team2' },
  'R32-7': { nextMatchId: 'R16-4', teamSlot: 'team1' },
  'R32-8': { nextMatchId: 'R16-4', teamSlot: 'team2' },
  'R32-9': { nextMatchId: 'R16-5', teamSlot: 'team1' },
  'R32-10': { nextMatchId: 'R16-5', teamSlot: 'team2' },
  'R32-11': { nextMatchId: 'R16-6', teamSlot: 'team1' },
  'R32-12': { nextMatchId: 'R16-6', teamSlot: 'team2' },
  'R32-13': { nextMatchId: 'R16-7', teamSlot: 'team1' },
  'R32-14': { nextMatchId: 'R16-7', teamSlot: 'team2' },
  'R32-15': { nextMatchId: 'R16-8', teamSlot: 'team1' },
  'R32-16': { nextMatchId: 'R16-8', teamSlot: 'team2' },
  
  'R16-1': { nextMatchId: 'QF-1', teamSlot: 'team1' },
  'R16-2': { nextMatchId: 'QF-1', teamSlot: 'team2' },
  'R16-3': { nextMatchId: 'QF-2', teamSlot: 'team1' },
  'R16-4': { nextMatchId: 'QF-2', teamSlot: 'team2' },
  'R16-5': { nextMatchId: 'QF-3', teamSlot: 'team1' },
  'R16-6': { nextMatchId: 'QF-3', teamSlot: 'team2' },
  'R16-7': { nextMatchId: 'QF-4', teamSlot: 'team1' },
  'R16-8': { nextMatchId: 'QF-4', teamSlot: 'team2' },
  
  'QF-1': { nextMatchId: 'SF-1', teamSlot: 'team1' },
  'QF-2': { nextMatchId: 'SF-1', teamSlot: 'team2' },
  'QF-3': { nextMatchId: 'SF-2', teamSlot: 'team1' },
  'QF-4': { nextMatchId: 'SF-2', teamSlot: 'team2' },
  
  'SF-1': { winnerMatchId: 'FINAL', winnerSlot: 'team1', loserMatchId: '3RD', loserSlot: 'team1' },
  'SF-2': { winnerMatchId: 'FINAL', winnerSlot: 'team2', loserMatchId: '3RD', loserSlot: 'team2' }
};

app.post('/api/admin/match', authAdmin, async (req, res) => {
  try {
    const { match_id, goals1, goals2, penalty1, penalty2, status } = req.body;
    
    if (goals1 === undefined || goals2 === undefined || goals1 === '' || goals2 === '') {
      return res.status(400).json({ error: 'Debe ingresar los goles' });
    }

    const g1 = parseInt(goals1, 10);
    const g2 = parseInt(goals2, 10);

    if (isNaN(g1) || isNaN(g2) || g1 < 0 || g2 < 0) {
      return res.status(400).json({ error: 'Los goles deben ser números válidos' });
    }

    const db = readDb();
    const match = db.matches.find(m => m.id === match_id);

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    match.goals1 = g1;
    match.goals2 = g2;
    match.status = status || 'played';

    // If it's a knockout stage match and score is tie, check penaltis to determine who passes
    let winner = null;
    let loser = null;

    if (match.stage !== 'group') {
      const p1 = penalty1 !== undefined && penalty1 !== '' ? parseInt(penalty1, 10) : null;
      const p2 = penalty2 !== undefined && penalty2 !== '' ? parseInt(penalty2, 10) : null;
      
      match.penalty1 = p1;
      match.penalty2 = p2;

      if (g1 > g2) {
        winner = match.team1;
        loser = match.team2;
      } else if (g2 > g1) {
        winner = match.team2;
        loser = match.team1;
      } else {
        // Draw in knockouts, penaltis required
        if (p1 === null || p2 === null || isNaN(p1) || isNaN(p2) || p1 === p2) {
          return res.status(400).json({ error: 'Los empates en eliminatorias requieren definición por penales' });
        }
        if (p1 > p2) {
          winner = match.team1;
          loser = match.team2;
        } else {
          winner = match.team2;
          loser = match.team1;
        }
      }

      // Propagate bracket!
      const propInfo = propagationMap[match.id];
      if (propInfo) {
        if (propInfo.nextMatchId) {
          // Regular propagation (R32, R16, QF)
          const nextMatch = db.matches.find(m => m.id === propInfo.nextMatchId);
          if (nextMatch) {
            nextMatch[propInfo.teamSlot] = winner;
          }
        } else if (propInfo.winnerMatchId) {
          // Semifinals propagation (SF-1, SF-2)
          const finalMatch = db.matches.find(m => m.id === propInfo.winnerMatchId);
          const thirdMatch = db.matches.find(m => m.id === propInfo.loserMatchId);
          
          if (finalMatch) finalMatch[propInfo.winnerSlot] = winner;
          if (thirdMatch) thirdMatch[propInfo.loserSlot] = loser;
        }
      }
    }

    // Recalculate all scores
    recalculateScores(db);

    await writeDb(db);
    res.json({ success: true, match });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el partido' });
  }
});

// Admin: Get all users' predictions for a specific match
app.get('/api/admin/match-predictions/:matchId', authAdmin, (req, res) => {
  try {
    const db = readDb();
    const matchId = req.params.matchId;
    const match = db.matches.find(m => m.id === matchId);

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    // Get all predictions for this match
    const predictions = db.predictions.filter(p => p.match_id === matchId);

    // Join with user info
    const predictionsWithUsers = predictions.map(pred => {
      const user = db.users.find(u => u.id === pred.user_id);
      return {
        user_id: pred.user_id,
        username: user ? user.username : 'Unknown',
        fullname: user ? user.fullname : 'Unknown',
        team_name: user ? user.team_name : 'Unknown',
        team_crest: user ? user.team_crest : '/uploads/default-crest.png',
        goals1: pred.goals1,
        goals2: pred.goals2,
        points: pred.points
      };
    });

    res.json({
      match: {
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        goals1: match.goals1,
        goals2: match.goals2,
        status: match.status,
        match_date: match.match_date
      },
      predictions: predictionsWithUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener predicciones' });
  }
});

// Admin: Get all users with their access codes (for password recovery)
app.get('/api/admin/users', authAdmin, (req, res) => {
  try {
    const db = readDb();
    const users = db.users.map(u => ({
      id: u.id,
      username: u.username,
      fullname: u.fullname,
      team_name: u.team_name,
      team_crest: u.team_crest,
      access_code: u.access_code,
      is_admin: u.is_admin,
      score_total: u.score_total,
      created_at: u.created_at
    }));
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Admin: Export all data as JSON file
app.get('/api/admin/export', authAdmin, (req, res) => {
  try {
    const db = readDb();
    // #region debug-point C:export-entry
    (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.js:/api/admin/export:entry',msg:'[DEBUG] export endpoint entered',data:{adminUser:req.user?.username||null,dbIsNull:db===null,keys:db?Object.keys(db):[]},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    const exportData = {
      exported_at: new Date().toISOString(),
      version: '1.0.0',
      users: db.users,
      matches: db.matches,
      predictions: db.predictions,
      special_predictions: db.special_predictions,
      settings: db.settings,
      teams: db.teams
    };
    res.setHeader('Content-Disposition', `attachment; filename="mundial_backup_${new Date().toISOString().split('T')[0]}.json"`);
    res.setHeader('Content-Type', 'application/json');
    // #region debug-point D:export-ready
    (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'server.js:/api/admin/export:ready',msg:'[DEBUG] export response ready',data:{users:Array.isArray(exportData.users)?exportData.users.length:null,matches:Array.isArray(exportData.matches)?exportData.matches.length:null,predictions:Array.isArray(exportData.predictions)?exportData.predictions.length:null,specialPredictions:Array.isArray(exportData.special_predictions)?exportData.special_predictions.length:null,teams:Array.isArray(exportData.teams)?exportData.teams.length:null},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    res.json(exportData);
  } catch (err) {
    // #region debug-point E:export-error
    (()=>{const fs=require('fs'),p='.dbg/export-500.env';let u='http://127.0.0.1:7777/event',s='export-500';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'E',location:'server.js:/api/admin/export:catch',msg:'[DEBUG] export failed',data:{name:err?.name||null,message:err?.message||null,stack:String(err?.stack||'').split('\n').slice(0,4)},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    console.error(err);
    res.status(500).json({ error: 'Error al exportar datos' });
  }
});

// Admin: Import data from JSON file
app.post('/api/admin/import', authAdmin, async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data || !Array.isArray(data.users) || !Array.isArray(data.matches)) {
      return res.status(400).json({ error: 'Archivo JSON inválido o incompleto' });
    }

    const db = readDb();
    const importedPredictions = Array.isArray(data.predictions) ? data.predictions : [];
    const importedSpecialPredictions = Array.isArray(data.special_predictions) ? data.special_predictions : [];
    const importedTeams = Array.isArray(data.teams) ? data.teams : [];
    
    // Merge imported data (don't overwrite existing)
    // Users: add new ones, skip existing by id
    const existingUserIds = new Set(db.users.map(u => u.id));
    const newUsers = data.users.filter(u => !existingUserIds.has(u.id));
    db.users.push(...newUsers);

    // Matches: update existing, add new
    data.matches.forEach(m => {
      const idx = db.matches.findIndex(dm => dm.id === m.id);
      if (idx >= 0) {
        db.matches[idx] = m;
      } else {
        db.matches.push(m);
      }
    });

    // Predictions: add new ones (don't overwrite)
    const existingPredKeys = new Set(db.predictions.map(p => `${p.user_id}-${p.match_id}`));
    const newPreds = importedPredictions.filter(p => !existingPredKeys.has(`${p.user_id}-${p.match_id}`));
    db.predictions.push(...newPreds);

    // Special predictions: merge
    importedSpecialPredictions.forEach(sp => {
      const idx = db.special_predictions.findIndex(dsp => dsp.user_id === sp.user_id);
      if (idx >= 0) {
        db.special_predictions[idx] = sp;
      } else {
        db.special_predictions.push(sp);
      }
    });

    // Settings
    if (data.settings) {
      db.settings = { ...db.settings, ...data.settings };
    }

    // Teams (don't overwrite)
    if (importedTeams.length > 0 && db.teams.length === 0) {
      db.teams = importedTeams;
    }

    await writeDb(db);
    res.json({ success: true, message: `Importados: ${newUsers.length} usuarios, ${data.matches.length} partidos, ${newPreds.length} predicciones` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al importar datos' });
  }
});

// Admin: Get special predictions of all users (to award points)
app.get('/api/admin/special-predictions', authAdmin, (req, res) => {
  try {
    const db = readDb();
    const result = db.special_predictions.map(sp => {
      const user = db.users.find(u => u.id === sp.user_id);
      return {
        user_id: sp.user_id,
        username: user ? user.username : 'Unknown',
        fullname: user ? user.fullname : 'Unknown',
        team_name: user ? user.team_name : 'Unknown',
        team_crest: user ? user.team_crest : '/uploads/default-crest.png',
        champion_team: sp.champion_team,
        top_scorer: sp.top_scorer,
        points_champion: sp.points_champion,
        points_top_scorer: sp.points_top_scorer
      };
    });
    res.json({ special_predictions: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener predicciones especiales' });
  }
});

// Admin: Recalculate all scores (manual refresh)
app.post('/api/admin/recalculate', authAdmin, async (req, res) => {
  try {
    const db = readDb();
    recalculateScores(db);
    await writeDb(db);
    res.json({ success: true, message: 'Puntuaciones recalculadas correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al recalcular puntuaciones' });
  }
});

// Admin: Set teams for Round of 32 (called when group stage finishes)
app.post('/api/admin/r32-teams', authAdmin, async (req, res) => {
  try {
    const { pairings } = req.body; // Array of { matchId, team1, team2 }
    
    if (!pairings || !Array.isArray(pairings)) {
      return res.status(400).json({ error: 'Formato incorrecto' });
    }

    const db = readDb();

    pairings.forEach(p => {
      const match = db.matches.find(m => m.id === p.matchId && m.stage === 'R32');
      if (match) {
        match.team1 = p.team1;
        match.team2 = p.team2;
      }
    });

    await writeDb(db);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al establecer llaves de dieciseisavos' });
  }
});

// Admin: Edit any user's prediction (for corrections)
app.post('/api/admin/prediction', authAdmin, async (req, res) => {
  try {
    const { user_id, match_id, goals1, goals2 } = req.body;

    if (goals1 === undefined || goals2 === undefined || goals1 === '' || goals2 === '') {
      return res.status(400).json({ error: 'Debe ingresar los goles' });
    }
    const g1 = parseInt(goals1, 10);
    const g2 = parseInt(goals2, 10);
    if (isNaN(g1) || isNaN(g2) || g1 < 0 || g2 < 0) {
      return res.status(400).json({ error: 'Los goles deben ser números válidos' });
    }

    const db = readDb();
    const match = db.matches.find(m => m.id === match_id);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

    const targetUser = db.users.find(u => u.id === parseInt(user_id, 10));
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    let pred = db.predictions.find(p => p.match_id === match_id && p.user_id === parseInt(user_id, 10));
    if (pred) {
      pred.goals1 = g1;
      pred.goals2 = g2;
    } else {
      pred = { user_id: parseInt(user_id, 10), match_id, goals1: g1, goals2: g2, points: 0 };
      db.predictions.push(pred);
    }

    // Recalculate points if match is already played
    if (match.status === 'played') {
      recalculateScores(db);
    }

    await writeDb(db);
    res.json({ success: true, prediction: pred });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la predicción' });
  }
});

// Admin: Update settings (including special_locked)
app.post('/api/admin/settings', authAdmin, async (req, res) => {
  try {
    const { special_locked, tournament_start_time } = req.body;
    const db = readDb();
    
    if (special_locked !== undefined) {
      db.settings.special_locked = special_locked;
    }
    if (tournament_start_time !== undefined) {
      db.settings.tournament_start_time = tournament_start_time;
    }
    
    await writeDb(db);
    res.json({ success: true, settings: db.settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// Admin: Get settings
app.get('/api/admin/settings', authAdmin, (req, res) => {
  try {
    const db = readDb();
    res.json({ settings: db.settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// Admin: Define actual champion and top scorer
app.post('/api/admin/special-results', authAdmin, async (req, res) => {
  try {
    const { champion, top_scorer } = req.body;

    const db = readDb();
    db.settings.champion = champion ? champion.trim() : null;
    db.settings.top_scorer = top_scorer ? top_scorer.trim() : null;

    recalculateScores(db);

    await writeDb(db);
    res.json({ success: true, settings: db.settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al establecer campeones especiales' });
  }
});

// Get predictions of all users for a locked match
app.get('/api/match-predictions/:matchId', authUser, (req, res) => {
  const matchId = req.params.matchId;
  const db = readDb();
  const match = db.matches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const isLocked = isMatchLocked(match);
  if (!isLocked && match.status !== 'played') {
    return res.status(400).json({ error: 'Las predicciones de este partido son privadas hasta que comience el partido.' });
  }

  // Return list of users with their predictions for this match
  const results = db.users.map(u => {
    const pred = db.predictions.find(p => p.match_id === matchId && p.user_id === u.id);
    return {
      id: u.id,
      fullname: u.fullname,
      team_name: u.team_name,
      team_crest: u.team_crest,
      prediction: pred ? { goals1: pred.goals1, goals2: pred.goals2, points: pred.points } : null
    };
  });

  res.json({ match, predictions: results });
});

// Serve frontend routing (fallback to index.html for UI SPA or direct static pages)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
