import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://ixqfaygxandnbnsqgdgo.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cWZheWd4YW5kbmJuc3FnZGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE3MzczNjYsImV4cCI6MjA2NzMxMzM2Nn0.EfTW6YqqGb2tjTn0YKnZT1JTo8AuJpl-v9z745pSScw";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("registerForm");
const tableBody = document.querySelector("#playersTable tbody");
const teamSelect = document.getElementById("team");
const fullMsg = document.getElementById("fullMessage");

// Load data
async function loadData() {
  try {
    // Fetch registered players
    const { data: registered = [], error: regErr } = await supabase
      .from("registrations")
      .select("*");

    if (regErr) console.error("Registrations fetch error:", regErr.message);

    // Fetch all teams
    const { data: teams = [], error: teamsErr } = await supabase
      .from("teams")
      .select("*");

    if (teamsErr) console.error("Teams fetch error:", teamsErr.message);

    updateTable(registered);
    populateTeams(teams, registered);

    fullMsg.style.display = registered.length >= 32 ? "block" : "none";
  } catch (err) {
    console.error("Error loading data:", err);
  }
}

// Populate team dropdown
function populateTeams(teams, registered) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';

  const takenTeamIds = registered.map((p) => p.team_id);

  teams.forEach((t) => {
    if (!takenTeamIds.includes(t.id)) {
      const opt = document.createElement("option");
      opt.value = t.id; // Use team_id here
      opt.textContent = t.name;
      opt.dataset.crest = t.crest_url; // optional
      teamSelect.appendChild(opt);
    }
  });

  if (teamSelect.options.length === 1) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "All teams taken!";
    teamSelect.appendChild(opt);
  }
}

// Update players table
function updateTable(registered) {
  tableBody.innerHTML = "";
  registered.forEach((p, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.username}</td>
      <td>${p.whatsapp}</td>
      <td>${p.team_name || p.team}</td>
    `;
    tableBody.appendChild(row);
  });
}

// Register player
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team_id = parseInt(teamSelect.value); // send team_id to backend

  if (!username || !whatsapp || !team_id) return alert("Fill all fields!");

  try {
    // Insert player
    const { error: insertErr } = await supabase
      .from("registrations")
      .insert([{ username, whatsapp, team_id }]);

    if (insertErr) throw insertErr;

    alert("Registered successfully!");
    form.reset();
    loadData();
  } catch (err) {
    console.error("Registration error:", err);
    alert("Error registering player!");
  }
});

loadData();
