import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Get all teams
router.get('/teams', async (req, res) => {
  const { data, error } = await supabase.from('teams').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Get all registered players with team info
router.get('/players', async (req, res) => {
  const { data, error } = await supabase
    .from('registrations')
    .select(`
      id,
      username,
      whatsapp,
      created_at,
      team:teams(id, name, crest_url)
    `)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const formatted = data.map(p => ({
    id: p.id,
    username: p.username,
    whatsapp: p.whatsapp,
    team_name: p.team.name,
    team_crest: p.team.crest_url
  }));

  res.json(formatted);
});

// Register new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team_id } = req.body;
  if (!username || !whatsapp || !team_id)
    return res.status(400).json({ message: 'Missing required fields.' });

  try {
    // Check slots
    const { data: registered } = await supabase.from('registrations').select('*');
    if (registered.length >= 32) return res.status(400).json({ message: 'Slots filled up!' });

    // Check team taken
    const { data: existing } = await supabase
      .from('registrations')
      .select('*')
      .eq('team_id', team_id);

    if (existing.length > 0) return res.status(400).json({ message: 'Team already taken!' });

    // Insert registration and return with team info
    const { data: newReg, error: insertErr } = await supabase
      .from('registrations')
      .insert([{ username, whatsapp, team_id }])
      .select('id, username, whatsapp, team:teams(id, name, crest_url)')
      .single();

    if (insertErr) throw insertErr;

    res.json({
      message: 'Registered successfully!',
      player: {
        id: newReg.id,
        username: newReg.username,
        whatsapp: newReg.whatsapp,
        team_name: newReg.team.name,
        team_crest: newReg.team.crest_url
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
