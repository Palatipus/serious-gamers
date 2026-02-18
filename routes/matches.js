import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Get all matches with team names
router.get('/matches', async (req, res) => {
  try {
    const { data: matches, error: matchErr } = await supabase
      .from('matches')
      .select('*')
      .order('id', { ascending: true });
    if (matchErr) throw matchErr;

    const { data: teams, error: teamErr } = await supabase.from('teams').select('*');
    if (teamErr) throw teamErr;

    const { data: registrations, error: regErr } = await supabase
      .from('registrations')
      .select('id, username, team_id');
    if (regErr) throw regErr;

    const enriched = matches.map(m => {
      const homeTeam = teams.find(t => t.id === m.home_team_id);
      const awayTeam = teams.find(t => t.id === m.away_team_id);
      const homePlayer = registrations.find(r => r.team_id === m.home_team_id);
      const awayPlayer = registrations.find(r => r.team_id === m.away_team_id);
      return {
        ...m,
        home_team_name: homeTeam ? homeTeam.name : 'Unknown',
        away_team_name: awayTeam ? awayTeam.name : 'Unknown',
        home_player: homePlayer ? homePlayer.username : '?',
        away_player: awayPlayer ? awayPlayer.username : '?',
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save scores (public can save, not confirm)
router.put('/matches/:id/score', async (req, res) => {
  const { id } = req.params;
  const { home_score, away_score } = req.body;

  try {
    // Check if already confirmed
    const { data: match, error: fetchErr } = await supabase
      .from('matches')
      .select('confirmed')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;
    if (match.confirmed) {
      return res.status(403).json({ message: 'This match has been confirmed and locked.' });
    }

    const { error } = await supabase
      .from('matches')
      .update({ home_score, away_score })
      .eq('id', id);
    if (error) throw error;

    res.json({ message: 'Score saved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm scores (admin only) - also updates group standings
router.put('/matches/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ message: 'Invalid admin password.' });
  }

  try {
    const { data: match, error: fetchErr } = await supabase
      .from('matches')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    if (match.home_score === null || match.away_score === null) {
      return res.status(400).json({ message: 'Scores must be entered before confirming.' });
    }

    // Lock the match
    const { error: confirmErr } = await supabase
      .from('matches')
      .update({ confirmed: true })
      .eq('id', id);
    if (confirmErr) throw confirmErr;

    // Update group standings
    if (match.stage === 'group') {
      await updateGroupStandings(match);
    }

    res.json({ message: 'Match confirmed and standings updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm ALL scores for a group (admin)
router.put('/matches/confirm-all', async (req, res) => {
  const { password, group_name } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ message: 'Invalid admin password.' });
  }

  try {
    let query = supabase.from('matches').select('*').eq('confirmed', false);
    if (group_name) query = query.eq('group_name', group_name);

    const { data: matches, error } = await query;
    if (error) throw error;

    for (const match of matches) {
      if (match.home_score !== null && match.away_score !== null) {
        await supabase.from('matches').update({ confirmed: true }).eq('id', match.id);
        if (match.stage === 'group') await updateGroupStandings(match);
      }
    }

    res.json({ message: 'All eligible matches confirmed!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate knockout bracket (admin)
router.post('/matches/generate-knockout', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ message: 'Invalid admin password.' });
  }

  try {
    // Get group standings - top 2 from each group = QF teams (8 groups × 2 = 16 teams)
    const { data: groups, error: groupErr } = await supabase
      .from('groups')
      .select('*')
      .order('group_name')
      .order('points', { ascending: false })
      .order('gf', { ascending: false });
    if (groupErr) throw groupErr;

    const groupNames = [...new Set(groups.map(g => g.group_name))];
    const qualifiers = []; // top 2 per group

    for (const gn of groupNames) {
      const groupTeams = groups.filter(g => g.group_name === gn);
      qualifiers.push(...groupTeams.slice(0, 2));
    }

    if (qualifiers.length < 8) {
      return res.status(400).json({ message: 'Not enough qualified teams.' });
    }

    // Delete existing knockout matches
    await supabase.from('matches').delete().neq('stage', 'group');

    // Create QF matches: group winners vs runners-up (cross-group)
    const winners = qualifiers.filter((_, i) => i % 2 === 0);
    const runnersUp = qualifiers.filter((_, i) => i % 2 === 1);

    const qfMatches = [
      { home: winners[0], away: runnersUp[3] },
      { home: winners[1], away: runnersUp[2] },
      { home: winners[2], away: runnersUp[1] },
      { home: winners[3], away: runnersUp[0] },
    ];

    const knockoutToInsert = qfMatches.map((m, i) => ({
      group_name: null,
      home_team_id: m.home.team_id,
      away_team_id: m.away.team_id,
      home_score: null,
      away_score: null,
      confirmed: false,
      stage: 'quarter-final',
      match_order: i + 1
    }));

    // Add empty SF and Final placeholders
    for (let i = 1; i <= 2; i++) {
      knockoutToInsert.push({
        group_name: null, home_team_id: null, away_team_id: null,
        home_score: null, away_score: null, confirmed: false,
        stage: 'semi-final', match_order: i
      });
    }
    knockoutToInsert.push({
      group_name: null, home_team_id: null, away_team_id: null,
      home_score: null, away_score: null, confirmed: false,
      stage: 'final', match_order: 1
    });

    const { error: insertErr } = await supabase.from('matches').insert(knockoutToInsert);
    if (insertErr) throw insertErr;

    res.json({ message: 'Knockout bracket generated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updateGroupStandings(match) {
  const { home_score, away_score, home_team_id, away_team_id, group_name } = match;
  const hs = parseInt(home_score);
  const as = parseInt(away_score);

  // Helper to update a team's stats
  async function updateTeam(teamId, scored, conceded, won, drawn, lost) {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .eq('team_id', teamId)
      .eq('group_name', group_name)
      .single();
    if (!data) return;

    await supabase.from('groups').update({
      played: data.played + 1,
      won: data.won + won,
      drawn: data.drawn + drawn,
      lost: data.lost + lost,
      gf: data.gf + scored,
      ga: data.ga + conceded,
      points: data.points + (won ? 3 : drawn ? 1 : 0)
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
