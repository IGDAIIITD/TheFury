// Full-schema verification: all migrations + seed, then RLS / privilege / flow checks.
// Run: cd supabase/tests && npm ci && npm test
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { boot, signUp, as, check, done, REPO } from './harness.mjs'

const db = await boot()
const q = async (sql, p = []) => (await db.query(sql, p)).rows

const BEARS = '11111111-1111-4111-8111-111111111101'
const SHIVAN = '33333333-3333-4333-9333-333333333331'
const LOTUS = 'a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a'
const MOX = 'e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c'

const alice = await signUp(db, 'alice@campus.edu', { display_name: 'Alice', degree_level: 'BTECH', specialization: 'CSE' })
const bob = await signUp(db, 'bob@campus.edu', { display_name: 'Bob' })
const admin = await signUp(db, 'admin@campus.edu', { display_name: 'Admin' })
await db.query(`update public.profiles set role = 'ADMIN' where id = $1`, [admin])

console.log('\n# idempotency')
{
  const mig = join(REPO, 'supabase/migrations')
  const idem = readdirSync(mig).filter((f) => f >= '20260924000011').sort()
  let ok = true
  for (const f of idem) {
    try { await db.exec(readFileSync(join(mig, f), 'utf8')) } catch (e) { ok = false; console.log('   ', f, e.message) }
  }
  check('migrations 11+ re-run cleanly', ok)
}

console.log('\n# function privileges')
for (const [sig, args] of [
  ['apply_claim', `'X', '${bob}'`],
  ['record_match_result', `gen_random_uuid(), null`],
  ['add_feed_entry', `'SPAWN', 'spam'`],
  ['ensure_print_claim', `'${BEARS}', 'X', 'Y'`],
  ['card_print_core', `'${BEARS}'`],
  ['validate_deck', `gen_random_uuid()`],
  ['sweep_achievements', `'${bob}'`],
  ['grant_starter_pack', `'${bob}'`],
]) {
  for (const role of ['anon', 'authenticated']) {
    const r = await as(db, role, role === 'anon' ? null : alice, `select public.${sig}(${args})`)
    check(`${role} cannot execute ${sig}`, !r.ok && /permission denied/.test(r.error), r.error)
  }
}
for (const fn of ['leaderboard_full()', 'my_profile_stats()', 'list_my_trades()', 'search_players()']) {
  const r = await as(db, 'anon', null, `select public.${fn}`)
  check(`anon cannot execute ${fn}`, !r.ok && /permission denied/.test(r.error), r.error)
}
{
  const r = await as(db, 'authenticated', alice, `select public.leaderboard_full() as l, public.my_profile_stats() as s, public.list_my_trades() as t, public.achievement_catalog()`)
  check('authenticated can call the PWA RPC surface', r.ok, r.error)
}
{
  const r = await as(db, 'anon', null, `select count(*)::int as n from public.cards`)
  check('anon can still read the card catalog (RLS helper grants intact)', r.ok && r.rows[0].n > 90, r.error)
}

