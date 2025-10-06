form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const team_id = teamSelect.value; // now we send team_id

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

    // Add the new player to table immediately
    tableBody.innerHTML += `
      <tr>
        <td>${tableBody.rows.length + 1}</td>
        <td>${data.player.username}</td>
        <td>${data.player.whatsapp}</td>
        <td>
          ${data.player.team_name} 
          ${data.player.team_crest ? `<img src="${data.player.team_crest}" width="30"/>` : ""}
        </td>
      </tr>
    `;

    // Reload dropdown
    loadData();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});
