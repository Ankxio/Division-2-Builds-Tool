# Refreshes data/snapshot/ with the current contents of the community sheet.
# The site reads the sheet live, so this is only needed to update the offline copy it
# falls back to. Run it from anywhere:  powershell -File tools\update-snapshot.ps1
#
# Keep the sheet ID and tab list in step with js/config.js and js/sheet.js.

$sheetId = '1nrPBmOrtpkEW1j5fbcRT7L-AXgsGOqMqxXoVtopsiGM'
$tabs = [ordered]@{
  welcome = '1380412817'; weapons = '0'; weapons_named = '1574559653'; weapon_talents = '89782728'
  gearsets = '1925112187'; brandsets = '1006013297'; gear_named = '195186127'; gear_talents = '1724618107'
  skill_list = '2053261857'; attribute_info = '412070318'; weapon_mods = '1283569496'
}

$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\snapshot'
$ProgressPreference = 'SilentlyContinue'
foreach ($tab in $tabs.GetEnumerator()) {
  $url = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$($tab.Value)"
  $file = Join-Path $target "$($tab.Key).csv"
  try {
    Invoke-WebRequest -Uri $url -OutFile "$file.new" -UseBasicParsing -ErrorAction Stop
    Move-Item "$file.new" $file -Force
    '{0,-16} updated ({1:N0} bytes)' -f $tab.Key, (Get-Item $file).Length
  } catch {
    Remove-Item "$file.new" -ErrorAction SilentlyContinue
    '{0,-16} FAILED, kept the old copy: {1}' -f $tab.Key, $_.Exception.Message
  }
}
