import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Stage ordering for display
const STAGE_ORDER = [
  'group',
  'round-of-128', 'round-of-64', 'round-of-32', 'round-of-16',
  'quarter-final', 'semi-final', 'final'
];

// Human-readable stage names from number of teams
function stageFromCount(n) {
  const map = {
    128: 'round-of-128',
    64:  'round-of-64',
    32:  'round-of-32',
    16:  'round-of-16',
    8:   'quarter-final',
    4:   'semi-final',
    2:   'final'
  };
  return map[n] || `round-of-${n}`;
}

// ── Enrich matches with team/player names ────────────────────────
async function enrichMatches(matches) {
  if (!matches.length) return [];
  const { data: teams }   = await supabase.from('teams').select('*');
  const { data: players } = await supabase.from('players').select('id, username');
  const { data: regs }    = await supabase.from('registrations').select('id, player_id, team_id');

  return matches.map(m => {
    const homeTeam   = teams?.find(t => t.id === m.home_team_id);
    const awayTeam   = teams?.find(t => t.id === m.away_team_id);
    const homeReg    = regs?.find(r => r.id === m.home_reg_id);
    const awayReg    = regs?.find(r => r.id === m.away_reg_id);
    const homePlayer = players?.find(p => p.id === homeReg?.player_id);
    const awayPlayer = players?.find(p => p.id === awayReg?.player_id);
    return {
      ...m,
      home_team_name: homeTeam?.name  || 'TBD',
      away_team_name: awayTeam?.name  || 'TBD',
      home_player:    homePlayer?.username || 'TBD',
      away_player:    awayPlayer?.username || 'TBD',
    };
  });
}

