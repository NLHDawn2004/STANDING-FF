/* =========================================================

   FREE FIRE STANDINGS

   - Unlimited Match IDs (API batches of 8)

   - Overall cumulative standings

   - Team Data

   - Player Data

   - Average

   - Operation

========================================================= */



const state = {

  matchIds: [],

  responses: [],

  teams: new Map(),

  logos: {},

  selectedLogoTeam: null,

  detailGame: "overall",

  detailTab: "team",

  templates: JSON.parse(localStorage.getItem("ff_templates") || "[]")

};



const $ = s => document.querySelector(s);

const $$ = s => [...document.querySelectorAll(s)];



const matchInput = $("#matchId");

const fetchBtn = $("#fetchBtn");

const statusEl = $("#status");

const summary = $("#matchSummary");

const detailPanel = $("#detailPanel");

const detailContent = $("#detailContent");

const boardRows = $("#boardRows");

const boardEmpty = $("#boardEmpty");

const boardGame = $("#boardGame");

const accumulateBtn = $("#accumulateBtn");

const logoPicker = $("#logoPicker");



/* =========================================================

   BASIC HELPERS

========================================================= */



function number(value) {

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;

}



function escapeHTML(value) {

  return String(value ?? "")

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;")

    .replace(/'/g, "&#039;");

}



function setStatus(message, type = "") {

  statusEl.textContent = message;

  statusEl.className = `status ${type}`;

}



function average(total, games, decimals = 2) {

  if (!games) return "0.00";

  return (number(total) / games).toFixed(decimals);

}



/*

 * survival_time của API có thể là số.

 * Hàm này hiển thị tổng thời gian dưới dạng HH:MM:SS hoặc MM:SS.

 */

function formatTime(value) {

  let total = Math.max(0, Math.round(number(value)));



  const hours = Math.floor(total / 3600);

  total %= 3600;



  const minutes = Math.floor(total / 60);

  const seconds = total % 60;



  if (hours > 0) {

    return (

      String(hours).padStart(2, "0") +

      ":" +

      String(minutes).padStart(2, "0") +

      ":" +

      String(seconds).padStart(2, "0")

    );

  }



  return (

    String(minutes).padStart(2, "0") +

    ":" +

    String(seconds).padStart(2, "0")

  );

}



function formatAverageTime(value, games) {

  if (!games) return "00:00";

  return formatTime(number(value) / games);

}



/* =========================================================

   MATCH ID

========================================================= */



function parseMatchIds(value) {

  return [

    ...new Set(

      String(value)

        .split(/[,;\n\r]+/)

        .map(v => v.trim())

        .filter(Boolean)

    )

  ];

}



function validateMatchIds(ids) {

  if (!ids.length) {

    throw new Error("Hãy nhập ít nhất 1 Match ID.");

  }



  const invalid = ids.filter(id => !/^\d{10,25}$/.test(id));



  if (invalid.length) {

    throw new Error(

      "Match ID không hợp lệ: " +

      invalid.slice(0, 5).join(", ")

    );

  }

}



function splitIntoBatches(ids, size = 8) {

  const result = [];



  for (let i = 0; i < ids.length; i += size) {

    result.push(ids.slice(i, i + size));

  }



  return result;

}



/* =========================================================

   API DATA HELPERS

========================================================= */



function getTeamGroups(response) {

  const groups = response?.data?.team_stats;

  return Array.isArray(groups) ? groups : [];

}



function getTeamKey(team) {

  const name = String(team?.team_name || "").trim().toUpperCase();



  if (name) return name;



  return String(team?.team_id ?? "UNKNOWN");

}



function getPlayerKey(player, teamKey = "") {

  const playerId = String(player?.player_id ?? "").trim();



  /*

   * Ưu tiên player_id nếu API có ID hợp lệ.

   */

  if (

    playerId &&

    playerId !== "0" &&

    playerId !== "-1" &&

    playerId !== "null" &&

    playerId !== "undefined"

  ) {

    return `ID:${playerId}`;

  }



  /*

   * Fallback: TEAM + PLAYER NAME.

   */

  return (

    "NAME:" +

    String(teamKey).toUpperCase() +

    "::" +

    String(player?.player_name || "UNKNOWN").trim().toUpperCase()

  );

}



function getPlayerName(player) {

  return String(

    player?.player_name ||

    player?.nickname ||

    player?.name ||

    "UNKNOWN"

  ).trim();

}



/*

 * API response có thể chứa player_data trong từng team.

 */

function getPlayersFromTeam(team) {

  if (Array.isArray(team?.player_data)) {

    return team.player_data;

  }



  if (Array.isArray(team?.players)) {

    return team.players;

  }



  return [];

}



/* =========================================================

   REQUEST BATCH

========================================================= */



async function requestBatch(ids, batchIndex, totalBatches) {

  setStatus(

    `Đang tải nhóm ${batchIndex + 1}/${totalBatches} · ${ids.length} trận...`

  );



  const response = await fetch("/api/match", {

    method: "POST",

    headers: {

      "Content-Type": "application/json"

    },

    body: JSON.stringify({

      match_ids: ids

    })

  });



  let result;



  try {

    result = await response.json();

  } catch {

    throw new Error(

      `Nhóm ${batchIndex + 1} trả về dữ liệu không hợp lệ. HTTP ${response.status}`

    );

  }



  if (!response.ok || !result.ok) {

    throw new Error(

      result?.error ||

      `Không lấy được nhóm ${batchIndex + 1}.`

    );

  }



  const apiResponse = result.data;



  if (apiResponse?.status && apiResponse.status !== "success") {

    throw new Error(

      apiResponse.msg ||

      `Match Stats báo lỗi ở nhóm ${batchIndex + 1}.`

    );

  }



  return {

    requestedIds: ids,

    data: apiResponse

  };

}



function delay(ms) {

  return new Promise(resolve => setTimeout(resolve, ms));

}



/* =========================================================

   FETCH ALL MATCHES

========================================================= */



async function fetchMatches() {

  let ids;



  try {

    ids = parseMatchIds(matchInput.value);

    validateMatchIds(ids);

  } catch (error) {

    setStatus(error.message, "error");

    return;

  }



  const batches = splitIntoBatches(ids, 8);



  fetchBtn.disabled = true;

  fetchBtn.textContent = "Đang lấy...";



  state.matchIds = [];

  state.responses = [];

  state.teams.clear();

  state.detailGame = "overall";

  state.detailTab = "team";



  render();



  try {

    for (let i = 0; i < batches.length; i++) {

      const batch = batches[i];



      setStatus(

        `Đang lấy ${ids.length} trận · nhóm ${i + 1}/${batches.length} · ` +

        `${i * 8 + 1}-${Math.min((i + 1) * 8, ids.length)}`

      );



      const result = await requestBatch(

        batch,

        i,

        batches.length

      );



      state.responses.push(result);

      state.matchIds.push(...batch);



      rebuildStandings();



      await delay(150);

    }



    rebuildStandings();



    setStatus(

      `Đã tải và cộng dồn thành công ${state.matchIds.length} trận.`,

      "success"

    );

  } catch (error) {

    console.error(error);



    rebuildStandings();



    setStatus(

      `${error.message} Đã giữ ${state.matchIds.length}/${ids.length} trận tải thành công.`,

      "error"

    );

  } finally {

    fetchBtn.disabled = false;

    fetchBtn.textContent = "Lấy điểm ↗";

  }

}



/* =========================================================

   NORMALIZE ALL MATCHES

========================================================= */



function getAllMatches() {

  const matches = [];



  state.responses.forEach(batchResponse => {

    const groups = getTeamGroups(batchResponse.data);



    groups.forEach((group, localIndex) => {

      matches.push({

        gameNumber: matches.length + 1,



        matchId: String(

          group.match_id ||

          batchResponse.requestedIds?.[localIndex] ||

          ""

        ),



        teams: Array.isArray(group.team_stats)

          ? group.team_stats

          : []

      });

    });

  });



  return matches;

}



/* =========================================================

   TEAM STANDINGS

========================================================= */



function createTeam(team) {

  return {

    key: getTeamKey(team),



    name: String(

      team.team_name ||

      team.team_id ||

      "UNKNOWN"

    ).trim(),



    games: 0,

    booyah: 0,

    placement: 0,

    kills: 0,

    damage: 0,

    total: 0,



    headshots: 0,

    survivalTime: 0,

    revival: 0,

    rescueMembers: 0,



    grenadeUse: 0,

    grenadeDamage: 0,

    grenadeKills: 0,



    icewallUse: 0,

    icewallDestroyed: 0,



    medkitUse: 0,

    onTarget: 0,



    maxKillDistance: 0,



    gameResults: []

  };

}



function addTeamStats(target, team, match) {

  const booyah = number(team.booyah);



  const placement = number(

    team.survival_score

  );



  const kills = number(

    team.kills ?? team.killing_score

  );



  const damage = number(team.damage);

  const total = number(team.total_score);



  target.games += 1;

  target.booyah += booyah;

  target.placement += placement;

  target.kills += kills;

  target.damage += damage;

  target.total += total;



  target.headshots += number(team.headshots);

  target.survivalTime += number(team.survival_time);

  target.revival += number(team.revival);

  target.rescueMembers += number(team.rescue_members);



  target.grenadeUse += number(team.grenade_use);

  target.grenadeDamage += number(team.grenade_damage);

  target.grenadeKills += number(team.grenade_kills);



  target.icewallUse += number(team.icewall_use);

  target.icewallDestroyed += number(

    team.icewall_destroyed_times

  );



  target.medkitUse += number(team.medkit_use);

  target.onTarget += number(team.on_target);



  target.maxKillDistance = Math.max(

    target.maxKillDistance,

    number(team.max_kill_distance)

  );



  target.gameResults.push({

    gameNumber: match.gameNumber,

    matchId: match.matchId,



    matchRank: number(team.match_rank),



    booyah,

    placement,

    kills,

    damage,

    total

  });

}



function sortStandingTeams(teams) {

  if (state.matchIds?.length === 1 && state.matchIds[0] === "IMAGE-SCOREBOARD") {
    return teams.sort((a, b) => (a.importRank ?? 999) - (b.importRank ?? 999));
  }

  return teams.sort((a, b) => {

    if (b.total !== a.total) return b.total - a.total;

    if (b.booyah !== a.booyah) return b.booyah - a.booyah;

    if (b.kills !== a.kills) return b.kills - a.kills;

    if (b.placement !== a.placement) return b.placement - a.placement;



    return String(a.name).localeCompare(String(b.name));

  });

}



function buildTeamStandings(targetGame = null) {

  const map = new Map();

  const matches = getAllMatches();



  const selectedMatches =

    targetGame === null

      ? matches

      : matches.slice(0, targetGame);



  selectedMatches.forEach(match => {

    match.teams.forEach(team => {

      const key = getTeamKey(team);



      if (!map.has(key)) {

        map.set(key, createTeam(team));

      }



      addTeamStats(

        map.get(key),

        team,

        match

      );

    });

  });



  return sortStandingTeams(

    [...map.values()]

  );

}



function rebuildStandings() {

  state.teams.clear();



  const teams = buildTeamStandings();



  teams.forEach(team => {

    state.teams.set(

      team.key,

      team

    );

  });



  render();

}



function sortedTeams() {

  return sortStandingTeams(

    [...state.teams.values()]

  );

}



/* =========================================================

   PLAYER DATA



   Cộng từng player qua tất cả game đã chọn.

========================================================= */



function createPlayer(player, team) {

  const teamKey = getTeamKey(team);



  return {

    key: getPlayerKey(

      player,

      teamKey

    ),



    playerId: String(

      player.player_id ?? ""

    ),



    name: getPlayerName(player),



    team: String(

      player.team_name ||

      team.team_name ||

      ""

    ).trim(),



    games: 0,



    kills: 0,

    assists: 0,

    damage: 0,



    headshots: 0,



    survivalTime: 0,



    revival: 0,



    rescueMembers: 0,



    knockDown: 0,



    onTarget: 0,



    grenadeUse: 0,

    grenadeDamage: 0,

    grenadeKills: 0,



    icewallUse: 0,

    icewallDestroyed: 0,



    medkitUse: 0,



    movingDistance: 0,



    vehicleKill: 0,

    oilKill: 0,



    maxKillDistance: 0

  };

}



function addPlayerStats(target, player) {

  target.games += 1;



  target.kills += number(player.kills);

  target.assists += number(player.assists);

  target.damage += number(player.damage);



  target.headshots += number(player.headshots);



  target.survivalTime += number(

    player.survival_time

  );



  target.revival += number(

    player.revival

  );



  target.rescueMembers += number(

    player.rescue_members

  );



  target.knockDown += number(

    player.knock_down

  );



  target.onTarget += number(

    player.on_target

  );



  target.grenadeUse += number(

    player.grenade_use

  );



  target.grenadeDamage += number(

    player.grenade_damage

  );



  target.grenadeKills += number(

    player.grenade_kills

  );



  target.icewallUse += number(

    player.icewall_use

  );



  target.icewallDestroyed += number(

    player.icewall_destroyed_times

  );



  target.medkitUse += number(

    player.medkit_use

  );



  target.movingDistance += number(

    player.moving_distance

  );



  target.vehicleKill += number(

    player.vehicle_kill

  );



  target.oilKill += number(

    player.oil_kill

  );



  target.maxKillDistance = Math.max(

    target.maxKillDistance,

    number(player.max_kill_distance)

  );

}



function buildPlayerData(targetGame = null) {

  const players = new Map();



  const matches = getAllMatches();



  const selectedMatches =

    targetGame === null

      ? matches

      : matches.slice(0, targetGame);



  selectedMatches.forEach(match => {

    match.teams.forEach(team => {

      const teamKey = getTeamKey(team);



      getPlayersFromTeam(team).forEach(player => {

        const key = getPlayerKey(

          player,

          teamKey

        );



        if (!players.has(key)) {

          players.set(

            key,

            createPlayer(

              player,

              team

            )

          );

        }



        const target =

          players.get(key);



        /*

         * Giữ tên/team mới nhất nếu API có.

         */

        if (getPlayerName(player)) {

          target.name =

            getPlayerName(player);

        }



        if (

          player.team_name ||

          team.team_name

        ) {

          target.team = String(

            player.team_name ||

            team.team_name

          ).trim();

        }



        addPlayerStats(

          target,

          player

        );

      });

    });

  });



  return [...players.values()];

}



/* =========================================================

   PLAYER SORT

========================================================= */



function sortPlayers(players) {

  return players.sort((a, b) => {

    if (b.kills !== a.kills) {

      return b.kills - a.kills;

    }



    if (b.damage !== a.damage) {

      return b.damage - a.damage;

    }



    if (b.assists !== a.assists) {

      return b.assists - a.assists;

    }



    return a.name.localeCompare(b.name);

  });

}



/* =========================================================

   DETAIL TARGET

========================================================= */



function getDetailTargetGame() {

  const matches =

    getAllMatches();



  if (

    state.detailGame === "overall"

  ) {

    return matches.length;

  }



  const n =

    Number(state.detailGame);



  if (!Number.isFinite(n)) {

    return matches.length;

  }



  return Math.max(

    1,

    Math.min(

      n,

      matches.length

    )

  );

}



/* =========================================================

   MAIN RENDER

========================================================= */



function render() {

  renderSummary();

  renderBoard();



  if (

    detailPanel &&

    !detailPanel.classList.contains("hidden")

  ) {

    renderDetails();

  }



  const count =

    state.matchIds.length;



  if (accumulateBtn) {

    accumulateBtn.textContent =

      `Cộng dồn · ${count} trận`;

  }



  if (boardGame) {

    boardGame.textContent =

      `${count} MATCH${count === 1 ? "" : "ES"}`;

  }

}



/* =========================================================

   SUMMARY

========================================================= */



function renderSummary() {

  if (!state.matchIds.length) {

    summary.className =

      "match-summary empty-state";



    summary.textContent =

      "Nhập Match ID và bấm Lấy điểm để xem dữ liệu.";



    return;

  }



  const teams =

    sortedTeams();



  const totalKills =

    teams.reduce(

      (sum, team) =>

        sum + team.kills,

      0

    );



  const totalDamage =

    teams.reduce(

      (sum, team) =>

        sum + team.damage,

      0

    );



  const totalBooyah =

    teams.reduce(

      (sum, team) =>

        sum + team.booyah,

      0

    );



  summary.className =

    "match-summary";



  summary.innerHTML = `



    <div class="summary-grid">



      <div class="summary-card">

        <small>MATCHES</small>

        <strong>${state.matchIds.length}</strong>

      </div>



      <div class="summary-card">

        <small>TEAMS</small>

        <strong>${teams.length}</strong>

      </div>



      <div class="summary-card">

        <small>BOOYAH</small>

        <strong>${totalBooyah}</strong>

      </div>



      <div class="summary-card">

        <small>KILLS</small>

        <strong>${totalKills}</strong>

      </div>



      <div class="summary-card">

        <small>DAMAGE</small>

        <strong>${totalDamage.toLocaleString()}</strong>

      </div>



    </div>



    <div

      style="

        margin-top:18px;

        font-size:12px;

        line-height:1.8;

        color:#77746d;

        word-break:break-word;

      "

    >

      <strong>

        ${state.matchIds.length} MATCH ID:

      </strong>



      ${state.matchIds

        .map(escapeHTML)

        .join(" · ")}

    </div>

  `;

}



/* =========================================================

   MAIN BOARD

========================================================= */



function renderBoard() {
  const teams = sortedTeams().slice(0, 12);
  boardRows.innerHTML = "";
  boardEmpty.style.display = "none";
  teams.forEach((team, index) => {
    const row = document.createElement("div");
    row.className = "custom-ranking-row" + (index < 3 ? " custom-top" : "");
    row.style.setProperty("--row-index", index);
    const logo = rankingTeamLogo(team);
    const safeName = escapeHTML(team.name);
    row.innerHTML = `
      <div class="custom-logo logo-box" data-team="${escapeHTML(team.key)}" title="Bấm để chọn logo">${logo ? `<img src="${logo}" alt="">` : `<span>+</span>`}</div>
      <div class="custom-name" title="${safeName}">${safeName}</div>
      <div class="custom-stat custom-booyah">${team.booyah ?? 0}</div>
      <div class="custom-stat custom-kills">${team.kills ?? 0}</div>
      <div class="custom-stat custom-place">${team.placement ?? 0}</div>
      <div class="custom-stat custom-total">${team.total ?? 0}</div>`;
    boardRows.appendChild(row);
  });
  boardRows.querySelectorAll(".logo-box").forEach(box => {
    box.onclick = () => { state.selectedLogoTeam = box.dataset.team; logoPicker.click(); };
  });
  resizeBoard();
}


function renderDetails() {

  const matches =

    getAllMatches();



  if (!matches.length) {

    detailContent.innerHTML = "";

    return;

  }



  let gameButtons = "";



  matches.forEach(match => {

    const active =

      String(state.detailGame) ===

      String(match.gameNumber);



    gameButtons += `



      <button

        class="detail-game-selector"

        data-game="${match.gameNumber}"

        style="

          padding:9px 14px;

          border-radius:6px;

          border:${active ? "2px solid #111" : "1px solid #d5d5d5"};

          background:${active ? "#111" : "#fff"};

          color:${active ? "#fff" : "#111"};

          font-weight:800;

          cursor:pointer;

        "

      >

        GAME ${match.gameNumber}

      </button>

    `;

  });



  const overallActive =

    state.detailGame === "overall";



  gameButtons += `



    <button

      class="detail-game-selector"

      data-game="overall"

      style="

        padding:9px 16px;

        border-radius:6px;

        border:${overallActive ? "2px solid #111" : "1px solid #d5d5d5"};

        background:${overallActive ? "#111" : "#fff"};

        color:${overallActive ? "#fff" : "#111"};

        font-weight:900;

        cursor:pointer;

      "

    >

      OVERALL

    </button>

  `;



  detailContent.innerHTML = `



    <div

      style="

        display:flex;

        gap:8px;

        flex-wrap:wrap;

        margin-bottom:18px;

      "

    >

      ${gameButtons}

    </div>



    <div

      style="

        display:flex;

        gap:8px;

        flex-wrap:wrap;

        margin-bottom:22px;

        padding-bottom:16px;

        border-bottom:1px solid #ddd;

      "

    >



      ${detailTabButton(

        "team",

        "TEAM DATA"

      )}



      ${detailTabButton(

        "player",

        "PLAYER DATA"

      )}



      ${detailTabButton(

        "average",

        "AVERAGE"

      )}



      ${detailTabButton(

        "operation",

        "OPERATION"

      )}



    </div>



    <div id="detailDataArea"></div>

  `;



  $$(".detail-game-selector").forEach(button => {

    button.onclick = () => {

      state.detailGame =

        button.dataset.game;



      renderDetails();

    };

  });



  $$(".detail-data-tab").forEach(button => {

    button.onclick = () => {

      state.detailTab =

        button.dataset.tab;



      renderDetails();

    };

  });



  renderSelectedDetailTab();

}



function detailTabButton(

  id,

  label

) {

  const active =

    state.detailTab === id;



  return `



    <button

      class="detail-data-tab"

      data-tab="${id}"

      style="

        padding:11px 18px;

        border:0;

        border-radius:6px;

        cursor:pointer;

        font-weight:900;

        background:${active ? "#54e7ec" : "#ececec"};

        color:#111;

      "

    >

      ${label}

    </button>

  `;

}



function renderSelectedDetailTab() {

  switch (state.detailTab) {

    case "player":

      renderPlayerDetail();

      break;



    case "average":

      renderAverageDetail();

      break;



    case "operation":

      renderOperationDetail();

      break;



    default:

      renderTeamDetail();

      break;

  }

}



/* =========================================================

   DETAIL TITLE

========================================================= */



function detailHeading(title) {

  const targetGame =

    getDetailTargetGame();



  const matches =

    getAllMatches();



  const currentMatch =

    matches[targetGame - 1];



  const isOverall =

    state.detailGame === "overall";



  return `



    <div style="margin-bottom:18px;">



      <div

        style="

          font-size:20px;

          font-weight:900;

        "

      >

        ${escapeHTML(title)}

      </div>



      <div

        style="

          margin-top:6px;

          font-size:12px;

          opacity:.6;

        "

      >



        ${

          isOverall

            ? `Cộng dồn toàn bộ ${targetGame} trận`

            : `Cộng dồn GAME 1 → GAME ${targetGame}`

        }



        ${

          currentMatch?.matchId

            ? ` · Match hiện tại: ${escapeHTML(currentMatch.matchId)}`

            : ""

        }



      </div>



    </div>

  `;

}



/* =========================================================

   TEAM DATA

========================================================= */



function renderTeamDetail() {

  const container =

    $("#detailDataArea");



  if (!container) return;



  const targetGame =

    getDetailTargetGame();



  const teams =

    buildTeamStandings(

      targetGame

    );



  let rows = "";



  teams.forEach((team, index) => {

    rows += `



      <tr>



        <td>

          <strong>#${index + 1}</strong>

        </td>



        <td>

          <strong>${escapeHTML(team.name)}</strong>

        </td>



        <td>${team.games}</td>



        <td>${team.booyah}</td>



        <td>${team.placement}</td>



        <td>${team.kills}</td>



        <td>${team.damage.toLocaleString()}</td>



        <td>

          <strong>${team.total}</strong>

        </td>



      </tr>

    `;

  });



  container.innerHTML = `



    ${detailHeading("TEAM DATA")}



    <div style="overflow:auto;">



      <table class="detail-table">



        <thead>

          <tr>

            <th>#</th>

            <th>TEAM</th>

            <th>GAMES</th>

            <th>BOOYAH</th>

            <th>PLACEMENT</th>

            <th>KILLS</th>

            <th>DAMAGE</th>

            <th>TOTAL</th>

          </tr>

        </thead>



        <tbody>

          ${rows}

        </tbody>



      </table>



    </div>

  `;

}



/* =========================================================

   PLAYER DATA

========================================================= */



function renderPlayerDetail() {

  const container =

    $("#detailDataArea");



  if (!container) return;



  const targetGame =

    getDetailTargetGame();



  const players =

    sortPlayers(

      buildPlayerData(

        targetGame

      )

    );



  if (!players.length) {

    container.innerHTML = `



      ${detailHeading("PLAYER DATA")}



      <div class="empty-state">

        API không trả về player_data cho các trận đang chọn.

      </div>

    `;



    return;

  }



  let rows = "";



  players.forEach((player, index) => {

    rows += `



      <tr>



        <td>

          <strong>#${index + 1}</strong>

        </td>



        <td>

          <strong>

            ${escapeHTML(player.name)}

          </strong>

        </td>



        <td>

          ${escapeHTML(player.team)}

        </td>



        <td>

          ${player.games}

        </td>



        <td>

          ${player.kills}

        </td>



        <td>

          ${player.assists}

        </td>



        <td>

          ${player.damage.toLocaleString()}

        </td>



        <td>

          ${player.headshots}

        </td>



        <td>

          ${formatTime(player.survivalTime)}

        </td>



        <td>

          ${player.revival}

        </td>



        <td>

          ${player.rescueMembers}

        </td>



      </tr>

    `;

  });



  container.innerHTML = `



    ${detailHeading("PLAYER DATA")}



    <div style="overflow:auto;">



      <table class="detail-table">



        <thead>



          <tr>



            <th>#</th>



            <th>PLAYER</th>



            <th>TEAM</th>



            <th>GAMES</th>



            <th>KILLS</th>



            <th>ASSISTS</th>



            <th>DAMAGE</th>



            <th>HEADSHOTS</th>



            <th>SURVIVAL TIME</th>



            <th>REVIVAL</th>



            <th>RESCUE MEMBERS</th>



          </tr>



        </thead>



        <tbody>

          ${rows}

        </tbody>



      </table>



    </div>

  `;

}



/* =========================================================

   AVERAGE



   Average được tính theo games thực tế của player.

========================================================= */



function renderAverageDetail() {

  const container =

    $("#detailDataArea");



  if (!container) return;



  const targetGame =

    getDetailTargetGame();



  const players =

    sortPlayers(

      buildPlayerData(

        targetGame

      )

    );



  if (!players.length) {

    container.innerHTML = `



      ${detailHeading("AVERAGE")}



      <div class="empty-state">

        Không có Player Data để tính Average.

      </div>

    `;



    return;

  }



  let rows = "";



  players.forEach((player, index) => {

    rows += `



      <tr>



        <td>

          <strong>#${index + 1}</strong>

        </td>



        <td>

          <strong>

            ${escapeHTML(player.name)}

          </strong>

        </td>



        <td>

          ${escapeHTML(player.team)}

        </td>



        <td>

          ${player.games}

        </td>



        <td>

          ${average(player.kills, player.games)}

        </td>



        <td>

          ${average(player.assists, player.games)}

        </td>



        <td>

          ${average(player.damage, player.games)}

        </td>



        <td>

          ${average(player.headshots, player.games)}

        </td>



        <td>

          ${formatAverageTime(

            player.survivalTime,

            player.games

          )}

        </td>



        <td>

          ${average(player.revival, player.games)}

        </td>



        <td>

          ${average(player.rescueMembers, player.games)}

        </td>



      </tr>

    `;

  });



  container.innerHTML = `



    ${detailHeading("AVERAGE")}



    <div

      style="

        margin-bottom:14px;

        font-size:12px;

        opacity:.65;

      "

    >

      Average được chia theo số trận thực tế mà player xuất hiện.

    </div>



    <div style="overflow:auto;">



      <table class="detail-table">



        <thead>



          <tr>



            <th>#</th>



            <th>PLAYER</th>



            <th>TEAM</th>



            <th>GAMES</th>



            <th>KILLS / GAME</th>



            <th>ASSISTS / GAME</th>



            <th>DAMAGE / GAME</th>



            <th>HEADSHOTS / GAME</th>



            <th>SURVIVAL / GAME</th>



            <th>REVIVAL / GAME</th>



            <th>RESCUE / GAME</th>



          </tr>



        </thead>



        <tbody>

          ${rows}

        </tbody>



      </table>



    </div>

  `;

}



/* =========================================================

   OPERATION



   Dùng các field operation có trong API:

   grenade_use

   grenade_damage

   grenade_kills

   icewall_use

   icewall_destroyed_times

   medkit_use

   knock_down

   on_target

   moving_distance

   max_kill_distance

   vehicle_kill

   oil_kill

========================================================= */



function renderOperationDetail() {

  const container =

    $("#detailDataArea");



  if (!container) return;



  const targetGame =

    getDetailTargetGame();



  const players =

    sortPlayers(

      buildPlayerData(

        targetGame

      )

    );



  if (!players.length) {

    container.innerHTML = `



      ${detailHeading("OPERATION")}



      <div class="empty-state">

        Không có Player Data để hiển thị Operation.

      </div>

    `;



    return;

  }



  let rows = "";



  players.forEach((player, index) => {

    rows += `



      <tr>



        <td>

          <strong>#${index + 1}</strong>

        </td>



        <td>

          <strong>

            ${escapeHTML(player.name)}

          </strong>

        </td>



        <td>

          ${escapeHTML(player.team)}

        </td>



        <td>

          ${player.games}

        </td>



        <td>

          ${player.knockDown}

        </td>



        <td>

          ${player.grenadeUse}

        </td>



        <td>

          ${player.grenadeDamage.toLocaleString()}

        </td>



        <td>

          ${player.grenadeKills}

        </td>



        <td>

          ${player.icewallUse}

        </td>



        <td>

          ${player.icewallDestroyed}

        </td>



        <td>

          ${player.medkitUse}

        </td>



        <td>

          ${player.onTarget}

        </td>



        <td>

          ${Math.round(player.movingDistance).toLocaleString()}

        </td>



        <td>

          ${Math.round(player.maxKillDistance).toLocaleString()}

        </td>



        <td>

          ${player.vehicleKill}

        </td>



        <td>

          ${player.oilKill}

        </td>



      </tr>

    `;

  });



  container.innerHTML = `



    ${detailHeading("OPERATION")}



    <div style="overflow:auto;">



      <table class="detail-table">



        <thead>



          <tr>



            <th>#</th>



            <th>PLAYER</th>



            <th>TEAM</th>



            <th>GAMES</th>



            <th>KNOCK DOWN</th>



            <th>GRENADE USE</th>



            <th>GRENADE DAMAGE</th>



            <th>GRENADE KILLS</th>



            <th>GLOO WALL USE</th>



            <th>GLOO WALL DESTROYED</th>



            <th>MEDKIT USE</th>



            <th>ON TARGET</th>



            <th>MOVING DISTANCE</th>



            <th>MAX KILL DISTANCE</th>



            <th>VEHICLE KILL</th>



            <th>OIL KILL</th>



          </tr>



        </thead>



        <tbody>

          ${rows}

        </tbody>



      </table>



    </div>

  `;

}



/* =========================================================

   FETCH EVENTS

========================================================= */



fetchBtn.onclick =

  fetchMatches;





matchInput.addEventListener(

  "keydown",

  event => {

    if (event.key === "Enter") {

      fetchMatches();

    }

  }

);



/* =========================================================

   CUMULATIVE

========================================================= */



if (accumulateBtn) {

  accumulateBtn.onclick = () => {

    if (!state.matchIds.length) {

      setStatus(

        "Chưa có Match nào.",

        "error"

      );



      return;

    }



    const teams =

      sortedTeams();



    const leader =

      teams[0];



    setStatus(

      `${state.matchIds.length} trận đã được cộng dồn` +

      (

        leader

          ? ` · Top 1: ${leader.name} · ${leader.total} điểm.`

          : "."

      ),

      "success"

    );

  };

}



/* =========================================================

   LATEST MATCH

========================================================= */



$("#latestBtn").onclick = () => {

  if (!state.matchIds.length) {

    setStatus(

      "Chưa có trận nào.",

      "error"

    );



    return;

  }



  const latest =

    state.matchIds[

      state.matchIds.length - 1

    ];



  setStatus(

    `Trận gần nhất: ${latest}`,

    "success"

  );

};



/* =========================================================

   DETAIL OPEN / CLOSE

========================================================= */



$("#detailBtn").onclick = () => {

  if (!state.matchIds.length) {

    setStatus(

      "Chưa có dữ liệu.",

      "error"

    );



    return;

  }



  state.detailGame =

    "overall";



  state.detailTab =

    "team";



  renderDetails();



  detailPanel

    .classList

    .remove("hidden");

};





$("#closeDetail").onclick = () => {

  detailPanel

    .classList

    .add("hidden");

};



/* =========================================================

   LOGO

========================================================= */



logoPicker.onchange = event => {

  const file =

    event.target.files[0];



  if (

    !file ||

    !state.selectedLogoTeam

  ) {

    return;

  }



  const reader =

    new FileReader();



  reader.onload = () => {

    state.logos[

      state.selectedLogoTeam

    ] = reader.result;



    renderBoard();

  };



  reader.readAsDataURL(file);



  event.target.value = "";

};



/* =========================================================

   TABS

========================================================= */



$$(".tab").forEach(tab => {

  tab.onclick = () => {

    $$(".tab").forEach(item =>

      item.classList.remove("active")

    );



    $$(".tab-content").forEach(item =>

      item.classList.remove("active")

    );



    tab.classList.add("active");



    if (

      tab.dataset.tab === "designer"

    ) {

      $("#designerTab")

        .classList

        .add("active");

    } else {

      $("#templatesTab")

        .classList

        .add("active");



      renderTemplates();

    }

  };

});



/* =========================================================

   BOARD RESIZE

========================================================= */



function resizeBoard() {

  const viewport =

    $("#canvasViewport");



  const board =

    $("#scoreboard");



  if (!viewport || !board) {

    return;

  }



  const availableWidth =

    Math.max(

      320,

      viewport.clientWidth - 40

    );



  let scale =

    Math.min(

      1,

      availableWidth / 1920

    );



  if (

    document.fullscreenElement

  ) {

    const availableHeight =

      window.innerHeight - 40;



    scale =

      Math.min(

        availableWidth / 1920,

        availableHeight / 1080

      );

  }



  board.style.transform =

    `scale(${scale})`;



  viewport.style.height =

    `${1296 * scale + 40}px`;

}



window.addEventListener(

  "resize",

  resizeBoard

);



/* =========================================================

   FULLSCREEN

========================================================= */



$("#fullscreenBtn").onclick =

  async () => {

    try {

      const target =

        $("#canvasViewport");



      if (

        !document.fullscreenElement

      ) {

        await target.requestFullscreen();

      } else {

        await document.exitFullscreen();

      }

    } catch (error) {

      console.error(error);



      setStatus(

        "Không thể mở toàn màn hình.",

        "error"

      );

    }

  };





document.addEventListener(

  "fullscreenchange",

  () => {

    setTimeout(

      resizeBoard,

      100

    );

  }

);



/* =========================================================

   EXPORT JSON

========================================================= */



$("#exportBtn").onclick = () => {

  const data = {

    version: 6,



    title:

      $("#boardTitle")

        .textContent,



    matchIds:

      state.matchIds,



    responses:

      state.responses,



    logos:

      state.logos

  };



  const blob =

    new Blob(

      [

        JSON.stringify(

          data,

          null,

          2

        )

      ],

      {

        type: "application/json"

      }

    );



  const url =

    URL.createObjectURL(blob);



  const link =

    document.createElement("a");



  link.href = url;



  link.download =

    `ff-standings-${state.matchIds.length}-matches.json`;



  link.click();



  setTimeout(

    () =>

      URL.revokeObjectURL(url),

    1000

  );

};



/* =========================================================

   IMPORT JSON

========================================================= */



$("#importBtn").onclick = () => {

  $("#importFile").click();

};





$("#importFile").onchange =

  async event => {

    try {

      const file =

        event.target.files[0];



      if (!file) {

        return;

      }



      const data =

        JSON.parse(

          await file.text()

        );



      if (

        !Array.isArray(

          data.matchIds

        )

      ) {

        throw new Error(

          "File JSON không đúng định dạng."

        );

      }



      state.matchIds =

        data.matchIds;



      if (

        Array.isArray(

          data.responses

        )

      ) {

        state.responses =

          data.responses;

      } else if (

        data.response

      ) {

        /*

         * Tương thích file JSON cũ.

         */

        state.responses = [

          {

            requestedIds:

              data.matchIds,



            data:

              data.response

          }

        ];

      } else {

        state.responses = [];

      }



      state.logos =

        data.logos || {};



      if (data.title) {

        $("#boardTitle")

          .textContent =

          data.title;

      }



      matchInput.value =

        state.matchIds.join(", ");



      state.detailGame =

        "overall";



      state.detailTab =

        "team";



      rebuildStandings();



      setStatus(

        `Đã nhập và cộng lại ${state.matchIds.length} trận.`,

        "success"

      );

    } catch (error) {

      console.error(error);



      setStatus(

        error.message,

        "error"

      );

    }



    event.target.value = "";

  };



/* =========================================================

   RESET

========================================================= */



$("#resetBtn").onclick = () => {

 
function resetClearIndexedDB(databaseName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);

    request.onerror = () => {
      reject(request.error || new Error("Không mở được " + databaseName));
    };

    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve();
        return;
      }

      let tx;

      try {
        tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Không xóa được " + databaseName));
      };

      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("Đã hủy xóa " + databaseName));
      };
    };
  });
}

