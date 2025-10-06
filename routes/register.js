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
  try {
    // Use the view or the registrations table for frontend display
    const { data, error } = await supabase
      .from('players_view')  // <- change to players_view
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📝 Register a new player
router.post('/register', async (req, res) => {
  const { username, whatsapp, team_name } = req.body; // match frontend

  if (!username || !whatsapp || !team_name) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    // Check if 32 slots are filled
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
      .eq('team_name', team_name);
    if (existErr) throw existErr;

    if (existing && existing.length > 0)
      return res.status(400).json({ message: 'Team already taken!' });

    // Insert new registration
    const { error: insertErr } = await supabase
      .from('registrations')
      .insert([{ username, whatsapp, team_name }]);
    if (insertErr) throw insertErr;

    res.json({ message: 'Registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
