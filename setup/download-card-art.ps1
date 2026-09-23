# download-card-art.ps1 - Fetch card art from Scryfall for all catalog cards
# Saves to card-art/ at repo root. Idempotent: skips existing files.
# Usage: powershell -ExecutionPolicy Bypass -File setup/download-card-art.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Resolve-Path "$root\..\card-art"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$headers = @{ 'User-Agent' = 'CampusForge/1.0'; 'Accept' = 'application/json' }

$cardNames = @(
    'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
    'Counterspell', 'Lightning Bolt', 'Giant Growth', 'Cancel', 'Shock',
    'Llanowar Elves', 'Doom Blade', 'Solemn Simulacrum',
    'Savannah Lions', 'Suntail Hawk', 'Benalish Hero', 'Soul Warden',
    'Swords to Plowshares', 'Condemn', 'White Knight', 'Knight of the White Orchid',
    'Pacifism', 'Suture Priest', 'Serra Angel',
    'Brainstorm', 'Opt', 'Serum Visions', 'Coral Merfolk',
    'Man-o''-War', 'Phantom Warrior', 'Divination', 'Windfall',
    'Mnemonic Wall', 'Air Elemental', 'Cloud Djinn',
    'Dark Ritual', 'Viscera Seer', 'Thrull Surgeon', 'Sign in Blood',
    'Terror', 'Nantuko Shade', 'Drudge Skeletons', 'Dark Banishing',
    'Hypnotic Specter', 'Drain Life', 'Giant Cockroach', 'Nightmare',
    'Skeletal Vampire',
    'Goblin Guide', 'Goblin Grenade', 'Seal of Fire', 'Lava Spike',
    'Incinerate', 'Searing Spear', 'Volcanic Hammer', 'Arc Trail',
    'Viashino Pyromancer', 'Goblin Chieftain', 'Goblin Ruinblaster',
    'Goblin Trenches', 'Dragon Whelp', 'Shivan Dragon',
    'Rancor', 'Sakura-Tribe Elder', 'Rampant Growth', 'Nature''s Lore',
    'Centaur Courser', 'Cultivate', 'Yavimaya Elder', 'Terravore',
    'Stampeding Elk Herd', 'Stampeding Rhino', 'Baloth Woodcrasher',
    'Phyrexian Walker', 'Brass Man', 'Skullclamp', 'Sol Ring',
    'Shadowblood Egg', 'Iron Myr', 'Leaden Myr', 'Silver Myr',
    'Wurm''s Tooth', 'Armored Transport', 'Bottled Cloister',
    'Clockwork Beast', 'Darksteel Colossus',
    'Black Lotus', 'Ancestral Recall', 'Mox Sapphire',
    'Grizzly Bears', 'Elvish Warrior', 'Elvish Archers', 'Trained Armodon',
    'Cudgel Troll', 'Giant Spider', 'War Mammoth', 'Craw Wurm',
    'Raging Goblin', 'Goblin Piker', 'Goblin Mountaineer', 'Goblin Hero',
    'Vulshok Berserker', 'Hill Giant', 'Fire Elemental'
)

function Get-Slug($name) {
    return $name.ToLower() -replace '[^a-z0-9]+', '-' -replace '^-|-$', ''
}

$downloaded = 0
$skipped = 0
$failed = 0

foreach ($name in $cardNames) {
    $slug = Get-Slug $name
    $outFile = Join-Path $outDir "$slug.jpg"

    if (Test-Path $outFile) {
        $skipped++
        continue
    }

    try {
        $encoded = [System.Uri]::EscapeDataString($name)
        $jsonUrl = "https://api.scryfall.com/cards/named?format=json&exact=$encoded"
        $json = Invoke-RestMethod -Uri $jsonUrl -Headers $headers -ErrorAction Stop
        $imgUrl = $json.image_uris.normal

        if (-not $imgUrl) {
            Write-Host "  SKIP (no image): $name" -ForegroundColor Yellow
            $failed++
            continue
        }

        Invoke-WebRequest -Uri $imgUrl -OutFile $outFile -Headers @{ 'User-Agent' = 'CampusForge/1.0' } -ErrorAction Stop
        $downloaded++
        Write-Host "  OK: $name -> $slug.jpg" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL: $name - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }

    Start-Sleep -Milliseconds 110
}

Write-Host "`nDone: $downloaded downloaded, $skipped skipped, $failed failed (total $($cardNames.Count) cards)" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Optional: push local images into the Supabase `card-art` Storage bucket.
# Only runs when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars are set
# (e.g. `supabase start` exports API URL; the service key comes from
# `supabase status` or the project secrets). Upserts, so re-runs are idempotent.
# ---------------------------------------------------------------------------
$sbUrl = $env:SUPABASE_URL
$sbKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $sbUrl -or -not $sbKey) {
    Write-Host "`nSkipping Supabase Storage push (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to enable)." -ForegroundColor DarkGray
    exit 0
}

$apiBase = "$($sbUrl.TrimEnd('/'))/storage/v1"
$headers = @{ 'Authorization' = "Bearer $sbKey"; 'apikey' = $sbKey }
$uploaded = 0
$upFail = 0

try {
    Invoke-RestMethod -Method Post -Uri "$apiBase/buckets" -Headers $headers -ContentType 'application/json' -Body '{"id":"card-art","name":"card-art","public":true}' -ErrorAction SilentlyContinue | Out-Null
} catch {
    # bucket likely exists; that's fine
}

$localJpgs = Get-ChildItem -Path $outDir -Filter *.jpg
foreach ($jpg in $localJpgs) {
    try {
        $data = [System.IO.File]::ReadAllBytes($jpg.FullName)
        Invoke-RestMethod -Method Post -Uri "$apiBase/object/card-art/$($jpg.Name)?upsert=true" `
            -Headers $headers -ContentType 'image/jpeg' -Body $data -ErrorAction Stop | Out-Null
        $uploaded++
    } catch {
        Write-Host "  UP FAIL: $($jpg.Name) - $($_.Exception.Message)" -ForegroundColor Red
        $upFail++
    }
}
Write-Host "Supabase Storage: $uploaded uploaded, $upFail failed (total $($localJpgs.Count) files)" -ForegroundColor Cyan
