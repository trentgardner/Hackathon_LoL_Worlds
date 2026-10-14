// Leaguepedia (lol.fandom.com) Cargo API.
//
// Anonymous Cargo queries get rate-limited, so we log in first with the bot
// password from .env (LEAGUEPEDIA_USER / LEAGUEPEDIA_PASS). The login hands
// back cookies; every later request has to send those cookies back.

import { WINDOW_START, WORLDS_OVERVIEW, REQUEST_DELAY_MS } from '../config.mjs';

const API = 'https://lol.fandom.com/api.php';
const USER_AGENT = 'lol-moneyball-hackathon/0.1';
const PAGE_SIZE = 500; // Cargo's max rows per call
const cookies = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function saveCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

// Send one request to the wiki API with our cookies attached. Returns parsed JSON.
async function apiRequest(params, method = 'GET') {
  const body = new URLSearchParams({ format: 'json', ...params });
  const headers = {
    'User-Agent': USER_AGENT,
    Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  };

  const res = method === 'GET'
    ? await fetch(`${API}?${body}`, { headers })
    : await fetch(API, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

  saveCookies(res);
  return res.json();
}

// Escape a value for a Cargo WHERE clause: Anyone's Legend -> 'Anyone''s Legend'
const quote = (s) => `'${s.replace(/'/g, "''")}'`;

/**
 * Log in with the bot password from .env. Throws if it fails.
 */
export async function login() {
  const user = process.env.LEAGUEPEDIA_USER;
  const pass = process.env.LEAGUEPEDIA_PASS;
  if (!user || !pass) throw new Error('Missing LEAGUEPEDIA_USER / LEAGUEPEDIA_PASS in .env');

  const tokenRes = await apiRequest({ action: 'query', meta: 'tokens', type: 'login' });
  const res = await apiRequest({
    action: 'login',
    lgname: user,
    lgpassword: pass,
    lgtoken: tokenRes.query.tokens.logintoken,
  }, 'POST');

  if (res.login?.result !== 'Success') {
    throw new Error(`Leaguepedia login failed: ${res.login?.reason ?? res.login?.result}`);
  }
  console.log(`Leaguepedia: logged in as ${res.login.lgusername}`);
}

/**
 * Run one Cargo query and return all rows as plain objects.
 * Pages through results 500 at a time. Retries if rate-limited.
 */
export async function cargoQuery({ tables, fields, where, joinOn, orderBy }) {
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = { action: 'cargoquery', tables, fields, limit: PAGE_SIZE, offset };
    if (where) params.where = where;
    if (joinOn) params.join_on = joinOn;
    if (orderBy) params.order_by = orderBy;

    let res;
    for (let attempt = 1; ; attempt++) {
      res = await apiRequest(params, 'POST');
      if (res.error?.code !== 'ratelimited' || attempt === 5) break;
      console.log(`Leaguepedia: rate-limited, waiting ${attempt * 10}s...`);
      await sleep(attempt * 10_000);
    }
    if (res.error) throw new Error(`Cargo error: ${res.error.code}: ${res.error.info}`);

    const page = res.cargoquery.map((r) => r.title);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    await sleep(REQUEST_DELAY_MS);
  }
}

/**
 * Get the Worlds field: [{ name, short, codes, region, stage }].
 * `codes` = every short code the team goes by (e.g. Team Liquid = TL + TLAW), lowercased.
 * Skips the "TBD" placeholder slot. Seeds live in config.mjs (hand-copied).
 */
export async function getWorldsTeams() {
  const rows = await cargoQuery({
    tables: 'TournamentRosters=TR,Teams=T',
    joinOn: 'TR.Team=T.OverviewPage',
    fields: 'TR.Team=name,T.Short=short,TR.Short=rosterShort,T.Region=region,TR.OverviewPage=stage',
    where: `TR.OverviewPage LIKE ${quote(`${WORLDS_OVERVIEW}%`)}`,
  });

  return rows
    .filter((r) => r.name !== 'TBD')
    .map((r) => ({
      name: r.name,
      short: r.short,
      codes: [...new Set([r.short, r.rosterShort].filter(Boolean).map((c) => c.toLowerCase()))],
      region: r.region,
      stage: r.stage.endsWith('Play-In') ? 'Play-In' : 'Main Event',
    }));
}

