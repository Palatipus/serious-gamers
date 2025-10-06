import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Get all teams
router.get('/teams', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all registered players with team names
router.get('/players', async (req, res) => {
  try {
    const { data: registrations, error: regErr } = await supabase
      .from('registrations')
      .select('id, username, whatsapp, team_id')
      .order('created_at', { ascending: true });

    if (regErr) throw regErr;

    const { data: teams, error: teamErr } = await supabase
      .from('teams')
      .select('*');
    if (teamErr) throw teamErr;

    // Map team_id to team name
    const playersWithNames = registrations.map(r => {
      const team = teams.find(t => t.id === r.team_id);
      return { ...r, team_name: team ? team.name : 'Unknown' };
    });

    res.json(playersWithNames);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team_id } = req.body;

  if (!username || !whatsapp || !team_id)
    return res.status(400).json({ message: 'Missing required fields.' });

  try {
    // Check if team is already taken
    const { data: existing, error: existErr } = await supabase
      .from('registrations')
      .select('*')
      .eq('team_id', team_id);
    if (existErr) throw existErr;
    if (existing.length > 0)
      return res.status(400).json({ message: 'Team already taken!' });

    // Check slot limit
    const { data: allRegs, error: regErr } = await supabase
      .from('registrations')
      .select('*');
    if (regErr) throw regErr;
    if (allRegs.length >= 32)
      return res.status(400).json({ message: 'Slots are filled up!' });

    // Insert registration
    const { error: insertErr } = await supabase
      .from('registrations')
      .insert([{ username, whatsapp, team_id }]);
    if (insertErr) throw insertErr;

    res.json({ message: 'Registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
