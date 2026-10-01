// "Size it up" guessing game. Needs d3 and topojson loaded first.
//
// Each country is drawn with an equal-area projection centred on itself, so its shape
// and area are true. Both start at the same on-screen area; the slider sets the
// guessed area ratio (second ÷ first) on a log scale from 1/100 to 100.

// Map data: the CDN first, then the copy saved in data/ (for hosts that block the CDN).
const WORLD_URLS = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  "../data/countries-110m.json"
];
const loadWorld = () => WORLD_URLS.reduce((p, url) => p.catch(() => d3.json(url)), Promise.reject());

// Well-known countries with a recognisable outline. France is left out because the
// data bundles it with French Guiana; Russia because it spans half the globe.
const POOL = [
  "United States of America", "Canada", "Brazil", "Australia", "China", "India",
  "Indonesia", "Greenland", "Mexico", "Argentina", "Kazakhstan", "Saudi Arabia",
  "Algeria", "Dem. Rep. Congo", "Iran", "Mongolia", "Peru", "Egypt", "South Africa",
  "Nigeria", "Japan", "United Kingdom", "Spain", "Germany", "Turkey", "Madagascar",
  "Chile", "Sweden", "Norway", "Italy", "Pakistan", "Ukraine", "New Zealand",
  "Colombia", "Thailand", "Philippines", "Vietnam", "Iceland", "Cuba", "Kenya",
  "Ethiopia", "Libya", "Sudan", "Poland", "Finland", "Venezuela", "Bolivia",
  "Afghanistan", "Myanmar", "Ireland", "South Korea", "Morocco", "Somalia"
];
const DISPLAY_NAMES = { "United States of America": "USA", "Dem. Rep. Congo": "DR Congo" };
const displayName = n => DISPLAY_NAMES[n] || n;

const MAX_PAIR_RATIO = 40;     // skip pairs where one country is >40× the other
const MIN_ISLAND_SHARE = 0.01; // drop islands under 1% of a country's area from the drawing
const UNIT = 1000;             // projection scale for the unit-size shapes
const STAGE_W = 1000, STAGE_H = 520, PAD = 36;
const CELL_W = STAGE_W / 2, BOX = Math.min(CELL_W, STAGE_H) - 2 * PAD;
const ZERO_SCORE_FACTOR = 4;   // a guess off by 4× (or more) scores 0%

const stage = document.getElementById("stage");
const slider = document.getElementById("sizeSlider");
const guessText = document.getElementById("guessText");
const lockBtn = document.getElementById("lockBtn");
const guessPanel = document.getElementById("guessPanel");
const resultPanel = document.getElementById("resultPanel");
const revealLegend = document.getElementById("revealLegend");

const gameCard = document.getElementById("gameCard");
const finalCard = document.getElementById("finalCard");

let byName = new Map(); // country name -> feature
let round = null;       // { a, b, ratio, revealed }
let game = null;        // { roundNum, total, usedPairs }

// ---------- Shapes ----------

// Keep only the polygons that make up at least MIN_ISLAND_SHARE of the country,
// so far-off specks (like Hawaii) don't shrink the main shape.
function mainland(feature) {
  const g = feature.geometry;
  if (g.type !== "MultiPolygon") return feature;
  const parts = g.coordinates.map(c => ({ c, area: d3.geoArea({ type: "Polygon", coordinates: c }) }));
  const total = d3.sum(parts, p => p.area);
  return {
    type: "Feature",
    properties: feature.properties,
    geometry: { type: "MultiPolygon", coordinates: parts.filter(p => p.area >= total * MIN_ISLAND_SHARE).map(p => p.c) }
  };
}

// The country's outline at UNIT scale, its bounding box and its true area (steradians).
function makeShape(name) {
  const feature = byName.get(name);
  const drawn = mainland(feature);
  const [lon, lat] = d3.geoCentroid(drawn);
  const projection = d3.geoAzimuthalEqualArea().rotate([-lon, -lat]).scale(UNIT).translate([0, 0]);
  const path = d3.geoPath(projection);
  const [[x0, y0], [x1, y1]] = path.bounds(drawn);
  return {
    name,
    d: path(drawn),
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    size: Math.max(x1 - x0, y1 - y0),
    area: d3.geoArea(feature)
  };
}