// ── GET matches ──────────────────────────────────────────────────
router.get('/tournaments/:id/matches', async (req, res) => {
  try {
    const { data: matches, error } = await supabase
      .from('matches').select('*').eq('tournament_id', req.params.id)
      .order('id');
    if (error) throw error;

    const enriched = await enrichMatches(matches || []);
    // Sort by stage order then match_order
    enriched.sort((a, b) => {
      const si = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
      if (si !== 0) return si;
      if (a.group_name && b.group_name) return a.group_name.localeCompare(b.group_name);
      return (a.match_order || 0) - (b.match_order || 0);
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SAVE score ───────────────────────────────────────────────────
router.put('/tournaments/:tid/matches/:id/score', async (req, res) => {
  const { home_score, away_score } = req.body;
  try {
    const { data: match } = await supabase
      .from('matches').select('confirmed').eq('id', req.params.id).single();
    if (match?.confirmed)
      return res.status(403).json({ message: 'Match is locked and confirmed.' });

    await supabase.from('matches')
      .update({ home_score: parseInt(home_score), away_score: parseInt(away_score) })
      .eq('id', req.params.id);
    res.json({ message: 'Score saved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONFIRM single match (admin) ─────────────────────────────────
router.put('/tournaments/:tid/matches/:id/confirm', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  try {
    const { data: match } = await supabase
      .from('matches').select('*').eq('id', req.params.id).single();
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    if (match.home_score === null || match.away_score === null)
      return res.status(400).json({ message: 'Enter scores before confirming.' });

    await supabase.from('matches').update({ confirmed: true }).eq('id', req.params.id);
    if (match.stage === 'group') await updateStandings(match);

    res.json({ message: 'Match confirmed!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONFIRM ALL matches with scores (admin) ──────────────────────
router.put('/tournaments/:id/matches/confirm-all', async (req, res) => {
  const { password, group_name } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  try {
    let q = supabase.from('matches').select('*')
      .eq('tournament_id', req.params.id).eq('confirmed', false);
    if (group_name) q = q.eq('group_name', group_name);
    const { data: matches } = await q;

    let count = 0;
    for (const m of (matches || [])) {
      if (m.home_score !== null && m.away_score !== null) {
        await supabase.from('matches').update({ confirmed: true }).eq('id', m.id);
        if (m.stage === 'group') await updateStandings(m);
        count++;
      }
    }
    res.json({ message: `${count} matches confirmed!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GENERATE KNOCKOUT BRACKET ────────────────────────────────────
// Works for both formats and all sizes
router.post('/tournaments/:id/matches/generate-knockout', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  const tournament_id = parseInt(req.params.id);
  try {
    const { data: tournament } = await supabase
      .from('tournaments').select('*').eq('id', tournament_id).single();
    if (!tournament) return res.status(404).json({ message: 'Tournament not found.' });

    const { data: regs } = await supabase
      .from('registrations').select('id, team_id, player_id')
      .eq('tournament_id', tournament_id);

    // Delete any existing knockout matches
    await supabase.from('matches')
      .delete().eq('tournament_id', tournament_id).neq('stage', 'group');

    let seededTeams = []; // array of { team_id, reg_id } in bracket order

    if (tournament.format === 'knockout') {
      // ── PURE KNOCKOUT: seed all registered players randomly ──
      const shuffled = [...(regs || [])].sort(() => Math.random() - 0.5);
      seededTeams = shuffled.map(r => ({ team_id: r.team_id, reg_id: r.id }));
    } else {
      // ── GROUP→KNOCKOUT: take top 2 from each group ──────────
      const { data: groups } = await supabase
        .from('groups').select('*').eq('tournament_id', tournament_id)
        .order('group_name').order('points', { ascending: false })
        .order('gf', { ascending: false });

      const groupNames = [...new Set((groups || []).map(g => g.group_name))].sort();
      const winners    = [];
      const runnersUp  = [];

      groupNames.forEach(gn => {
        const gt = (groups || []).filter(g => g.group_name === gn);
        if (gt[0]) winners.push(gt[0]);
        if (gt[1]) runnersUp.push(gt[1]);
      });

      // Classic seeding: W1 vs RU(last), W2 vs RU(second-to-last), etc.
      // This avoids groups from the same half meeting early
      for (let i = 0; i < winners.length; i++) {
        const w  = winners[i];
        const ru = runnersUp[runnersUp.length - 1 - i];
        const wReg  = regs?.find(r => r.team_id === w?.team_id);
        const ruReg = regs?.find(r => r.team_id === ru?.team_id);
        if (w)  seededTeams.push({ team_id: w.team_id,   reg_id: wReg?.id  });
        if (ru) seededTeams.push({ team_id: ru?.team_id, reg_id: ruReg?.id });
      }
    }

    // Build full bracket from seeded list
    const knockoutMatches = buildBracket(seededTeams, tournament_id);

    if (knockoutMatches.length) {
      await supabase.from('matches').insert(knockoutMatches);
    }

    // Update status
    await supabase.from('tournaments')
      .update({ status: 'knockout', started_at: new Date().toISOString() })
      .eq('id', tournament_id);

    const firstStage = knockoutMatches[0]?.stage || 'knockout';
    res.json({ message: `Knockout bracket generated! Starting from ${firstStage.replace(/-/g, ' ')}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build a full single-elimination bracket from a seeded list
// Pairs [0 vs 1], [2 vs 3], [4 vs 5]... for round 1
// Subsequent rounds are TBD placeholders
function buildBracket(seeds, tournament_id) {
  const matches = [];
  const n = seeds.length;
  if (n < 2) return matches;

  // Round 1 — use actual seeds
  const firstStage = stageFromCount(n);
  const r1Count    = Math.floor(n / 2);

  for (let i = 0; i < r1Count; i++) {
    const home = seeds[i * 2];
    const away = seeds[i * 2 + 1];
    matches.push({
      tournament_id,
      stage:        firstStage,
      match_order:  i + 1,
      home_reg_id:  home?.reg_id  || null,
      away_reg_id:  away?.reg_id  || null,
      home_team_id: home?.team_id || null,
      away_team_id: away?.team_id || null,
      confirmed:    false
    });
  }

  // Subsequent rounds — TBD placeholders so bracket is visible
  let remaining = r1Count;
  while (remaining > 1) {
    remaining = Math.ceil(remaining / 2);
    const stage = stageFromCount(remaining * 2);
    for (let i = 0; i < remaining; i++) {
      matches.push({
        tournament_id,
        stage,
        match_order:  i + 1,
        home_reg_id:  null, away_reg_id:  null,
        home_team_id: null, away_team_id: null,
        confirmed:    false
      });
    }
  }

  return matches;
}

// ── UPDATE STANDINGS after a confirmed group match ───────────────
async function updateStandings(match) {
  const { home_score, away_score, home_team_id, away_team_id, group_name, tournament_id } = match;
  const hs = parseInt(home_score);
  const as = parseInt(away_score);

  async function updateTeam(teamId, scored, conceded, w, d, l) {
    const { data } = await supabase.from('groups').select('*')
      .eq('team_id', teamId).eq('tournament_id', tournament_id)
      .eq('group_name', group_name).single();
    if (!data) return;
    await supabase.from('groups').update({
      played: data.played + 1,
      won:    data.won + w,
      drawn:  data.drawn + d,
      lost:   data.lost + l,
      gf:     data.gf + scored,
      ga:     data.ga + conceded,
      points: data.points + (w ? 3 : d ? 1 : 0)
    }).eq('id', data.id);
  }

  if (hs > as) {
    await updateTeam(home_team_id, hs, as, 1, 0, 0);
    await updateTeam(away_team_id, as, hs, 0, 0, 1);
  } else if (hs < as) {
    await updateTeam(home_team_id, hs, as, 0, 0, 1);
    await updateTeam(away_team_id, as, hs, 1, 0, 0);
  } else {
    await updateTeam(home_team_id, hs, as, 0, 1, 0);
    await updateTeam(away_team_id, as, hs, 0, 1, 0);
  }
}

export default router;
