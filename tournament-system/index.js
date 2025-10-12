import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { supabase } from './lib/supabase.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- auth helpers ----
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
}
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Missing admin token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('bad role');
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---- static frontend ----
app.use(express.static(path.join(__dirname, 'frontend')));

// ---- API ----

// login (admin)
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = signToken({ role: 'admin', email });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// get groups with team info
app.get('/api/groups', async (req, res) => {
  try {
    const { data: groups, error: gErr } = await supabase
      .from('groups')
      .select('*')
      .order('group_name', { ascending: true });
    if (gErr) throw gErr;

    if (!groups?.length) return res.json([]);

    // pull teams
    const teamIds = [...new Set(groups.map(g => g.team_id))];
    const { data: teams, error: tErr } = await supabase
      .from('teams')
      .select('id,name')
      .in('id', teamIds);
    if (tErr) throw tErr;

    const tMap = new Map(teams.map(t => [t.id, t.name]));
    const grouped = groups.map(g => ({
      ...g,
      team_name: tMap.get(g.team_id) || `#${g.team_id}`
    }));

    res.json(grouped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// random generate groups (from registrations) – admin
app.post('/api/groups/generate', requireAdmin, async (req, res) => {
  try {
    // fetch registered team_ids (32)
    const { data: regs, error: rErr } = await supabase
      .from('registrations')
      .select('team_id');
    if (rErr) throw rErr;

    const teamIds = Array.from(new Set((regs || []).map(r => r.team_id)));
    if (teamIds.length !== 32) {
      return res.status(400).json({ error: `Need 32 registered teams, found ${teamIds.length}` });
    }

    // shuffle
    for (let i = teamIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [teamIds[i], teamIds[j]] = [teamIds[j], teamIds[i]];
    }

    const groupNames = ['A','B','C','D','E','F','G','H'];
    const rows = [];
    for (let g = 0; g < 8; g++) {
      const slice = teamIds.slice(g * 4, g * 4 + 4);
      slice.forEach(team_id => rows.push({ team_id, group_name: groupNames[g] }));
    }

    // clear and insert
    await supabase.from('groups').delete().neq('team_id', -1);
    const { error: insErr } = await supabase.from('groups').insert(rows);
    if (insErr) throw insErr;

    res.json({ message: 'Groups generated', rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// manual assign – admin
app.put('/api/groups/assign', requireAdmin, async (req, res) => {
  try {
    const { team_id, group_name } = req.body || {};
    if (!team_id || !'ABCDEFGH'.includes(group_name))
      return res.status(400).json({ error: 'team_id and group_name (A–H) required' });

    // upsert: ensure team in only one group
    await supabase.from('groups').delete().eq('team_id', team_id);
    const { error: insErr } = await supabase.from('groups').insert([{ team_id, group_name }]);
    if (insErr) throw insErr;

    res.json({ message: 'Assigned' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// generate fixtures (group stage) – admin
app.post('/api/fixtures/generate', requireAdmin, async (req, res) => {
  try {
    // read all groups
    const { data: groups, error: gErr } = await supabase
      .from('groups')
      .select('*')
      .order('group_name', { ascending: true });
    if (gErr) throw gErr;

    const byGroup = new Map();
    for (const g of groups) {
      if (!byGroup.has(g.group_name)) byGroup.set(g.group_name, []);
      byGroup.get(g.group_name).push(g.team_id);
    }

    // delete existing group fixtures to avoid duplicates
    await supabase.from('fixtures').delete().eq('round', 'Group');

    // make pairings for each group (4 teams -> 6 matches)
    const toInsert = [];
    for (const [group, teamIds] of byGroup.entries()) {
      if (teamIds.length !== 4) continue;
      for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
          const home = teamIds[i];
          const away = teamIds[j];
          toInsert.push({
            round: 'Group',
            group_name: group,
            home_team_id: home,
            away_team_id: away,
            kickoff: null
          });
        }
      }
    }

    if (toInsert.length === 0) {
      return res.status(400).json({ error: 'No groups found' });
    }

    const { error: insErr } = await supabase.from('fixtures').insert(toInsert);
    if (insErr) throw insErr;

    res.json({ message: 'Group fixtures generated', count: toInsert.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// list fixtures (with team names)
app.get('/api/fixtures', async (req, res) => {
  try {
    const { data: fixtures, error: fErr } = await supabase
      .from('fixtures')
      .select('*')
      .order('group_name', { ascending: true })
      .order('id', { ascending: true });
    if (fErr) throw fErr;

    if (!fixtures?.length) return res.json([]);

    const ids = new Set();
    fixtures.forEach(m => { ids.add(m.home_team_id); ids.add(m.away_team_id); });

    const { data: teams, error: tErr } = await supabase
      .from('teams')
      .select('id,name')
      .in('id', Array.from(ids));
    if (tErr) throw tErr;

    const tMap = new Map(teams.map(t => [t.id, t.name]));
    const out = fixtures.map(m => ({
      ...m,
      home_team_name: tMap.get(m.home_team_id) || `#${m.home_team_id}`,
      away_team_name: tMap.get(m.away_team_id) || `#${m.away_team_id}`
    }));

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// save score (anyone if not confirmed)
app.post('/api/fixtures/score', async (req, res) => {
  try {
    const { fixture_id, home_score, away_score } = req.body || {};
    if (!fixture_id || home_score === undefined || away_score === undefined)
      return res.status(400).json({ error: 'fixture_id, home_score, away_score required' });

    // block if already confirmed
    const { data: fx, error: gErr } = await supabase.from('fixtures').select('confirmed').eq('id', fixture_id).single();
    if (gErr) throw gErr;
    if (!fx) return res.status(404).json({ error: 'Fixture not found' });
    if (fx.confirmed) return res.status(400).json({ error: 'Fixture locked' });

    const { error: uErr } = await supabase
      .from('fixtures')
      .update({ home_score, away_score })
      .eq('id', fixture_id);
    if (uErr) throw uErr;

    res.json({ message: 'Saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// confirm (lock) score – asks confirm password each time
app.post('/api/fixtures/confirm', async (req, res) => {
  try {
    const { fixture_id, confirm_password } = req.body || {};
    if (!fixture_id || !confirm_password)
      return res.status(400).json({ error: 'fixture_id and confirm_password required' });

    if (confirm_password !== process.env.CONFIRM_PASSWORD)
      return res.status(401).json({ error: 'Wrong confirm password' });

    const { error: uErr } = await supabase
      .from('fixtures')
      .update({ confirmed: true })
      .eq('id', fixture_id);
    if (uErr) throw uErr;

    res.json({ message: 'Confirmed & locked' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// list all teams (id,name) – helper for admin
app.get('/api/teams', async (req, res) => {
  try {
    const { data, error } = await supabase.from('teams').select('id,name').order('name');
    if (error) throw error;
    res.json(data || []);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// catch-all -> frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'fixtures.html'));
});

// start
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Tournament backend running on :${PORT}`));
