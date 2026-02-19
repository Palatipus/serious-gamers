import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

router.get('/tournaments/:id/groups', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('groups').select('*').eq('tournament_id', req.params.id)
      .order('group_name').order('points', { ascending: false });
    if (error) throw error;

    const { data: teams } = await supabase.from('teams').select('*');
    const { data: regs } = await supabase
      .from('registrations').select('id, player_id, team_id').eq('tournament_id', req.params.id);
    const { data: players } = await supabase.from('players').select('id, username');

    const enriched = (data || []).map(g => {
      const team = teams?.find(t => t.id === g.team_id);
      const reg = regs?.find(r => r.team_id === g.team_id);
      const player = players?.find(p => p.id === reg?.player_id);
      return { ...g, team_name: team?.name, username: player?.username };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tournaments/:id/groups/generate', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  const tournament_id = parseInt(req.params.id);
  try {
    const { data: tournament } = await supabase
      .from('tournaments').select('*').eq('id', tournament_id).single();
    if (!tournament) return res.status(404).json({ message: 'Tournament not found.' });

    const { data: registrations } = await supabase
      .from('registrations').select('id, player_id, team_id').eq('tournament_id', tournament_id);
    if (!registrations || registrations.length < 4)
      return res.status(400).json({ message: 'Need at least 4 players registered.' });

    await supabase.from('groups').delete().eq('tournament_id', tournament_id);
    await supabase.from('matches').delete().eq('tournament_id', tournament_id);

    const shuffled = [...registrations].sort(() => Math.random() - 0.5);
    const groupSize = 4;
    const totalGroups = Math.ceil(shuffled.length / groupSize);
    const groupLetters = 'ABCDEFGH'.split('').slice(0, totalGroups);

    const groupsToInsert = [];
    shuffled.forEach((reg, i) => {
      const gi = Math.floor(i / groupSize);
      if (gi >= groupLetters.length) return;
      groupsToInsert.push({
        tournament_id, group_name: groupLetters[gi],
        registration_id: reg.id, team_id: reg.team_id,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
      });
    });

    await supabase.from('groups').insert(groupsToInsert);

    const matchesToInsert = [];
    groupLetters.forEach(gn => {
      const gt = groupsToInsert.filter(g => g.group_name === gn);
      for (let i = 0; i < gt.length; i++) {
        for (let j = i + 1; j < gt.length; j++) {
          matchesToInsert.push({
            tournament_id, stage: 'group', group_name: gn,
            home_reg_id: gt[i].registration_id, away_reg_id: gt[j].registration_id,
            home_team_id: gt[i].team_id, away_team_id: gt[j].team_id, confirmed: false
          });
        }
      }
    });

    if (matchesToInsert.length) await supabase.from('matches').insert(matchesToInsert);

    await supabase.from('tournaments')
      .update({ status: 'group_stage', started_at: new Date().toISOString() })
      .eq('id', tournament_id);

    res.json({ message: `Groups generated! ${shuffled.length} players in ${groupLetters.length} groups.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
