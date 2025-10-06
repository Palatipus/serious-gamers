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

    // Flatten team info for easier frontend usage
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

export default router;
