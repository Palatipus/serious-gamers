import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ✅ Supabase credentials
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
  const { data: players } = await supabase.from("players").select("*");
  const { data: teams } = await supabase.from("teams").select("*");

  updateTable(players);
  populateTeams(teams, players);
  fullMsg.style.display = players.length >= 32 ? "block" : "none";
}

function populateTeams(teams, players) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';
  const taken = players.map((p) => p.team);

  teams.forEach((t) => {
    if (!taken.includes(t.name)) {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = t.name;
      opt.dataset.crest = t.crest_url;
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

function updateTable(players) {
  tableBody.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.username}</td>
      <td>${p.whatsapp}</td>
      <td>${p.team}</td>
    `;
    tableBody.appendChild(row);
  });
}

// Register player
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team = document.getElementById("team").value;

  if (!username || !whatsapp || !team) return alert("Fill all fields!");

  const { data: existing } = await supabase
    .from("players")
    .select("*")
    .eq("team", team);

  if (existing && existing.length > 0) {
    alert("Team already taken!");
    return;
  }

  const { data: players } = await supabase.from("players").select("*");
  if (players.length >= 32) {
    alert("Slots filled up!");
    return;
  }

  const { error } = await supabase
    .from("players")
    .insert([{ username, whatsapp, team }]);

  if (error) {
    console.error(error);
    alert("Error registering");
  } else {
    alert("Registered successfully!");
    form.reset();
    loadData();
  }
});

loadData();
