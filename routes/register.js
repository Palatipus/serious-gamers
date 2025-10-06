import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// 🧩 Get all teams
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

// 🧍‍♂️ Get all registered players
router.get('/players', async (req, res) => {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('id', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// 📝 Register a new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team } = req.body;

  if (!username || !whatsapp || !team) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  // Check if 32 slots are filled
  const { data: players, error: errPlayers } = await supabase
    .from('players')
    .select('*');

  if (errPlayers) return res.status(500).json({ error: errPlayers.message });

  if (players.length >= 32)
    return res.status(400).json({ message: 'Slots are filled up!' });

  // Check if team already taken
  const { data: existing, error: errExisting } = await supabase
    .from('players')
    .select('*')
    .eq('team', team);

  if (errExisting) return res.status(500).json({ error: errExisting.message });

  if (existing && existing.length > 0)
    return res.status(400).json({ message: 'Team already taken!' });

  // Insert player
  const { error } = await supabase
    .from('players')
    .insert([{ username, whatsapp, team }]);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: 'Registered successfully!' });
});

export default router;
