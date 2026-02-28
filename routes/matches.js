import express from 'express';
import { supabase, supabaseAdmin } from '../lib/supabase.js';

const router = express.Router();

const STAGE_ORDER = [
  'group',
  'round-of-128', 'round-of-64', 'round-of-32', 'round-of-16',
  'quarter-final', 'semi-final', 'final'
];

function stageFromCount(n) {
  const map = { 128:'round-of-128', 64:'round-of-64', 32:'round-of-32',
                16:'round-of-16', 8:'quarter-final', 4:'semi-final', 2:'final' };
  return map[n] || `round-of-${n}`;
}

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

// ── GET current matchday info for a tournament ───────────────────
// Returns { current_matchday, total_matchdays, all_confirmed }
router.get('/tournaments/:id/matchday', async (req, res) => {
  try {
    const { data: groupMatches } = await supabase
      .from('matches').select('matchday, confirmed')
      .eq('tournament_id', req.params.id)
      .eq('stage', 'group');

    if (!groupMatches || !groupMatches.length)
      return res.json({ current_matchday: 1, total_matchdays: 0, group_done: false });

    const total = Math.max(...groupMatches.map(m => m.matchday || 1));

    // Find the lowest matchday that still has unconfirmed matches
    let current = total; // default to last if all confirmed
    for (let md = 1; md <= total; md++) {
      const mdMatches = groupMatches.filter(m => m.matchday === md);
      const allDone   = mdMatches.every(m => m.confirmed);
      if (!allDone) { current = md; break; }
    }

    const allConfirmed = groupMatches.every(m => m.confirmed);

    res.json({ current_matchday: current, total_matchdays: total, group_done: allConfirmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET matches (with matchday filtering for group stage) ────────
router.get('/tournaments/:id/matches', async (req, res) => {
  try {
    const { matchday, all } = req.query;

    let query = supabase.from('matches').select('*').eq('tournament_id', req.params.id);

    // If matchday param is given and not requesting all, filter to that matchday (group matches only)
    // Knockout matches are always included
    const { data: rawMatches, error } = await query.order('id');
    if (error) throw error;

    let matches = rawMatches || [];

    // If specific matchday requested, show only that matchday's group matches + all knockout matches
    if (matchday && all !== 'true') {
      const md = parseInt(matchday);
      matches = matches.filter(m => m.stage !== 'group' || m.matchday === md);
    }

    const enriched = await enrichMatches(matches);
    enriched.sort((a, b) => {
      const si = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
      if (si !== 0) return si;
      if (a.matchday !== b.matchday) return (a.matchday || 1) - (b.matchday || 1);
      if (a.group_name && b.group_name) return a.group_name.localeCompare(b.group_name);
      return (a.match_order || 0) - (b.match_order || 0);
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SAVE score + optional screenshot URL ────────────────────────
router.put('/tournaments/:tid/matches/:id/score', async (req, res) => {
  const { home_score, away_score, screenshot_url } = req.body;
  try {
    const { data: match } = await supabase
      .from('matches').select('confirmed').eq('id', req.params.id).single();
    if (match?.confirmed)
      return res.status(403).json({ message: 'Match is locked and confirmed.' });

    const updates = {
      home_score: parseInt(home_score),
      away_score: parseInt(away_score),
    };
    if (screenshot_url) updates.screenshot_url = screenshot_url;

    await supabase.from('matches').update(updates).eq('id', req.params.id);
    res.json({ message: 'Score saved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPLOAD screenshot → get public URL ──────────────────────────
// Accepts base64 image, stores in Supabase Storage, returns public URL
router.post('/tournaments/:tid/matches/:id/screenshot', async (req, res) => {
  const { image_base64, content_type } = req.body;
  if (!image_base64) return res.status(400).json({ message: 'No image data.' });

  try {
    const matchId = req.params.id;

    // Normalize content type — HEIC/HEIF from iOS needs special handling
    let mimeType = content_type || 'image/jpeg';
    if (mimeType.includes('heic') || mimeType.includes('heif')) mimeType = 'image/jpeg';

    // Simple numeric filename only — avoids all pattern issues
    const fileName = `${matchId}${Date.now()}.jpg`;
    const buffer   = Buffer.from(image_base64, 'base64');

    // Try upload
    const { data: uploadData, error } = await supabaseAdmin.storage
      .from('screenshots')
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      console.error('Storage upload error:', error);
      throw new Error(error.message);
    }

    const { data: urlData } = supabaseAdmin.storage.from('screenshots').getPublicUrl(fileName);
    res.json({ url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONFIRM single match ─────────────────────────────────────────
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

// ── CONFIRM ALL with scores ──────────────────────────────────────
router.put('/tournaments/:id/matches/confirm-all', async (req, res) => {
  const { password, group_name, matchday } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  try {
    let q = supabase.from('matches').select('*')
      .eq('tournament_id', req.params.id).eq('confirmed', false);
    if (group_name) q = q.eq('group_name', group_name);
    if (matchday)   q = q.eq('matchday', matchday);
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
      .from('registrations').select('id, team_id, player_id').eq('tournament_id', tournament_id);

    await supabase.from('matches')
      .delete().eq('tournament_id', tournament_id).neq('stage', 'group');

    let seededTeams = [];

    if (tournament.format === 'knockout') {
      const shuffled = [...(regs || [])].sort(() => Math.random() - 0.5);
      seededTeams = shuffled.map(r => ({ team_id: r.team_id, reg_id: r.id }));
    } else {
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

      for (let i = 0; i < winners.length; i++) {
        const w   = winners[i];
        const ru  = runnersUp[runnersUp.length - 1 - i];
        const wReg  = regs?.find(r => r.team_id === w?.team_id);
        const ruReg = regs?.find(r => r.team_id === ru?.team_id);
        if (w)  seededTeams.push({ team_id: w.team_id,   reg_id: wReg?.id });
        if (ru) seededTeams.push({ team_id: ru?.team_id, reg_id: ruReg?.id });
      }
    }

    const knockoutMatches = buildBracket(seededTeams, tournament_id);
    if (knockoutMatches.length) await supabase.from('matches').insert(knockoutMatches);

    await supabase.from('tournaments')
      .update({ status: 'knockout', started_at: new Date().toISOString() })
      .eq('id', tournament_id);

    res.json({ message: `Knockout bracket generated!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildBracket(seeds, tournament_id) {
  const matches = [];
  const n = seeds.length;
  if (n < 2) return matches;

  const firstStage = stageFromCount(n);
  const r1Count    = Math.floor(n / 2);

  for (let i = 0; i < r1Count; i++) {
    const home = seeds[i * 2];
    const away = seeds[i * 2 + 1];
    matches.push({
      tournament_id, stage: firstStage, match_order: i + 1,
      home_reg_id: home?.reg_id || null, away_reg_id: away?.reg_id || null,
      home_team_id: home?.team_id || null, away_team_id: away?.team_id || null,
      confirmed: false
    });
  }

  let remaining = r1Count;
  while (remaining > 1) {
    remaining = Math.ceil(remaining / 2);
    const stage = stageFromCount(remaining * 2);
    for (let i = 0; i < remaining; i++) {
      matches.push({
        tournament_id, stage, match_order: i + 1,
        home_reg_id: null, away_reg_id: null,
        home_team_id: null, away_team_id: null,
        confirmed: false
      });
    }
  }
  return matches;
}

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
      played: data.played + 1, won: data.won + w, drawn: data.drawn + d, lost: data.lost + l,
      gf: data.gf + scored, ga: data.ga + conceded,
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
