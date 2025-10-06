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
  try {
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

    if (error) throw error;

    // Flatten team info for frontend
    const formatted = data.map(p => ({
      id: p.id,
      username: p.username,
      whatsapp: p.whatsapp,
      team_name: p.team.name,
      team_crest: p.team.crest_url
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team_id } = req.body;

  if (!username || !whatsapp || !team_id) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    // Check if 32 slots filled
    const { data: registered, error: regErr } = await supabase
      .from('registrations')
      .select('*');
    if (regErr) throw regErr;
    if (registered.length >= 32)
      return res.status(400).json({ message: 'Slots are filled up!' });

    // Check if team already taken
    const { data: existing, error: existErr } = await supabase
      .from('registrations')
      .select('*')
      .eq('team_id', team_id);
    if (existErr) throw existErr;
    if (existing.length > 0)
      return res.status(400).json({ message: 'Team already taken!' });

    // Insert registration
    const { data: newReg, error: insertErr } = await supabase
      .from('registrations')
      .insert([{ username, whatsapp, team_id }])
      .select(`
        id,
        username,
        whatsapp,
        team:teams(id, name, crest_url)
      `)
      .single(); // return the inserted row with team info

    if (insertErr) throw insertErr;

    // Send flattened object to frontend
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