console.log('\n# profiles guard')
{
  let r = await as(db, 'authenticated', alice, `update public.profiles set role = 'ADMIN' where id = $1`, [alice])
  check('player cannot self-promote to ADMIN', !r.ok && /may only edit/.test(r.error), r.error)
  r = await as(db, 'authenticated', alice, `update public.profiles set experience = 99999 where id = $1`, [alice])
  check('player cannot grant self XP', !r.ok, r.error)
  await db.query(`update public.profiles set banned = true where id = $1`, [bob])
  r = await as(db, 'authenticated', bob, `update public.profiles set banned = false where id = $1`, [bob])
  check('banned player cannot un-ban self', !r.ok, r.error)
  await db.query(`update public.profiles set banned = false where id = $1`, [bob])
  r = await as(db, 'authenticated', alice, `update public.profiles set level = 50 where id = $1 returning level`, [alice])
  check('level is always derived from XP', r.ok && r.rows[0].level === 1, JSON.stringify(r))
  r = await as(db, 'authenticated', alice, `update public.profiles set display_name = 'Alice B', degree_level = 'MTECH', specialization = 'ECE', onboarding_seen = true, last_login = now() where id = $1 returning display_name`, [alice])
  check('player can edit own presentation/cohort fields', r.ok && r.rows[0].display_name === 'Alice B', r.error)
  r = await as(db, 'authenticated', alice, `update public.profiles set display_name = 'x' where id = $1`, [bob])
  check("player cannot edit someone else's row (0 rows)", r.ok && r.affected === 0, JSON.stringify(r))
  r = await as(db, 'authenticated', admin, `update public.profiles set banned = true, banned_at = now() where id = $1 returning banned`, [bob])
  check('admin can ban', r.ok && r.rows[0].banned === true, r.error)
  await db.query(`update public.profiles set banned = false, banned_at = null where id = $1`, [bob])
}

console.log('\n# direct-write RLS holes closed')
for (const [name, sql] of [
  ['insert own unlock', `insert into public.player_unlocks (id, player_id, card_id) values (gen_random_uuid(), '${alice}', '${SHIVAN}')`],
  ['insert own discovery', `insert into public.discoveries (id, player_id, card_id, count) values (gen_random_uuid(), '${alice}', '${SHIVAN}', 999)`],
  ['insert own achievement', `insert into public.player_achievements (id, player_id, code) values (gen_random_uuid(), '${alice}', 'HALL_OF_FAME')`],
  ['insert trade directly', `insert into public.trades (id, sender_id, receiver_id) values (gen_random_uuid(), '${alice}', '${bob}')`],
  ['insert game_log', `insert into public.game_log (kind, player_id, xp) values ('CLAIM', '${alice}', 1000)`],
]) {
  const r = await as(db, 'authenticated', alice, sql)
  check(`player cannot ${name}`, !r.ok, 'unexpectedly succeeded')
}
{
  const r = await as(db, 'authenticated', alice, `delete from public.player_unlocks where player_id = $1`, [alice])
  check('player cannot delete own unlocks (re-scan XP farm)', r.ok && r.affected === 0, JSON.stringify(r))
}

console.log('\n# claim flow (service role, as the claim Edge Function)')
{
  const core = (await q(`select public.card_print_core($1) as c`, [SHIVAN]))[0].c
  await q(`select public.ensure_print_claim($1, $2, $3)`, [SHIVAN, core, `V1.${core}.SIG`])
  let r = await as(db, 'service_role', null, `select public.apply_claim($1, $2) as res`, [core, alice])
  check('service role applies claim', r.ok && r.rows[0].res.unlocked === true && r.rows[0].res.experienceAwarded === 10, r.error)
  r = await as(db, 'service_role', null, `select public.apply_claim($1, $2) as res`, [core, alice])
  check('re-scan gives no XP', r.ok && r.rows[0].res.alreadyOwned === true && r.rows[0].res.experienceAwarded === 0, r.error)
  const log = await q(`select count(*)::int as n, sum(xp)::int as xp from public.game_log where kind = 'CLAIM' and player_id = $1`, [alice])
  check('claims are logged durably in game_log', log[0].n === 2 && log[0].xp === 10, JSON.stringify(log))
  const own = await as(db, 'authenticated', alice, `select count(*)::int as n from public.game_log`)
  const other = await as(db, 'authenticated', bob, `select count(*)::int as n from public.game_log where player_id = '${alice}'`)
  check('game_log readable by owner only', own.rows[0].n >= 2 && other.rows[0].n === 0, JSON.stringify([own, other]))
  await q(`update public.profiles set banned = true where id = $1`, [bob])
  r = await as(db, 'service_role', null, `select public.apply_claim($1, $2)`, [core, bob])
  check('banned player cannot claim', !r.ok && r.code === 'CF403', r.error)
  await q(`update public.profiles set banned = false where id = $1`, [bob])
}

