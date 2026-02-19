import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

async function enrichMatches(matches) {
  if (!matches.length) return [];
  const { data: teams } = await supabase.from('teams').select('*');
  const { data: players } = await supabase.from('players').select('id, username');
  const { data: regs } = await supabase.from('registrations').select('id, player_id, team_id');

  return matches.map(m => {
    const homeTeam = teams?.find(t => t.id === m.home_team_id);
    const awayTeam = teams?.find(t => t.id === m.away_team_id);
    const homeReg = regs?.find(r => r.id === m.home_reg_id);
    const awayReg = regs?.find(r => r.id === m.away_reg_id);
    const homePlayer = players?.find(p => p.id === homeReg?.player_id);
    const awayPlayer = players?.find(p => p.id === awayReg?.player_id);
    return {
      ...m,
      home_team_name: homeTeam?.name || 'TBD',
      away_team_name: awayTeam?.name || 'TBD',
      home_player: homePlayer?.username || 'TBD',
      away_player: awayPlayer?.username || 'TBD',
    };
  });
}

router.get('/tournaments/:id/matches', async (req, res) => {
  try {
    const { data: matches, error } = await supabase
      .from('matches').select('*').eq('tournament_id', req.params.id)
      .order('stage').order('group_name').order('id');
    if (error) throw error;
    res.json(await enrichMatches(matches || []));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.post('/tournaments/:id/matches/generate-knockout', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  const tournament_id = parseInt(req.params.id);
  try {
    const { data: groups } = await supabase
      .from('groups').select('*').eq('tournament_id', tournament_id)
      .order('group_name').order('points', { ascending: false })
      .order('gf', { ascending: false });

    const groupNames = [...new Set(groups.map(g => g.group_name))];
    const qualifiers = [];
    groupNames.forEach(gn => {
      const gt = groups.filter(g => g.group_name === gn);
      qualifiers.push(...gt.slice(0, 2));
    });

    const { data: tournament } = await supabase
      .from('tournaments').select('max_players').eq('id', tournament_id).single();

    // Delete existing knockout matches for this tournament
    await supabase.from('matches')
      .delete().eq('tournament_id', tournament_id).neq('stage', 'group');

    const { data: regs } = await supabase
      .from('registrations').select('id, team_id').eq('tournament_id', tournament_id);

    const getRegId = (teamId) => regs?.find(r => r.team_id === teamId)?.id;

    const winners = qualifiers.filter((_, i) => i % 2 === 0);
    const runnersUp = qualifiers.filter((_, i) => i % 2 !== 0);
    const numQF = groupNames.length / 2;

    let knockoutMatches = [];

    if (tournament.max_players === 32) {
      // 8 groups → QF
      const qfPairs = [
        [winners[0], runnersUp[3]], [winners[1], runnersUp[2]],
        [winners[2], runnersUp[1]], [winners[3], runnersUp[0]],
      ];
      qfPairs.forEach(([h, a], i) => knockoutMatches.push({
        tournament_id, stage: 'quarter-final', match_order: i + 1,
        home_reg_id: getRegId(h?.team_id), away_reg_id: getRegId(a?.team_id),
        home_team_id: h?.team_id, away_team_id: a?.team_id, confirmed: false
      }));
      for (let i = 1; i <= 2; i++) knockoutMatches.push({
        tournament_id, stage: 'semi-final', match_order: i,
        home_team_id: null, away_team_id: null, confirmed: false
      });
    } else {
      // 16 players, 4 groups → straight to SF
      const sfPairs = [
        [winners[0], runnersUp[1]], [winners[1], runnersUp[0]],
      ];
      sfPairs.forEach(([h, a], i) => knockoutMatches.push({
        tournament_id, stage: 'semi-final', match_order: i + 1,
        home_reg_id: getRegId(h?.team_id), away_reg_id: getRegId(a?.team_id),
        home_team_id: h?.team_id, away_team_id: a?.team_id, confirmed: false
      }));
    }

    knockoutMatches.push({
      tournament_id, stage: 'final', match_order: 1,
      home_team_id: null, away_team_id: null, confirmed: false
    });

    await supabase.from('matches').insert(knockoutMatches);
    await supabase.from('tournaments').update({ status: 'knockout' }).eq('id', tournament_id);

    res.json({ message: 'Knockout bracket generated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updateStandings(match) {
  const { home_score, away_score, home_team_id, away_team_id, group_name, tournament_id } = match;
  const hs = parseInt(home_score), as = parseInt(away_score);

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

  if (hs > as) { await updateTeam(home_team_id, hs, as, 1, 0, 0); await updateTeam(away_team_id, as, hs, 0, 0, 1); }
  else if (hs < as) { await updateTeam(home_team_id, hs, as, 0, 0, 1); await updateTeam(away_team_id, as, hs, 1, 0, 0); }
  else { await updateTeam(home_team_id, hs, as, 0, 1, 0); await updateTeam(away_team_id, as, hs, 0, 1, 0); }
}

export default router;
