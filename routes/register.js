import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Get all teams
router.get('/teams', async (req, res) => {
  try {
    const { data, error } = await supabase.from('teams').select('*').order('id', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all registered players
router.get('/players', async (req, res) => {
  try {
    const { data, error } = await supabase.from('players_view').select('*').order('id', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team_id } = req.body;
  if (!username || !whatsapp || !team_id)
    return res.status(400).json({ message: 'Missing required fields.' });

  try {
    const { error } = await supabase.from('registrations').insert([{ username, whatsapp, team_id }]);
    if (error) return res.status(400).json({ message: error.message });

    res.json({ message: 'Registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
