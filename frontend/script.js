const form = document.getElementById("registerForm");
const tableBody = document.querySelector("#playersTable tbody");
const teamSelect = document.getElementById("team");
const fullMsg = document.getElementById("fullMessage");

// Load teams and registrations from backend
async function loadData() {
  try {
    // Fetch teams
    const teamsRes = await fetch("/api/teams");
    const teams = await teamsRes.json();

    // Fetch players
    const playersRes = await fetch("/api/players");
    const players = await playersRes.json();

    populateTeams(teams, players);
    updateTable(players);

    fullMsg.style.display = players.length >= 32 ? "block" : "none";
  } catch (err) {
    console.error("Error loading data:", err);
  }
}

// Populate team dropdown
function populateTeams(teams, players) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';

  const takenTeamIds = players.map(p => p.team_id);

  teams.forEach(t => {
    if (!takenTeamIds.includes(t.id)) {
      const opt = document.createElement("option");
      opt.value = t.id;
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
function updateTable(players) {
  tableBody.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.username}</td>
      <td>${p.whatsapp}</td>
      <td>${p.team_name}</td>
    `;
    tableBody.appendChild(row);
  });
}

// Register player
form.addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team_id = parseInt(teamSelect.value);

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