$("#resetBtn").onclick = async () => {
  const accepted = confirm(
    "KHÔI PHỤC TOÀN BỘ VỀ MẶC ĐỊNH?\n\n" +
    "Thao tác này sẽ xóa:\n" +
    "• Match ID, bảng xếp hạng và dữ liệu trận đấu hiện tại\n" +
    "• Logo đã thêm (bao gồm logo theo tên ảnh)\n" +
    "• Mẫu bảng điểm tự tạo và ảnh nền đã tải lên\n" +
    "• Các cài đặt và mẫu đã lưu trong trình duyệt\n\n" +
    "Bảng điểm BEE BÚT BÔI × Hùng CAM mặc định sẽ được khôi phục.\n" +
    "Dữ liệu đã xóa không thể hoàn tác. Bạn có chắc chắn?"
  );

  if (!accepted) return;

  const button = $("#resetBtn");
  button.disabled = true;

  const originalLabel = button.textContent;
  button.textContent = "ĐANG RESET...";

  setStatus("Đang xóa các mẫu bảng điểm và thư viện logo...", "");

  try {
    await resetClearIndexedDB(
      "ff-standings-ranking-images",
      "images"
    );

    await resetClearIndexedDB(
      "ff-standings-logo-library",
      "logos"
    );

    localStorage.removeItem("ff_templates");
    localStorage.removeItem("ff_ranking_library_v1");

    window.location.reload();

  } catch (error) {
    console.error("Không thể khôi phục mặc định:", error);

    setStatus(
      "Reset chưa hoàn tất: " +
      (error?.message || String(error)) +
      ". Hãy thử lại.",
      "error"
    );

    button.disabled = false;
    button.textContent = originalLabel;
  }
};


};