// Linear scale of B relative to A when B's area is shown as `ratio` × A's area.
// (At equal scale, their on-screen areas are proportional to their true areas.)
const relScale = (a, b, ratio) => Math.sqrt(ratio * a.area / b.area);

// Scale for A that keeps A and every requested version of B inside their boxes.
function fitScale(a, b, ratios) {
  return Math.min(BOX / a.size, ...ratios.map(r => BOX / (b.size * relScale(a, b, r))));
}

const placeTransform = (shape, s, cellX) =>
  `translate(${cellX + CELL_W / 2 - s * shape.cx}px, ${STAGE_H / 2 - s * shape.cy}px) scale(${s})`;

// ---------- Drawing ----------

function buildStage() {
  const svg = d3.create("svg")
    .attr("viewBox", `0 0 ${STAGE_W} ${STAGE_H}`)
    .attr("role", "img")
    .attr("aria-label", `${displayName(round.a.name)} and ${displayName(round.b.name)}`);
  svg.append("rect").attr("class", "cell").attr("width", STAGE_W).attr("height", STAGE_H).attr("rx", 8);
  svg.append("line").attr("class", "divider")
    .attr("x1", CELL_W).attr("x2", CELL_W).attr("y1", 16).attr("y2", STAGE_H - 16);
  round.elA = svg.append("path").attr("class", "shape a").attr("d", round.a.d);
  round.elB = svg.append("path").attr("class", "shape b").attr("d", round.b.d);
  round.elGuess = null;
  stage.replaceChildren(svg.node());
  round.svg = svg;
}

const guessRatio = () => Math.pow(10, Number(slider.value));

function drawGuess() {
  const { a, b } = round;
  const g = guessRatio();
  const s = fitScale(a, b, [g]);
  round.elA.style("transform", placeTransform(a, s, 0));
  round.elB.style("transform", placeTransform(b, s * relScale(a, b, g), CELL_W));
  guessText.textContent = describe(g, displayName(a.name), displayName(b.name));
}

// After locking in: B at its real size, with the guess as a dashed outline.
function drawReveal() {
  const { a, b, ratio } = round;
  const g = guessRatio();
  const s = fitScale(a, b, [g, ratio]);
  round.elA.style("transform", placeTransform(a, s, 0));
  round.elB.style("transform", placeTransform(b, s * relScale(a, b, ratio), CELL_W));
  round.elGuess = round.svg.append("path")
    .attr("class", "shape guess")
    .attr("d", b.d)
    .style("transform", placeTransform(b, s * relScale(a, b, g), CELL_W));
}

// ---------- Text ----------

function fmtTimes(x) {
  return (x < 10 ? x.toFixed(1) : Math.round(x)) + "×";
}

function describe(ratio, nameA, nameB) {
  if (Math.abs(Math.log(ratio)) < 0.05) return "They're about the same size";
  return ratio > 1
    ? `${nameB} is ${fmtTimes(ratio)} bigger than ${nameA}`
    : `${nameA} is ${fmtTimes(1 / ratio)} bigger than ${nameB}`;
}

// 100% for a perfect guess, falling to 0% at ZERO_SCORE_FACTOR× off (in either direction).
function scoreFor(guess, truth) {
  const off = Math.abs(Math.log(guess / truth)) / Math.log(ZERO_SCORE_FACTOR);
  return Math.round(100 * Math.max(0, 1 - off));
}

function verdictFor(score) {
  if (score >= 90) return "Big brain energy!";
  if (score >= 70) return "Nice eye!";
  if (score >= 40) return "Not bad";
  if (score > 0) return "Mercator got you";
  return "Way off — try another";
}

// ---------- Rounds ----------

// A random pair not yet played this game, in either order.
function pickPair() {
  const names = POOL.filter(n => byName.has(n));
  for (;;) {
    const a = names[Math.floor(Math.random() * names.length)];
    const b = names[Math.floor(Math.random() * names.length)];
    if (a === b) continue;
    const key = [a, b].sort().join("|");
    if (game.usedPairs.has(key)) continue;
    const ratio = d3.geoArea(byName.get(b)) / d3.geoArea(byName.get(a));
    if (ratio < MAX_PAIR_RATIO && ratio > 1 / MAX_PAIR_RATIO) {
      game.usedPairs.add(key);
      return [a, b];
    }
  }
}

function updateScoreboard() {
  document.getElementById("roundNum").textContent = `${game.roundNum}/${ROUNDS_PER_GAME}`;
  document.getElementById("total").textContent = game.total;
}