console.log('\n# trades')
{
  const aLotus = '00000000-0000-4000-8000-00000000a001'
  const bMox = '00000000-0000-4000-8000-00000000b001'
  await q(`insert into public.unique_cards (physical_uuid, owner_id, card_id, serial_number) values ($1, $2, $3, 1), ($4, $5, $6, 1)`, [aLotus, alice, LOTUS, bMox, bob, MOX])
  let r = await as(db, 'anon', null, `select public.create_trade('${bob}', array['${aLotus}']::uuid[], array['${bMox}']::uuid[])`)
  check('anon cannot create trades', !r.ok)
  r = await as(db, 'authenticated', alice, `select public.create_trade($1, array[$2]::uuid[], array[$3]::uuid[]) as id`, [bob, aLotus, bMox])
  check('alice creates trade', r.ok, r.error)
  const tradeId = r.rows?.[0]?.id
  r = await as(db, 'authenticated', alice, `update public.trades set status = 'ACCEPTED' where id = $1`, [tradeId])
  check('sender cannot flip status directly', r.ok && r.affected === 0, JSON.stringify(r))
  r = await as(db, 'authenticated', alice, `select public.accept_trade($1)`, [tradeId])
  check('sender cannot accept own trade', !r.ok && r.code === 'CF403', r.error)
  r = await as(db, 'service_role', null, `select public.accept_trade($1)`, [tradeId])
  check('no-user caller cannot accept (NULL actor guard)', !r.ok && r.code === 'CF401', r.error)
  r = await as(db, 'authenticated', bob, `select count(*)::int as n from public.trades where id = $1`, [tradeId])
  check('receiver sees the trade via RLS (realtime visibility)', r.ok && r.rows[0].n === 1)
  r = await as(db, 'authenticated', bob, `select public.accept_trade($1) as s`, [tradeId])
  check('receiver accepts', r.ok && r.rows[0].s === 'ACCEPTED', r.error)
  const owners = await q(`select physical_uuid, owner_id from public.unique_cards where physical_uuid in ($1, $2) order by physical_uuid`, [aLotus, bMox])
  check('owners swapped', owners[0].owner_id === bob && owners[1].owner_id === alice, JSON.stringify(owners))
  const tl = await q(`select count(*)::int as n from public.game_log where kind = 'TRADE' and ref_id = $1`, [tradeId])
  check('trade logged for both parties', tl[0].n === 2)
  const pub = await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)
  check('realtime publishes activity_feed + app_config + trades', pub.map((x) => x.tablename).join() === 'activity_feed,app_config,trades', JSON.stringify(pub))
}

console.log('\n# stats / analytics')
{
  let r = await as(db, 'authenticated', alice, `select public.my_profile_stats($1)`, [bob])
  check("player cannot read another player's stats/email", !r.ok && r.code === 'CF403', r.error)
  r = await as(db, 'authenticated', admin, `select public.my_profile_stats($1)->'player'->>'email' as e`, [bob])
  check('admin can read any stats', r.ok && r.rows[0].e === 'bob@campus.edu', r.error)
  r = await as(db, 'authenticated', alice, `select public.my_profile_stats() as s`)
  check('own stats include favorite colors', r.ok && Array.isArray(r.rows[0].s.favoriteColors), r.error)
  r = await as(db, 'anon', null, `select count(*)::int as n from public.activity_feed`)
  check('anon cannot read the feed', r.ok && r.rows[0].n === 0, JSON.stringify(r))
  r = await as(db, 'authenticated', bob, `select count(*)::int as n from public.activity_feed`)
  check('signed-in players read the feed', r.ok && r.rows[0].n > 0, JSON.stringify(r))
}

