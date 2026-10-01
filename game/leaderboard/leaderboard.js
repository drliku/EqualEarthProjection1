// Renders the "Size it up" leaderboard. Needs ../scores.js loaded first.

const list = document.getElementById("boardList");
const empty = document.getElementById("boardEmpty");
const clearBtn = document.getElementById("clearBtn");
const badge = document.getElementById("modeBadge");
const subtitle = document.getElementById("boardSubtitle");
const notice = document.getElementById("boardNotice");

const query = new URLSearchParams(location.search);
const highlightId = query.get("highlight");
let scrolledToHighlight = false;

const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showNotice(text) {
  notice.textContent = text;
  notice.hidden = false;
}

async function render(scores, mode) {
  badge.hidden = false;
  badge.textContent = mode === "global" ? "Global board" : "This browser only";
  badge.classList.toggle("global", mode === "global");
  subtitle.textContent = mode === "global"
    ? "The best 10-round scores from everyone with the link, out of 1000 points."
    : "The best 10-round scores played in this browser, out of 1000 points.";

  list.replaceChildren();
  empty.hidden = scores.length > 0;
  clearBtn.hidden = scores.length === 0 || !(await canClearScores());

  scores.forEach((entry, i) => {
    const row = el("li", "board-row" + (entry.id === highlightId ? " new" : ""));

    const player = el("div", "player");
    player.append(
      el("span", "player-name", entry.name),
      el("span", "player-meta", `${entry.average}% average · ${dateFormat.format(new Date(entry.date))}`)
    );

    const points = el("div", "points", String(entry.score));
    points.append(el("small", "", "/ 1000"));

    row.append(el("span", "rank", String(i + 1)), player, points);
    list.append(row);
  });

  // Scroll to a just-saved score once, not on every live update.
  const fresh = list.querySelector(".board-row.new");
  if (fresh && !scrolledToHighlight) {
    scrolledToHighlight = true;
    fresh.scrollIntoView({ block: "center" });
  }
}

if (query.get("fallback")) {
  showNotice("Your score was saved in this browser only. To post to the global board, ask the page's owner for Editor access.");
}

watchScores(render, () =>
  showNotice("The leaderboard stopped updating. Reload the page to see the latest scores."));

clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete every score on this leaderboard? This can't be undone.")) return;
  clearBtn.disabled = true;
  try {
    await clearScores();
  } catch {
    showNotice("Couldn't clear the leaderboard. Try again in a moment.");
  }
  clearBtn.disabled = false;
  // The global board updates itself; the local one needs a fresh read.
  if ((await getBackend()).mode === "local") render(loadLocalScores(), "local");
});