function newGame() {
  game = { roundNum: 0, total: 0, usedPairs: new Set() };
  finalCard.hidden = true;
  gameCard.hidden = false;
  newRound();
}

function newRound() {
  game.roundNum += 1;
  updateScoreboard();
  document.getElementById("nextLabel").textContent =
    game.roundNum === ROUNDS_PER_GAME ? "See final score" : "Next pair";

  const [a, b] = pickPair();
  const shapeA = makeShape(a), shapeB = makeShape(b);
  round = { a: shapeA, b: shapeB, ratio: shapeB.area / shapeA.area, revealed: false };

  document.getElementById("nameA").textContent = displayName(a);
  document.getElementById("nameB").textContent = displayName(b);
  slider.value = 0;
  slider.disabled = false;
  document.getElementById("smaller").disabled = false;
  document.getElementById("bigger").disabled = false;
  lockBtn.disabled = false;
  guessPanel.hidden = false;
  resultPanel.hidden = true;
  revealLegend.hidden = true;

  buildStage();
  drawGuess();
}

function lockIn() {
  if (!round || round.revealed) return;
  round.revealed = true;
  const { a, b, ratio } = round;
  const score = scoreFor(guessRatio(), ratio);

  game.total += score;
  updateScoreboard();

  document.getElementById("scoreValue").textContent = score;
  document.getElementById("verdict").textContent = verdictFor(score);
  document.getElementById("truth").textContent =
    `Actually: ${describe(ratio, displayName(a.name), displayName(b.name))}.`;

  slider.disabled = true;
  document.getElementById("smaller").disabled = true;
  document.getElementById("bigger").disabled = true;
  guessPanel.hidden = true;
  resultPanel.hidden = false;
  revealLegend.hidden = false;
  drawReveal();
  document.getElementById("nextBtn").focus();
}

function showFinal() {
  const average = Math.round(game.total / ROUNDS_PER_GAME);
  document.getElementById("finalTotal").textContent = game.total;
  document.getElementById("finalAvg").textContent = `${average}% average`;
  document.getElementById("finalVerdict").textContent = verdictFor(average);
  document.getElementById("saveError").hidden = true;

  const form = document.getElementById("saveForm");
  form.hidden = false;
  const nameInput = document.getElementById("playerName");
  nameInput.value = lastPlayerName();

  gameCard.hidden = true;
  finalCard.hidden = false;
  finalCard.scrollIntoView({ behavior: "smooth", block: "center" });
  nameInput.focus({ preventScroll: true });
}

// ---------- Events ----------

slider.addEventListener("input", () => { if (round && !round.revealed) drawGuess(); });

function nudge(delta) {
  slider.value = Math.max(-2, Math.min(2, Number(slider.value) + delta));
  if (round && !round.revealed) drawGuess();
}
document.getElementById("smaller").addEventListener("click", () => nudge(-0.05));
document.getElementById("bigger").addEventListener("click", () => nudge(0.05));
lockBtn.addEventListener("click", lockIn);
document.getElementById("nextBtn").addEventListener("click", () =>
  game.roundNum >= ROUNDS_PER_GAME ? showFinal() : newRound());
document.getElementById("playAgainBtn").addEventListener("click", newGame);

document.getElementById("saveForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  if (submit.disabled) return; // already saving
  submit.disabled = true;
  submit.textContent = "Saving…";

  const name = document.getElementById("playerName").value;
  const saved = await saveScore(name, game.total, Math.round(game.total / ROUNDS_PER_GAME));
  if (!saved) {
    document.getElementById("saveError").hidden = false;
    submit.disabled = false;
    submit.textContent = "Save score";
    return;
  }
  // Show the new entry highlighted on the leaderboard.
  const params = new URLSearchParams({ highlight: saved.entry.id });
  if (saved.fallback) params.set("fallback", "1");
  location.href = `leaderboard/index.html?${params}`;
});

// ---------- Start ----------

if (window.d3 && window.topojson) {
  loadWorld()
    .then(world => {
      for (const f of topojson.feature(world, world.objects.countries).features) {
        byName.set(f.properties.name, f);
      }
      newGame();
    })
    .catch(() => { stage.textContent = "Couldn't load the countries. Check your internet connection and reload."; });
} else {
  stage.textContent = "Couldn't load the countries. Check your internet connection and reload.";
}