console.log('\n# app_config (public runtime settings)')
{
  const KEY = `key = 'battle_engine_url'`
  let r = await as(db, 'anon', null, `select value from public.app_config where ${KEY}`)
  check('anon can read the battle engine URL row', r.ok && r.rows.length === 1, JSON.stringify(r))
  r = await as(db, 'anon', null, `update public.app_config set value = 'https://evil.example' where ${KEY}`)
  check('anon cannot change it', !r.ok || r.affected === 0, JSON.stringify(r))
  r = await as(db, 'authenticated', alice, `update public.app_config set value = 'https://evil.example' where ${KEY}`)
  check('players cannot change it', r.ok && r.affected === 0, JSON.stringify(r))
  r = await as(db, 'service_role', null, `insert into public.app_config (key, value) values ('battle_engine_url', 'https://a-b-c.trycloudflare.com') on conflict (key) do update set value = excluded.value returning value`)
  check('service role (start-public.ps1) can publish the URL', r.ok && r.rows[0].value === 'https://a-b-c.trycloudflare.com', JSON.stringify(r))
  r = await as(db, 'authenticated', admin, `update public.app_config set value = null where ${KEY} returning value`)
  check('admins can clear it', r.ok && r.rows[0].value === null, JSON.stringify(r))
}

console.log('\n# battle-engine RPCs (service role)')
{
  const bobDeck = (await q(`select id from public.decks where player_id = $1 limit 1`, [bob]))[0]?.id
  const aliceDeck = (await q(`select id from public.decks where player_id = $1 limit 1`, [alice]))[0]?.id
  const emptyDeck = crypto.randomUUID()
  await q(`insert into public.decks (id, player_id, name, format_code) values ($1, $2, 'empty', 'STANDARD')`, [emptyDeck, alice])
  let r = await as(db, 'service_role', null, `select code from public.validate_deck($1)`, [emptyDeck])
  check('validate_deck flags an empty deck', r.ok && r.rows.some((x) => x.code === 'NOT_ENOUGH_CARDS'), JSON.stringify(r))
  r = await as(db, 'service_role', null, `select code, message from public.validate_deck($1)`, [aliceDeck])
  check('starter deck passes battle-time validation', r.ok && r.rows.length === 0, JSON.stringify(r))

  const matchId = crypto.randomUUID()
  await q(`insert into public.matches (id, player1_id, player2_id, deck1_id, deck2_id, status) values ($1, $2, $3, $4, $5, 'ACTIVE')`, [matchId, alice, bob, aliceDeck, bobDeck])
  r = await as(db, 'service_role', null, `select public.record_match_result($1, $2, 'Life')`, [matchId, admin])
  check('winner must be a participant', !r.ok && r.code === 'CF400', r.error)
  const xpBefore = (await q(`select experience from public.profiles where id = $1`, [bob]))[0].experience
  r = await as(db, 'service_role', null, `select public.record_match_result($1, $2, 'Life')`, [matchId, bob])
  const xpAfter = (await q(`select experience from public.profiles where id = $1`, [bob]))[0].experience
  check('match result awards 50 XP', r.ok && Number(xpAfter) - Number(xpBefore) === 50, r.error)
  const ml = await q(`select detail->>'result' as res from public.game_log where kind = 'MATCH' and ref_id = $1 order by res`, [matchId])
  check('match logged for both players', ml.map((x) => x.res).join() === 'LOSS,WIN', JSON.stringify(ml))
  r = await as(db, 'authenticated', alice, `select * from public.popular_decks(10)`)
  check('popular_decks aggregates across all players (definer)', r.ok && r.rows.length === 1 && Number(r.rows[0].play_count) === 2, JSON.stringify(r.rows))
}

