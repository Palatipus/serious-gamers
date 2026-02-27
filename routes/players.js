import express from ‘express’;
import { supabase } from ‘../lib/supabase.js’;

const router = express.Router();

// Login or auto-create player account (username + whatsapp)
router.post(’/players/login’, async (req, res) => {
const { username, whatsapp } = req.body;
if (!username || !whatsapp)
return res.status(400).json({ message: ‘Username and WhatsApp required.’ });

try {
// Check if player exists by username
const { data: existing } = await supabase
.from(‘players’)
.select(’*’)
.eq(‘username’, username.trim())
.single();

```
if (existing) {
  // Verify whatsapp matches
  if (existing.whatsapp !== whatsapp.trim()) {
    return res.status(401).json({ message: 'Wrong WhatsApp for this username.' });
  }
  return res.json({ player: existing, created: false });
}

// New player — create account
const { data: newPlayer, error } = await supabase
  .from('players')
  .insert([{ username: username.trim(), whatsapp: whatsapp.trim() }])
  .select()
  .single();
if (error) throw error;

res.json({ player: newPlayer, created: true });
```

} catch (err) {
res.status(500).json({ error: err.message });
}
});

// Get all tournament IDs a player is registered in (single fast query)
router.get(”/players/:id/registrations”, async (req, res) => {
try {
const { data, error } = await supabase
.from(“registrations”)
.select(“tournament_id, team_id”)
.eq(“player_id”, req.params.id);
if (error) throw error;
res.json(data || []);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

// Get player by ID (with their tournament history)
router.get(’/players/:id’, async (req, res) => {
try {
const { data: player, error } = await supabase
.from(‘players’)
.select(‘id, username, whatsapp, created_at’)
.eq(‘id’, req.params.id)
.single();
if (error) throw error;
if (!player) return res.status(404).json({ message: ‘Player not found.’ });
res.json(player);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

// Get all matches for a player across all tournaments
router.get(’/players/:id/matches’, async (req, res) => {
const playerId = parseInt(req.params.id);
try {
// Get player’s registrations
const { data: regs } = await supabase
.from(‘registrations’)
.select(‘id, tournament_id, team_id’)
.eq(‘player_id’, playerId);
if (!regs || !regs.length) return res.json([]);

```
const regIds = regs.map(r => r.id);

// Get matches involving this player
const { data: matches, error } = await supabase
  .from('matches')
  .select('*')
  .or(`home_reg_id.in.(${regIds.join(',')}),away_reg_id.in.(${regIds.join(',')})`)
  .order('created_at', { ascending: true });
if (error) throw error;

// Enrich with teams and opponent player info
const { data: teams } = await supabase.from('teams').select('*');
const { data: allRegs } = await supabase
  .from('registrations')
  .select('id, player_id, team_id');
const { data: allPlayers } = await supabase
  .from('players')
  .select('id, username, whatsapp');
const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name');

const enriched = matches.map(m => {
  const isHome = regIds.includes(m.home_reg_id);
  const myRegId = isHome ? m.home_reg_id : m.away_reg_id;
  const oppRegId = isHome ? m.away_reg_id : m.home_reg_id;

  const myTeamId = isHome ? m.home_team_id : m.away_team_id;
  const oppTeamId = isHome ? m.away_team_id : m.home_team_id;

  const myTeam = teams?.find(t => t.id === myTeamId);
  const oppTeam = teams?.find(t => t.id === oppTeamId);

  const oppReg = allRegs?.find(r => r.id === oppRegId);
  const oppPlayer = allPlayers?.find(p => p.id === oppReg?.player_id);
  const tournament = tournaments?.find(t => t.id === m.tournament_id);

  const myScore = isHome ? m.home_score : m.away_score;
  const oppScore = isHome ? m.away_score : m.home_score;

  let result = null;
  if (m.confirmed && myScore !== null && oppScore !== null) {
    result = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D';
  }

  return {
    ...m,
    tournament_name: tournament?.name,
    my_team: myTeam?.name,
    opp_team: oppTeam?.name,
    opp_username: oppPlayer?.username,
    opp_whatsapp: oppPlayer?.whatsapp,  // private — only shown to the player
    my_score: myScore,
    opp_score: oppScore,
    result,
    is_home: isHome
  };
});

res.json(enriched);
```

} catch (err) {
res.status(500).json({ error: err.message });
}
});

export default router;