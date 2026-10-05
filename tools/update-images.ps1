# Rebuilds img/manifest.json from the pictures in img/items/, so the site knows which items
# have a picture of their own. Run it after adding or removing pictures:
#   powershell -File tools\update-images.ps1

$root = Split-Path $PSScriptRoot -Parent
$folder = Join-Path $root 'img\items'
$slots = 'mask', 'backpack', 'chest', 'gloves', 'holster', 'kneepads'

function Get-Slug([string]$name) {
  # Same rule as normName in js/stats.js: no accents, no punctuation, no leading "the".
  $suffix = ''
  foreach ($slot in $slots) {
    if ($name -match "-$slot$") { $suffix = "-$slot"; $name = $name.Substring(0, $name.Length - $suffix.Length) }
  }
  $name = $name -replace '\([^)]*\)', ' '
  $plain = -join ($name.Normalize([Text.NormalizationForm]::FormD).ToCharArray() |
    Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
  $plain = ($plain.ToLower() -replace 'armour', 'armor' -replace '[^a-z0-9]+', ' ').Trim() -replace '^the ', ''
  return ($plain -replace ' ', '') + $suffix
}

$map = [ordered]@{}
Get-ChildItem $folder -File | Where-Object { $_.Extension -match '^\.(png|jpe?g|webp|avif|svg)$' } | Sort-Object Name | ForEach-Object {
  $map[(Get-Slug $_.BaseName)] = $_.Name
}

$json = if ($map.Count) { $map | ConvertTo-Json } else { '{}' }
[IO.File]::WriteAllText((Join-Path $root 'img\manifest.json'), $json + "`n", (New-Object Text.UTF8Encoding($false)))
"$($map.Count) picture(s) listed in img\manifest.json"
