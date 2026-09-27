# Turn manager

The turn manager decides who takes the next walk-in. In a nail salon that decision is also a pay decision: technicians are paid on commission, so the order of turns has to be fair, visible to everyone, and identical on every screen in the room.

![Turn board mid-day](../media/turn-board.png)

## What the front desk sees

- **The board.** One row per technician, in turn order. Each box on a row is one turn: a service tile logged by hand, or a walk-in assigned from the queue. A small service like nail art can count as half a turn.
- **Waiting and In Service.** Walk-ins land in the waiting list, from the check-in kiosk or the front desk. To assign one, tap an empty box on a technician's row, then tap **Assign** on the client's card. Tapping **Waiting** moves them into service.
- **Guard rails.** If a technician is still working on a service and gets a new one, the board asks before marking the first one finished. Actions like **Start Over**, removing a technician or clearing a box need the owner's admin password.
- **Check-out history** on the right shows services as they finish, so the desk can see what's heading to checkout.

## Keeping every screen in sync

A salon runs the board on several screens at once: the front desk, a tablet at the stations, sometimes a phone. Any of them can make a change, and all of them have to agree.

![Two screens in sync](../media/turn-board-sync.gif)

*Left: the front desk assigns two walk-ins. Right: a second screen updates on its own, with no clicks.*

**The server decides.** Assigning a walk-in is one request to one endpoint. The server locks the queue entry and the board, checks the board's version, writes both, moves any matching appointment, and commits, all in a single database transaction. The browser renders what the server confirms. It never edits the board locally and hopes the save works.

**Stale writes get refused, not merged.** Every board carries a version number. If a screen tries to save an older version, the server answers with a conflict and the screen reloads the current board. A duplicate click or a retry after a network blip carries the same idempotency key, so the server replays its first answer instead of assigning twice.

**Two live streams, plus a safety net.** Each screen holds two server-sent-event connections, one for the board and one for the queue. That's why the GIF shows the board updating a beat before the waiting card. Because a stream can silently miss an event, each screen also polls slowly in the background and repairs itself if its board has fallen behind.

**Yesterday can't overwrite today.** Every board save carries the calendar day the page loaded. A tablet left open overnight can't push yesterday's board over this morning's.

## Code in this repo

| File | What it does |
|---|---|
| [`board-stream.js`](../packages/turn-manager/src/engine/board-stream.js) | Board save queue, conflict handling, realtime updates and the repair poll |
| [`queue-stream.js`](../packages/turn-manager/src/engine/queue-stream.js) | Incremental queue updates using a version token |
| [`queue-completion.js`](../packages/turn-manager/src/server/queue-completion.js) | Works out which walk-ins a paid ticket covers, and completes them |
| [`state.js`](../packages/turn-manager/src/engine/state.js), [`sync/`](../packages/turn-manager/src/sync) | Board state model and technician helpers |

Run `npm test` from the repo root to see the 54 turn manager tests pass.
