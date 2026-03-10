import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, Shuffle, Share2, Download, Undo2 } from "lucide-react";
import { motion } from "framer-motion";
import logo from './assets/logo.png';
/*import './app.css'*/

// ------------------------------------------------------------
// Utility: Seeded RNG & Shuffle (deterministic, shareable)
// ------------------------------------------------------------
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, rng) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function encodeState(stateObj) {
  const json = JSON.stringify(stateObj);
  const b64 = typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(json))) : "";
  return b64;
}
function decodeState(b64) {
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------
// Core Scheduling Logic
// ------------------------------------------------------------
function generateDraw({ players, courts, rounds, seed, tryAvoidRepeatPartners = true }) {
  const N = players.length;
  if (N < 4) {
    return { rounds: [], stats: {}, note: "Need at least 4 players for doubles." };
  }
  const rng = mulberry32(hashSeed(seed));

  // Matches possible per round considering player pool
  const matchesPerRound = Math.min(courts, Math.floor(N / 4));
  const totalSlots = rounds * matchesPerRound * 4; // each match uses 4 slots

  // Fair-distribution targets: base +/- 1
  const base = Math.floor(totalSlots / N);
  const remainder = totalSlots % N;
  const shuffledForRemainder = seededShuffle(players, rng);
  const target = {};
  shuffledForRemainder.forEach((p, idx) => {
    target[p] = base + (idx < remainder ? 1 : 0);
  });
  const maxTarget = base + (remainder > 0 ? 1 : 0);

  // Stats trackers
  const gamesPlayed = Object.fromEntries(players.map((p) => [p, 0]));
  const partners = {}; // partner pair counts to reduce repeats

  function canPlay(p) {
    return gamesPlayed[p] < maxTarget;
  }

  const roundsOut = [];
  for (let r = 0; r < rounds; r++) {
    const roundPlayers = new Set();
    const thisRound = [];

    // choose players with least games first to balance
    const sorted = players.slice().sort((a, b) => {
      const d = gamesPlayed[a] - gamesPlayed[b];
      if (d !== 0) return d;
      // small random tie-breaker using rng
      return rng() - 0.5;
    });

    // Build matches
    let built = 0;
    let attempts = 0;
    const maxAttempts = 500; // safeguard

    while (built < matchesPerRound && attempts++ < maxAttempts) {
      // choose 4 candidates not yet scheduled this round
      const candidates = sorted.filter((p) => !roundPlayers.has(p) && canPlay(p));

      if (candidates.length < 4) {
        // relax constraint if we still have room: allow players who hit maxTarget if absolutely necessary
        const relaxed = sorted.filter((p) => !roundPlayers.has(p));
        if (relaxed.length < 4) break; // can't form more matches this round
        const four = relaxed.slice(0, 4);
        const paired = pairTeams(four, rng, partners, tryAvoidRepeatPartners);
        if (!paired) break;
        thisRound.push({ court: built + 1, teamA: paired[0], teamB: paired[1] });
        four.forEach((p) => {
          roundPlayers.add(p);
          gamesPlayed[p] += 1;
        });
        trackPartners(paired[0], paired[1], partners);
        built++;
        continue;
      }

      // Prefer lowest-played subset, but try a few combinations
      const pool = seededShuffle(candidates.slice(0, Math.max(6, 4)), rng); // small pool for variety

      const chosen = pickFourBalanced(pool, gamesPlayed, rng);
      if (!chosen) break;

      const paired = pairTeams(chosen, rng, partners, tryAvoidRepeatPartners);
      if (!paired) continue; // try again

      thisRound.push({ court: built + 1, teamA: paired[0], teamB: paired[1] });
      chosen.forEach((p) => {
        roundPlayers.add(p);
        gamesPlayed[p] += 1;
      });
      trackPartners(paired[0], paired[1], partners);
      built++;
    }

    roundsOut.push(thisRound);
  }

  const stats = Object.fromEntries(players.map((p) => [p, gamesPlayed[p]]));
  return { rounds: roundsOut, stats, note: matchesPerRound < courts ? `Only ${matchesPerRound} court(s) used per round due to player count.` : undefined };
}

function pairTeams(four, rng, partners, tryAvoidRepeat) {
  if (four.length !== 4) return null;
  const attempts = 10;
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < attempts; i++) {
    const perm = seededShuffle(four, rng);
    const tA = [perm[0], perm[1]];
    const tB = [perm[2], perm[3]];
    const score = tryAvoidRepeat ? partnerScore(tA, tB, partners) : 0;
    if (score < bestScore) {
      best = [tA, tB];
      bestScore = score;
    }
  }
  return best;
}

