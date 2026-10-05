// Where the game data comes from.
//
// sheetId is the community "Division 2 Gear Spreadsheet". The site reads it live on every
// visit, so new weapons, gear and balance changes show up as soon as the sheet is updated.
// If the sheet cannot be reached, the copy in data/snapshot/ is used instead.
//
// To use your own copy of the sheet, make it viewable by "Anyone with the link" and put its
// ID here (the long part of the address between /d/ and /edit). Set sheetId to '' to only
// ever use the snapshot.
export const CONFIG = {
  sheetId: '1nrPBmOrtpkEW1j5fbcRT7L-AXgsGOqMqxXoVtopsiGM',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/1nrPBmOrtpkEW1j5fbcRT7L-AXgsGOqMqxXoVtopsiGM/htmlview',
  liveTimeoutMs: 12000,
};
