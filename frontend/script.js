const form = document.getElementById("registerForm");
const tableBody = document.querySelector("#playersTable tbody");
const teamSelect = document.getElementById("team");
const fullMsg = document.getElementById("fullMessage");

// Load data
async function loadData() {
  try {
    // Fetch registered players from backend
    const playersRes = await fetch("/api/players");
    const registered = await playersRes.json();

    // Fetch teams from backend
    const teamsRes = await fetch("/api/teams");
    const teams = await teamsRes.json();

    updateTable(registered);
    populateTeams(teams, registered);

    fullMsg.style.display = registered.length >= 32 ? "block" : "none";
  } catch (err) {
    console.error("Error loading data:", err);
  }
}

function populateTeams(teams, registered) {
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';
  const takenTeams = registered.map((p) => p.team_name || p.team);

  teams.forEach((t) => {
    if (!takenTeams.includes(t.name)) {
      const opt = document.createElement("option");
      opt.value = t.name;
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team_name = teamSelect.value;

  if (!username || !whatsapp || !team_name) return alert("Fill all fields!");

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, whatsapp, team_name }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.message || "Error registering player!");
      return;
    }

    alert(data.message);
    form.reset();
    loadData();
  } catch (err) {
    console.error(err);
    alert("Error registering player!");
  }
});

loadData();
