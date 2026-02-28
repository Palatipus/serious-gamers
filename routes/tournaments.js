import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

const VALID_SIZES   = [8, 16, 32, 64, 128];
const VALID_FORMATS = ['group_knockout', 'knockout'];

// ── GET all tournaments ──────────────────────────────────────────
router.get('/tournaments', async (req, res) => {
  try {
    const { data: tournaments, error } = await supabase
      .from('tournaments').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const { data: regCounts } = await supabase
      .from('registrations').select('tournament_id');

    const enriched = tournaments.map(t => ({
      ...t,
      registered_count: (regCounts || []).filter(r => r.tournament_id === t.id).length
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET single tournament ────────────────────────────────────────
router.get('/tournaments/:id', async (req, res) => {
  try {
    const { data: tournament, error } = await supabase
      .from('tournaments').select('*').eq('id', req.params.id).single();
    if (error) throw error;

    const { data: regs } = await supabase
      .from('registrations')
      .select('id, player_id, team_id, created_at')
      .eq('tournament_id', req.params.id)
      .order('created_at', { ascending: true });

    const { data: teams }   = await supabase.from('teams').select('*');
    const { data: players } = await supabase.from('players').select('id, username');

    const enrichedRegs = (regs || []).map(r => ({
      ...r,
      team_name: teams?.find(t => t.id === r.team_id)?.name,
      username:  players?.find(p => p.id === r.player_id)?.username,
    }));

    res.json({ ...tournament, registrations: enrichedRegs, registered_count: regs?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE tournament (admin) ────────────────────────────────────
router.post('/tournaments', async (req, res) => {
  const { password, name, description, max_players, format } = req.body;

  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  const size = parseInt(max_players);
  if (!name || !VALID_SIZES.includes(size))
    return res.status(400).json({ message: `Name required and size must be one of: ${VALID_SIZES.join(', ')}.` });

  const fmt = format || 'group_knockout';
  if (!VALID_FORMATS.includes(fmt))
    return res.status(400).json({ message: 'Format must be group_knockout or knockout.' });

  // Pure knockout needs power-of-2 — all our sizes are already powers of 2 so fine
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .insert([{
        name:        name.trim(),
        description: description?.trim() || null,
        max_players: size,
        format:      fmt,
      }])
      .select().single();
    if (error) throw error;
    res.json({ tournament: data, message: 'Tournament created!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE status (admin) ────────────────────────────────────────
router.put('/tournaments/:id/status', async (req, res) => {
  const { password, status } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  try {
    const updates = { status };
    if (status === 'group_stage' || status === 'knockout') updates.started_at = new Date().toISOString();
    if (status === 'completed') updates.completed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tournaments').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ tournament: data, message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE tournament (admin) ────────────────────────────────────
router.delete('/tournaments/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ message: 'Invalid admin password.' });

  try {
    const { error } = await supabase.from('tournaments').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tournament deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REGISTER player for tournament ──────────────────────────────
router.post('/tournaments/:id/register', async (req, res) => {
  const { player_id, team_id } = req.body;
  const tournament_id = parseInt(req.params.id);
  if (!player_id || !team_id)
    return res.status(400).json({ message: 'player_id and team_id required.' });

  try {
    const { data: t } = await supabase
      .from('tournaments').select('*').eq('id', tournament_id).single();
    if (!t) return res.status(404).json({ message: 'Tournament not found.' });
    if (t.status !== 'registration')
      return res.status(400).json({ message: 'Registration is closed.' });

    const { data: existing } = await supabase
      .from('registrations').select('id').eq('tournament_id', tournament_id);
    if ((existing || []).length >= t.max_players)
      return res.status(400).json({ message: 'Tournament is full!' });

    const { data: playerReg } = await supabase
      .from('registrations').select('id')
      .eq('tournament_id', tournament_id).eq('player_id', player_id).maybeSingle();
    if (playerReg)
      return res.status(400).json({ message: 'You are already registered.' });

    const { data: teamReg } = await supabase
      .from('registrations').select('id')
      .eq('tournament_id', tournament_id).eq('team_id', team_id).maybeSingle();
    if (teamReg)
      return res.status(400).json({ message: 'That team is already taken!' });

    const { error } = await supabase
      .from('registrations').insert([{ tournament_id, player_id, team_id }]);
    if (error) throw error;
    res.json({ message: 'Registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WITHDRAW registration ────────────────────────────────────────
router.delete('/tournaments/:id/register', async (req, res) => {
  const { player_id } = req.body;
  const tournament_id = parseInt(req.params.id);
  try {
    const { data: t } = await supabase
      .from('tournaments').select('status').eq('id', tournament_id).single();
    if (t.status !== 'registration')
      return res.status(400).json({ message: 'Cannot withdraw after tournament has started.' });
    const { error } = await supabase
      .from('registrations').delete()
      .eq('tournament_id', tournament_id).eq('player_id', player_id);
    if (error) throw error;
    res.json({ message: 'Registration withdrawn.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AVAILABLE teams for a tournament ────────────────────────────
router.get('/tournaments/:id/available-teams', async (req, res) => {
  try {
    const { data: taken } = await supabase
      .from('registrations').select('team_id').eq('tournament_id', req.params.id);
    const takenIds = (taken || []).map(r => r.team_id);
    let query = supabase.from('teams').select('*').order('name');
    if (takenIds.length) query = query.not('id', 'in', `(${takenIds.join(',')})`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