function partnerKey(a, b) {
  return [a, b].sort().join("__");
}
function trackPartners(teamA, teamB, partners) {
  const kA = partnerKey(teamA[0], teamA[1]);
  const kB = partnerKey(teamB[0], teamB[1]);
  partners[kA] = (partners[kA] || 0) + 1;
  partners[kB] = (partners[kB] || 0) + 1;
}
function partnerScore(teamA, teamB, partners) {
  const kA = partnerKey(teamA[0], teamA[1]);
  const kB = partnerKey(teamB[0], teamB[1]);
  return (partners[kA] || 0) + (partners[kB] || 0);
}

function pickFourBalanced(pool, gamesPlayed, rng) {
  if (pool.length < 4) return null;
  // try a few random 4-sets prioritizing lower game counts
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < Math.min(30, factorialBound(pool.length)); i++) {
    const test = seededShuffle(pool, rng).slice(0, 4);
    const score = test.reduce((acc, p) => acc + gamesPlayed[p], 0);
    if (score < bestScore) {
      bestScore = score;
      best = test;
    }
  }
  return best;
}
function factorialBound(n) {
  // Just a small bound for loop iterations
  return Math.min(24, n);
}

function hashSeed(s) {
  const str = String(s ?? "42");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

// ------------------------------------------------------------
// UI Components
// ------------------------------------------------------------
export default function PickleballDrawApp() {
  const [playersText, setPlayersText] = useState("");
  const [courts, setCourts] = useState(2);
  const [rounds, setRounds] = useState(8);
  const [seed, setSeed] = useState("PB2026");
  const [avoidRepeatPartners, setAvoidRepeatPartners] = useState(true);
  const [schedule, setSchedule] = useState([]);
  const [stats, setStats] = useState({});
  const [note, setNote] = useState("");

  // Load state from URL if present
  useEffect(() => {
    const url = new URL(window.location.href);
    const s = url.searchParams.get("state");
    if (s) {
      const parsed = decodeState(s);
      if (parsed) {
        setPlayersText((parsed.players || []).join("\n"));
        setCourts(parsed.courts ?? courts);
        setRounds(parsed.rounds ?? rounds);
        setSeed(parsed.seed ?? seed);
        setAvoidRepeatPartners(parsed.avoidRepeatPartners ?? true);
        if (parsed.schedule && parsed.stats) {
          setSchedule(parsed.schedule);
          setStats(parsed.stats);
          setNote(parsed.note || "");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const players = useMemo(() => {
    return playersText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [playersText]);

  function onGenerate() {
    const result = generateDraw({
      players,
      courts: Math.max(1, Number(courts) || 1),
      rounds: Math.max(1, Number(rounds) || 1),
      seed: seed || "PB",
      tryAvoidRepeatPartners: !!avoidRepeatPartners,
    });
    setSchedule(result.rounds);
    setStats(result.stats);
    setNote(result.note || "");
  }

  function onShuffle() {
    setSeed((prev) => prev + "_" + Math.floor(Math.random() * 1000));
    setTimeout(onGenerate, 0);
  }

  function copyShareLink(includeSchedule = true) {
    const stateObj = {
      players,
      courts,
      rounds,
      seed,
      avoidRepeatPartners,
      schedule: includeSchedule ? schedule : undefined,
      stats: includeSchedule ? stats : undefined,
      note: includeSchedule ? note : undefined,
    };
    const encoded = encodeState(stateObj);
    const base = window.location.origin + window.location.pathname;
    const link = `${base}?state=${encoded}`;
    navigator.clipboard.writeText(link).then(() => {
      alert("Shareable link copied to clipboard.");
    });
  }

  function exportCSV() {
    if (!schedule?.length) return;
    const rows = [];
    schedule.forEach((round, rIdx) => {
      round.forEach((match, mIdx) => {
        rows.push([
          `Round ${rIdx + 1}`,
          `Court ${match.court}`,
          match.teamA.join(" & "),
          match.teamB.join(" & "),
        ]);
      });
    });
    const csv = ["Round,Court,Team A,Team B", ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pickleball_draw.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const minGames = useMemo(() => {
    const vals = Object.values(stats || {});
    if (!vals.length) return 0;
    return Math.min(...vals);
  }, [stats]);
  const maxGames = useMemo(() => {
    const vals = Object.values(stats || {});
    if (!vals.length) return 0;
    return Math.max(...vals);
  }, [stats]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-bold text-center">
        Pickleball Doubles Draw Generator
      </motion.h1>

      <Card className="border rounded-2xl shadow-sm">
        <CardContent className="p-6 grid md:grid-cols-3 gap-4">
          <div className="md:col-span-1 space-y-3">
            <Label className="text-sm">Players (one per line)</Label>
            <Textarea
              className="min-h-[220px]"
              placeholder={`Alice\nBob\nCharlie\nDana\nEvan\nFaith\n...`}
              value={playersText}
              onChange={(e) => setPlayersText(e.target.value)}
            />
            <div className="text-xs text-muted-foreground">Tip: Paste your roster; blanks are ignored.</div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm">Courts</Label>
            <Input type="number" min={1} value={courts} onChange={(e) => setCourts(parseInt(e.target.value || "1", 10))} />
            <Label className="text-sm">Rounds</Label>
            <Input type="number" min={1} value={rounds} onChange={(e) => setRounds(parseInt(e.target.value || "1", 10))} />
            <Label className="text-sm">Seed (for reproducible random)</Label>
            <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
            <div className="flex items-center gap-2 pt-2">
              <Switch id="avoid" checked={avoidRepeatPartners} onCheckedChange={setAvoidRepeatPartners} className="cursor-pointer" />
              <Label htmlFor="avoid">Try to avoid repeat partners</Label>
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button onClick={onGenerate} className="cursor-pointer gap-2 primary">
                <Shuffle className="w-4 h-4" /> Generate Draw
              </Button>
              <Button variant="secondary" onClick={onShuffle} className="cursor-pointer gap-2">
                <Undo2 className="w-4 h-4" /> Shuffle Seed
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => copyShareLink(true)} className="cursor-pointer gap-2">
                <Share2 className="w-4 h-4" /> Copy Share Link (with draw)
              </Button>
              <Button variant="outline" onClick={() => copyShareLink(false)} className="cursor-pointer gap-2">
                <Copy className="w-4 h-4" /> Copy Setup Link (no draw)
              </Button>
              <Button variant="outline" onClick={exportCSV} className="cursor-pointer gap-2">
                <Download className="w-4 h-4" /> Export CSV
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold">Fairness Check</div>
            <div className="text-sm">Players: <span className="font-mono">{players.length}</span></div>
            <div className="text-sm">Courts per round used: <span className="font-mono">{Math.min(courts, Math.floor(players.length / 4) || 0)}</span></div>
            <div className="text-sm">Rounds: <span className="font-mono">{rounds}</span></div>
            <div className="text-sm">Games per player (min → max): <span className="font-mono">{minGames} → {maxGames}</span></div>
            {note ? <div className="text-xs text-amber-600">{note}</div> : null}
            <div className="pt-2">
              <div className="text-sm font-semibold mb-1">Games per Player</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-52 overflow-auto pr-1">
                {Object.entries(stats).sort((a,b)=>a[0].localeCompare(b[0])).map(([p, g]) => (
                  <div key={p} className="flex items-center justify-between rounded-xl border px-3 py-1.5">
                    <span className="text-sm truncate pr-2">{p}</span>
                    <span className="font-mono text-sm">{g}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {schedule && schedule.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="text-lg font-semibold">Draw</div>
          <div className="space-y-6">
            {schedule.map((round, rIdx) => (
              <Card key={rIdx} className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="font-semibold mb-3">Round {rIdx + 1}</div>
                  {round.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No matches scheduled this round.</div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {round.map((match, mIdx) => (
                        <div key={mIdx} className="rounded-2xl border p-3">
                          <div className="text-xs text-muted-foreground mb-1">Court {match.court}</div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{match.teamA[0]} & {match.teamA[1]}</div>
                              <div className="text-xs text-muted-foreground">Team A</div>
                            </div>
                            <div className="px-2 text-muted-foreground">vs</div>
                            <div className="text-right">
                              <div className="font-medium">{match.teamB[0]} & {match.teamB[1]}</div>
                              <div className="text-xs text-muted-foreground">Team B</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      )}

      <div className="text-xs text-muted-foreground pt-4 text-center">
        Proudly bought to you by <a href="https://www.heardtech.co.nz/" target="_new">HeardTech</a>
      </div>
    </div>
  );
}