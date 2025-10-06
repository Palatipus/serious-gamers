import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://ixqfaygxandnbnsqgdgo.supabase.co";
const SUPABASE_KEY =
  "YOUR_SUPABASE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("registerForm");
const tableBody = document.querySelector("#playersTable tbody");
const teamSelect = document.getElementById("team");
const fullMsg = document.getElementById("fullMessage");

// Load data
async function loadData() {
  try {
    const { data: registered = [] } = await supabase.from("registrations_view").select("*");
    const { data: teams = [] } = await supabase.from("teams").select("*");

    updateTable(registered);
    populateTeams(teams, registered);

    fullMsg.style.display = registered.length >= 32 ? "block" : "none";
  } catch (err) {
    console.error("Error loading data:", err);
  }
}

// Populate team dropdown with available teams
function populateTeams(teams, registered) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';

  const takenIds = registered.map(p => p.team_id);

  teams.forEach(t => {
    if (!takenIds.includes(t.id)) {
      const opt = document.createElement("option");
      opt.value = t.id; // send team_id to backend
      opt.textContent = t.name;
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
  const team_id = teamSelect.value;

  if (!username || !whatsapp || !team_id) return alert("Fill all fields!");

  try {
    const { error } = await supabase
      .from("registrations")
      .insert([{ username, whatsapp, team_id }]);

    if (error) throw error;

    alert("Registered successfully!");
    form.reset();
    loadData();
  } catch (err) {
    console.error("Registration error:", err);
    alert("Failed to register: " + err.message);
  }
});

loadData();