console.log('\n# starter pack')
{
  const RED = ['Raging Goblin', 'Goblin Piker', 'Vulshok Berserker', 'Hill Giant', 'Fire Elemental']
  const GREEN = ['Grizzly Bears', 'Elvish Warrior', 'Trained Armodon', 'War Mammoth', 'Craw Wurm']
  const starters = await q(`select forge_name, colors, types, ownership_type from public.cards where forge_name = any($1)`, [[...RED, ...GREEN]])
  check('the 10 starter creatures exist and are UNLIMITED (infinite copies)', starters.length === 10 && starters.every((x) => x.ownership_type === 'UNLIMITED'), JSON.stringify(starters.map((x) => x.ownership_type)))
  check('5 red + 5 green, all creatures', starters.filter((x) => x.colors === 'R').length === 5 && starters.filter((x) => x.colors === 'G').length === 5 && starters.every((x) => /Creature/.test(x.types)))
  const col = await as(db, 'authenticated', bob, `select public.validate_deck_spec('STANDARD', null, (select jsonb_agg(jsonb_build_object('cardId', id, 'quantity', 4)) from public.cards where forge_name = any($1)) || jsonb_build_array(jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Forest'), 'quantity', 20))) as v`, [[...RED, ...GREEN]])
  check('any player can build 4x of every starter creature', col.ok && col.rows[0].v.valid === true, JSON.stringify(col.rows?.[0]?.v ?? col.error))
  const five = await as(db, 'authenticated', bob, `select public.validate_deck_spec('STANDARD', null, jsonb_build_array(jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Grizzly Bears'), 'quantity', 5), jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Forest'), 'quantity', 55))) as v`)
  check('format rule still caps non-basics at 4 per deck', five.ok && five.rows[0].v.problems.some((p) => p.code === 'TOO_MANY_COPIES'), JSON.stringify(five.rows?.[0]?.v))
  const deck = await q(`select d.name, d.format_code, sum(dc.quantity)::int as n from public.decks d join public.deck_cards dc on dc.deck_id = d.id where d.player_id = $1 group by 1, 2`, [bob])
  check('starter deck is a legal 60-card STANDARD deck', deck.length === 1 && deck[0].n === 60 && deck[0].format_code === 'STANDARD', JSON.stringify(deck))
  const comp = await q(`select c.forge_name, dc.quantity from public.deck_cards dc join public.decks d on d.id = dc.deck_id join public.cards c on c.id = dc.card_id where d.player_id = $1 order by 1`, [bob])
  check('starter deck = 4x each creature + 10 Mountain + 10 Forest', comp.length === 12 && comp.every((x) => ['Mountain', 'Forest'].includes(x.forge_name) ? x.quantity === 10 : x.quantity === 4), JSON.stringify(comp))
  const r = await as(db, 'authenticated', bob, `select public.validate_deck_spec('STANDARD', null, (select jsonb_agg(jsonb_build_object('cardId', card_id, 'quantity', quantity)) from public.deck_cards where deck_id = (select id from public.decks where player_id = '${bob}' and name = 'Red-Green Starter'))) as v`)
  check('starter deck passes the deck-builder validator', r.ok && r.rows[0].v.valid === true, JSON.stringify(r.rows?.[0]?.v ?? r.error))
  const coh = await q(`select degree_level, specialization from public.profiles where id = $1`, [alice])
  check('signup copies a valid cohort from metadata', coh[0].degree_level !== null)
  const x = await signUp(db, 'weird@campus.edu', { degree_level: 'BTECH', specialization: 'NOPE' })
  const xc = await q(`select degree_level, (select count(*)::int from public.decks where player_id = $1) as n from public.profiles where id = $1`, [x])
  check('invalid cohort metadata does not block signup', xc[0].degree_level === null && xc[0].n === 1, JSON.stringify(xc))
  await q(`select public.grant_starter_pack($1)`, [bob])
  const again = await q(`select count(*)::int as n from public.decks where player_id = $1`, [bob])
  check('starter grant is idempotent', again[0].n === 1, JSON.stringify(again))
  const sl = await q(`select count(*)::int as n from public.game_log where kind = 'STARTER' and player_id = $1`, [bob])
  check('starter grant logged once', sl[0].n === 1, JSON.stringify(sl))
}

done()
