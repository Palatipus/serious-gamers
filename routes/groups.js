import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Get all groups with teams
router.get('/groups', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .order('group_name', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate groups (admin only)
router.post('/groups/generate', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ message: 'Invalid admin password.' });
  }

  try {
    // Get all registered teams
    const { data: registrations, error: regErr } = await supabase
      .from('registrations')
      .select('id, username, team_id');
    if (regErr) throw regErr;

    if (registrations.length < 4) {
      return res.status(400).json({ message: 'Not enough registrations to generate groups.' });
    }

    // Shuffle registrations
    const shuffled = [...registrations].sort(() => Math.random() - 0.5);

    // Clear existing groups and matches
    await supabase.from('groups').delete().neq('id', 0);
    await supabase.from('matches').delete().neq('id', 0);

    const groupLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const groupSize = 4;
    const groupsToInsert = [];

    for (let i = 0; i < Math.min(shuffled.length, 32); i++) {
      const groupIndex = Math.floor(i / groupSize);
      if (groupIndex >= groupLetters.length) break;
      groupsToInsert.push({
        group_name: groupLetters[groupIndex],
        registration_id: shuffled[i].id,
        team_id: shuffled[i].team_id,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        points: 0
      });
    }

    const { error: insertErr } = await supabase.from('groups').insert(groupsToInsert);
    if (insertErr) throw insertErr;

    // Auto-generate fixtures for each group
    const groupNames = [...new Set(groupsToInsert.map(g => g.group_name))];
    const matchesToInsert = [];

    for (const groupName of groupNames) {
      const groupTeams = groupsToInsert.filter(g => g.group_name === groupName);
      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          matchesToInsert.push({
            group_name: groupName,
            home_team_id: groupTeams[i].team_id,
            away_team_id: groupTeams[j].team_id,
            home_score: null,
            away_score: null,
            confirmed: false,
            stage: 'group'
          });
        }
      }
    }

    if (matchesToInsert.length > 0) {
      const { error: matchErr } = await supabase.from('matches').insert(matchesToInsert);
      if (matchErr) throw matchErr;
    }

    res.json({ message: 'Groups and fixtures generated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save manual group edits (admin only)
router.put('/groups/update', async (req, res) => {
  const { password, groups } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ message: 'Invalid admin password.' });
  }

  try {
    for (const g of groups) {
      const { error } = await supabase
        .from('groups')
        .update({ group_name: g.group_name })
        .eq('id', g.id);
      if (error) throw error;
    }
    res.json({ message: 'Groups updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
