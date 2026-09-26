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

console.log('\n# imported set: M19 (seed_sets/m19.sql)')
{
  const n = async () => (await q(`select count(*)::int as n from public.cards`))[0].n
  const total = await n()
  check('catalog = 104 base cards + 253 new M19 cards', total === 357, String(total))
  const dups = await q(`select lower(forge_name) as name, count(*)::int as n from public.cards group by 1 having count(*) > 1`)
  check('no duplicate card names', dups.length === 0, JSON.stringify(dups))
  const own = async (name) => (await q(`select ownership_type, commander_eligible from public.cards where forge_name = $1`, [name]))[0]
  check('M19 common → UNLIMITED', (await own('Skeleton Archer'))?.ownership_type === 'UNLIMITED')
  check('M19 rare → UNLOCK', (await own('Cleansing Nova'))?.ownership_type === 'UNLOCK')
  const bolas = await own('Nicol Bolas, the Ravager')
  check('M19 mythic → UNIQUE, legendary creature is commander-eligible', bolas?.ownership_type === 'UNIQUE' && bolas.commander_eligible === true, JSON.stringify(bolas))
  check('existing catalog cards keep their ownership (Cancel stays UNLOCK)', (await own('Cancel'))?.ownership_type === 'UNLOCK')
  const noArt = await q(`select count(*)::int as n from public.cards where set_code = 'M19' and forge_name like '% // %'`)
  check('double-faced cards use their front-face name (what Forge loads)', noArt[0].n === 0)
  await db.exec(readFileSync(join(REPO, 'supabase/seed_sets/m19.sql'), 'utf8'))
  check('set import is idempotent', (await n()) === total)

  // a mythic is one-of: first scan wins the serialized copy, the next player is refused
  const bolasId = (await q(`select id from public.cards where forge_name = 'Nicol Bolas, the Ravager'`))[0].id
  const core = (await q(`select public.card_print_core($1) as c`, [bolasId]))[0].c
  await q(`select public.ensure_print_claim($1, $2, $3)`, [bolasId, core, `V1.${core}.SIG`])
  let r = await as(db, 'service_role', null, `select public.apply_claim($1, $2) as res`, [core, alice])
  check('first scan of a UNIQUE M19 card claims serial #1', r.ok && r.rows[0].res.unlocked === true, r.error)
  r = await as(db, 'service_role', null, `select public.apply_claim($1, $2)`, [core, bob])
  check('a second player cannot claim the same unique', !r.ok && r.code === 'CF409', r.error)
  const serial = await q(`select owner_id, serial_number from public.unique_cards where card_id = $1`, [bolasId])
  check('exactly one owner, serial 1', serial.length === 1 && serial[0].owner_id === alice && serial[0].serial_number === 1, JSON.stringify(serial))

  // UNLIMITED commons outside the base 15 are locked until scanned once, then unlimited
  const locked = await q(`select count(*) filter (where requires_unlock)::int as locked,
                                 count(*) filter (where ownership_type = 'UNLIMITED' and not requires_unlock)::int as free
                            from public.cards`)
  check('104 imported commons are scan-to-unlock; only the base 15 UNLIMITED cards are free',
    locked[0].locked === 104 && locked[0].free === 15, JSON.stringify(locked))
  const dave = await signUp(db, 'dave@campus.edu', { display_name: 'Dave' })
  const archerDeck = () => as(db, 'authenticated', dave, `select public.validate_deck_spec('STANDARD', null, jsonb_build_array(
      jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Skeleton Archer'), 'quantity', 4),
      jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Swamp'), 'quantity', 56))) as v`)
  r = await archerDeck()
  check('before scanning, an imported common is not owned', r.ok && r.rows[0].v.problems.some((p) => p.code === 'NOT_OWNED'),
    JSON.stringify(r.rows?.[0]?.v ?? r.error))
  const archer = (await q(`select id from public.cards where forge_name = 'Skeleton Archer'`))[0].id
  await q(`select public.ensure_print_claim($1, 'ARCHERCODE01', 'V1.ARCHERCODE01.SIG')`, [archer])
  await q(`select public.ensure_print_claim($1, 'ARCHERCODE02', 'V1.ARCHERCODE02.SIG')`, [archer])
  r = await as(db, 'service_role', null, `select public.apply_claim('ARCHERCODE01', $1) as res`, [dave])
  check('first scan unlocks it (+10 XP)', r.ok && r.rows[0].res.unlocked === true && r.rows[0].res.experienceAwarded === 10,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))
  r = await archerDeck()
  check('…and one scan gives unlimited copies (4x legal)', r.ok && r.rows[0].v.valid === true, JSON.stringify(r.rows?.[0]?.v ?? r.error))
  r = await as(db, 'service_role', null, `select public.apply_claim('ARCHERCODE02', $1) as res`, [dave])
  check('further scans (any code) are discovery-only (UNLIMITED)',
    r.ok && r.rows[0].res.unlocked === false && r.rows[0].res.reason === 'UNLIMITED' && r.rows[0].res.experienceAwarded === 0,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))
  const stats = (await as(db, 'authenticated', dave, `select public.my_profile_stats() as s`)).rows[0].s
  check('collection % counts only free + unlocked cards (15 base + 1 unlocked)', stats.ownedCards === 16 && stats.totalCards === 357,
    JSON.stringify([stats.ownedCards, stats.totalCards]))
  check('a new player no longer gets Collector I for free', !stats.badges.some((b) => b.code === 'COLLECTOR_I'), JSON.stringify(stats.badges))
  r = await as(db, 'service_role', null, `select public.validate_deck(id) as p from public.decks where player_id = $1 and name = 'Red-Green Starter'`, [dave])
  check('the starter deck (base 15 only) still passes battle validation', r.ok && r.rows.every((x) => x.p === null) , JSON.stringify(r.rows ?? r.error))
}

