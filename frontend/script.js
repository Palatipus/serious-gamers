import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://ixqfaygxandnbnsqgdgo.supabase.co";
const SUPABASE_KEY = "YOUR_SUPABASE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("registerForm");
const tableBody = document.querySelector("#playersTable tbody");
const teamSelect = document.getElementById("team");
const fullMsg = document.getElementById("fullMessage");

// Load data
async function loadData() {
  const { data: registered = [] } = await supabase.from("registrations").select(`
    id,
    username,
    whatsapp,
    team:teams(id,name,crest_url)
  `);
  const { data: teams = [] } = await supabase.from("teams").select("*");

  updateTable(registered);
  populateTeams(teams, registered);
  fullMsg.style.display = registered.length >= 32 ? "block" : "none";
}

function populateTeams(teams, registered) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';
  const takenTeams = registered.map(p => p.team?.id);

  teams.forEach(t => {
    if (!takenTeams.includes(t.id)) {
      const opt = document.createElement("option");
      opt.value = t.id;
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

function updateTable(registered) {
  tableBody.innerHTML = "";
  registered.forEach((p, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.username}</td>
      <td>${p.whatsapp}</td>
      <td>
        ${p.team_name || p.team?.name} 
        ${p.team_crest || p.team?.crest_url ? `<img src="${p.team_crest || p.team?.crest_url}" width="30"/>` : ""}
      </td>
    `;
    tableBody.appendChild(row);
  });
}

// Register player
form.addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team_id = teamSelect.value;

  if (!username || !whatsapp || !team_id) return alert("Fill all fields!");

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, whatsapp, team_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Registration failed");

    alert(data.message);
    form.reset();
    loadData();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// Initial load
loadData();
