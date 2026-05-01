// ─────────────────────────────────────────────────────────────────────────────
// game.js  –  Pure game logic (no DOM, no Supabase)
// ─────────────────────────────────────────────────────────────────────────────

const SHIPS = [
  { id: 'carrier',    name: 'Carrier',    size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser',    name: 'Cruiser',    size: 3 },
  { id: 'submarine',  name: 'Submarine',  size: 3 },
  { id: 'destroyer',  name: 'Destroyer',  size: 2 },
];

// ── Board helpers ─────────────────────────────────────────────────────────────

function createEmptyBoard() {
  return Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({ shipId: null, hit: false }))
  );
}

// Returns the list of { row, col } cells a ship would occupy.
function getShipCells(row, col, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(horizontal ? { row, col: col + i } : { row: row + i, col });
  }
  return cells;
}

// Returns true if all cells are in-bounds and unoccupied.
function isValidPlacement(board, cells) {
  for (const { row, col } of cells) {
    if (row < 0 || row > 9 || col < 0 || col > 9) return false;
    if (board[row][col].shipId)                     return false;
  }
  return true;
}

// Immutably places a ship on the board.  Returns { board, cells } or null if invalid.
function placeShipOnBoard(board, ship, row, col, horizontal) {
  const cells = getShipCells(row, col, ship.size, horizontal);
  if (!isValidPlacement(board, cells)) return null;

  const newBoard = deepClone(board);
  cells.forEach(({ row: r, col: c }) => { newBoard[r][c].shipId = ship.id; });
  return { board: newBoard, cells };
}

// Randomly place all ships; retries the whole layout if stuck.
function randomPlaceAll() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let board = createEmptyBoard();
    const ships = [];
    let failed = false;

    for (const ship of SHIPS) {
      let placed = false;
      for (let i = 0; i < 300; i++) {
        const horizontal = Math.random() > 0.5;
        const row = Math.floor(Math.random() * 10);
        const col = Math.floor(Math.random() * 10);
        const result = placeShipOnBoard(board, ship, row, col, horizontal);
        if (result) {
          board = result.board;
          ships.push({ ...ship, cells: result.cells, horizontal, row, col });
          placed = true;
          break;
        }
      }
      if (!placed) { failed = true; break; }
    }

    if (!failed) return { board, ships };
  }
  throw new Error('Could not place ships randomly – try again.');
}

// ── Shot processing ───────────────────────────────────────────────────────────

// Process a shot against a board.  Returns result object; does NOT mutate board.
function processShot(board, row, col) {
  if (board[row][col].hit) return { alreadyFired: true };

  const newBoard = deepClone(board);
  newBoard[row][col].hit = true;

  const hit    = !!newBoard[row][col].shipId;
  const shipId = newBoard[row][col].shipId;

  let shipSunk  = null;
  let gameOver  = false;

  if (hit) {
    // Sunk if every cell of this ship is now hit
    const sunk = newBoard.flat().every(c => c.shipId !== shipId || c.hit);
    if (sunk) {
      const def = SHIPS.find(s => s.id === shipId);
      shipSunk = def ? def.name : shipId;
    }
    // Game over if every ship cell on the board is hit
    gameOver = newBoard.flat().every(c => !c.shipId || c.hit);
  }

  return { board: newBoard, hit, shipSunk, gameOver, alreadyFired: false };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