/**
 * Get every game since WINDOW_START that a Worlds team played in.
 * One row per game: teams, result, series info, end-of-game team stats, picks/bans.
 */
export async function getGames(teamNames) {
  const list = teamNames.map(quote).join(',');
  const rows = await cargoQuery({
    tables: 'ScoreboardGames=SG',
    fields: [
      'SG.GameId=gameId', 'SG.MatchId=matchId', 'SG.N_GameInMatch=gameInMatch',
      'SG.Tournament=tournament', 'SG.OverviewPage=overviewPage', 'SG.DateTime_UTC=date',
      'SG.Team1=team1', 'SG.Team2=team2', 'SG.WinTeam=winner', 'SG.Gamelength_Number=minutes',
      'SG.Team1Score=team1Score', 'SG.Team2Score=team2Score',
      'SG.Team1Gold=team1Gold', 'SG.Team2Gold=team2Gold',
      'SG.Team1Kills=team1Kills', 'SG.Team2Kills=team2Kills',
      'SG.Team1Towers=team1Towers', 'SG.Team2Towers=team2Towers',
      'SG.Team1Dragons=team1Dragons', 'SG.Team2Dragons=team2Dragons',
      'SG.Team1Barons=team1Barons', 'SG.Team2Barons=team2Barons',
      'SG.Team1Inhibitors=team1Inhibitors', 'SG.Team2Inhibitors=team2Inhibitors',
      'SG.Team1Picks=team1Picks', 'SG.Team2Picks=team2Picks',
      'SG.Team1Bans=team1Bans', 'SG.Team2Bans=team2Bans',
    ].join(','),
    where: `SG.DateTime_UTC >= ${quote(WINDOW_START)} AND (SG.Team1 IN (${list}) OR SG.Team2 IN (${list}))`,
    orderBy: 'SG.DateTime_UTC',
  });

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const split = (v) => (v ? v.split(',') : []);

  return rows.map((r) => ({
    gameId: r.gameId,
    matchId: r.matchId,
    gameInMatch: num(r.gameInMatch),
    tournament: r.tournament,
    overviewPage: r.overviewPage,
    date: r.date,
    team1: r.team1,
    team2: r.team2,
    winner: r.winner,
    minutes: num(r.minutes),
    seriesScore: [num(r.team1Score), num(r.team2Score)],
    end: {
      gold: [num(r.team1Gold), num(r.team2Gold)],
      kills: [num(r.team1Kills), num(r.team2Kills)],
      towers: [num(r.team1Towers), num(r.team2Towers)],
      dragons: [num(r.team1Dragons), num(r.team2Dragons)],
      barons: [num(r.team1Barons), num(r.team2Barons)],
      inhibitors: [num(r.team1Inhibitors), num(r.team2Inhibitors)],
    },
    picks: [split(r.team1Picks), split(r.team2Picks)],
    bans: [split(r.team1Bans), split(r.team2Bans)],
  }));
}

/**
 * Get end-of-game player stats for the same games (both sides).
 * Returns { [gameId]: [{ team, role, champion, kills, deaths, assists, gold, cs }] }
 */
export async function getPlayerStats(teamNames) {
  const list = teamNames.map(quote).join(',');
  const rows = await cargoQuery({
    tables: 'ScoreboardPlayers=SP',
    fields: 'SP.GameId=gameId,SP.Team=team,SP.Role=role,SP.Champion=champion,SP.Kills=kills,SP.Deaths=deaths,SP.Assists=assists,SP.Gold=gold,SP.CS=cs',
    where: `SP.DateTime_UTC >= ${quote(WINDOW_START)} AND (SP.Team IN (${list}) OR SP.TeamVs IN (${list}))`,
  });

  const byGame = {};
  for (const r of rows) {
    (byGame[r.gameId] ??= []).push({
      team: r.team,
      role: r.role,
      champion: r.champion,
      kills: Number(r.kills),
      deaths: Number(r.deaths),
      assists: Number(r.assists),
      gold: Number(r.gold),
      cs: Number(r.cs),
    });
  }
  return byGame;
}