/* =========================================================

   GOOGLE DRIVE

========================================================= */



function normalizeLogoName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b(logo|team|esports|esport|gaming|official)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}

function findTeamForLogo(fileName) {
  const fileKey = normalizeLogoName(fileName);
  if (!fileKey) return null;

  const teams = sortedTeams();

  const exact = teams.find(team => {
    const nameKey = normalizeLogoName(team.name);
    const teamKey = normalizeLogoName(team.key);
    return fileKey === nameKey || fileKey === teamKey;
  });

  if (exact) return exact;

  const candidates = teams
    .map(team => ({
      team,
      nameKey: normalizeLogoName(team.name),
      teamKey: normalizeLogoName(team.key)
    }))
    .filter(item =>
      (item.nameKey && (fileKey.includes(item.nameKey) || item.nameKey.includes(fileKey))) ||
      (item.teamKey && (fileKey.includes(item.teamKey) || item.teamKey.includes(fileKey)))
    )
    .sort((a, b) =>
      Math.max(b.nameKey.length, b.teamKey.length) -
      Math.max(a.nameKey.length, a.teamKey.length)
    );

  return candidates[0]?.team || null;
}

async function driveImageToDataURL(file) {
  const params = new URLSearchParams({ id: file.id });

  if (file.resourceKey) {
    params.set("resourceKey", file.resourceKey);
  }

  const response = await fetch(`/api/drive-image?${params.toString()}`);

  if (!response.ok) {
    let message = "Không tải được ảnh từ Google Drive.";
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("Không thể đọc dữ liệu ảnh Google Drive."));
    reader.readAsDataURL(blob);
  });
}