console.log('\n# multi-copy unlocks: 4 different codes = 4 copies')
{
  const carol = await signUp(db, 'carol@campus.edu', { display_name: 'Carol' })
  const nova = (await q(`select id from public.cards where forge_name = 'Cleansing Nova'`))[0].id
  const cores = ['NOVACOPY0001', 'NOVACOPY0002', 'NOVACOPY0003', 'NOVACOPY0004', 'NOVACOPY0005']
  for (const core of cores) await q(`select public.ensure_print_claim($1, $2, $3)`, [nova, core, `V1.${core}.SIG`])
  const scan = async (core, player = carol) => as(db, 'service_role', null, `select public.apply_claim($1, $2) as res`, [core, player])
  const copies = async (player = carol) =>
    (await q(`select count(*)::int as n from public.player_unlocks where player_id = $1 and card_id = $2`, [player, nova]))[0].n

  const results = []
  for (const core of cores.slice(0, 4)) results.push((await scan(core)).rows?.[0]?.res)
  check('four different codes → copies 1, 2, 3, 4', results.map((r) => r?.copiesOwned).join() === '1,2,3,4' && (await copies()) === 4,
    JSON.stringify(results.map((r) => r && [r.unlocked, r.copiesOwned, r.reason])))
  check('each new copy is worth 10 XP; the result reports maxCopies 4',
    results.every((r) => r.unlocked && r.experienceAwarded === 10 && r.maxCopies === 4))

  let r = await scan(cores[1])
  check('rescanning a code you already used adds nothing (SAME_CODE)',
    r.ok && r.rows[0].res.unlocked === false && r.rows[0].res.reason === 'SAME_CODE' && r.rows[0].res.experienceAwarded === 0 && (await copies()) === 4,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))
  r = await scan(cores[4])
  check('a fifth code adds nothing (MAX_COPIES)', r.ok && r.rows[0].res.reason === 'MAX_COPIES' && (await copies()) === 4,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))

  r = await scan(cores[0], bob)
  check("codes stay reusable: another player gets their own first copy", r.ok && r.rows[0].res.copiesOwned === 1 && (await copies(bob)) === 1,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))

  const deck = (qty) => as(db, 'authenticated', carol, `select public.validate_deck_spec('STANDARD', null, jsonb_build_array(
      jsonb_build_object('cardId', $1::uuid, 'quantity', ${qty}),
      jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Plains'), 'quantity', ${60 - qty}))) as v`, [nova])
  r = await deck(4)
  check('4 owned copies → 4 in a deck is legal', r.ok && r.rows[0].v.valid === true, JSON.stringify(r.rows?.[0]?.v ?? r.error))
  r = await as(db, 'authenticated', bob, `select public.validate_deck_spec('STANDARD', null, jsonb_build_array(
      jsonb_build_object('cardId', $1::uuid, 'quantity', 2),
      jsonb_build_object('cardId', (select id from public.cards where forge_name = 'Plains'), 'quantity', 58))) as v`, [nova])
  check('1 owned copy → 2 in a deck is rejected (NOT_ENOUGH_COPIES)',
    r.ok && r.rows[0].v.problems.some((p) => p.code === 'NOT_ENOUGH_COPIES'), JSON.stringify(r.rows?.[0]?.v))

  const log = await q(`select detail->>'reason' as reason, xp from public.game_log where kind = 'CLAIM' and player_id = $1 order by id`, [carol])
  check('every scan is logged with its outcome', log.length === 6 && log.filter((x) => Number(x.xp) === 10).length === 4, JSON.stringify(log))

  // unique cards: one serial per player via scanning, and the code isn't burned
  const bolas = (await q(`select id from public.cards where forge_name = 'Nicol Bolas, the Ravager'`))[0].id
  await q(`select public.ensure_print_claim($1, 'BOLASCOPY002', 'V1.BOLASCOPY002.SIG')`, [bolas])
  r = await scan('BOLASCOPY002', alice) // alice already holds serial #1 (M19 section)
  const status = (await q(`select status from public.claims where token_core = 'BOLASCOPY002'`))[0].status
  check('owning a unique card blocks claiming a 2nd serial, without consuming the code',
    !r.ok && r.code === 'CF409' && status === 'ACTIVE', JSON.stringify([r.error, status]))
  r = await scan('BOLASCOPY002', bob)
  check('…so another player can still claim it (serial #2)', r.ok && r.rows[0].res.unlocked === true,
    JSON.stringify(r.rows?.[0]?.res ?? r.error))
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

  // open-battle feed, campus history, personal history (migration 20)
  const fresh = crypto.randomUUID()
  const stale = crypto.randomUUID()
  const cancelled = crypto.randomUUID()
  await q(`insert into public.matches (id, player1_id, deck1_id, status, battle_code, created_at) values
           ($1, $4, $5, 'WAITING', 'FRESH1', now() - interval '30 seconds'),
           ($2, $4, $5, 'WAITING', 'STALE1', now() - interval '5 minutes'),
           ($3, $4, $5, 'CANCELLED', 'GONE01', now())`, [fresh, stale, cancelled, alice, aliceDeck])
  r = await as(db, 'anon', null, `select * from public.open_lobbies()`)
  check('anon cannot list open lobbies', !r.ok, r.error)
  r = await as(db, 'authenticated', bob, `select battle_code, host_name, mine, expires_at > now() as live from public.open_lobbies()`)
  check('open_lobbies: only WAITING lobbies under 2 minutes, with host name and code', r.ok && r.rows.length === 1 && r.rows[0].battle_code === 'FRESH1' && r.rows[0].host_name.startsWith('Alice') && r.rows[0].mine === false && r.rows[0].live, JSON.stringify(r.rows ?? r.error))
  r = await as(db, 'authenticated', alice, `select mine from public.open_lobbies()`)
  check('open_lobbies marks your own lobby', r.ok && r.rows[0]?.mine === true, JSON.stringify(r.rows ?? r.error))

  r = await as(db, 'authenticated', admin, `select winner_name, loser_name from public.recent_battles(10)`)
  check('recent_battles: anyone signed in sees who beat whom', r.ok && r.rows.length === 1 && r.rows[0].winner_name === 'Bob' && r.rows[0].loser_name.startsWith('Alice'), JSON.stringify(r.rows ?? r.error))
  const botMatch = crypto.randomUUID()
  await q(`insert into public.matches (id, player1_id, deck1_id, status, winner_id, ended_at) values ($1, $2, $3, 'FINISHED', null, now())`, [botMatch, alice, aliceDeck])
  r = await as(db, 'authenticated', admin, `select winner_name, loser_name from public.recent_battles(1)`)
  check('recent_battles: a bot win reads "Campus Bot beat <player>"', r.ok && r.rows[0].winner_name === 'Campus Bot' && r.rows[0].loser_name.startsWith('Alice'), JSON.stringify(r.rows ?? r.error))

  r = await as(db, 'authenticated', bob, `select match_id, result, xp from public.my_match_history(10)`)
  const bobHist = r.rows ?? []
  check('my_match_history: winner sees WON +50 XP', r.ok && bobHist.some((x) => x.match_id === matchId && x.result === 'WON' && Number(x.xp) === 50), JSON.stringify(bobHist))
  check('my_match_history: only your own matches', bobHist.every((x) => x.match_id === matchId), JSON.stringify(bobHist))
  r = await as(db, 'authenticated', alice, `select match_id, result, xp from public.my_match_history(20)`)
  const byId = Object.fromEntries((r.rows ?? []).map((x) => [x.match_id, x]))
  check('my_match_history: loser sees LOST +0 XP', byId[matchId]?.result === 'LOST' && Number(byId[matchId]?.xp) === 0, JSON.stringify(byId[matchId]))
  check('my_match_history: stale waiting lobby reads EXPIRED, host-closed reads CANCELLED, fresh reads WAITING',
    byId[stale]?.result === 'EXPIRED' && byId[cancelled]?.result === 'CANCELLED' && byId[fresh]?.result === 'WAITING', JSON.stringify([byId[stale], byId[cancelled], byId[fresh]]))
  r = await as(db, 'anon', null, `select * from public.my_match_history(10)`)
  check('anon cannot read match history', !r.ok, r.error)
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

