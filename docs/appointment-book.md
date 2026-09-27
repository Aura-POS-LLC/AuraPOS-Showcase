# Appointment book

The appointment book is the day at a glance: one column per technician, one block per booking. It's the screen salon owners spend the most time on.

![Appointment book](../media/appointment-book.png)

## What it does

- **One column per technician.** Bookings show the time, client and service. The shaded band is outside business hours.
- **Walk-ins meet bookings.** When a client who has an appointment checks in at the kiosk, their block turns **Checked-in**. The turn manager can then move that appointment onto the technician's board.
- **Time blocks** mark a technician unavailable for a break, a training or a late start.
- **Search** finds a client by name or phone number, and the date strip jumps between days.
- **Online booking.** Clients book from the salon's own booking page. Rules on the server decide which times are offered: business hours, each technician's hours, services they can perform, and a buffer before requests start.
- **Text messages.** Confirmations, reminders and grouped messages for clients who booked several services together.

## Engineering notes

**Versioned days.** Each day's appointments are stored and versioned together. A save must say which version it was based on. If another screen saved first, the save is refused and the screen reloads instead of silently overwriting someone's booking.

**Outdated pages can't write.** After a deploy, an old browser tab may still be running the previous app build. Appointment saves include the build they came from, and the server refuses saves from an outdated build. That closes a whole class of "the old code wrote the old format" bugs.

## Code in this repo

The appointment book itself stays private. These pieces from the booking side are included:

| File | What it does |
|---|---|
| [`booking-request-buffer.js`](../packages/booking/src/booking-request-buffer.js) | Lead time and buffer rules for online booking requests |
| [`phone-match.js`](../packages/booking/src/phone-match.js) | Matches the same client across differently formatted phone numbers |