$("#driveBtn").onclick = async () => {
  const button = $("#driveBtn");
  const value = $("#driveUrl").value.trim();

  if (!state.teams.size) {
    setStatus(
      "Hãy lấy điểm trước để hệ thống có danh sách đội cần ghép logo.",
      "error"
    );
    return;
  }

  if (!value) {
    setStatus("Hãy nhập link thư mục Google Drive.", "error");
    return;
  }

  const oldText = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "ĐANG ĐỌC...";
    setStatus("Đang đọc danh sách logo trong Google Drive...");

    const response = await fetch("/api/drive-logos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_url: value })
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        `Máy chủ trả về dữ liệu không hợp lệ. HTTP ${response.status}`
      );
    }

    if (!response.ok || !result.ok) {
      throw new Error(
        result?.error || "Không thể đọc thư mục Google Drive."
      );
    }

    const files = Array.isArray(result.files) ? result.files : [];

    if (!files.length) {
      throw new Error(
        "Không tìm thấy ảnh PNG, JPG, JPEG, WEBP hoặc GIF trong thư mục Drive."
      );
    }

    let matched = 0;
    const unmatched = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const team = findTeamForLogo(file.name);

      if (!team) {
        unmatched.push(file.name);
        continue;
      }

      setStatus(`Đang tải logo ${i + 1}/${files.length} · ${file.name}`);

      try {
        const dataUrl = await driveImageToDataURL(file);
        state.logos[team.key] = dataUrl;
        state.logos[team.name] = dataUrl;
        matched += 1;
      } catch (error) {
        console.error(`Không tải được logo ${file.name}:`, error);
        unmatched.push(file.name);
      }
    }

    renderBoard();

    if (!matched) {
      throw new Error(
        "Đã đọc được thư mục Drive nhưng chưa có tên file nào khớp với tên đội. Hãy đặt tên ảnh giống tên đội, ví dụ RLE.png hoặc TPE.png."
      );
    }

    const extra = unmatched.length
      ? ` · ${unmatched.length} ảnh chưa ghép được`
      : "";

    setStatus(
      `Đã tự động ghép ${matched} logo từ Google Drive${extra}.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Không thể kết nối Google Drive.", "error");
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
};

/* =========================================================

   TEMPLATE

========================================================= */



$("#saveTemplateBtn").onclick = () => {

  const name =

    $("#templateName")

      .value

      .trim()

    ||

    `Mẫu ${state.templates.length + 1}`;



  state.templates.push({

    id: Date.now(),



    name,



    title:

      $("#boardTitle")

        .textContent

        .trim()

  });



  localStorage.setItem(

    "ff_templates",

    JSON.stringify(

      state.templates

    )

  );



  $("#templateName").value =

    "";



  renderTemplates();

};





function renderTemplates() {

  const list =

    $("#templateList");



  if (!state.templates.length) {

    list.innerHTML = `

      <div class="empty-state">

        Chưa có mẫu nào.

      </div>

    `;



    return;

  }



  list.innerHTML =

    state.templates

      .map(

        template => `



          <div class="template-item">



            <strong>

              ${escapeHTML(template.name)}

            </strong>



            <div>



              <button

                class="ghost load-template"

                data-id="${template.id}"

              >

                Dùng mẫu

              </button>



              <button

                class="danger delete-template"

                data-id="${template.id}"

              >

                Xóa

              </button>



            </div>



          </div>

        `

      )

      .join("");



  $$(".load-template")

    .forEach(button => {

      button.onclick = () => {

        const template =

          state.templates.find(

            item =>

              String(item.id) ===

              button.dataset.id

          );



        if (!template) return;



        $("#boardTitle")

          .textContent =

          template.title;



        setStatus(

          `Đã áp dụng mẫu "${template.name}".`,

          "success"

        );

      };

    });



  $$(".delete-template")

    .forEach(button => {

      button.onclick = () => {

        state.templates =

          state.templates.filter(

            item =>

              String(item.id) !==

              button.dataset.id

          );



        localStorage.setItem(

          "ff_templates",

          JSON.stringify(

            state.templates

          )

        );



        renderTemplates();

      };

    });

}



/* =========================================================

   PNG EXPORT

========================================================= */



$("#downloadBtn").onclick =

  async () => {

    if (!state.teams.size) {

      setStatus(

        "Hãy lấy điểm trước khi tải PNG.",

        "error"

      );



      return;

    }



    try {

      setStatus(

        "Đang tạo PNG..."

      );



      const board =

        $("#scoreboard");



      const clone =

        board.cloneNode(true);



      clone.style.transform =

        "none";



      clone.style.width =

        "1920px";



      clone.style.height =

        "1296px";



      const css =

        [...document.styleSheets]

          .map(sheet => {

            try {

              return [...sheet.cssRules]

                .map(

                  rule =>

                    rule.cssText

                )

                .join("\n");

            } catch {

              return "";

            }

          })

          .join("\n");



      const html =

        new XMLSerializer()

          .serializeToString(

            clone

          );



      const svg = `

        <svg

          xmlns="http://www.w3.org/2000/svg"

          width="1920"

          height="1296"

        >

          <foreignObject

            width="1920"

            height="1296"

          >

            <div

              xmlns="http://www.w3.org/1999/xhtml"

              style="

                width:1920px;

                height:1296px;

              "

            >

              <style>

                ${css}

              </style>



              ${html}



            </div>

          </foreignObject>

        </svg>

      `;



      const blob =

        new Blob(

          [svg],

          {

            type:

              "image/svg+xml;charset=utf-8"

          }

        );



      const url =

        URL.createObjectURL(blob);



      const image =

        new Image();



      image.onload = () => {

        const canvas =

          document.createElement(

            "canvas"

          );



        canvas.width = 1920;

        canvas.height = 1296;



        const context =

          canvas.getContext("2d");



        context.drawImage(

          image,

          0,

          0,

          1920,

          1296

        );



        URL.revokeObjectURL(url);



        const link =

          document.createElement("a");



        link.download =

          `ff-standings-${state.matchIds.length}-matches.png`;



        link.href =

          canvas.toDataURL(

            "image/png"

          );



        link.click();



        setStatus(

          `Đã xuất BXH ${state.matchIds.length} trận.`,

          "success"

        );

      };



      image.onerror = () => {

        URL.revokeObjectURL(url);



        setStatus(

          "Không thể render PNG.",

          "error"

        );

      };



      image.src = url;

    } catch (error) {

      console.error(error);



      setStatus(

        error.message,

        "error"

      );

    }

  };



/* =========================================================
   AI SCOREBOARD IMAGE IMPORT
========================================================= */

const scoreImageBtn = $("#scoreImageBtn");
const scoreImagePicker = $("#scoreImagePicker");
const scoreImageName = $("#scoreImageName");
const scoreImportPanel = $("#scoreImportPanel");
const scoreImportImage = $("#scoreImportImage");
const scoreImportRows = $("#scoreImportRows");
const scoreImportConfidence = $("#scoreImportConfidence");
const scoreImportNotes = $("#scoreImportNotes");

let scoreImportData = null;
let scoreImportObjectUrl = "";

function showScoreImportError(message) {
  const box = document.getElementById("scoreImportError");
  if (box) { box.textContent = message || ""; box.hidden = !message; }
}

function closeScoreImportPanel() {
  scoreImportPanel?.classList.add("hidden");
}

function openScoreImportPanel() {
  scoreImportPanel?.classList.remove("hidden");
}

function scoreImportRowHTML(team = {}, index = 0) {
  return `
    <tr class="score-import-row">
      <td><input data-field="rank" type="number" min="1" value="${number(team.rank) || index + 1}"></td>
      <td><input data-field="team" type="text" value="${escapeHTML(team.team || "")}" placeholder="Tên đội"></td>
      <td><input data-field="booyah" type="number" min="0" value="${number(team.booyah)}"></td>
      <td><input data-field="placement" type="number" min="0" value="${number(team.placement)}"></td>
      <td><input data-field="kills" type="number" min="0" value="${number(team.kills)}"></td>
      <td><input data-field="total" type="number" min="0" value="${number(team.total)}"></td>
      <td><button class="score-import-delete" type="button" title="Xóa đội">×</button></td>
    </tr>
  `;
}

function bindScoreImportDeleteButtons() {
  $$(".score-import-delete").forEach(button => {
    button.onclick = () => button.closest("tr")?.remove();
  });
}

// Chuyển dữ liệu Match ID đã tải sang bảng nhập ảnh mà không mất dữ liệu gốc.
function importCurrentRankingToPreview() {
  const teams = sortedTeams();
  if (!teams.length || state.matchIds?.[0] === "IMAGE-SCOREBOARD") {
    const message = "Chưa có dữ liệu Match ID. Hãy nhập Match ID và nhấn LẤY ĐIỂM trước.";
    if (scoreImportPanel && !scoreImportPanel.classList.contains("hidden")) showScoreImportError(message);
    else setStatus(message, "error");
    return;
  }
  const rows = teams.map((team, index) => ({
    rank: index + 1,
    team: team.name || team.key,
    booyah: number(team.booyah),
    placement: number(team.placement),
    kills: number(team.kills),
    total: number(team.total)
  }));
  renderScoreImportPreview({
    title: "CURRENT RANKING",
    confidence: 1,
    notes: `Đã lấy ${rows.length} đội từ ${state.matchIds.length} Match ID. Bạn có thể sửa trước khi áp dụng.`,
    teams: rows
  });
  if (scoreImportImage && !scoreImportObjectUrl) {
    scoreImportImage.removeAttribute("src");
    scoreImportImage.alt = "Hãy chọn ảnh mẫu bảng điểm để đổ dữ liệu lên ảnh";
  }
}
$("#scoreFromRankingBtn")?.addEventListener("click", importCurrentRankingToPreview);
$("#scoreImportFromRankingBtn")?.addEventListener("click", importCurrentRankingToPreview);

function renderScoreImportPreview(result) {
  scoreImportData = result;
  showScoreImportError("");
  const teams = Array.isArray(result?.teams) ? result.teams : [];

  scoreImportRows.innerHTML = teams
    .map((team, index) => scoreImportRowHTML(team, index))
    .join("");

  const confidence = Math.round(number(result?.confidence) * 100);
  scoreImportConfidence.textContent = confidence
    ? `Độ tin cậy OCR trung bình: ${confidence}% · Cần kiểm tra số liệu trước khi áp dụng.`
    : "Hãy kiểm tra lại dữ liệu trước khi áp dụng.";

  scoreImportNotes.textContent = result?.notes || "";
  bindScoreImportDeleteButtons();
  openScoreImportPanel();
}

function readScoreImportRows() {
  return $$("#scoreImportRows .score-import-row")
    .map((row, index) => {
      const get = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
      const placement = number(get("placement"));
      const kills = number(get("kills"));
      const totalInput = number(get("total"));

      return {
        rank: Math.max(1, number(get("rank")) || index + 1),
        team: String(get("team")).trim(),
        booyah: Math.max(0, number(get("booyah"))),
        placement: Math.max(0, placement),
        kills: Math.max(0, kills),
        total: Math.max(0, totalInput)
      };
    })
    .filter(team => team.team);
}

function findLogoForImportedTeam(teamName) {
  const target = normalizeLogoName(teamName);
  if (!target) return "";

  for (const [key, value] of Object.entries(state.logos)) {
    const logoKey = normalizeLogoName(key);
    if (
      logoKey === target ||
      (logoKey && target && (logoKey.includes(target) || target.includes(logoKey)))
    ) {
      return value;
    }
  }

  return "";
}

function applyImportedScoreboard(teams) {
  if (!teams.length) {
    throw new Error("Ảnh chưa nhận diện được tên đội. Đây có thể là ảnh mẫu trống. Hãy nhập ít nhất một tên đội trong bảng xem trước rồi áp dụng.");
  }
  if (new Set(teams.map(t=>t.team.trim().toLocaleUpperCase("vi"))).size !== teams.length) {
    throw new Error("Có tên đội bị trùng. Hãy sửa tên các đội trước khi áp dụng để tránh ghi đè dữ liệu.");
  }

  const previousLogos = { ...state.logos };

  state.responses = [];
  state.matchIds = ["IMAGE-SCOREBOARD"];
  state.teams.clear();

  teams
    .sort((a, b) => a.rank - b.rank)
    .forEach((item, index) => {
      const name = String(item.team).trim();
      const key = name.toUpperCase();
      const total = number(item.total);

      const team = {
        key,
        name,
        importRank: number(item.rank) || index + 1,
        games: 1,
        booyah: number(item.booyah),
        placement: number(item.placement),
        kills: number(item.kills),
        damage: 0,
        total,
        headshots: 0,
        survivalTime: 0,
        revival: 0,
        rescueMembers: 0,
        grenadeUse: 0,
        grenadeDamage: 0,
        grenadeKills: 0,
        icewallUse: 0,
        icewallDestroyed: 0,
        medkitUse: 0,
        onTarget: 0,
        maxKillDistance: 0,
        gameResults: [{
          gameNumber: 1,
          matchId: "IMAGE-SCOREBOARD",
          matchRank: number(item.rank) || index + 1,
          booyah: number(item.booyah),
          placement: number(item.placement),
          kills: number(item.kills),
          damage: 0,
          total
        }]
      };

      state.teams.set(key, team);

      const existingLogo = findLogoForImportedTeam(name);
      if (existingLogo) {
        state.logos[key] = existingLogo;
        state.logos[name] = existingLogo;
      }
    });

  // Giữ lại kho logo đã tải trước đó để lần import sau vẫn ghép được.
  state.logos = { ...previousLogos, ...state.logos };

  render();

  const title = String(scoreImportData?.title || "").trim();
  if (title && $("#boardTitle")) {
    $("#boardTitle").textContent = title.toUpperCase();
  }

  closeScoreImportPanel();
  setStatus(`Đã áp dụng ${teams.length} đội từ ảnh bảng điểm.`, "success");

  // Nếu đã có link Drive, tự chạy ghép logo ngay sau khi tạo BXH.
  const driveUrl = $("#driveUrl")?.value?.trim();
  if (driveUrl && $("#driveBtn")) {
    setTimeout(() => $("#driveBtn").click(), 150);
  }
}

/* Tesseract.js OCR chạy trong trình duyệt, không gửi ảnh tới API AI. */
function getOCRWords(data) {
  const words = [];
  function addWord(w) {
    const text = String(w?.text || "").trim();
    const b = w?.bbox;
    if (text && b && Number.isFinite(b.x0) && Number.isFinite(b.y0)) {
      words.push({ text, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1,
        confidence: Number(w.confidence ?? w.conf ?? 0) });
    }
  }
  if (Array.isArray(data?.words) && data.words.length) data.words.forEach(addWord);
  else for (const block of data?.blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || [])
        for (const word of line.words || []) addWord(word);
  return words;
}

function parseOCRNumber(text) {
  const cleaned = String(text || "").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : null;
}

function groupOCRLines(words) {
  const sorted = [...words].sort((a, b) => ((a.y0+a.y1)/2)-((b.y0+b.y1)/2) || a.x0-b.x0);
  const lines = [];
  for (const word of sorted) {
    const cy = (word.y0 + word.y1) / 2;
    const h = Math.max(10, word.y1-word.y0);
    let line = lines.find(row => Math.abs(row.cy-cy) <= Math.max(9, Math.min(row.height,h)*0.55));
    if (!line) { line = { cy, height:h, words:[] }; lines.push(line); }
    line.words.push(word);
    line.cy = line.words.reduce((sum,w)=>sum+(w.y0+w.y1)/2,0)/line.words.length;
  }
  return lines.sort((a,b)=>a.cy-b.cy).map(row => ({
    ...row, words: row.words.sort((a,b)=>a.x0-b.x0),
    text: row.words.map(w=>w.text).join(" ")
  }));
}

function readOCRScoreboard(data) {
  const words = getOCRWords(data);
  const lines = groupOCRLines(words);
  if (!lines.length) throw new Error("OCR không đọc được chữ nào. Hãy thử ảnh rõ nét hơn.");
  const headerPattern = /^(#|RANK|TOP|TEAM|ĐỘI|HẠNG|BOOYAH|WWCD|PLACE|PLACEMENT|KILLS?|ELIMS?|TOTAL|POINTS?|PTS)$/i;
  const header = lines.find(line => {
    const t = line.text.toUpperCase();
    return /(TEAM|ĐỘI)/i.test(t) && /(TOTAL|POINT|KILL|ELIM|PLACE|HẠNG|BOOYAH)/i.test(t);
  });
  const headerWords = header?.words || [];
  const normalizeHeader = value => String(value).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const column = (regex) => {
    const w = headerWords.find(w => regex.test(normalizeHeader(w.text)));
    return w ? (w.x0+w.x1)/2 : null;
  };
  const positions = {
    booyah: column(/BOOYAH|WWCD|BOO/),
    placement: column(/PLACE|HANG|POSITION/),
    kills: column(/KILL|ELIM|HA.GUC/),
    total: column(/TOTAL|TONG|POINT|PTS/)
  };
  const columns = Object.entries(positions).filter(([,x])=>x !== null).sort((a,b)=>a[1]-b[1]);
  const teams = [];
  const notes = [];
  if (!header) notes.push("Không nhận rõ hàng tiêu đề; đã thử phân loại số theo thứ tự cột.");
  if (columns.length < 3) notes.push("Không xác định đủ tên cột; hãy đối chiếu lại Booyah / điểm hạng / Kills / Total.");
  for (const line of lines) {
    if (header && line.cy <= header.cy + Math.max(10,header.height*.5)) continue;
    const lineWords = line.words;
    if (lineWords.length < 3) continue;
    const rankMatch = lineWords[0].text.match(/^#?(\d{1,2})[.)]?$/);
    if (!rankMatch) continue;
    const rank = Number(rankMatch[1]);
    if (rank < 1 || rank > 99) continue;
    const remaining = lineWords.slice(1);
    const numeric = remaining.filter(w => parseOCRNumber(w.text) !== null && /^[0-9OoIl|.,]+$/.test(w.text));
    if (numeric.length < 2) continue;
    let nameWords;
    if (columns.length >= 3) {
      const firstColX = columns[0][1];
      nameWords = remaining.filter(w => (w.x0+w.x1)/2 < firstColX - 12);
    } else {
      const firstNumeric = remaining.findIndex(w => numeric.includes(w));
      nameWords = remaining.slice(0,firstNumeric);
    }
    const team = nameWords.map(w=>w.text).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
    if (!team || team.length > 60 || headerPattern.test(team)) continue;
    const values = { booyah:0, placement:0, kills:0, total:0 };
    if (columns.length >= 3) {
      for (const word of numeric) {
        const x = (word.x0+word.x1)/2;
        const nearest = columns.reduce((best,col)=>Math.abs(col[1]-x)<Math.abs(best[1]-x)?col:best,columns[0]);
        if (Math.abs(nearest[1]-x) < Math.max(35,(lineWords.at(-1).x1-lineWords[0].x0)*.09))
          values[nearest[0]] = parseOCRNumber(word.text) ?? 0;
      }
    } else {
      const nums = numeric.map(w=>parseOCRNumber(w.text));
      const fields = nums.length >= 4 ? ["booyah","placement","kills","total"] : ["placement","kills","total"];
      nums.slice(-fields.length).forEach((n,i)=>{values[fields[i]]=n??0;});
    }
    if (!values.total && values.placement + values.kills) values.total=values.placement+values.kills;
    teams.push({rank,team,...values});
  }
  const unique = [...new Map(teams.map(t=>[t.rank,t])).values()].sort((a,b)=>a.rank-b.rank);
  if (!unique.length) throw new Error("OCR đã đọc được chữ nhưng chưa tách được hàng đội. Hãy dùng ảnh rõ, có cột hạng ở bên trái và bảng số bên phải.");
  const confidence = words.length ? words.reduce((sum,w)=>sum+w.confidence,0)/words.length/100 : 0;
  notes.push("Tesseract.js chỉ nhận dạng chữ/số, không hiểu bố cục như AI Vision. Các ô không đọc được tạm để 0.");
  return {title:"BẢNG ĐIỂM TỪ ẢNH",confidence:Math.max(0,Math.min(1,confidence)),notes:notes.join(" "),teams:unique};
}

/* Nhận diện tọa độ mẫu CUSTOM BEE BÚT BÔI (ảnh gốc 1649 × 928).
   Mỗi cột được cắt thành 12 ô riêng và ghép lên nền trắng trước khi OCR.
   Tất cả tọa độ được nhân tỷ lệ khi ảnh thay đổi độ phân giải. */
const FF_POSITION_TEMPLATE = {
  width: 1649, height: 928, firstRowY: 256.5, rowStep: 55.1, rowHeight: 38,
  columns: {
    team: [218, 352], booyah: [419, 493],
    kills: [542, 637], placement: [680, 791], total: [826, 918]
  }
};

function loadOCRImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Không mở được ảnh bảng điểm.")); };
    img.src = url;
  });
}

function makePositionOCRStrip(img, field) {
  const spec = FF_POSITION_TEMPLATE;
  const [left, right] = spec.columns[field];
  const factorX = img.naturalWidth / spec.width;
  const factorY = img.naturalHeight / spec.height;
  const scale = 3;
  const cellWidth = Math.round((right-left)*scale);
  const cellHeight = 120;
  const padY = 12;
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth + 24;
  canvas.height = 12*cellHeight;
  const ctx = canvas.getContext("2d", {willReadFrequently:true});
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  for (let i=0;i<12;i++) {
    const cy = spec.firstRowY + spec.rowStep*i;
    const y = cy - spec.rowHeight/2;
    const w = Math.max(1,Math.round((right-left)*factorX));
    const h = Math.max(1,Math.round(spec.rowHeight*factorY));
    const x = Math.round(left*factorX);
    const sy = Math.round(y*factorY);
    const temp = document.createElement("canvas");
    temp.width = cellWidth;
    temp.height = cellHeight-padY*2;
    const tc = temp.getContext("2d", {willReadFrequently:true});
    tc.drawImage(img,x,sy,w,h,0,0,temp.width,temp.height);
    const pixels = tc.getImageData(0,0,temp.width,temp.height);
    // Ba hàng đầu nền kem, các hàng sau nền đỏ đậm; chữ đổi màu tương ứng.
    // Nhị phân hóa theo từng ô, không OCR cả phần hình nền cháy/sáng.
    for(let j=0;j<pixels.data.length;j+=4) {
      const r=pixels.data[j],g=pixels.data[j+1],b=pixels.data[j+2];
      const lum=.299*r+.587*g+.114*b;
      const ink = i<3 ? lum<118 : lum>132;
      const v=ink?0:255;
      pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=v;
      pixels.data[j+3]=255;
    }
    tc.putImageData(pixels,0,0);
    ctx.drawImage(temp,12,i*cellHeight+padY);
  }
  return {canvas,cellHeight};
}

function ocrStripLines(data, cellHeight) {
  const result = Array.from({length:12},()=>({words:[],confidence:[]}));
  for(const word of getOCRWords(data)) {
    const mid=(word.y0+word.y1)/2;
    const index=Math.floor(mid/cellHeight);
    if(index>=0 && index<12) {
      result[index].words.push(word);
      result[index].confidence.push(word.confidence);
    }
  }
  // Một số phiên bản Tesseract không trả về bbox từng từ.
  if(result.every(r=>!r.words.length) && Array.isArray(data?.lines)) {
    for(const line of data.lines) {
      const mid=(line.bbox?.y0+line.bbox?.y1)/2;
      const index=Math.floor(mid/cellHeight);
      if(Number.isFinite(mid)&&index>=0&&index<12) {
        result[index].words.push({text:line.text,x0:0,confidence:line.confidence||0});
      }
    }
  }
  return result.map(row=>({
    text:row.words.sort((a,b)=>a.x0-b.x0).map(w=>w.text).join(" ").trim(),
    confidence:row.confidence.length?row.confidence.reduce((a,b)=>a+b,0)/row.confidence.length:0
  }));
}

async function recognizeFixedPositionScoreboard(file, progress) {
  const img=await loadOCRImage(file);
  const ratio=img.naturalWidth/img.naturalHeight;
  if(Math.abs(ratio-FF_POSITION_TEMPLATE.width/FF_POSITION_TEMPLATE.height)>.065) {
    throw new Error("Ảnh không đúng tỷ lệ mẫu 1649×928. Hãy dùng OCR tự động hoặc chọn ảnh cùng bố cục.");
  }
  const worker=await Tesseract.createWorker("eng",1,{logger:progress});
  try {
    const fields=["team","booyah","kills","placement","total"];
    const extracted={};
    let confidenceSum=0,confidenceCount=0;
    for(let n=0;n<fields.length;n++) {
      const field=fields[n];
      const strip=makePositionOCRStrip(img,field);
      await worker.setParameters({
        tessedit_pageseg_mode:"6",
        tessedit_char_whitelist:field==="team"?"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-_ ":"0123456789"
      });
      const response=await worker.recognize(strip.canvas);
      extracted[field]=ocrStripLines(response.data,strip.cellHeight);
      for(const r of extracted[field]) if(r.text) {confidenceSum+=r.confidence;confidenceCount++;}
      if(typeof progress==="function") progress({status:"column complete",field,done:n+1,total:fields.length});
    }
    const teams=[];
    let missing=0;
    for(let i=0;i<12;i++) {
      const name=extracted.team[i].text.replace(/[^\p{L}\p{N}._ -]/gu,"").trim();
      const values={};
      for(const field of ["booyah","kills","placement","total"]) {
        const n=parseOCRNumber(extracted[field][i].text);
        if(n===null) missing++;
        values[field]=n??0;
      }
      teams.push({rank:i+1,team:name,...values});
    }
    return {
      title:"BẢNG ĐIỂM TỪ ẢNH",
      confidence:confidenceCount?confidenceSum/confidenceCount/100:0,
      notes:`Đã chia đúng 12 hàng và 5 cột theo mẫu CUSTOM BEE BÚT BÔI. Có ${missing} ô số chưa đọc được (đặt tạm 0). Ảnh mẫu có cùng tên WAG ở 12 hàng; hãy thay bằng tên đội thật trước khi áp dụng. Thứ hạng sẽ giữ theo hàng trên ảnh.`,
      teams
    };
  } finally {await worker.terminate();}
}

async function recognizeScoreboardLocally(file, progress) {
  if (!window.Tesseract?.createWorker) throw new Error("Chưa tải được Tesseract.js. Kiểm tra Internet và tải lại trang (Ctrl+F5).");
  const worker = await Tesseract.createWorker("eng", 1, { logger: progress });
  try {
    const result = await worker.recognize(file);
    return readOCRScoreboard(result.data);
  } finally { await worker.terminate(); }
}

if (scoreImageBtn && scoreImagePicker) {
  scoreImageBtn.onclick = () => scoreImagePicker.click();

  scoreImagePicker.onchange = async () => {
    const file = scoreImagePicker.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStatus("Chỉ hỗ trợ ảnh PNG, JPG/JPEG hoặc WEBP.", "error");
      scoreImagePicker.value = "";
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setStatus("Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn 8 MB.", "error");
      scoreImagePicker.value = "";
      return;
    }

    scoreImageName.textContent = file.name;
    const oldText = scoreImageBtn.textContent;

    try {
      scoreImageBtn.disabled = true;
      scoreImageBtn.textContent = "OCR ĐANG PHÂN TÍCH...";
      setStatus("Tesseract.js đang đọc bảng điểm trên máy của bạn...");

      if (scoreImportObjectUrl) URL.revokeObjectURL(scoreImportObjectUrl);
      scoreImportObjectUrl = URL.createObjectURL(file);
      scoreImportImage.src = scoreImportObjectUrl;

      const mode = document.querySelector("#scoreOCRMode")?.value || "position";
      const recognize = mode === "position" ? recognizeFixedPositionScoreboard : recognizeScoreboardLocally;
      const result = await recognize(file, progress => {
        if (progress?.status === "column complete") {
          scoreImageBtn.textContent = `ĐÃ ĐỌC ${progress.done}/${progress.total} CỘT`;
        } else if (progress?.status === "recognizing text") {
          scoreImageBtn.textContent = `ĐANG ĐỌC ẢNH ${Math.round((progress.progress || 0)*100)}%`;
        }
      });

      renderScoreImportPreview(result);
      setStatus("OCR đã đọc xong. Hãy kiểm tra từng ô rồi bấm ÁP DỤNG BẢNG ĐIỂM.", "success");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Không thể phân tích ảnh bảng điểm.", "error");
    } finally {
      scoreImageBtn.disabled = false;
      scoreImageBtn.textContent = oldText;
      scoreImagePicker.value = "";
    }
  };
}

$("#addScoreRowBtn")?.addEventListener("click", () => {
  scoreImportRows.insertAdjacentHTML(
    "beforeend",
    scoreImportRowHTML({}, scoreImportRows.children.length)
  );
  bindScoreImportDeleteButtons();
});

$("#applyScoreImport")?.addEventListener("click", () => {
  try {
    showScoreImportError("");
    const teams = readScoreImportRows();
    applyImportedScoreboard(teams);
  } catch (error) {
    showScoreImportError(error.message || "Không thể áp dụng bảng điểm.");
    setStatus(error.message || "Không thể áp dụng bảng điểm.", "error");
  }
});

$("#closeScoreImport")?.addEventListener("click", closeScoreImportPanel);
$("#cancelScoreImport")?.addEventListener("click", closeScoreImportPanel);
$("#scoreImportBackdrop")?.addEventListener("click", closeScoreImportPanel);


/* ===== ĐỔ CURRENT RANKING VÀO ẢNH MẪU (KHÔNG GHI ĐÈ BXH GỐC) ===== */
const scoreTemplateApply = document.querySelector("#applyToTemplateImage");
const scoreTemplateResult = document.querySelector("#scoreTemplateResult");
const scoreTemplateDownload = document.querySelector("#downloadTemplateImage");
let renderedTemplateURL = "";

function loadScoreTemplateImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không thể mở ảnh mẫu. Hãy tải ảnh mẫu lên trước."));
    img.src = src;
  });
}
async function applyRankingToTemplateImage() {
  showScoreImportError("");
  if (!scoreImportObjectUrl) {
    throw new Error("Hãy nhấn CHỌN ẢNH BẢNG ĐIỂM và tải ảnh mẫu trước khi áp dụng dữ liệu Current Ranking.");
  }
  const rows = readScoreImportRows().sort((a,b)=>a.rank-b.rank);
  if (!rows.length) throw new Error("Chưa có dữ liệu đội. Hãy nhấn LẤY TỪ CURRENT RANKING.");
  const source = await loadScoreTemplateImage(scoreImportObjectUrl);
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const sx=canvas.width/1649, sy=canvas.height/928;
  ctx.save();
  ctx.scale(sx,sy);
  const rowTop=[235,290,345,400,454,509,564,618,673,727,782,837];
  for(let i=0;i<Math.min(12,rows.length);i++){
    const t=rows[i], y=rowTop[i];
    const light=i<3;
    ctx.fillStyle=light?"#ffe9a8":"#490401";
    ctx.fillRect(163,y+1,756,40);
    ctx.fillStyle=light?"#340805":"#ffe6a0";
    ctx.textBaseline="middle";
    ctx.font="bold 27px Arial, sans-serif";
    ctx.textAlign="left";
    ctx.fillText(String(t.team).slice(0,16),221,y+22,182);
    ctx.textAlign="center";
    ctx.font="bold 26px Arial, sans-serif";
    ctx.fillText(String(t.booyah),452,y+22,74);
    ctx.fillText(String(t.kills),586,y+22,94);
    ctx.fillText(String(t.placement),735,y+22,110);
    ctx.fillText(String(t.total),869,y+22,92);
    const teamObj=Array.from(state.teams.values()).find(x=>String(x.name||x.key).toUpperCase()===String(t.team).toUpperCase());
    const logo=teamObj ? (state.logos[teamObj.key]||state.logos[teamObj.name]) : (state.logos[t.team]||state.logos[t.team.toUpperCase()]);
    if(logo && typeof logo==="string"){
      try{
        const li=new Image();
        li.crossOrigin="anonymous";
        await new Promise((resolve,reject)=>{li.onload=resolve;li.onerror=reject;li.src=logo;});
        ctx.drawImage(li,168,y+3,41,35);
      }catch(e){ /* logo nguồn ngoài có thể chặn CORS */ }
    }
  }
  ctx.restore();
  try { renderedTemplateURL=canvas.toDataURL("image/png"); }
  catch(e){throw new Error("Ảnh/logo từ nguồn ngoài chặn xuất PNG. Hãy tải logo về máy rồi thêm lại.");}
  scoreTemplateResult.src=renderedTemplateURL;
  document.querySelector("#scoreTemplateOutput").classList.remove("hidden");
  scoreTemplateResult.scrollIntoView({behavior:"smooth",block:"nearest"});
  setStatus(`Đã điền ${Math.min(12,rows.length)} đội vào ảnh mẫu. Current Ranking gốc được giữ nguyên.`,"success");
}
scoreTemplateApply?.addEventListener("click",async()=>{
  scoreTemplateApply.disabled=true;
  try{await applyRankingToTemplateImage();}
  catch(e){showScoreImportError(e.message);setStatus(e.message,"error");}
  finally{scoreTemplateApply.disabled=false;}
});
scoreTemplateDownload?.addEventListener("click",()=>{
  if(!renderedTemplateURL)return;
  const a=document.createElement("a");
  a.href=renderedTemplateURL;a.download="FF-Standings-Bang-Diem.png";a.click();
});

/* =========================================================

   START

========================================================= */



renderTemplates();

render();



setTimeout(

  resizeBoard,

  100

);

/* Custom Current Ranking PNG: active template, not a hard-coded background. */
const customRankingDownload = document.querySelector("#downloadBtn");
if (customRankingDownload) customRankingDownload.onclick = async () => {
  const teams = sortedTeams().slice(0,12);
  if (!teams.length) { setStatus("Hãy lấy điểm trước khi tải PNG.","error"); return; }
  const loadImage = src => new Promise((resolve,reject) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload=()=>resolve(im); im.onerror=()=>reject(new Error("Không tải được ảnh: "+src)); im.src=src;
  });
  try {
    const canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;
    await rankingDrawPNG(canvas.getContext("2d"),teams,loadImage);
    const a=document.createElement("a");a.download="ff-standings-"+rankingActiveId+".png";
    a.href=canvas.toDataURL("image/png");a.click();
    setStatus("Đã xuất PNG theo mẫu đang chọn.","success");
  } catch(err) { console.error(err);setStatus("Không thể xuất PNG: "+err.message,"error"); }
};

/* ==================================================================
   FF STANDINGS — RANKING TEMPLATE LIBRARY
   Images in IndexedDB, coordinates and metadata in localStorage.
   Templates change only the visual output; match results stay intact.
================================================================== */
const RANKING_KEY = "ff_ranking_library_v1";
const RANKING_DEFAULT = Object.freeze({
  firstY:299,stepY:63.55,fontSize:31,
  logo:220,name:258,booyah:530,kills:682,placement:855,total:1015
});
const RANKING_LABELS = {logo:"LOGO",name:"TÊN ĐỘI",booyah:"BOOYAH",kills:"ELIMS",placement:"ĐIỂM HẠNG",total:"TỔNG"};
let rankingLibrary = [];
let rankingActiveId = "default";
let rankingEditingId = null;
let rankingObjectURLs = new Map();
let rankingImageDBPromise;
let rankingSaving = false;
function rankingMessage(msg,error=false){const el=$("#rankingManagerMessage");if(el){el.textContent=msg;el.classList.toggle("error",error);}if(error)setStatus(msg,"error");}
function rankingLoadMeta(){
  try {const obj=JSON.parse(localStorage.getItem(RANKING_KEY)||"{}");rankingLibrary=Array.isArray(obj.items)?obj.items:[];rankingActiveId=obj.active||"default";}
  catch(e){rankingLibrary=[];rankingActiveId="default";}
}
function rankingSaveMeta(){localStorage.setItem(RANKING_KEY,JSON.stringify({items:rankingLibrary,active:rankingActiveId}));}
function rankingDB(){
  if(!rankingImageDBPromise) rankingImageDBPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open("ff-standings-ranking-images",1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("images"))req.result.createObjectStore("images");};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return rankingImageDBPromise;
}
async function rankingStoreImage(id,blob){const db=await rankingDB();return new Promise((resolve,reject)=>{const tx=db.transaction("images","readwrite");tx.objectStore("images").put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function rankingGetImage(id){const db=await rankingDB();return new Promise((resolve,reject)=>{const tx=db.transaction("images","readonly");const req=tx.objectStore("images").get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function rankingDeleteImage(id){const db=await rankingDB();return new Promise((resolve,reject)=>{const tx=db.transaction("images","readwrite");tx.objectStore("images").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function rankingImageURL(id){
  if(id==="default")return "/ranking-template.png";
  if(rankingObjectURLs.has(id))return rankingObjectURLs.get(id);
  const blob=await rankingGetImage(id);
  if(!blob)throw new Error("Không tìm thấy ảnh nền mẫu này. Hãy thêm lại ảnh.");
  const url=URL.createObjectURL(blob);rankingObjectURLs.set(id,url);return url;
}
function rankingCurrent(){return rankingLibrary.find(t=>t.id===rankingActiveId)||null;}
function rankingCoords(){return {...RANKING_DEFAULT,...(rankingCurrent()?.coords||{})};}
function rankingSetStyle(){
  const board=$("#scoreboard");if(!board)return;
  const c=rankingCoords();
  board.classList.add("ranking-library-active");
  const vars={"--ranking-first-y":c.firstY+"px","--ranking-step-y":c.stepY+"px","--ranking-font-size":c.fontSize+"px"};
  for(const k of Object.keys(RANKING_LABELS))vars[`--ranking-${k}-x`]=c[k]+"px";
  Object.entries(vars).forEach(([k,v])=>board.style.setProperty(k,v));
  const token=rankingActiveId;
  rankingImageURL(token).then(url=>{
    if(rankingActiveId===token)board.style.setProperty("--ranking-bg",`url("${url}")`);
  }).catch(err=>rankingMessage(err.message,true));
}
function rankingSelect(id){
  if(id!=="default"&&!rankingLibrary.some(t=>t.id===id))id="default";
  rankingActiveId=id;rankingSaveMeta();rankingSetStyle();
  rankingRenderLibrary();renderBoard();
}
function rankingRenderLibrary(){
  const select=$("#rankingTemplateSelect"),list=$("#rankingLibrary");
  if(select){select.innerHTML='<option value="default">BEE BÚT BÔI × HÙNG CAM</option>'+rankingLibrary.map(t=>`<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join("");select.value=rankingActiveId;}
  if(!list)return;
  const items=[{id:"default",name:"BEE BÚT BÔI × HÙNG CAM",builtIn:true},...rankingLibrary];
  list.innerHTML=items.map(t=>`<div class="ranking-library-card ${rankingActiveId===t.id?"active":""}" data-template="${escapeHTML(t.id)}"><img data-ranking-thumbnail="${escapeHTML(t.id)}" alt="Ảnh mẫu ${escapeHTML(t.name)}"><strong>${escapeHTML(t.name)}</strong><div class="actions"><button type="button" data-ranking-use="${escapeHTML(t.id)}">${rankingActiveId===t.id?"✓ ĐANG DÙNG":"SỬ DỤNG"}</button>${t.builtIn?"":`<button type="button" data-ranking-edit="${escapeHTML(t.id)}">CHỈNH VỊ TRÍ</button><button type="button" data-ranking-delete="${escapeHTML(t.id)}">XÓA</button>`}</div></div>`).join("");
  list.querySelectorAll("[data-ranking-thumbnail]").forEach(async img=>{try{img.src=await rankingImageURL(img.dataset.rankingThumbnail);}catch(e){img.alt="Ảnh nền không còn trong bộ nhớ";}});
  list.querySelectorAll("[data-ranking-use]").forEach(b=>b.onclick=()=>rankingSelect(b.dataset.rankingUse));
  list.querySelectorAll("[data-ranking-edit]").forEach(b=>b.onclick=()=>rankingOpenEditor(b.dataset.rankingEdit));
  list.querySelectorAll("[data-ranking-delete]").forEach(b=>b.onclick=()=>rankingRemove(b.dataset.rankingDelete));
}
async function rankingNormalizeFile(file){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error("Chỉ nhận ảnh PNG, JPG hoặc WEBP.");
  if(file.size>15*1024*1024)throw new Error("Ảnh tối đa 15 MB.");
  const img=await loadOCRImage(file);
  const canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;
  canvas.getContext("2d").drawImage(img,0,0,1920,1080);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Không thể xử lý ảnh")),"image/png"));
}
async function rankingAddBlank(file){
  if(rankingSaving)return;rankingSaving=true;
  try{
    rankingMessage("Đang xử lý ảnh nền...");const blob=await rankingNormalizeFile(file);
    const name=prompt("Tên mẫu bảng điểm:",file.name.replace(/\.[^.]+$/, ""));
    if(name===null)return;
    const id="rank-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
    await rankingStoreImage(id,blob);
    rankingLibrary.push({id,name:name.trim()||"Mẫu bảng điểm",coords:{...RANKING_DEFAULT},created:Date.now()});
    rankingSaveMeta();rankingSelect(id);rankingOpenEditor(id);
    rankingMessage("Đã thêm ảnh nền. Hãy căn điểm neo nếu bố cục khác mẫu mặc định, sau đó bấm LƯU VỊ TRÍ.");
  }catch(err){rankingMessage("Không thể thêm ảnh: "+err.message,true);}finally{rankingSaving=false;}
}
async function rankingRemove(id){
  const t=rankingLibrary.find(x=>x.id===id);if(!t||!confirm(`Xóa mẫu "${t.name}"?`))return;
  rankingLibrary=rankingLibrary.filter(x=>x.id!==id);
  try{await rankingDeleteImage(id);}catch(e){console.warn(e);}
  if(rankingObjectURLs.has(id)){URL.revokeObjectURL(rankingObjectURLs.get(id));rankingObjectURLs.delete(id);}
  if(rankingEditingId===id)rankingCloseEditor();
  if(rankingActiveId===id)rankingActiveId="default";
  rankingSaveMeta();rankingSetStyle();rankingRenderLibrary();renderBoard();rankingMessage("Đã xóa mẫu.");
}
function rankingCloseEditor(){rankingEditingId=null;$("#rankingManagerEditor")?.classList.add("hidden");}
async function rankingOpenEditor(id){
  const t=rankingLibrary.find(x=>x.id===id);if(!t)return;
  rankingEditingId=id;$("#rankingManagerEditor").classList.remove("hidden");
  $("#rankingEditingName").textContent="CĂN VỊ TRÍ: "+t.name;
  $("#rankingEditorImage").src=await rankingImageURL(id);
  const c={...RANKING_DEFAULT,...t.coords};
  $("#rankingFirstY").value=c.firstY;$("#rankingStepY").value=c.stepY;$("#rankingFontSize").value=c.fontSize;
  rankingRenderMarkers(c);
  $("#rankingManagerEditor").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function rankingRenderMarkers(coords){
  const host=$("#rankingEditorMarkers");host.innerHTML="";
  for(const [key,label] of Object.entries(RANKING_LABELS)){
    const el=document.createElement("div");el.className="ranking-anchor";el.dataset.key=key;
    el.style.left=(coords[key]/1920*100)+"%";el.style.top=(coords.firstY/1080*100)+"%";
    el.innerHTML=`<span>${label}</span>`;
    el.onpointerdown=e=>{
      e.preventDefault();el.setPointerCapture(e.pointerId);
      el.onpointermove=event=>{
        if(!el.hasPointerCapture(event.pointerId))return;
        const rect=$("#rankingEditorPreview").getBoundingClientRect();
        coords[key]=Math.max(0,Math.min(1920,Math.round((event.clientX-rect.left)/rect.width*1920)));
        el.style.left=(coords[key]/1920*100)+"%";
      };
      el.onpointerup=()=>{el.onpointermove=null;};
    };
    host.appendChild(el);
  }
  host.dataset.coords=JSON.stringify(coords);
  // Same mutable coords object is shared by the event handlers.
  rankingEditingCoords=coords;
}
let rankingEditingCoords=null;
function rankingSaveEditor(){
  const t=rankingLibrary.find(x=>x.id===rankingEditingId);if(!t||!rankingEditingCoords)return;
  const c=rankingEditingCoords;
  c.firstY=Math.max(0,Math.min(1080,number($("#rankingFirstY").value)));
  c.stepY=Math.max(10,Math.min(200,number($("#rankingStepY").value)));
  c.fontSize=Math.max(12,Math.min(72,number($("#rankingFontSize").value)));
  t.coords={...c};rankingSaveMeta();rankingSetStyle();renderBoard();rankingRenderLibrary();
  rankingMessage("Đã lưu tọa độ. Current Ranking và PNG xuất ra sẽ sử dụng đúng bố cục này.");
}
async function rankingAnalyzeReference(file){
  const t=rankingLibrary.find(x=>x.id===rankingActiveId);
  if(!t){rankingMessage("Hãy thêm và chọn ảnh bảng điểm TRỐNG trước, rồi mới phân tích ảnh tham chiếu có số liệu.",true);return;}
  if(!window.Tesseract?.createWorker){rankingMessage("Không tải được Tesseract.js. Hãy kiểm tra Internet.",true);return;}
  try{
    rankingMessage("Đang đọc ảnh tham chiếu bằng Tesseract.js. Có thể mất khoảng 10–40 giây...");
    const img=await loadOCRImage(file);
    const worker=await Tesseract.createWorker("eng");let result;
    try{result=await worker.recognize(file);}finally{await worker.terminate();}
    const words=getOCRWords(result.data).filter(w=>w.confidence>=25);
    if(words.length<15)throw new Error("Ảnh quá ít chữ/số để suy ra vị trí. Bạn vẫn có thể căn điểm neo thủ công.");
    const sx=1920/img.naturalWidth,sy=1080/img.naturalHeight;
    const nums=words.filter(w=>/^\d{1,5}$/.test(w.text.replace(/[,\.]/g,""))&&w.x0>img.naturalWidth*.18&&w.x0<img.naturalWidth*.65);
    const clusters=[];
    for(const w of nums){const x=(w.x0+w.x1)/2*sx;let g=clusters.find(c=>Math.abs(c.x-x)<35);if(!g){g={x,points:[]};clusters.push(g);}g.points.push({x,y:(w.y0+w.y1)/2*sy});g.x=g.points.reduce((a,p)=>a+p.x,0)/g.points.length;}
    const groups=clusters.filter(c=>c.points.length>=3).sort((a,b)=>a.x-b.x);
    const c={...RANKING_DEFAULT,...t.coords};
    if(groups.length>=4){const four=groups.slice(-4);["booyah","kills","placement","total"].forEach((k,i)=>c[k]=Math.round(four[i].x));}
    const ys=(groups.length?groups.at(-1).points:nums.map(w=>({y:(w.y0+w.y1)/2*sy}))).map(p=>p.y).sort((a,b)=>a-b);
    const unique=[];for(const y of ys){if(!unique.length||Math.abs(y-unique.at(-1))>18)unique.push(y);}
    if(unique.length>=5){const steps=unique.slice(1).map((y,i)=>y-unique[i]).filter(n=>n>25&&n<140).sort((a,b)=>a-b);if(steps.length){c.stepY=Math.round(steps[Math.floor(steps.length/2)]*10)/10;c.firstY=Math.round(unique[0]);}}
    t.coords=c;rankingSaveMeta();rankingSetStyle();renderBoard();await rankingOpenEditor(t.id);
    rankingMessage(`OCR tìm thấy ${words.length} cụm chữ và ${groups.length} cột số tiềm năng. Đã gợi ý tọa độ; hãy KÉO các điểm neo kiểm tra lại trước khi lưu.`);
  }catch(err){rankingMessage("Phân tích chưa thành công: "+err.message,true);}
}
function rankingInit(){
  rankingLoadMeta();rankingSetStyle();rankingRenderLibrary();
  $("#rankingTemplateSelect")?.addEventListener("change",e=>rankingSelect(e.target.value));
  $("#rankingAddBlank")?.addEventListener("click",()=>$("#rankingBlankInput").click());
  $("#rankingBlankInput")?.addEventListener("change",async e=>{const file=e.target.files?.[0];e.target.value="";if(file)await rankingAddBlank(file);});
  $("#rankingAnalyzeReference")?.addEventListener("click",()=>$("#rankingReferenceInput").click());
  $("#rankingReferenceInput")?.addEventListener("change",async e=>{const file=e.target.files?.[0];e.target.value="";if(file)await rankingAnalyzeReference(file);});
  $("#rankingCloseEditor")?.addEventListener("click",rankingCloseEditor);
  $("#rankingSaveEditor")?.addEventListener("click",rankingSaveEditor);
  $("#rankingDeleteCurrent")?.addEventListener("click",()=>rankingRemove(rankingEditingId));
}
function rankingDrawPNG(ctx,teams,loadImage){
  const c=rankingCoords();const bg=rankingImageURL(rankingActiveId);
  return bg.then(async src=>{
    ctx.drawImage(await loadImage(src),0,0,1920,1080);
    for(let i=0;i<Math.min(12,teams.length);i++){
      const t=teams[i],y=c.firstY+i*c.stepY,ink=i<3?"#36100c":"#ffe8a9";
      const logo=rankingTeamLogo(t);
      if(logo){try{const im=await loadImage(logo),ratio=Math.min(45/im.width,45/im.height);ctx.drawImage(im,c.logo-im.width*ratio/2,y-im.height*ratio/2,im.width*ratio,im.height*ratio);}catch(e){console.warn("Logo không tải được",e);}}
      ctx.fillStyle=ink;ctx.textBaseline="middle";ctx.font=`900 ${c.fontSize}px Arial,sans-serif`;ctx.textAlign="left";
      let name=String(t.name||"");while(ctx.measureText(name).width>195&&name.length>3)name=name.slice(0,-1);ctx.fillText(name,c.name,y);
      ctx.textAlign="center";
      [["booyah",t.booyah],["kills",t.kills],["placement",t.placement],["total",t.total]].forEach(([k,val])=>ctx.fillText(String(val??0),c[k],y));
    }
  });
}
rankingInit();


/* =========================================================
   OVERALL STANDINGS: BULK LOGO BY IMAGE FILE NAME
   Stored in IndexedDB; independent of match ID and template.
========================================================= */
const rankingLogoLibrary = new Map();
const rankingLogoObjectURLs = new Map();
function rankingLogoDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('ff-standings-logo-library',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('logos'))request.result.createObjectStore('logos',{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function rankingLogoSave(key,blob){
  const db=await rankingLogoDB();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('logos','readwrite');tx.objectStore('logos').put({key,blob});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
async function rankingLogoLoad(){
  const db=await rankingLogoDB();
  try{
    const records=await new Promise((resolve,reject)=>{
      const tx=db.transaction('logos','readonly'),req=tx.objectStore('logos').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    for(const item of records)rankingLogoRemember(item.key,item.blob);
  }finally{db.close();}
  renderBoard();
}
function rankingLogoRemember(key,blob){
  if(rankingLogoObjectURLs.has(key))URL.revokeObjectURL(rankingLogoObjectURLs.get(key));
  const url=URL.createObjectURL(blob);rankingLogoObjectURLs.set(key,url);rankingLogoLibrary.set(key,url);
}
function rankingTeamLogo(team){
  const explicit=state.logos[team.key]||state.logos[team.name];
  if(explicit)return explicit;
  const name=normalizeLogoName(team.name),key=normalizeLogoName(team.key);
  return rankingLogoLibrary.get(name)||rankingLogoLibrary.get(key)||null;
}
async function rankingBulkLogoImport(files){
  const status=document.querySelector('#rankingBulkLogoStatus');
  let added=0;const rejected=[];
  for(const file of Array.from(files||[])){
    if(!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)){rejected.push(file.name);continue;}
    const key=normalizeLogoName(file.name);
    if(!key){rejected.push(file.name);continue;}
    try{await rankingLogoSave(key,file);rankingLogoRemember(key,file);added++;}
    catch(e){console.error(e);rejected.push(file.name);}
  }
  renderBoard();
  const matched=sortedTeams().filter(t=>rankingTeamLogo(t)).length;
  const msg=`Đã lưu ${added} logo theo tên ảnh. ${matched} đội hiện có logo trên Current Ranking.`+(rejected.length?` Không xử lý: ${rejected.slice(0,5).join(', ')}`:'');
  if(status)status.textContent=msg;
  setStatus(msg,added?'success':'error');
}
function rankingBulkLogoInit(){
  const picker=document.querySelector('#rankingBulkLogoInput');if(!picker)return;
  document.querySelector('#rankingBulkLogoBtn')?.addEventListener('click',()=>picker.click());
  document.querySelector('#rankingBulkLogoToolBtn')?.addEventListener('click',()=>picker.click());
  picker.addEventListener('change',async()=>{const files=Array.from(picker.files||[]);picker.value='';if(files.length)await rankingBulkLogoImport(files);});
  rankingLogoLoad().catch(e=>console.warn('Không tải được thư viện logo:',e));
}
rankingBulkLogoInit();