console.log('\n# student roster + roll-number accounts')
{
  await q(`insert into public.students (roll_no, name, program, batch) values
           ('2026001', 'Aadi Dhariwal', 'CSE', 2026), ('2026295', 'Mohd Rehan', 'ECE', 2026), ('2026777', 'Test Player', 'CSECON', 2026)
           on conflict do nothing`)
  let r = await as(db, 'anon', null, `select * from public.students`)
  check('anon cannot read the roster', !r.ok, r.error)
  r = await as(db, 'authenticated', bob, `select * from public.students`)
  check('players cannot read the roster', r.ok && r.rows.length === 0, JSON.stringify(r.rows ?? r.error))
  r = await as(db, 'authenticated', admin, `select count(*)::int as n from public.students`)
  check('admins can read the roster', r.ok && r.rows[0].n === 3, JSON.stringify(r.rows ?? r.error))
  for (const role of ['anon', 'authenticated']) {
    r = await as(db, role, role === 'anon' ? null : bob, `select public.student_roll_status('2026001', 'Aadi')`)
    check(`${role} cannot call student_roll_status`, !r.ok, r.error)
  }
  const status = async (roll, first) =>
    (await as(db, 'service_role', null, `select public.student_roll_status($1, $2) as s`, [roll, first])).rows[0].s
  check('unknown roll -> NOT_FOUND', (await status('9999999', 'Aadi')).status === 'NOT_FOUND')
  const wrong = await status('2026001', 'Aarav')
  check('wrong first name -> NAME_MISMATCH, no name leaked', wrong.status === 'NAME_MISMATCH' && !wrong.name, JSON.stringify(wrong))
  const ok = await status(' 2026001 ', '  aadi ')
  check('first name matches case-insensitively -> NEW with roster data', ok.status === 'NEW' && ok.name === 'Aadi Dhariwal' && ok.program === 'CSE', JSON.stringify(ok))
  check('any word of the roster name matches ("Rehan" for "Mohd Rehan")', (await status('2026295', 'Rehan')).status === 'NEW')
  check('single letters never match', (await status('2026295', 'R')).status === 'NAME_MISMATCH')

  const squatter = await signUp(db, '2026001@roll.thefury.invalid', { roll_no: '2026001', display_name: 'Squatter' })
  const sq = await q(`select roll_no, display_name from public.profiles where id = $1`, [squatter])
  check('user metadata cannot claim a roll (public sign-up)', sq[0].roll_no === null && sq[0].display_name === 'Squatter', JSON.stringify(sq))
  check('roll still NEW after the squat attempt', (await status('2026001', 'Aadi')).status === 'NEW')

  const aadi = await signUp(db, '2026001@students.thefury', { display_name: 'ignored' }, { roll_no: '2026001' })
  const p = (await q(`select display_name, degree_level, specialization, student_id, roll_no from public.profiles where id = $1`, [aadi]))[0]
  check('roll sign-up fills the profile from the roster', p.display_name === 'Aadi Dhariwal' && p.degree_level === 'BTECH' && p.specialization === 'CSE' && p.student_id === '2026001' && p.roll_no === '2026001', JSON.stringify(p))
  check('roll sign-up still gets the starter deck', (await q(`select count(*)::int as n from public.decks where player_id = $1`, [aadi]))[0].n === 1)
  check('roll becomes REGISTERED', (await status('2026001', 'Aadi')).status === 'REGISTERED')
  const econ = await signUp(db, '2026777@students.thefury', {}, { roll_no: '2026777' })
  check('CSEcon roster entries map to the CSECON cohort', (await q(`select specialization from public.profiles where id = $1`, [econ]))[0].specialization === 'CSECON')
  let dup = true
  try { await signUp(db, 'other@students.thefury', {}, { roll_no: '2026001' }) } catch { dup = false }
  check('a roll can only have one account', !dup)
  const ghost = await signUp(db, 'ghost@students.thefury', {}, { roll_no: '1234567' })
  check('unknown app_metadata roll is ignored, not linked', (await q(`select roll_no from public.profiles where id = $1`, [ghost]))[0].roll_no === null)

  // GoTrue's admin createUser inserts the user first and sets app_metadata in a follow-up UPDATE.
  const rehan = await signUp(db, '2026295@students.thefury', { display_name: 'Mohd Rehan' })
  check('before app_metadata arrives the account is unlinked', (await q(`select roll_no from public.profiles where id = $1`, [rehan]))[0].roll_no === null)
  await q(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"roll_no":"2026295"}' where id = $1`, [rehan])
  const rp = (await q(`select display_name, specialization, student_id, roll_no from public.profiles where id = $1`, [rehan]))[0]
  check('app_metadata set by a later UPDATE still links the roster (GoTrue order)', rp.roll_no === '2026295' && rp.specialization === 'ECE' && rp.student_id === '2026295' && rp.display_name === 'Mohd Rehan', JSON.stringify(rp))
  let clash = true
  try { await q(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"roll_no":"2026295"}' where id = $1`, [ghost]) } catch { clash = false }
  check('linking a roll that another account holds fails (rolls back createUser)', !clash)
  await q(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"roll_no":"2026001"}', email = 'x@y' where id = $1`, [rehan])
  check('a later change never re-links an already linked account', (await q(`select roll_no from public.profiles where id = $1`, [rehan]))[0].roll_no === '2026295')

  r = await as(db, 'authenticated', aadi, `update public.profiles set display_name = 'Aadi D' where id = $1`, [aadi])
  check('roll players can still rename themselves', r.ok && r.affected === 1, r.error)
  for (const [col, val] of [['roll_no', '2026295'], ['student_id', '2026999'], ['specialization', 'ECE']]) {
    r = await as(db, 'authenticated', aadi, `update public.profiles set ${col} = $2 where id = $1`, [aadi, val])
    check(`roll players cannot change ${col}`, !r.ok && r.code === '42501', r.error)
  }
  r = await as(db, 'authenticated', bob, `update public.profiles set roll_no = '2026295' where id = $1`, [bob])
  check('email players cannot attach a roll', !r.ok && r.code === '42501', r.error)
  r = await as(db, 'authenticated', bob, `update public.profiles set student_id = 'S-1' where id = $1`, [bob])
  check('email players keep editing their student id', r.ok && r.affected === 1, r.error)
}

done()
